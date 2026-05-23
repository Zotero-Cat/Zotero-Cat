import { getConversationForKey as getConversationForKeyInRuntime } from "../conversationRuntime";
import type { RuntimeMessage } from "../conversationStore";
import {
  createRunningToolEventMessage,
  markToolEventMessage,
  normalizeToolKind,
} from "../toolEventState";
import { startWorkingState as startWorkingStateInRuntime } from "./requestState";
import type { AgentRuntime } from "./state";

export interface ToolEventDeps {
  getConversationMessage: (
    conversationKey: string,
    messageIndex: number,
  ) => RuntimeMessage | null;
  touchConversationByKey: (conversationKey: string) => void;
  clearWebSearchStatus: () => void;
}

export function appendToolEventMessage(
  runtime: AgentRuntime,
  conversationKey: string,
  toolType: string,
  deps: ToolEventDeps,
): number {
  const conversation = getConversationForKeyInRuntime(runtime, conversationKey);
  if (!conversation) {
    return -1;
  }
  if (normalizeToolKind(toolType) !== "web-search") {
    deps.clearWebSearchStatus();
  }
  const index =
    conversation.messages.push(createRunningToolEventMessage(toolType)) - 1;
  runtime.activeToolEventByKey.set(conversationKey, index);
  runtime.latestToolEventByKey.set(conversationKey, index);
  if (runtime.sending) {
    startWorkingStateInRuntime(runtime, conversationKey);
  }
  deps.touchConversationByKey(conversationKey);
  return index;
}

export function markToolEventDone(
  runtime: AgentRuntime,
  conversationKey: string,
  messageIndex: number,
  deps: ToolEventDeps,
): void {
  const message = deps.getConversationMessage(conversationKey, messageIndex);
  if (!markToolEventMessage(message, "done")) {
    return;
  }
  if (runtime.activeToolEventByKey.get(conversationKey) === messageIndex) {
    runtime.activeToolEventByKey.delete(conversationKey);
  }
  deps.touchConversationByKey(conversationKey);
}

export function markToolEventFailed(
  runtime: AgentRuntime,
  conversationKey: string,
  messageIndex: number,
  errorMessage: string,
  deps: ToolEventDeps,
): void {
  const message = deps.getConversationMessage(conversationKey, messageIndex);
  if (!markToolEventMessage(message, "failed", { errorMessage })) {
    return;
  }
  if (runtime.activeToolEventByKey.get(conversationKey) === messageIndex) {
    runtime.activeToolEventByKey.delete(conversationKey);
  }
  deps.touchConversationByKey(conversationKey);
}

export function failActiveToolEvent(
  runtime: AgentRuntime,
  conversationKey: string,
  errorMessage: string,
  deps: ToolEventDeps,
): void {
  const index = runtime.activeToolEventByKey.get(conversationKey);
  if (typeof index === "number") {
    markToolEventFailed(runtime, conversationKey, index, errorMessage, deps);
  }
}
