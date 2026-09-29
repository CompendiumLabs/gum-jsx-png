// Gum's small, batched drawing protocol is implemented here. The compiled
// module has no host imports; Rust is needed only when rebuilding the package.
use tiny_skia::{
    Color, FillRule, FilterQuality, LineCap, LineJoin, Mask, Paint, Path, PathBuilder, Pixmap,
    PixmapPaint, Stroke, StrokeDash, Transform,
};

const MAX_PIXELS: u64 = 16_777_216;
type Result<T> = std::result::Result<T, String>;

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or("Invalid drawing length")?;
        let bytes = self
            .bytes
            .get(self.offset..end)
            .ok_or("Truncated drawing commands")?;
        self.offset = end;
        Ok(bytes)
    }
    fn byte(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn uint(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn float(&mut self) -> Result<f32> {
        let value = f32::from_le_bytes(self.take(4)?.try_into().unwrap());
        if !value.is_finite() {
            return Err("Nonfinite drawing coordinate".into());
        }
        Ok(value)
    }
    fn transform(&mut self) -> Result<Transform> {
        Ok(Transform::from_row(
            self.float()?,
            self.float()?,
            self.float()?,
            self.float()?,
            self.float()?,
            self.float()?,
        ))
    }
    fn color(&mut self) -> Result<Color> {
        Color::from_rgba(self.float()?, self.float()?, self.float()?, self.float()?)
            .ok_or_else(|| "Invalid drawing color".into())
    }
    fn path(&mut self) -> Result<Option<Path>> {
        let count = self.uint()?;
        let mut path = PathBuilder::new();
        for index in 0..count {
            let command = self.byte()?;
            if index == 0 && command != 0 {
                return Err("Path must begin with a move".into());
            }
            match command {
                0 => path.move_to(self.float()?, self.float()?),
                1 => path.line_to(self.float()?, self.float()?),
                2 => path.quad_to(self.float()?, self.float()?, self.float()?, self.float()?),
                3 => path.cubic_to(
                    self.float()?,
                    self.float()?,
                    self.float()?,
                    self.float()?,
                    self.float()?,
                    self.float()?,
                ),
                4 => path.close(),
                _ => return Err("Unknown path command".into()),
            }
        }
        Ok(path.finish())
    }
}

fn dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("Raster dimensions must be positive and at most 16777216 pixels".into());
    }
    Ok(())
}

fn paint(color: Color, opacity: f32) -> Paint<'static> {
    let mut color = color;
    color.set_alpha(color.alpha() * opacity);
    let mut paint = Paint::default();
    paint.set_color(color);
    paint
}

fn render(bytes: &[u8], format: u32) -> Result<Vec<u8>> {
    let mut input = Reader { bytes, offset: 0 };
    if input.uint()? != 0x47504e47 || input.uint()? != 1 {
        return Err("Unsupported Gum drawing protocol".into());
    }
    let width = input.uint()?;
    let height = input.uint()?;
    dimensions(width, height)?;
    let mut output = Pixmap::new(width, height).ok_or("Cannot allocate raster")?;
    let mut paths: Vec<Option<Path>> = Vec::new();
    let mut images: Vec<Pixmap> = Vec::new();
    let mut clips: Vec<Mask> = Vec::new();
    loop {
        match input.byte()? {
            0 => break,
            1 => paths.push(input.path()?),
            2 => {
                let path = paths.get(input.uint()? as usize).ok_or("Unknown path")?;
                let transform = input.transform()?;
                let fill = input.color()?;
                let stroke_color = input.color()?;
                let opacity = input.float()?;
                let mut stroke = Stroke {
                    width: input.float()?,
                    miter_limit: input.float()?,
                    line_cap: match input.byte()? {
                        0 => LineCap::Butt,
                        1 => LineCap::Round,
                        2 => LineCap::Square,
                        _ => return Err("Invalid line cap".into()),
                    },
                    line_join: match input.byte()? {
                        0 => LineJoin::Miter,
                        1 => LineJoin::Round,
                        2 => LineJoin::Bevel,
                        _ => return Err("Invalid line join".into()),
                    },
                    ..Stroke::default()
                };
                let count = input.uint()?;
                let mut dash = Vec::new();
                for _ in 0..count {
                    dash.push(input.float()?);
                }
                if !dash.is_empty() {
                    stroke.dash = Some(StrokeDash::new(dash, 0.0).ok_or("Invalid dash pattern")?);
                }
                if !(0.0..=1.0).contains(&opacity) || stroke.width < 0.0 || stroke.miter_limit < 1.0
                {
                    return Err("Invalid drawing paint".into());
                }
                if let Some(path) = path {
                    let has_fill = fill.alpha() > 0.0;
                    let has_stroke = stroke_color.alpha() > 0.0 && stroke.width > 0.0;
                    let grouped = opacity < 1.0 && has_fill && has_stroke;
                    let draw = |target: &mut Pixmap, alpha, mask: Option<&Mask>| {
                        if has_fill {
                            target.fill_path(
                                path,
                                &paint(fill, alpha),
                                FillRule::Winding,
                                transform,
                                mask,
                            );
                        }
                        if has_stroke {
                            target.stroke_path(
                                path,
                                &paint(stroke_color, alpha),
                                &stroke,
                                transform,
                                mask,
                            );
                        }
                    };
                    if grouped {
                        // Opacity belongs to the combined fill and stroke. Applying it
                        // separately darkens their overlap. Clip the composite once.
                        let mut layer =
                            Pixmap::new(width, height).ok_or("Cannot allocate opacity layer")?;
                        draw(&mut layer, 1.0, None);
                        output.draw_pixmap(
                            0,
                            0,
                            layer.as_ref(),
                            &PixmapPaint {
                                opacity,
                                ..PixmapPaint::default()
                            },
                            Transform::identity(),
                            clips.last(),
                        );
                    } else {
                        draw(&mut output, opacity, clips.last());
                    }
                }
            }
            3 => {
                let path = paths
                    .get(input.uint()? as usize)
                    .ok_or("Unknown clip path")?;
                let transform = input.transform()?;
                if (clips.len() as u64 + 1) * u64::from(width) * u64::from(height) > 134_217_728 {
                    return Err("Nested clipping exceeds 128 MiB of masks".into());
                }
                let mut mask = if let Some(previous) = clips.last() {
                    previous.clone()
                } else {
                    Mask::new(width, height).ok_or("Cannot allocate clip mask")?
                };
                if let Some(path) = path {
                    if clips.is_empty() {
                        mask.fill_path(path, FillRule::Winding, true, transform);
                    } else {
                        mask.intersect_path(path, FillRule::Winding, true, transform);
                    }
                } else {
                    mask.clear();
                }
                clips.push(mask);
            }
            4 => {
                clips.pop().ok_or("Unbalanced clipping commands")?;
            }
            5 => {
                let len = input.uint()? as usize;
                let bytes = input.take(len)?;
                if bytes.len() < 24 || bytes[..8] != [137, 80, 78, 71, 13, 10, 26, 10] {
                    return Err("Invalid embedded PNG".into());
                }
                dimensions(
                    u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
                    u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
                )?;
                images.push(
                    Pixmap::decode_png(bytes)
                        .map_err(|err| format!("Invalid embedded PNG: {err}"))?,
                );
            }
            6 => {
                let image = images.get(input.uint()? as usize).ok_or("Unknown image")?;
                let transform = input.transform()?;
                let opacity = input.float()?;
                if !(0.0..=1.0).contains(&opacity) {
                    return Err("Invalid image opacity".into());
                }
                output.draw_pixmap(
                    0,
                    0,
                    image.as_ref(),
                    &PixmapPaint {
                        opacity,
                        quality: FilterQuality::Bilinear,
                        ..PixmapPaint::default()
                    },
                    transform,
                    clips.last(),
                );
            }
            _ => return Err("Unknown drawing command".into()),
        }
    }
    if !clips.is_empty() || input.offset != bytes.len() {
        return Err("Unbalanced drawing commands".into());
    }
    // The public API and PNG both use straight alpha. tiny-skia stores
    // premultiplied channels internally; never expose those as ordinary RGBA.
    let mut rgba = Vec::with_capacity(output.data().len());
    for pixel in output.pixels() {
        let color = pixel.demultiply();
        rgba.extend_from_slice(&[color.red(), color.green(), color.blue(), color.alpha()]);
    }
    if format == 0 {
        return Ok(rgba);
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(match format {
            1 => png::Compression::Fast,
            2 => png::Compression::Balanced,
            _ => return Err("Unknown PNG encoding".into()),
        });
        let mut writer = encoder.write_header().map_err(|err| err.to_string())?;
        writer
            .write_image_data(&rgba)
            .map_err(|err| err.to_string())?;
    }
    Ok(bytes)
}

// This private ABI uses only owned buffers and opaque result handles. The TS
// wrapper copies outputs and frees both allocations in a finally block.
pub struct Output {
    bytes: Vec<u8>,
    error: bool,
}

#[no_mangle]
pub extern "C" fn gum_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}
#[no_mangle]
pub unsafe extern "C" fn gum_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}
#[no_mangle]
pub unsafe extern "C" fn gum_render(ptr: *const u8, len: usize, format: u32) -> *mut Output {
    let result = render(std::slice::from_raw_parts(ptr, len), format);
    Box::into_raw(Box::new(match result {
        Ok(bytes) => Output {
            bytes,
            error: false,
        },
        Err(error) => Output {
            bytes: error.into_bytes(),
            error: true,
        },
    }))
}
#[no_mangle]
pub unsafe extern "C" fn gum_output_ptr(output: *const Output) -> *const u8 {
    (*output).bytes.as_ptr()
}
#[no_mangle]
pub unsafe extern "C" fn gum_output_len(output: *const Output) -> usize {
    (*output).bytes.len()
}
#[no_mangle]
pub unsafe extern "C" fn gum_output_error(output: *const Output) -> u32 {
    (*output).error as u32
}
#[no_mangle]
pub unsafe extern "C" fn gum_output_free(output: *mut Output) {
    drop(Box::from_raw(output));
}
