import type { PathCommand, PixelRect, Point, RectRadii } from '@gum-jsx/core'

const K = 4 * (Math.SQRT2 - 1) / 3

function rect_path(rect: PixelRect, radius?: RectRadii): readonly PathCommand[] {
  const { x, y, width, height } = rect, right = x + width, bottom = y + height
  if (!radius) return [{ kind: 'M', x, y }, { kind: 'L', x: right, y },
    { kind: 'L', x: right, y: bottom }, { kind: 'L', x, y: bottom }, { kind: 'Z' }]
  const square = (r: Point): Point => r.x === 0 || r.y === 0 ? { x: 0, y: 0 } : r
  const corners = 'x' in radius ? { tl: radius, tr: radius, br: radius, bl: radius } : radius
  const tl = square(corners.tl), tr = square(corners.tr), br = square(corners.br), bl = square(corners.bl)
  return [
    { kind: 'M', x: x + tl.x, y }, { kind: 'L', x: right - tr.x, y },
    { kind: 'C', x1: right - (1 - K) * tr.x, y1: y, x2: right, y2: y + (1 - K) * tr.y, x: right, y: y + tr.y },
    { kind: 'L', x: right, y: bottom - br.y },
    { kind: 'C', x1: right, y1: bottom - (1 - K) * br.y, x2: right - (1 - K) * br.x, y2: bottom, x: right - br.x, y: bottom },
    { kind: 'L', x: x + bl.x, y: bottom },
    { kind: 'C', x1: x + (1 - K) * bl.x, y1: bottom, x2: x, y2: bottom - (1 - K) * bl.y, x, y: bottom - bl.y },
    { kind: 'L', x, y: y + tl.y },
    { kind: 'C', x1: x, y1: y + (1 - K) * tl.y, x2: x + (1 - K) * tl.x, y2: y, x: x + tl.x, y },
    { kind: 'Z' },
  ]
}

function ellipse_path(center: Point, radius: Point): readonly PathCommand[] {
  const { x, y } = center, rx = radius.x, ry = radius.y
  return [
    { kind: 'M', x: x + rx, y },
    { kind: 'C', x1: x + rx, y1: y + K * ry, x2: x + K * rx, y2: y + ry, x, y: y + ry },
    { kind: 'C', x1: x - K * rx, y1: y + ry, x2: x - rx, y2: y + K * ry, x: x - rx, y },
    { kind: 'C', x1: x - rx, y1: y - K * ry, x2: x - K * rx, y2: y - ry, x, y: y - ry },
    { kind: 'C', x1: x + K * rx, y1: y - ry, x2: x + rx, y2: y - K * ry, x: x + rx, y },
    { kind: 'Z' },
  ]
}

export { rect_path, ellipse_path }
