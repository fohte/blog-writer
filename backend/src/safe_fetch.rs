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
const BLOCKED_IPV4_SUBNETS: [(Ipv4Addr, u32); 15] = [
    (Ipv4Addr::new(0, 0, 0, 0), 8),
    (Ipv4Addr::new(10, 0, 0, 0), 8),
    (Ipv4Addr::new(100, 64, 0, 0), 10),
    (Ipv4Addr::new(127, 0, 0, 0), 8),
    (Ipv4Addr::new(169, 254, 0, 0), 16),
    (Ipv4Addr::new(172, 16, 0, 0), 12),
    (Ipv4Addr::new(192, 0, 0, 0), 24),
    (Ipv4Addr::new(192, 0, 2, 0), 24),
    (Ipv4Addr::new(192, 88, 99, 0), 24),
    (Ipv4Addr::new(192, 168, 0, 0), 16),
    (Ipv4Addr::new(198, 18, 0, 0), 15),
    (Ipv4Addr::new(198, 51, 100, 0), 24),
    (Ipv4Addr::new(203, 0, 113, 0), 24),
    (Ipv4Addr::new(224, 0, 0, 0), 4),
    (Ipv4Addr::new(240, 0, 0, 0), 4),
];

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
            let (host, port) = host_and_port(&current_url)?;
            let addresses = self.resolve_and_validate(&host, port).await?;
            let client = build_pinned_client(&host, &addresses)?;
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

            let body = read_limited_body(response).await?;

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

fn host_and_port(url: &Url) -> Result<(String, u16), SafeFetchError> {
    let host = url
        .host_str()
        .ok_or(SafeFetchError::InvalidUrl)?
        .trim_matches(['[', ']'])
        .to_owned();
    let port = url
        .port_or_known_default()
        .ok_or(SafeFetchError::InvalidUrl)?;
    Ok((host, port))
}

fn build_pinned_client(host: &str, addresses: &[SocketAddr]) -> Result<Client, SafeFetchError> {
    let mut builder = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .no_proxy();
    if host.parse::<IpAddr>().is_err() {
        let pinned_addresses: Vec<_> = addresses
            .iter()
            .map(|address| SocketAddr::new(address.ip(), 0))
            .collect();
        builder = builder.resolve_to_addrs(host, &pinned_addresses);
    }
    builder.build().map_err(SafeFetchError::Request)
}

async fn read_limited_body(mut response: reqwest::Response) -> Result<Vec<u8>, SafeFetchError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY_BYTES as u64)
    {
        return Err(SafeFetchError::TooLarge);
    }

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(SafeFetchError::Request)? {
        if body.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
            return Err(SafeFetchError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
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
    !BLOCKED_IPV4_SUBNETS
        .iter()
        .any(|(network, prefix)| in_ipv4_subnet(address, u32::from(*network), *prefix))
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

    use axum::{Router, body::Body, http::Request};
    use rstest::rstest;
    use serde_json::{Value, json};
    use tower::ServiceExt;
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
    async fn returns_ogp_metadata_through_the_api() -> Result<(), Box<dyn std::error::Error>> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"<meta property="og:title" content="Card title"><meta property="og:image" content="/card.png">"#,
            ))
            .mount(&server)
            .await;
        let address = server_address(&server)?;
        let fetcher = test_fetcher([("site.test".to_owned(), vec![address])], |address| {
            address.is_loopback()
        });
        let state = crate::app::AppState {
            export: None,
            safe_fetch: fetcher,
        };
        let api: Router = crate::ogp::router().split_for_parts().0.with_state(state);
        let url = format!("http://site.test:{}/article", address.port());

        let response = api
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/ogp")
                    .header("content-type", "application/json")
                    .body(Body::from(json!({"url": url}).to_string()))?,
            )
            .await?;
        let status = response.status().as_u16();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await?;
        let body: Value = serde_json::from_slice(&bytes)?;

        assert_eq!(
            (status, body),
            (
                200,
                json!({
                    "available": true,
                    "final_url": format!("http://site.test:{}/article", address.port()),
                    "title": "Card title",
                    "description": null,
                    "image": format!("http://site.test:{}/card.png", address.port())
                })
            )
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
    #[case::ipv4_loopback("http://127.0.0.1/")]
    #[case::ipv4_private("http://10.2.3.4/")]
    #[case::carrier_grade_nat("http://100.64.0.1/")]
    #[case::link_local("http://169.254.169.254/")]
    #[case::ipv6_ula("http://[fd00::1]/")]
    #[case::ipv6_loopback("http://[::1]/")]
    #[case::ipv6_link_local("http://[fe80::1]/")]
    #[case::ipv4_mapped_ipv6("http://[::ffff:127.0.0.1]/")]
    #[test_attr(tokio::test)]
    async fn rejects_internal_ip_literals(#[case] url: &str) {
        let actual = SafeFetcher::new().fetch(url).await;

        assert!(matches!(actual, Err(SafeFetchError::DisallowedAddress)));
    }

    #[tokio::test]
    async fn rejects_non_http_schemes() {
        let actual = SafeFetcher::new().fetch("file:///etc/passwd").await;

        assert!(matches!(actual, Err(SafeFetchError::UnsupportedScheme)));
    }
}
