import { getLocaleID, getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import {
  AgentContextOptions,
  buildRequestMessagesWithContext,
  getDefaultContextOptions,
} from "./context";
import type { AgentMessage } from "./types";
import { ChatResult, createProviderFromPrefs } from "./provider";
import {
  buildEndpointKey,
  isNativeToolsUnsupported,
} from "./functionCalling/quirks";
import { runAssistantTurn } from "./functionCalling/runner";
import { shouldRetryChatError, isAbortError } from "./chatRetry";
import {
  clearConversationMessages as clearConversationMessagesInRuntime,
  createNewConversationForScope,
  deleteConversation as deleteConversationInRuntime,
  getActiveConversationForScope as getActiveConversationForScopeInRuntime,
  getConversationMessage as getConversationMessageInRuntime,
  getConversationsForScope as getConversationsForScopeInRuntime,
  selectConversation as selectConversationInRuntime,
  touchConversationByKey as touchConversationByKeyInRuntime,
} from "./conversationRuntime";
import { AgentRuntime, createAgentRuntime } from "./runtime/state";
import { recordDiagnostic as recordDiagnosticInRuntime } from "./runtime/diagnostics";
import { queueToolActionContent as queueToolActionContentInRuntime } from "./runtime/toolActionContent";
import {
  appendAssistantContinuation as appendAssistantContinuationInRuntime,
  appendToolResultMessage as appendToolResultMessageInRuntime,
} from "./runtime/conversationMessages";
import {
  rememberAnnotationOperationApprovals as rememberAnnotationOperationApprovalsInRuntime,
  shouldAutoApplyAnnotationBatch as shouldAutoApplyAnnotationBatchInRuntime,
} from "./runtime/annotationApprovals";
import {
  continueAfterAssistantToolAction,
  applyBatchAndContinue as applyBatchAndContinueInToolChain,
  maybeApplyResolvedBatch as maybeApplyResolvedBatchInToolChain,
  type ToolChainDeps,
} from "./runtime/toolChain";
import {
  clearWorkingState as clearWorkingStateInRuntime,
  requestCancel as requestCancelInRuntime,
  stopWaitingAnimation as stopWaitingAnimationInRuntime,
} from "./runtime/requestState";
import { beginUserTurn } from "./runtime/userTurn";
import {
  ensureConversationStoreLoaded as ensureConversationStoreLoadedInRuntime,
  flushConversationStore as flushConversationStoreInRuntime,
  scheduleConversationStoreSave as scheduleConversationStoreSaveInRuntime,
  type ConversationStoreServiceDeps,
} from "./runtime/conversationStoreService";
import {
  failActiveToolEvent as failActiveToolEventInRuntime,
  type ToolEventDeps,
} from "./runtime/toolEvents";
import { resolveConversationScopeKey } from "./itemScope";
import {
  ReasoningEffortValue,
  getDefaultModelForProvider,
  normalizeProviderID,
  normalizeReasoningEffort,
  normalizeString,
  resolveModelOptions,
  summarizeModelMetadataAvailability,
} from "./modelMetadata";
import {
  cacheModelInfos,
  getReasoningMetadataState,
  resolveRuntimeModelContextWindow,
  resolveRuntimeReasoningOptions,
  syncReasoningEffortPref,
} from "./modelMetadataRuntime";
import {
  fetchModelsFromCurrentProvider,
  formatModelFetchError,
} from "./modelListFetch";
import { openAgentPreferences } from "../prefsPane";
import {
  getOpenAIToolSpecs,
  hasExecutableAssistantToolAction,
  splitAssistantToolActionMessage,
} from "./toolAction";
import {
  isPdfToolsAutoApplyPref,
  isPdfToolsEnabledPref,
} from "../tools/annotationTools";
import {
  acceptAllPending,
  clearBatch,
  hasPendingBatch,
  rejectAllPending,
  setProposalStatus,
  type AnnotationBatch,
} from "../tools/annotationProposals";
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
  getModelsFetchedMessage,
  getReasoningStatusLabel,
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
            const models = cacheModelInfos(
              runtime,
              providerID,
              baseURL,
              modelInfos,
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
        const turn = beginUserTurn(
          runtime,
          conversation,
          conversationKey,
          prompt,
        );
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
        saveConversationStore();
        void refreshAllSections();
        void sendPreparedMessage(
          {
            requestMessages: turn.requestMessages,
            item,
            contextOptions,
            templateID,
            customContext: "",
            modelContextWindow,
            prompt,
          },
          conversationKey,
          turn.assistantMessageIndex,
          turn.requestToken,
          requestReasoningEffort,
        )
          .catch(async (error) => {
            if (turn.requestToken !== runtime.requestToken) {
              return;
            }
            await handleChatFailure(
              error,
              conversationKey,
              turn.assistantMessageIndex,
            );
          })
          .finally(() => {
            finishActiveRequest(conversationKey, turn.requestToken);
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
    toolChainDeps,
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

const toolEventDeps: ToolEventDeps = {
  getConversationMessage,
  touchConversationByKey,
  clearWebSearchStatus,
};

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

function appendToolResultMessage(
  conversationKey: string,
  options: { toolCallId: string; toolName: string; content: string },
): number {
  return appendToolResultMessageInRuntime(runtime, conversationKey, options);
}

function appendAssistantContinuation(conversationKey: string): number {
  return appendAssistantContinuationInRuntime(runtime, conversationKey);
}

const toolChainDeps: ToolChainDeps = {
  runtime,
  toolEventDeps,
  getConversationMessage: (conversationKey, messageIndex) =>
    getConversationMessage(conversationKey, messageIndex),
  touchConversationByKey: (conversationKey) =>
    touchConversationByKey(conversationKey),
  refreshAllSections: () => refreshAllSections(),
  sendMessage: (messages, conversationKey, index, token, effort) =>
    sendMessage(messages, conversationKey, index, token, effort),
  streamAssistantReply: (conversationKey, index, content) =>
    streamAssistantReply(conversationKey, index, content),
  saveConversationStore: () => saveConversationStore(),
  appendToolResultMessage: (conversationKey, options) =>
    appendToolResultMessage(conversationKey, options),
  appendAssistantContinuation: (conversationKey) =>
    appendAssistantContinuation(conversationKey),
  recordDiagnostic: (level, message, detail) =>
    recordDiagnostic(level, message, detail),
  applyWebSearchStatus: (status) => applyWebSearchStatus(status),
  stopWaitingAnimation: () => stopWaitingAnimation(),
  finishActiveRequest: (conversationKey, token) =>
    finishActiveRequest(conversationKey, token),
  shouldAutoApplyAnnotationBatch: (batch) =>
    shouldAutoApplyAnnotationBatchInRuntime(
      runtime,
      batch,
      isPdfToolsAutoApplyPref(),
    ),
  rememberAnnotationOperationApprovals: (batch) =>
    rememberAnnotationOperationApprovalsInRuntime(runtime, batch),
  getFirstProposalError: (batch) =>
    batch.proposals.find((proposal) => proposal.errorMessage)?.errorMessage ||
    "",
};

function applyBatchAndContinue(
  conversationKey: string,
  autoAcceptAll: boolean,
) {
  return applyBatchAndContinueInToolChain(
    toolChainDeps,
    conversationKey,
    autoAcceptAll,
  );
}

function maybeApplyResolvedBatch(conversationKey: string) {
  return maybeApplyResolvedBatchInToolChain(toolChainDeps, conversationKey);
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

function rememberAnnotationOperationApprovals(batch: AnnotationBatch): void {
  rememberAnnotationOperationApprovalsInRuntime(runtime, batch);
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
  return resolveRuntimeModelContextWindow(runtime, providerID, baseURL, model);
}

function resolveReasoningOptions(
  providerID: string,
  baseURL: string,
  model: string,
) {
  return resolveRuntimeReasoningOptions(runtime, providerID, baseURL, model);
}

function getReasoningStatusText(
  providerID: string,
  baseURL: string,
  model: string,
) {
  return getReasoningStatusLabel(
    getReasoningMetadataState(runtime, providerID, baseURL, model),
  );
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

function clearWorkingState(conversationKey: string) {
  clearWorkingStateInRuntime(runtime, conversationKey);
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
