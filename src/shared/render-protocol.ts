import type { FrameQuality } from "./cache";
import type { RasterImageData } from "./mandelbrot";
import type { ViewportState } from "./viewport";

/**
 * Request sent from the browser app to a speculative render worker.
 */
export interface PrefetchRenderRequest {
  readonly id: number;
  readonly maxIterations: number;
  readonly previewDivisor: number;
  readonly quality: FrameQuality;
  readonly viewport: ViewportState;
}

/**
 * Response sent back from a speculative render worker.
 */
export interface PrefetchRenderResponse {
  readonly id: number;
  readonly imageData: RasterImageData;
  readonly quality: FrameQuality;
  readonly viewport: ViewportState;
}
