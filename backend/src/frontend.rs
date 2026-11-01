use axum::{
    body::Body,
    extract::OriginalUri,
    http::{HeaderValue, StatusCode, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../frontend/dist/"]
#[allow_missing = true]
struct FrontendAssets;

pub(crate) async fn serve(OriginalUri(uri): OriginalUri) -> Response {
    let request_path = uri.path();
    let asset_path = resolve_asset_path(request_path, |path| FrontendAssets::get(path).is_some());
    let Some(asset) = FrontendAssets::get(asset_path) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static(content_type(asset_path)),
    );
    (headers, Body::from(asset.data.into_owned())).into_response()
}

fn resolve_asset_path(request_path: &str, contains: impl Fn(&str) -> bool) -> &str {
    let asset_path = request_path.strip_prefix('/').unwrap_or(request_path);
    if asset_path.is_empty() || !contains(asset_path) {
        "index.html"
    } else {
        asset_path
    }
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, extension)| extension) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("webmanifest") => "application/manifest+json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/vnd.microsoft.icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::resolve_asset_path;

    #[rstest]
    #[case::root("/", "index.html")]
    #[case::asset("/assets/app.js", "assets/app.js")]
    #[case::unknown_path("/settings", "index.html")]
    #[case::unknown_asset("/assets/missing.js", "index.html")]
    fn resolves_request_path(#[case] request_path: &str, #[case] expected: &str) {
        let actual = resolve_asset_path(request_path, |path| path == "assets/app.js");

        assert_eq!(actual, expected);
    }
}
