import type { AgentMessage } from "./types";
import {
  ConversationState,
  ParsedConversationStore,
  RuntimeMessage,
  createConversation,
  touchConversation,
} from "./conversationStore";

export interface MessagePointer {
  conversationKey: string;
  messageIndex: number;
}

export interface ConversationRuntimeState {
  conversationsByKey: Map<string, ConversationState>;
  activeConversationKeyByScope: Map<string, string>;
}

export function createConversationRuntimeState(): ConversationRuntimeState {
  return {
    conversationsByKey: new Map(),
    activeConversationKeyByScope: new Map(),
  };
}

export function getActiveConversationForScope(
  state: ConversationRuntimeState,
  scopeKey: string,
): ConversationState {
  const activeKey = state.activeConversationKeyByScope.get(scopeKey);
  const activeConversation = activeKey
    ? state.conversationsByKey.get(activeKey)
    : null;
  if (activeConversation?.scopeKey === scopeKey) {
    return activeConversation;
  }
  const latestConversation = getConversationsForScope(state, scopeKey)[0];
  if (latestConversation) {
    state.activeConversationKeyByScope.set(scopeKey, latestConversation.key);
    return latestConversation;
  }
  return createNewConversationForScope(state, scopeKey);
}

export function getConversationForKey(
  state: ConversationRuntimeState,
  conversationKey: string,
): ConversationState | null {
  return state.conversationsByKey.get(conversationKey) || null;
}

export function getConversationsForScope(
  state: ConversationRuntimeState,
  scopeKey: string,
): ConversationState[] {
  return [...state.conversationsByKey.values()]
    .filter((conversation) => conversation.scopeKey === scopeKey)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createNewConversationForScope(
  state: ConversationRuntimeState,
  scopeKey: string,
): ConversationState {
  const conversation = createConversation(scopeKey);
  state.conversationsByKey.set(conversation.key, conversation);
  state.activeConversationKeyByScope.set(scopeKey, conversation.key);
  return conversation;
}

export function getConversationMessage(
  state: ConversationRuntimeState,
  conversationKey: string,
  messageIndex: number,
): RuntimeMessage | null {
  return (
    getConversationForKey(state, conversationKey)?.messages[messageIndex] ||
    null
  );
}

export function touchConversationByKey(
  state: ConversationRuntimeState,
  conversationKey: string,
): boolean {
  const conversation = getConversationForKey(state, conversationKey);
  if (!conversation) {
    return false;
  }
  touchConversation(conversation);
  return true;
}

export function clearConversationMessages(
  state: ConversationRuntimeState,
  conversationKey: string,
): boolean {
  const conversation = getConversationForKey(state, conversationKey);
  if (!conversation) {
    return false;
  }
  conversation.messages = [];
  touchConversation(conversation);
  return true;
}

export function selectConversation(
  state: ConversationRuntimeState,
  scopeKey: string,
  conversationKey: string,
): boolean {
  const conversation = getConversationForKey(state, conversationKey);
  if (!conversation || conversation.scopeKey !== scopeKey) {
    return false;
  }
  state.activeConversationKeyByScope.set(scopeKey, conversation.key);
  return true;
}

export function deleteConversation(
  state: ConversationRuntimeState,
  scopeKey: string,
  conversationKey: string,
): ConversationState | null {
  const conversation = getConversationForKey(state, conversationKey);
  if (!conversation || conversation.scopeKey !== scopeKey) {
    return null;
  }
  state.conversationsByKey.delete(conversationKey);
  const nextConversation =
    getConversationsForScope(state, scopeKey).find(
      (candidate) => candidate.key !== conversationKey,
    ) || createNewConversationForScope(state, scopeKey);
  state.activeConversationKeyByScope.set(scopeKey, nextConversation.key);
  return nextConversation;
}

export function applyConversationStoreToRuntime(
  state: ConversationRuntimeState,
  store: ParsedConversationStore,
): void {
  state.conversationsByKey.clear();
  state.activeConversationKeyByScope.clear();
  for (const conversation of store.conversations) {
    state.conversationsByKey.set(conversation.key, conversation);
  }
  for (const [scopeKey, conversationKey] of Object.entries(store.active)) {
    const conversation = state.conversationsByKey.get(conversationKey);
    if (conversation?.scopeKey === scopeKey) {
      state.activeConversationKeyByScope.set(scopeKey, conversationKey);
    }
  }
  const scopes = new Set(
    store.conversations.map((conversation) => conversation.scopeKey),
  );
  for (const scopeKey of scopes) {
    if (state.activeConversationKeyByScope.has(scopeKey)) {
      continue;
    }
    const latest = getConversationsForScope(state, scopeKey)[0];
    if (latest) {
      state.activeConversationKeyByScope.set(scopeKey, latest.key);
    }
  }
}

export function pointsToMessage(
  pointer: MessagePointer | null,
  conversationKey: string,
  messageIndex: number,
): boolean {
  return (
    pointer?.conversationKey === conversationKey &&
    pointer.messageIndex === messageIndex
  );
}

export function toProviderMessages(
  messages: readonly RuntimeMessage[],
): AgentMessage[] {
  const projected = messages
    .filter((message) => message.kind !== "tool-event")
    .filter((message) => {
      if (message.content.trim()) {
        return true;
      }
      // Assistant turns can finish with tool_calls and no visible prose; tool
      // result messages can carry a toolCallId with an empty body. Either way
      // they must survive into the next request so the model can continue the
      // tool-calling chain on a follow-up user turn.
      if (message.role === "assistant" && message.toolCalls?.length) {
        return true;
      }
      if (message.role === "tool" && message.toolCallId) {
        return true;
      }
      return false;
    })
    .map((message) => {
      const agentMessage: AgentMessage = {
        role: message.role,
        content: message.content,
      };
      if (message.reasoningContent) {
        agentMessage.reasoningContent = message.reasoningContent;
      }
      if (message.toolCalls?.length) {
        agentMessage.toolCalls = message.toolCalls;
      }
      if (message.toolCallId) {
        agentMessage.toolCallId = message.toolCallId;
      }
      if (message.toolName) {
        agentMessage.toolName = message.toolName;
      }
      return agentMessage;
    });
  return sanitizeToolCallSequences(projected);
}

// Strict providers (DeepSeek, OpenAI) reject requests where an assistant
// message carrying `tool_calls` is not immediately followed by a `tool`
// message for each tool_call_id. We can land in that shape after a
// cancellation, an error mid-tool-execution, or any path that pushes an
// assistant tool_calls turn without persisting matching tool results. This
// pass removes any such orphans before the request leaves the client.
function sanitizeToolCallSequences(
  messages: readonly AgentMessage[],
): AgentMessage[] {
  const result: AgentMessage[] = [];
  let i = 0;
  while (i < messages.length) {
    const message = messages[i];
    if (message.role === "assistant" && message.toolCalls?.length) {
      const expectedIds = new Set(message.toolCalls.map((call) => call.id));
      const matched: AgentMessage[] = [];
      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool") {
        const candidate = messages[j];
        const callId = candidate.toolCallId;
        if (callId && expectedIds.has(callId)) {
          expectedIds.delete(callId);
          matched.push(candidate);
        }
        // Tool messages without a matching tool_call_id are dropped silently.
        j++;
      }
      if (expectedIds.size === 0) {
        result.push(message, ...matched);
      } else {
        // Orphan tool_calls: rebuild the message without the toolCalls
        // field so the visible prose can still anchor it. If there is no
        // prose either, drop the message entirely. Any matched tool
        // messages we collected are dropped too — without the preceding
        // tool_calls they would also be invalid.
        if (message.content.trim()) {
          const stripped: AgentMessage = {
            role: message.role,
            content: message.content,
          };
          if (message.reasoningContent) {
            stripped.reasoningContent = message.reasoningContent;
          }
          result.push(stripped);
        }
      }
      i = j;
      continue;
    }
    if (message.role === "tool") {
      // Tool message with no preceding assistant.tool_calls — drop.
      i++;
      continue;
    }
    result.push(message);
    i++;
  }
  return result;
}
