import { getPref, setPref } from "../../../utils/prefs";

export type WireAPI = "chat-completions" | "responses";

export interface EndpointAttempt {
  endpoint: string;
  wireAPI: WireAPI;
  stream: boolean;
}

export interface EndpointHintEntry {
  endpoint: string;
  wireAPI: WireAPI;
  updatedAt: number;
}

export type EndpointHintsMap = Record<string, EndpointHintEntry>;

export const ENDPOINT_HINTS_PREF_KEY = "openaiEndpointHints";
export const ENDPOINT_HINTS_MAX_ENTRIES = 32;

export function readEndpointHint(
  provider: string,
  baseURL: string,
): EndpointAttempt | null {
  const raw = getPref(ENDPOINT_HINTS_PREF_KEY);
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  try {
    const map = JSON.parse(raw) as EndpointHintsMap;
    const key = buildHintKey(provider, baseURL);
    const entry = map[key];
    if (!entry) {
      return null;
    }
    if (!isValidWireAPI(entry.wireAPI) || !entry.endpoint?.trim()) {
      return null;
    }
    return {
      endpoint: entry.endpoint,
      wireAPI: entry.wireAPI,
      stream: true,
    };
  } catch {
    return null;
  }
}

export function rememberEndpointHint(
  provider: string,
  baseURL: string,
  hint: EndpointAttempt,
): void {
  if (!hint.endpoint.trim() || !isValidWireAPI(hint.wireAPI)) {
    return;
  }
  let map: EndpointHintsMap = {};
  const raw = getPref(ENDPOINT_HINTS_PREF_KEY);
  if (typeof raw === "string" && raw.trim()) {
    try {
      map = JSON.parse(raw) as EndpointHintsMap;
    } catch {
      map = {};
    }
  }
  const key = buildHintKey(provider, baseURL);
  map[key] = {
    endpoint: hint.endpoint,
    wireAPI: hint.wireAPI,
    updatedAt: Date.now(),
  };
  map = trimHintMap(map);
  setPref(ENDPOINT_HINTS_PREF_KEY, JSON.stringify(map));
}

function buildHintKey(provider: string, baseURL: string): string {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedBase = normalizeBaseForHint(baseURL);
  return `${normalizedProvider}|${normalizedBase}`;
}

function normalizeBaseForHint(baseURL: string): string {
  const trimmed = baseURL.trim();
  const noTrailingSlash = trimmed.replace(/\/+$/, "");
  return noTrailingSlash.replace(
    /\/(responses|chat\/completions)(?:[/?#].*)?$/i,
    "",
  );
}

function trimHintMap(input: EndpointHintsMap): EndpointHintsMap {
  const entries = Object.entries(input);
  if (entries.length <= ENDPOINT_HINTS_MAX_ENTRIES) {
    return input;
  }
  entries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  return Object.fromEntries(entries.slice(0, ENDPOINT_HINTS_MAX_ENTRIES));
}

export function isValidWireAPI(value: string): value is WireAPI {
  return value === "chat-completions" || value === "responses";
}
