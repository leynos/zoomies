import { describe, expect, test } from "bun:test";
import {
  colorForEscapeValue,
  computeEscapeValue,
  renderImageData,
  renderSegment,
} from "../src/shared/mandelbrot";
import { createViewport } from "../src/shared/viewport";

describe("mandelbrot math", () => {
  test("marks set interior points as interior", () => {
    expect(computeEscapeValue(0, 0, 100)).toBe(-1);
  });

  test("escapes quickly for distant points", () => {
    expect(computeEscapeValue(2, 2, 100)).toBeGreaterThan(0);
  });

  test("maps interior points to black", () => {
    expect(colorForEscapeValue(-1)).toEqual([0, 0, 0]);
  });

  test("renders the requested number of rows", () => {
    const viewport = createViewport(32, 20, -0.75, 0.1, 1);
    const segment = renderSegment(viewport, 5, 10, 80);
    expect(segment.pixels.length).toBe(32 * 5 * 4);
  });

  test("renders full image data with expected dimensions", () => {
    const viewport = createViewport(24, 16, -0.75, 0.1, 1);
    const imageData = renderImageData(viewport, 80);
    expect(imageData.width).toBe(24);
    expect(imageData.height).toBe(16);
  });
});
