import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
// Normal JS builds use the checked-in WASM artifact and need no Rust toolchain.
for (const [target, names] of [['node', ['render']], ['browser', ['fragment', 'selection']]] as const) {
  const result = await Bun.build({ entrypoints: names.map(name => `${root}src/${name}.ts`),
    outdir: `${root}dist`, target, format: 'esm', packages: 'external' })
  if (!result.success) throw new AggregateError(result.logs, 'PNG package build failed')
}
// Preserve the re-exports so the main and browser entry points share one WASM
// payload and one initialized instance, even when both are imported together.
await writeFile(`${root}dist/index.js`, new Bun.Transpiler({ loader: 'ts' })
  .transformSync(await readFile(`${root}src/index.ts`, 'utf8')))
const types = Bun.spawn(['bun', 'x', '--no-install', 'tsc', '-p', `${root}tsconfig.build.json`], {
  cwd: root, stdout: 'inherit', stderr: 'inherit',
})
if (await types.exited !== 0) process.exit(1)
