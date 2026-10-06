# @gum-jsx/png

[Gum](https://github.com/CompendiumLabs/gum-jsx) — installation, quickstart, and user documentation.

Render completed Gum fragments directly to PNG or RGBA through tiny-skia
WebAssembly. Like the other Gum libraries, this package publishes TypeScript
source. Use it directly in Bun or bundle it for Node and browsers. It needs no
native addons, install scripts, host fonts, or Rust installation.

CLI PNG/kitty output, Markdown figures/math, and MCP rasterization use fragments
directly. This branch has no SVG-string rasterizer or native canvas dependency.

## Fragment rendering

```ts
import { LayoutPass, Text, px } from '@gum-jsx/core'
import { render_png, render_pixels } from '@gum-jsx/png'

const fragment = new LayoutPass().layout(
  new Text({ children: 'Hello, tiny-skia!', font_size: px(32) }),
)
const png = render_png(fragment, { ratio: 2 }) // Uint8Array
const rgba = render_pixels(fragment) // { width, height, data: Uint8ClampedArray }
await Bun.write('hello.png', png)
```

The package root exposes the same portable renderer in every environment and
never imports Node modules. To display the PNG, use
`new Blob([png], { type: 'image/png' })` and an object URL.

The WASM payload is embedded in `src/generated/wasm.ts`. It is decoded and
compiled on the first render, then reused. There is no fetch or asset-loader
configuration, and both APIs remain synchronous. Sites using CSP must permit
WebAssembly compilation, for example with `script-src 'wasm-unsafe-eval'` in
addition to their existing script policy.

| Option | Behavior |
|---|---|
| `ratio` | Positive sampling multiplier, default `1`. Output dimensions are rounded up; geometry is scaled by exactly this ratio. |
| `select: { x, y, width, height }` | Crop in fragment coordinates before sampling; areas outside the original viewport remain transparent or show the background. |
| `background` | Solid CSS color behind the fragment, transparent by default. |
| `encoding` | PNG only: `'fast'` (default) or `'standard'`, using the Rust PNG encoder's fast or balanced compression. Both encode identical pixels. |

Supported drawing features include rectangles and individually rounded corners,
ellipses, `M/L/Q/C/Z` paths, nonzero fills, dashed strokes, caps and joins, affine
transforms, nested rectangular/rounded/path clips, PNG images, color alpha, and
drawing opacity. Text and math are rendered from their existing glyph outlines.
Fill and stroke are composited together before applying drawing opacity.
Shared path and image data are transferred to WASM once per render.

The current implementation has these limits:

- Live emoji without outlines are skipped, preserving their layout space.
  Other live text throws a descriptive error; use outlined text. Export SVG
  for a browser with suitable fonts to display live text and emoji.
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
performance results and remaining portability and performance work.

## SVG input

The former `rasterize_svg`, `rasterize_pixels`, and `/svg` entry point have been
removed. Pass a completed Gum `Fragment` to `render_png` or `render_pixels`.
Live emoji without outlines are skipped; other live text requires outlines.
Export SVG for a browser or another renderer with suitable fonts to display
live text and emoji.

For cropped PNG or RGBA output, pass `select` to the fragment renderer.
The `RasterSelection` type is exported from the package root.

PNG requires positive dimensions, even though SVG and layout inspection support
zero-sized viewports. Invalid image data and nonpositive or nonfinite dimensions
throw errors.

## Runtime requirements

Use Bun 1.4.2+ for direct source imports. The bundled renderer has also been
checked with Node 26.9.0 and Chromium on Linux x64; other OSes still need release
verification. The `gum-jsx` command package bundles this library for its Node and
standalone executables. The WASM module uses the portable
`wasm32-unknown-unknown` target and does not require WASI or SIMD.

## Development

After `bun install` at the workspace root, run these commands in this package:

```sh
bun run test
bun run typecheck
bun run test:visual  # Ten comparisons with saved raster reference images
bun run test:package # Clean npm install with scripts and native addons disabled
bun run test:browser # Serve a browser check at http://127.0.0.1:4193
bun run perf        # Workspace text and Silk Road benchmarks
```

`npm pack` ships TypeScript source, the checked-in WASM payload, documentation,
and licenses. It needs no build step or lifecycle scripts. The package test
checks direct source imports in Bun and a consumer bundle in Node.

To rebuild the WASM artifact, install Rust and its `wasm32-unknown-unknown`
target, then run `bun run build`. The initial artifact was built with Rust
1.98.1. `wasm/Cargo.lock` pins Rust dependencies;
the build script also refreshes their license notices. Commit the generated
`src/generated/wasm.ts` so ordinary development and installation need no Rust.
