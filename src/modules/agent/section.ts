import { getLocaleID, getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import {
  AgentContextOptions,
  buildRequestMessagesWithContext,
  getDefaultContextOptions,
} from "./context";
import type { AgentMessage, AssistantToolCall } from "./types";
import {
  ChatResult,
  createProviderFromPrefs,
  isApiKeyRequiredForProvider,
} from "./provider";
import {
  buildEndpointKey,
  isNativeToolsUnsupported,
} from "./functionCalling/quirks";
import { runAssistantTurn } from "./functionCalling/runner";
import { shouldRetryChatError, isAbortError } from "./chatRetry";
import { touchConversation } from "./conversationStore";
import {
  clearConversationMessages as clearConversationMessagesInRuntime,
  createNewConversationForScope,
  deleteConversation as deleteConversationInRuntime,
  getActiveConversationForScope as getActiveConversationForScopeInRuntime,
  getConversationForKey as getConversationForKeyInRuntime,
  getConversationMessage as getConversationMessageInRuntime,
  getConversationsForScope as getConversationsForScopeInRuntime,
  selectConversation as selectConversationInRuntime,
  toProviderMessages,
  touchConversationByKey as touchConversationByKeyInRuntime,
} from "./conversationRuntime";
import {
  AgentRuntime,
  createAgentRuntime,
  PendingToolFollowUp,
} from "./runtime/state";
import { recordDiagnostic as recordDiagnosticInRuntime } from "./runtime/diagnostics";
import {
  queueToolActionContent as queueToolActionContentInRuntime,
  takeToolActionContent as takeToolActionContentInRuntime,
} from "./runtime/toolActionContent";
import {
  clearWorkingState as clearWorkingStateInRuntime,
  requestCancel as requestCancelInRuntime,
  startWaitingAnimation as startWaitingAnimationInRuntime,
  startWorkingState as startWorkingStateInRuntime,
  stopWaitingAnimation as stopWaitingAnimationInRuntime,
} from "./runtime/requestState";
import {
  ensureConversationStoreLoaded as ensureConversationStoreLoadedInRuntime,
  flushConversationStore as flushConversationStoreInRuntime,
  scheduleConversationStoreSave as scheduleConversationStoreSaveInRuntime,
  type ConversationStoreServiceDeps,
} from "./runtime/conversationStoreService";
import {
  appendToolEventMessage as appendToolEventMessageInRuntime,
  failActiveToolEvent as failActiveToolEventInRuntime,
  markToolEventDone as markToolEventDoneInRuntime,
  markToolEventFailed as markToolEventFailedInRuntime,
  type ToolEventDeps,
} from "./runtime/toolEvents";
import { resolveConversationScopeKey } from "./itemScope";
import {
  ReasoningEffortValue,
  buildModelContextMap,
  buildModelEndpointCandidates,
  buildModelReasoningMap,
  buildModelSourceKey,
  canRetryModelEndpoint,
  getDefaultModelForProvider,
  normalizeBaseURL,
  normalizeProviderID,
  normalizeReasoningEffort,
  normalizeString,
  parseModelInfos,
  resolveEffectiveReasoningEffort,
  resolveModelOptions,
  summarizeModelMetadataAvailability,
} from "./modelMetadata";
import { getProviderApiKey } from "./secureApiKey";
import { openAgentPreferences } from "../prefsPane";
import {
  buildToolActionFromNativeCall,
  parseAssistantToolActions,
  executeToolAction,
  getOpenAIToolSpecs,
  hasExecutableAssistantToolAction,
  inferAssistantReadOnlyToolAction,
  looksLikeAssistantToolIntent,
  splitAssistantToolActionMessage,
  stripAssistantToolActionMarkup,
  type ToolAction,
} from "./toolAction";
import {
  isAnnotationWriteAction,
  isPdfToolsAutoApplyPref,
  isPdfToolsEnabledPref,
  resolveWriteAction,
} from "../tools/annotationTools";
import {
  acceptAllPending,
  clearBatch,
  createBatch,
  getBatchForConversation,
  getProposalApprovalKey,
  hasPendingBatch,
  rejectAllPending,
  setProposalStatus,
  summarizeBatch,
  type AnnotationBatch,
  type AnnotationProposal,
} from "../tools/annotationProposals";
import {
  buildFailedAnnotationRepairPrompt,
  gatherFailedAnnotationPageText,
  shouldRepairFailedAnnotationBatch,
} from "../tools/annotationRepair";
import {
  createAnnotation,
  deleteAnnotation,
  updateAnnotation,
  type SaveAnnotationResult,
} from "../tools/pdfAnnotations";
import {
  buildExternalWebSearchContext,
  isWebSearchEnabledPref,
  type WebSearchRunStatus,
} from "./webSearchContext";
import {
  applyRootDimensions,
  captureScrollState,
  ensureBodyResizeObserver,
  isNearBottom,
  restoreScrollPosition,
  scrollToBottom,
} from "./ui/layout";
import {
  formatError,
  formatModelFetchError,
  getModelParseMessages,
  getModelsFetchedMessage,
  getReasoningStatusLabel,
  normalizeAuthKey,
} from "./ui/labels";
import { createSessionControls } from "./ui/sessionControls";
import {
  isProviderConfigured,
  renderConversationStoreLoading,
  renderProviderGate,
} from "./ui/sectionGates";
import { renderMessageList } from "./ui/messageList";
import { createAgentControlPanel } from "./ui/controlPanel";
import { createAgentComposer } from "./ui/composer";

let registeredSectionID: string | false = false;
const TYPEWRITER_STEP_CHARS = 3;
const TYPEWRITER_DELAY_MS = 18;
const MODEL_FETCH_TIMEOUT_MS = 25_000;
const CHAT_MAX_ATTEMPTS = 2;
const CHAT_RETRY_DELAY_MS = 700;

const runtime: AgentRuntime = createAgentRuntime();

export function registerAgentSection() {
  if (registeredSectionID) {
    return registeredSectionID;
  }
  registeredSectionID = Zotero.ItemPaneManager.registerSection({
    paneID: "zotero-cat",
    pluginID: addon.data.config.addonID,
    header: {
      l10nID: getLocaleID("item-section-agent-head-text"),
      icon: `chrome://${addon.data.config.addonRef}/content/icons/icon-16.png`,
    },
    sidenav: {
      l10nID: getLocaleID("item-section-agent-sidenav-tooltip"),
      icon: `chrome://${addon.data.config.addonRef}/content/icons/icon-20.png`,
    },
    onInit: ({ paneID, refresh }) => {
      runtime.refreshers.set(paneID, refresh);
    },
    onDestroy: ({ paneID }) => {
      runtime.refreshers.delete(paneID);
    },
    onItemChange: ({ setEnabled }) => {
      setEnabled(true);
      return true;
    },
    onRender: ({ body, item }) => {
      renderSectionBody(body, item);
    },
  });
  return registeredSectionID;
}

export function unregisterAgentSection() {
  if (!registeredSectionID) {
    return;
  }
  Zotero.ItemPaneManager.unregisterSection(registeredSectionID);
  registeredSectionID = false;
  runtime.refreshers.clear();
}

function renderSectionBody(body: HTMLDivElement, item: Zotero.Item) {
  const doc = body.ownerDocument;
  if (!doc) {
    return;
  }
  if (!isProviderConfigured()) {
    renderProviderGate(body, doc, {
      openPreferences: openAgentPreferences,
      onOpenPreferencesError: (error) => {
        recordDiagnostic("error", formatError(error));
      },
    });
    return;
  }
  if (!runtime.conversationStoreLoaded) {
    ensureConversationStoreLoaded();
    renderConversationStoreLoading(body, doc);
    return;
  }
  const conversationScopeKey = resolveConversationScopeKey(item);
  const conversation = getActiveConversationForScope(conversationScopeKey);
  const conversationKey = conversation.key;
  const conversationMessages = conversation.messages;
  const previousMessages =
    body.querySelector<HTMLDivElement>(".za-agent-messages");
  const previousScrollState = previousMessages
    ? captureScrollState(previousMessages)
    : null;
  if (previousMessages) {
    runtime.shouldAutoScroll =
      runtime.sending || isNearBottom(previousMessages);
  }

  const root = doc.createElement("div");
  root.className = "za-agent-root";
  applyRootDimensions(root, body);
  ensureBodyResizeObserver(body);

  const messages = renderMessageList(
    doc,
    runtime,
    conversationKey,
    conversationMessages,
    {
      onAcceptProposal(id) {
        setProposalStatus(conversationKey, id, "accepted");
        void maybeApplyResolvedBatch(conversationKey);
      },
      onRejectProposal(id) {
        setProposalStatus(conversationKey, id, "rejected");
        void maybeApplyResolvedBatch(conversationKey);
      },
      onAcceptAllProposals() {
        acceptAllPending(conversationKey);
        void applyBatchAndContinue(conversationKey, false);
      },
      onAlwaysAllowProposals(batch) {
        rememberAnnotationOperationApprovals(batch);
        acceptAllPending(conversationKey);
        void applyBatchAndContinue(conversationKey, false);
      },
      onRejectAllProposals() {
        rejectAllPending(conversationKey);
        void maybeApplyResolvedBatch(conversationKey);
      },
      onDismissProposals() {
        runtime.pendingToolFollowUp.delete(conversationKey);
        clearBatch(conversationKey);
        void refreshAllSections();
      },
    },
  );

  const providerID = normalizeProviderID(getPref("provider"));
  const baseURL = normalizeString(getPref("openaiBaseUrl"), "");
  const currentModel = normalizeString(
    getPref("openaiModel"),
    getDefaultModelForProvider(providerID),
  );
  const currentReasoningEffort = normalizeReasoningEffort(
    getPref("openaiReasoningEffort"),
  );
  const reasoningOptions = resolveReasoningOptions(
    providerID,
    baseURL,
    currentModel,
  );
  const effectiveReasoningEffort = syncReasoningEffortPref(
    reasoningOptions,
    currentReasoningEffort,
  );
  const modelOptions = resolveModelOptions(
    providerID,
    baseURL,
    currentModel,
    runtime.modelOptionsBySource,
  );

  const controls = createAgentControlPanel(
    doc,
    {
      currentModel,
      effectiveReasoningEffort,
      modelFetchBusy: runtime.modelFetchBusy,
      modelFetchStatusKind: runtime.modelFetchStatusKind,
      modelFetchStatusMessage: runtime.modelFetchStatusMessage,
      modelOptions,
      pdfToolsAutoApply: isPdfToolsAutoApplyPref(),
      pdfToolsEnabled: isPdfToolsEnabledPref(),
      reasoningOptions,
      reasoningStatusText: getReasoningStatusText(
        providerID,
        baseURL,
        currentModel,
      ),
      sending: runtime.sending,
      templateID: runtime.templateID,
      webSearchEnabled: isWebSearchEnabled(),
    },
    {
      onModelChange(model) {
        const nextModel = normalizeString(model, currentModel);
        setPref("openaiModel", nextModel);
        syncReasoningEffortPref(
          resolveReasoningOptions(providerID, baseURL, nextModel),
          normalizeReasoningEffort(getPref("openaiReasoningEffort")),
        );
        void refreshAllSections();
      },
      onFetchModels() {
        if (runtime.sending || runtime.modelFetchBusy) {
          return;
        }
        runtime.modelFetchBusy = true;
        runtime.modelFetchStatusMessage = "";
        runtime.modelFetchStatusKind = "";
        void refreshAllSections();
        void fetchModelsFromCurrentProvider(providerID, baseURL)
          .then((modelInfos) => {
            const models = modelInfos.map((modelInfo) => modelInfo.id);
            runtime.modelOptionsBySource.set(
              buildModelSourceKey(providerID, baseURL),
              models,
            );
            runtime.modelContextBySource.set(
              buildModelSourceKey(providerID, baseURL),
              buildModelContextMap(modelInfos),
            );
            runtime.modelReasoningBySource.set(
              buildModelSourceKey(providerID, baseURL),
              buildModelReasoningMap(modelInfos),
            );
            const nextModel = models.includes(currentModel)
              ? currentModel
              : models[0] || currentModel;
            setPref("openaiModel", nextModel);
            syncReasoningEffortPref(
              resolveReasoningOptions(providerID, baseURL, nextModel),
              normalizeReasoningEffort(getPref("openaiReasoningEffort")),
            );
            runtime.modelFetchStatusKind = "success";
            runtime.modelFetchStatusMessage = getModelsFetchedMessage(
              summarizeModelMetadataAvailability(modelInfos),
            );
          })
          .catch((error) => {
            const message = formatModelFetchError(error);
            runtime.modelFetchStatusKind = "error";
            runtime.modelFetchStatusMessage = message;
            recordDiagnostic("error", message);
          })
          .finally(() => {
            runtime.modelFetchBusy = false;
            void refreshAllSections();
          });
      },
      onReasoningChange(value) {
        setPref("openaiReasoningEffort", normalizeReasoningEffort(value));
        void refreshAllSections();
      },
      onTemplateChange(templateID) {
        runtime.templateID = templateID;
        void refreshAllSections();
      },
      onWebSearchChange(nextValue) {
        setPref("webSearchEnabled", nextValue);
        runtime.webSearchStatusMessage = "";
        runtime.webSearchStatusKind = "";
        void refreshAllSections();
      },
      onPdfToolsChange(nextValue) {
        setPref("pdfToolsEnabled", nextValue);
        void refreshAllSections();
      },
      onPdfToolsAutoApplyChange(nextValue) {
        setPref("pdfToolsAutoApply", nextValue);
        void refreshAllSections();
      },
    },
  );
  const composerLocked = hasPendingBatch(conversationKey);

  const composer = createAgentComposer(
    doc,
    {
      locked: composerLocked,
      sending: runtime.sending,
    },
    {
      onStop: requestCancel,
      onSubmit(prompt) {
        runtime.sending = true;
        startWorkingState(conversationKey);
        runtime.cancelRequested = false;
        runtime.cancelActiveRequest = null;
        runtime.requestToken += 1;
        runtime.webSearchStatusMessage = "";
        runtime.webSearchStatusKind = "";
        runtime.latestToolEventByKey.delete(conversationKey);
        const requestToken = runtime.requestToken;
        conversation.messages.push({
          role: "user",
          content: prompt,
          createdAt: Date.now(),
        });
        touchConversation(conversation);
        const requestMessages = toProviderMessages(conversation.messages);
        const templateID = runtime.templateID;
        const contextOptions = getAutomaticContextOptions();
        const modelContextWindow = resolveModelContextWindow(
          providerID,
          baseURL,
          currentModel,
        );
        const requestReasoningEffort = syncReasoningEffortPref(
          resolveReasoningOptions(providerID, baseURL, currentModel),
          normalizeReasoningEffort(getPref("openaiReasoningEffort")),
        );
        const assistantMessageIndex =
          conversation.messages.push({
            role: "assistant",
            content: "",
            createdAt: Date.now(),
          }) - 1;
        touchConversation(conversation);
        saveConversationStore();
        runtime.shouldAutoScroll = true;
        runtime.streamingAssistant = null;
        startWaitingAnimation(conversationKey, assistantMessageIndex);
        void refreshAllSections();
        void sendPreparedMessage(
          {
            requestMessages,
            item,
            contextOptions,
            templateID,
            customContext: "",
            modelContextWindow,
            prompt,
          },
          conversationKey,
          assistantMessageIndex,
          requestToken,
          requestReasoningEffort,
        )
          .catch(async (error) => {
            if (requestToken !== runtime.requestToken) {
              return;
            }
            await handleChatFailure(
              error,
              conversationKey,
              assistantMessageIndex,
            );
          })
          .finally(() => {
            finishActiveRequest(conversationKey, requestToken);
          });
      },
    },
  );
  const rootChildren: HTMLElement[] = [
    createSessionControls(doc, runtime, conversationScopeKey, conversation, {
      getConversationsForScope,
      startNewConversation,
      clearConversationMessages,
      selectConversation,
      deleteConversation,
      flushConversationStore,
      refreshAllSections,
    }),
    messages,
    controls,
  ];
  rootChildren.push(composer);
  root.append(...rootChildren);
  body.replaceChildren(root);
  if (runtime.shouldAutoScroll || runtime.sending) {
    scrollToBottom(messages);
    return;
  }
  if (previousScrollState) {
    restoreScrollPosition(messages, previousScrollState);
  }
}

interface PreparedMessageOptions {
  requestMessages: AgentMessage[];
  item: Zotero.Item;
  contextOptions: AgentContextOptions;
  templateID: string;
  customContext: string;
  modelContextWindow: number | null;
  prompt: string;
}

async function sendPreparedMessage(
  options: PreparedMessageOptions,
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
) {
  const externalContext = await resolveWebSearchContext(
    options.prompt,
    options.item,
    requestToken,
  );
  if (requestToken !== runtime.requestToken) {
    return;
  }
  if (runtime.cancelRequested) {
    await handleChatFailure(
      new Error("Request aborted"),
      conversationKey,
      assistantMessageIndex,
    );
    return;
  }
  const requestMessages = buildRequestMessagesWithContext(
    options.requestMessages,
    {
      item: options.item,
      contextOptions: options.contextOptions,
      templateID: options.templateID,
      customContext: options.customContext,
      externalContext,
      modelContextWindow: options.modelContextWindow,
      includePdfToolsRules: isPdfToolsEnabledPref(),
      useNativeToolCalls: shouldUseNativeToolCalls(),
    },
  );
  await sendMessage(
    requestMessages,
    conversationKey,
    assistantMessageIndex,
    requestToken,
    reasoningEffort,
  );
  if (requestToken !== runtime.requestToken || runtime.cancelRequested) {
    return;
  }
  await continueAfterAssistantToolAction(
    requestMessages,
    conversationKey,
    assistantMessageIndex,
    requestToken,
    reasoningEffort,
    options.item,
  );
}

async function sendMessage(
  requestMessages: AgentMessage[],
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
) {
  let attempt = 1;
  while (attempt <= CHAT_MAX_ATTEMPTS) {
    let receivedStreamDelta = false;
    try {
      await runChatAttempt(
        requestMessages,
        conversationKey,
        assistantMessageIndex,
        requestToken,
        reasoningEffort,
        (value) => {
          receivedStreamDelta = value;
        },
      );
      return;
    } catch (error) {
      if (requestToken !== runtime.requestToken) {
        return;
      }
      if (
        shouldRetryChatError(
          error,
          attempt,
          CHAT_MAX_ATTEMPTS,
          receivedStreamDelta,
          runtime.cancelRequested,
        )
      ) {
        recordDiagnostic(
          "warning",
          getString("agent-diagnostics-retrying", {
            args: {
              attempt: String(attempt + 1),
              max: String(CHAT_MAX_ATTEMPTS),
            },
          }),
          formatError(error),
        );
        attempt += 1;
        await refreshAllSections();
        await Zotero.Promise.delay(CHAT_RETRY_DELAY_MS);
        if (requestToken !== runtime.requestToken || runtime.cancelRequested) {
          return;
        }
        continue;
      }
      await handleChatFailure(error, conversationKey, assistantMessageIndex);
      return;
    }
  }
}

const MAX_TOOL_CHAIN_DEPTH = 24;

const toolEventDeps: ToolEventDeps = {
  getConversationMessage,
  touchConversationByKey,
  clearWebSearchStatus,
};

function appendToolEventMessage(
  conversationKey: string,
  toolType: string,
): number {
  return appendToolEventMessageInRuntime(
    runtime,
    conversationKey,
    toolType,
    toolEventDeps,
  );
}

function markToolEventDone(conversationKey: string, messageIndex: number) {
  markToolEventDoneInRuntime(
    runtime,
    conversationKey,
    messageIndex,
    toolEventDeps,
  );
}

function markToolEventFailed(
  conversationKey: string,
  messageIndex: number,
  errorMessage: string,
) {
  markToolEventFailedInRuntime(
    runtime,
    conversationKey,
    messageIndex,
    errorMessage,
    toolEventDeps,
  );
}

function failActiveToolEvent(conversationKey: string, errorMessage: string) {
  failActiveToolEventInRuntime(
    runtime,
    conversationKey,
    errorMessage,
    toolEventDeps,
  );
}

function queueToolActionContent(
  conversationKey: string,
  messageIndex: number,
  content: string,
) {
  queueToolActionContentInRuntime(
    runtime,
    conversationKey,
    messageIndex,
    content,
  );
}

function takeToolActionContent(
  conversationKey: string,
  messageIndex: number,
): string {
  return takeToolActionContentInRuntime(runtime, conversationKey, messageIndex);
}

function appendToolResultMessage(
  conversationKey: string,
  options: { toolCallId: string; toolName: string; content: string },
): number {
  const conversation = getConversationForKey(conversationKey);
  if (!conversation) {
    return -1;
  }
  const index =
    conversation.messages.push({
      role: "tool",
      content: options.content,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      createdAt: Date.now(),
    }) - 1;
  touchConversationByKey(conversationKey);
  return index;
}

function appendAssistantContinuation(conversationKey: string): number {
  const conversation = getConversationForKey(conversationKey);
  if (!conversation) {
    return -1;
  }
  const index =
    conversation.messages.push({
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    }) - 1;
  touchConversationByKey(conversationKey);
  runtime.streamingAssistant = null;
  if (runtime.sending) {
    startWorkingState(conversationKey);
  }
  startWaitingAnimation(conversationKey, index);
  return index;
}

async function continueAfterAssistantToolAction(
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
    runtime.detectedToolActionByKey.delete(conversationKey);
    const exhaustedMessage = getString("agent-tool-chain-exhausted", {
      args: { max: String(MAX_TOOL_CHAIN_DEPTH) },
    });
    const assistantMessage = getConversationMessage(
      conversationKey,
      assistantMessageIndex,
    );
    if (assistantMessage) {
      const prior = assistantMessage.content?.trim();
      assistantMessage.content = prior
        ? `${prior}\n\n${exhaustedMessage}`
        : exhaustedMessage;
      touchConversationByKey(conversationKey);
      saveConversationStore();
    }
    recordDiagnostic(
      "warning",
      exhaustedMessage,
      `Tool chain depth ${depth} reached (max ${MAX_TOOL_CHAIN_DEPTH}).`,
    );
    stopWaitingAnimation();
    runtime.streamingAssistant = null;
    await refreshAllSections();
    return;
  }
  const assistantMessage = getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  if (!assistantMessage) {
    return;
  }
  if (assistantMessage.toolCalls?.length) {
    await continueAfterNativeToolCalls(
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
  const queuedToolContent = takeToolActionContent(
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
    runtime.detectedToolActionByKey.delete(conversationKey);
    if (
      !repairedMissingToolAction &&
      depth < MAX_TOOL_CHAIN_DEPTH - 1 &&
      looksLikeAssistantToolIntent(actionContent)
    ) {
      await requestMissingToolActionRepair(
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
    // Final natural-language response — nothing more to do.
    await refreshAllSections();
    return;
  }
  const readActions = actions.filter((action) => action.readOnly);
  const writeActions = actions.filter((action) => !action.readOnly);

  // Finalize the current assistant bubble before any tool fires: strip the
  // action JSON so the user sees clean prose, and ensure responseWaitMs is
  // recorded so the meta line stops growing.
  if (readActions.length || writeActions.length) {
    assistantMessage.content = stripToolActionJSON(actionContent);
    if (
      assistantMessage.responseWaitMs === undefined &&
      runtime.waitingStartedAt !== null
    ) {
      assistantMessage.responseWaitMs = Math.max(
        0,
        Date.now() - runtime.waitingStartedAt,
      );
    }
    touchConversationByKey(conversationKey);
    saveConversationStore();
    await refreshAllSections();
  }

  let readResults = "";
  if (readActions.length) {
    const resultPieces: string[] = [];
    for (const action of readActions) {
      const eventIndex = appendToolEventMessage(conversationKey, action.type);
      runtime.detectedToolActionByKey.delete(conversationKey);
      await refreshAllSections();
      let externalContext = "";
      try {
        externalContext = await executeToolAction(action, {
          requestToken,
          item,
          onStatus: (status) =>
            applyWebSearchStatus(status as WebSearchRunStatus),
        });
      } catch (error) {
        externalContext = `ERROR: ${formatError(error)}`;
      }
      if (requestToken !== runtime.requestToken) {
        return;
      }
      const failed = externalContext.startsWith("ERROR:");
      if (failed) {
        markToolEventFailed(
          conversationKey,
          eventIndex,
          externalContext.replace(/^ERROR:\s*/, ""),
        );
        recordDiagnostic(
          "error",
          getString("agent-tool-failed", {
            args: { tool: action.type },
          }),
          externalContext,
        );
      } else {
        markToolEventDone(conversationKey, eventIndex);
      }
      saveConversationStore();
      await refreshAllSections();
      resultPieces.push(
        `[tool:${action.type}]\n${externalContext || "(no output)"}`,
      );
    }
    readResults = resultPieces.join("\n\n");
  }

  if (requestToken !== runtime.requestToken) {
    return;
  }
  if (runtime.cancelRequested) {
    await handleChatFailure(
      new Error("Request aborted"),
      conversationKey,
      assistantMessageIndex,
    );
    return;
  }

  if (writeActions.length && (!item || !isPdfToolsEnabledPref())) {
    const eventIndex = appendToolEventMessage(
      conversationKey,
      "propose-annotation",
    );
    runtime.detectedToolActionByKey.delete(conversationKey);
    markToolEventFailed(
      conversationKey,
      eventIndex,
      getString("agent-tool-write-unavailable"),
    );
    saveConversationStore();
    await refreshAllSections();
  } else if (writeActions.length && item && isPdfToolsEnabledPref()) {
    const eventIndex = appendToolEventMessage(
      conversationKey,
      "propose-annotation",
    );
    runtime.detectedToolActionByKey.delete(conversationKey);
    await refreshAllSections();
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
        markToolEventFailed(
          conversationKey,
          eventIndex,
          getFirstProposalError(batch) || "No actionable proposals produced.",
        );
      } else {
        markToolEventDone(conversationKey, eventIndex);
      }
      if (summary.pending > 0) {
        runtime.pendingToolFollowUp.set(conversationKey, {
          requestMessages,
          assistantContent: actionContent,
          assistantMessageIndex,
          reasoningEffort,
          item,
          readResults,
        });
      } else {
        runtime.pendingToolFollowUp.delete(conversationKey);
      }
      saveConversationStore();
      if (
        shouldRepairFailedAnnotationBatch(batch, {
          alreadyRepaired: repairedFailedWriteAction,
          depth,
          maxDepth: MAX_TOOL_CHAIN_DEPTH,
        })
      ) {
        clearBatch(conversationKey);
        await requestFailedAnnotationRepair(
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
      if (shouldAutoApplyAnnotationBatch(batch)) {
        await applyBatchAndContinue(batch.conversationKey, true);
      } else {
        await refreshAllSections();
      }
      return;
    }
    markToolEventFailed(conversationKey, eventIndex, "No proposals produced.");
    saveConversationStore();
    await refreshAllSections();
  }

  if (!readResults) {
    // Nothing left to do — either no tools fired successfully, or write tools
    // were rejected by the gate. The current assistant bubble already shows
    // the cleaned prose.
    await refreshAllSections();
    return;
  }

  // Read tools produced results; ask the model for the next round in a fresh
  // assistant bubble so its post-tool prose is a separate message.
  const continuationIndex = appendAssistantContinuation(conversationKey);
  await refreshAllSections();

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
  await sendMessage(
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
  );

  if (requestToken !== runtime.requestToken || runtime.cancelRequested) {
    return;
  }

  // Recurse to handle any new tool actions the model emits after receiving
  // the read result (e.g. propose_annotation after read_pdf).
  await continueAfterAssistantToolAction(
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

function stripToolActionJSON(content: string): string {
  return stripAssistantToolActionMarkup(content);
}

interface NativeToolExecution {
  action: ToolAction;
  toolCall: AssistantToolCall;
  result: string;
  failed: boolean;
}

async function continueAfterNativeToolCalls(
  requestMessages: AgentMessage[],
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
  item: Zotero.Item | null,
  depth: number,
) {
  const assistantMessage = getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  const toolCalls = assistantMessage?.toolCalls || [];
  if (!assistantMessage || !toolCalls.length) {
    return;
  }
  if (
    assistantMessage.responseWaitMs === undefined &&
    runtime.waitingStartedAt !== null
  ) {
    assistantMessage.responseWaitMs = Math.max(
      0,
      Date.now() - runtime.waitingStartedAt,
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
    runtime.detectedToolActionByKey.delete(conversationKey);
    saveConversationStore();
    await refreshAllSections();
    return;
  }
  runtime.detectedToolActionByKey.delete(conversationKey);
  await refreshAllSections();

  for (const entry of reads) {
    const eventIndex = appendToolEventMessage(
      conversationKey,
      entry.action.type,
    );
    await refreshAllSections();
    let externalContext = "";
    try {
      externalContext = await executeToolAction(entry.action, {
        requestToken,
        item,
        onStatus: (status) =>
          applyWebSearchStatus(status as WebSearchRunStatus),
      });
    } catch (error) {
      externalContext = `ERROR: ${formatError(error)}`;
    }
    if (requestToken !== runtime.requestToken) {
      return;
    }
    entry.failed = externalContext.startsWith("ERROR:");
    entry.result = externalContext;
    if (entry.failed) {
      markToolEventFailed(
        conversationKey,
        eventIndex,
        externalContext.replace(/^ERROR:\s*/, ""),
      );
      recordDiagnostic(
        "error",
        getString("agent-tool-failed", {
          args: { tool: entry.action.type },
        }),
        externalContext,
      );
    } else {
      markToolEventDone(conversationKey, eventIndex);
    }
    // Persist a role:"tool" message paired with the originating tool_call_id
    // so future turns see a well-formed [assistant{tool_calls}, tool, ...]
    // sequence. Without this, the next user turn replays the assistant
    // tool_calls without responses and providers (DeepSeek, etc.) 400 with
    // "insufficient tool messages following tool_calls message".
    appendToolResultMessage(conversationKey, {
      toolCallId: entry.toolCall.id,
      toolName: entry.toolCall.name,
      content: entry.result || "(no output)",
    });
    saveConversationStore();
    await refreshAllSections();
  }

  if (requestToken !== runtime.requestToken) {
    return;
  }
  if (runtime.cancelRequested) {
    await handleChatFailure(
      new Error("Request aborted"),
      conversationKey,
      assistantMessageIndex,
    );
    return;
  }

  let proposalsCreatedBatch = false;
  let writeFailedMessage = "";
  let writeEventIndex = -1;
  if (writes.length && (!item || !isPdfToolsEnabledPref())) {
    writeEventIndex = appendToolEventMessage(
      conversationKey,
      "propose-annotation",
    );
    markToolEventFailed(
      conversationKey,
      writeEventIndex,
      getString("agent-tool-write-unavailable"),
    );
    writeFailedMessage = getString("agent-tool-write-unavailable");
    saveConversationStore();
    await refreshAllSections();
  } else if (writes.length && item && isPdfToolsEnabledPref()) {
    writeEventIndex = appendToolEventMessage(
      conversationKey,
      "propose-annotation",
    );
    await refreshAllSections();
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
        markToolEventFailed(
          conversationKey,
          writeEventIndex,
          getFirstProposalError(batch) || "No actionable proposals produced.",
        );
        writeFailedMessage =
          getFirstProposalError(batch) || "No actionable proposals produced.";
      } else {
        markToolEventDone(conversationKey, writeEventIndex);
      }
      proposalsCreatedBatch = true;
      if (summary.pending > 0) {
        runtime.pendingToolFollowUp.set(conversationKey, {
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
        runtime.pendingToolFollowUp.delete(conversationKey);
      }
      saveConversationStore();
      if (shouldAutoApplyAnnotationBatch(batch)) {
        await applyBatchAndContinue(batch.conversationKey, true);
      } else {
        await refreshAllSections();
      }
      return;
    }
    markToolEventFailed(
      conversationKey,
      writeEventIndex,
      "No proposals produced.",
    );
    writeFailedMessage = "No proposals produced.";
    saveConversationStore();
    await refreshAllSections();
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
    // Mirror the tool result into conversation history (reads were already
    // persisted in the loop above). Keeps the [assistant{tool_calls}, tool…]
    // sequence intact for subsequent user turns.
    appendToolResultMessage(conversationKey, {
      toolCallId: entry.toolCall.id,
      toolName: entry.toolCall.name,
      content: writeFallbackContent,
    });
  }
  for (const stray of unrecognized) {
    const strayContent = `ERROR: Unrecognized tool ${stray.name}.`;
    followUpMessages.push({
      role: "tool",
      content: strayContent,
      toolCallId: stray.id,
      toolName: stray.name,
    });
    appendToolResultMessage(conversationKey, {
      toolCallId: stray.id,
      toolName: stray.name,
      content: strayContent,
    });
  }

  const continuationIndex = appendAssistantContinuation(conversationKey);
  await refreshAllSections();
  await sendMessage(
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
  );
  if (requestToken !== runtime.requestToken || runtime.cancelRequested) {
    return;
  }
  await continueAfterAssistantToolAction(
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
    item,
    depth + 1,
  );
}

function getToolCallMode(): "auto" | "native" | "text" {
  const raw = String(getPref("toolCallMode") || "")
    .trim()
    .toLowerCase();
  if (raw === "native" || raw === "text") {
    return raw;
  }
  return "auto";
}

function getActiveBaseURL(): string {
  return String(getPref("openaiBaseUrl") || "").trim();
}

function getActiveEndpointKey(): string {
  const provider = String(getPref("provider") || "");
  return buildEndpointKey(provider, getActiveBaseURL());
}

function shouldUseNativeToolCalls(): boolean {
  if (!isPdfToolsEnabledPref()) {
    return false;
  }
  const mode = getToolCallMode();
  if (mode === "text") {
    return false;
  }
  if (mode === "auto" && isNativeToolsUnsupported(getActiveEndpointKey())) {
    return false;
  }
  return true;
}

function buildNativeToolSpecs() {
  const allowed = new Set<string>();
  if (isPdfToolsEnabledPref()) {
    for (const name of [
      "read_pdf",
      "list_annotations",
      "propose_annotation",
      "modify_annotation",
      "delete_annotation",
    ]) {
      allowed.add(name);
    }
  }
  if (!allowed.size) {
    return [];
  }
  return getOpenAIToolSpecs().filter((spec) => allowed.has(spec.function.name));
}

function buildEmptyChatResult(content: string): ChatResult {
  return { content, toolCalls: [], finishReason: "stop" };
}

function shouldAutoApplyAnnotationBatch(batch: AnnotationBatch): boolean {
  const approvalKeys = getScopedPendingApprovalKeys(batch);
  if (!approvalKeys.length) {
    return false;
  }
  if (isPdfToolsAutoApplyPref()) {
    return true;
  }
  return approvalKeys.every((key) =>
    runtime.approvedAnnotationOperationKeys.has(key),
  );
}

function rememberAnnotationOperationApprovals(batch: AnnotationBatch): void {
  for (const key of getScopedPendingApprovalKeys(batch)) {
    runtime.approvedAnnotationOperationKeys.add(key);
  }
}

function getScopedPendingApprovalKeys(batch: AnnotationBatch): string[] {
  const keys = new Set<string>();
  for (const proposal of batch.proposals) {
    if (proposal.status !== "pending") {
      continue;
    }
    keys.add(
      `${batch.conversationKey}:${proposal.attachmentKey}:${getProposalApprovalKey(proposal)}`,
    );
  }
  return [...keys].sort();
}

function getFirstProposalError(batch: AnnotationBatch): string {
  return (
    batch.proposals.find((proposal) => proposal.errorMessage)?.errorMessage ||
    ""
  );
}

async function maybeApplyResolvedBatch(conversationKey: string): Promise<void> {
  if (hasPendingBatch(conversationKey)) {
    await refreshAllSections();
    return;
  }
  await applyBatchAndContinue(conversationKey, false);
}

function buildBatchFollowUpMessages(
  pending: PendingToolFollowUp,
  followUpPrompt: string,
): AgentMessage[] {
  if (!pending.nativeToolCalls?.length) {
    return [
      ...pending.requestMessages,
      { role: "assistant", content: pending.assistantContent } as AgentMessage,
      { role: "user", content: followUpPrompt } as AgentMessage,
    ];
  }
  const messages: AgentMessage[] = [
    ...pending.requestMessages,
    {
      role: "assistant",
      content: pending.assistantContent || "",
      toolCalls: pending.nativeToolCalls,
    },
  ];
  const readResultByCallId = new Map<string, string>();
  for (const entry of pending.nativeReadResults || []) {
    readResultByCallId.set(entry.toolCall.id, entry.result || "(no output)");
  }
  const writeCallIds = new Set<string>(
    (pending.nativeWriteCalls || []).map((call) => call.id),
  );
  for (const call of pending.nativeToolCalls) {
    if (writeCallIds.has(call.id)) {
      messages.push({
        role: "tool",
        content: followUpPrompt,
        toolCallId: call.id,
        toolName: call.name,
      });
      continue;
    }
    messages.push({
      role: "tool",
      content: readResultByCallId.get(call.id) || "(no output)",
      toolCallId: call.id,
      toolName: call.name,
    });
  }
  return messages;
}

async function applyBatchAndContinue(
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
  const pending = runtime.pendingToolFollowUp.get(conversationKey);
  // Tool-event message tracks the apply step itself; runtime.sending may be
  // false (manual apply triggered from batch UI) so kick the loop manually.
  const wasSending = runtime.sending;
  runtime.sending = true;
  startWorkingState(conversationKey);
  const eventIndex = appendToolEventMessage(
    conversationKey,
    "applying-proposals",
  );
  if (!autoAcceptAll) {
    await refreshAllSections();
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
    let result: SaveAnnotationResult;
    try {
      result = await applyProposal(attachment, proposal);
    } catch (error) {
      result = {
        success: false,
        error: formatError(error) || "Apply failed.",
      };
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
    markToolEventFailed(conversationKey, eventIndex, lastApplyError);
  } else {
    markToolEventDone(conversationKey, eventIndex);
  }
  saveConversationStore();
  if (!autoAcceptAll) {
    await refreshAllSections();
  }
  if (!pending) {
    clearBatch(conversationKey);
    if (!wasSending) {
      runtime.sending = false;
      clearWorkingState(conversationKey);
    }
    await refreshAllSections();
    return;
  }
  const summary = summarizeBatch(batch);
  const followUpPrompt = buildAnnotationFollowUpPrompt(batch, summary);
  const followUpMessages = buildBatchFollowUpMessages(pending, followUpPrompt);
  // Mirror the write tool results into conversation history. Reads (if any)
  // were already persisted by continueAfterNativeToolCalls before the batch
  // was created; here we only need to close out the write tool_call_ids the
  // user just accepted/rejected so the [assistant{tool_calls}, tool…]
  // sequence is intact on subsequent user turns.
  for (const call of pending.nativeWriteCalls || []) {
    appendToolResultMessage(conversationKey, {
      toolCallId: call.id,
      toolName: call.name,
      content: followUpPrompt,
    });
  }
  runtime.pendingToolFollowUp.delete(conversationKey);
  clearBatch(conversationKey);
  await refreshAllSections();
  runtime.cancelRequested = false;
  runtime.requestToken += 1;
  const requestToken = runtime.requestToken;
  const continuationIndex = appendAssistantContinuation(conversationKey);
  try {
    await sendMessage(
      followUpMessages,
      conversationKey,
      continuationIndex,
      requestToken,
      pending.reasoningEffort,
    );
    if (requestToken !== runtime.requestToken || runtime.cancelRequested) {
      return;
    }
    await continueAfterAssistantToolAction(
      followUpMessages,
      conversationKey,
      continuationIndex,
      requestToken,
      pending.reasoningEffort,
      pending.item,
    );
  } finally {
    finishActiveRequest(conversationKey, requestToken);
  }
}

async function requestMissingToolActionRepair(
  requestMessages: AgentMessage[],
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
  item: Zotero.Item | null,
  depth: number,
): Promise<void> {
  const assistantMessage = getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  if (!assistantMessage) {
    return;
  }
  const continuationIndex = appendAssistantContinuation(conversationKey);
  await refreshAllSections();
  const followUpMessages = [
    ...requestMessages,
    { role: "assistant", content: assistantMessage.content } as AgentMessage,
    {
      role: "user",
      content: buildMissingToolActionRepairPrompt(),
    } as AgentMessage,
  ];
  await sendMessage(
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
  );
  if (requestToken !== runtime.requestToken || runtime.cancelRequested) {
    return;
  }
  await continueAfterAssistantToolAction(
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

async function requestFailedAnnotationRepair(
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
  const continuationIndex = appendAssistantContinuation(conversationKey);
  await refreshAllSections();
  const locale = (Zotero.locale || "en").startsWith("zh") ? "zh" : "en";
  // When the model went straight to propose_annotation without calling
  // read_pdf, readResults is empty and the repair prompt would have nothing
  // for the model to re-quote against. Auto-fetch the target pages so the
  // retry can see the actual PDF text.
  let effectiveReadResults = readResults;
  if (!effectiveReadResults.trim()) {
    try {
      effectiveReadResults = await gatherFailedAnnotationPageText(batch);
    } catch {
      // best effort — fall back to the original empty readResults
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
  await sendMessage(
    followUpMessages,
    conversationKey,
    continuationIndex,
    requestToken,
    reasoningEffort,
  );
  if (requestToken !== runtime.requestToken || runtime.cancelRequested) {
    return;
  }
  await continueAfterAssistantToolAction(
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

function buildMissingToolActionRepairPrompt(): string {
  const isZh = (Zotero.locale || "en").startsWith("zh");
  if (isZh) {
    return [
      "你上一条回复表示要调用工具,但没有包含 Zotero-Cat 可执行的工具 action,所以插件无法继续。",
      "如果确实需要工具,请只输出一个 JSON 代码块,不要再解释计划。",
      '读取 PDF 全文: {"action":"read_pdf"}',
      '从第 4 页开始读取: {"action":"read_pdf","action_input":{"fromPage":4}}',
      '修正高亮: {"action":"propose_annotation","action_input":{"type":"highlight","pageLabel":"16","text":"该页内连续出现的 PDF 原文","comment":"批注内容","color":"#ffd400"}}',
      '联网搜索: {"action":"联网搜索","action_input":{"query":"检索词","maxResults":20}}',
      "高亮/下划线 text 必须是单页内连续出现的 PDF 原文；不要提交跨页 text，跨页内容请拆成每页一条。",
      "如果不需要工具,请直接给出最终回答。",
    ].join("\n");
  }
  return [
    "Your previous response said you would use a tool, but it did not include an executable Zotero-Cat tool action.",
    "If you need a tool, reply with only one JSON code block and no planning prose.",
    'Read the full PDF: {"action":"read_pdf"}',
    'Read from page 4 onward: {"action":"read_pdf","action_input":{"fromPage":4}}',
    'Repair a highlight: {"action":"propose_annotation","action_input":{"type":"highlight","pageLabel":"16","text":"continuous verbatim PDF text on that page","comment":"comment text","color":"#ffd400"}}',
    'Web search: {"action":"web_search","action_input":{"query":"search terms","maxResults":20}}',
    "Highlight/underline text must be a continuous verbatim PDF span from one page. Do not submit cross-page text; split cross-page highlights into one proposal per page.",
    "If no tool is needed, answer directly.",
  ].join("\n");
}

async function applyProposal(
  attachment: Zotero.Item,
  proposal: AnnotationProposal,
): Promise<SaveAnnotationResult> {
  if (proposal.op === "create") {
    return createAnnotation(attachment, proposal.resolved);
  }
  if (proposal.op === "update") {
    if (!proposal.annotationKey) {
      return { success: false, error: "Missing annotation key." };
    }
    return updateAnnotation(attachment, {
      ...proposal.resolved,
      key: proposal.annotationKey,
    });
  }
  if (proposal.op === "delete") {
    if (!proposal.annotationKey) {
      return { success: false, error: "Missing annotation key." };
    }
    return deleteAnnotation(attachment, proposal.annotationKey);
  }
  return { success: false, error: "Unknown proposal op." };
}

function resolveAttachmentFor(
  proposal: AnnotationProposal,
  cache: Map<number, Zotero.Item | null>,
): Zotero.Item | null {
  if (cache.has(proposal.attachmentID)) {
    return cache.get(proposal.attachmentID) || null;
  }
  const attachment =
    (Zotero.Items.get(proposal.attachmentID) as Zotero.Item | false) || null;
  cache.set(proposal.attachmentID, attachment);
  return attachment;
}

function buildAnnotationFollowUpPrompt(
  batch: AnnotationBatch,
  summary: ReturnType<typeof summarizeBatch>,
): string {
  const isZh = (Zotero.locale || "en").startsWith("zh");
  const bullets = batch.proposals
    .map((proposal) => {
      const op = proposal.op.toUpperCase();
      const status = proposal.status.toUpperCase();
      const page = proposal.resolved.pageLabel;
      const snippet = (proposal.sourceSnippet || "").slice(0, 80);
      const err = proposal.errorMessage
        ? ` [error: ${proposal.errorMessage}]`
        : "";
      return `- ${op} p.${page} [${status}] ${snippet}${err}`;
    })
    .join("\n");
  const hasFailed = summary.failed > 0;
  if (isZh) {
    const nextInstruction = hasFailed
      ? "部分标注失败。若要修复失败项,请先确保已读取目标页原文,然后只输出一个 JSON 代码块给出修正后的 propose_annotation；高亮/下划线 text 必须是单页内连续出现的 PDF 原文。不要提交跨页 text,跨页内容请拆成每页一条。若无法修复,请直接说明失败原因。"
      : "请基于此继续对话(例如确认、追加下一批,或说明不再需要写操作)。";
    return [
      "已处理你提议的标注批次,结果如下。",
      `汇总:accepted=${summary.accepted} rejected=${summary.rejected} failed=${summary.failed} pending=${summary.pending}`,
      bullets,
      nextInstruction,
    ].join("\n\n");
  }
  const nextInstruction = hasFailed
    ? "Some annotations failed. To repair them, first make sure you have read the target page text, then output only one JSON code block with corrected propose_annotation action(s). Highlight/underline text must be a continuous verbatim span from one PDF page. Do not submit cross-page text; split cross-page highlights into one proposal per page. If repair is not possible, state the failure reason directly."
    : "Continue the conversation based on the results (e.g. confirm, propose more, or state you no longer need write actions).";
  return [
    "The annotation batch you proposed has been processed.",
    `Summary: accepted=${summary.accepted} rejected=${summary.rejected} failed=${summary.failed} pending=${summary.pending}`,
    bullets,
    nextInstruction,
  ].join("\n\n");
}

async function runChatAttempt(
  requestMessages: AgentMessage[],
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
  setReceivedStreamDelta: (value: boolean) => void,
) {
  const provider = createProviderFromPrefs();
  const useNativeTools = shouldUseNativeToolCalls();
  const nativeToolSpecs = useNativeTools ? buildNativeToolSpecs() : [];
  let receivedStreamDelta = false;
  let detectedToolAction = false;
  let activeCancel: (() => void) | null = null;
  let acceptingStreamDelta = true;
  let resolveDetectedToolAction: ((content: ChatResult) => void) | null = null;
  const detectedToolActionPromise = new Promise<ChatResult>((resolve) => {
    resolveDetectedToolAction = resolve;
  });
  let refreshScheduled = false;
  const queueStreamRefresh = () => {
    if (refreshScheduled) {
      return;
    }
    refreshScheduled = true;
    void Promise.resolve().then(async () => {
      refreshScheduled = false;
      await refreshAllSections();
    });
  };
  const splitAssistantToolMessage = (content: string) => {
    const assistantMessage = getConversationMessage(
      conversationKey,
      assistantMessageIndex,
    );
    if (!assistantMessage) {
      return;
    }
    const split = splitAssistantToolActionMessage(content);
    if (split.toolActionContent) {
      queueToolActionContent(
        conversationKey,
        assistantMessageIndex,
        split.toolActionContent,
      );
    }
    assistantMessage.content = split.visibleContent;
    touchConversationByKey(conversationKey);
  };
  const requestToolActionHandling = (content: string) => {
    if (
      detectedToolAction ||
      !content.trim() ||
      !hasExecutableAssistantToolAction(content)
    ) {
      return;
    }
    detectedToolAction = true;
    acceptingStreamDelta = false;
    splitAssistantToolMessage(content);
    runtime.detectedToolActionByKey.add(conversationKey);
    runtime.shouldAutoScroll = true;
    queueStreamRefresh();
    resolveDetectedToolAction?.(buildEmptyChatResult(content));
    resolveDetectedToolAction = null;
    const cancel = activeCancel;
    if (!cancel) {
      return;
    }
    void Promise.resolve().then(() => {
      try {
        cancel();
      } catch {
        // Ignore cancellation races; the normal idle timeout still applies.
      }
    });
  };
  // Reset transient per-attempt state so the runner's internal retry (after a
  // recoverable quirk is observed) starts from a clean slate: no half-streamed
  // bubble, no stale tool_calls, no stale "first delta seen" flag.
  const resetAttemptStateForRetry = () => {
    receivedStreamDelta = false;
    detectedToolAction = false;
    acceptingStreamDelta = true;
    setReceivedStreamDelta(false);
    const assistantMessage = getConversationMessage(
      conversationKey,
      assistantMessageIndex,
    );
    if (assistantMessage) {
      assistantMessage.content = "";
      assistantMessage.toolCalls = undefined;
    }
  };
  let reply: ChatResult = buildEmptyChatResult("");
  try {
    const runnerPromise = runAssistantTurn({
      provider,
      messages: requestMessages,
      endpointKey: getActiveEndpointKey(),
      baseURL: getActiveBaseURL(),
      tools: nativeToolSpecs.length ? nativeToolSpecs : undefined,
      toolChoice: nativeToolSpecs.length ? "auto" : undefined,
      reasoningEffort,
      onCanceller(cancel) {
        if (!acceptingStreamDelta || requestToken !== runtime.requestToken) {
          return;
        }
        activeCancel = cancel;
        runtime.cancelActiveRequest = cancel;
        if (runtime.cancelRequested) {
          cancel();
        }
      },
      onStreamDelta(delta) {
        if (
          !acceptingStreamDelta ||
          requestToken !== runtime.requestToken ||
          !delta
        ) {
          return;
        }
        const assistantMessage = getConversationMessage(
          conversationKey,
          assistantMessageIndex,
        );
        if (!assistantMessage) {
          return;
        }
        if (!receivedStreamDelta) {
          receivedStreamDelta = true;
          setReceivedStreamDelta(true);
          stopWaitingAnimation();
          runtime.streamingAssistant = {
            conversationKey,
            messageIndex: assistantMessageIndex,
          };
          assistantMessage.content = "";
        }
        assistantMessage.content += delta;
        requestToolActionHandling(assistantMessage.content);
        touchConversationByKey(conversationKey);
        runtime.shouldAutoScroll = true;
        queueStreamRefresh();
      },
      onDiagnostic(event) {
        const stringID =
          event.kind === "native-tools-unsupported"
            ? "agent-diagnostics-tool-fallback"
            : "agent-diagnostics-reasoning-echo";
        recordDiagnostic("warning", getString(stringID), event.message);
        resetAttemptStateForRetry();
      },
    })
      .then(
        (turn): ChatResult => ({
          content: turn.content,
          toolCalls: turn.toolCalls,
          finishReason: turn.finishReason,
          reasoningContent: turn.reasoningContent,
        }),
      )
      .catch((error): ChatResult => {
        const assistantMessage = getConversationMessage(
          conversationKey,
          assistantMessageIndex,
        );
        if (
          detectedToolAction &&
          assistantMessage &&
          hasExecutableAssistantToolAction(assistantMessage.content)
        ) {
          return buildEmptyChatResult(assistantMessage.content);
        }
        runtime.detectedToolActionByKey.delete(conversationKey);
        throw error;
      });
    reply = await Promise.race([runnerPromise, detectedToolActionPromise]);
  } catch (error) {
    runtime.detectedToolActionByKey.delete(conversationKey);
    throw error;
  } finally {
    resolveDetectedToolAction = null;
    acceptingStreamDelta = false;
    if (runtime.cancelActiveRequest === activeCancel) {
      runtime.cancelActiveRequest = null;
    }
  }
  if (requestToken !== runtime.requestToken) {
    return;
  }
  if (reply.toolCalls.length) {
    stopWaitingAnimation();
    runtime.streamingAssistant = null;
    const assistantMessage = getConversationMessage(
      conversationKey,
      assistantMessageIndex,
    );
    if (assistantMessage) {
      assistantMessage.content = (
        reply.content ||
        assistantMessage.content ||
        ""
      ).trim();
      assistantMessage.toolCalls = reply.toolCalls;
      if (reply.reasoningContent) {
        assistantMessage.reasoningContent = reply.reasoningContent;
      }
      runtime.detectedToolActionByKey.add(conversationKey);
      touchConversationByKey(conversationKey);
      saveConversationStore();
      await refreshAllSections();
    }
    return;
  }
  if (receivedStreamDelta) {
    const assistantMessage = getConversationMessage(
      conversationKey,
      assistantMessageIndex,
    );
    if (assistantMessage) {
      if (!assistantMessage.content.trim() && reply.content.trim()) {
        if (hasExecutableAssistantToolAction(reply.content)) {
          splitAssistantToolMessage(reply.content);
        } else {
          assistantMessage.content = reply.content;
        }
        touchConversationByKey(conversationKey);
      }
      if (reply.reasoningContent) {
        assistantMessage.reasoningContent = reply.reasoningContent;
      }
    }
    runtime.streamingAssistant = null;
    saveConversationStore();
    await refreshAllSections();
    return;
  }
  if (hasExecutableAssistantToolAction(reply.content)) {
    const assistantMessage = getConversationMessage(
      conversationKey,
      assistantMessageIndex,
    );
    if (assistantMessage) {
      stopWaitingAnimation();
      runtime.streamingAssistant = null;
      runtime.detectedToolActionByKey.add(conversationKey);
      splitAssistantToolMessage(reply.content);
      if (reply.reasoningContent) {
        assistantMessage.reasoningContent = reply.reasoningContent;
      }
      touchConversationByKey(conversationKey);
      saveConversationStore();
      await refreshAllSections();
    }
    return;
  }
  stopWaitingAnimation();
  runtime.streamingAssistant = {
    conversationKey,
    messageIndex: assistantMessageIndex,
  };
  const assistantMessageForReasoning = getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  if (assistantMessageForReasoning && reply.reasoningContent) {
    assistantMessageForReasoning.reasoningContent = reply.reasoningContent;
  }
  await streamAssistantReply(
    conversationKey,
    assistantMessageIndex,
    reply.content,
  );
  saveConversationStore();
}

async function handleChatFailure(
  error: unknown,
  conversationKey: string,
  assistantMessageIndex: number,
) {
  stopWaitingAnimation();
  const assistantMessage = getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  if (!assistantMessage) {
    return;
  }
  runtime.streamingAssistant = null;
  runtime.detectedToolActionByKey.delete(conversationKey);
  if (runtime.cancelRequested || isAbortError(error)) {
    failActiveToolEvent(conversationKey, "Request aborted");
    assistantMessage.content = getString("agent-cancelled");
    touchConversationByKey(conversationKey);
    saveConversationStore();
    await refreshAllSections();
    return;
  }
  const errorText = formatError(error);
  failActiveToolEvent(conversationKey, errorText);
  assistantMessage.content = `[${getString("agent-error-prefix")}] ${errorText}`;
  recordDiagnostic("error", errorText);
  touchConversationByKey(conversationKey);
  saveConversationStore();
  await refreshAllSections();
}

async function resolveWebSearchContext(
  prompt: string,
  item: Zotero.Item | null,
  requestToken: number,
) {
  return buildExternalWebSearchContext({
    prompt,
    item,
    locale: Zotero.locale.startsWith("zh") ? "zh" : "en",
    isCancelled() {
      return requestToken !== runtime.requestToken || runtime.cancelRequested;
    },
    async onStatus(status) {
      applyWebSearchStatus(status);
      await refreshAllSections();
    },
  });
}

function isWebSearchEnabled() {
  return isWebSearchEnabledPref();
}

function getAutomaticContextOptions(): AgentContextOptions {
  if (isPdfToolsEnabledPref()) {
    return {
      includeMetadata: false,
      includeNotes: false,
      includeAnnotations: false,
      includeSelectedText: false,
    };
  }
  return getDefaultContextOptions();
}

function buildToolActionFollowUpPrompt(
  toolType: string,
  toolResult: string,
  allowToolChaining: boolean = false,
) {
  const isZh = Zotero.locale.startsWith("zh");
  if (toolType === "web-search") {
    if (isZh) {
      return [
        "你刚才请求了联网搜索。插件已经执行搜索，结果如下。",
        toolResult || "搜索没有返回可用结果。",
        "请基于这些结果回答用户原始问题。不要再次输出 action JSON；如果结果不足，请明确说明局限。",
      ].join("\n\n");
    }
    return [
      "You requested web search. The plugin has executed the search. Results follow.",
      toolResult || "The search returned no usable results.",
      "Answer the user's original question based on these results. Do not output action JSON again; state limitations if results are insufficient.",
    ].join("\n\n");
  }
  const toolFailed = toolResult.trim().startsWith("ERROR:");
  if (isZh) {
    const chainingLine = allowToolChaining
      ? "请基于这些结果回答用户原始问题。如果需要,可以继续输出工具 action JSON(例如 propose_annotation),每轮回复最多一个写批次。若要高亮/下划线, text 必须是工具结果中单页内连续出现的 PDF 原文；不要使用跨页 text,跨页内容请拆成每页一条。若目标页原文不在结果中,先调用 read_pdf 精确读取该页。"
      : "请基于这些结果回答用户原始问题。不要再次输出 action JSON。";
    const errorLine = toolFailed
      ? "\n\n注意:工具执行失败。请如实告知用户失败原因并建议检查(如 PDF 附件、插件设置等),不要根据摘要或元数据猜测 PDF 原文来新建标注——那样会导致 propose_annotation 找不到文本而全部失败。"
      : "";
    return [
      `你刚才请求了工具操作（${toolType}）。插件已经执行，结果如下。`,
      toolResult || "工具没有返回可用结果。",
      `${chainingLine}${errorLine}`,
    ].join("\n\n");
  }
  const chainingLine = allowToolChaining
    ? "Answer the user's original question based on these results. If needed, emit more tool action JSON (e.g. propose_annotation), at most one write batch per reply. For highlight/underline, text must be a continuous verbatim PDF span from one page in the tool result. Do not use cross-page text; split cross-page highlights into one proposal per page. If the target page text is not in the result, call read_pdf for that exact page first."
    : "Answer the user's original question based on these results. Do not output action JSON again.";
  const errorLine = toolFailed
    ? "\n\nNote: the tool failed. Tell the user plainly what went wrong and suggest checks (e.g. the PDF attachment, plugin settings). Do NOT invent highlight text from the abstract or metadata — propose_annotation will fail to locate it and all proposals will be marked failed."
    : "";
  return [
    `You requested a tool action (${toolType}). The plugin has executed it. Results follow.`,
    toolResult || "The tool returned no usable results.",
    `${chainingLine}${errorLine}`,
  ].join("\n\n");
}

function applyWebSearchStatus(status: WebSearchRunStatus) {
  switch (status.type) {
    case "searching":
      runtime.webSearchStatusMessage = getString("agent-web-search-searching");
      runtime.webSearchStatusKind = "";
      return;
    case "results":
      runtime.webSearchStatusMessage = getString("agent-web-search-results", {
        args: {
          count: String(status.count),
          provider: status.provider,
        },
      });
      runtime.webSearchStatusKind = "success";
      return;
    case "no-results":
      runtime.webSearchStatusMessage = getString("agent-web-search-no-results");
      runtime.webSearchStatusKind = "";
      return;
    case "failed":
      runtime.webSearchStatusMessage = getString("agent-web-search-failed");
      runtime.webSearchStatusKind = "error";
      recordDiagnostic(
        "warning",
        getString("agent-web-search-failed"),
        formatError(status.error),
      );
      return;
    default:
      return;
  }
}

function clearWebSearchStatus() {
  runtime.webSearchStatusMessage = "";
  runtime.webSearchStatusKind = "";
}

function resolveModelContextWindow(
  providerID: string,
  baseURL: string,
  model: string,
) {
  const contextByModel = runtime.modelContextBySource.get(
    buildModelSourceKey(providerID, baseURL),
  );
  return contextByModel?.get(model) || null;
}

function resolveReasoningOptions(
  providerID: string,
  baseURL: string,
  model: string,
) {
  const reasoningByModel = runtime.modelReasoningBySource.get(
    buildModelSourceKey(providerID, baseURL),
  );
  const providerOptions = reasoningByModel?.get(model);
  if (!providerOptions?.length) {
    return ["default"] as ReasoningEffortValue[];
  }
  const options: ReasoningEffortValue[] = ["default"];
  for (const option of providerOptions) {
    if (option !== "default" && !options.includes(option)) {
      options.push(option);
    }
  }
  return options;
}

function syncReasoningEffortPref(
  options: ReasoningEffortValue[],
  requested: ReasoningEffortValue,
) {
  const effective = resolveEffectiveReasoningEffort(options, requested);
  if (effective !== requested) {
    setPref("openaiReasoningEffort", effective);
  }
  return effective;
}

function hasQueriedModelReasoning(providerID: string, baseURL: string) {
  return runtime.modelReasoningBySource.has(
    buildModelSourceKey(providerID, baseURL),
  );
}

function hasReasoningMetadata(
  providerID: string,
  baseURL: string,
  model: string,
) {
  return Boolean(
    runtime.modelReasoningBySource
      .get(buildModelSourceKey(providerID, baseURL))
      ?.get(model)?.length,
  );
}

function getReasoningStatusText(
  providerID: string,
  baseURL: string,
  model: string,
) {
  if (hasReasoningMetadata(providerID, baseURL, model)) {
    return getReasoningStatusLabel("declared");
  }
  if (hasQueriedModelReasoning(providerID, baseURL)) {
    return getReasoningStatusLabel("queried-undeclared");
  }
  return getReasoningStatusLabel("not-queried");
}

async function fetchModelsFromCurrentProvider(
  providerID: string,
  baseURL: string,
) {
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  if (!normalizedBaseURL) {
    throw new Error(
      Zotero.locale.startsWith("zh")
        ? "请先在设置中填写 Base URL。"
        : "Please set Base URL first in settings.",
    );
  }
  const apiKey = normalizeAuthKey(
    getProviderApiKey(providerID, normalizedBaseURL),
  );
  if (isApiKeyRequiredForProvider(providerID) && !apiKey) {
    throw new Error(
      Zotero.locale.startsWith("zh")
        ? "当前 Provider 需要 API Key。"
        : "This provider requires an API key.",
    );
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const candidates = buildModelEndpointCandidates(normalizedBaseURL);
  let lastError: Error | null = null;
  for (const [index, endpoint] of candidates.entries()) {
    try {
      const request = await Zotero.HTTP.request("GET", endpoint, {
        headers,
        timeout: MODEL_FETCH_TIMEOUT_MS,
      });
      const modelInfos = parseModelInfos(
        request.responseText || "",
        getModelParseMessages(),
      );
      if (modelInfos.length) {
        return modelInfos;
      }
      throw new Error(
        Zotero.locale.startsWith("zh")
          ? "站点返回了空模型列表。"
          : "Site returned an empty model list.",
      );
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      if (canRetryModelEndpoint(index, candidates.length, normalizedError)) {
        lastError = normalizedError;
        continue;
      }
      throw normalizedError;
    }
  }
  throw lastError || new Error(formatModelFetchError(""));
}

async function refreshAllSections() {
  await Promise.all(
    [...runtime.refreshers.values()].map(async (refresh) => {
      await refresh();
    }),
  );
}

export async function refreshAgentSections() {
  await refreshAllSections();
}

async function streamAssistantReply(
  conversationKey: string,
  assistantMessageIndex: number,
  fullReply: string,
) {
  const message = getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  if (!message) {
    return;
  }
  const chunks = [...fullReply];
  let cursor = 0;
  while (cursor < chunks.length) {
    cursor = Math.min(cursor + TYPEWRITER_STEP_CHARS, chunks.length);
    const current = getConversationMessage(
      conversationKey,
      assistantMessageIndex,
    );
    if (!current) {
      return;
    }
    current.content = chunks.slice(0, cursor).join("");
    touchConversationByKey(conversationKey);
    await refreshAllSections();
    if (cursor < chunks.length) {
      await Zotero.Promise.delay(TYPEWRITER_DELAY_MS);
    }
  }
}

function getActiveConversationForScope(scopeKey: string) {
  ensureConversationStoreLoaded();
  return getActiveConversationForScopeInRuntime(runtime, scopeKey);
}

function getConversationForKey(conversationKey: string) {
  ensureConversationStoreLoaded();
  return getConversationForKeyInRuntime(runtime, conversationKey);
}

function getConversationsForScope(scopeKey: string) {
  ensureConversationStoreLoaded();
  return getConversationsForScopeInRuntime(runtime, scopeKey);
}

function getConversationMessage(conversationKey: string, messageIndex: number) {
  return getConversationMessageInRuntime(
    runtime,
    conversationKey,
    messageIndex,
  );
}

function touchConversationByKey(conversationKey: string) {
  touchConversationByKeyInRuntime(runtime, conversationKey);
}

function startNewConversation(scopeKey: string) {
  createNewConversationForScope(runtime, scopeKey);
  flushConversationStore();
}

function clearConversationMessages(conversationKey: string) {
  if (!clearConversationMessagesInRuntime(runtime, conversationKey)) {
    return;
  }
  runtime.activeToolEventByKey.delete(conversationKey);
  runtime.latestToolEventByKey.delete(conversationKey);
  clearWorkingState(conversationKey);
  flushConversationStore();
}

function selectConversation(scopeKey: string, conversationKey: string) {
  if (!selectConversationInRuntime(runtime, scopeKey, conversationKey)) {
    return;
  }
  flushConversationStore();
}

function deleteConversation(scopeKey: string, conversationKey: string) {
  if (!deleteConversationInRuntime(runtime, scopeKey, conversationKey)) {
    return;
  }
  runtime.activeToolEventByKey.delete(conversationKey);
  runtime.latestToolEventByKey.delete(conversationKey);
  clearWorkingState(conversationKey);
  flushConversationStore();
}

const conversationStoreDeps: ConversationStoreServiceDeps = {
  refreshAllSections: () => refreshAllSections(),
  formatError,
};

function ensureConversationStoreLoaded() {
  ensureConversationStoreLoadedInRuntime(runtime, conversationStoreDeps);
}

function saveConversationStore() {
  scheduleConversationStoreSaveInRuntime(runtime, conversationStoreDeps);
}

function flushConversationStore() {
  flushConversationStoreInRuntime(runtime, conversationStoreDeps);
}

function requestCancel() {
  requestCancelInRuntime(runtime);
}

function finishActiveRequest(conversationKey: string, requestToken: number) {
  if (requestToken !== runtime.requestToken) {
    return;
  }
  stopWaitingAnimation();
  flushConversationStore();
  runtime.streamingAssistant = null;
  runtime.sending = false;
  clearWorkingState(conversationKey);
  runtime.cancelRequested = false;
  runtime.cancelActiveRequest = null;
  failActiveToolEvent(
    conversationKey,
    getString("agent-tool-event-ended-unexpectedly"),
  );
  runtime.activeToolEventByKey.delete(conversationKey);
  runtime.latestToolEventByKey.delete(conversationKey);
  runtime.detectedToolActionByKey.delete(conversationKey);
  runtime.requestToken += 1;
  flushConversationStore();
  void refreshAllSections();
}

function startWorkingState(conversationKey: string) {
  startWorkingStateInRuntime(runtime, conversationKey);
}

function clearWorkingState(conversationKey: string) {
  clearWorkingStateInRuntime(runtime, conversationKey);
}

function startWaitingAnimation(
  conversationKey: string,
  assistantMessageIndex: number,
) {
  startWaitingAnimationInRuntime(
    runtime,
    conversationKey,
    assistantMessageIndex,
  );
}

function stopWaitingAnimation() {
  stopWaitingAnimationInRuntime(
    runtime,
    getConversationMessage,
    touchConversationByKey,
  );
}

function recordDiagnostic(
  level: Parameters<typeof recordDiagnosticInRuntime>[1],
  message: string,
  detail?: string,
) {
  recordDiagnosticInRuntime(runtime, level, message, detail);
}
