use std::{io::Write, path::Path};

use encoding_rs::{Encoding, SHIFT_JIS, UTF_8, UTF_16BE, UTF_16LE};
use pdf_oxide::PdfDocument;
use tempfile::NamedTempFile;
use thiserror::Error;

#[derive(Debug, Error)]
pub(crate) enum FileImportError {
    #[error("unsupported file type")]
    UnsupportedFileType,
    #[error("text file encoding is not supported")]
    InvalidEncoding,
    #[error("PDF text could not be extracted")]
    InvalidPdf,
    #[error("file contains no readable text")]
    EmptyBody,
    #[error("temporary PDF processing failed: {0}")]
    Io(#[from] std::io::Error),
}

pub(crate) fn import_file(file_name: &str, bytes: &[u8]) -> Result<String, FileImportError> {
    if bytes.is_empty() {
        return Err(FileImportError::EmptyBody);
    }

    let extension = Path::new(file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default();

    let body = if extension.eq_ignore_ascii_case("pdf") {
        extract_pdf(bytes)?
    } else if extension.eq_ignore_ascii_case("md")
        || extension.eq_ignore_ascii_case("markdown")
        || extension.eq_ignore_ascii_case("txt")
    {
        decode_text(bytes)?
    } else {
        return Err(FileImportError::UnsupportedFileType);
    };

    if body.trim().is_empty() {
        return Err(FileImportError::EmptyBody);
    }

    Ok(body)
}

fn decode_text(bytes: &[u8]) -> Result<String, FileImportError> {
    let (encoding, bom_length) = Encoding::for_bom(bytes).unwrap_or((UTF_8, 0));
    let text_bytes = &bytes[bom_length..];
    let has_bom = bom_length != 0;
    let is_utf16 = encoding == UTF_16LE || encoding == UTF_16BE;
    if !is_utf16 && text_bytes.contains(&0) {
        return Err(FileImportError::InvalidEncoding);
    }
    let text = encoding
        .decode_without_bom_handling_and_without_replacement(text_bytes)
        .or_else(|| {
            (encoding == UTF_8 && !has_bom)
                .then(|| SHIFT_JIS.decode_without_bom_handling_and_without_replacement(bytes))
                .flatten()
        })
        .ok_or(FileImportError::InvalidEncoding)?;

    Ok(text.into_owned())
}

fn extract_pdf(bytes: &[u8]) -> Result<String, FileImportError> {
    if !bytes.starts_with(b"%PDF-") {
        return Err(FileImportError::InvalidPdf);
    }

    let mut temporary_file = NamedTempFile::new()?;
    temporary_file.write_all(bytes)?;

    let document =
        PdfDocument::open(temporary_file.path()).map_err(|_| FileImportError::InvalidPdf)?;
    let mut pages = Vec::new();

    for page_index in document.page_indices() {
        let text = document
            .extract_text(page_index)
            .map_err(|_| FileImportError::InvalidPdf)?;
        if !text.trim().is_empty() {
            pages.push(text.trim().to_owned());
        }
    }

    let body = pages.join(&"\n".repeat(2));
    if body.is_empty() {
        return Err(FileImportError::EmptyBody);
    }

    Ok(body)
}

#[cfg(test)]
mod tests {
    use indoc::indoc;
    use rstest::rstest;

    use super::import_file;

    fn assert_imported_file(file_name: &str, bytes: &[u8], expected: &str) {
        assert_eq!(
            import_file(file_name, bytes).map_err(|error| error.to_string()),
            Ok(expected.to_owned())
        );
    }

    #[test]
    fn imports_utf8_markdown_without_modifying_the_body() {
        let expected = indoc! {"
            # 仮の見出し

            本文です。
        "};
        assert_imported_file("research.md", expected.as_bytes(), expected);
    }

    #[test]
    fn imports_shift_jis_text() {
        let bytes = [0x8e, 0x91, 0x97, 0xbf, 0x82, 0xcc, 0x95, 0xb6, 0x8f, 0xcd];

        assert_imported_file("research.txt", &bytes, "資料の文章");
    }

    #[rstest]
    #[case::utf8_bom(&[0xef, 0xbb, 0xbf, 0xe8, 0xb3, 0x87, 0xe6, 0x96, 0x99, 0xe3, 0x81, 0xae, 0xe6, 0x96, 0x87, 0xe7, 0xab, 0xa0])]
    #[case::utf16_little_endian(&[0xff, 0xfe, 0xc7, 0x8c, 0x99, 0x65, 0x6e, 0x30, 0x87, 0x65, 0xe0, 0x7a])]
    #[case::utf16_big_endian(&[0xfe, 0xff, 0x8c, 0xc7, 0x65, 0x99, 0x30, 0x6e, 0x65, 0x87, 0x7a, 0xe0])]
    fn imports_text_with_a_bom(#[case] bytes: &[u8]) {
        assert_imported_file("research.txt", bytes, "資料の文章");
    }

    #[test]
    fn extracts_japanese_text_from_a_pdf_with_a_predefined_cmap() {
        let bytes = include_bytes!("../../tests/fixtures/japanese-rksj.pdf");
        assert_imported_file("research.pdf", bytes, "日本語の本文を抽出します。");
    }

    #[rstest]
    #[case::unsupported_extension("research.docx", b"document", "unsupported file type")]
    #[case::truncated_shift_jis("research.txt", &[0x82], "text file encoding is not supported")]
    #[case::empty_text("research.txt", b"", "file contains no readable text")]
    #[case::whitespace_only_text("research.txt", b" \t", "file contains no readable text")]
    #[case::malformed_pdf("research.pdf", b"not a PDF", "PDF text could not be extracted")]
    fn rejects_files_that_cannot_be_imported(
        #[case] file_name: &str,
        #[case] bytes: &[u8],
        #[case] expected: &str,
    ) {
        let actual = import_file(file_name, bytes).map_err(|error| error.to_string());
        assert_eq!(actual, Err(expected.to_owned()));
    }
}
