// Read only explicit SVG viewports. CSS-controlled sizing and documents without
// a viewBox need the native loader to resolve their viewport and scaling rules.
type SvgViewport = Readonly<{
  width: number
  height: number
  resize: (width: number, height: number) => string
}>
const NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?'
const VIEW_BOX = new RegExp(`^${NUMBER}(?:(?:\\s+,?\\s*|\\s*,\\s*)${NUMBER}){3}$`)

function svg_viewport(svg: string): SvgViewport | null {
  const root = /^\s*<svg\b(?:"[^"]*"|'[^']*'|[^'">])*>/.exec(svg)?.[0]
  if (!root || /<(?:[^\s<>:/]+:)?style\b/.test(svg)) return null
  const attributes = new Map<string, { value: string; start: number; end: number }>()
  const attribute = /\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y
  let offset = root.indexOf('<svg') + 4
  while (!/^\s*\/?\s*>$/.test(root.slice(offset))) {
    attribute.lastIndex = offset
    const match = attribute.exec(root)
    if (!match || attributes.has(match[1])) return null
    const value = match[2] ?? match[3]
    const end = attribute.lastIndex - 1
    attributes.set(match[1], { value, start: end - value.length, end })
    offset = attribute.lastIndex
  }
  if (attributes.has('style')) return null
  const length = (name: string) => {
    const value = attributes.get(name)?.value.trim()
    return value && /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:px)?$/.test(value)
      ? Number(value.replace(/px$/, '')) : NaN
  }
  const width = length('width'), height = length('height')
  const box_text = attributes.get('viewBox')?.value.trim()
  const box = box_text && VIEW_BOX.test(box_text) ? box_text.split(/[\s,]+/).map(Number) : null
  if (![width, height].every(value => Number.isFinite(value) && value > 0)
    || !box || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) return null
  return { width, height, resize(width, height) {
    // Replace only attribute values, preserving quoting, namespace declarations,
    // viewBox and preserveAspectRatio. Work backwards so the offsets stay valid.
    const replacements = [['width', width], ['height', height]] as const
    let resized = root
    for (const [name, value] of [...replacements].sort((a, b) =>
      attributes.get(b[0])!.start - attributes.get(a[0])!.start)) {
      const { start, end } = attributes.get(name)!
      resized = resized.slice(0, start) + value + resized.slice(end)
    }
    return resized + svg.slice(root.length)
  } }
}

export { svg_viewport }
