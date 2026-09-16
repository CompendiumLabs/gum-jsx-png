import assert from 'node:assert/strict'
import { createCanvas, Image } from 'canvas'
import { rasterize_svg, rasterize_pixels } from '../src/index'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4" viewBox="0 0 8 4">'
  + '<path d="M0 0H4V4H0Z" fill="red"/></svg>'

// PNG encoding and raw RGBA output share dimensions, paint, and transparency.
const png = rasterize_svg(svg)
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
assert.equal(png.readUInt32BE(16), 8)
assert.equal(png.readUInt32BE(20), 4)
const pixels = rasterize_pixels(Buffer.from(svg))
assert.equal(pixels.width, 8)
assert.equal(pixels.height, 4)
assert.deepEqual([...pixels.data.subarray(0, 4)], [255, 0, 0, 255])
assert.deepEqual([...pixels.data.subarray(28, 32)], [0, 0, 0, 0])
const decoded = new Image()
decoded.src = png
const canvas = createCanvas(8, 4)
canvas.getContext('2d').drawImage(decoded, 0, 0)
assert.deepEqual(canvas.getContext('2d').getImageData(0, 0, 8, 4).data, pixels.data)

const background = rasterize_pixels(svg, { background: '#0000ff' })
assert.deepEqual([...background.data.subarray(0, 4)], [255, 0, 0, 255])
assert.deepEqual([...background.data.subarray(28, 32)], [0, 0, 255, 255])
console.log('ok - SVG strings and buffers produce PNG and RGBA with optional backgrounds')

// Sample the paths at output resolution: a half-pixel edge becomes a crisp
// two-pixel edge at 4x, instead of an enlarged antialiased source pixel.
const edge = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2" viewBox="0 0 2 2">'
  + '<path d="M0 0H0.5V2H0Z" fill="red"/></svg>'
const sampled = rasterize_pixels(edge, { ratio: 4 })
assert.equal(sampled.width, 8)
assert.equal(sampled.height, 8)
assert.deepEqual([...sampled.data.subarray(0, 12)],
  [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0])
const fraction = rasterize_svg(svg, { size: { width: 8.25, height: 4.25 }, ratio: 2 })
assert.equal(fraction.readUInt32BE(16), 17)
assert.equal(fraction.readUInt32BE(20), 9)
const smaller = rasterize_pixels(svg, { ratio: 0.5 })
assert.equal(smaller.width, 4)
assert.equal(smaller.height, 2)
console.log('ok - raster sizing preserves fractional dimensions and samples SVG paths at final resolution')

const crop = { x: 3, y: 1, width: 2, height: 2 }
const cropped = rasterize_pixels(svg, { select: crop, ratio: 2 })
assert.equal(cropped.width, 4)
assert.equal(cropped.height, 4)
assert.deepEqual([...cropped.data.subarray(0, 12)],
  [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0])
const cropPng = rasterize_svg(Buffer.from(svg), { select: crop, ratio: 2 })
decoded.src = cropPng
const cropCanvas = createCanvas(4, 4)
cropCanvas.getContext('2d').drawImage(decoded, 0, 0)
assert.deepEqual(cropCanvas.getContext('2d').getImageData(0, 0, 4, 4).data, cropped.data)

const zoomedEdge = rasterize_pixels(edge, { select: { x: 0.25, y: 0.5, width: 1, height: 1 }, ratio: 4 })
assert.deepEqual([...zoomedEdge.data.subarray(0, 8)], [255, 0, 0, 255, 0, 0, 0, 0])
const padded = rasterize_pixels(svg, { select: { x: -1, y: -1, width: 2, height: 2 }, background: 'blue' })
assert.deepEqual([...padded.data.subarray(0, 4)], [0, 0, 255, 255])
assert.deepEqual([...padded.data.subarray(12, 16)], [255, 0, 0, 255])
const outside = rasterize_pixels(svg, { select: { x: 100, y: 100, width: 1, height: 1 } })
assert.deepEqual([...outside.data], [0, 0, 0, 0])
const viewBox = svg.replace('viewBox="0 0 8 4"', 'viewBox="0 0 16 8"')
const mapped = rasterize_pixels(viewBox, { select: { x: 1, y: 0, width: 2, height: 1 } })
assert.deepEqual([...mapped.data], [255, 0, 0, 255, 0, 0, 0, 0])
const fractionalCrop = rasterize_svg(svg, { select: { x: 0, y: 0, width: 1.25, height: 2.25 }, ratio: 2 })
assert.equal(fractionalCrop.readUInt32BE(16), 3)
assert.equal(fractionalCrop.readUInt32BE(20), 5)
console.log('ok - pixel selections crop before sampling, preserve viewBox mapping, and pad outside the image')

for (const select of [
  { ...crop, x: NaN }, { ...crop, y: Infinity },
  ...[0, -1, NaN, Infinity].flatMap(value => [{ ...crop, width: value }, { ...crop, height: value }]),
]) assert.throws(() => rasterize_svg(svg, { select }), /Selection/)

for (const ratio of [0, -1, NaN, Infinity]) {
  assert.throws(() => rasterize_svg(svg, { ratio }), /ratio must be positive and finite/)
}
for (const value of [0, -1, NaN, Infinity]) {
  assert.throws(() => rasterize_pixels(svg, { size: { width: value, height: 4 } }),
    /width must be positive and finite/)
  assert.throws(() => rasterize_pixels(svg, { size: { width: 8, height: value } }),
    /height must be positive and finite/)
}
assert.throws(() => rasterize_svg(svg, { ratio: Number.MAX_VALUE }), /positive and finite/)
assert.throws(() => rasterize_svg('not an SVG'))
console.log('ok - invalid SVG and nonpositive or nonfinite raster dimensions fail')
