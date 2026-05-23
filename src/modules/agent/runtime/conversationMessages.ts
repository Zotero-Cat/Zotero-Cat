import type { AgentRuntime } from "./state";
import { startWaitingAnimation, startWorkingState } from "./requestState";
import {
  getConversationForKey,
  touchConversationByKey,
} from "../conversationRuntime";

export function appendToolResultMessage(
  runtime: AgentRuntime,
  conversationKey: string,
  options: { toolCallId: string; toolName: string; content: string },
): number {
  const conversation = getConversationForKey(runtime, conversationKey);
  if (!conversation) {
    return -1;
  }
  const index =
    conversation.messages.push({
      role: "tool",
      content: options.content,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      createdAt: Date.now(),
    }) - 1;
  touchConversationByKey(runtime, conversationKey);
  return index;
}

export function appendAssistantContinuation(
  runtime: AgentRuntime,
  conversationKey: string,
): number {
  const conversation = getConversationForKey(runtime, conversationKey);
  if (!conversation) {
    return -1;
  }
  const index =
    conversation.messages.push({
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    }) - 1;
  touchConversationByKey(runtime, conversationKey);
  runtime.streamingAssistant = null;
  if (runtime.sending) {
    startWorkingState(runtime, conversationKey);
  }
  startWaitingAnimation(runtime, conversationKey, index);
  return index;
}
