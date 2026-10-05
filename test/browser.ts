import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
// Bundle the source as a browser consumer would, without package build artifacts.
const bundle = await Bun.build({ entrypoints: [`${root}src/index.ts`], target: 'browser', format: 'esm' })
if (!bundle.success) throw new AggregateError(bundle.logs, 'Browser test bundle failed')
const server = Bun.serve({ hostname: '127.0.0.1', port: 4193, fetch(request) {
  if (new URL(request.url).pathname === '/render.js') {
    return new Response(bundle.outputs[0]!, { headers: { 'Content-Type': 'text/javascript' } })
  }
  return new Response(Bun.file(`${root}test/browser.html`), { headers: { 'Content-Type': 'text/html' } })
} })
console.log(`Browser smoke test: ${server.url}`)
