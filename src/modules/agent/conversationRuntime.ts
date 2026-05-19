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
  return messages
    .filter((message) => message.kind !== "tool-event")
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}
