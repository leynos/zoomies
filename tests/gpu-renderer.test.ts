import { describe, expect, test } from "bun:test";
import { flipRgbaRows } from "../src/client/gpu-renderer";

describe("flipRgbaRows", () => {
  test("flips WebGL readback data into top-left origin order", () => {
    const pixels = new Uint8ClampedArray([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255]);

    const flipped = flipRgbaRows(pixels, 2, 2);

    expect(Array.from(flipped)).toEqual([3, 0, 0, 255, 4, 0, 0, 255, 1, 0, 0, 255, 2, 0, 0, 255]);
  });
});
