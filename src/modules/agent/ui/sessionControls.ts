import { getString } from "../../../utils/locale";
import { ConversationState, touchConversation } from "../conversationStore";
import type { AgentRuntime } from "../runtime/state";
import {
  buildConversationExportText,
  copyConversationToClipboard,
  formatConversationOptionLabel,
  limitConversationOptions,
  promptRenameConversation,
  showToast,
} from "./sessionOptions";

export interface SessionControlsHandlers {
  getConversationsForScope: (scopeKey: string) => ConversationState[];
  startNewConversation: (scopeKey: string) => void;
  clearConversationMessages: (conversationKey: string) => void;
  selectConversation: (scopeKey: string, conversationKey: string) => void;
  deleteConversation: (scopeKey: string, conversationKey: string) => void;
  flushConversationStore: () => void;
  refreshAllSections: () => Promise<void>;
}

export function createSessionControls(
  doc: Document,
  runtime: AgentRuntime,
  scopeKey: string,
  conversation: ConversationState,
  handlers: SessionControlsHandlers,
): HTMLElement {
  const row = doc.createElement("div");
  row.className = "za-agent-session-row";
  const allConversations = handlers.getConversationsForScope(scopeKey);
  const conversations = limitConversationOptions(
    allConversations,
    conversation.key,
  );

  const label = doc.createElement("span");
  label.className = "za-agent-session-label";
  label.textContent = getString("agent-session-label", {
    args: {
      count: String(conversation.messages.length),
    },
  });

  const select = doc.createElement("select");
  select.className = "za-agent-session-select";
  select.disabled = runtime.sending;
  select.title = formatConversationOptionLabel(conversation);
  for (const candidate of conversations) {
    const option = doc.createElement("option");
    option.value = candidate.key;
    const optionLabel = formatConversationOptionLabel(candidate);
    option.textContent = optionLabel;
    option.title = optionLabel;
    select.appendChild(option);
  }
  select.value = conversation.key;
  select.addEventListener("change", () => {
    if (runtime.sending) {
      return;
    }
    handlers.selectConversation(scopeKey, select.value);
    runtime.shouldAutoScroll = true;
    void handlers.refreshAllSections();
  });

  const actions = doc.createElement("div");
  actions.className = "za-agent-session-actions";

  const newButton = doc.createElement("button");
  newButton.className = "za-agent-secondary-button";
  newButton.type = "button";
  newButton.disabled = runtime.sending;
  newButton.textContent = getString("agent-new-session");
  newButton.addEventListener("click", () => {
    if (runtime.sending) {
      return;
    }
    handlers.startNewConversation(scopeKey);
    runtime.shouldAutoScroll = true;
    void handlers.refreshAllSections();
  });

  const clearButton = doc.createElement("button");
  clearButton.className = "za-agent-secondary-button";
  clearButton.type = "button";
  clearButton.disabled = runtime.sending || !conversation.messages.length;
  clearButton.textContent = getString("agent-clear-session");
  clearButton.addEventListener("click", () => {
    if (runtime.sending) {
      return;
    }
    handlers.clearConversationMessages(conversation.key);
    runtime.shouldAutoScroll = true;
    void handlers.refreshAllSections();
  });

  const deleteButton = doc.createElement("button");
  deleteButton.className = "za-agent-secondary-button";
  deleteButton.type = "button";
  deleteButton.disabled =
    runtime.sending ||
    (!conversation.messages.length && allConversations.length <= 1);
  deleteButton.textContent = getString("agent-delete-session");
  deleteButton.addEventListener("click", () => {
    if (runtime.sending) {
      return;
    }
    handlers.deleteConversation(scopeKey, conversation.key);
    runtime.shouldAutoScroll = true;
    void handlers.refreshAllSections();
  });

  const exportButton = doc.createElement("button");
  exportButton.className = "za-agent-secondary-button";
  exportButton.type = "button";
  exportButton.disabled = !conversation.messages.length;
  exportButton.textContent = getString("agent-export-session");
  exportButton.addEventListener("click", () => {
    if (!conversation.messages.length) {
      return;
    }
    copyConversationToClipboard(buildConversationExportText(conversation));
    showToast(getString("agent-export-copied"));
  });

  const renameButton = doc.createElement("button");
  renameButton.className = "za-agent-secondary-button";
  renameButton.type = "button";
  renameButton.disabled = runtime.sending;
  renameButton.textContent = getString("agent-rename-session");
  renameButton.addEventListener("click", () => {
    if (runtime.sending) {
      return;
    }
    promptRenameConversation(doc, conversation, () => {
      handlers.flushConversationStore();
    });
    void handlers.refreshAllSections();
  });

  const favoriteButton = doc.createElement("button");
  favoriteButton.className = "za-agent-secondary-button";
  favoriteButton.type = "button";
  favoriteButton.disabled = runtime.sending;
  favoriteButton.textContent = conversation.favorite
    ? `★ ${getString("agent-favorite-session")}`
    : `☆ ${getString("agent-favorite-session")}`;
  favoriteButton.addEventListener("click", () => {
    if (runtime.sending) {
      return;
    }
    conversation.favorite = !conversation.favorite;
    touchConversation(conversation);
    handlers.flushConversationStore();
    void handlers.refreshAllSections();
  });

  actions.append(
    newButton,
    clearButton,
    deleteButton,
    exportButton,
    renameButton,
    favoriteButton,
  );
  row.append(label, select, actions);
  return row;
}
