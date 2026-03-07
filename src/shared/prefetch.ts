import { createFrameKey } from "./cache";
import { type ViewportState, zoomAtPoint } from "./viewport";

/**
 * Normalized cursor position inside the canvas.
 */
export interface CursorPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Build the most likely follow-up zoom targets for a calm cursor position.
 */
export function createPrefetchTargets(
  viewport: ViewportState,
  cursor: CursorPosition,
): readonly ViewportState[] {
  const zoomFactors = [2, 1.18, 1.18 * 1.18, 0.85];

  return zoomFactors.map((factor) => zoomAtPoint(viewport, cursor.x, cursor.y, factor));
}

/**
 * Remove exact duplicates and already-cached targets before prefetching.
 */
export function filterPrefetchTargets(
  targets: readonly ViewportState[],
  hasFrame: (key: string) => boolean,
): readonly ViewportState[] {
  const seen = new Set<string>();
  const filtered: ViewportState[] = [];

  for (const target of targets) {
    const key = createFrameKey(target.zoom, target.centerX, target.centerY);
    if (seen.has(key) || hasFrame(key)) {
      continue;
    }

    seen.add(key);
    filtered.push(target);
  }

  return filtered;
}
