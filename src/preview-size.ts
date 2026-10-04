/** Zoom sets display geometry; preview buffers have a separate memory budget. */
export function previewMaxSide(
  width: number,
  height: number,
  zoom: number,
  mobile: boolean,
  pixelRatio = 1,
) {
  if (!zoom) return 1600;
  const longest = Math.max(width, height);
  // Small pinch percentages must not discard the detail already shown in fit mode.
  // CSS zoom is measured in logical pixels; retina screens need more source pixels.
  const requestedScale = Math.min(
    1,
    Math.max((zoom / 100) * Math.max(1, pixelRatio), Math.min(1, 1600 / longest)),
  );
  const maxPixels = mobile ? 4_000_000 : Infinity;
  const maxEdge = mobile ? 4096 : Infinity;
  const scale = Math.min(
    requestedScale,
    Math.sqrt(maxPixels / (width * height)),
    maxEdge / longest,
  );
  return Math.max(1, Math.floor(longest * scale));
}
