import type { AgentRuntime } from "./state";

function buildMessageActionKey(
  conversationKey: string,
  messageIndex: number,
): string {
  return `${conversationKey}::${messageIndex}`;
}

export function queueToolActionContent(
  runtime: AgentRuntime,
  conversationKey: string,
  messageIndex: number,
  content: string,
): void {
  runtime.pendingToolActionContentByMessage.set(
    buildMessageActionKey(conversationKey, messageIndex),
    content,
  );
}

export function takeToolActionContent(
  runtime: AgentRuntime,
  conversationKey: string,
  messageIndex: number,
): string {
  const key = buildMessageActionKey(conversationKey, messageIndex);
  const content = runtime.pendingToolActionContentByMessage.get(key) || "";
  runtime.pendingToolActionContentByMessage.delete(key);
  return content;
}
