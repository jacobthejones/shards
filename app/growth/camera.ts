export const CAMERA_VIEW_SCALE = 2.15;
export const MAX_FIELD_DIAMETER_FRACTION = 0.96;

export type PlayableViewport = {
  top: number;
  bottom: number;
  height: number;
  minimumDimension: number;
};

export type ViewportUiRect = {
  top: number;
  bottom: number;
  height: number;
};

export const playableViewportFor = (
  width: number,
  height: number,
  topInset: number,
  bottomInset: number,
): PlayableViewport => {
  const safeHeight = Math.max(1, height);
  const top = Math.min(safeHeight, Math.max(0, topInset));
  const bottom = Math.max(top, Math.min(safeHeight, safeHeight - Math.max(0, bottomInset)));
  const playableHeight = Math.max(1, bottom - top);
  return {
    top,
    bottom,
    height: playableHeight,
    minimumDimension: Math.min(Math.max(1, width), playableHeight),
  };
};

export const playableViewportForUiRects = (
  width: number,
  height: number,
  topRects: readonly ViewportUiRect[],
  bottomRects: readonly ViewportUiRect[],
) => {
  const visibleTopRects = topRects.filter((rect) => rect.height > 0);
  const visibleBottomRects = bottomRects.filter((rect) => rect.height > 0);
  const topInset = visibleTopRects.length > 0
    ? Math.max(...visibleTopRects.map((rect) => rect.bottom))
    : 0;
  const bottomUiTop = visibleBottomRects.length > 0
    ? Math.min(...visibleBottomRects.map((rect) => rect.top))
    : height;
  return playableViewportFor(width, height, topInset, height - bottomUiTop);
};

export const cameraScaleFor = (viewport: PlayableViewport, viewRadius: number) => {
  return viewport.minimumDimension / (Math.max(0.000001, viewRadius) * CAMERA_VIEW_SCALE);
};

/**
 * The largest world-space view radius that keeps the complete field circle at
 * the requested screen size. A larger view radius zooms farther out.
 */
export const maxViewRadiusForFieldCircle = (fieldRadius: number) => {
  if (!Number.isFinite(fieldRadius) || fieldRadius <= 0) return Number.POSITIVE_INFINITY;
  return (fieldRadius * 2) / (MAX_FIELD_DIAMETER_FRACTION * CAMERA_VIEW_SCALE);
};

export const fieldCircleDiameterFractionFor = (fieldRadius: number, viewRadius: number) => {
  if (!Number.isFinite(fieldRadius) || fieldRadius <= 0 || !Number.isFinite(viewRadius) || viewRadius <= 0) return 0;
  return (fieldRadius * 2) / (viewRadius * CAMERA_VIEW_SCALE);
};

type BoundaryEdge = readonly [[number, number], [number, number]];

export const fieldBoundaryRadiusFor = (
  shards: Iterable<{ boundaryEdges: readonly BoundaryEdge[] }>,
) => {
  let radius = 0;
  for (const shard of shards) {
    for (const [[startX, startY], [endX, endY]] of shard.boundaryEdges) {
      radius = Math.max(radius, Math.hypot(startX, startY), Math.hypot(endX, endY));
    }
  }
  return radius;
};
