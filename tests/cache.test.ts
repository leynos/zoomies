import { describe, expect, test } from "bun:test";
import { FrameCache } from "../src/shared/cache";
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

  test("evicts the least relevant frame when capacity is exceeded", () => {
    const cache = new FrameCache(() => 2);
    cache.store({ centerX: 0, centerY: 0, imageData: makeImageData(), zoom: 1 });
    cache.store({ centerX: 10, centerY: 10, imageData: makeImageData(), zoom: 1 });
    cache.store({ centerX: 0.1, centerY: 0.1, imageData: makeImageData(), zoom: 1.1 });

    expect(cache.size()).toBe(2);
    expect(cache.getExact(createViewport(400, 300, 10, 10, 1))).toBeUndefined();
  });
});
