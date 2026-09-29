# Tiny-skia fragment backend

The experimental backend consumes completed `Fragment` trees. TypeScript walks
the tree, combines affine placements, normalizes shapes to paths, parses colors,
and writes one binary command buffer. Rust executes that buffer with tiny-skia
0.12.0 and encodes PNG with the `png` crate. Neither side performs layout or
font loading. The SVG/canvas backend remains available for comparison.

The protocol defines paths and embedded PNGs once, then refers to them by index.
Clip push/pop operations scope masks to the correct subtree. Rust owns input
and output allocations; the wrapper copies the result and releases both in a
`finally` block. Returned RGBA arrays remain valid across later renders.

The release WASM binary is embedded as base64 in the JS entry point. This costs
about 33% before compression but avoids runtime asset loading, filesystem APIs,
and an asynchronous initialization API. Compilation happens once, on demand.
The Node root entry re-exports the same portable module, so importing both entry
points shares the compiled instance. The module has no host imports or WASI
dependency. Rust and Cargo run only when rebuilding that artifact.

## Initial measurements

Measured on Linux x64 with Bun 1.4.2 and Rust 1.98.1. The baseline uses
node-canvas 3.2.3. Warm results are medians of nine samples after one warmup,
alternating operation order; first-call results are medians from five fresh Bun
processes. First-call timing starts after module import and fixture loading,
and includes lazy WASM compilation or lazy canvas loading. These are renderer
timings, not total CLI latency. Layout is excluded in both cases.

| Case | WASM | Canvas |
|---|---:|---:|
| Text, warm PNG | 0.90 ms | 0.72 ms |
| Text, first PNG call | 34.0 ms | 15.1 ms |
| Silk Road, warm RGBA | 73.9 ms | 112.9 ms |
| Silk Road, warm PNG | 108.7 ms | 128.7 ms |
| Silk Road, first PNG call | 225.5 ms | 147.4 ms |
| Silk Road PNG size | 426,947 bytes | 345,167 bytes |

The warm SVG serialization plus canvas PNG path measured 149.4 ms for Silk Road,
versus 108.7 ms for direct fragment PNG. The first render is slower with this
WASM build; repeated rendering benefits from the initialized renderer. This
tradeoff matters for single-shot CLI use and should be rechecked before switching
the CLI's default. The two encoders use different fast-compression policies.

The initial WASM artifact is 620,351 bytes (606 KiB); the compressed npm package
is approximately 316 KiB, including JS, declarations, documentation, and licenses.
Run `bun run perf` to regenerate samples and rendered files in `out/perf/`.

## Validation

- Fragment tests cover decoded PNG/RGBA equivalence, straight alpha, crop
  sampling, fractional viewports, transforms, winding holes, clip restoration,
  stroke dashes, curves, images, text/math outlines, and error recovery.
- Ten visual comparison scenes cover geometry, stroke degeneracies, clipping,
  opacity, transformed images, and text/math. At 2×, mean RGB error versus
  node-canvas was 0.004–0.440 out of 255; at most 0.32% of pixels differed by
  more than 32 in any RGB channel. This allows different edge antialiasing while
  checking geometry and interior colors. Artifacts are in `out/visual/`.
- A fresh npm tarball installation with `--ignore-scripts` has no `canvas`
  package. Node and Bun render it successfully with `--no-addons`, and its
  portable TypeScript declarations resolve in the consumer.
- A browser ESM check renders RGBA and successfully decodes the generated PNG.
- Existing SVG/canvas regression tests still pass.
- Workspace type checks pass. The full workspace test run has one existing CLI
  failure: its live-text test expects math to remain paths, but current core/math
  emits live math text. The same assertion fails with the original PNG renderer;
  this branch does not change that behavior.

## Follow-up before replacing the CLI backend

1. Measure full CLI startup on supported platforms, including Node and Bun;
   investigate cold WASM performance and optional SIMD builds if justified.
2. Decide how the CLI handles live text and color emoji. The fragment backend
   currently throws for them, as the PDF exporter does.
3. Bound temporary opacity surfaces to drawing extents and reduce full-frame
   clip-mask allocation for large or deeply clipped figures.
4. Verify image minification and color expectations on real documents. Bilinear
   sampling and 8-bit sRGB-like samples are the current scope; profiles are ignored.
5. Update CLI callers to pass fragments directly, and test the resulting fresh
   CLI install without canvas. Its current callers still use SVG rasterization.
