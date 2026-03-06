/**
 * UI-facing settings for the fractal renderer.
 */
export interface RendererSettings {
  readonly centerTolerance: number;
  readonly debounceMs: number;
  readonly maxCacheEntries: number;
  readonly maxIterations: number;
  readonly previewDivisor: number;
  readonly zoomTolerance: number;
}

/**
 * Slider metadata used by the settings panel.
 */
export interface SettingDefinition {
  readonly formatValue?: (value: number) => string;
  readonly key: keyof RendererSettings;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly step: number;
}

/**
 * Stable defaults for the explorer.
 */
export const DEFAULT_SETTINGS: RendererSettings = {
  centerTolerance: 0.28,
  debounceMs: 120,
  maxCacheEntries: 36,
  maxIterations: 420,
  previewDivisor: 8,
  zoomTolerance: 0.42,
};

/**
 * The starting camera position used for boot.
 */
export const DEFAULT_CENTER = {
  x: -0.7436438870371587,
  y: 0.13182590420531198,
};

/**
 * Describes the settings controls shown in the UI.
 */
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: "maxCacheEntries",
    label: "Cached Frames",
    min: 8,
    max: 96,
    step: 4,
  },
  {
    key: "zoomTolerance",
    label: "Zoom Tolerance",
    min: 0.05,
    max: 1.2,
    step: 0.05,
    formatValue: (value) => value.toFixed(2),
  },
  {
    key: "centerTolerance",
    label: "Center Tolerance",
    min: 0.05,
    max: 1,
    step: 0.05,
    formatValue: (value) => value.toFixed(2),
  },
  {
    key: "previewDivisor",
    label: "Preview Divisor",
    min: 2,
    max: 14,
    step: 1,
  },
  {
    key: "maxIterations",
    label: "Max Iterations",
    min: 120,
    max: 800,
    step: 20,
  },
  {
    key: "debounceMs",
    label: "Debounce (ms)",
    min: 30,
    max: 280,
    step: 10,
  },
];
