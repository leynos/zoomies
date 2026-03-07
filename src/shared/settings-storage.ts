import {
  DEFAULT_SETTINGS,
  type RendererSettings,
  SETTING_DEFINITIONS,
  type SettingDefinition,
} from "./config";

const DATABASE_NAME = "zoomies-settings";
const DATABASE_VERSION = 1;
const STORE_NAME = "renderer";
const SETTINGS_KEY = "current";

/**
 * Stored settings payload shape.
 */
interface StoredSettingsRecord {
  readonly settings: Partial<RendererSettings>;
}

/**
 * Clamp a value to the configured slider bounds.
 */
function clampSettingValue(value: number, definition: SettingDefinition) {
  return Math.min(definition.max, Math.max(definition.min, value));
}

/**
 * Validate and merge persisted settings with defaults.
 */
export function normalizeStoredSettings(
  settings: Partial<RendererSettings> | null | undefined,
): RendererSettings {
  if (!settings) {
    return DEFAULT_SETTINGS;
  }

  const normalized: Record<keyof RendererSettings, number> = { ...DEFAULT_SETTINGS };

  for (const definition of SETTING_DEFINITIONS) {
    const candidate = settings[definition.key];
    if (typeof candidate !== "number" || Number.isNaN(candidate)) {
      continue;
    }

    normalized[definition.key] = clampSettingValue(candidate, definition);
  }

  return normalized;
}

/**
 * Open the IndexedDB database used for renderer settings.
 */
async function openSettingsDatabase() {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  return await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open settings database."));
    request.onblocked = () => resolve(null);
  });
}

/**
 * Load persisted renderer settings, or return defaults if unavailable.
 */
export async function loadRendererSettings() {
  const database = await openSettingsDatabase();
  if (!database) {
    return DEFAULT_SETTINGS;
  }

  return await new Promise<RendererSettings>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(SETTINGS_KEY);

    request.onsuccess = () => {
      const record = request.result as StoredSettingsRecord | undefined;
      resolve(normalizeStoredSettings(record?.settings));
      database.close();
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Unable to read renderer settings."));
      database.close();
    };
  });
}

/**
 * Persist renderer settings for future sessions.
 */
export async function saveRendererSettings(settings: RendererSettings) {
  const database = await openSettingsDatabase();
  if (!database) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => {
      resolve();
      database.close();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Unable to write renderer settings."));
      database.close();
    };

    store.put({ settings }, SETTINGS_KEY);
  });
}
