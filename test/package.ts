import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'gum-png-package-'))
const consumer = join(directory, 'consumer')
await mkdir(consumer)
function run(args: string[], cwd = root): string {
  const result = Bun.spawnSync(args, { cwd, env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? join(directory, 'cache') },
    stdout: 'pipe', stderr: 'pipe' })
  assert.equal(result.exitCode, 0, `${args.join(' ')}\n${result.stderr.toString()}\n${result.stdout.toString()}`)
  return result.stdout.toString()
}
const packed = JSON.parse(run(['npm', 'pack', '--ignore-scripts', '--pack-destination', directory, '--json']))
const metadata = (Array.isArray(packed) ? packed[0] : Object.values(packed)[0]) as {
  filename: string; size: number; files: { path: string }[]
}
// Source and the checked-in WASM payload must ship without a build step.
const files = metadata.files.map(file => file.path)
assert.ok(files.includes('src/index.ts'))
assert.ok(files.includes('src/generated/wasm.ts'))
assert.ok(!files.some(file => file.startsWith('dist/')))
// Pack the matching core candidate too: its version may not be public yet.
const corePacked = JSON.parse(run(['npm', 'pack', '--ignore-scripts', '--pack-destination', directory, '--json'], join(root, '../gum-jsx-core')))
const coreMetadata = (Array.isArray(corePacked) ? corePacked[0] : Object.values(corePacked)[0]) as { filename: string }
await writeFile(join(consumer, 'package.json'), '{"name":"gum-png-consumer","private":true,"type":"module"}\n')
run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund',
  join(directory, coreMetadata.filename), join(directory, metadata.filename)], consumer)
const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'))
assert.ok(!Object.keys(lock.packages).some(path => path.endsWith('/canvas')), 'Fresh fragment installs must not install canvas')
const smoke = `
import assert from 'node:assert/strict';
import { render_png, render_pixels } from '@gum-jsx/png';
import * as api from '@gum-jsx/png';
const f = {size:{width:8,height:4},children:[],draw:[
  {kind:'rect',rect:{x:0,y:0,width:4,height:4},fill:'red',stroke:'none',stroke_width:0}
]};
assert.deepEqual([...render_pixels(f).data.slice(0,4)], [255,0,0,255]);
assert.deepEqual([...render_png(f).slice(0,8)], [137,80,78,71,13,10,26,10]);
assert.ok(!('rasterize_svg' in api));
assert.ok(!('rasterize_pixels' in api));
console.log('ok - packed fragment renderer works without canvas or native addons');
`
await writeFile(join(consumer, 'smoke.ts'), smoke)
console.log(run(['bun', '--no-addons', 'smoke.ts'], consumer).trim())
// Node consumers bundle the published source, as the gum-jsx distribution does.
run(['bun', 'build', './smoke.ts', '--target=node', '--outfile=smoke.mjs'], consumer)
console.log(run(['node', '--no-addons', 'smoke.mjs'], consumer).trim())
// Older runtimes use the decoder fallback, including at WASM startup.
for (const [runtime, entry] of [['node', './smoke.mjs'], ['bun', './smoke.ts']]) {
  console.log(run([runtime, '--no-addons', '--input-type=module', '-e',
    `Uint8Array.fromBase64 = undefined; await import(${JSON.stringify(entry)})`], consumer).trim())
}
// Published source types must resolve without native package types.
await writeFile(join(consumer, 'types.ts'), `import {render_png, render_pixels} from '@gum-jsx/png';
import type {RasterSelection} from '@gum-jsx/png';
import type {Fragment} from '@gum-jsx/core';
declare const fragment: Fragment;
const select: RasterSelection = {x: 0, y: 0, width: 4, height: 2};
const bytes: Uint8Array = render_png(fragment, {select});
const rgba: Uint8ClampedArray = render_pixels(fragment).data;
`)
console.log(run([join(root, 'node_modules/.bin/tsc'), '--noEmit', '--skipLibCheck', '--strict',
  '--module', 'preserve', '--moduleResolution', 'bundler', '--target', 'esnext', 'types.ts'], consumer).trim())
console.log(`ok - package ${metadata.size} bytes; clean npm consumer: ${consumer}`)
