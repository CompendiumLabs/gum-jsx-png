import type { Drawing, Fragment, PathCommand, Transform } from '@gum-jsx/core'
import { parse_color } from './color'
import type { Color } from './color'
import { rect_path, ellipse_path } from './paths'
import { render_commands } from './wasm'

type PngEncoding = 'fast' | 'standard'
type RasterSelection = Readonly<{ x: number; y: number; width: number; height: number }>
type FragmentRasterOptions = Readonly<{
  ratio?: number
  select?: RasterSelection
  background?: string
  encoding?: PngEncoding
}>
type RasterPixels = Readonly<{ width: number; height: number; data: Uint8ClampedArray }>
const IDENTITY: Transform = [1, 0, 0, 1, 0, 0]
const MAX_PIXELS = 16_777_216

function multiply(left: Transform, right: Transform): Transform {
  const [a, b, c, d, e, f] = left, [g, h, i, j, k, l] = right
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j,
    a * k + c * l + e, b * k + d * l + f]
}

// Binary protocol v1: header, path/image definitions, draw/clip operations, end.
// Paths are sent once per identity, including outlines shared by glyph drawings.
class Commands {
  private data = new Uint8Array(4096)
  private view = new DataView(this.data.buffer)
  private length = 0
  private reserve(length: number): void {
    if (this.length + length <= this.data.length) return
    const data = new Uint8Array(Math.max(this.length + length, this.data.length * 2))
    data.set(this.data)
    this.data = data
    this.view = new DataView(data.buffer)
  }
  byte(value: number): void { this.reserve(1); this.data[this.length++] = value }
  uint(value: number): void { this.reserve(4); this.view.setUint32(this.length, value, true); this.length += 4 }
  float(value: number): void {
    if (!Number.isFinite(Math.fround(value))) throw new RangeError('Drawing values must fit finite float32 coordinates')
    this.reserve(4); this.view.setFloat32(this.length, value, true); this.length += 4
  }
  floats(values: readonly number[]): void { for (const value of values) this.float(value) }
  bytes(bytes: Uint8Array): void { this.reserve(bytes.length); this.data.set(bytes, this.length); this.length += bytes.length }
  finish(): Uint8Array { this.byte(0); return this.data.subarray(0, this.length) }
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite`)
  return value
}

function validate_selection(select: RasterSelection): void {
  if (!Number.isFinite(select.x) || !Number.isFinite(select.y)) {
    throw new RangeError('Selection x and y must be finite')
  }
  if (!Number.isFinite(select.width) || select.width <= 0
    || !Number.isFinite(select.height) || select.height <= 0) {
    throw new RangeError('Selection width and height must be positive and finite')
  }
}

function prepare(fragment: Fragment, options: FragmentRasterOptions): { commands: Uint8Array; width: number; height: number } {
  const ratio = positive(options.ratio ?? 1, 'ratio'), select = options.select
  positive(fragment.size.width, 'width'); positive(fragment.size.height, 'height')
  if (select) validate_selection(select)
  const width = Math.ceil((select?.width ?? fragment.size.width) * ratio)
  const height = Math.ceil((select?.height ?? fragment.size.height) * ratio)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height > MAX_PIXELS) {
    throw new RangeError(`Raster dimensions must be safe integers and at most ${MAX_PIXELS} pixels`)
  }
  const commands = new Commands(), paths = new WeakMap<object, number>()
  const shapes = new WeakMap<Drawing, readonly PathCommand[]>()
  const images = new Map<string, { id: number; width: number; height: number }>()
  const colors = new Map<string, Color>()
  let path_count = 0
  commands.uint(0x47504e47); commands.uint(1); commands.uint(width); commands.uint(height)
  const color = (source: string): Color => {
    if (!colors.has(source)) colors.set(source, parse_color(source) ?? [0, 0, 0, 0])
    return colors.get(source)!
  }
  function path_id(path: readonly PathCommand[]): number {
    const cached = paths.get(path)
    if (cached !== undefined) return cached
    const id = path_count++
    paths.set(path, id)
    commands.byte(1); commands.uint(path.length)
    for (const [index, command] of path.entries()) {
      if (index === 0 && command.kind !== 'M') throw new TypeError('A path must begin with move_to')
      switch (command.kind) {
        case 'M': case 'L': commands.byte(command.kind === 'M' ? 0 : 1); commands.floats([command.x, command.y]); break
        case 'Q': commands.byte(2); commands.floats([command.x1, command.y1, command.x, command.y]); break
        case 'C': commands.byte(3); commands.floats([command.x1, command.y1, command.x2, command.y2, command.x, command.y]); break
        case 'Z': commands.byte(4); break
        default: throw new TypeError('Unknown path command')
      }
    }
    return id
  }
  function clip(path: readonly PathCommand[], transform: Transform): void {
    const id = path_id(path)
    commands.byte(3); commands.uint(id); commands.floats(transform)
  }
  function draw(draw: Drawing, transform: Transform): void {
    const opacity = draw.opacity ?? 1
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError('opacity must be between 0 and 1')
    if (opacity === 0) return
    if (draw.kind === 'text') {
      throw new TypeError(`PNG fragment output cannot draw live text in ${draw.font_family}: "${draw.text}". Use outlined text, or export SVG for emoji and text without outlines.`)
    }
    if (draw.kind === 'image') {
      if (!draw.rect.width || !draw.rect.height) return
      let image = images.get(draw.data)
      if (!image) {
        if (!draw.data.startsWith('data:image/png;base64,')) throw new TypeError('Fragment images require a base64 PNG data URL')
        const bytes = Uint8Array.from(atob(draw.data.slice(22)), char => char.charCodeAt(0))
        if (bytes.length < 24) throw new TypeError('Invalid embedded PNG')
        const view = new DataView(bytes.buffer)
        image = { id: images.size, width: view.getUint32(16), height: view.getUint32(20) }
        if (!image.width || !image.height || image.width * image.height > MAX_PIXELS) throw new RangeError('Embedded PNG dimensions exceed the raster limit')
        images.set(draw.data, image)
        commands.byte(5); commands.uint(bytes.length); commands.bytes(bytes)
      }
      const { x, y, width, height } = draw.rect
      commands.byte(6); commands.uint(image.id)
      commands.floats(multiply(transform, [width / image.width, 0, 0, height / image.height, x, y]))
      commands.float(opacity)
      return
    }
    let path = shapes.get(draw)
    if (!path) {
      switch (draw.kind) {
        case 'rect':
          if (!draw.rect.width || !draw.rect.height) return
          path = rect_path(draw.rect, draw.radius); break
        case 'ellipse':
          if (!draw.radius.x || !draw.radius.y) return
          path = ellipse_path(draw.center, draw.radius); break
        case 'path': path = draw.commands; break
        default: throw new TypeError('Unknown drawing kind')
      }
      shapes.set(draw, path)
    }
    const fill = color(draw.fill), stroke = color(draw.stroke)
    if (fill[3] === 0 && (stroke[3] === 0 || draw.stroke_width === 0)) return
    const id = path_id(path)
    const cap = { butt: 0, round: 1, square: 2 }[draw.stroke_linecap ?? 'butt']
    const join = { miter: 0, round: 1, bevel: 2 }[draw.stroke_linejoin ?? 'miter']
    if (cap === undefined || join === undefined) throw new TypeError('Unknown stroke cap or join')
    let dash = draw.stroke_dasharray ?? []
    if (dash.some(value => !Number.isFinite(value) || value < 0)) throw new RangeError('Dash lengths must be nonnegative and finite')
    if (!dash.some(value => value > 0)) dash = []
    else if (dash.length % 2) dash = [...dash, ...dash]
    commands.byte(2); commands.uint(id); commands.floats(transform)
    commands.floats(fill); commands.floats(stroke)
    commands.floats([opacity, draw.stroke_width, draw.stroke_miterlimit ?? 4])
    commands.byte(cap); commands.byte(join); commands.uint(dash.length); commands.floats(dash)
  }
  function visit(node: Fragment, transform: Transform): void {
    if (node.clip && (!node.clip.width || !node.clip.height) || node.clip_path?.length === 0) return
    if (node.clip) clip(rect_path(node.clip, node.clip.radius), transform)
    if (node.clip_path) clip(node.clip_path, transform)
    for (const drawing of node.draw) draw(drawing, transform)
    for (const child of node.children) {
      const [a, b, c, d, e, f] = child.transform ?? IDENTITY
      if (a * d - b * c === 0) continue
      visit(child.fragment, multiply(transform, [a, b, c, d, e + child.offset.x, f + child.offset.y]))
    }
    if (node.clip_path) commands.byte(4)
    if (node.clip) commands.byte(4)
  }
  if (options.background !== undefined) draw({ kind: 'rect', rect: { x: 0, y: 0, width, height },
    fill: options.background, stroke: 'none', stroke_width: 0 }, IDENTITY)
  const transform: Transform = [ratio, 0, 0, ratio, -(select?.x ?? 0) * ratio, -(select?.y ?? 0) * ratio]
  // Source overflow is clipped to its viewport, including when selecting a
  // region outside it. Pixel rounding adds a partial last pixel, never stretches.
  clip(rect_path({ x: 0, y: 0, ...fragment.size }), transform)
  visit(fragment, transform)
  commands.byte(4)
  return { commands: commands.finish(), width, height }
}

/** Rasterize a completed fragment, including outlined text, directly to PNG. */
function render_png(fragment: Fragment, options: FragmentRasterOptions = {}): Uint8Array {
  const encoding = options.encoding ?? 'fast'
  if (encoding !== 'fast' && encoding !== 'standard') throw new TypeError('PNG encoding must be fast or standard')
  const { commands } = prepare(fragment, options)
  return render_commands(commands, encoding === 'fast' ? 1 : 2)
}

/** Straight-alpha RGBA bytes owned by the caller; later renders cannot mutate them. */
function render_pixels(fragment: Fragment, options: FragmentRasterOptions = {}): RasterPixels {
  const { commands, width, height } = prepare(fragment, options)
  const bytes = render_commands(commands, 0)
  return { width, height, data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
}

export { render_png, render_pixels }
export type { FragmentRasterOptions, RasterPixels, PngEncoding, RasterSelection }
