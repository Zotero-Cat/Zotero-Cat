import type { FluentMessageId } from "../../../typings/i10n";
import type { RuntimeMessage, ToolEventStatus } from "./conversationStore";

export type ToolKind =
  | "read-pdf"
  | "list-annotations"
  | "web-search"
  | "propose-annotation"
  | "modify-annotation"
  | "delete-annotation"
  | "applying-proposals"
  | "generic";

export function normalizeToolKind(actionType: string): ToolKind {
  const type = actionType.toLowerCase().replace(/_/g, "-");
  if (type === "web-search") return "web-search";
  if (type === "read-pdf") return "read-pdf";
  if (type === "list-annotations") return "list-annotations";
  if (type === "propose-annotation") return "propose-annotation";
  if (type === "modify-annotation") return "modify-annotation";
  if (type === "delete-annotation") return "delete-annotation";
  if (type === "applying-proposals") return "applying-proposals";
  return "generic";
}

export function createRunningToolEventMessage(
  toolType: string,
  now: number = Date.now(),
): RuntimeMessage {
  return {
    role: "assistant",
    content: "",
    createdAt: now,
    kind: "tool-event",
    toolEvent: {
      toolType: normalizeToolKind(toolType),
      status: "running",
      startedAt: now,
    },
  };
}

export function markToolEventMessage(
  message: RuntimeMessage | null,
  status: Exclude<ToolEventStatus, "running">,
  options: { now?: number; errorMessage?: string } = {},
): boolean {
  if (!message || message.kind !== "tool-event" || !message.toolEvent) {
    return false;
  }
  message.toolEvent.status = status;
  message.toolEvent.finishedAt = options.now ?? Date.now();
  if (status === "failed") {
    message.toolEvent.errorMessage = options.errorMessage || "";
  } else {
    delete message.toolEvent.errorMessage;
  }
  return true;
}

export function getToolEventLabelID(
  toolKind: ToolKind,
  status: ToolEventStatus,
): FluentMessageId {
  if (status === "running") {
    return getToolEventRunningLabelID(toolKind);
  }
  if (status === "done") {
    return getToolEventDoneLabelID(toolKind);
  }
  return getToolEventFailedLabelID(toolKind);
}

function getToolEventRunningLabelID(toolKind: ToolKind): FluentMessageId {
  if (toolKind === "web-search") {
    return "agent-tool-running-web-search";
  }
  if (toolKind === "read-pdf" || toolKind === "list-annotations") {
    return "agent-tool-running-pdf";
  }
  if (isAnnotationWriteTool(toolKind)) {
    return "agent-tool-running-proposals";
  }
  if (toolKind === "applying-proposals") {
    return "agent-tool-running-applying";
  }
  return "agent-tool-running-generic";
}

function getToolEventDoneLabelID(toolKind: ToolKind): FluentMessageId {
  if (toolKind === "web-search") {
    return "agent-tool-event-done-web-search";
  }
  if (toolKind === "read-pdf" || toolKind === "list-annotations") {
    return "agent-tool-event-done-pdf";
  }
  if (isAnnotationWriteTool(toolKind)) {
    return "agent-tool-event-done-proposals";
  }
  if (toolKind === "applying-proposals") {
    return "agent-tool-event-done-applying";
  }
  return "agent-tool-event-done-generic";
}

function getToolEventFailedLabelID(toolKind: ToolKind): FluentMessageId {
  if (toolKind === "web-search") {
    return "agent-tool-event-failed-web-search";
  }
  if (toolKind === "read-pdf" || toolKind === "list-annotations") {
    return "agent-tool-event-failed-pdf";
  }
  if (isAnnotationWriteTool(toolKind)) {
    return "agent-tool-event-failed-proposals";
  }
  if (toolKind === "applying-proposals") {
    return "agent-tool-event-failed-applying";
  }
  return "agent-tool-event-failed-generic";
}

function isAnnotationWriteTool(toolKind: ToolKind): boolean {
  return (
    toolKind === "propose-annotation" ||
    toolKind === "modify-annotation" ||
    toolKind === "delete-annotation"
  );
}
