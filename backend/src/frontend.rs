use axum::{
    body::Body,
    extract::OriginalUri,
    http::{HeaderValue, Method, StatusCode, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
};
use rust_embed::Embed;
use std::borrow::Cow;

#[derive(Embed)]
#[folder = "../frontend/dist/"]
#[allow_missing = true]
struct FrontendAssets;

pub(crate) async fn serve(method: Method, OriginalUri(uri): OriginalUri) -> Response {
    if method != Method::GET {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }

    let Some((_asset_path, asset)) = select_asset(uri.path(), FrontendAssets::get) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let content_type = asset.metadata.mimetype();
    asset_response(asset.data, content_type)
}

fn asset_response(data: Cow<'static, [u8]>, mimetype: &str) -> Response {
    let Ok(content_type) = HeaderValue::from_str(mimetype) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(CONTENT_TYPE, content_type);
    (headers, Body::from(data.into_owned())).into_response()
}

fn select_asset<T>(
    request_path: &str,
    mut get: impl FnMut(&str) -> Option<T>,
) -> Option<(&str, T)> {
    let asset_path = request_path.strip_prefix('/').unwrap_or(request_path);
    if !asset_path.is_empty()
        && let Some(asset) = get(asset_path)
    {
        return Some((asset_path, asset));
    }

    get("index.html").map(|asset| ("index.html", asset))
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use axum::{
        body::to_bytes,
        extract::OriginalUri,
        http::{HeaderValue, Method, StatusCode, Uri, header::CONTENT_TYPE},
    };
    use rstest::rstest;

    use super::{asset_response, select_asset, serve};

    #[derive(Debug, PartialEq, Eq)]
    struct TestAsset {
        content_type: &'static str,
        body: &'static str,
    }

    #[rstest]
    #[case::root("/", Some(("index.html", "text/html", "app shell")))]
    #[case::asset(
        "/assets/app.js",
        Some(("assets/app.js", "text/javascript", "app script"))
    )]
    #[case::unknown_path("/settings", Some(("index.html", "text/html", "app shell")))]
    #[case::unknown_asset(
        "/assets/missing.js",
        Some(("index.html", "text/html", "app shell"))
    )]
    fn selects_asset_for_request(
        #[case] request_path: &str,
        #[case] expected: Option<(&str, &str, &str)>,
    ) {
        let actual = select_asset(request_path, |path| match path {
            "index.html" => Some(TestAsset {
                content_type: "text/html",
                body: "app shell",
            }),
            "assets/app.js" => Some(TestAsset {
                content_type: "text/javascript",
                body: "app script",
            }),
            _ => None,
        })
        .map(|(path, asset)| (path, asset.content_type, asset.body));

        assert_eq!(actual, expected);
    }

    #[rstest]
    #[case::javascript("text/javascript", b"app script", "app script")]
    #[case::manifest("application/manifest+json", b"{}", "{}")]
    #[test_attr(tokio::test)]
    async fn responds_with_asset_content_type(
        #[case] content_type: &'static str,
        #[case] body: &'static [u8],
        #[case] expected_body: &str,
    ) {
        let response = asset_response(Cow::Borrowed(body), content_type);
        let actual = (
            response.status(),
            response.headers().get(CONTENT_TYPE).cloned(),
            to_bytes(response.into_body(), usize::MAX).await.unwrap(),
        );

        assert_eq!(
            actual,
            (
                StatusCode::OK,
                Some(HeaderValue::from_static(content_type)),
                expected_body.as_bytes().to_vec().into(),
            )
        );
    }

    #[tokio::test]
    async fn rejects_non_get_requests() {
        let response = serve(Method::POST, OriginalUri(Uri::from_static("/settings"))).await;
        let actual = (
            response.status(),
            to_bytes(response.into_body(), usize::MAX).await.unwrap(),
        );

        assert_eq!(actual, (StatusCode::METHOD_NOT_ALLOWED, Vec::new().into()));
    }
}
