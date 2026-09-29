// Use the native decoder when available. Older runtimes still avoid the
// per-character iterator and callback allocations of Uint8Array.from().
export function decode_base64(source: string): Uint8Array {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(source)
  const binary = atob(source)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
