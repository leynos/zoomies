import { type ViewportState, getViewBounds } from "./viewport";

/**
 * RGB triple used by the palette helper.
 */
export type RgbColor = readonly [number, number, number];

/**
 * Raw segment render result.
 */
export interface RenderSegment {
  readonly endRow: number;
  readonly pixels: Uint8ClampedArray;
  readonly startRow: number;
}

/**
 * Runtime-neutral raster data used by both browser rendering and Bun tests.
 */
export interface RasterImageData {
  readonly data: Uint8ClampedArray;
  readonly height: number;
  readonly width: number;
}

/**
 * Approximate escape-time result for a point in the Mandelbrot set.
 */
export function computeEscapeValue(real: number, imaginary: number, maxIterations: number): number {
  let zx = 0;
  let zy = 0;
  let iteration = 0;

  const cardioidQ = (real - 0.25) * (real - 0.25) + imaginary * imaginary;
  if (cardioidQ * (cardioidQ + (real - 0.25)) <= 0.25 * imaginary * imaginary) {
    return -1;
  }

  if ((real + 1) * (real + 1) + imaginary * imaginary <= 0.0625) {
    return -1;
  }

  while (zx * zx + zy * zy <= 4 && iteration < maxIterations) {
    const nextReal = zx * zx - zy * zy + real;
    zy = 2 * zx * zy + imaginary;
    zx = nextReal;
    iteration += 1;
  }

  if (iteration >= maxIterations) {
    return -1;
  }

  const magnitudeSquared = zx * zx + zy * zy;
  const logMagnitude = Math.log(magnitudeSquared) / 2;

  return iteration + 1 - Math.log(logMagnitude / Math.log(2)) / Math.log(2);
}

/**
 * Map a smooth escape value to a vivid color palette.
 */
export function colorForEscapeValue(value: number): RgbColor {
  if (value < 0) {
    return [0, 0, 0];
  }

  const normalized = Math.max(0, Math.min(1, value / 50));

  return [
    Math.floor(9 * (1 - normalized) * normalized ** 3 * 255),
    Math.floor(15 * (1 - normalized) ** 2 * normalized ** 2 * 255),
    Math.floor(8.5 * (1 - normalized) ** 3 * normalized * 255),
  ];
}

/**
 * Render a contiguous set of rows into an RGBA byte array.
 */
export function renderSegment(
  viewport: ViewportState,
  startRow: number,
  endRow: number,
  maxIterations: number,
): RenderSegment {
  const bounds = getViewBounds(viewport);
  const pixels = new Uint8ClampedArray((endRow - startRow) * viewport.width * 4);

  for (let row = startRow; row < endRow; row += 1) {
    for (let column = 0; column < viewport.width; column += 1) {
      const real = bounds.left + (column / viewport.width) * bounds.width;
      const imaginary = bounds.top + (row / viewport.height) * bounds.height;
      const escapeValue = computeEscapeValue(real, imaginary, maxIterations);
      const [red, green, blue] = colorForEscapeValue(escapeValue);
      const offset = ((row - startRow) * viewport.width + column) * 4;

      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = 255;
    }
  }

  return { endRow, pixels, startRow };
}

/**
 * Render a full image synchronously.
 */
export function renderImageData(viewport: ViewportState, maxIterations: number): RasterImageData {
  const fullSegment = renderSegment(viewport, 0, viewport.height, maxIterations);
  return createRasterImageData(fullSegment.pixels, viewport.width, viewport.height);
}

/**
 * Create browser-native image data when available, otherwise return a plain raster object.
 */
export function createRasterImageData(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): RasterImageData {
  if (typeof ImageData !== "undefined") {
    return new ImageData(new Uint8ClampedArray(pixels), width, height);
  }

  return {
    data: new Uint8ClampedArray(pixels),
    height,
    width,
  };
}
