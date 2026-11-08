use std::io::Cursor;

use image::{
    DynamicImage, ImageDecoder, ImageError, ImageFormat, ImageReader, Limits,
    codecs::webp::WebPDecoder,
};
use thiserror::Error;
use webp::{Encoder, PixelLayout};

use crate::local_file_sync::sha256_hex;

/// The largest dimension a WebP image can have.
const MAX_DIMENSION: u32 = 16_383;
/// Bounds the decoded buffers, which not every decoder counts against `Limits::max_alloc`.
const MAX_PIXELS: u64 = 40_000_000;
const WEBP_QUALITY: f32 = 80.0;

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ProcessedImage {
    pub name: String,
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(super) enum ImageProcessError {
    #[error("image format is not supported")]
    UnsupportedFormat,
    #[error("image dimensions exceed the limit")]
    TooLarge,
    #[error("image could not be decoded")]
    Undecodable,
    #[error("image could not be encoded")]
    Encoding,
}

/// Converts an uploaded image to the form the published article uses.
pub(super) fn process(bytes: &[u8]) -> Result<ProcessedImage, ImageProcessError> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| ImageProcessError::UnsupportedFormat)?;
    let format = reader.format();
    reader.limits(limits());

    match format {
        // Re-encoding would drop the animation.
        Some(ImageFormat::Gif) => {
            let (width, height) = reader.into_dimensions().map_err(decode_error)?;
            Ok(ProcessedImage {
                name: format!("{}.gif", sha256_hex(bytes)),
                data: bytes.to_vec(),
                width,
                height,
            })
        }
        // Re-encoding would silently keep only the first frame.
        Some(ImageFormat::WebP) if is_animated_webp(bytes) => {
            Err(ImageProcessError::UnsupportedFormat)
        }
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP) => to_webp(reader),
        _ => Err(ImageProcessError::UnsupportedFormat),
    }
}

fn limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits
}

fn is_animated_webp(bytes: &[u8]) -> bool {
    WebPDecoder::new(Cursor::new(bytes)).is_ok_and(|decoder| decoder.has_animation())
}

// Encoding from decoded pixels also removes EXIF data such as the shooting location.
fn to_webp(reader: ImageReader<Cursor<&[u8]>>) -> Result<ProcessedImage, ImageProcessError> {
    let mut decoder = reader.into_decoder().map_err(decode_error)?;
    let (encoded_width, encoded_height) = decoder.dimensions();
    if u64::from(encoded_width) * u64::from(encoded_height) > MAX_PIXELS {
        return Err(ImageProcessError::TooLarge);
    }
    let orientation = decoder.orientation().map_err(decode_error)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(decode_error)?;
    image.apply_orientation(orientation);

    let pixels = image.to_rgba8();
    let (width, height) = pixels.dimensions();
    let data = Encoder::new(pixels.as_raw(), PixelLayout::Rgba, width, height)
        .encode_simple(false, WEBP_QUALITY)
        .map_err(|_| ImageProcessError::Encoding)?
        .to_vec();

    Ok(ProcessedImage {
        name: format!("{}.webp", sha256_hex(&data)),
        data,
        width,
        height,
    })
}

fn decode_error(error: ImageError) -> ImageProcessError {
    match error {
        ImageError::Limits(_) => ImageProcessError::TooLarge,
        _ => ImageProcessError::Undecodable,
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{
        ExtendedColorType, ImageEncoder, ImageFormat, ImageReader, RgbaImage,
        codecs::jpeg::JpegEncoder,
    };
    use rstest::rstest;

    use super::{ImageProcessError, ProcessedImage, process};
    use crate::local_file_sync::sha256_hex;

    fn encoded(format: ImageFormat, width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        RgbaImage::new(width, height)
            .write_to(&mut bytes, format)
            .expect("test image should encode");
        bytes.into_inner()
    }

    /// EXIF block that sets orientation 6 (rotate 90 degrees clockwise).
    fn rotated_exif() -> Vec<u8> {
        let mut exif = b"MM\0\x2A\0\0\0\x08\0\x01".to_vec();
        exif.extend_from_slice(b"\x01\x12\0\x03\0\0\0\x01\0\x06\0\0\0\0\0\0");
        exif
    }

    fn rotated_jpeg() -> Vec<u8> {
        let mut bytes = Vec::new();
        let mut encoder = JpegEncoder::new(&mut bytes);
        encoder
            .set_exif_metadata(rotated_exif())
            .expect("JPEG should accept EXIF");
        encoder
            .write_image(&[0; 3 * 4 * 2], 4, 2, ExtendedColorType::Rgb8)
            .expect("test image should encode");
        bytes
    }

    fn chunk_size(bytes: &[u8]) -> [u8; 4] {
        u32::try_from(bytes.len())
            .expect("test chunk should fit in a RIFF size")
            .to_le_bytes()
    }

    /// One-frame WebP animation, wrapping a still image's bitstream in an ANMF chunk.
    fn animated_webp() -> Vec<u8> {
        let still = encoded(ImageFormat::WebP, 1, 1);
        let frame = [&[0; 16], &still[12..]].concat();
        let riff_body = [
            b"WEBPVP8X\x0A\0\0\0\x02\0\0\0\0\0\0\0\0\0ANIM\x06\0\0\0\0\0\0\0\0\0ANMF".as_slice(),
            &chunk_size(&frame),
            &frame,
        ]
        .concat();
        [b"RIFF".as_slice(), &chunk_size(&riff_body), &riff_body].concat()
    }

    fn webp_dimensions(data: &[u8]) -> (u32, u32) {
        let reader = ImageReader::with_format(Cursor::new(data), ImageFormat::WebP);
        reader
            .into_dimensions()
            .expect("output should be a WebP image")
    }

    #[rstest]
    #[case::png(encoded(ImageFormat::Png, 4, 2), (4, 2))]
    #[case::webp(encoded(ImageFormat::WebP, 4, 2), (4, 2))]
    #[case::exif_orientation_swaps_dimensions(rotated_jpeg(), (2, 4))]
    fn converts_still_images_to_webp(#[case] input: Vec<u8>, #[case] expected: (u32, u32)) {
        let actual = process(&input).expect("image should convert");

        assert_eq!(
            (
                actual.name.clone(),
                (actual.width, actual.height),
                webp_dimensions(&actual.data),
            ),
            (
                format!("{}.webp", sha256_hex(&actual.data)),
                expected,
                expected,
            ),
        );
    }

    #[test]
    fn keeps_gif_bytes_unchanged() {
        let input = encoded(ImageFormat::Gif, 4, 2);

        assert_eq!(
            process(&input),
            Ok(ProcessedImage {
                name: format!("{}.gif", sha256_hex(&input)),
                data: input.clone(),
                width: 4,
                height: 2,
            }),
        );
    }

    #[rstest]
    #[case::not_an_image(b"plain text".to_vec(), ImageProcessError::UnsupportedFormat)]
    #[case::unsupported_format(b"BM\0\0\0\0".to_vec(), ImageProcessError::UnsupportedFormat)]
    #[case::truncated_png(encoded(ImageFormat::Png, 4, 2)[..20].to_vec(), ImageProcessError::Undecodable)]
    #[case::too_wide(encoded(ImageFormat::Png, 16_384, 1), ImageProcessError::TooLarge)]
    #[case::too_many_pixels(encoded(ImageFormat::Png, 8_000, 5_001), ImageProcessError::TooLarge)]
    #[case::animated_webp(animated_webp(), ImageProcessError::UnsupportedFormat)]
    fn rejects_images_it_cannot_convert(
        #[case] input: Vec<u8>,
        #[case] expected: ImageProcessError,
    ) {
        assert_eq!(process(&input), Err(expected));
    }
}
