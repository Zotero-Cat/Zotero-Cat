import { getString } from "../../../utils/locale";
import { truncateInline } from "../../../utils/text";
import { getConversationMessage as getConversationMessageInRuntime } from "../conversationRuntime";
import type { RuntimeMessage } from "../conversationStore";
import { getToolEventLabelID, normalizeToolKind } from "../toolEventState";
import type { AgentRuntime } from "../runtime/state";

export interface ActivityStatusInfo {
  label: string;
  kind: "running" | "done" | "failed";
}

export function renderActivityStatus(
  doc: Document,
  runtime: AgentRuntime,
  conversationKey: string,
): HTMLElement | null {
  if (!runtime.sending || runtime.workingConversationKey !== conversationKey) {
    return null;
  }
  const statusInfo = getActivityStatusInfo(runtime, conversationKey);
  if (!statusInfo) {
    return null;
  }

  const status = doc.createElement("div");
  status.className = "za-agent-activity-status";
  status.dataset.kind = "running";
  if (statusInfo.kind === "failed") {
    status.dataset.tone = "error";
  }

  const indicator = doc.createElement("span");
  indicator.className = "za-agent-activity-indicator";
  indicator.style.animationDelay = `-${Date.now() % 850}ms`;

  const label = doc.createElement("span");
  label.className = "za-agent-activity-label";
  label.textContent = statusInfo.label;

  status.append(indicator, label);
  return status;
}

function getActivityStatusInfo(
  runtime: AgentRuntime,
  conversationKey: string,
): ActivityStatusInfo | null {
  const activeEvent = getToolEventByIndex(
    runtime,
    conversationKey,
    runtime.activeToolEventByKey.get(conversationKey),
  );
  if (activeEvent) {
    return formatToolEventStatus(activeEvent);
  }
  const latestEvent = getToolEventByIndex(
    runtime,
    conversationKey,
    runtime.latestToolEventByKey.get(conversationKey),
  );
  if (latestEvent) {
    if (
      normalizeToolKind(latestEvent.toolType) === "web-search" &&
      runtime.webSearchStatusMessage
    ) {
      return formatWebSearchStatus(runtime);
    }
    return formatToolEventStatus(latestEvent);
  }
  if (runtime.webSearchStatusMessage) {
    return formatWebSearchStatus(runtime);
  }
  if (runtime.detectedToolActionByKey.has(conversationKey)) {
    return {
      label: getString("agent-tool-detected-label"),
      kind: "running",
    };
  }
  return {
    label: getString("agent-working-label"),
    kind: "running",
  };
}

function formatWebSearchStatus(runtime: AgentRuntime): ActivityStatusInfo {
  return {
    label: runtime.webSearchStatusMessage,
    kind:
      runtime.webSearchStatusKind === "error"
        ? "failed"
        : runtime.webSearchStatusKind === "success"
          ? "done"
          : "running",
  };
}

function getToolEventByIndex(
  runtime: AgentRuntime,
  conversationKey: string,
  messageIndex: number | undefined,
) {
  if (typeof messageIndex !== "number") {
    return null;
  }
  const message = getConversationMessageInRuntime(
    runtime,
    conversationKey,
    messageIndex,
  );
  return message?.kind === "tool-event" ? message.toolEvent || null : null;
}

function formatToolEventStatus(
  event: NonNullable<RuntimeMessage["toolEvent"]>,
): ActivityStatusInfo {
  const toolKind = normalizeToolKind(event.toolType);
  if (event.status === "running") {
    return {
      label: getString(getToolEventLabelID(toolKind, "running")),
      kind: "running",
    };
  }
  if (event.status === "done") {
    return {
      label: getString(getToolEventLabelID(toolKind, "done")),
      kind: "done",
    };
  }
  const base = getString(getToolEventLabelID(toolKind, "failed"));
  const detail = event.errorMessage
    ? `: ${truncateInline(event.errorMessage, 120)}`
    : "";
  return {
    label: `${base}${detail}`,
    kind: "failed",
  };
}
