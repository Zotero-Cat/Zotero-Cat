import { getString } from "../../../utils/locale";
import type { AssistantToolCall } from "../types";

export interface OpenAIToolCallPart {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface StreamCollector {
  attach(xhr: XMLHttpRequest, onProgress?: () => void): void;
  finalize(): void;
  getText(): string;
  getToolCalls(): AssistantToolCall[];
  getFinishReason(): string;
  getReasoningContent(): string;
  consumeEvent(payload: Record<string, unknown>): void;
}

export interface StreamCollectorOptions {
  onTextDelta?: (delta: string) => void;
  onToolCallStarted?: (toolCall: { id: string; name: string }) => void;
}

export interface ResponseIdleWatchdog {
  markActivity(): void;
  setCanceller(cancel: () => void): void;
  clear(): void;
  getTimeoutError(): Error | null;
}

export function createResponseIdleWatchdog(
  timeoutMs: number,
): ResponseIdleWatchdog {
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

export function createStreamCollector(
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

export function readToolCallIndex(
  part: OpenAIToolCallPart & { index?: unknown },
): number | null {
  const index = (part as { index?: unknown }).index;
  if (typeof index === "number" && Number.isFinite(index)) {
    return Math.floor(index);
  }
  if (typeof index === "string" && /^\d+$/.test(index)) {
    return Number.parseInt(index, 10);
  }
  return null;
}

export function readFinishReason(payload: Record<string, unknown>): string {
  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length) {
    const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
    if (typeof reason === "string" && reason) {
      return reason;
    }
  }
  return "";
}

export function extractReasoningDelta(
  payload: Record<string, unknown>,
): string {
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

export function extractStreamDelta(payload: Record<string, unknown>): string {
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
