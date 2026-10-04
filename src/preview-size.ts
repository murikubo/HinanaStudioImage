/** Zoom sets display geometry; preview buffers have a separate memory budget. */
export function previewMaxSide(width: number, height: number, zoom: number, mobile: boolean) {
  if (!zoom) return 1600;
  const requestedScale = Math.min(1, zoom / 100);
  const maxPixels = mobile ? 4_000_000 : Infinity;
  const maxEdge = mobile ? 4096 : Infinity;
  const scale = Math.min(
    requestedScale,
    Math.sqrt(maxPixels / (width * height)),
    maxEdge / Math.max(width, height),
  );
  return Math.max(1, Math.floor(Math.max(width, height) * scale));
}
