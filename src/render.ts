// Adapted from gum-org/gum-jsx-node's node-canvas rasterizer.
import { createCanvas, Image, Canvas } from 'canvas'
import type { CanvasRenderingContext2D, ImageData } from 'canvas'
import { select_svg, validate_selection } from './selection'
import type { RasterSelection, RasterSize } from './selection'
import { svg_viewport } from './viewport'

type PngEncoding = 'fast' | 'standard'
type RasterizeOptions = Readonly<{
  size?: RasterSize
  select?: RasterSelection
  ratio?: number
  background?: string
  /** Lossless PNG encoding; fast is level 3 without row filters. */
  encoding?: PngEncoding
}>
type Raster = { canvas: Canvas; context: CanvasRenderingContext2D }

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be positive and finite`)
  }
  return value
}

// The caller can supply the layout size to retain fractional viewport dimensions.
// Canvas reports an SVG image's intrinsic dimensions as whole pixels.
function draw_svg(svg: string | Buffer, options: RasterizeOptions = {}): Raster {
  const { size, select, background, ratio = 1 } = options
  positive(ratio, 'ratio')
  if (select) validate_selection(select)
  if (size) {
    positive(size.width, 'width')
    positive(size.height, 'height')
  }

  const image = new Image()
  const source = svg.toString()
  const explicit = svg_viewport(source)
  // Native loading rasterizes immediately. Resolve ordinary SVG dimensions from
  // the root so we can load directly at the final resolution instead of repainting.
  if (!explicit) image.src = Buffer.isBuffer(svg) ? svg : Buffer.from(svg)
  const viewport = size ?? (explicit
    ? { width: Math.trunc(explicit.width), height: Math.trunc(explicit.height) }
    : { width: image.width, height: image.height })
  const width = Math.ceil(positive((select?.width ?? viewport.width) * ratio, 'raster width'))
  const height = Math.ceil(positive((select?.height ?? viewport.height) * ratio, 'raster height'))
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new RangeError('Raster dimensions must be safe integers')
  }

  const selected = select ? select_svg(source, select, viewport) : source
  const output = select ? svg_viewport(selected) : explicit
  if (output) image.src = Buffer.from(output.resize(width, height))
  else if (select) image.src = Buffer.from(selected)

  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  if (background !== undefined) {
    context.fillStyle = background
    context.fillRect(0, 0, width, height)
  }

  // Resizing the SVG Image makes node-canvas render its paths at the final
  // resolution. Scaling only drawImage would enlarge an existing bitmap.
  image.width = width
  image.height = height
  context.drawImage(image, 0, 0)
  return { canvas, context }
}

function rasterize_svg(svg: string | Buffer, options: RasterizeOptions = {}): Buffer {
  const encoding = options.encoding ?? 'fast'
  if (encoding !== 'fast' && encoding !== 'standard') throw new TypeError('PNG encoding must be fast or standard')
  return draw_svg(svg, options).canvas.toBuffer('image/png', encoding === 'fast'
    ? { compressionLevel: 3, filters: Canvas.PNG_FILTER_NONE } : undefined)
}

function rasterize_pixels(svg: string | Buffer, options: RasterizeOptions = {}): ImageData {
  const { canvas, context } = draw_svg(svg, options)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

export { rasterize_svg, rasterize_pixels }
export type { PngEncoding, RasterizeOptions, RasterSize, RasterSelection }
