import { describe, expect, test } from "bun:test";
import { createPrefetchTargets, filterPrefetchTargets } from "../src/shared/prefetch";
import { createViewport } from "../src/shared/viewport";

describe("prefetch target generation", () => {
  test("creates zoom-in and zoom-out candidates around the cursor", () => {
    const viewport = createViewport(800, 600, -0.75, 0.1, 1);
    const targets = createPrefetchTargets(viewport, { x: 0.25, y: 0.75 });

    expect(targets).toHaveLength(8);
    expect(targets[0]?.viewport.zoom).toBe(2);
    expect(targets[4]?.viewport.zoom).toBeCloseTo(0.72);
    expect(targets[7]?.viewport.zoom).toBeCloseTo(0.35);
    expect(targets[7]?.quality).toBe("preview");
    expect(targets[0]?.viewport.centerX).not.toBe(viewport.centerX);
  });

  test("drops already-cached targets and duplicates", () => {
    const viewport = createViewport(800, 600, -0.75, 0.1, 1);
    const targets = createPrefetchTargets(viewport, { x: 0.5, y: 0.5 });
    const firstTarget = targets[0];

    expect(firstTarget).toBeDefined();
    if (!firstTarget) {
      throw new Error("Expected a prefetch target.");
    }

    const cachedKey = `${firstTarget.viewport.zoom.toFixed(8)}_${firstTarget.viewport.centerX.toFixed(14)}_${firstTarget.viewport.centerY.toFixed(14)}`;
    const filtered = filterPrefetchTargets([...targets, firstTarget], (key) => key === cachedKey);

    expect(filtered).toHaveLength(7);
    expect(filtered.some((target) => target.viewport.zoom === firstTarget.viewport.zoom)).toBe(
      false,
    );
  });
});
