import {
  touchConversation,
  type ConversationState,
} from "../conversationStore";
import { toProviderMessages } from "../conversationRuntime";
import type { AgentMessage } from "../types";
import { startWaitingAnimation, startWorkingState } from "./requestState";
import type { AgentRuntime } from "./state";

export interface UserTurnStart {
  assistantMessageIndex: number;
  requestMessages: AgentMessage[];
  requestToken: number;
}

export function beginUserTurn(
  runtime: AgentRuntime,
  conversation: ConversationState,
  conversationKey: string,
  prompt: string,
): UserTurnStart {
  runtime.sending = true;
  startWorkingState(runtime, conversationKey);
  runtime.cancelRequested = false;
  runtime.cancelActiveRequest = null;
  runtime.requestToken += 1;
  runtime.webSearchStatusMessage = "";
  runtime.webSearchStatusKind = "";
  runtime.latestToolEventByKey.delete(conversationKey);

  const requestToken = runtime.requestToken;
  conversation.messages.push({
    role: "user",
    content: prompt,
    createdAt: Date.now(),
  });
  touchConversation(conversation);
  const requestMessages = toProviderMessages(conversation.messages);
  const assistantMessageIndex =
    conversation.messages.push({
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    }) - 1;
  touchConversation(conversation);

  runtime.shouldAutoScroll = true;
  runtime.streamingAssistant = null;
  startWaitingAnimation(runtime, conversationKey, assistantMessageIndex);

  return {
    assistantMessageIndex,
    requestMessages,
    requestToken,
  };
}
