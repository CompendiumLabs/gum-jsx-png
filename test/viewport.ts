import assert from 'node:assert/strict'
import { createCanvas, Image } from 'canvas'
import { rasterize_pixels, rasterize_svg } from '../src'
import type { RasterizeOptions } from '../src'
import { select_svg } from '../src/selection'

// Reference the old native loading/resizing sequence to detect sampling changes.
function native_raster(svg: string, options: RasterizeOptions) {
  const image = new Image()
  image.src = Buffer.from(svg)
  const viewport = options.size ?? { width: image.width, height: image.height }
  if (options.select) image.src = Buffer.from(select_svg(svg, options.select, viewport))
  const width = Math.ceil((options.select?.width ?? viewport.width) * (options.ratio ?? 1))
  const height = Math.ceil((options.select?.height ?? viewport.height) * (options.ratio ?? 1))
  const canvas = createCanvas(width, height), context = canvas.getContext('2d')
  if (options.background) { context.fillStyle = options.background; context.fillRect(0, 0, width, height) }
  image.width = width; image.height = height
  context.drawImage(image, 0, 0)
  return { canvas, pixels: context.getImageData(0, 0, width, height) }
}

const body = '<defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue" stop-opacity=".3"/></linearGradient></defs>'
  + '<rect width="50%" height="100%" fill="url(#g)"/><circle cx="6" cy="2" r="1.25" fill="green" opacity=".7"/>'
const fixtures = [
  'width="8" height="4" viewBox="0 0 8 4"',
  "height='4.25' viewBox='0,0,8.25,4.25' width='8.25' data-note='width=\"4\" > height=\"7\"'",
  'width="8px" height="4px" viewBox="-1 -2 12 7"',
  'width="8" height="4" viewBox="0 0 8 4" preserveAspectRatio="none"',
  'width="8" height="4" viewBox="0 0 12 7" preserveAspectRatio="xMaxYMin slice"',
  'width="8" height="4" viewBox="0 0 12 7" preserveAspectRatio="xMinYMax meet"',
  // Native fallbacks retain CSS sizing, implicit coordinates, and XML preambles.
  'width="8" height="4"',
  'width="8" height="4" viewBox="0 0 8 4" style="width:10px;height:6px"',
  'width="8" height="4" viewBox="not a viewBox"',
].map(attributes => `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`)
fixtures.push('<?xml version="1.0"?><!-- viewport -->' + fixtures[0],
  fixtures[0].replace(body, `<style>svg { width:10px; height:6px }</style>${body}`),
  fixtures[0].replace(body, '<svg x="1" y="1" width="50%" height="50%" viewBox="0 0 8 4">' + body + '</svg>'))
const configurations: RasterizeOptions[] = [
  {}, { ratio: 2 }, { ratio: 0.5 }, { ratio: 1.3 },
  { size: { width: 8.25, height: 4.25 }, ratio: 2 },
  { size: { width: 12, height: 12 }, background: 'navy' },
  { select: { x: 1, y: 0, width: 4, height: 3 }, ratio: 2 },
  { size: { width: 8.25, height: 4.25 }, select: { x: -1.25, y: .25, width: 3.25, height: 2.5 }, ratio: 3, background: 'white' },
]
for (const [index, svg] of fixtures.entries()) for (const options of configurations) {
  const expected = native_raster(svg, options).pixels
  const actual = rasterize_pixels(index % 2 ? Buffer.from(svg) : svg, options)
  assert.equal(actual.width, expected.width)
  assert.equal(actual.height, expected.height)
  assert.deepEqual(actual.data, expected.data, `fixture ${index}: ${JSON.stringify(options)}`)
}
console.log('ok - explicit SVG viewports and native fallbacks preserve every RGBA byte across sizing and crops')

// Loading at final dimensions avoids the native rasterizer's second paint.
const descriptor = Object.getOwnPropertyDescriptor(Image.prototype, 'src')!
const loads: { width: number; height: number }[] = []
Object.defineProperty(Image.prototype, 'src', { ...descriptor, set(value) {
  descriptor.set!.call(this, value)
  loads.push({ width: this.width, height: this.height })
} })
try {
  const size = { width: 8.25, height: 4.25 }
  rasterize_pixels(fixtures[1], { size, ratio: 2 })
  assert.deepEqual(loads.splice(0), [{ width: 17, height: 9 }])
  rasterize_pixels(fixtures[1], { size, select: { x: 1, y: 1, width: 2.25, height: 1.25 }, ratio: 3 })
  assert.deepEqual(loads.splice(0), [{ width: 7, height: 4 }])
} finally { Object.defineProperty(Image.prototype, 'src', descriptor) }
console.log('ok - sized SVG and crop sources load only once, at final raster dimensions')

const options = { size: { width: 32, height: 16 }, ratio: 2 }
const expected = native_raster(fixtures[0], options)
const fast = rasterize_svg(fixtures[0], { ...options, encoding: 'fast' })
const standard = rasterize_svg(fixtures[0], { ...options, encoding: 'standard' })
assert.deepEqual(rasterize_svg(fixtures[0], options), fast)
assert.deepEqual(standard, expected.canvas.toBuffer('image/png'))
assert.notDeepEqual(fast, standard)
for (const png of [fast, standard]) {
  const image = new Image(); image.src = png
  const canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  assert.deepEqual(context.getImageData(0, 0, image.width, image.height).data, expected.pixels.data)
}
assert.throws(() => rasterize_svg(fixtures[0], { encoding: 'invalid' as any }), /PNG encoding/)
console.log('ok - fast and standard PNG presets are lossless; fast is default and standard retains the previous encoding')
