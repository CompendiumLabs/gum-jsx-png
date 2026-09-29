import assert from 'node:assert/strict'
import { decode, encode } from 'fast-png'
import { draw_rect, draw_path, draw_ellipse, draw_image, draw_text,
  make_fragment, place_fragment, LayoutPass, Text, px } from '@gum-jsx/core'
import type { Drawing, Fragment, Paint, PathCommand } from '@gum-jsx/core'
import { createMathFonts, mathToElement } from '@gum-jsx/math'
import { render_png, render_pixels } from '../src/render'
import type { RasterPixels } from '../src/render'

const style: Paint = { fill: 'red', stroke: 'none', stroke_width: 0 }
const rect = (x: number, y: number, width: number, height: number, paint: Partial<Paint> = {}) =>
  draw_rect({ x, y, width, height }, { ...style, ...paint })
const scene = (draw: readonly Drawing[], width = 8, height = 4, children: Fragment['children'] = []) =>
  make_fragment({ size: { width, height }, draw, children })
const pixel = (image: RasterPixels, x: number, y: number) =>
  [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x + 1) * 4)]
const basic = scene([rect(0, 0, 4, 4)])
const pixels = render_pixels(basic)
assert.deepEqual(pixel(pixels, 0, 0), [255, 0, 0, 255])
assert.deepEqual(pixel(pixels, 7, 0), [0, 0, 0, 0])
for (const encoding of ['fast', 'standard'] as const) {
  const png = decode(render_png(basic, { encoding }), { checkCrc: true })
  assert.equal(png.width, 8); assert.equal(png.height, 4)
  assert.deepEqual([...png.data], [...pixels.data])
}
assert.deepEqual(render_png(basic), render_png(basic))
assert.deepEqual(pixel(render_pixels(basic, { background: 'blue' }), 7, 0), [0, 0, 255, 255])
assert.deepEqual(pixel(render_pixels(scene([rect(0, 0, 8, 4, { fill: '#00ff0080' })])), 2, 2), [0, 255, 0, 128])
console.log('ok - direct fragment PNG and RGBA, encoding, straight alpha, and backgrounds')

const crop = render_pixels(basic, { select: { x: 3, y: 1, width: 2, height: 2 }, ratio: 2 })
assert.equal(crop.width, 4); assert.equal(crop.height, 4)
assert.deepEqual(pixel(crop, 1, 0), [255, 0, 0, 255])
assert.deepEqual(pixel(crop, 2, 0), [0, 0, 0, 0])
const padded = render_pixels(scene([rect(-10, -10, 30, 30)]), {
  select: { x: -1, y: -1, width: 2, height: 2 }, background: 'blue',
})
assert.deepEqual(pixel(padded, 0, 0), [0, 0, 255, 255])
assert.deepEqual(pixel(padded, 1, 1), [255, 0, 0, 255])
const fractional = render_pixels(scene([rect(0, 0, 0.5, 2)], 1.25, 2.25), { ratio: 2 })
assert.equal(fractional.width, 3); assert.equal(fractional.height, 5)
assert.deepEqual(pixel(fractional, 0, 0), [255, 0, 0, 255])
assert.deepEqual(pixel(fractional, 1, 0), [0, 0, 0, 0])
console.log('ok - crops, viewport clipping, and fractional sampling without stretching')

const grouped = render_pixels(scene([rect(3, 3, 6, 6, {
  fill: 'red', stroke: 'blue', stroke_width: 4, opacity: 0.5,
})], 12, 12))
assert.deepEqual(pixel(grouped, 6, 6), [255, 0, 0, 128])
assert.deepEqual(pixel(grouped, 4, 6), [0, 0, 255, 128])
assert.deepEqual(pixel(grouped, 1, 6), [0, 0, 255, 128])
const mixed = render_pixels(scene([rect(3, 3, 6, 6, {
  fill: 'rgba(255,0,0,.4)', stroke: 'rgba(0,0,255,.6)', stroke_width: 4, opacity: 0.5,
})], 12, 12))
assert.ok(Math.abs(pixel(mixed, 4, 6)[3]! - 97) <= 1)
console.log('ok - opacity composites fill and stroke together')

const ring: PathCommand[] = [
  { kind: 'M', x: 0, y: 0 }, { kind: 'L', x: 8, y: 0 }, { kind: 'L', x: 8, y: 8 }, { kind: 'L', x: 0, y: 8 }, { kind: 'Z' },
  { kind: 'M', x: 2, y: 2 }, { kind: 'L', x: 2, y: 6 }, { kind: 'L', x: 6, y: 6 }, { kind: 'L', x: 6, y: 2 }, { kind: 'Z' },
]
const clipped = make_fragment({ ...scene([rect(-5, -5, 20, 20)], 8, 8),
  clip: { x: 1, y: 0, width: 7, height: 8 }, clip_path: ring })
const clips = render_pixels(scene([], 18, 8, [place_fragment(clipped), place_fragment(scene([rect(0, 0, 8, 8)], 8, 8), [10, 0])]))
assert.deepEqual(pixel(clips, 0, 1), [0, 0, 0, 0])
assert.deepEqual(pixel(clips, 1, 1), [255, 0, 0, 255])
assert.deepEqual(pixel(clips, 3, 3), [0, 0, 0, 0])
assert.deepEqual(pixel(clips, 13, 3), [255, 0, 0, 255])
const nested = make_fragment({ ...scene([], 8, 8, [place_fragment(clipped)]),
  clip: { x: 0, y: 0, width: 8, height: 4, radius: { x: 1, y: 1 } } })
assert.equal(pixel(render_pixels(nested), 1, 6)[3], 0)
const mirrored = render_pixels(scene([], 10, 8, [place_fragment(basic, [9, 0], [-2, 0, 0, 2, 0, 0])]))
assert.deepEqual(pixel(mirrored, 1, 3), [255, 0, 0, 255])
assert.deepEqual(pixel(mirrored, 0, 3), [0, 0, 0, 0])
const invisible = make_fragment({ ...basic, clip_path: [] })
assert.ok(render_pixels(invisible).data.every(value => value === 0))
assert.ok(render_pixels(scene([], 8, 4, [place_fragment(basic, [0, 0], [0, 0, 0, 1, 0, 0])])).data.every(value => value === 0))
console.log('ok - nonzero clip holes, nested masks, sibling restoration, transforms, and empty geometry')

const line: PathCommand[] = [{ kind: 'M', x: 1, y: 4 }, { kind: 'L', x: 23, y: 4 }]
const stroke = (dash: readonly number[]) => scene([draw_path(line,
  { ...style, fill: 'none', stroke: 'red', stroke_width: 2, stroke_dasharray: dash })], 24, 8)
assert.deepEqual(render_pixels(stroke([3, 2, 1])).data, render_pixels(stroke([3, 2, 1, 3, 2, 1])).data)
assert.deepEqual(render_pixels(stroke([0, 0])).data, render_pixels(stroke([])).data)
assert.deepEqual(pixel(render_pixels(stroke([3, 2])), 2, 4), [255, 0, 0, 255])
assert.deepEqual(pixel(render_pixels(stroke([3, 2])), 5, 4), [0, 0, 0, 0])
const curves = scene([
  draw_ellipse([4, 4], [3, 2], style),
  draw_rect({ x: 9, y: 1, width: 6, height: 6 }, style, { x: 2, y: 2 }),
  draw_path([{ kind: 'M', x: 1, y: 12 }, { kind: 'Q', x1: 7, y1: 4, x: 9, y: 12 },
    { kind: 'C', x1: 12, y1: 18, x2: 12, y2: 5, x: 15, y: 12 }],
    { ...style, fill: 'none', stroke: 'blue', stroke_width: 2, stroke_linecap: 'round' }),
], 16, 16)
assert.deepEqual(pixel(render_pixels(curves), 4, 4), [255, 0, 0, 255])
assert.ok(pixel(render_pixels(curves), 9, 1)[3]! < 255)
assert.ok(render_pixels(curves).data.some((value, index) => index % 4 === 3 && value > 0 && value < 255))
console.log('ok - ellipses, rounded rectangles, curves, antialiasing, and dash normalization')

const image_bytes = encode({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]) })
const data = `data:image/png;base64,${Buffer.from(image_bytes).toString('base64')}`
const image = scene([draw_image({ x: 1, y: 1, width: 2, height: 1 }, data)], 4, 3)
assert.deepEqual(pixel(render_pixels(image), 1, 1), [255, 0, 0, 255])
assert.deepEqual(pixel(render_pixels(image), 2, 1), [0, 255, 0, 128])
const faded = scene([draw_image({ x: 0, y: 0, width: 2, height: 1 }, data, 0.5)], 2, 1)
assert.equal(pixel(render_pixels(faded), 0, 0)[3], 128)
const sixteen = encode({ width: 2, height: 1, depth: 16,
  data: new Uint16Array([65535, 0, 0, 65535, 0, 65535, 0, 32768]) })
assert.deepEqual(pixel(render_pixels(scene([draw_image({ x: 0, y: 0, width: 2, height: 1 },
  `data:image/png;base64,${Buffer.from(sixteen).toString('base64')}`)], 2, 1)), 1, 0), [0, 255, 0, 128])
const indexed = encode({ width: 3, height: 2, channels: 1, depth: 1,
  data: new Uint8Array([0xa0, 0x40]), palette: [[255, 0, 0, 0], [0, 0, 255, 255]] })
const indexed_pixels = render_pixels(scene([draw_image({ x: 0, y: 0, width: 3, height: 2 },
  `data:image/png;base64,${Buffer.from(indexed).toString('base64')}`)], 3, 2))
assert.deepEqual(pixel(indexed_pixels, 0, 0), [0, 0, 255, 255])
assert.deepEqual(pixel(indexed_pixels, 1, 0), [0, 0, 0, 0])
assert.deepEqual(pixel(indexed_pixels, 1, 1), [0, 0, 255, 255])
const adam7 = encode({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]) }, { interlace: 'Adam7' })
const interlaced = render_pixels(scene([draw_image({ x: 0, y: 0, width: 2, height: 1 },
  `data:image/png;base64,${Buffer.from(adam7).toString('base64')}`)], 2, 1))
assert.deepEqual(pixel(interlaced, 1, 0), [0, 255, 0, 255])
// A fixed one-pixel RGB image with a transparency key exercises the Rust
// decoder independently of fast-png (which rejects this otherwise valid PNG).
const keyed = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAABnRSTlMA/wAAAACkwsAdAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
assert.deepEqual(pixel(render_pixels(scene([draw_image({ x: 0, y: 0, width: 1, height: 1 },
  `data:image/png;base64,${keyed}`)], 1, 1)), 0, 0), [0, 0, 0, 0])
console.log('ok - embedded PNG alpha, palette, Adam7, transparency keys, and 16-bit normalization')

const text = new LayoutPass().layout(new Text({ children: 'Hello, tiny-skia! AV office Ω', font_size: px(20) }))
const fonts = createMathFonts()
const formula = new LayoutPass({ fonts: { value: fonts, version: fonts.version } })
  .layout(mathToElement(String.raw`\int_0^\infty e^{-x^2}\,dx=\frac{\sqrt{\pi}}{2}`, { font_size: px(24) }))
for (const fragment of [text, formula]) {
  const image = render_pixels(fragment, { ratio: 2 })
  assert.ok(image.data.some((value, index) => index % 4 === 3 && value > 0))
  assert.ok(render_png(fragment).length > 200)
}
const live = draw_text('hello', [0, 10], 20, { family: 'sans-serif', size: 12 }, { fill: 'black' }, null)
assert.throws(() => render_png(scene([], 8, 4, [place_fragment(scene([live]))])), /cannot draw live text/)
assert.throws(() => render_png(scene([live])), /cannot draw live text.*sans-serif/)
console.log('ok - ordinary text and math outlines; descriptive live-text errors')

for (const ratio of [0, -1, NaN, Infinity]) assert.throws(() => render_png(basic, { ratio }), /ratio/)
assert.throws(() => render_png(basic, { ratio: 10000 }), /16777216/)
assert.throws(() => render_png(basic, { encoding: 'bad' as any }), /encoding/)
assert.throws(() => render_png(basic, { background: 'var(--ink)' }), /Unsupported PNG color/)
assert.throws(() => render_png(basic, { select: { x: Infinity, y: 0, width: 1, height: 1 } }), /Selection/)
assert.throws(() => render_png(scene([], 0, 1)), /width/)
assert.throws(() => render_png(scene([draw_image({ x: 0, y: 0, width: 1, height: 1 },
  'data:image/png;base64,' + Buffer.alloc(30).toString('base64'))])), /PNG/)
const saved = render_pixels(basic), snapshot = saved.data.slice()
for (let i = 0; i < 20; i++) render_png(curves, { ratio: 3 })
assert.deepEqual(saved.data, snapshot)
assert.deepEqual(render_pixels(basic).data, pixels.data)
console.log('ok - validation, error recovery, and output ownership across repeated renders')
