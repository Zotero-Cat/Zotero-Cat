// Serialization of AgentMessage[] into the OpenAI chat-completions request
// shape, with quirk-driven `reasoning_content` echoing baked in. Kept separate
// from provider.ts so quirks land in exactly one place and the runner can be
// unit-tested without HTTP.

import type { AgentMessage } from "../types";
import type { ProviderQuirks } from "./quirks";

export interface SerializeOptions {
  quirks?: ProviderQuirks;
}

export function serializeMessageForChat(
  message: AgentMessage,
  options: SerializeOptions = {},
): Record<string, unknown> {
  const quirks = options.quirks;

  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId || "",
      content: message.content || "",
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    const serialized: Record<string, unknown> = {
      role: "assistant",
      content: message.content || "",
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: call.arguments || "{}",
        },
      })),
    };
    applyReasoningContentEcho(serialized, message, quirks);
    return serialized;
  }

  if (message.role === "assistant") {
    const serialized: Record<string, unknown> = {
      role: message.role,
      content: message.content,
    };
    applyReasoningContentEcho(serialized, message, quirks);
    return serialized;
  }

  return {
    role: message.role,
    content: message.content,
  };
}

export function serializeMessagesForChat(
  messages: AgentMessage[],
  options: SerializeOptions = {},
): Record<string, unknown>[] {
  return messages.map((message) => serializeMessageForChat(message, options));
}

function applyReasoningContentEcho(
  target: Record<string, unknown>,
  message: AgentMessage,
  quirks: ProviderQuirks | undefined,
): void {
  if (!quirks?.echoReasoningContent) {
    return;
  }
  const captured = message.reasoningContent || "";
  if (captured) {
    target.reasoning_content = captured;
    return;
  }
  switch (quirks.reasoningContentEmptyPolicy) {
    case "omit":
      return;
    case "space":
      target.reasoning_content = " ";
      return;
    case "empty":
    default:
      target.reasoning_content = "";
      return;
  }
}
