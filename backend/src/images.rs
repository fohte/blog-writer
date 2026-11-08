mod handler;
mod process;
mod publish;
mod storage;

pub use handler::router;
pub use publish::ImagePublisher;
pub(crate) use publish::{publish_draft_images, restore_draft_links};

fn content_type(name: &str) -> &'static str {
    if name.ends_with(".gif") {
        "image/gif"
    } else {
        "image/webp"
    }
}
