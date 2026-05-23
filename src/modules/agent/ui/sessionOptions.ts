import { getString } from "../../../utils/locale";
import {
  ConversationState,
  MAX_VISIBLE_CONVERSATION_OPTIONS,
  touchConversation,
} from "../conversationStore";
import { truncateInline, formatShortDateTime } from "../../../utils/text";

export function limitConversationOptions(
  conversations: ConversationState[],
  activeConversationKey: string,
): ConversationState[] {
  if (conversations.length <= MAX_VISIBLE_CONVERSATION_OPTIONS) {
    return conversations;
  }
  const visibleConversations = conversations.slice(
    0,
    MAX_VISIBLE_CONVERSATION_OPTIONS,
  );
  if (
    visibleConversations.some(
      (conversation) => conversation.key === activeConversationKey,
    )
  ) {
    return visibleConversations;
  }
  const activeConversation = conversations.find(
    (conversation) => conversation.key === activeConversationKey,
  );
  if (!activeConversation) {
    return visibleConversations;
  }
  return [
    activeConversation,
    ...visibleConversations.slice(0, MAX_VISIBLE_CONVERSATION_OPTIONS - 1),
  ];
}

export function formatConversationOptionLabel(
  conversation: ConversationState,
): string {
  const prefix = conversation.favorite ? "★ " : "";
  if (conversation.title) {
    return `${prefix}${truncateInline(conversation.title, 36)} · ${formatShortDateTime(conversation.updatedAt)}`;
  }
  const firstUserMessage = conversation.messages.find(
    (message) => message.role === "user" && message.content.trim(),
  );
  const summary = firstUserMessage
    ? truncateInline(firstUserMessage.content, 36)
    : getString("agent-session-untitled");
  return `${prefix}${summary} · ${formatShortDateTime(conversation.updatedAt)}`;
}

export function buildConversationExportText(
  conversation: ConversationState,
): string {
  const lines: string[] = [];
  lines.push(`# Zotero-Cat Conversation Export`);
  lines.push("");
  if (conversation.title) {
    lines.push(`**Title:** ${conversation.title}`);
  }
  lines.push(`**Date:** ${new Date(conversation.createdAt).toISOString()}`);
  lines.push(`**Messages:** ${conversation.messages.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const message of conversation.messages) {
    const role = message.role === "user" ? "User" : "Assistant";
    const time = new Date(message.createdAt).toISOString();
    lines.push(`### ${role} (${time})`);
    lines.push("");
    lines.push(message.content);
    lines.push("");
  }
  return lines.join("\n");
}

export function copyConversationToClipboard(text: string): void {
  try {
    const win = Zotero.getMainWindow();
    if (win?.navigator?.clipboard) {
      void win.navigator.clipboard.writeText(text);
    }
  } catch {
    // Ignore clipboard errors
  }
}

export function promptRenameConversation(
  doc: Document,
  conversation: ConversationState,
  onChanged: () => void,
): void {
  const currentTitle = conversation.title || "";
  const newTitle = doc.defaultView?.prompt(
    getString("agent-rename-prompt"),
    currentTitle,
  );
  if (newTitle === null || newTitle === undefined) {
    return;
  }
  conversation.title = newTitle.trim() || undefined;
  touchConversation(conversation);
  onChanged();
}

export function showToast(message: string): void {
  try {
    const win = Zotero.getMainWindow();
    if (!win) {
      return;
    }
    Zotero.log(`[Zotero-Cat] ${message}`);
  } catch {
    // Ignore
  }
}
