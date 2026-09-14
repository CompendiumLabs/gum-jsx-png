# gum-next-png

SVG-to-PNG and SVG-to-RGBA rendering through `node-canvas`, adapted from
`gum-org/gum-jsx-node/src/render.ts`. This package accepts completed SVG markup
and has no dependency on the layout core. Gum's text is already represented by
glyph paths in that SVG, so rasterization needs no font registry or font files.

```ts
import { rasterize_svg, rasterize_pixels } from 'gum-next-png'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" '
  + 'viewBox="0 0 80 40"><path d="M0 0H40V40H0Z" fill="red"/></svg>'

const png = rasterize_svg(svg, { ratio: 2 }) // PNG Buffer, 160 by 80 pixels
const rgba = rasterize_pixels(svg, { background: 'white' }) // canvas ImageData
```

Both functions accept a string or `Buffer` and the same optional settings:

| Option | Behavior |
|---|---|
| `size: { width, height }` | Logical raster viewport in pixels; defaults to the SVG image's intrinsic size reported by node-canvas. |
| `ratio` | Positive sampling multiplier, default `1`. Each output dimension is rounded up to a whole pixel. |
| `background` | Canvas fill behind the SVG; transparent by default. |

Node-canvas reports intrinsic image dimensions as whole pixels. When rendering
a Gum fragment, pass `size: fragment.size` to retain its fractional viewport
dimensions before applying `ratio`. This changes raster sampling and never runs
layout. The SVG paths are rendered at the final resolution.

PNG requires positive dimensions, even though SVG and layout inspection support
zero-sized viewports. Invalid image data and nonpositive or nonfinite dimensions
throw errors.

From the parent workspace, run `bun install` to install dependencies and link the
packages. Node-canvas includes a native binding; its install script is trusted
by the workspace and this package. SVG rendering requires a node-canvas build
with SVG support. There is no separate `rsvg-convert` command to install.

Run `bun run test` and `bun run typecheck` here. The tests check PNG encoding,
RGBA paint and transparency, backgrounds, fractional dimensions, invalid inputs,
and path sampling at the requested resolution. The CLI uses this package for
`bun run gum file.jsx -o output.png --ratio 2` from the workspace root.
