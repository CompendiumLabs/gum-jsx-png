# Raster references

These ten PNGs were generated from `test/visual.ts` with node-canvas 3.2.3 on
Linux x64 before removing that backend (PNG commit `3574b0c`). Each uses a white
background and 2× sampling. They remain independent references for tiny-skia's
geometry and color checks without requiring a native dependency to run tests.

Keep these fixed when changing the rasterizer. Investigate differences and
review images before deliberately replacing a reference.
