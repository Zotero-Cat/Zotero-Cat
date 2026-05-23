import type { AssistantToolCall } from "../types";
import type { OpenAIToolCallPart } from "./streaming";

export interface OpenAIChatResponse {
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

export function extractResponseToolCalls(
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

export function extractFinishReason(response: OpenAIChatResponse): string {
  const reason = response.choices?.[0]?.finish_reason;
  return typeof reason === "string" ? reason : "";
}

export function extractResponseReasoningContent(
  response: OpenAIChatResponse,
): string {
  const message = response.choices?.[0]?.message;
  const value = (message as { reasoning_content?: unknown })?.reasoning_content;
  return typeof value === "string" ? value : "";
}

export function isReasoningContentRequiredErrorMessage(
  message: string,
): boolean {
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

export function isToolsUnsupportedErrorMessage(message: string): boolean {
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
