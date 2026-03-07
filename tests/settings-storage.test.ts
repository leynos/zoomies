import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/shared/config";
import { normalizeStoredSettings } from "../src/shared/settings-storage";

describe("normalizeStoredSettings", () => {
  test("returns defaults when no persisted settings exist", () => {
    expect(normalizeStoredSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  test("merges valid persisted values into the defaults", () => {
    const result = normalizeStoredSettings({
      debounceMs: 200,
      maxIterations: 600,
      previewDivisor: 10,
    });

    expect(result.debounceMs).toBe(200);
    expect(result.maxIterations).toBe(600);
    expect(result.previewDivisor).toBe(10);
    expect(result.maxCacheEntries).toBe(DEFAULT_SETTINGS.maxCacheEntries);
  });

  test("clamps out-of-range values and ignores non-numeric entries", () => {
    const result = normalizeStoredSettings({
      centerTolerance: Number.NaN,
      debounceMs: 999,
      maxCacheEntries: -10,
      zoomTolerance: -5,
    });

    expect(result.debounceMs).toBe(280);
    expect(result.maxCacheEntries).toBe(8);
    expect(result.zoomTolerance).toBe(0.05);
    expect(result.centerTolerance).toBe(DEFAULT_SETTINGS.centerTolerance);
  });
});
