import { getPref, setPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";
import { getProviderApiKey } from "./secureApiKey";
import { truncateInline } from "../../utils/text";
import type { AgentMessage } from "./types";
import type { ReasoningEffortValue } from "./modelMetadata";

export type { AgentMessage, AgentRole } from "./types";

export interface ChatProvider {
  readonly id: string;
  chat(messages: AgentMessage[], options?: ChatOptions): Promise<string>;
}

export interface ChatOptions {
  onCanceller?(cancel: () => void): void;
  onStreamDelta?(delta: string): void;
  reasoningEffort?: ReasoningEffortSetting;
}

interface ProviderSettings {
  provider: string;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiApiKey: string;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
  error?: {
    message?: string;
  };
  output_text?: string;
  output?: Array<{
    type?: string;
    text?: string;
    content?: Array<{
      type?: string;
      text?: string;
      value?: string;
    }>;
  }>;
}

type WireAPI = "chat-completions" | "responses";
type ReasoningEffortSetting = ReasoningEffortValue;

interface EndpointAttempt {
  endpoint: string;
  wireAPI: WireAPI;
  stream: boolean;
}

interface EndpointHintEntry {
  endpoint: string;
  wireAPI: WireAPI;
  updatedAt: number;
}

type EndpointHintsMap = Record<string, EndpointHintEntry>;

interface ProviderAttemptForTest {
  endpoint: string;
  wireAPI: WireAPI;
  stream: boolean;
}

const OPENAI_COMPATIBLE_PROVIDER_IDS = new Set([
  "openai-compatible",
  "openai",
  "openrouter",
  "deepseek",
  "kimi",
  "qwen",
  "ollama",
]);

const OPTIONAL_API_KEY_PROVIDER_IDS = new Set(["ollama"]);
const ENDPOINT_HINTS_PREF_KEY = "openaiEndpointHints";
const ENDPOINT_HINTS_MAX_ENTRIES = 32;
const CHAT_HTTP_TIMEOUT_MS = 0;
const CHAT_RESPONSE_IDLE_TIMEOUT_MS = 5 * 60_000;

export function createProviderFromPrefs(): ChatProvider {
  const settings = readProviderSettings();
  const providerID = settings.provider.trim().toLowerCase();
  if (OPENAI_COMPATIBLE_PROVIDER_IDS.has(providerID)) {
    return new OpenAICompatibleProvider(settings);
  }
  throw new Error(
    getString("agent-error-unsupported-provider", {
      args: { provider: settings.provider },
    }),
  );
}

function readProviderSettings(): ProviderSettings {
  const provider = sanitizeString(getPref("provider"), "openai-compatible");
  const openaiBaseUrl = sanitizeString(
    getPref("openaiBaseUrl"),
    "https://api.openai.com/v1",
  );
  return {
    provider,
    openaiBaseUrl,
    openaiModel: sanitizeString(getPref("openaiModel"), "gpt-4o-mini"),
    openaiApiKey: getProviderApiKey(provider, openaiBaseUrl),
  };
}

function sanitizeString(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : fallback;
}

class OpenAICompatibleProvider implements ChatProvider {
  readonly id = "openai-compatible";

  constructor(private readonly settings: ProviderSettings) {}

  async chat(messages: AgentMessage[], options?: ChatOptions): Promise<string> {
    const normalizedAPIKey = normalizeAuthKey(this.settings.openaiApiKey);
    if (
      isApiKeyRequiredForProvider(this.settings.provider) &&
      !normalizedAPIKey
    ) {
      throw new Error(getString("agent-error-missing-api-key"));
    }
    if (!this.settings.openaiBaseUrl) {
      throw new Error(getString("agent-error-missing-base-url"));
    }
    if (!this.settings.openaiModel) {
      throw new Error(getString("agent-error-missing-model"));
    }
    const endpoint = this.settings.openaiBaseUrl;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (normalizedAPIKey) {
      headers.Authorization = `Bearer ${normalizedAPIKey}`;
    }
    const rememberedHint = readEndpointHint(this.settings.provider, endpoint);
    const attempts = buildEndpointAttempts(endpoint, rememberedHint);
    const reasoningEffort = options?.reasoningEffort || "default";
    let lastError: Error | null = null;
    for (const [index, attempt] of attempts.entries()) {
      const payloads = buildPayloadVariants(
        messages,
        this.settings.openaiModel,
        attempt.wireAPI,
        attempt.stream,
        reasoningEffort,
      );
      let attemptError: Error | null = null;
      for (const [payloadIndex, payload] of payloads.entries()) {
        const streamCollector = createStreamCollector(options?.onStreamDelta);
        const watchdog = createResponseIdleWatchdog(
          CHAT_RESPONSE_IDLE_TIMEOUT_MS,
        );
        try {
          const request = await Zotero.HTTP.request("POST", attempt.endpoint, {
            headers,
            body: JSON.stringify(payload),
            // Zotero.HTTP's timeout is a wall-clock request timeout. Model
            // calls can legitimately run longer than that while still
            // streaming progress, so we disable it and enforce an idle
            // response timeout with the watchdog below.
            timeout: CHAT_HTTP_TIMEOUT_MS,
            cancellerReceiver(canceller: () => void) {
              watchdog.setCanceller(canceller);
              if (!options?.onCanceller) {
                return;
              }
              options.onCanceller(() => {
                try {
                  watchdog.clear();
                  canceller();
                } catch {
                  // Ignore cancellation race errors.
                }
              });
            },
            requestObserver(xhr: XMLHttpRequest) {
              watchdog.markActivity();
              if (attempt.stream) {
                streamCollector.attach(xhr, () => watchdog.markActivity());
                return;
              }
              xhr.onprogress = () => watchdog.markActivity();
            },
          });
          watchdog.clear();
          streamCollector.finalize();
          const streamedOutput = streamCollector.getText().trim();
          if (streamedOutput) {
            rememberEndpointHint(this.settings.provider, endpoint, {
              endpoint: attempt.endpoint,
              wireAPI: attempt.wireAPI,
              stream: true,
            });
            return streamedOutput;
          }
          const responseText = request.responseText || "";
          const response = parseChatResponseJSON(responseText, request);
          if (response.error?.message) {
            throw new Error(response.error.message);
          }
          const output = extractContent(response);
          if (output) {
            rememberEndpointHint(this.settings.provider, endpoint, {
              endpoint: attempt.endpoint,
              wireAPI: attempt.wireAPI,
              stream: true,
            });
            return output;
          }
          throw new Error(getString("agent-error-empty-response"));
        } catch (error) {
          const normalizedError = watchdog.getTimeoutError() || toError(error);
          watchdog.clear();
          if (
            shouldRetryWithoutReasoning(
              normalizedError,
              payloadIndex,
              payloads.length,
            )
          ) {
            attemptError = normalizedError;
            continue;
          }
          if (
            canFallbackToNextEndpoint(
              attempt,
              index,
              attempts.length,
              normalizedError,
            )
          ) {
            attemptError = normalizedError;
            break;
          }
          throw normalizedError;
        } finally {
          watchdog.clear();
        }
      }
      if (attemptError) {
        lastError = attemptError;
        continue;
      }
    }
    if (lastError) {
      throw lastError;
    }
    throw new Error(getString("agent-error-empty-response"));
  }
}

export function isApiKeyRequiredForProvider(provider: string) {
  return !OPTIONAL_API_KEY_PROVIDER_IDS.has(provider.trim().toLowerCase());
}

function extractContent(response: OpenAIChatResponse) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const responseItems = response.output;
  if (Array.isArray(responseItems) && responseItems.length) {
    const buffer: string[] = [];
    for (const item of responseItems) {
      if (typeof item.text === "string" && item.text.trim()) {
        buffer.push(item.text);
      }
      if (!Array.isArray(item.content)) {
        continue;
      }
      for (const part of item.content) {
        const text =
          (typeof part.text === "string" ? part.text : "") ||
          (typeof part.value === "string" ? part.value : "");
        if (text.trim()) {
          buffer.push(text);
        }
      }
    }
    const merged = buffer.join("").trim();
    if (merged) {
      return merged;
    }
  }
  const firstChoice = response.choices?.[0]?.message?.content;
  if (!firstChoice) {
    return "";
  }
  if (typeof firstChoice === "string") {
    return firstChoice.trim();
  }
  return firstChoice
    .map((part) => {
      if (part.type === "text") {
        return part.text || "";
      }
      return "";
    })
    .join("")
    .trim();
}

function buildRequestPayload(
  messages: AgentMessage[],
  model: string,
  wireAPI: WireAPI,
  stream: boolean,
  reasoningEffort: ReasoningEffortSetting,
) {
  if (wireAPI === "responses") {
    const payload: Record<string, unknown> = {
      model,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    };
    if (stream) {
      payload.stream = true;
    }
    applyReasoningEffortToPayload(payload, wireAPI, reasoningEffort);
    return payload;
  }
  const payload: Record<string, unknown> = {
    model,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };
  if (stream) {
    payload.stream = true;
  }
  applyReasoningEffortToPayload(payload, wireAPI, reasoningEffort);
  return payload;
}

function buildPayloadVariants(
  messages: AgentMessage[],
  model: string,
  wireAPI: WireAPI,
  stream: boolean,
  reasoningEffort: ReasoningEffortSetting,
) {
  const withReasoning = buildRequestPayload(
    messages,
    model,
    wireAPI,
    stream,
    reasoningEffort,
  );
  if (reasoningEffort === "default") {
    return [withReasoning];
  }
  const withoutReasoning = buildRequestPayload(
    messages,
    model,
    wireAPI,
    stream,
    "default",
  );
  return [withReasoning, withoutReasoning];
}

function applyReasoningEffortToPayload(
  payload: Record<string, unknown>,
  wireAPI: WireAPI,
  reasoningEffort: ReasoningEffortSetting,
) {
  if (reasoningEffort === "default") {
    return;
  }
  if (wireAPI === "responses") {
    payload.reasoning = {
      effort: reasoningEffort,
    };
    return;
  }
  payload.reasoning_effort = reasoningEffort;
}

function buildEndpointAttempts(
  endpoint: string,
  preferredHint: EndpointAttempt | null,
): EndpointAttempt[] {
  const trimmed = endpoint.trim();
  const explicitWire = detectExplicitWireAPI(trimmed);
  if (explicitWire) {
    return [
      { endpoint: trimmed, wireAPI: explicitWire, stream: true },
      { endpoint: trimmed, wireAPI: explicitWire, stream: false },
    ];
  }
  const attempts: EndpointAttempt[] = [];
  if (preferredHint) {
    pushAttemptIfNew(attempts, preferredHint);
  }
  pushAttemptIfNew(attempts, {
    endpoint: trimmed,
    wireAPI: "chat-completions",
    stream: true,
  });
  pushAttemptIfNew(attempts, {
    endpoint: trimmed,
    wireAPI: "chat-completions",
    stream: false,
  });
  const normalized = trimmed.replace(/\/+$/, "");
  pushAttemptIfNew(attempts, {
    endpoint: `${normalized}/responses`,
    wireAPI: "responses",
    stream: true,
  });
  pushAttemptIfNew(attempts, {
    endpoint: `${normalized}/responses`,
    wireAPI: "responses",
    stream: false,
  });
  pushAttemptIfNew(attempts, {
    endpoint: `${normalized}/chat/completions`,
    wireAPI: "chat-completions",
    stream: true,
  });
  pushAttemptIfNew(attempts, {
    endpoint: `${normalized}/chat/completions`,
    wireAPI: "chat-completions",
    stream: false,
  });
  return attempts;
}

function detectExplicitWireAPI(endpoint: string): WireAPI | null {
  if (/\/responses(?:[/?#]|$)/i.test(endpoint)) {
    return "responses";
  }
  if (/\/chat\/completions(?:[/?#]|$)/i.test(endpoint)) {
    return "chat-completions";
  }
  return null;
}

function pushAttemptIfNew(attempts: EndpointAttempt[], next: EndpointAttempt) {
  if (
    attempts.some(
      (attempt) =>
        attempt.endpoint === next.endpoint &&
        attempt.wireAPI === next.wireAPI &&
        attempt.stream === next.stream,
    )
  ) {
    return;
  }
  attempts.push(next);
}

function readEndpointHint(
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

function rememberEndpointHint(
  provider: string,
  baseURL: string,
  hint: EndpointAttempt,
) {
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

function buildHintKey(provider: string, baseURL: string) {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedBase = normalizeBaseForHint(baseURL);
  return `${normalizedProvider}|${normalizedBase}`;
}

function normalizeBaseForHint(baseURL: string) {
  const trimmed = baseURL.trim();
  const noTrailingSlash = trimmed.replace(/\/+$/, "");
  return noTrailingSlash.replace(
    /\/(responses|chat\/completions)(?:[/?#].*)?$/i,
    "",
  );
}

function trimHintMap(input: EndpointHintsMap) {
  const entries = Object.entries(input);
  if (entries.length <= ENDPOINT_HINTS_MAX_ENTRIES) {
    return input;
  }
  entries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  return Object.fromEntries(entries.slice(0, ENDPOINT_HINTS_MAX_ENTRIES));
}

function isValidWireAPI(value: string): value is WireAPI {
  return value === "chat-completions" || value === "responses";
}

function canFallbackToNextEndpoint(
  attempt: EndpointAttempt,
  index: number,
  totalAttempts: number,
  error: unknown,
) {
  if (index >= totalAttempts - 1) {
    return false;
  }
  if (error instanceof NonJSONResponseError) {
    return true;
  }
  const text = toError(error).message.toLowerCase();
  if (attempt.stream && isLikelyStreamingCompatibilityError(text)) {
    return true;
  }
  return (
    text.includes("not found") ||
    text.includes("cannot post") ||
    text.includes("404") ||
    text.includes("405") ||
    text.includes("unsupported endpoint")
  );
}

function shouldRetryWithoutReasoning(
  error: Error,
  payloadIndex: number,
  payloadCount: number,
) {
  if (payloadIndex >= payloadCount - 1) {
    return false;
  }
  const text = error.message.toLowerCase();
  return (
    text.includes("reasoning") &&
    (text.includes("unsupported") ||
      text.includes("unknown") ||
      text.includes("invalid") ||
      text.includes("not allowed") ||
      text.includes("unrecognized"))
  );
}

function isLikelyStreamingCompatibilityError(text: string) {
  if (!text.includes("stream")) {
    return false;
  }
  return (
    text.includes("unsupported") ||
    text.includes("not support") ||
    text.includes("must be false") ||
    text.includes("invalid") ||
    text.includes("event-stream") ||
    text.includes("sse")
  );
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function parseChatResponseJSON(responseText: string, request: unknown) {
  const trimmed = responseText.trim();
  if (!trimmed) {
    throw new Error(getString("agent-error-empty-response"));
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as OpenAIChatResponse;
    } catch {
      // Fall through to structured error message below.
    }
  }

  const status = getResponseStatus(request);
  const contentType = getResponseHeader(request, "content-type") || "unknown";
  const preview = truncateInline(trimmed, 180);
  const errorText = getString("agent-error-non-json-response", {
    args: {
      status: status > 0 ? String(status) : "?",
      contentType,
      preview,
    },
  });
  const htmlHint = looksLikeHTML(trimmed, contentType)
    ? ` ${getString("agent-error-non-json-html-hint")}`
    : "";
  throw new NonJSONResponseError(`${errorText}${htmlHint}`.trim());
}

function getResponseStatus(request: unknown) {
  const status = Number((request as { status?: unknown })?.status);
  return Number.isFinite(status) ? status : 0;
}

function getResponseHeader(request: unknown, name: string) {
  try {
    const getter = (
      request as { getResponseHeader?: (name: string) => string | null }
    ).getResponseHeader;
    if (typeof getter !== "function") {
      return "";
    }
    return getter.call(request, name) || "";
  } catch {
    return "";
  }
}

function looksLikeHTML(text: string, contentType: string) {
  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes("text/html")) {
    return true;
  }
  return /^<!doctype html>|^<html[\s>]/i.test(text.trimStart());
}

function normalizeAuthKey(rawKey: string) {
  let value = rawKey.trim();
  if (!value) {
    return "";
  }
  value = value.replace(/^['"]|['"]$/g, "").trim();
  value = value.replace(/^bearer\s+/i, "").trim();
  return value;
}

class NonJSONResponseError extends Error {
  name = "NonJSONResponseError";
}

interface StreamCollector {
  attach(xhr: XMLHttpRequest, onProgress?: () => void): void;
  finalize(): void;
  getText(): string;
}

interface ResponseIdleWatchdog {
  markActivity(): void;
  setCanceller(cancel: () => void): void;
  clear(): void;
  getTimeoutError(): Error | null;
}

function createResponseIdleWatchdog(timeoutMs: number): ResponseIdleWatchdog {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let canceller: (() => void) | null = null;
  let timedOut = false;
  let closed = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const resetTimer = () => {
    if (closed || timedOut) {
      return;
    }
    clearTimer();
    timer = setTimeout(() => {
      timedOut = true;
      try {
        canceller?.();
      } catch {
        // Ignore cancellation race errors.
      }
    }, timeoutMs);
  };

  resetTimer();

  return {
    markActivity() {
      resetTimer();
    },
    setCanceller(cancel: () => void) {
      if (closed) {
        return;
      }
      canceller = cancel;
      if (timedOut) {
        try {
          cancel();
        } catch {
          // Ignore cancellation race errors.
        }
      }
    },
    clear() {
      closed = true;
      clearTimer();
      canceller = null;
    },
    getTimeoutError() {
      if (!timedOut) {
        return null;
      }
      return new Error(
        getString("agent-error-response-timeout", {
          args: {
            seconds: String(Math.round(timeoutMs / 1000)),
          },
        }),
      );
    },
  };
}

function createStreamCollector(
  onDelta?: (delta: string) => void,
): StreamCollector {
  let consumedLength = 0;
  let lineBuffer = "";
  let dataLines: string[] = [];
  let fullText = "";

  function pushChunk(chunk: string) {
    lineBuffer += chunk;
    while (true) {
      const newlineIndex = lineBuffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }
      const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      consumeSSELine(line);
    }
  }

  function consumeSSELine(line: string) {
    if (!line) {
      flushEvent();
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  function flushEvent() {
    if (!dataLines.length) {
      return;
    }
    const payload = dataLines.join("\n");
    dataLines = [];
    if (!payload || payload === "[DONE]") {
      return;
    }
    try {
      const json = JSON.parse(payload) as Record<string, unknown>;
      const delta = extractStreamDelta(json);
      if (!delta) {
        return;
      }
      fullText += delta;
      onDelta?.(delta);
    } catch {
      // Ignore non-JSON SSE payload fragments.
    }
  }

  return {
    attach(xhr: XMLHttpRequest, onProgress?: () => void) {
      xhr.onprogress = () => {
        onProgress?.();
        const current = xhr.responseText || "";
        if (current.length <= consumedLength) {
          return;
        }
        const chunk = current.slice(consumedLength);
        consumedLength = current.length;
        pushChunk(chunk);
      };
    },
    finalize() {
      if (lineBuffer.length) {
        pushChunk("\n");
      }
      flushEvent();
    },
    getText() {
      return fullText;
    },
  };
}

function extractStreamDelta(payload: Record<string, unknown>) {
  const directDelta = payload.delta;
  if (typeof directDelta === "string" && directDelta) {
    return directDelta;
  }

  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length) {
    const firstChoice = choices[0] as { delta?: unknown };
    const choiceDelta = firstChoice?.delta as
      | string
      | {
          content?: unknown;
        }
      | undefined;
    if (typeof choiceDelta === "string") {
      return choiceDelta;
    }
    const content = choiceDelta?.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const buffer: string[] = [];
      for (const part of content) {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") {
          buffer.push(text);
        }
      }
      return buffer.join("");
    }
  }

  const item = payload.item as { type?: unknown; delta?: unknown } | undefined;
  if (
    item &&
    item.type === "response.output_text.delta" &&
    typeof item.delta === "string"
  ) {
    return item.delta;
  }

  if (
    payload.type === "response.output_text.delta" &&
    typeof payload.delta === "string"
  ) {
    return payload.delta;
  }

  return "";
}

// Exported for unit tests to lock endpoint fallback behavior.
export const providerTestUtils = {
  buildEndpointAttempts(
    endpoint: string,
    preferredHint: ProviderAttemptForTest | null = null,
  ) {
    return buildEndpointAttempts(endpoint, preferredHint);
  },
  canFallbackWithMessage(
    stream: boolean,
    index: number,
    totalAttempts: number,
    message: string,
  ) {
    return canFallbackToNextEndpoint(
      {
        endpoint: "https://example.com",
        wireAPI: "chat-completions",
        stream,
      },
      index,
      totalAttempts,
      new Error(message),
    );
  },
  canFallbackForNonJSON(stream: boolean, index: number, totalAttempts: number) {
    return canFallbackToNextEndpoint(
      {
        endpoint: "https://example.com",
        wireAPI: "chat-completions",
        stream,
      },
      index,
      totalAttempts,
      new NonJSONResponseError("non-json"),
    );
  },
  extractStreamDelta(payload: Record<string, unknown>) {
    return extractStreamDelta(payload);
  },
  getChatTimeoutConfig() {
    return {
      httpTimeoutMs: CHAT_HTTP_TIMEOUT_MS,
      responseIdleTimeoutMs: CHAT_RESPONSE_IDLE_TIMEOUT_MS,
    };
  },
  buildPayloadVariants(
    wireAPI: WireAPI,
    reasoningEffort: ReasoningEffortSetting,
    stream = false,
  ) {
    return buildPayloadVariants(
      [{ role: "user", content: "test" }],
      "test-model",
      wireAPI,
      stream,
      reasoningEffort,
    );
  },
};
