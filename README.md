# @gum-jsx/png

Render completed Gum fragments directly to PNG or RGBA through tiny-skia
WebAssembly. The fragment renderer works in Bun, Node, and browsers without
native addons, install scripts, host fonts, or a Rust installation.

SVG-string rendering remains available through the optional `canvas` package.
The CLI currently uses that SVG API; this branch adds the fragment backend for
evaluation before switching CLI rendering.

See the [Gum project](https://github.com/CompendiumLabs/gum-jsx#readme) for
getting started and the package overview.

## Fragment rendering

```ts
import { LayoutPass, Text, px } from '@gum-jsx/core'
import { render_png, render_pixels } from '@gum-jsx/png/fragment'

const fragment = new LayoutPass().layout(
  new Text({ children: 'Hello, tiny-skia!', font_size: px(32) }),
)
const png = render_png(fragment, { ratio: 2 }) // Uint8Array
const rgba = render_pixels(fragment) // { width, height, data: Uint8ClampedArray }
await Bun.write('hello.png', png)
```

Both functions are also exported from `@gum-jsx/png`. In browsers, the package's
root export selects the fragment API. The explicit `/fragment` entry works with
bundlers and native browser ESM and never imports Node modules. To display the
PNG, use `new Blob([png], { type: 'image/png' })` and an object URL.

The WASM payload is embedded in the published JavaScript. It is decoded and
compiled on the first render, then reused. There is no fetch or asset-loader
configuration, and both APIs remain synchronous. Sites using CSP must permit
WebAssembly compilation, for example with `script-src 'wasm-unsafe-eval'` in
addition to their existing script policy.

| Option | Behavior |
|---|---|
| `ratio` | Positive sampling multiplier, default `1`. Output dimensions are rounded up; geometry is scaled by exactly this ratio. |
| `select: { x, y, width, height }` | Crop in fragment coordinates before sampling; areas outside the original viewport remain transparent or show the background. |
| `background` | Solid CSS color behind the fragment, transparent by default. |
| `encoding` | PNG only: `'fast'` (default) or `'standard'`, using the Rust PNG encoder's fast or balanced compression. Both encode identical pixels. These presets do not reproduce node-canvas's PNG bytes. |

Supported drawing features include rectangles and individually rounded corners,
ellipses, `M/L/Q/C/Z` paths, nonzero fills, dashed strokes, caps and joins, affine
transforms, nested rectangular/rounded/path clips, PNG images, color alpha, and
drawing opacity. Text and math are rendered from their existing glyph outlines.
Fill and stroke are composited together before applying drawing opacity.
Shared path and image data are transferred to WASM once per render.

The current implementation has these limits:

- Live text and color emoji require host fonts and throw a descriptive error.
  Use outlined text for the fragment renderer.
- Colors support CSS names, hex, numeric RGB/HSL, `transparent`, and `none`.
  CSS variables, `currentColor`, gradients, and other paint expressions throw.
- Images use bilinear sampling and 8-bit premultiplied RGBA internally. PNG
  output and `render_pixels` return straight alpha. Higher-depth input is
  reduced to 8 bits; color profiles and gamma metadata are not applied.
- Each output and embedded image is limited to 16,777,216 pixels; nested clip
  masks are limited to 128 MiB. Transparent fill/stroke composites currently
  allocate a temporary surface the size of the output.
- Debug overlays and fragment labels are not drawn. Path coordinates enter
  tiny-skia as float32; exceptionally large coordinates can lose precision.

See [WASM implementation and measurements](docs/WASM.md) for the initial
performance results and the remaining work before a CLI switch.

## SVG rendering

Install `canvas` when using the SVG API. With npm 12, approve its native install
script from the consuming project, then rebuild it:

```sh
npm install canvas
npm approve-scripts canvas
npm rebuild canvas --foreground-scripts
```

These steps are unnecessary for the fragment API.

```ts
import { rasterize_svg, rasterize_pixels } from '@gum-jsx/png'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" '
  + 'viewBox="0 0 80 40"><path d="M0 0H40V40H0Z" fill="red"/></svg>'

const png = rasterize_svg(svg, { ratio: 2 }) // PNG Buffer, 160 by 80 pixels
const rgba = rasterize_pixels(svg, { background: 'white' }) // { width, height, data }
const detail = rasterize_svg(svg, {
  select: { x: 20, y: 10, width: 30, height: 20 },
  ratio: 4,
}) // Selected region, 120 by 80 pixels
const standard = rasterize_svg(svg, { encoding: 'standard' }) // Previous PNG compression policy
```

Both functions accept a string or `Buffer` and the same optional settings:

| Option | Behavior |
|---|---|
| `size: { width, height }` | Logical raster viewport in pixels; defaults to the SVG image's intrinsic size reported by node-canvas. |
| `select: { x, y, width, height }` | Crop in source-image pixels from the top-left, before applying `ratio`. Output dimensions come from the selection when supplied. |
| `ratio` | Positive sampling multiplier, default `1`. Each output dimension is rounded up to a whole pixel. |
| `background` | Canvas fill behind the SVG; transparent by default. |
| `encoding` | PNG only: `'fast'` (default) uses compression level 3 without row filters; `'standard'` uses node-canvas's level 6 and adaptive filters. Both preserve every decoded pixel. |

Node-canvas reports intrinsic image dimensions as whole pixels. When rendering
a Gum fragment, pass `size: fragment.size` to retain its fractional viewport
dimensions before applying `ratio`. This changes raster sampling and never runs
layout. The SVG paths are rendered at the final resolution.

Explicit viewports with a `viewBox` are loaded at their final raster dimensions,
avoiding a second native render after loading. CSS-controlled sizing, XML
preambles, and SVGs without an explicit viewBox use the native sizing path.
Cropping also prepares the final viewport before loading when possible.

Fast encoding reduces compression work. File size depends on the image: a fast
PNG can be larger or smaller than standard encoding. Use `encoding: 'standard'`
to retain the previous compression policy. `rasterize_pixels` skips PNG encoding
and ignores this setting. The `PngEncoding` type is exported for callers.

Selection coordinates describe the rendered SVG viewport, not its `viewBox`
units. Fractional and negative positions are allowed; selection dimensions must
be positive and all four values must be finite. Areas outside the source viewport
are transparent or use the requested background. The source layout is unchanged.
Cropping happens before rasterization, keeping magnified vector edges sharp.

Browser renderers can import `select_svg(svg, select, viewport)` and the
`RasterSelection` type from `@gum-jsx/png/selection`. This entry point has no Node
or canvas dependencies and produces the same cropped SVG used by the native
rasterizer; rasterize it at the desired output size using browser canvas.

PNG requires positive dimensions, even though SVG and layout inspection support
zero-sized viewports. Invalid image data and nonpositive or nonfinite dimensions
throw errors.

## Runtime requirements

The WASM backend has been checked with Bun 1.4.2, Node 26.9.0, and Chromium on
Linux x64. Node 22+ is the supported Node baseline; other OSes still need release
verification. The module uses the portable `wasm32-unknown-unknown` target and
does not require WASI or SIMD.

The existing native SVG backend has been tested on Linux x64, macOS, and Windows
with Bun 1.4.2 or newer. It requires node-canvas with its native binding and SVG support.

Ordinary Gum text is already outlined in SVG and needs no font registration.
Emoji and other live SVG text depend on fonts available to node-canvas.

## Development

After `bun install` at the workspace root, run these commands in this package:

```sh
bun run build        # JS and declarations, using the checked-in WASM artifact
bun run test
bun run typecheck
bun run test:visual  # Ten comparisons with the existing SVG/canvas renderer
bun run test:package # Clean npm install with scripts and native addons disabled
bun run test:browser # Serve a browser check at http://127.0.0.1:4193
bun run perf        # Workspace text and Silk Road benchmarks
```

`npm pack` runs the JS build through `prepack`; it does not compile Rust. Build
first when packing with `--ignore-scripts`. The npm tarball contains built JS,
declarations, documentation, and licenses.

To rebuild the WASM artifact, install Rust and its `wasm32-unknown-unknown`
target, then run `bun run build:wasm` followed by `bun run build`. The initial
artifact was built with Rust 1.98.1. `wasm/Cargo.lock` pins Rust dependencies;
the build script also refreshes their license notices. Commit the generated
`src/generated/wasm.ts` so ordinary development and installation need no Rust.
