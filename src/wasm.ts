import { wasm_base64 } from './generated/wasm'
import { decode_base64 } from './base64'

type Renderer = {
  memory: WebAssembly.Memory
  gum_alloc(length: number): number
  gum_free(pointer: number, length: number): void
  gum_render(pointer: number, length: number, format: number): number
  gum_output_ptr(handle: number): number
  gum_output_len(handle: number): number
  gum_output_error(handle: number): number
  gum_output_free(handle: number): void
}
let renderer: Renderer | undefined

function instance(): Renderer {
  if (!renderer) {
    const bytes = decode_base64(wasm_base64)
    renderer = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as unknown as Renderer
  }
  return renderer
}

function render_commands(commands: Uint8Array, format: 0 | 1 | 2): Uint8Array {
  const wasm = instance()
  const pointer = wasm.gum_alloc(commands.length)
  let handle = 0
  try {
    new Uint8Array(wasm.memory.buffer, pointer, commands.length).set(commands)
    handle = wasm.gum_render(pointer, commands.length, format)
    // Rendering can grow memory and detach earlier views. Acquire a fresh view
    // and copy it before releasing the result, so later renders cannot change it.
    const bytes = new Uint8Array(wasm.memory.buffer,
      wasm.gum_output_ptr(handle), wasm.gum_output_len(handle)).slice()
    if (wasm.gum_output_error(handle)) throw new Error(new TextDecoder().decode(bytes))
    return bytes
  } finally {
    if (handle) wasm.gum_output_free(handle)
    wasm.gum_free(pointer, commands.length)
  }
}

export { render_commands }
