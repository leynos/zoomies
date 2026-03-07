import type { RasterImageData } from "./mandelbrot";
import { type ViewportState, getViewBounds } from "./viewport";

/**
 * Cached image and its camera state.
 */
export type FrameQuality = "full" | "preview";

/**
 * Cached image and its camera state.
 */
export interface FrameEntry {
  readonly centerX: number;
  readonly centerY: number;
  readonly imageData: RasterImageData;
  readonly quality: FrameQuality;
  readonly zoom: number;
}

/**
 * Historical cache entry annotated with its distance from the active viewport.
 */
export interface CacheHistoryEntry {
  readonly centerX: number;
  readonly centerY: number;
  readonly centerDistance: number;
  readonly centerDistanceX: number;
  readonly centerDistanceY: number;
  readonly isExact: boolean;
  readonly quality: FrameQuality;
  readonly score: number;
  readonly strength: number;
  readonly zoom: number;
  readonly zoomDistance: number;
}

/**
 * Search quality used when looking up nearby cached frames.
 */
export type LookupMode = "loose" | "tight";

/**
 * Stateful frame cache with deterministic eviction.
 */
export class FrameCache {
  readonly #entries = new Map<string, FrameEntry>();

  constructor(private readonly maxEntries: () => number) {}

  /**
   * Remove every cached frame.
   */
  clear() {
    this.#entries.clear();
  }

  /**
   * Current number of cached entries.
   */
  size() {
    return this.#entries.size;
  }

  /**
   * Store a rendered frame.
   */
  store(entry: FrameEntry) {
    const key = createFrameKey(entry.zoom, entry.centerX, entry.centerY);

    while (this.#entries.size >= this.maxEntries()) {
      this.evictWorst(entry.centerX, entry.centerY, entry.zoom);
    }

    this.#entries.delete(key);
    this.#entries.set(key, entry);
  }

  /**
   * Return an exact camera match when one exists.
   */
  getExact(viewport: ViewportState) {
    return this.#entries.get(createFrameKey(viewport.zoom, viewport.centerX, viewport.centerY));
  }

  /**
   * Return whether an exact frame already exists for the provided camera.
   */
  hasFrame(zoom: number, centerX: number, centerY: number) {
    return this.#entries.has(createFrameKey(zoom, centerX, centerY));
  }

  /**
   * Describe cached frames in most-recent-first order and annotate proximity to the viewport.
   */
  describeHistory(viewport: ViewportState, limit = this.#entries.size) {
    return Array.from(this.#entries.values())
      .reverse()
      .map((entry) => describeCacheHistoryEntry(viewport, entry))
      .slice(0, limit);
  }

  /**
   * Find the nearest acceptable approximation.
   */
  findNearest(
    viewport: ViewportState,
    centerTolerance: number,
    zoomTolerance: number,
    mode: LookupMode,
  ) {
    const bounds = getViewBounds(viewport);
    let bestEntry: FrameEntry | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const entry of this.#entries.values()) {
      const centerDistanceX = Math.abs(entry.centerX - viewport.centerX) / bounds.width;
      const centerDistanceY = Math.abs(entry.centerY - viewport.centerY) / bounds.width;
      const zoomDistance = Math.abs(Math.log(entry.zoom) - Math.log(viewport.zoom));

      if (mode === "tight") {
        if (Math.abs(entry.centerX - viewport.centerX) > bounds.width * centerTolerance) {
          continue;
        }

        if (Math.abs(entry.centerY - viewport.centerY) > bounds.width * centerTolerance) {
          continue;
        }

        if (zoomDistance > zoomTolerance) {
          continue;
        }
      } else {
        if (Math.max(centerDistanceX, centerDistanceY) > 5 || zoomDistance > 2.5) {
          continue;
        }
      }

      const score = Math.max(centerDistanceX, centerDistanceY) * 2 + zoomDistance;
      if (score < bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    return bestEntry;
  }

  /**
   * Drop frames too far away from the current center.
   */
  pruneFar(viewport: ViewportState, radiusMultiplier: number) {
    const bounds = getViewBounds(viewport);
    const threshold = bounds.width * radiusMultiplier;

    for (const [key, entry] of this.#entries.entries()) {
      if (
        Math.abs(entry.centerX - viewport.centerX) > threshold ||
        Math.abs(entry.centerY - viewport.centerY) > threshold
      ) {
        this.#entries.delete(key);
      }
    }
  }

  /**
   * Remove the least relevant entry according to center and zoom distance.
   */
  private evictWorst(centerX: number, centerY: number, zoom: number) {
    let worstKey = "";
    let worstScore = Number.NEGATIVE_INFINITY;
    const baseWidth = 4 / zoom;

    for (const [key, entry] of this.#entries.entries()) {
      const score =
        (Math.hypot(entry.centerX - centerX, entry.centerY - centerY) / baseWidth) * 2 +
        Math.abs(Math.log(entry.zoom) - Math.log(zoom));
      if (score > worstScore) {
        worstScore = score;
        worstKey = key;
      }
    }

    if (worstKey) {
      this.#entries.delete(worstKey);
    }
  }
}

/**
 * Produce a stable lookup key for a frame.
 */
export function createFrameKey(zoom: number, centerX: number, centerY: number) {
  return `${zoom.toFixed(8)}_${centerX.toFixed(14)}_${centerY.toFixed(14)}`;
}

/**
 * Compute how useful a cached frame is for the active viewport.
 */
export function describeCacheHistoryEntry(
  viewport: ViewportState,
  entry: FrameEntry,
): CacheHistoryEntry {
  const bounds = getViewBounds(viewport);
  const centerDistanceX = Math.abs(entry.centerX - viewport.centerX) / bounds.width;
  const centerDistanceY = Math.abs(entry.centerY - viewport.centerY) / bounds.height;
  const centerDistance = Math.max(centerDistanceX, centerDistanceY);
  const zoomDistance = Math.abs(Math.log(entry.zoom) - Math.log(viewport.zoom));
  const score = centerDistance * 2 + zoomDistance;

  return {
    centerX: entry.centerX,
    centerY: entry.centerY,
    centerDistance,
    centerDistanceX,
    centerDistanceY,
    isExact: centerDistance === 0 && zoomDistance === 0,
    quality: entry.quality,
    score,
    strength: 1 / (1 + score),
    zoom: entry.zoom,
    zoomDistance,
  };
}
