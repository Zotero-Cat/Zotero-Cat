// Per-endpoint quirks registry for OpenAI-compatible relays.
//
// Different relays exhibit different non-standard behaviors that we have to
// work around: some require `reasoning_content` to be echoed back on every
// assistant turn (DeepSeek-V4-Thinking, certain MiMo / Doubao / Qwen3 relays);
// some reject native `tool_calls` arguments entirely. Quirks are observed at
// runtime from 400 responses and remembered per endpoint, scoped to the
// current Zotero session (no persistence — we want to re-detect on restart in
// case the relay changes behavior).

export type ReasoningContentEmptyPolicy = "empty" | "omit" | "space";

export interface ProviderQuirks {
  echoReasoningContent: boolean;
  nativeToolsUnsupported: boolean;
  // When echoReasoningContent is on but we have no captured reasoning_content
  // for an assistant message, how to fill the field. "empty" matches what
  // most relays accept; "space" works around relays that reject empty
  // strings; "omit" drops the field for that message.
  reasoningContentEmptyPolicy: ReasoningContentEmptyPolicy;
}

export function defaultProviderQuirks(): ProviderQuirks {
  return {
    echoReasoningContent: false,
    nativeToolsUnsupported: false,
    reasoningContentEmptyPolicy: "empty",
  };
}

// Host-based defaults applied the first time we see a given endpoint. Observed
// quirks (set by the runner) override these.
export function hostDefaultQuirks(baseURL: string): Partial<ProviderQuirks> {
  const host = extractHost(baseURL);
  if (!host) {
    return {};
  }
  if (host === "api.deepseek.com" || host.endsWith(".deepseek.com")) {
    return {
      reasoningContentEmptyPolicy: "space",
    };
  }
  return {};
}

export function normalizeBaseURLForKey(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, "");
}

export function buildEndpointKey(provider: string, baseURL: string): string {
  return `${provider.trim().toLowerCase()}|${normalizeBaseURLForKey(baseURL)}`;
}

const quirksByEndpoint = new Map<string, ProviderQuirks>();

export function getQuirksForEndpoint(
  endpointKey: string,
  baseURL?: string,
): ProviderQuirks {
  const stored = quirksByEndpoint.get(endpointKey);
  if (stored) {
    return stored;
  }
  const seeded: ProviderQuirks = {
    ...defaultProviderQuirks(),
    ...(baseURL ? hostDefaultQuirks(baseURL) : {}),
  };
  quirksByEndpoint.set(endpointKey, seeded);
  return seeded;
}

export function updateQuirksForEndpoint(
  endpointKey: string,
  baseURL: string | undefined,
  patch: Partial<ProviderQuirks>,
): ProviderQuirks {
  const current = getQuirksForEndpoint(endpointKey, baseURL);
  const next: ProviderQuirks = { ...current, ...patch };
  quirksByEndpoint.set(endpointKey, next);
  return next;
}

export function rememberNativeToolsUnsupported(
  endpointKey: string,
  baseURL?: string,
): ProviderQuirks {
  return updateQuirksForEndpoint(endpointKey, baseURL, {
    nativeToolsUnsupported: true,
  });
}

export function rememberReasoningContentEcho(
  endpointKey: string,
  baseURL?: string,
): ProviderQuirks {
  return updateQuirksForEndpoint(endpointKey, baseURL, {
    echoReasoningContent: true,
  });
}

export function shouldEchoReasoningContent(endpointKey: string): boolean {
  return Boolean(quirksByEndpoint.get(endpointKey)?.echoReasoningContent);
}

export function isNativeToolsUnsupported(endpointKey: string): boolean {
  return Boolean(quirksByEndpoint.get(endpointKey)?.nativeToolsUnsupported);
}

// Test-only API used by unit tests to reset the registry between cases.
export const quirksTestUtils = {
  reset(): void {
    quirksByEndpoint.clear();
  },
  snapshot(): Map<string, ProviderQuirks> {
    return new Map(quirksByEndpoint);
  },
  hostDefaultQuirks,
};

function extractHost(baseURL: string): string {
  const trimmed = (baseURL || "").trim();
  if (!trimmed) {
    return "";
  }
  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    // Fall through: caller may have passed a host-only string.
  }
  const stripped = trimmed.replace(/^https?:\/\//i, "").split("/")[0];
  return (stripped || "").toLowerCase();
}
