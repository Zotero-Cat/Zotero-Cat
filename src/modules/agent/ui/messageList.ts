import { getString } from "../../../utils/locale";
import { pointsToMessage } from "../conversationRuntime";
import type { RuntimeMessage } from "../conversationStore";
import { renderMessageMarkdown } from "../markdown";
import type { AgentRuntime } from "../runtime/state";
import {
  getBatchForConversation,
  type AnnotationBatch,
} from "../../tools/annotationProposals";
import { renderProposalBatch } from "../proposalView";
import { renderActivityStatus } from "./activityStatus";
import { isNearBottom } from "./layout";
import { createCopyButton, createMessageMeta } from "./messageMeta";

export interface MessageListHandlers {
  onAcceptProposal: (id: string) => void;
  onRejectProposal: (id: string) => void;
  onAcceptAllProposals: () => void;
  onAlwaysAllowProposals: (batch: AnnotationBatch) => void;
  onRejectAllProposals: () => void;
  onDismissProposals: () => void;
}

export function renderMessageList(
  doc: Document,
  runtime: AgentRuntime,
  conversationKey: string,
  conversationMessages: RuntimeMessage[],
  handlers: MessageListHandlers,
): HTMLDivElement {
  const messages = doc.createElement("div");
  messages.className = "za-agent-messages";
  let renderedMessages = 0;
  for (const [index, message] of conversationMessages.entries()) {
    if (message.kind === "tool-event" || message.role === "tool") {
      continue;
    }
    if (message.role === "assistant" && !message.content.trim()) {
      continue;
    }
    const bubble = doc.createElement("div");
    bubble.className = `za-agent-message za-agent-${message.role}`;
    const isStreamingCurrent = pointsToMessage(
      runtime.streamingAssistant,
      conversationKey,
      index,
    );
    if (isStreamingCurrent) {
      bubble.classList.add("za-agent-streaming");
    }
    const content = doc.createElement("div");
    content.className = "za-agent-message-content";
    renderMessageMarkdown(content, message.content);
    bubble.append(
      content,
      createMessageMeta(doc, message),
      createCopyButton(doc, message.content),
    );
    messages.appendChild(bubble);
    renderedMessages += 1;
  }
  messages.addEventListener("scroll", () => {
    if (runtime.sending) {
      return;
    }
    runtime.shouldAutoScroll = isNearBottom(messages);
  });

  const pendingBatch = getBatchForConversation(conversationKey);
  if (pendingBatch && pendingBatch.proposals.length) {
    messages.appendChild(
      renderProposalBatch(doc, pendingBatch, {
        onAccept: handlers.onAcceptProposal,
        onReject: handlers.onRejectProposal,
        onAcceptAll: handlers.onAcceptAllProposals,
        onAlwaysAllow() {
          handlers.onAlwaysAllowProposals(pendingBatch);
        },
        onRejectAll: handlers.onRejectAllProposals,
        onDismiss: handlers.onDismissProposals,
      }),
    );
    renderedMessages += 1;
  }

  const activityStatus = renderActivityStatus(doc, runtime, conversationKey);
  if (activityStatus) {
    messages.appendChild(activityStatus);
    renderedMessages += 1;
  }

  if (!renderedMessages) {
    const empty = doc.createElement("div");
    empty.className = "za-agent-empty";
    empty.textContent = getString("agent-empty-state");
    messages.appendChild(empty);
  }

  return messages;
}
