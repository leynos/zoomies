import { describe, expect, test } from "bun:test";
import {
  createViewport,
  formatCenter,
  formatZoom,
  getViewBounds,
  panViewport,
  zoomAtPoint,
} from "../src/shared/viewport";

describe("viewport helpers", () => {
  test("computes stable bounds", () => {
    const bounds = getViewBounds(createViewport(800, 600, -0.75, 0.1, 2));
    expect(bounds.width).toBeCloseTo(2);
    expect(bounds.height).toBeCloseTo(1.5);
  });

  test("keeps the selected point anchored while zooming", () => {
    const viewport = createViewport(800, 600, -0.75, 0.1, 1);
    const zoomed = zoomAtPoint(viewport, 0.25, 0.75, 2);
    expect(zoomed.zoom).toBe(2);
    expect(zoomed.centerX).not.toBe(viewport.centerX);
  });

  test("pans opposite the drag direction", () => {
    const viewport = createViewport(800, 600, -0.75, 0.1, 2);
    const panned = panViewport(viewport, 0.1, -0.1);
    expect(panned.centerX).toBeLessThan(viewport.centerX);
    expect(panned.centerY).toBeGreaterThan(viewport.centerY);
  });

  test("formats HUD labels", () => {
    const viewport = createViewport(800, 600, -0.75, 0.1, 2);
    expect(formatCenter(viewport)).toBe("-0.750000, 0.100000");
    expect(formatZoom(2)).toBe("2.00x");
  });
});
