import { getString } from "../../../utils/locale";
import type { AgentMessage, AssistantToolCall } from "../types";
import type { RuntimeMessage } from "../conversationStore";
import type { AgentRuntime } from "./state";
import { buildBatchFollowUpMessages } from "./annotationFollowUp";
import {
  startWorkingState as startWorkingStateInRuntime,
  clearWorkingState as clearWorkingStateInRuntime,
} from "./requestState";
import {
  appendToolEventMessage as appendToolEventMessageInRuntime,
  failActiveToolEvent as failActiveToolEventInRuntime,
  markToolEventDone as markToolEventDoneInRuntime,
  markToolEventFailed as markToolEventFailedInRuntime,
  type ToolEventDeps,
} from "./toolEvents";
import { takeToolActionContent as takeToolActionContentInRuntime } from "./toolActionContent";
import {
  parseAssistantToolActions,
  executeToolAction,
  inferAssistantReadOnlyToolAction,
  looksLikeAssistantToolIntent,
  stripAssistantToolActionMarkup,
  buildToolActionFromNativeCall,
  type ToolAction,
} from "../toolAction";
import {
  isAnnotationWriteAction,
  isPdfToolsEnabledPref,
  resolveWriteAction,
} from "../../tools/annotationTools";
import {
  acceptAllPending,
  clearBatch,
  createBatch,
  getBatchForConversation,
  hasPendingBatch,
  setProposalStatus,
  summarizeBatch,
  type AnnotationBatch,
} from "../../tools/annotationProposals";
import {
  buildFailedAnnotationRepairPrompt,
  gatherFailedAnnotationPageText,
  shouldRepairFailedAnnotationBatch,
} from "../../tools/annotationRepair";
import {
  buildAnnotationFollowUpPrompt,
  buildMissingToolActionRepairPrompt,
  buildToolActionFollowUpPrompt,
} from "../toolFollowUpPrompts";
import {
  applyProposal,
  resolveAttachmentFor,
} from "../../tools/annotationApply";
import type { WebSearchRunStatus } from "../webSearchContext";
import { formatError } from "../ui/labels";
import type { ReasoningEffortValue } from "../modelMetadata";

interface NativeToolExecution {
  action: ToolAction;
  toolCall: AssistantToolCall;
  result: string;
  failed: boolean;
}

export const MAX_TOOL_CHAIN_DEPTH = 24;

export interface ToolChainDeps {
  runtime: AgentRuntime;
  toolEventDeps: ToolEventDeps;
  getConversationMessage(
    conversationKey: string,
    messageIndex: number,
  ): RuntimeMessage | null;
  touchConversationByKey(conversationKey: string): void;
  refreshAllSections(): Promise<void>;
  sendMessage(
    messages: AgentMessage[],
    conversationKey: string,
    assistantMessageIndex: number,
    requestToken: number,
    reasoningEffort: ReasoningEffortValue,
  ): Promise<void>;
  streamAssistantReply(
    conversationKey: string,
    assistantMessageIndex: number,
    content: string,
  ): Promise<void>;
  saveConversationStore(): void;
  appendToolResultMessage(
    conversationKey: string,
    options: { toolCallId: string; toolName: string; content: string },
  ): number;
  appendAssistantContinuation(conversationKey: string): number;
  recordDiagnostic(
    level: "warning" | "error",
    message: string,
    detail?: string,
  ): void;
  applyWebSearchStatus(status: WebSearchRunStatus): void;
  stopWaitingAnimation(): void;
  finishActiveRequest(conversationKey: string, requestToken: number): void;
  shouldAutoApplyAnnotationBatch(batch: AnnotationBatch): boolean;
  rememberAnnotationOperationApprovals(batch: AnnotationBatch): void;
  getFirstProposalError(batch: AnnotationBatch): string;
}

// Short aliases for runtime tool event calls.
function appendEvent(deps: ToolChainDeps, ck: string, tt: string): number {
  return appendToolEventMessageInRuntime(
    deps.runtime,
    ck,
    tt,
    deps.toolEventDeps,
  );
}
function markDone(deps: ToolChainDeps, ck: string, idx: number): void {
  markToolEventDoneInRuntime(deps.runtime, ck, idx, deps.toolEventDeps);
}
function markFailed(
  deps: ToolChainDeps,
  ck: string,
  idx: number,
  msg: string,
): void {
  markToolEventFailedInRuntime(deps.runtime, ck, idx, msg, deps.toolEventDeps);
}
function failActive(deps: ToolChainDeps, ck: string, msg: string): void {
  failActiveToolEventInRuntime(deps.runtime, ck, msg, deps.toolEventDeps);
}

function stripToolActionJSON(content: string): string {
  return stripAssistantToolActionMarkup(content);
}

export async function continueAfterAssistantToolAction(
  deps: ToolChainDeps,
  requestMessages: AgentMessage[],
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
  item: Zotero.Item | null,
  depth: number = 0,
  repairedMissingToolAction: boolean = false,
  repairedFailedWriteAction: boolean = false,
) {
  if (depth >= MAX_TOOL_CHAIN_DEPTH) {
    deps.runtime.detectedToolActionByKey.delete(conversationKey);
    const exhaustedMessage = getString("agent-tool-chain-exhausted", {
      args: { max: String(MAX_TOOL_CHAIN_DEPTH) },
    });
    const assistantMessage = deps.getConversationMessage(
      conversationKey,
      assistantMessageIndex,
    );
    if (assistantMessage) {
      const prior = assistantMessage.content?.trim();
      assistantMessage.content = prior
        ? `${prior}\n\n${exhaustedMessage}`
        : exhaustedMessage;
      deps.touchConversationByKey(conversationKey);
      deps.saveConversationStore();
    }
    deps.recordDiagnostic(
      "warning",
      exhaustedMessage,
      "Tool chain depth " +
        depth +
        " reached (max " +
        MAX_TOOL_CHAIN_DEPTH +
        ").",
    );
    deps.stopWaitingAnimation();
    deps.runtime.streamingAssistant = null;
    await deps.refreshAllSections();
    return;
  }
  const assistantMessage = deps.getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  if (!assistantMessage) {
    return;
  }
  if (assistantMessage.toolCalls?.length) {
    await continueAfterNativeToolCalls(
      deps,
      requestMessages,
      conversationKey,
      assistantMessageIndex,
      requestToken,
      reasoningEffort,
      item,
      depth,
    );
    return;
  }
  const queuedToolContent = takeToolActionContentInRuntime(
    deps.runtime,
    conversationKey,
    assistantMessageIndex,
  );
  const actionContent = queuedToolContent || assistantMessage.content;
  const parsedActions = parseAssistantToolActions(actionContent);
  const inferredAction = parsedActions.length
    ? null
    : inferAssistantReadOnlyToolAction(actionContent);
  const actions = inferredAction ? [inferredAction] : parsedActions;
  if (!actions.length) {
    deps.runtime.detectedToolActionByKey.delete(conversationKey);
    if (
      !repairedMissingToolAction &&
      depth < MAX_TOOL_CHAIN_DEPTH - 1 &&
      looksLikeAssistantToolIntent(actionContent)
    ) {
      await requestMissingToolActionRepair(
        deps,
        requestMessages,
        conversationKey,
        assistantMessageIndex,
        requestToken,
        reasoningEffort,
        item,
        depth,
      );
      return;
    }
    await deps.refreshAllSections();
    return;
  }
  const readActions = actions.filter((action) => action.readOnly);
  const writeActions = actions.filter((action) => !action.readOnly);
  if (readActions.length || writeActions.length) {
    assistantMessage.content = stripToolActionJSON(actionContent);
    if (
      assistantMessage.responseWaitMs === undefined &&
      deps.runtime.waitingStartedAt !== null
    ) {
      assistantMessage.responseWaitMs = Math.max(
        0,
        Date.now() - deps.runtime.waitingStartedAt,
      );
    }
    deps.touchConversationByKey(conversationKey);
    deps.saveConversationStore();
    await deps.refreshAllSections();
  }

  let readResults = "";
  if (readActions.length) {
    const resultPieces: string[] = [];
    for (const action of readActions) {
      const eventIndex = appendEvent(deps, conversationKey, action.type);
      deps.runtime.detectedToolActionByKey.delete(conversationKey);
      await deps.refreshAllSections();
      let externalContext = "";
      try {
        externalContext = await executeToolAction(action, {
          requestToken,
          item,
          onStatus: (status) =>
            deps.applyWebSearchStatus(status as WebSearchRunStatus),
        });
      } catch (error) {
        externalContext = "ERROR: " + formatError(error);
      }
      if (requestToken !== deps.runtime.requestToken) {
        return;
      }
      const failed = externalContext.startsWith("ERROR:");
      if (failed) {
        markFailed(
          deps,
          conversationKey,
          eventIndex,
          externalContext.replace(/^ERROR:\s*/, ""),
        );
        deps.recordDiagnostic(
          "error",
          getString("agent-tool-failed", { args: { tool: action.type } }),
          externalContext,
        );
      } else {
        markDone(deps, conversationKey, eventIndex);
      }
      deps.saveConversationStore();
      await deps.refreshAllSections();
      resultPieces.push(
        `[tool:${action.type}]\n${externalContext || "(no output)"}`,
      );
    }
    readResults = resultPieces.join("\n\n");
  }
  if (requestToken !== deps.runtime.requestToken) {
    return;
  }
  if (deps.runtime.cancelRequested) {
    await handleToolChainAbort(deps, conversationKey, assistantMessageIndex);
    return;
  }

  if (writeActions.length && (!item || !isPdfToolsEnabledPref())) {
    const eventIndex = appendEvent(deps, conversationKey, "propose-annotation");
    deps.runtime.detectedToolActionByKey.delete(conversationKey);
    markFailed(
      deps,
      conversationKey,
      eventIndex,
      getString("agent-tool-write-unavailable"),
    );
    deps.saveConversationStore();
    await deps.refreshAllSections();
  } else if (writeActions.length && item && isPdfToolsEnabledPref()) {
    const eventIndex = appendEvent(deps, conversationKey, "propose-annotation");
    deps.runtime.detectedToolActionByKey.delete(conversationKey);
    await deps.refreshAllSections();
    const locale = (Zotero.locale || "en").startsWith("zh") ? "zh" : "en";
    const proposals = [] as Awaited<ReturnType<typeof resolveWriteAction>>;
    for (const action of writeActions) {
      if (!isAnnotationWriteAction(action)) {
        continue;
      }
      const resolved = await resolveWriteAction(action, { item, locale });
      proposals.push(...resolved);
    }
    if (proposals.length) {
      const batch = createBatch(
        conversationKey,
        assistantMessageIndex,
        proposals,
      );
      const summary = summarizeBatch(batch);
      if (summary.pending === 0 && summary.failed > 0) {
        markFailed(
          deps,
          conversationKey,
          eventIndex,
          deps.getFirstProposalError(batch) ||
            "No actionable proposals produced.",
        );
      } else {
        markDone(deps, conversationKey, eventIndex);
      }
      if (summary.pending > 0) {
        deps.runtime.pendingToolFollowUp.set(conversationKey, {
          requestMessages,
          assistantContent: actionContent,
          assistantMessageIndex,
          reasoningEffort,
          item,
          readResults,
        });
      } else {
        deps.runtime.pendingToolFollowUp.delete(conversationKey);
      }
      deps.saveConversationStore();
      if (
        shouldRepairFailedAnnotationBatch(batch, {
          alreadyRepaired: repairedFailedWriteAction,
          depth,
          maxDepth: MAX_TOOL_CHAIN_DEPTH,
        })
      ) {
        clearBatch(conversationKey);
        await requestFailedAnnotationRepair(
          deps,
          requestMessages,
          conversationKey,
          assistantMessageIndex,
          requestToken,
          reasoningEffort,
          item,
          depth,
          batch,
          readResults,
          actionContent,
        );
        return;
      }
      if (deps.shouldAutoApplyAnnotationBatch(batch)) {
        await applyBatchAndContinue(deps, batch.conversationKey, true);
      } else {
        await deps.refreshAllSections();
      }
      return;
    }
    markFailed(deps, conversationKey, eventIndex, "No proposals produced.");
    deps.saveConversationStore();
    await deps.refreshAllSections();
  }

  if (!readResults) {
    await deps.refreshAllSections();
    return;
  }
  const continuationIndex = deps.appendAssistantContinuation(conversationKey);
  await deps.refreshAllSections();
  const primaryReadType = readActions[0]?.type || "tool";
  const followUpMessages = [
    ...requestMessages,
    { role: "assistant", content: actionContent } as AgentMessage,
    {
      role: "user",
      content: buildToolActionFollowUpPrompt(
        primaryReadType,
        readResults,
        primaryReadType !== "web-search" && isPdfToolsEnabledPref(),
      ),
    } as AgentMessage,
  ];
  await deps.sendMessage(
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
  );
  if (
    requestToken !== deps.runtime.requestToken ||
    deps.runtime.cancelRequested
  ) {
    return;
  }
  await continueAfterAssistantToolAction(
    deps,
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
    item,
    depth + 1,
    repairedMissingToolAction,
    repairedFailedWriteAction,
  );
}

export async function continueAfterNativeToolCalls(
  deps: ToolChainDeps,
  requestMessages: AgentMessage[],
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
  item: Zotero.Item | null,
  depth: number,
) {
  const assistantMessage = deps.getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  const toolCalls = assistantMessage?.toolCalls || [];
  if (!assistantMessage || !toolCalls.length) {
    return;
  }
  if (
    assistantMessage.responseWaitMs === undefined &&
    deps.runtime.waitingStartedAt !== null
  ) {
    assistantMessage.responseWaitMs = Math.max(
      0,
      Date.now() - deps.runtime.waitingStartedAt,
    );
  }
  const reads: NativeToolExecution[] = [];
  const writes: { action: ToolAction; toolCall: AssistantToolCall }[] = [];
  const unrecognized: AssistantToolCall[] = [];
  for (const toolCall of toolCalls) {
    const action = buildToolActionFromNativeCall(
      toolCall.name,
      toolCall.arguments,
    );
    if (!action) {
      unrecognized.push(toolCall);
      continue;
    }
    if (action.readOnly) {
      reads.push({ action, toolCall, result: "", failed: false });
    } else {
      writes.push({ action, toolCall });
    }
  }
  if (!reads.length && !writes.length) {
    deps.runtime.detectedToolActionByKey.delete(conversationKey);
    deps.saveConversationStore();
    await deps.refreshAllSections();
    return;
  }
  deps.runtime.detectedToolActionByKey.delete(conversationKey);
  await deps.refreshAllSections();

  for (const entry of reads) {
    const eventIndex = appendEvent(deps, conversationKey, entry.action.type);
    await deps.refreshAllSections();
    let externalContext = "";
    try {
      externalContext = await executeToolAction(entry.action, {
        requestToken,
        item,
        onStatus: (status) =>
          deps.applyWebSearchStatus(status as WebSearchRunStatus),
      });
    } catch (error) {
      externalContext = "ERROR: " + formatError(error);
    }
    if (requestToken !== deps.runtime.requestToken) {
      return;
    }
    entry.failed = externalContext.startsWith("ERROR:");
    entry.result = externalContext;
    if (entry.failed) {
      markFailed(
        deps,
        conversationKey,
        eventIndex,
        externalContext.replace(/^ERROR:\s*/, ""),
      );
      deps.recordDiagnostic(
        "error",
        getString("agent-tool-failed", { args: { tool: entry.action.type } }),
        externalContext,
      );
    } else {
      markDone(deps, conversationKey, eventIndex);
    }
    deps.appendToolResultMessage(conversationKey, {
      toolCallId: entry.toolCall.id,
      toolName: entry.toolCall.name,
      content: entry.result || "(no output)",
    });
    deps.saveConversationStore();
    await deps.refreshAllSections();
  }
  if (requestToken !== deps.runtime.requestToken) {
    return;
  }
  if (deps.runtime.cancelRequested) {
    await handleToolChainAbort(deps, conversationKey, assistantMessageIndex);
    return;
  }

  let proposalsCreatedBatch = false;
  let writeFailedMessage = "";
  let writeEventIndex = -1;
  if (writes.length && (!item || !isPdfToolsEnabledPref())) {
    writeEventIndex = appendEvent(deps, conversationKey, "propose-annotation");
    markFailed(
      deps,
      conversationKey,
      writeEventIndex,
      getString("agent-tool-write-unavailable"),
    );
    writeFailedMessage = getString("agent-tool-write-unavailable");
    deps.saveConversationStore();
    await deps.refreshAllSections();
  } else if (writes.length && item && isPdfToolsEnabledPref()) {
    writeEventIndex = appendEvent(deps, conversationKey, "propose-annotation");
    await deps.refreshAllSections();
    const locale = (Zotero.locale || "en").startsWith("zh") ? "zh" : "en";
    const proposals = [] as Awaited<ReturnType<typeof resolveWriteAction>>;
    for (const { action } of writes) {
      if (!isAnnotationWriteAction(action)) {
        continue;
      }
      const resolved = await resolveWriteAction(action, { item, locale });
      proposals.push(...resolved);
    }
    if (proposals.length) {
      const batch = createBatch(
        conversationKey,
        assistantMessageIndex,
        proposals,
      );
      const summary = summarizeBatch(batch);
      if (summary.pending === 0 && summary.failed > 0) {
        const errMsg =
          deps.getFirstProposalError(batch) ||
          "No actionable proposals produced.";
        markFailed(deps, conversationKey, writeEventIndex, errMsg);
        writeFailedMessage = errMsg;
      } else {
        markDone(deps, conversationKey, writeEventIndex);
      }
      proposalsCreatedBatch = true;
      if (summary.pending > 0) {
        deps.runtime.pendingToolFollowUp.set(conversationKey, {
          requestMessages,
          assistantContent: "",
          assistantMessageIndex,
          reasoningEffort,
          item,
          readResults: "",
          nativeToolCalls: toolCalls,
          nativeWriteCalls: writes.map((entry) => entry.toolCall),
          nativeReadResults: reads.map((entry) => ({
            toolCall: entry.toolCall,
            result: entry.result,
          })),
        });
      } else {
        deps.runtime.pendingToolFollowUp.delete(conversationKey);
      }
      deps.saveConversationStore();
      if (deps.shouldAutoApplyAnnotationBatch(batch)) {
        await applyBatchAndContinue(deps, batch.conversationKey, true);
      } else {
        await deps.refreshAllSections();
      }
      return;
    }
    markFailed(
      deps,
      conversationKey,
      writeEventIndex,
      "No proposals produced.",
    );
    writeFailedMessage = "No proposals produced.";
    deps.saveConversationStore();
    await deps.refreshAllSections();
  }
  if (proposalsCreatedBatch) {
    return;
  }

  const followUpMessages: AgentMessage[] = [
    ...requestMessages,
    assistantMessage,
  ];
  for (const entry of reads) {
    followUpMessages.push({
      role: "tool",
      content: entry.result || "(no output)",
      toolCallId: entry.toolCall.id,
      toolName: entry.toolCall.name,
    });
  }
  const writeFallbackContent =
    writeFailedMessage ||
    "ERROR: Write tool result unavailable (batch not created).";
  for (const entry of writes) {
    followUpMessages.push({
      role: "tool",
      content: writeFallbackContent,
      toolCallId: entry.toolCall.id,
      toolName: entry.toolCall.name,
    });
    deps.appendToolResultMessage(conversationKey, {
      toolCallId: entry.toolCall.id,
      toolName: entry.toolCall.name,
      content: writeFallbackContent,
    });
  }
  for (const stray of unrecognized) {
    const strayContent = "ERROR: Unrecognized tool " + stray.name + ".";
    followUpMessages.push({
      role: "tool",
      content: strayContent,
      toolCallId: stray.id,
      toolName: stray.name,
    });
    deps.appendToolResultMessage(conversationKey, {
      toolCallId: stray.id,
      toolName: stray.name,
      content: strayContent,
    });
  }
  const continuationIndex = deps.appendAssistantContinuation(conversationKey);
  await deps.refreshAllSections();
  await deps.sendMessage(
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
  );
  if (
    requestToken !== deps.runtime.requestToken ||
    deps.runtime.cancelRequested
  ) {
    return;
  }
  await continueAfterAssistantToolAction(
    deps,
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
    item,
    depth + 1,
  );
}

export async function applyBatchAndContinue(
  deps: ToolChainDeps,
  conversationKey: string,
  autoAcceptAll: boolean,
) {
  const batch = getBatchForConversation(conversationKey);
  if (!batch) {
    return;
  }
  if (autoAcceptAll) {
    acceptAllPending(conversationKey);
  }
  const pending = deps.runtime.pendingToolFollowUp.get(conversationKey);
  const wasSending = deps.runtime.sending;
  deps.runtime.sending = true;
  startWorkingStateInRuntime(deps.runtime, conversationKey);
  const eventIndex = appendEvent(deps, conversationKey, "applying-proposals");
  if (!autoAcceptAll) {
    await deps.refreshAllSections();
  }
  const attachmentCache = new Map<number, Zotero.Item | null>();
  let applyFailures = 0;
  let lastApplyError = "";
  for (const proposal of batch.proposals) {
    if (proposal.status !== "accepted") {
      continue;
    }
    const attachment = resolveAttachmentFor(proposal, attachmentCache);
    if (!attachment) {
      setProposalStatus(
        conversationKey,
        proposal.id,
        "failed",
        "Attachment not found.",
      );
      applyFailures += 1;
      lastApplyError = "Attachment not found.";
      continue;
    }
    let result: Awaited<ReturnType<typeof applyProposal>>;
    try {
      result = await applyProposal(attachment, proposal);
    } catch (error) {
      result = { success: false, error: formatError(error) || "Apply failed." };
    }
    if (!result.success) {
      setProposalStatus(
        conversationKey,
        proposal.id,
        "failed",
        result.error || "Apply failed.",
      );
      applyFailures += 1;
      lastApplyError = result.error || "Apply failed.";
    }
  }
  if (
    applyFailures > 0 &&
    batch.proposals.filter((p) => p.status === "accepted").length === 0
  ) {
    markFailed(deps, conversationKey, eventIndex, lastApplyError);
  } else {
    markDone(deps, conversationKey, eventIndex);
  }
  deps.saveConversationStore();
  if (!autoAcceptAll) {
    await deps.refreshAllSections();
  }
  if (!pending) {
    clearBatch(conversationKey);
    if (!wasSending) {
      deps.runtime.sending = false;
      clearWorkingStateInRuntime(deps.runtime, conversationKey);
    }
    await deps.refreshAllSections();
    return;
  }
  const summary = summarizeBatch(batch);
  const followUpPrompt = buildAnnotationFollowUpPrompt(batch, summary);
  const followUpMessages = buildBatchFollowUpMessages(pending, followUpPrompt);
  for (const call of pending.nativeWriteCalls || []) {
    deps.appendToolResultMessage(conversationKey, {
      toolCallId: call.id,
      toolName: call.name,
      content: followUpPrompt,
    });
  }
  deps.runtime.pendingToolFollowUp.delete(conversationKey);
  clearBatch(conversationKey);
  await deps.refreshAllSections();
  deps.runtime.cancelRequested = false;
  deps.runtime.requestToken += 1;
  const requestToken = deps.runtime.requestToken;
  const continuationIndex = deps.appendAssistantContinuation(conversationKey);
  try {
    await deps.sendMessage(
      followUpMessages,
      conversationKey,
      continuationIndex,
      requestToken,
      pending.reasoningEffort,
    );
    if (
      requestToken !== deps.runtime.requestToken ||
      deps.runtime.cancelRequested
    ) {
      return;
    }
    await continueAfterAssistantToolAction(
      deps,
      followUpMessages,
      conversationKey,
      continuationIndex,
      requestToken,
      pending.reasoningEffort,
      pending.item,
    );
  } finally {
    deps.finishActiveRequest(conversationKey, requestToken);
  }
}

export async function requestMissingToolActionRepair(
  deps: ToolChainDeps,
  requestMessages: AgentMessage[],
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
  item: Zotero.Item | null,
  depth: number,
): Promise<void> {
  const assistantMessage = deps.getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  if (!assistantMessage) {
    return;
  }
  const continuationIndex = deps.appendAssistantContinuation(conversationKey);
  await deps.refreshAllSections();
  const followUpMessages = [
    ...requestMessages,
    { role: "assistant", content: assistantMessage.content } as AgentMessage,
    {
      role: "user",
      content: buildMissingToolActionRepairPrompt(),
    } as AgentMessage,
  ];
  await deps.sendMessage(
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
  );
  if (
    requestToken !== deps.runtime.requestToken ||
    deps.runtime.cancelRequested
  ) {
    return;
  }
  await continueAfterAssistantToolAction(
    deps,
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
    item,
    depth + 1,
    true,
    false,
  );
}

export async function requestFailedAnnotationRepair(
  deps: ToolChainDeps,
  requestMessages: AgentMessage[],
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
  item: Zotero.Item | null,
  depth: number,
  batch: AnnotationBatch,
  readResults: string,
  assistantContent: string,
): Promise<void> {
  const continuationIndex = deps.appendAssistantContinuation(conversationKey);
  await deps.refreshAllSections();
  const locale = (Zotero.locale || "en").startsWith("zh") ? "zh" : "en";
  let effectiveReadResults = readResults;
  if (!effectiveReadResults.trim()) {
    try {
      effectiveReadResults = await gatherFailedAnnotationPageText(batch);
    } catch {
      /* best effort */
    }
  }
  const followUpMessages = [
    ...requestMessages,
    { role: "assistant", content: assistantContent } as AgentMessage,
    {
      role: "user",
      content: buildFailedAnnotationRepairPrompt(
        batch,
        effectiveReadResults,
        locale,
      ),
    } as AgentMessage,
  ];
  await deps.sendMessage(
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
  );
  if (
    requestToken !== deps.runtime.requestToken ||
    deps.runtime.cancelRequested
  ) {
    return;
  }
  await continueAfterAssistantToolAction(
    deps,
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
    item,
    depth + 1,
    false,
    true,
  );
}

export async function maybeApplyResolvedBatch(
  deps: ToolChainDeps,
  conversationKey: string,
): Promise<void> {
  if (hasPendingBatch(conversationKey)) {
    await deps.refreshAllSections();
    return;
  }
  await applyBatchAndContinue(deps, conversationKey, false);
}

async function handleToolChainAbort(
  deps: ToolChainDeps,
  conversationKey: string,
  assistantMessageIndex: number,
): Promise<void> {
  deps.stopWaitingAnimation();
  const assistantMessage = deps.getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  if (!assistantMessage) {
    return;
  }
  deps.runtime.streamingAssistant = null;
  deps.runtime.detectedToolActionByKey.delete(conversationKey);
  failActive(deps, conversationKey, "Request aborted");
  assistantMessage.content = getString("agent-cancelled");
  deps.touchConversationByKey(conversationKey);
  deps.saveConversationStore();
  await deps.refreshAllSections();
}
