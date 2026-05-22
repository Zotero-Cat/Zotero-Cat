import type { AgentMessage } from "./types";
import { createRuntimeID } from "./runtimeIds";
import { stripAssistantToolActionMarkup } from "./toolAction";

export const CONVERSATION_STORE_VERSION = 2;
export const MAX_PERSISTED_CONVERSATIONS = 128;
export const MAX_PERSISTED_CONVERSATIONS_PER_SCOPE = 24;
export const MAX_VISIBLE_CONVERSATION_OPTIONS = 8;
export const MAX_PERSISTED_MESSAGES_PER_CONVERSATION = 80;
export const MAX_PERSISTED_MESSAGE_CHARS = 12_000;

export type ToolEventStatus = "running" | "done" | "failed";

export interface ToolEventInfo {
  toolType: string;
  status: ToolEventStatus;
  startedAt: number;
  finishedAt?: number;
  errorMessage?: string;
}

export interface RuntimeMessage extends AgentMessage {
  createdAt: number;
  responseWaitMs?: number;
  kind?: "chat" | "tool-event";
  toolEvent?: ToolEventInfo;
}

export interface ConversationState {
  id: string;
  key: string;
  scopeKey: string;
  createdAt: number;
  updatedAt: number;
  messages: RuntimeMessage[];
  title?: string;
  favorite?: boolean;
}

export interface ParsedConversationStore {
  active: Record<string, string>;
  conversations: ConversationState[];
}

export function createConversation(scopeKey: string): ConversationState {
  const now = Date.now();
  const id = createRuntimeID("session");
  return {
    id,
    key: buildConversationKey(scopeKey, id),
    scopeKey,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function buildConversationKey(scopeKey: string, conversationID: string) {
  return `${scopeKey}::${conversationID}`;
}

export function parseConversationStore(raw: unknown): ConversationState[] {
  return parseConversationStorePayload(raw).conversations;
}

export function parseConversationStorePayload(
  raw: unknown,
): ParsedConversationStore {
  if (typeof raw !== "string" || !raw.trim()) {
    return { active: {}, conversations: [] };
  }
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      active?: unknown;
      conversations?: unknown;
    };
    if (!Array.isArray(parsed.conversations)) {
      return { active: {}, conversations: [] };
    }
    const conversations: ConversationState[] = [];
    const active: Record<string, string> = {};
    const version =
      parsed.version === 1 || parsed.version === 2 ? parsed.version : 0;
    if (!version) {
      return { active, conversations };
    }
    for (const entry of parsed.conversations) {
      const conversation = normalizePersistedConversation(entry, version);
      if (conversation) {
        conversations.push(conversation);
      }
    }
    if (version === 2 && parsed.active && typeof parsed.active === "object") {
      for (const [scopeKey, conversationKey] of Object.entries(
        parsed.active as Record<string, unknown>,
      )) {
        if (typeof conversationKey === "string" && conversationKey.trim()) {
          active[scopeKey] = conversationKey.trim();
        }
      }
    }
    if (version === 1) {
      for (const conversation of conversations) {
        if (!active[conversation.scopeKey]) {
          active[conversation.scopeKey] = conversation.key;
        }
      }
    }
    return { active, conversations };
  } catch {
    return { active: {}, conversations: [] };
  }
}

export function touchConversation(conversation: ConversationState) {
  conversation.updatedAt = Date.now();
}

export function selectConversationsForPersistence(
  conversations: readonly ConversationState[],
) {
  const scopeCounts = new Map<string, number>();
  const output: ConversationState[] = [];
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const conversation of sorted) {
    if (output.length >= MAX_PERSISTED_CONVERSATIONS) {
      break;
    }
    const count = scopeCounts.get(conversation.scopeKey) || 0;
    if (count >= MAX_PERSISTED_CONVERSATIONS_PER_SCOPE) {
      continue;
    }
    scopeCounts.set(conversation.scopeKey, count + 1);
    output.push(conversation);
  }
  return output;
}

export function buildActiveConversationStore(
  activeConversationKeyByScope: Map<string, string>,
  conversationsByKey: Map<string, ConversationState>,
) {
  const active: Record<string, string> = {};
  for (const [scopeKey, conversationKey] of activeConversationKeyByScope) {
    const conversation = conversationsByKey.get(conversationKey);
    if (conversation?.scopeKey === scopeKey) {
      active[scopeKey] = conversationKey;
    }
  }
  return active;
}

export function serializeConversation(conversation: ConversationState) {
  const messages = conversation.messages
    .filter((message) => message.kind !== "tool-event")
    .filter((message) => message.content.trim())
    .slice(-MAX_PERSISTED_MESSAGES_PER_CONVERSATION)
    .map((message) => ({
      role: message.role,
      content: truncateForPersistence(message.content),
      createdAt: message.createdAt,
      ...(typeof message.responseWaitMs === "number"
        ? { responseWaitMs: message.responseWaitMs }
        : {}),
      ...(message.reasoningContent
        ? { reasoning_content: message.reasoningContent }
        : {}),
    }));
  return {
    id: conversation.id,
    key: conversation.key,
    scopeKey: conversation.scopeKey,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages,
    ...(conversation.title ? { title: conversation.title } : {}),
    ...(conversation.favorite ? { favorite: true } : {}),
  };
}

export function truncateForPersistence(text: string) {
  const stripped = stripActionJSONBlocks(text);
  if (stripped.length <= MAX_PERSISTED_MESSAGE_CHARS) {
    return stripped;
  }
  return stripped.slice(0, MAX_PERSISTED_MESSAGE_CHARS);
}

function stripActionJSONBlocks(text: string): string {
  // Remove tool directives so raw JSON/XML-ish action markup does not become
  // part of persisted chat history.
  return stripAssistantToolActionMarkup(text);
}

function normalizePersistedConversation(entry: unknown, version: 1 | 2) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const rawScopeKey =
    typeof record.scopeKey === "string"
      ? record.scopeKey.trim()
      : typeof record.key === "string"
        ? record.key.trim()
        : "";
  if (!rawScopeKey) {
    return null;
  }
  const now = Date.now();
  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : createRuntimeID("session");
  const key =
    version === 2 && typeof record.key === "string" && record.key.trim()
      ? record.key.trim()
      : buildConversationKey(rawScopeKey, id);
  const createdAt = normalizeTimestamp(record.createdAt, now);
  const updatedAt = normalizeTimestamp(record.updatedAt, createdAt);
  const rawMessages = Array.isArray(record.messages) ? record.messages : [];
  const messages = rawMessages
    .map(normalizePersistedMessage)
    .filter((message): message is RuntimeMessage => Boolean(message));
  return {
    id,
    key,
    scopeKey: rawScopeKey,
    createdAt,
    updatedAt,
    messages,
    ...(typeof record.title === "string" && record.title.trim()
      ? { title: record.title.trim() }
      : {}),
    ...(record.favorite === true ? { favorite: true } : {}),
  };
}

function normalizePersistedMessage(entry: unknown): RuntimeMessage | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const role = record.role;
  if (role !== "user" && role !== "assistant") {
    return null;
  }
  const content = typeof record.content === "string" ? record.content : "";
  const createdAt = normalizeTimestamp(record.createdAt, Date.now());
  const responseWaitMs = normalizeOptionalDuration(record.responseWaitMs);
  const reasoningContent =
    typeof record.reasoning_content === "string" && record.reasoning_content
      ? record.reasoning_content
      : "";
  return {
    role,
    content: truncateForPersistence(content),
    createdAt,
    ...(responseWaitMs === null ? {} : { responseWaitMs }),
    ...(reasoningContent ? { reasoningContent } : {}),
  };
}

function normalizeTimestamp(value: unknown, fallback: number) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return fallback;
  }
  return Math.floor(timestamp);
}

function normalizeOptionalDuration(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration < 0) {
    return null;
  }
  return Math.floor(duration);
}
