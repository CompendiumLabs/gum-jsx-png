// Run directly from this workspace. Uses the CLI's existing
// evaluator so the map fixture has exactly the same fonts, theme, and layout.
// Optionally pass an older renderer module to compare output and alternating timings.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { render_svg, LayoutPass, Text, px, draw_image, make_fragment } from '@gum-jsx/core'
import type { Fragment } from '@gum-jsx/core'
import { encode } from 'fast-png'
import { create_evaluator } from '../../gum-jsx-cli/src/plugins'
import { layout } from '../../gum-jsx-cli/src/render'
import { render_png, render_pixels } from '../src'

const root = fileURLToPath(new URL('../', import.meta.url))
const baseline = process.argv[2]
const backends = {
  wasm: { render_png, render_pixels, entry: `${root}src/index.ts` },
  ...(baseline ? { baseline: { ...await import(resolve(baseline)), entry: resolve(baseline) } } : {}),
}
const output = `${root}out/perf/`
await mkdir(output, { recursive: true })
const evaluator = await create_evaluator()
const path = fileURLToPath(new URL('../../gum-jsx-docs/demos/silk_road/silk_road.jsx', import.meta.url))
const result = layout(evaluator.evaluate(await Bun.file(path).text(), { name: path }), { defaultTheme: 'light' })
if (result.kind !== 'fragment') throw new Error('Expected Silk Road fragment')
const imageData = new Uint8Array(512 * 256 * 4)
for (let y = 0; y < 256; y++) for (let x = 0; x < 512; x++) {
  imageData.set([x % 256, y, (x * y) % 256, 255], (y * 512 + x) * 4)
}
const image = `data:image/png;base64,${Buffer.from(encode({ width: 512, height: 256, data: imageData })).toString('base64')}`
const scenes: Record<string, Fragment> = {
  text: new LayoutPass().layout(new Text({ font_size: px(24), children: 'Hello, tiny-skia! AV office Ω' })),
  silk_road: result.fragment,
  embedded_png: make_fragment({ size: { width: 512, height: 256 },
    draw: [draw_image({ x: 0, y: 0, width: 512, height: 256 }, image)] }),
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
const results = []
for (const [name, fragment] of Object.entries(scenes)) {
  const svg = render_svg(fragment)
  const methods: Record<string, () => unknown> = {}
  for (const [key, backend] of Object.entries(backends)) {
    methods[`${key}_pixels`] = () => backend.render_pixels(fragment)
    methods[`${key}_png`] = () => backend.render_png(fragment)
  }
  const samples: Record<string, number[]> = Object.fromEntries(Object.keys(methods).map(key => [key, []]))
  for (const method of Object.values(methods)) {
    const until = performance.now() + 250
    for (let iteration = 0; iteration < 10 || performance.now() < until; iteration++) method()
  }
  for (let iteration = 0; iteration < 21; iteration++) {
    const entries = Object.entries(methods)
    for (const [key, method] of iteration % 2 ? entries.reverse() : entries) {
      const start = performance.now(); method(); samples[key]!.push(performance.now() - start)
    }
  }
  await Bun.write(`${output}${name}.json`, JSON.stringify(fragment))
  await Bun.write(`${output}${name}.svg`, svg)
  const wasm = render_png(fragment)
  await Bun.write(`${output}${name}-wasm.png`, wasm)
  const cold: Record<string, number[]> = {}
  const bytes: Record<string, number> = {}
  for (const [key, backend] of Object.entries(backends)) {
    cold[key] = []
    const png = backend.render_png(fragment)
    bytes[key] = png.length
    assert.deepEqual(png, wasm, `${name}: ${key} changed PNG output`)
  }
  for (let iteration = 0; iteration < 9; iteration++) {
    const entries = Object.entries(backends)
    for (const [key, backend] of iteration % 2 ? entries.reverse() : entries) {
      const script = `import {render_png} from ${JSON.stringify(backend.entry)};
        const fragment=JSON.parse(await Bun.file(${JSON.stringify(output + name + '.json')}).text());
        const start=performance.now(); render_png(fragment); console.log(performance.now()-start);`
      const child = Bun.spawnSync([process.execPath, '-e', script])
      if (child.exitCode) throw new Error(child.stderr.toString())
      cold[key]!.push(Number(child.stdout.toString()))
    }
  }
  const row = { name, size: fragment.size, bytes,
    median_ms: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, median(values)])),
    first_call_ms: Object.fromEntries(Object.entries(cold).map(([key, values]) => [key, median(values)])), samples, cold }
  results.push(row)
  console.log(JSON.stringify({ ...row, samples: undefined, cold: undefined }, null, 2))
}
await Bun.write(`${output}results.json`, JSON.stringify({ runtime: Bun.version, platform: process.platform,
  arch: process.arch, results }, null, 2) + '\n')
