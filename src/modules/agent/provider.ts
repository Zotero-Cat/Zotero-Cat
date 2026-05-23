import { getPref } from "../../utils/prefs";
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
import {
  createResponseIdleWatchdog,
  createStreamCollector,
  extractStreamDelta,
} from "./provider/streaming";
import {
  type OpenAIChatResponse,
  extractFinishReason,
  extractResponseReasoningContent,
  extractResponseToolCalls,
  isReasoningContentRequiredErrorMessage,
  isToolsUnsupportedErrorMessage,
} from "./provider/responseParsing";
import {
  type EndpointAttempt,
  type WireAPI,
  readEndpointHint,
  rememberEndpointHint,
} from "./provider/endpointHints";

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

type ReasoningEffortSetting = ReasoningEffortValue;

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
