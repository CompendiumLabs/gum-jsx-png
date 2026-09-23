# @gum-jsx/png

Render SVG to PNG or RGBA pixels through node-canvas. This package accepts
completed SVG markup and has no dependency on Gum's layout core. It runs in a
native Bun host; the separate selection helper also works in browsers.

See the [Gum project](https://github.com/CompendiumLabs/gum-jsx#readme) for
workspace setup and the package overview.

## Usage

```ts
import { rasterize_svg, rasterize_pixels } from '@gum-jsx/png'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" '
  + 'viewBox="0 0 80 40"><path d="M0 0H40V40H0Z" fill="red"/></svg>'

const png = rasterize_svg(svg, { ratio: 2 }) // PNG Buffer, 160 by 80 pixels
const rgba = rasterize_pixels(svg, { background: 'white' }) // canvas ImageData
const detail = rasterize_svg(svg, {
  select: { x: 20, y: 10, width: 30, height: 20 },
  ratio: 4,
}) // Selected region, 120 by 80 pixels
```

Both functions accept a string or `Buffer` and the same optional settings:

| Option | Behavior |
|---|---|
| `size: { width, height }` | Logical raster viewport in pixels; defaults to the SVG image's intrinsic size reported by node-canvas. |
| `select: { x, y, width, height }` | Crop in source-image pixels from the top-left, before applying `ratio`. Output dimensions come from the selection when supplied. |
| `ratio` | Positive sampling multiplier, default `1`. Each output dimension is rounded up to a whole pixel. |
| `background` | Canvas fill behind the SVG; transparent by default. |

Node-canvas reports intrinsic image dimensions as whole pixels. When rendering
a Gum fragment, pass `size: fragment.size` to retain its fractional viewport
dimensions before applying `ratio`. This changes raster sampling and never runs
layout. The SVG paths are rendered at the final resolution.

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

## Setup and development

From the parent workspace, run `bun install` to install dependencies and link the
packages. Node-canvas includes a native binding; this package declares `canvas` as a trusted
install dependency. SVG rendering requires a node-canvas build
with SVG support. There is no separate `rsvg-convert` command to install.

Ordinary Gum text is already outlined in SVG and needs no font registration.
Emoji and other live SVG text depend on fonts available to node-canvas.

Run `bun run test` and `bun run typecheck` here. The tests check PNG encoding,
RGBA paint and transparency, backgrounds, fractional dimensions, invalid inputs,
and path sampling at the requested resolution. The CLI uses this package for
`bun run gum file.jsx -o output.png --ratio 2` from the workspace root.
