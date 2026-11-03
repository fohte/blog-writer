use std::{
    future::Future,
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    pin::Pin,
    sync::Arc,
    time::Duration,
};

use reqwest::{
    Client, StatusCode, Url,
    header::{ACCEPT, CONTENT_TYPE, LOCATION},
    redirect::Policy,
};
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

impl SafeFetchError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::InvalidUrl => "invalid_url",
            Self::UnsupportedScheme => "unsupported_scheme",
            Self::CredentialsNotAllowed => "credentials_not_allowed",
            Self::DnsLookup(_) => "dns_lookup",
            Self::NoAddresses => "no_addresses",
            Self::DisallowedAddress => "disallowed_address",
            Self::Request(_) => "request_failed",
            Self::TooManyRedirects => "too_many_redirects",
            Self::InvalidRedirect => "invalid_redirect",
            Self::HttpStatus(_) => "http_status",
            Self::TooLarge => "too_large",
            Self::Timeout => "timeout",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchResponse {
    pub final_url: Url,
    pub body: Vec<u8>,
    pub content_type: Option<String>,
}

pub(crate) type SafeFetchFuture<'a> =
    Pin<Box<dyn Future<Output = Result<FetchResponse, SafeFetchError>> + Send + 'a>>;

pub(crate) trait SafeFetchService: Send + Sync {
    fn fetch<'a>(&'a self, url: &'a str) -> SafeFetchFuture<'a>;
}

#[derive(Clone)]
pub struct SafeFetcher {
    resolver: Arc<dyn HostResolver>,
    address_policy: AddressPolicy,
    total_timeout: Duration,
}

impl SafeFetcher {
    pub fn new() -> Self {
        Self {
            resolver: Arc::new(SystemHostResolver),
            address_policy: Arc::new(is_public_address),
            total_timeout: TOTAL_TIMEOUT,
        }
    }

    pub async fn fetch(&self, url: &str) -> Result<FetchResponse, SafeFetchError> {
        tokio::time::timeout(self.total_timeout, self.fetch_inner(url))
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
            total_timeout: TOTAL_TIMEOUT,
        }
    }

    #[cfg(test)]
    fn with_timeout(mut self, total_timeout: Duration) -> Self {
        self.total_timeout = total_timeout;
        self
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
                .header(ACCEPT, "text/html")
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

            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let body = read_limited_body(response).await?;

            return Ok(FetchResponse {
                final_url: current_url,
                body,
                content_type,
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

impl SafeFetchService for SafeFetcher {
    fn fetch<'a>(&'a self, url: &'a str) -> SafeFetchFuture<'a> {
        Box::pin(SafeFetcher::fetch(self, url))
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
        .user_agent("blog-writer")
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
    // Only 2000::/3 contains global unicast allocations; other ranges include special-purpose addresses.
    let is_global_unicast = segments[0] & 0xe000 == 0x2000;
    let is_protocol_assignment = segments[0] == 0x2001 && segments[1] & 0xfe00 == 0;
    // 6to4 embeds an IPv4 address and cannot be checked by the IPv6 prefix alone.
    let is_6to4 = segments[0] == 0x2002;
    let is_documentation = (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || (segments[0] == 0x3fff && segments[1] & 0xfff0 == 0);

    is_global_unicast && !is_protocol_assignment && !is_6to4 && !is_documentation
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        io::{self, Read, Write},
        net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener},
        sync::Arc,
        thread::JoinHandle,
        time::{Duration, Instant},
    };

    use rstest::rstest;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{header, method},
    };

    use super::{
        FetchResponse, HostResolver, MAX_BODY_BYTES, ResolveFuture, SafeFetchError, SafeFetcher,
        is_public_address,
    };

    type ResponseServer = (SocketAddr, JoinHandle<io::Result<()>>);

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

    struct SlowResolver;

    impl HostResolver for SlowResolver {
        fn resolve<'a>(&'a self, _host: &'a str, _port: u16) -> ResolveFuture<'a> {
            Box::pin(async {
                tokio::time::sleep(Duration::from_millis(100)).await;
                Ok(vec![SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0)])
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

    fn spawn_response_server(
        response: Vec<u8>,
    ) -> Result<ResponseServer, Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let address = listener.local_addr()?;
        let handle = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(2);
            let (mut stream, _) = loop {
                match listener.accept() {
                    Ok(connection) => break connection,
                    Err(error)
                        if error.kind() == io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        return Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "response server did not receive a request",
                        ));
                    }
                    Err(error) => return Err(error),
                }
            };
            stream.set_read_timeout(Some(Duration::from_secs(2)))?;
            stream.set_write_timeout(Some(Duration::from_secs(2)))?;
            let mut request = Vec::new();
            let mut buffer = [0; 1024];
            while !request.windows(4).any(|window| window == [13, 10, 13, 10]) {
                let read = stream.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
            }
            let _ = stream.write_all(&response);
            Ok(())
        });
        Ok((address, handle))
    }

    fn append_http_headers(response: &mut Vec<u8>, headers: &[&str]) {
        for header in headers {
            response.extend_from_slice(header.as_bytes());
            response.extend_from_slice(&[13, 10]);
        }
        response.extend_from_slice(&[13, 10]);
    }

    fn error_code<T>(result: Result<T, SafeFetchError>) -> Result<(), &'static str> {
        result.map(|_| ()).map_err(|error| error.code())
    }

    #[tokio::test]
    async fn fetches_a_response_from_an_allowed_resolved_address()
    -> Result<(), Box<dyn std::error::Error>> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(header("user-agent", "blog-writer"))
            .and(header("accept", "text/html"))
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
            response,
            FetchResponse {
                final_url: reqwest::Url::parse(&url)?,
                body: b"<title>Sample</title>".to_vec(),
                content_type: Some("text/plain".to_owned()),
            }
        );
        Ok(())
    }

    #[tokio::test]
    async fn retains_the_response_content_type() -> Result<(), Box<dyn std::error::Error>> {
        let body = b"<title>Sample</title>";
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(body.to_vec(), "text/html; charset=utf-8"),
            )
            .mount(&server)
            .await;
        let address = server_address(&server)?;
        let fetcher = test_fetcher([("site.test".to_owned(), vec![address])], |address| {
            address.is_loopback()
        });
        let url = format!("http://site.test:{}/page", address.port());

        let actual = fetcher.fetch(&url).await?;

        assert_eq!(
            actual,
            FetchResponse {
                final_url: reqwest::Url::parse(&url)?,
                body: body.to_vec(),
                content_type: Some("text/html; charset=utf-8".to_owned()),
            }
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

        assert_eq!(error_code(actual), Err("disallowed_address"));
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

        assert_eq!(error_code(actual), Err("disallowed_address"));
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

        assert_eq!(error_code(actual), Err("too_many_redirects"));
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

        assert_eq!(error_code(actual), Err("too_large"));
        Ok(())
    }

    #[tokio::test]
    async fn rejects_a_chunked_response_that_exceeds_the_body_limit()
    -> Result<(), Box<dyn std::error::Error>> {
        let body = vec![b'x'; MAX_BODY_BYTES + 1];
        let mut response = Vec::new();
        append_http_headers(
            &mut response,
            &[
                "HTTP/1.1 200 OK",
                "Transfer-Encoding: chunked",
                "Connection: close",
            ],
        );
        response.extend_from_slice(format!("{:x}", body.len()).as_bytes());
        response.extend_from_slice(&[13, 10]);
        response.extend_from_slice(&body);
        response.extend_from_slice(&[13, 10]);
        response.extend_from_slice(b"0");
        response.extend_from_slice(&[13, 10, 13, 10]);
        let (address, handle) = spawn_response_server(response)?;
        let fetcher = test_fetcher([("site.test".to_owned(), vec![address])], |address| {
            address.is_loopback()
        });
        let url = format!("http://site.test:{}/large", address.port());

        let actual = fetcher.fetch(&url).await;

        handle
            .join()
            .map_err(|_| io::Error::other("response server thread panicked"))??;
        assert_eq!(error_code(actual), Err("too_large"));
        Ok(())
    }

    #[rstest]
    #[case::unspecified_ipv4("0.0.0.0", false)]
    #[case::limited_broadcast("255.255.255.255", false)]
    #[case::multicast_ipv4("224.0.0.1", false)]
    #[case::benchmark_ipv4("198.18.0.1", false)]
    #[case::documentation_ipv4("203.0.113.1", false)]
    #[case::carrier_grade_nat_upper_bound("100.127.255.255", false)]
    #[case::outside_carrier_grade_nat("100.128.0.1", true)]
    #[case::ula_lower_bound("fc00::", false)]
    #[case::ula_upper_bound("fdff::", false)]
    #[case::six_to_four("2002::", false)]
    #[case::nat64_embedded_private("64:ff9b::7f00:1", false)]
    #[case::ipv4_compatible_loopback("::127.0.0.1", false)]
    #[case::ipv4_mapped_loopback("::ffff:127.0.0.1", false)]
    #[case::public_ipv4("1.1.1.1", true)]
    #[case::public_ipv6("2606:4700:4700::1111", true)]
    fn classifies_address_policy_boundaries(
        #[case] value: &str,
        #[case] expected: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let address = value.parse::<IpAddr>()?;

        assert_eq!(is_public_address(address), expected);
        Ok(())
    }

    #[rstest]
    #[case::private_ip_literal(Some("http://10.4.0.2/private"), "disallowed_address")]
    #[case::non_http_scheme(Some("file:///etc/passwd"), "unsupported_scheme")]
    #[case::missing_location(None, "invalid_redirect")]
    #[test_attr(tokio::test)]
    async fn validates_redirect_targets(
        #[case] location: Option<&str>,
        #[case] expected: &'static str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let server = MockServer::start().await;
        let response = location.map_or_else(
            || ResponseTemplate::new(302),
            |location| ResponseTemplate::new(302).insert_header("location", location),
        );
        Mock::given(method("GET"))
            .respond_with(response)
            .mount(&server)
            .await;
        let address = server_address(&server)?;
        let fetcher = test_fetcher([("site.test".to_owned(), vec![address])], |address| {
            address.is_loopback()
        });
        let url = format!("http://site.test:{}/start", address.port());

        let actual = fetcher.fetch(&url).await;

        assert_eq!(error_code(actual), Err(expected));
        Ok(())
    }

    #[tokio::test]
    async fn enforces_a_total_fetch_timeout() {
        let fetcher =
            SafeFetcher::with_resolver_and_policy(Arc::new(SlowResolver), Arc::new(|_| true))
                .with_timeout(Duration::from_millis(10));

        let actual = fetcher.fetch("http://site.test/article").await;

        assert_eq!(error_code(actual), Err("timeout"));
    }

    #[rstest]
    #[case::ipv4_loopback("http://127.0.0.1/", "disallowed_address")]
    #[case::ipv4_private("http://10.2.3.4/", "disallowed_address")]
    #[case::carrier_grade_nat("http://100.64.0.1/", "disallowed_address")]
    #[case::link_local("http://169.254.169.254/", "disallowed_address")]
    #[case::ipv6_ula("http://[fd00::1]/", "disallowed_address")]
    #[case::ipv6_loopback("http://[::1]/", "disallowed_address")]
    #[case::ipv6_link_local("http://[fe80::1]/", "disallowed_address")]
    #[case::ipv4_mapped_ipv6("http://[::ffff:127.0.0.1]/", "disallowed_address")]
    #[case::non_http_scheme("gopher://site.test/article", "unsupported_scheme")]
    #[case::userinfo("http://user:password@site.test/article", "credentials_not_allowed")]
    #[test_attr(tokio::test)]
    async fn rejects_unsafe_urls(#[case] url: &str, #[case] expected: &'static str) {
        let actual = SafeFetcher::new().fetch(url).await;

        assert_eq!(error_code(actual), Err(expected));
    }
}
