import { getPref, setPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";
import { getProviderApiKey } from "./secureApiKey";
import { truncateInline } from "../../utils/text";
import type { AgentMessage, AssistantToolCall } from "./types";
import type { ReasoningEffortValue } from "./modelMetadata";
import {
  ReasoningContentRequiredError,
  ToolsNotSupportedError,
} from "./functionCalling/errors";
import {
  defaultProviderQuirks,
  type ProviderQuirks,
} from "./functionCalling/quirks";
import { serializeMessageForChat } from "./functionCalling/messageShape";

export type { AgentMessage, AgentRole, AssistantToolCall } from "./types";
export {
  ReasoningContentRequiredError,
  ToolsNotSupportedError,
} from "./functionCalling/errors";

export interface ChatToolSpec {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
    strict?: boolean;
  };
}

export type ChatToolChoice = "auto" | "none" | "required";

export interface ChatResult {
  content: string;
  toolCalls: AssistantToolCall[];
  finishReason: string;
  reasoningContent?: string;
}

export interface ChatProvider {
  readonly id: string;
  chat(messages: AgentMessage[], options?: ChatOptions): Promise<ChatResult>;
}

export interface ChatOptions {
  onCanceller?(cancel: () => void): void;
  onStreamDelta?(delta: string): void;
  onToolCallStarted?(toolCall: { id: string; name: string }): void;
  reasoningEffort?: ReasoningEffortSetting;
  tools?: ChatToolSpec[];
  toolChoice?: ChatToolChoice;
  // Preferred: pass the full ProviderQuirks resolved from the central
  // registry. The function-calling runner is responsible for keeping it
  // up-to-date as endpoints reveal their non-standard behaviors.
  quirks?: ProviderQuirks;
  // Deprecated alias for `quirks.echoReasoningContent`. New callers should
  // pass `quirks` directly; this is kept so the legacy test-utility surface
  // and any in-flight callers do not break in this refactor.
  echoReasoningContent?: boolean;
}

interface ProviderSettings {
  provider: string;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiApiKey: string;
}

interface OpenAIToolCallPart {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAIChatResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
      tool_calls?: OpenAIToolCallPart[];
      reasoning_content?: string;
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

  async chat(
    messages: AgentMessage[],
    options?: ChatOptions,
  ): Promise<ChatResult> {
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
    const requestTools = options?.tools?.length ? options.tools : undefined;
    const requestToolChoice =
      requestTools && options?.toolChoice ? options.toolChoice : undefined;
    const effectiveQuirks: ProviderQuirks = options?.quirks ?? {
      ...defaultProviderQuirks(),
      echoReasoningContent: options?.echoReasoningContent === true,
    };
    let lastError: Error | null = null;
    for (const [index, attempt] of attempts.entries()) {
      const payloads = buildPayloadVariants(
        messages,
        this.settings.openaiModel,
        attempt.wireAPI,
        attempt.stream,
        reasoningEffort,
        requestTools,
        requestToolChoice,
        effectiveQuirks,
      );
      let attemptError: Error | null = null;
      for (const [payloadIndex, payload] of payloads.entries()) {
        const streamCollector = createStreamCollector({
          onTextDelta: options?.onStreamDelta,
          onToolCallStarted: options?.onToolCallStarted,
        });
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
          const streamedToolCalls = streamCollector.getToolCalls();
          const streamedText = streamCollector.getText().trim();
          const streamedFinish = streamCollector.getFinishReason();
          const streamedReasoning = streamCollector.getReasoningContent();
          if (streamedText || streamedToolCalls.length) {
            rememberEndpointHint(this.settings.provider, endpoint, {
              endpoint: attempt.endpoint,
              wireAPI: attempt.wireAPI,
              stream: true,
            });
            return {
              content: streamedText,
              toolCalls: streamedToolCalls,
              finishReason: streamedFinish || "stop",
              reasoningContent: streamedReasoning || undefined,
            };
          }
          const responseText = request.responseText || "";
          const response = parseChatResponseJSON(responseText, request);
          if (response.error?.message) {
            if (
              requestTools &&
              isToolsUnsupportedErrorMessage(response.error.message)
            ) {
              throw new ToolsNotSupportedError(response.error.message);
            }
            if (
              isReasoningContentRequiredErrorMessage(response.error.message)
            ) {
              throw new ReasoningContentRequiredError(response.error.message);
            }
            throw new Error(response.error.message);
          }
          const output = extractContent(response);
          const responseToolCalls = extractResponseToolCalls(response);
          const responseFinish = extractFinishReason(response);
          const responseReasoning = extractResponseReasoningContent(response);
          if (output || responseToolCalls.length) {
            rememberEndpointHint(this.settings.provider, endpoint, {
              endpoint: attempt.endpoint,
              wireAPI: attempt.wireAPI,
              stream: true,
            });
            return {
              content: output,
              toolCalls: responseToolCalls,
              finishReason: responseFinish || "stop",
              reasoningContent: responseReasoning || undefined,
            };
          }
          throw new Error(getString("agent-error-empty-response"));
        } catch (error) {
          const normalizedError = watchdog.getTimeoutError() || toError(error);
          watchdog.clear();
          if (
            requestTools &&
            isToolsUnsupportedErrorMessage(normalizedError.message)
          ) {
            throw new ToolsNotSupportedError(normalizedError.message);
          }
          if (isReasoningContentRequiredErrorMessage(normalizedError.message)) {
            throw new ReasoningContentRequiredError(normalizedError.message);
          }
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
  tools?: ChatToolSpec[],
  toolChoice?: ChatToolChoice,
  quirks: ProviderQuirks = defaultProviderQuirks(),
) {
  if (wireAPI === "responses") {
    const payload: Record<string, unknown> = {
      model,
      input: messages.map((message) => ({
        role: message.role === "tool" ? "user" : message.role,
        content:
          message.role === "tool"
            ? formatToolMessageForResponses(message)
            : message.content,
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
    messages: messages.map((message) =>
      serializeMessageForChat(message, { quirks }),
    ),
  };
  if (stream) {
    payload.stream = true;
  }
  if (tools && tools.length) {
    payload.tools = tools;
    payload.tool_choice = toolChoice || "auto";
  }
  applyReasoningEffortToPayload(payload, wireAPI, reasoningEffort);
  return payload;
}

function formatToolMessageForResponses(message: AgentMessage): string {
  const label = message.toolName ? `[tool:${message.toolName}]` : "[tool]";
  return `${label}\n${message.content || ""}`.trim();
}

function buildPayloadVariants(
  messages: AgentMessage[],
  model: string,
  wireAPI: WireAPI,
  stream: boolean,
  reasoningEffort: ReasoningEffortSetting,
  tools?: ChatToolSpec[],
  toolChoice?: ChatToolChoice,
  quirks: ProviderQuirks = defaultProviderQuirks(),
) {
  const withReasoning = buildRequestPayload(
    messages,
    model,
    wireAPI,
    stream,
    reasoningEffort,
    tools,
    toolChoice,
    quirks,
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
    tools,
    toolChoice,
    quirks,
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
  getToolCalls(): AssistantToolCall[];
  getFinishReason(): string;
  getReasoningContent(): string;
  consumeEvent(payload: Record<string, unknown>): void;
}

interface StreamCollectorOptions {
  onTextDelta?: (delta: string) => void;
  onToolCallStarted?: (toolCall: { id: string; name: string }) => void;
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
  options: StreamCollectorOptions = {},
): StreamCollector {
  let consumedLength = 0;
  let lineBuffer = "";
  let dataLines: string[] = [];
  let fullText = "";
  let reasoningContent = "";
  let finishReason = "";
  const toolCallsByIndex = new Map<
    number,
    { id: string; name: string; arguments: string; announced: boolean }
  >();
  const toolCallOrder: number[] = [];

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
      consumePayload(json);
    } catch {
      // Ignore non-JSON SSE payload fragments.
    }
  }

  function consumePayload(json: Record<string, unknown>) {
    const reason = readFinishReason(json);
    if (reason) {
      finishReason = reason;
    }
    accumulateToolCallDelta(json);
    const reasoningDelta = extractReasoningDelta(json);
    if (reasoningDelta) {
      reasoningContent += reasoningDelta;
    }
    const delta = extractStreamDelta(json);
    if (!delta) {
      return;
    }
    fullText += delta;
    options.onTextDelta?.(delta);
  }

  function accumulateToolCallDelta(payload: Record<string, unknown>) {
    const choices = payload.choices;
    if (!Array.isArray(choices) || !choices.length) {
      return;
    }
    const firstChoice = choices[0] as { delta?: unknown };
    const delta = firstChoice.delta as
      | { tool_calls?: OpenAIToolCallPart[] | undefined }
      | undefined;
    const parts = delta?.tool_calls;
    if (!Array.isArray(parts) || !parts.length) {
      return;
    }
    for (const part of parts) {
      const partIndex = readToolCallIndex(part);
      if (partIndex === null) {
        continue;
      }
      let entry = toolCallsByIndex.get(partIndex);
      if (!entry) {
        entry = { id: "", name: "", arguments: "", announced: false };
        toolCallsByIndex.set(partIndex, entry);
        toolCallOrder.push(partIndex);
      }
      if (typeof part.id === "string" && part.id) {
        entry.id = part.id;
      }
      const fn = part.function;
      if (fn) {
        if (typeof fn.name === "string" && fn.name) {
          entry.name = fn.name;
        }
        if (typeof fn.arguments === "string") {
          entry.arguments += fn.arguments;
        }
      }
      if (!entry.announced && entry.name) {
        entry.announced = true;
        try {
          options.onToolCallStarted?.({
            id: entry.id || `call-${partIndex}`,
            name: entry.name,
          });
        } catch {
          // subscribers must not break stream parsing
        }
      }
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
    getToolCalls() {
      const calls: AssistantToolCall[] = [];
      for (const index of toolCallOrder) {
        const entry = toolCallsByIndex.get(index);
        if (!entry || !entry.name) {
          continue;
        }
        calls.push({
          id: entry.id || `call-${index}`,
          name: entry.name,
          arguments: entry.arguments || "{}",
        });
      }
      return calls;
    },
    getFinishReason() {
      return finishReason;
    },
    getReasoningContent() {
      return reasoningContent;
    },
    consumeEvent(payload: Record<string, unknown>) {
      consumePayload(payload);
    },
  };
}

function readToolCallIndex(part: OpenAIToolCallPart & { index?: unknown }) {
  const index = (part as { index?: unknown }).index;
  if (typeof index === "number" && Number.isFinite(index)) {
    return Math.floor(index);
  }
  if (typeof index === "string" && /^\d+$/.test(index)) {
    return Number.parseInt(index, 10);
  }
  return null;
}

function readFinishReason(payload: Record<string, unknown>): string {
  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length) {
    const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
    if (typeof reason === "string" && reason) {
      return reason;
    }
  }
  return "";
}

function extractResponseToolCalls(
  response: OpenAIChatResponse,
): AssistantToolCall[] {
  const message = response.choices?.[0]?.message;
  const parts = message?.tool_calls;
  if (!Array.isArray(parts) || !parts.length) {
    return [];
  }
  const calls: AssistantToolCall[] = [];
  for (const [index, part] of parts.entries()) {
    const name = part.function?.name;
    if (!name) {
      continue;
    }
    calls.push({
      id: part.id || `call-${index}`,
      name,
      arguments:
        typeof part.function?.arguments === "string"
          ? part.function.arguments
          : "{}",
    });
  }
  return calls;
}

function extractFinishReason(response: OpenAIChatResponse): string {
  const reason = response.choices?.[0]?.finish_reason;
  return typeof reason === "string" ? reason : "";
}

function extractResponseReasoningContent(response: OpenAIChatResponse): string {
  const message = response.choices?.[0]?.message;
  const value = (message as { reasoning_content?: unknown })?.reasoning_content;
  return typeof value === "string" ? value : "";
}

function extractReasoningDelta(payload: Record<string, unknown>): string {
  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length) {
    const firstChoice = choices[0] as { delta?: unknown; message?: unknown };
    const delta = firstChoice.delta as
      | { reasoning_content?: unknown }
      | undefined;
    const value = delta?.reasoning_content;
    if (typeof value === "string" && value) {
      return value;
    }
    // Some relays emit the field on the synthesized non-stream "message"
    // shape inside a streamed final event.
    const message = firstChoice.message as
      | { reasoning_content?: unknown }
      | undefined;
    const messageValue = message?.reasoning_content;
    if (typeof messageValue === "string" && messageValue) {
      return messageValue;
    }
  }
  return "";
}

function isReasoningContentRequiredErrorMessage(message: string): boolean {
  const lower = (message || "").toLowerCase();
  if (!lower.includes("reasoning_content")) {
    return false;
  }
  return (
    lower.includes("must be passed") ||
    lower.includes("must be returned") ||
    lower.includes("required") ||
    lower.includes("missing") ||
    lower.includes("缺失") ||
    lower.includes("必须")
  );
}

function isToolsUnsupportedErrorMessage(message: string): boolean {
  const lower = (message || "").toLowerCase();
  if (!lower) {
    return false;
  }
  if (!lower.includes("tool")) {
    return false;
  }
  return (
    lower.includes("unsupported") ||
    lower.includes("not support") ||
    lower.includes("not allowed") ||
    lower.includes("unknown parameter") ||
    lower.includes("unrecognized") ||
    lower.includes("invalid") ||
    lower.includes("unexpected")
  );
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
    tools?: ChatToolSpec[],
    toolChoice?: ChatToolChoice,
  ) {
    return buildPayloadVariants(
      [{ role: "user", content: "test" }],
      "test-model",
      wireAPI,
      stream,
      reasoningEffort,
      tools,
      toolChoice,
    );
  },
  buildChatPayload(
    messages: AgentMessage[],
    tools?: ChatToolSpec[],
    toolChoice?: ChatToolChoice,
    echoReasoningContent: boolean = false,
  ) {
    return buildRequestPayload(
      messages,
      "test-model",
      "chat-completions",
      false,
      "default",
      tools,
      toolChoice,
      { ...defaultProviderQuirks(), echoReasoningContent },
    );
  },
  parseStreamEvents(events: Record<string, unknown>[]) {
    const collector = createStreamCollector();
    for (const event of events) {
      collector.consumeEvent(event);
    }
    return {
      text: collector.getText(),
      toolCalls: collector.getToolCalls(),
      finishReason: collector.getFinishReason(),
      reasoningContent: collector.getReasoningContent(),
    };
  },
  extractResponseToolCalls(response: OpenAIChatResponse) {
    return extractResponseToolCalls(response);
  },
  extractFinishReason(response: OpenAIChatResponse) {
    return extractFinishReason(response);
  },
  extractResponseReasoningContent(response: OpenAIChatResponse) {
    return extractResponseReasoningContent(response);
  },
  isToolsUnsupportedErrorMessage,
  isReasoningContentRequiredErrorMessage,
};
