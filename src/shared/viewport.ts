/**
 * Immutable view state for the Mandelbrot canvas.
 */
export interface ViewportState {
  readonly centerX: number;
  readonly centerY: number;
  readonly height: number;
  readonly width: number;
  readonly zoom: number;
}

/**
 * View bounds in the complex plane.
 */
export interface ViewBounds {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/**
 * Build a viewport from stable inputs.
 */
export function createViewport(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  zoom = 1,
): ViewportState {
  return { centerX, centerY, height, width, zoom };
}

/**
 * Compute the visible complex-plane bounds for a viewport.
 */
export function getViewBounds(viewport: ViewportState): ViewBounds {
  const planeWidth = 4 / viewport.zoom;
  const planeHeight = planeWidth / (viewport.width / viewport.height);

  return {
    left: viewport.centerX - planeWidth / 2,
    top: viewport.centerY - planeHeight / 2,
    width: planeWidth,
    height: planeHeight,
  };
}

/**
 * Translate a normalized pointer location into a complex-plane coordinate.
 */
export function normalizedPointToPlane(
  viewport: ViewportState,
  normalizedX: number,
  normalizedY: number,
) {
  const bounds = getViewBounds(viewport);
  return {
    x: bounds.left + normalizedX * bounds.width,
    y: bounds.top + normalizedY * bounds.height,
  };
}

/**
 * Zoom while keeping the requested point anchored on screen.
 */
export function zoomAtPoint(
  viewport: ViewportState,
  normalizedX: number,
  normalizedY: number,
  factor: number,
): ViewportState {
  const point = normalizedPointToPlane(viewport, normalizedX, normalizedY);
  const nextZoom = viewport.zoom * factor;
  const nextBounds = getViewBounds({ ...viewport, zoom: nextZoom });

  return {
    ...viewport,
    centerX: point.x - (normalizedX - 0.5) * nextBounds.width,
    centerY: point.y - (normalizedY - 0.5) * nextBounds.height,
    zoom: nextZoom,
  };
}

/**
 * Pan by normalized screen deltas.
 */
export function panViewport(
  viewport: ViewportState,
  deltaXNormalized: number,
  deltaYNormalized: number,
): ViewportState {
  const bounds = getViewBounds(viewport);

  return {
    ...viewport,
    centerX: viewport.centerX - deltaXNormalized * bounds.width,
    centerY: viewport.centerY - deltaYNormalized * bounds.height,
  };
}

/**
 * Create a lower-resolution viewport for preview rendering while keeping the same camera.
 */
export function scaleViewportResolution(
  viewport: ViewportState,
  divisor: number,
  minimumWidth = 48,
  minimumHeight = 36,
): ViewportState {
  return {
    ...viewport,
    width: Math.max(minimumWidth, Math.floor(viewport.width / divisor)),
    height: Math.max(minimumHeight, Math.floor(viewport.height / divisor)),
  };
}

/**
 * Format the center for the HUD.
 */
export function formatCenter(viewport: ViewportState) {
  return `${viewport.centerX.toFixed(6)}, ${viewport.centerY.toFixed(6)}`;
}

/**
 * Format zoom in a readable form for the HUD.
 */
export function formatZoom(zoom: number) {
  return zoom >= 1e6 ? `${zoom.toExponential(2)}x` : `${zoom.toFixed(2)}x`;
}
