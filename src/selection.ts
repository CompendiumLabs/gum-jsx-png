// Browser-safe selection support; no canvas or Node imports.
type RasterSelection = Readonly<{ x: number; y: number; width: number; height: number }>
type RasterSize = Readonly<{ width: number; height: number }>

function validate_selection(select: RasterSelection): void {
  if (!Number.isFinite(select.x) || !Number.isFinite(select.y)) {
    throw new RangeError('Selection x and y must be finite')
  }
  if (!Number.isFinite(select.width) || select.width <= 0
    || !Number.isFinite(select.height) || select.height <= 0) {
    throw new RangeError('Selection width and height must be positive and finite')
  }
}

// Keep the original viewport (including its viewBox and percentage lengths)
// inside a new viewport. Cropping happens before rasterization, so zooming
// samples vector paths at the requested output resolution.
function select_svg(svg: string, select: RasterSelection, viewport: RasterSize): string {
  validate_selection(select)
  const start = svg.search(/<svg\b/)
  if (start < 0) throw new Error('Expected SVG markup')
  const { x, y, width, height } = select
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" preserveAspectRatio="none">`
    + `<svg width="${viewport.width}" height="${viewport.height}">${svg.slice(start)}</svg></svg>`
}

export { select_svg, validate_selection }
export type { RasterSelection, RasterSize }
