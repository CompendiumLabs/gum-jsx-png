import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const server = Bun.serve({ hostname: '127.0.0.1', port: 4193, fetch(request) {
  if (new URL(request.url).pathname === '/render.js') {
    return new Response(Bun.file(`${root}dist/render.js`), { headers: { 'Content-Type': 'text/javascript' } })
  }
  return new Response(Bun.file(`${root}test/browser.html`), { headers: { 'Content-Type': 'text/html' } })
} })
console.log(`Browser smoke test: ${server.url}`)
