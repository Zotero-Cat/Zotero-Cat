import { getPref, setPref } from "../../utils/prefs";

const CUSTOM_CONTEXT_STORE_PREF = "customContextStore";
const customContextByItemKey = new Map<string, string>();
let customContextStoreLoaded = false;

export function getCustomContextForKey(customContextKey: string): string {
  ensureCustomContextStoreLoaded();
  return customContextByItemKey.get(customContextKey) || "";
}

export function setCustomContextForKey(
  customContextKey: string,
  value: string,
): void {
  ensureCustomContextStoreLoaded();
  if (value.trim()) {
    customContextByItemKey.set(customContextKey, value);
  } else {
    customContextByItemKey.delete(customContextKey);
  }
  saveCustomContextStore();
}

function ensureCustomContextStoreLoaded(): void {
  if (customContextStoreLoaded) {
    return;
  }
  customContextStoreLoaded = true;
  try {
    const raw = getPref(CUSTOM_CONTEXT_STORE_PREF);
    if (typeof raw !== "string" || !raw.trim()) {
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof key === "string" &&
        typeof value === "string" &&
        value.trim()
      ) {
        customContextByItemKey.set(key, value);
      }
    }
  } catch {
    // Ignore corrupted pref.
  }
}

function saveCustomContextStore(): void {
  const store: Record<string, string> = {};
  for (const [key, value] of customContextByItemKey) {
    if (value.trim()) {
      store[key] = value;
    }
  }
  setPref(CUSTOM_CONTEXT_STORE_PREF, JSON.stringify(store));
}

export const customContextStoreTestUtils = {
  reset() {
    customContextByItemKey.clear();
    customContextStoreLoaded = false;
  },
  snapshot() {
    return new Map(customContextByItemKey);
  },
};
