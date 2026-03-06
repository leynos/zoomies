import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { FrameCache } from "../shared/cache";
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
 * Main application component.
 */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<RendererSettings>(DEFAULT_SETTINGS);
  const cacheRef = useRef(new FrameCache(() => settingsRef.current.maxCacheEntries));
  const renderTokenRef = useRef(0);
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
    return () => resizeObserver.disconnect();
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
    const renderToken = renderTokenRef.current;
    const startedAt = performance.now();
    const activeSettings = settingsRef.current;
    const exactHit = cacheRef.current.getExact(viewport);

    setMetrics((current) => ({
      ...current,
      cacheSize: cacheRef.current.size(),
      centerLabel: formatCenter(viewport),
      progress: exactHit ? 1 : 0,
      status: exactHit ? "Cache hit" : "Rendering",
      zoomLabel: formatZoom(viewport.zoom),
    }));

    if (exactHit) {
      paintImageData(context, exactHit.imageData, viewport.width, viewport.height);
      setMetrics((current) => ({
        ...current,
        progress: 1,
        renderTimeMs: "<1",
      }));
      return;
    }

    const nearFrame = cacheRef.current.findNearest(
      viewport,
      activeSettings.centerTolerance,
      activeSettings.zoomTolerance,
      "tight",
    );
    if (nearFrame) {
      paintApproximation(
        context,
        nearFrame.imageData,
        {
          ...viewport,
          centerX: nearFrame.centerX,
          centerY: nearFrame.centerY,
          zoom: nearFrame.zoom,
        },
        viewport,
      );
    } else {
      const preview = renderImageData(
        createPreviewViewport(viewport, activeSettings.previewDivisor),
        activeSettings.maxIterations,
      );
      paintImageData(context, preview, viewport.width, viewport.height);
    }

    const finalPixels = new Uint8ClampedArray(viewport.width * viewport.height * 4);
    const timer = window.setTimeout(() => {
      void renderProgressively(viewport, activeSettings.maxIterations, (segment, progress) => {
        if (renderToken !== renderTokenRef.current) {
          return;
        }

        applySegment(finalPixels, viewport, segment);

        const partialImage = createRasterImageData(
          finalPixels.slice(),
          viewport.width,
          viewport.height,
        );
        paintImageData(context, partialImage, viewport.width, viewport.height);

        if (progress >= 1) {
          const finalImage = createRasterImageData(finalPixels, viewport.width, viewport.height);
          cacheRef.current.store({
            centerX: viewport.centerX,
            centerY: viewport.centerY,
            imageData: finalImage,
            zoom: viewport.zoom,
          });
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
    };
  }, [viewport]);

  /**
   * Update one renderer setting.
   */
  function updateSetting<Key extends keyof RendererSettings>(
    key: Key,
    value: RendererSettings[Key],
  ) {
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
   * Handle zooming with the mouse wheel.
   */
  function handleWheel(event: ReactWheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const point = getCanvasPoint(event.nativeEvent);
    const factor = event.deltaY > 0 ? 0.85 : 1.18;
    setViewport((current) => zoomAtPoint(current, point.x, point.y, factor));
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
    if (!dragRef.current.active) {
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
              onWheel={handleWheel}
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
