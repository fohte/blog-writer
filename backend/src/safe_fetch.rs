use std::{
    future::Future,
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    pin::Pin,
    sync::Arc,
    time::Duration,
};

use reqwest::{Client, StatusCode, Url, header::LOCATION, redirect::Policy};
use thiserror::Error;

const TOTAL_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_REDIRECTS: usize = 5;
const MAX_BODY_BYTES: usize = 1_048_576;

type ResolveFuture<'a> = Pin<Box<dyn Future<Output = io::Result<Vec<SocketAddr>>> + Send + 'a>>;
type AddressPolicy = Arc<dyn Fn(IpAddr) -> bool + Send + Sync>;

#[derive(Debug, Error)]
pub enum SafeFetchError {
    #[error("URL is invalid")]
    InvalidUrl,
    #[error("URL scheme must be HTTP or HTTPS")]
    UnsupportedScheme,
    #[error("URL credentials are not allowed")]
    CredentialsNotAllowed,
    #[error("DNS lookup failed")]
    DnsLookup(#[source] io::Error),
    #[error("DNS returned no addresses")]
    NoAddresses,
    #[error("URL resolves to a disallowed address")]
    DisallowedAddress,
    #[error("HTTP request failed")]
    Request(#[source] reqwest::Error),
    #[error("redirect limit exceeded")]
    TooManyRedirects,
    #[error("redirect URL is invalid")]
    InvalidRedirect,
    #[error("remote server returned HTTP {0}")]
    HttpStatus(StatusCode),
    #[error("response exceeds the size limit")]
    TooLarge,
    #[error("request timed out")]
    Timeout,
}

#[derive(Debug)]
pub struct FetchResponse {
    pub final_url: Url,
    pub body: Vec<u8>,
}

#[derive(Clone)]
pub struct SafeFetcher {
    resolver: Arc<dyn HostResolver>,
    address_policy: AddressPolicy,
}

impl SafeFetcher {
    pub fn new() -> Self {
        Self {
            resolver: Arc::new(SystemHostResolver),
            address_policy: Arc::new(is_public_address),
        }
    }

    pub async fn fetch(&self, url: &str) -> Result<FetchResponse, SafeFetchError> {
        tokio::time::timeout(TOTAL_TIMEOUT, self.fetch_inner(url))
            .await
            .map_err(|_| SafeFetchError::Timeout)?
    }

    #[cfg(test)]
    fn with_resolver_and_policy(
        resolver: Arc<dyn HostResolver>,
        address_policy: AddressPolicy,
    ) -> Self {
        Self {
            resolver,
            address_policy,
        }
    }

    async fn fetch_inner(&self, url: &str) -> Result<FetchResponse, SafeFetchError> {
        let mut current_url = Url::parse(url).map_err(|_| SafeFetchError::InvalidUrl)?;
        let mut redirects = 0;

        loop {
            validate_url(&current_url)?;
            let host = current_url
                .host_str()
                .ok_or(SafeFetchError::InvalidUrl)?
                .trim_matches(['[', ']'])
                .to_owned();
            let port = current_url
                .port_or_known_default()
                .ok_or(SafeFetchError::InvalidUrl)?;
            let addresses = self.resolve_and_validate(&host, port).await?;

            let mut client_builder = Client::builder()
                .redirect(Policy::none())
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(TOTAL_TIMEOUT)
                .no_proxy();
            if host.parse::<IpAddr>().is_err() {
                let pinned_addresses: Vec<_> = addresses
                    .iter()
                    .map(|address| SocketAddr::new(address.ip(), 0))
                    .collect();
                client_builder = client_builder.resolve_to_addrs(&host, &pinned_addresses);
            }

            let client = client_builder.build().map_err(SafeFetchError::Request)?;
            let response = client
                .get(current_url.clone())
                .send()
                .await
                .map_err(SafeFetchError::Request)?;
            let status = response.status();

            if status.is_redirection() {
                if redirects >= MAX_REDIRECTS {
                    return Err(SafeFetchError::TooManyRedirects);
                }
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or(SafeFetchError::InvalidRedirect)?;
                current_url = current_url
                    .join(location)
                    .map_err(|_| SafeFetchError::InvalidRedirect)?;
                redirects += 1;
                continue;
            }

            if !status.is_success() {
                return Err(SafeFetchError::HttpStatus(status));
            }

            if response
                .content_length()
                .is_some_and(|length| length > MAX_BODY_BYTES as u64)
            {
                return Err(SafeFetchError::TooLarge);
            }

            let mut body = Vec::new();
            let mut response = response;
            while let Some(chunk) = response.chunk().await.map_err(SafeFetchError::Request)? {
                if body.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
                    return Err(SafeFetchError::TooLarge);
                }
                body.extend_from_slice(&chunk);
            }

            return Ok(FetchResponse {
                final_url: current_url,
                body,
            });
        }
    }

    async fn resolve_and_validate(
        &self,
        host: &str,
        port: u16,
    ) -> Result<Vec<SocketAddr>, SafeFetchError> {
        if let Ok(ip) = host.parse::<IpAddr>() {
            if !(self.address_policy)(ip) {
                return Err(SafeFetchError::DisallowedAddress);
            }
            return Ok(vec![SocketAddr::new(ip, 0)]);
        }

        let addresses = self
            .resolver
            .resolve(host, port)
            .await
            .map_err(SafeFetchError::DnsLookup)?;
        if addresses.is_empty() {
            return Err(SafeFetchError::NoAddresses);
        }
        if addresses
            .iter()
            .any(|address| !(self.address_policy)(address.ip()))
        {
            return Err(SafeFetchError::DisallowedAddress);
        }

        Ok(addresses)
    }
}

impl Default for SafeFetcher {
    fn default() -> Self {
        Self::new()
    }
}

pub async fn fetch(url: &str) -> Result<FetchResponse, SafeFetchError> {
    SafeFetcher::new().fetch(url).await
}

fn validate_url(url: &Url) -> Result<(), SafeFetchError> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(SafeFetchError::UnsupportedScheme);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(SafeFetchError::CredentialsNotAllowed);
    }
    if url.host_str().is_none() {
        return Err(SafeFetchError::InvalidUrl);
    }
    Ok(())
}

trait HostResolver: Send + Sync {
    fn resolve<'a>(&'a self, host: &'a str, port: u16) -> ResolveFuture<'a>;
}

struct SystemHostResolver;

impl HostResolver for SystemHostResolver {
    fn resolve<'a>(&'a self, host: &'a str, port: u16) -> ResolveFuture<'a> {
        Box::pin(async move {
            tokio::net::lookup_host((host, port))
                .await
                .map(|addresses| addresses.collect())
        })
    }
}

fn is_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_public_ipv4(address),
        IpAddr::V6(address) => is_public_ipv6(address),
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let address = u32::from(address);
    ![
        ("0.0.0.0", 8),
        ("10.0.0.0", 8),
        ("100.64.0.0", 10),
        ("127.0.0.0", 8),
        ("169.254.0.0", 16),
        ("172.16.0.0", 12),
        ("192.0.0.0", 24),
        ("192.0.2.0", 24),
        ("192.88.99.0", 24),
        ("192.168.0.0", 16),
        ("198.18.0.0", 15),
        ("198.51.100.0", 24),
        ("203.0.113.0", 24),
        ("224.0.0.0", 4),
        ("240.0.0.0", 4),
    ]
    .into_iter()
    .any(|(network, prefix)| {
        network
            .parse::<Ipv4Addr>()
            .is_ok_and(|network| in_ipv4_subnet(address, u32::from(network), prefix))
    })
}

fn in_ipv4_subnet(address: u32, network: u32, prefix: u32) -> bool {
    let mask = u32::MAX << (32 - prefix);
    address & mask == network & mask
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    let is_global_unicast = segments[0] & 0xe000 == 0x2000;
    let is_protocol_assignment = segments[0] == 0x2001 && segments[1] & 0xfe00 == 0;
    let is_6to4 = segments[0] == 0x2002;
    let is_documentation = (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || (segments[0] == 0x3fff && segments[1] & 0xfff0 == 0);

    is_global_unicast && !is_protocol_assignment && !is_6to4 && !is_documentation
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        io,
        net::{IpAddr, SocketAddr},
        sync::Arc,
    };

    use rstest::rstest;
    use wiremock::{Mock, MockServer, ResponseTemplate, matchers::method};

    use super::{
        FetchResponse, HostResolver, MAX_BODY_BYTES, ResolveFuture, SafeFetchError, SafeFetcher,
        is_public_address,
    };

    struct TestResolver(HashMap<String, Vec<SocketAddr>>);

    impl HostResolver for TestResolver {
        fn resolve<'a>(&'a self, host: &'a str, _port: u16) -> ResolveFuture<'a> {
            Box::pin(async move {
                self.0.get(host).cloned().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::NotFound, "test host is not configured")
                })
            })
        }
    }

    fn test_fetcher(
        addresses: impl IntoIterator<Item = (String, Vec<SocketAddr>)>,
        policy: impl Fn(IpAddr) -> bool + Send + Sync + 'static,
    ) -> SafeFetcher {
        SafeFetcher::with_resolver_and_policy(
            Arc::new(TestResolver(addresses.into_iter().collect())),
            Arc::new(policy),
        )
    }

    fn server_address(server: &MockServer) -> Result<SocketAddr, Box<dyn std::error::Error>> {
        let url = reqwest::Url::parse(&server.uri())?;
        let ip = url.host_str().ok_or("server host is missing")?.parse()?;
        let port = url.port().ok_or("server port is missing")?;
        Ok(SocketAddr::new(ip, port))
    }

    #[tokio::test]
    async fn fetches_html_from_an_allowed_resolved_address()
    -> Result<(), Box<dyn std::error::Error>> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<title>Sample</title>"))
            .mount(&server)
            .await;
        let address = server_address(&server)?;
        let fetcher = test_fetcher([("site.test".to_owned(), vec![address])], |address| {
            address.is_loopback()
        });

        let url = format!("http://site.test:{}/page", address.port());
        let response: FetchResponse = fetcher.fetch(&url).await?;

        assert_eq!(
            (response.final_url.as_str(), response.body),
            (url.as_str(), b"<title>Sample</title>".to_vec())
        );
        Ok(())
    }

    #[tokio::test]
    async fn rejects_a_private_dns_answer_before_connecting()
    -> Result<(), Box<dyn std::error::Error>> {
        let fetcher = test_fetcher(
            [("private.test".to_owned(), vec!["10.4.0.2:0".parse()?])],
            is_public_address,
        );

        let actual = fetcher.fetch("http://private.test/page").await;

        assert!(matches!(actual, Err(SafeFetchError::DisallowedAddress)));
        Ok(())
    }

    #[tokio::test]
    async fn rejects_a_redirect_to_a_private_dns_answer() -> Result<(), Box<dyn std::error::Error>>
    {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(302).insert_header("location", "http://private.test/secret"),
            )
            .mount(&server)
            .await;
        let address = server_address(&server)?;
        let fetcher = test_fetcher(
            [
                ("site.test".to_owned(), vec![address]),
                ("private.test".to_owned(), vec!["10.4.0.2:0".parse()?]),
            ],
            |address| address.is_loopback(),
        );

        let url = format!("http://site.test:{}/start", address.port());
        let actual = fetcher.fetch(&url).await;

        assert!(matches!(actual, Err(SafeFetchError::DisallowedAddress)));
        Ok(())
    }

    #[tokio::test]
    async fn stops_after_the_redirect_limit() -> Result<(), Box<dyn std::error::Error>> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(302).insert_header("location", "/loop"))
            .mount(&server)
            .await;
        let address = server_address(&server)?;
        let fetcher = test_fetcher([("site.test".to_owned(), vec![address])], |address| {
            address.is_loopback()
        });
        let url = format!("http://site.test:{}/start", address.port());

        let actual = fetcher.fetch(&url).await;

        assert!(matches!(actual, Err(SafeFetchError::TooManyRedirects)));
        Ok(())
    }

    #[tokio::test]
    async fn rejects_a_response_that_exceeds_the_body_limit()
    -> Result<(), Box<dyn std::error::Error>> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![b'x'; MAX_BODY_BYTES + 1]))
            .mount(&server)
            .await;
        let fetcher = test_fetcher(
            [("site.test".to_owned(), vec![server_address(&server)?])],
            |address| address.is_loopback(),
        );

        let url = format!("http://site.test:{}/large", server_address(&server)?.port());
        let actual = fetcher.fetch(&url).await;

        assert!(matches!(actual, Err(SafeFetchError::TooLarge)));
        Ok(())
    }

    #[rstest]
    #[case::file_url("file:///etc/passwd", true)]
    #[case::loopback("http://127.0.0.1/", true)]
    #[case::private("http://10.2.3.4/", true)]
    #[case::carrier_grade_nat("http://100.64.0.1/", true)]
    #[case::link_local("http://169.254.169.254/", true)]
    #[case::ipv6_ula("http://[fd00::1]/", true)]
    #[case::public_ipv4("http://8.8.8.8/", false)]
    #[case::public_ipv6("http://[2606:4700:4700::1111]/", false)]
    fn validates_address_ranges(#[case] url: &str, #[case] is_rejected: bool) {
        let parsed = reqwest::Url::parse(url);
        let actual_is_rejected = parsed.is_err()
            || parsed.is_ok_and(|parsed| {
                super::validate_url(&parsed).is_err()
                    || parsed
                        .host_str()
                        .and_then(|host| host.trim_matches(['[', ']']).parse::<IpAddr>().ok())
                        .is_some_and(|address| !is_public_address(address))
            });

        assert_eq!(actual_is_rejected, is_rejected);
    }
}
