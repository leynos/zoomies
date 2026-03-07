import { describe, expect, test } from "bun:test";
import { FrameCache, describeCacheHistoryEntry } from "../src/shared/cache";
import { createViewport } from "../src/shared/viewport";

/**
 * Create deterministic fake image data for cache tests.
 */
function makeImageData() {
  return {
    width: 10,
    height: 10,
    data: new Uint8ClampedArray(400),
  } as unknown as ImageData;
}

describe("FrameCache", () => {
  test("returns exact hits using camera-derived keys", () => {
    const cache = new FrameCache(() => 4);
    const viewport = createViewport(400, 300, -0.75, 0.1, 4);
    cache.store({
      centerX: viewport.centerX,
      centerY: viewport.centerY,
      imageData: makeImageData(),
      quality: "full",
      zoom: viewport.zoom,
    });

    expect(cache.getExact(viewport)).not.toBeNull();
  });

  test("finds a nearby tight match when the view is close enough", () => {
    const cache = new FrameCache(() => 4);
    cache.store({
      centerX: -0.75,
      centerY: 0.1,
      imageData: makeImageData(),
      quality: "full",
      zoom: 4,
    });

    const hit = cache.findNearest(
      createViewport(400, 300, -0.745, 0.105, 4.1),
      0.28,
      0.42,
      "tight",
    );
    expect(hit?.zoom).toBe(4);
  });

  test("finds a loose match when the view is farther away", () => {
    const cache = new FrameCache(() => 4);
    cache.store({
      centerX: -0.75,
      centerY: 0.1,
      imageData: makeImageData(),
      quality: "full",
      zoom: 4,
    });

    const hit = cache.findNearest(createViewport(400, 300, -0.2, 0.5, 3.2), 0.28, 0.42, "loose");
    expect(hit?.zoom).toBe(4);
  });

  test("evicts the least relevant frame when capacity is exceeded", () => {
    const cache = new FrameCache(() => 2);
    cache.store({ centerX: 0, centerY: 0, imageData: makeImageData(), quality: "full", zoom: 1 });
    cache.store({
      centerX: 10,
      centerY: 10,
      imageData: makeImageData(),
      quality: "full",
      zoom: 1,
    });
    cache.store({
      centerX: 0.1,
      centerY: 0.1,
      imageData: makeImageData(),
      quality: "full",
      zoom: 1.1,
    });

    expect(cache.size()).toBe(2);
    expect(cache.getExact(createViewport(400, 300, 10, 10, 1))).toBeUndefined();
  });

  test("describes exact matches with maximum strength", () => {
    const viewport = createViewport(400, 300, -0.75, 0.1, 4);

    const summary = describeCacheHistoryEntry(viewport, {
      centerX: -0.75,
      centerY: 0.1,
      imageData: makeImageData(),
      quality: "full",
      zoom: 4,
    });

    expect(summary.isExact).toBe(true);
    expect(summary.score).toBe(0);
    expect(summary.strength).toBe(1);
  });

  test("returns recent cache history with nearest frames scoring higher", () => {
    const cache = new FrameCache(() => 4);
    cache.store({
      centerX: -0.7,
      centerY: 0.2,
      imageData: makeImageData(),
      quality: "preview",
      zoom: 2,
    });
    cache.store({
      centerX: -0.75,
      centerY: 0.1,
      imageData: makeImageData(),
      quality: "full",
      zoom: 4,
    });

    const history = cache.describeHistory(createViewport(400, 300, -0.75, 0.1, 4), 4);

    expect(history).toHaveLength(2);
    expect(history[0]?.quality).toBe("full");
    expect(history[0]?.score).toBeLessThan(history[1]?.score ?? Number.POSITIVE_INFINITY);
  });
});
