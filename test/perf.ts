// Run from this workspace after `bun run build`. Uses the CLI's existing
// evaluator so the map fixture has exactly the same fonts, theme, and layout.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { render_svg, LayoutPass, Text, px } from '@gum-jsx/core'
import type { Fragment } from '@gum-jsx/core'
import { create_evaluator } from '../../gum-jsx-cli/src/plugins'
import { layout } from '../../gum-jsx-cli/src/render'
import { render_png, render_pixels } from '../src/fragment'
import { rasterize_svg, rasterize_pixels } from '../src/render'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = `${root}out/perf/`
await mkdir(output, { recursive: true })
const evaluator = await create_evaluator()
const path = fileURLToPath(new URL('../../gum-jsx-docs/demos/silk_road/silk_road.jsx', import.meta.url))
const result = layout(evaluator.evaluate(await Bun.file(path).text(), { name: path }), { defaultTheme: 'light' })
if (result.kind !== 'fragment') throw new Error('Expected Silk Road fragment')
const scenes: Record<string, Fragment> = {
  text: new LayoutPass().layout(new Text({ font_size: px(24), children: 'Hello, tiny-skia! AV office Ω' })),
  silk_road: result.fragment,
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
const results = []
for (const [name, fragment] of Object.entries(scenes)) {
  const svg = render_svg(fragment)
  const methods = {
    wasm_pixels: () => render_pixels(fragment),
    canvas_pixels: () => rasterize_pixels(svg, { size: fragment.size }),
    wasm_png: () => render_png(fragment),
    canvas_png: () => rasterize_svg(svg, { size: fragment.size }),
    svg_then_canvas_png: () => rasterize_svg(render_svg(fragment), { size: fragment.size }),
  }
  const samples: Record<string, number[]> = Object.fromEntries(Object.keys(methods).map(key => [key, []]))
  for (const method of Object.values(methods)) method()
  for (let iteration = 0; iteration < 9; iteration++) {
    const entries = Object.entries(methods)
    for (const [key, method] of iteration % 2 ? entries.reverse() : entries) {
      const start = performance.now(); method(); samples[key]!.push(performance.now() - start)
    }
  }
  await Bun.write(`${output}${name}.json`, JSON.stringify(fragment))
  await Bun.write(`${output}${name}.svg`, svg)
  const wasm = render_png(fragment), canvas = rasterize_svg(svg, { size: fragment.size })
  await Bun.write(`${output}${name}-wasm.png`, wasm)
  await Bun.write(`${output}${name}-canvas.png`, canvas)
  const cold: Record<string, number[]> = { wasm: [], canvas: [] }
  for (let iteration = 0; iteration < 5; iteration++) for (const backend of ['wasm', 'canvas'] as const) {
    const module = backend === 'wasm' ? `${root}dist/fragment.js` : `${root}dist/render.js`
    const call = backend === 'wasm' ? 'render_png(fragment)' : 'rasterize_svg(svg, {size: fragment.size})'
    const script = `import {${backend === 'wasm' ? 'render_png' : 'rasterize_svg'}} from ${JSON.stringify(module)};
      const fragment=JSON.parse(await Bun.file(${JSON.stringify(output + name + '.json')}).text());
      const svg=await Bun.file(${JSON.stringify(output + name + '.svg')}).text();
      const start=performance.now(); const png=${call}; console.log(performance.now()-start);`
    const child = Bun.spawnSync([process.execPath, '-e', script])
    if (child.exitCode) throw new Error(child.stderr.toString())
    cold[backend]!.push(Number(child.stdout.toString()))
  }
  const row = { name, size: fragment.size, bytes: { wasm: wasm.length, canvas: canvas.length },
    median_ms: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, median(values)])),
    first_call_ms: Object.fromEntries(Object.entries(cold).map(([key, values]) => [key, median(values)])), samples, cold }
  results.push(row)
  console.log(JSON.stringify({ ...row, samples: undefined, cold: undefined }, null, 2))
}
await Bun.write(`${output}results.json`, JSON.stringify({ runtime: Bun.version, platform: process.platform,
  arch: process.arch, results }, null, 2) + '\n')
