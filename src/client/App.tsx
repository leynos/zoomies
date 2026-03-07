import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { FrameCache, type FrameQuality } from "../shared/cache";
import {
  DEFAULT_CENTER,
  DEFAULT_SETTINGS,
  type RendererSettings,
  SETTING_DEFINITIONS,
} from "../shared/config";
import {
  type RasterImageData,
  type RenderSegment,
  createRasterImageData,
  renderImageData,
  renderSegment,
} from "../shared/mandelbrot";
import { createPrefetchTargets, filterPrefetchTargets } from "../shared/prefetch";
import {
  type ViewportState,
  createViewport,
  formatCenter,
  formatZoom,
  panViewport,
  zoomAtPoint,
} from "../shared/viewport";
import styles from "./App.module.css";

/**
 * Runtime-facing view metrics for the HUD.
 */
interface RenderMetrics {
  readonly cacheSize: number;
  readonly centerLabel: string;
  readonly progress: number;
  readonly renderTimeMs: string;
  readonly status: string;
  readonly zoomLabel: string;
}

/**
 * Mutable pointer state used for drag and wheel interactions.
 */
interface DragState {
  active: boolean;
  didDrag: boolean;
  lastX: number;
  lastY: number;
}

/**
 * Cursor state used to predict likely next zoom targets.
 */
interface CursorState {
  readonly x: number;
  readonly y: number;
}

/**
 * Immediate fallback surface used while the hi-fi render is still in flight.
 */
type PreviewSurface = "exact" | "loose" | "potato" | "tight";

/**
 * Create a fresh metrics snapshot from a viewport.
 */
function createMetrics(viewport: ViewportState): RenderMetrics {
  return {
    cacheSize: 0,
    centerLabel: formatCenter(viewport),
    progress: 0,
    renderTimeMs: "0",
    status: "Booting",
    zoomLabel: formatZoom(viewport.zoom),
  };
}

/**
 * Produce a smaller preview viewport for quick fallback rendering.
 */
function createPreviewViewport(viewport: ViewportState, divisor: number): ViewportState {
  return {
    ...viewport,
    width: Math.max(48, Math.floor(viewport.width / divisor)),
    height: Math.max(36, Math.floor(viewport.height / divisor)),
  };
}

/**
 * Draw an ImageData to the target canvas, scaling as needed.
 */
function paintImageData(
  context: CanvasRenderingContext2D,
  imageData: RasterImageData,
  targetWidth: number,
  targetHeight: number,
) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) {
    return;
  }

  sourceContext.putImageData(
    createRasterImageData(imageData.data, imageData.width, imageData.height) as ImageData,
    0,
    0,
  );
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, targetWidth, targetHeight);
  context.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
}

/**
 * Draw a low-resolution preview and preserve its crunchy upscaled look.
 */
function paintPotatoPreview(
  context: CanvasRenderingContext2D,
  imageData: RasterImageData,
  targetWidth: number,
  targetHeight: number,
) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) {
    return;
  }

  sourceContext.putImageData(
    createRasterImageData(imageData.data, imageData.width, imageData.height) as ImageData,
    0,
    0,
  );
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "low";
  context.clearRect(0, 0, targetWidth, targetHeight);
  context.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
}

/**
 * Draw a scaled approximation from a cached frame.
 */
function paintApproximation(
  context: CanvasRenderingContext2D,
  entry: RasterImageData,
  cachedViewport: ViewportState,
  targetViewport: ViewportState,
) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = entry.width;
  sourceCanvas.height = entry.height;
  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) {
    return;
  }

  sourceContext.putImageData(
    createRasterImageData(entry.data, entry.width, entry.height) as ImageData,
    0,
    0,
  );

  const scale = targetViewport.zoom / cachedViewport.zoom;
  const sourceWidth = targetViewport.width / scale;
  const sourceHeight = targetViewport.height / scale;
  const planeWidth = 4 / cachedViewport.zoom;
  const planeHeight = planeWidth / (cachedViewport.width / cachedViewport.height);
  const offsetX =
    ((targetViewport.centerX - cachedViewport.centerX) / planeWidth) * cachedViewport.width;
  const offsetY =
    ((targetViewport.centerY - cachedViewport.centerY) / planeHeight) * cachedViewport.height;
  const sourceX = (cachedViewport.width - sourceWidth) / 2 + offsetX;
  const sourceY = (cachedViewport.height - sourceHeight) / 2 + offsetY;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, targetViewport.width, targetViewport.height);
  context.drawImage(
    sourceCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    targetViewport.width,
    targetViewport.height,
  );
}

/**
 * Merge a rendered segment into an in-progress RGBA buffer.
 */
function applySegment(
  targetPixels: Uint8ClampedArray,
  viewport: ViewportState,
  segment: RenderSegment,
) {
  const rowWidth = viewport.width * 4;
  const destinationOffset = segment.startRow * rowWidth;
  targetPixels.set(segment.pixels, destinationOffset);
}

/**
 * Paint a completed render strip over the current frame without clearing the canvas.
 */
function paintSegment(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  segment: RenderSegment,
) {
  const segmentHeight = segment.endRow - segment.startRow;
  const segmentImage = createRasterImageData(segment.pixels, viewport.width, segmentHeight);

  context.putImageData(segmentImage as ImageData, 0, segment.startRow);
}

/**
 * Render the current viewport in chunks to keep the UI responsive.
 */
async function renderProgressively(
  viewport: ViewportState,
  maxIterations: number,
  onSegment: (segment: RenderSegment, progress: number) => void,
) {
  const rowsPerChunk = Math.max(8, Math.floor(viewport.height / 24));

  for (let startRow = 0; startRow < viewport.height; startRow += rowsPerChunk) {
    const endRow = Math.min(viewport.height, startRow + rowsPerChunk);
    const segment = renderSegment(viewport, startRow, endRow, maxIterations);
    onSegment(segment, endRow / viewport.height);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}

/**
 * Paint the best currently available preview for the requested viewport.
 */
function paintPreviewSurface(
  context: CanvasRenderingContext2D,
  cache: FrameCache,
  viewport: ViewportState,
  settings: RendererSettings,
): PreviewSurface {
  const exactHit = cache.getExact(viewport);
  if (exactHit) {
    if (exactHit.quality === "preview") {
      paintPotatoPreview(context, exactHit.imageData, viewport.width, viewport.height);
      return "potato";
    }

    paintImageData(context, exactHit.imageData, viewport.width, viewport.height);
    return "exact";
  }

  const tightFrame = cache.findNearest(
    viewport,
    settings.centerTolerance,
    settings.zoomTolerance,
    "tight",
  );
  if (tightFrame) {
    if (tightFrame.quality === "preview") {
      paintPotatoPreview(context, tightFrame.imageData, viewport.width, viewport.height);
      return "potato";
    }

    paintApproximation(
      context,
      tightFrame.imageData,
      {
        ...viewport,
        centerX: tightFrame.centerX,
        centerY: tightFrame.centerY,
        zoom: tightFrame.zoom,
      },
      viewport,
    );
    return "tight";
  }

  const looseFrame = cache.findNearest(
    viewport,
    settings.centerTolerance,
    settings.zoomTolerance,
    "loose",
  );
  if (looseFrame) {
    if (looseFrame.quality === "preview") {
      paintPotatoPreview(context, looseFrame.imageData, viewport.width, viewport.height);
      return "potato";
    }

    paintApproximation(
      context,
      looseFrame.imageData,
      {
        ...viewport,
        centerX: looseFrame.centerX,
        centerY: looseFrame.centerY,
        zoom: looseFrame.zoom,
      },
      viewport,
    );
    return "loose";
  }

  const preview = renderImageData(
    createPreviewViewport(viewport, settings.previewDivisor),
    settings.maxIterations,
  );
  paintPotatoPreview(context, preview, viewport.width, viewport.height);
  return "potato";
}

/**
 * Main application component.
 */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<RendererSettings>(DEFAULT_SETTINGS);
  const cacheRef = useRef(new FrameCache(() => settingsRef.current.maxCacheEntries));
  const renderTokenRef = useRef(0);
  const prefetchTokenRef = useRef(0);
  const prefetchTimerRef = useRef<number | null>(null);
  const cancelPrefetchRef = useRef<() => void>(() => {});
  const schedulePrefetchRef = useRef<() => void>(() => {});
  const isPrimaryRenderingRef = useRef(false);
  const isPrefetchingRef = useRef(false);
  const latestViewportRef = useRef<ViewportState>(
    createViewport(1280, 720, DEFAULT_CENTER.x, DEFAULT_CENTER.y, 1),
  );
  const cursorRef = useRef<CursorState>({ x: 0.5, y: 0.5 });
  const dragRef = useRef<DragState>({ active: false, didDrag: false, lastX: 0, lastY: 0 });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [viewport, setViewport] = useState(() =>
    createViewport(1280, 720, DEFAULT_CENTER.x, DEFAULT_CENTER.y, 1),
  );
  const [metrics, setMetrics] = useState(() => createMetrics(viewport));

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    latestViewportRef.current = viewport;
  }, [viewport]);

  /**
   * Cancel in-flight or queued speculative renders.
   */
  cancelPrefetchRef.current = () => {
    prefetchTokenRef.current += 1;
    isPrefetchingRef.current = false;

    if (prefetchTimerRef.current !== null) {
      window.clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  };

  /**
   * Render likely follow-up zoom targets into the cache once the cursor is calm.
   */
  schedulePrefetchRef.current = () => {
    cancelPrefetchRef.current();

    prefetchTimerRef.current = window.setTimeout(() => {
      if (isPrimaryRenderingRef.current || isPrefetchingRef.current) {
        return;
      }

      const token = ++prefetchTokenRef.current;
      const viewportForPrefetch = latestViewportRef.current;
      const targets = filterPrefetchTargets(
        createPrefetchTargets(viewportForPrefetch, cursorRef.current),
        (key) => {
          const [zoom, centerX, centerY] = key.split("_");

          return cacheRef.current.hasFrame(Number(zoom), Number(centerX), Number(centerY));
        },
      );

      if (targets.length === 0) {
        return;
      }

      isPrefetchingRef.current = true;

      void (async () => {
        try {
          for (const target of targets) {
            if (token !== prefetchTokenRef.current || isPrimaryRenderingRef.current) {
              return;
            }

            const imageData =
              target.quality === "preview"
                ? renderImageData(
                    createPreviewViewport(
                      target.viewport,
                      Math.max(2, settingsRef.current.previewDivisor - 2),
                    ),
                    settingsRef.current.maxIterations,
                  )
                : renderImageData(target.viewport, settingsRef.current.maxIterations);
            cacheRef.current.store({
              centerX: target.viewport.centerX,
              centerY: target.viewport.centerY,
              imageData,
              quality: target.quality,
              zoom: target.viewport.zoom,
            });
            setMetrics((current) => ({
              ...current,
              cacheSize: cacheRef.current.size(),
            }));

            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => resolve());
            });
          }
        } finally {
          if (token === prefetchTokenRef.current) {
            isPrefetchingRef.current = false;
          }
        }
      })();
    }, 250);
  };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const nextWidth = Math.max(320, Math.floor(entry.contentRect.width));
      const nextHeight = Math.max(320, Math.floor(entry.contentRect.height));

      canvas.width = nextWidth;
      canvas.height = nextHeight;
      cacheRef.current.clear();
      setViewport((current) => ({
        ...current,
        width: nextWidth,
        height: nextHeight,
      }));
    });

    resizeObserver.observe(container);
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const point = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
      const factor = event.deltaY > 0 ? 0.85 : 1.18;
      setViewport((current) => zoomAtPoint(current, point.x, point.y, factor));
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    renderTokenRef.current += 1;
    cancelPrefetchRef.current();
    isPrimaryRenderingRef.current = true;
    const renderToken = renderTokenRef.current;
    const startedAt = performance.now();
    const activeSettings = settingsRef.current;
    const exactHit = cacheRef.current.getExact(viewport);

    setMetrics((current) => ({
      ...current,
      cacheSize: cacheRef.current.size(),
      centerLabel: formatCenter(viewport),
      progress: exactHit?.quality === "full" ? 1 : 0,
      status: exactHit?.quality === "full" ? "Cache hit" : "Rendering",
      zoomLabel: formatZoom(viewport.zoom),
    }));

    if (exactHit) {
      if (exactHit.quality === "full") {
        paintImageData(context, exactHit.imageData, viewport.width, viewport.height);
        isPrimaryRenderingRef.current = false;
        setMetrics((current) => ({
          ...current,
          progress: 1,
          renderTimeMs: "<1",
        }));
        schedulePrefetchRef.current();
        return;
      }

      paintPotatoPreview(context, exactHit.imageData, viewport.width, viewport.height);
    }

    const previewSurface = paintPreviewSurface(context, cacheRef.current, viewport, activeSettings);
    setMetrics((current) => ({
      ...current,
      status:
        previewSurface === "tight" ? "Approx" : previewSurface === "loose" ? "Stretch" : "Potato",
    }));

    const finalPixels = new Uint8ClampedArray(viewport.width * viewport.height * 4);
    const timer = window.setTimeout(() => {
      void renderProgressively(viewport, activeSettings.maxIterations, (segment, progress) => {
        if (renderToken !== renderTokenRef.current) {
          return;
        }

        applySegment(finalPixels, viewport, segment);
        paintSegment(context, viewport, segment);

        if (progress >= 1) {
          const finalImage = createRasterImageData(finalPixels, viewport.width, viewport.height);
          cacheRef.current.store({
            centerX: viewport.centerX,
            centerY: viewport.centerY,
            imageData: finalImage,
            quality: "full",
            zoom: viewport.zoom,
          });
          isPrimaryRenderingRef.current = false;
          schedulePrefetchRef.current();
        }

        setMetrics((current) => ({
          ...current,
          cacheSize: cacheRef.current.size(),
          progress,
          renderTimeMs: (performance.now() - startedAt).toFixed(1),
          status: progress >= 1 ? "Ready" : "Rendering",
        }));
      });
    }, activeSettings.debounceMs);

    return () => {
      window.clearTimeout(timer);
      isPrimaryRenderingRef.current = false;
    };
  }, [viewport]);

  /**
   * Update one renderer setting.
   */
  function updateSetting<Key extends keyof RendererSettings>(
    key: Key,
    value: RendererSettings[Key],
  ) {
    cancelPrefetchRef.current();
    cacheRef.current.clear();
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
    setViewport((current) => ({ ...current }));
  }

  /**
   * Reset all settings and clear the cache.
   */
  function resetSettings() {
    cancelPrefetchRef.current();
    cacheRef.current.clear();
    setSettings(DEFAULT_SETTINGS);
    setMetrics((current) => ({
      ...current,
      cacheSize: 0,
      status: "Reset",
    }));
    setViewport((current) => ({ ...current }));
  }

  /**
   * Clear cached frames without changing the camera.
   */
  function flushCache() {
    cancelPrefetchRef.current();
    cacheRef.current.clear();
    setMetrics((current) => ({
      ...current,
      cacheSize: 0,
      status: "Cache cleared",
    }));
    setViewport((current) => ({ ...current }));
  }

  /**
   * Convert an event into normalized canvas coordinates.
   */
  function getCanvasPoint(event: MouseEvent | ReactMouseEvent<HTMLCanvasElement, MouseEvent>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0.5, y: 0.5 };
    }

    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  /**
   * Begin drag panning.
   */
  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    dragRef.current = {
      active: true,
      didDrag: false,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  /**
   * Continue drag panning when active.
   */
  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = getCanvasPoint(event.nativeEvent);
    cursorRef.current = point;

    if (!dragRef.current.active) {
      schedulePrefetchRef.current();
      return;
    }

    const deltaX = (event.clientX - dragRef.current.lastX) / viewport.width;
    const deltaY = (event.clientY - dragRef.current.lastY) / viewport.height;

    dragRef.current = {
      active: true,
      didDrag: true,
      lastX: event.clientX,
      lastY: event.clientY,
    };

    setViewport((current) => panViewport(current, deltaX, deltaY));
  }

  /**
   * End drag panning.
   */
  function handlePointerUp() {
    dragRef.current.active = false;
  }

  /**
   * Handle click zooming when not dragging.
   */
  function handleClick(event: ReactMouseEvent<HTMLCanvasElement, MouseEvent>) {
    if (dragRef.current.didDrag) {
      dragRef.current.didDrag = false;
      return;
    }

    const point = getCanvasPoint(event);
    setViewport((current) => zoomAtPoint(current, point.x, point.y, 2));
  }

  /**
   * Handle context-menu zooming out.
   */
  function handleContextMenu(event: ReactMouseEvent<HTMLCanvasElement, MouseEvent>) {
    event.preventDefault();
    const point = getCanvasPoint(event);
    setViewport((current) => zoomAtPoint(current, point.x, point.y, 0.5));
  }

  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <aside className={styles.sidebar}>
          <section className={styles.panel}>
            <span className={styles.eyebrow}>Zoomies</span>
            <h1 className={styles.headline}>Mandelbrot explorer with a sane architecture.</h1>
            <p className={styles.lede}>
              Scroll to zoom, drag to pan, click to dive deeper, and right-click to pull back. The
              viewer keeps a local frame cache and progressively paints each render so the UI stays
              responsive.
            </p>
            <div className={styles.stats}>
              <article className={styles.statCard}>
                <span className={styles.statLabel}>Zoom</span>
                <span className={styles.statValue}>{metrics.zoomLabel}</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statLabel}>Center</span>
                <span className={styles.statValue}>{metrics.centerLabel}</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statLabel}>Status</span>
                <span className={styles.statValue}>{metrics.status}</span>
              </article>
              <article className={styles.statCard}>
                <span className={styles.statLabel}>Render</span>
                <span className={styles.statValue}>{metrics.renderTimeMs} ms</span>
              </article>
            </div>
          </section>

          <section className={styles.panel}>
            <header className={styles.controlHeader}>
              <h2 className={styles.controlTitle}>Renderer</h2>
              <span className={styles.helperText}>{metrics.cacheSize} cached frames</span>
            </header>
            <div className={styles.controlsList}>
              {SETTING_DEFINITIONS.map((definition) => (
                <label className={styles.controlItem} key={definition.key}>
                  <span className={styles.controlMeta}>
                    <span>{definition.label}</span>
                    <span>
                      {definition.formatValue
                        ? definition.formatValue(settings[definition.key])
                        : settings[definition.key]}
                    </span>
                  </span>
                  <input
                    className={styles.range}
                    type="range"
                    min={definition.min}
                    max={definition.max}
                    step={definition.step}
                    value={settings[definition.key]}
                    onChange={(event) =>
                      updateSetting(definition.key, Number(event.currentTarget.value))
                    }
                  />
                </label>
              ))}
            </div>
            <p className={styles.helperText}>
              Higher iteration counts sharpen detail but increase render cost. Tight tolerance
              favors correctness over aggressive cache reuse.
            </p>
            <div className={styles.buttonRow}>
              <button className={styles.button} type="button" onClick={flushCache}>
                Flush Cache
              </button>
              <button
                className={`${styles.button} ${styles.buttonDanger}`}
                type="button"
                onClick={resetSettings}
              >
                Reset Defaults
              </button>
            </div>
          </section>
        </aside>

        <section className={styles.viewer} aria-label="Fractal viewer">
          <div className={styles.canvasWrap} ref={containerRef}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              aria-label="Interactive Mandelbrot canvas"
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  setViewport((current) => zoomAtPoint(current, 0.5, 0.5, 2));
                }

                if (event.key === "ArrowLeft") {
                  setViewport((current) => panViewport(current, 0.08, 0));
                }

                if (event.key === "ArrowRight") {
                  setViewport((current) => panViewport(current, -0.08, 0));
                }

                if (event.key === "ArrowUp") {
                  setViewport((current) => panViewport(current, 0, 0.08));
                }

                if (event.key === "ArrowDown") {
                  setViewport((current) => panViewport(current, 0, -0.08));
                }
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              tabIndex={0}
            />
            <div className={`${styles.panel} ${styles.overlay}`}>
              <progress className={styles.statusMeter} value={metrics.progress} max={1} />
              <p className={styles.instructions}>
                Cache reuse is opportunistic, but every final frame is recalculated from the current
                viewport. That avoids the blurry stretch artifacts the old single-file version
                drifted into.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
