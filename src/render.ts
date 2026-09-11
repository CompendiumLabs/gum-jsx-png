// Adapted from gum-org/gum-jsx-node's node-canvas rasterizer.
import { createCanvas, Image } from 'canvas';
import type { Canvas, CanvasRenderingContext2D, ImageData } from 'canvas';

type RasterSize = Readonly<{ width: number; height: number }>;
type RasterizeOptions = Readonly<{
  size?: RasterSize;
  ratio?: number;
  background?: string;
}>;
type Raster = { canvas: Canvas; context: CanvasRenderingContext2D };

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be positive and finite`);
  }
  return value;
}

// The caller can supply the layout size to retain fractional viewport dimensions.
// Canvas reports an SVG image's intrinsic dimensions as whole pixels.
function draw_svg(svg: string | Buffer, options: RasterizeOptions = {}): Raster {
  const { size, background, ratio = 1 } = options;
  positive(ratio, 'ratio');
  if (size) {
    positive(size.width, 'width');
    positive(size.height, 'height');
  }

  const image = new Image();
  image.src = Buffer.isBuffer(svg) ? svg : Buffer.from(svg);
  const width = Math.ceil(positive((size?.width ?? image.width) * ratio, 'raster width'));
  const height = Math.ceil(positive((size?.height ?? image.height) * ratio, 'raster height'));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new RangeError('Raster dimensions must be safe integers');
  }

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  if (background !== undefined) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }

  // Resizing the SVG Image makes node-canvas render its paths at the final
  // resolution. Scaling only drawImage would enlarge an existing bitmap.
  image.width = width;
  image.height = height;
  context.drawImage(image, 0, 0);
  return { canvas, context };
}

function rasterize_svg(svg: string | Buffer, options: RasterizeOptions = {}): Buffer {
  return draw_svg(svg, options).canvas.toBuffer('image/png');
}

function rasterize_pixels(svg: string | Buffer, options: RasterizeOptions = {}): ImageData {
  const { canvas, context } = draw_svg(svg, options);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export { rasterize_svg, rasterize_pixels };
export type { RasterizeOptions, RasterSize };
