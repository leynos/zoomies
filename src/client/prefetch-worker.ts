/// <reference lib="webworker" />

import { renderImageData } from "../shared/mandelbrot";
import type { PrefetchRenderRequest, PrefetchRenderResponse } from "../shared/render-protocol";
import { scaleViewportResolution } from "../shared/viewport";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<PrefetchRenderRequest>) => {
  const request = event.data;
  const renderViewport =
    request.quality === "preview"
      ? scaleViewportResolution(request.viewport, Math.max(2, request.previewDivisor - 2))
      : request.viewport;
  const imageData = renderImageData(renderViewport, request.maxIterations);
  const response: PrefetchRenderResponse = {
    id: request.id,
    imageData,
    quality: request.quality,
    viewport: request.viewport,
  };

  self.postMessage(response);
};
