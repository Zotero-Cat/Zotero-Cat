import type { RuntimeMessage } from "../conversationStore";
import type { AgentRuntime } from "./state";

export function requestCancel(runtime: AgentRuntime): void {
  if (!runtime.sending) {
    return;
  }
  runtime.cancelRequested = true;
  if (runtime.cancelActiveRequest) {
    runtime.cancelActiveRequest();
  }
}

export function startWorkingState(
  runtime: AgentRuntime,
  conversationKey: string,
): void {
  runtime.workingConversationKey = conversationKey;
}

export function clearWorkingState(
  runtime: AgentRuntime,
  conversationKey: string,
): void {
  if (runtime.workingConversationKey === conversationKey) {
    runtime.workingConversationKey = null;
  }
}

export function startWaitingAnimation(
  runtime: AgentRuntime,
  conversationKey: string,
  assistantMessageIndex: number,
): void {
  runtime.waitingAssistant = {
    conversationKey,
    messageIndex: assistantMessageIndex,
  };
  runtime.waitingStartedAt = Date.now();
  runtime.waitingToken += 1;
}

export function stopWaitingAnimation(
  runtime: AgentRuntime,
  getMessage: (
    conversationKey: string,
    messageIndex: number,
  ) => RuntimeMessage | null,
  onTouch: (conversationKey: string) => void,
): void {
  const waiting = runtime.waitingAssistant;
  if (waiting && runtime.waitingStartedAt !== null) {
    const assistantMessage = getMessage(
      waiting.conversationKey,
      waiting.messageIndex,
    );
    if (assistantMessage && assistantMessage.responseWaitMs === undefined) {
      assistantMessage.responseWaitMs = Math.max(
        0,
        Date.now() - runtime.waitingStartedAt,
      );
      onTouch(waiting.conversationKey);
    }
  }
  runtime.waitingAssistant = null;
  runtime.waitingStartedAt = null;
  runtime.waitingToken += 1;
}
