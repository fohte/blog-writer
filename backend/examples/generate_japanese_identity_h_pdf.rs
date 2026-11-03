//! Regenerates the Japanese Identity-H PDF fixture with the bundled fallback font.
//!
//! Run from `backend/` with `mise exec -- cargo run --example generate_japanese_identity_h_pdf`.

use std::{
    error::Error,
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};

use pdf_oxide::writer::{EmbeddedFont, PdfWriter};
use serde_json::Value;

const BODY: &str = "日本語の本文を抽出します。";

fn main() -> Result<(), Box<dyn Error>> {
    let backend_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let font_path = fallback_font_path(backend_dir)?;
    let font = EmbeddedFont::from_data(
        Some("DroidSansFallbackFull".to_owned()),
        fs::read(font_path)?,
    )
    .map_err(io::Error::other)?;
    let mut writer = PdfWriter::new();
    let font_resource = writer.register_embedded_font(font);
    writer
        .add_a4_page()
        .add_embedded_text(BODY, 72.0, 760.0, &font_resource, 14.0);

    let output_path = backend_dir.join("tests/fixtures/japanese-identity-h.pdf");
    fs::write(output_path, writer.finish()?)?;

    Ok(())
}

fn fallback_font_path(backend_dir: &Path) -> Result<PathBuf, Box<dyn Error>> {
    let metadata = Command::new("cargo")
        .args([
            "metadata",
            "--format-version",
            "1",
            "--locked",
            "--manifest-path",
        ])
        .arg(backend_dir.join("Cargo.toml"))
        .output()?;
    if !metadata.status.success() {
        return Err(
            io::Error::other(String::from_utf8_lossy(&metadata.stderr).into_owned()).into(),
        );
    }

    let metadata: Value = serde_json::from_slice(&metadata.stdout)?;
    let manifest_path = metadata
        .get("packages")
        .and_then(Value::as_array)
        .and_then(|packages| {
            packages
                .iter()
                .find(|package| package.get("name").and_then(Value::as_str) == Some("pdf_oxide"))
        })
        .and_then(|package| package.get("manifest_path"))
        .and_then(Value::as_str)
        .ok_or_else(|| io::Error::other("pdf_oxide manifest path was not found"))?;
    let crate_dir = Path::new(manifest_path)
        .parent()
        .ok_or_else(|| io::Error::other("pdf_oxide manifest directory was not found"))?;

    Ok(crate_dir.join("src/fonts/assets/DroidSansFallbackFull.ttf"))
}
