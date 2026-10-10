# Tiny-skia fragment backend

The experimental backend consumes completed `Fragment` trees. TypeScript walks
the tree, combines affine placements, normalizes shapes to paths, parses colors,
and writes one binary command buffer. Rust executes that buffer with tiny-skia
0.12.0 and encodes PNG with the `png` crate. Neither side performs layout or
font loading. CLI PNG/kitty output, Markdown figures/math, and MCP rasterization
now pass fragments directly. The native SVG backend has been removed. Live emoji
without outlines are skipped, preserving their layout space. Other live text
and external SVG images are unsupported by this backend.

The protocol defines paths and embedded PNGs once, then refers to them by index.
Clip push/pop operations scope masks to the correct subtree. Rust owns input
and output allocations; the wrapper copies the result and releases both in a
`finally` block. Returned RGBA arrays remain valid across later renders.

The release WASM binary is embedded as base64 in `src/generated/wasm.ts`. This costs
about 33% before compression but avoids runtime asset loading, filesystem APIs,
and an asynchronous initialization API. Compilation happens once, on demand.
The package publishes TypeScript source with one portable entry point. Bun can
import it directly; Node and browser consumers bundle it, as `gum-jsx` does for
its commands. The module has no host imports or WASI dependency. Rust and Cargo
run only when rebuilding that artifact.

## Historical comparison before removing canvas

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
tradeoff matters for single-shot CLI use; full CLI startup and memory still need
cross-platform measurement. The two encoders use different fast-compression policies.

The initial WASM artifact is 620,351 bytes (606 KiB); the compressed npm package
was approximately 316 KiB with the former JS/declaration packaging.
Run `bun run perf` for current WASM samples and rendered files in `out/perf/`.
The canvas figures above are historical and are no longer measured by the script.

## Startup and buffer improvements

Base64 decoding now uses `Uint8Array.fromBase64` where available, with a direct
byte loop for older runtimes. This applies to both the WASM payload and embedded
PNG images. RGBA conversion reuses the Rust pixmap's allocation and skips alpha
conversion for transparent and opaque pixels. Partial alpha retains tiny-skia's
rounding. The map below avoids an extra 8.4 MB pixel buffer in Rust; copying the
finished result into a caller-owned JavaScript array is still necessary.

Measured against the preceding renderer on Linux x64, Bun 1.4.2, Rust 1.98.1:

| Case | Before | After |
|---|---:|---:|
| Text, first PNG call | 33.0 ms | 13.9 ms |
| Silk Road, first PNG call | 227.4 ms | 205.7 ms |
| Silk Road, warm PNG | 108.9 ms | 107.7 ms |
| Embedded 512×256 PNG, first PNG call | 98.6 ms | 69.3 ms |
| Embedded 512×256 PNG, warm PNG | 10.0 ms | 8.6 ms |

Warm measurements use 21 samples after at least 10 calls and 250 ms of warmup
per operation. First-call measurements use nine fresh Bun processes per backend.
Backend order alternates. Both load built modules; layout and process startup
are excluded. The embedded PNG is a generated RGB texture. These changes mainly
help startup and images; warm vector rendering changes little.

Pass a saved renderer module to compare it with the current source:

```sh
bun run perf /path/to/previous/src/index.ts
```

The comparison also checks identical PNG bytes. Ten visual fixtures and all
65,536 channel/alpha combinations were checked against the preceding renderer;
RGBA and both PNG encodings matched exactly. The updated WASM is 619,213 bytes.

## Validation

- Fragment tests cover decoded PNG/RGBA equivalence, straight alpha, crop
  sampling, fractional viewports, transforms, winding holes, clip restoration,
  stroke dashes, curves, images, text/math outlines, and error recovery.
- A fresh npm tarball installation with `--ignore-scripts` has no `canvas`
  package. Bun imports its source directly, a consumer bundle renders in Node,
  and both run with `--no-addons`. Source types resolve in the consumer.
- A browser ESM check renders RGBA and successfully decodes the generated PNG.
- `bun run --cwd gum-jsx test` packs the CLI, installs it through npm
  offline with `--ignore-scripts`, and checks built-in rendering under Node
  and Bun plus plugins under Bun. The bundle has no runtime dependencies.
- CLI checks cover crop/background pixels, fractional viewports, encoding,
  PNG/kitty agreement, outlined text modes, and skipped live emoji. Its live-text
  expectations follow core/math's live glyph behavior; PDF remains outlined.
- Release testing covers Linux x64, with successful native macOS and Windows
  testing of `gum-jsx` 2.1.0-beta.1 confirmed by Doug on 2026-10-09.

## Remaining work

1. Measure full CLI startup and memory on supported platforms with Bun;
   investigate cold WASM performance and optional SIMD builds if justified.
2. Bound temporary opacity surfaces to drawing extents and reduce full-frame
   clip-mask allocation for large or deeply clipped figures.
3. Verify image minification and color expectations on real documents. Bilinear
   sampling and 8-bit sRGB-like samples are the current scope; profiles are ignored.
