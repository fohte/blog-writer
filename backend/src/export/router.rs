use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    export::handler::{
        __path_get_article_file, __path_list_destinations, __path_publish_article,
        get_article_file, list_destinations, publish_article,
    },
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_destinations))
        .routes(routes!(get_article_file))
        .routes(routes!(publish_article))
}
