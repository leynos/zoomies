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
 * Planned speculative render target with a quality hint.
 */
export interface PrefetchTarget {
  readonly quality: "full" | "preview";
  readonly viewport: ViewportState;
}

/**
 * Build the most likely follow-up zoom targets for a calm cursor position.
 */
export function createPrefetchTargets(
  viewport: ViewportState,
  cursor: CursorPosition,
): readonly PrefetchTarget[] {
  const fullFactors = [2, 1.18, 1.18 * 1.18, 0.85, 0.72];
  const previewFactors = [0.61, 0.5, 0.35];

  return [
    ...fullFactors.map((factor) => ({
      quality: "full" as const,
      viewport: zoomAtPoint(viewport, cursor.x, cursor.y, factor),
    })),
    ...previewFactors.map((factor) => ({
      quality: "preview" as const,
      viewport: zoomAtPoint(viewport, cursor.x, cursor.y, factor),
    })),
  ];
}

/**
 * Remove exact duplicates and already-cached targets before prefetching.
 */
export function filterPrefetchTargets(
  targets: readonly PrefetchTarget[],
  hasFrame: (key: string) => boolean,
): readonly PrefetchTarget[] {
  const seen = new Set<string>();
  const filtered: PrefetchTarget[] = [];

  for (const target of targets) {
    const key = createFrameKey(
      target.viewport.zoom,
      target.viewport.centerX,
      target.viewport.centerY,
    );
    if (seen.has(key) || hasFrame(key)) {
      continue;
    }

    seen.add(key);
    filtered.push(target);
  }

  return filtered;
}
