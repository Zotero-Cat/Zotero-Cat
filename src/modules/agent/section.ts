import { getLocaleID, getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import {
  AgentContextOptions,
  buildContextPreview,
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
import {
  ConversationState,
  MAX_VISIBLE_CONVERSATION_OPTIONS,
  RuntimeMessage,
  touchConversation,
} from "./conversationStore";
import {
  ConversationRuntimeState,
  MessagePointer,
  applyConversationStoreToRuntime,
  clearConversationMessages as clearConversationMessagesInRuntime,
  createConversationRuntimeState,
  createNewConversationForScope,
  deleteConversation as deleteConversationInRuntime,
  getActiveConversationForScope as getActiveConversationForScopeInRuntime,
  getConversationForKey as getConversationForKeyInRuntime,
  getConversationMessage as getConversationMessageInRuntime,
  getConversationsForScope as getConversationsForScopeInRuntime,
  pointsToMessage,
  selectConversation as selectConversationInRuntime,
  toProviderMessages,
  touchConversationByKey as touchConversationByKeyInRuntime,
} from "./conversationRuntime";
import {
  loadConversationFileStore,
  saveConversationFileStore,
} from "./conversationFileStore";
import {
  getCustomContextForKey,
  setCustomContextForKey,
} from "./customContextStore";
import {
  resolveConversationScopeKey,
  resolveCustomContextKey,
} from "./itemScope";
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
import {
  DEFAULT_PROMPT_TEMPLATE_ID,
  getPromptTemplateByID,
  getPromptTemplates,
} from "./promptTemplates";
import { createRuntimeID } from "./runtimeIds";
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
} from "./annotationTools";
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
} from "./annotationProposals";
import {
  buildFailedAnnotationRepairPrompt,
  gatherFailedAnnotationPageText,
  shouldRepairFailedAnnotationBatch,
} from "./annotationRepair";
import { renderProposalBatch } from "./proposalView";
import {
  createRunningToolEventMessage,
  getToolEventLabelID,
  markToolEventMessage,
  normalizeToolKind,
} from "./toolEventState";
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
import { renderMessageMarkdown } from "./markdown";
import { truncateInline, formatShortDateTime } from "../../utils/text";
import { copyTextToClipboard } from "../../utils/clipboard";
import {
  createInlineCopyButton,
  showCopyFeedback,
} from "../../utils/copyButton";

let registeredSectionID: string | false = false;
const TYPEWRITER_STEP_CHARS = 3;
const TYPEWRITER_DELAY_MS = 18;
const SCROLL_BOTTOM_THRESHOLD_PX = 24;
const MODEL_FETCH_TIMEOUT_MS = 25_000;
const ROOT_HEIGHT_RATIO = 0.9;
const CHAT_MAX_ATTEMPTS = 2;
const CHAT_RETRY_DELAY_MS = 700;
const CONVERSATION_STORE_SAVE_DELAY_MS = 1200;
const MAX_DIAGNOSTIC_ENTRIES = 30;
const resizeObservers = new WeakMap<HTMLDivElement, ResizeObserver>();

interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

interface DiagnosticEntry {
  id: string;
  level: "info" | "warning" | "error";
  createdAt: number;
  message: string;
  detail?: string;
}

interface AgentRuntime extends ConversationRuntimeState {
  conversationStoreLoaded: boolean;
  conversationStoreLoading: boolean;
  sending: boolean;
  workingConversationKey: string | null;
  streamingAssistant: MessagePointer | null;
  waitingAssistant: MessagePointer | null;
  waitingStartedAt: number | null;
  waitingStep: number;
  waitingToken: number;
  requestToken: number;
  cancelRequested: boolean;
  cancelActiveRequest: (() => void) | null;
  shouldAutoScroll: boolean;
  templateID: string;
  contextOptions: AgentContextOptions;
  modelOptionsBySource: Map<string, string[]>;
  modelContextBySource: Map<string, Map<string, number>>;
  modelReasoningBySource: Map<string, Map<string, ReasoningEffortValue[]>>;
  modelFetchBusy: boolean;
  modelFetchStatusMessage: string;
  modelFetchStatusKind: "success" | "error" | "";
  webSearchStatusMessage: string;
  webSearchStatusKind: "success" | "error" | "";
  customContextOpen: boolean;
  contextPreviewOpen: boolean;
  diagnosticsOpen: boolean;
  diagnostics: DiagnosticEntry[];
  refreshers: Map<string, () => Promise<void>>;
  pendingToolFollowUp: Map<string, PendingToolFollowUp>;
  activeToolEventByKey: Map<string, number>;
  approvedAnnotationOperationKeys: Set<string>;
  detectedToolActionByKey: Set<string>;
  pendingToolActionContentByMessage: Map<string, string>;
  conversationStoreSaveTimer: ReturnType<typeof setTimeout> | null;
}

interface PendingToolFollowUp {
  requestMessages: AgentMessage[];
  assistantContent: string;
  assistantMessageIndex: number;
  reasoningEffort: ReasoningEffortValue;
  item: Zotero.Item | null;
  readResults: string;
  nativeToolCalls?: AssistantToolCall[];
  nativeWriteCalls?: AssistantToolCall[];
  nativeReadResults?: Array<{
    toolCall: AssistantToolCall;
    result: string;
  }>;
}

const runtime: AgentRuntime = {
  ...createConversationRuntimeState(),
  conversationStoreLoaded: false,
  conversationStoreLoading: false,
  sending: false,
  workingConversationKey: null,
  streamingAssistant: null,
  waitingAssistant: null,
  waitingStartedAt: null,
  waitingStep: 0,
  waitingToken: 0,
  requestToken: 0,
  cancelRequested: false,
  cancelActiveRequest: null,
  shouldAutoScroll: true,
  templateID: DEFAULT_PROMPT_TEMPLATE_ID,
  contextOptions: getDefaultContextOptions(),
  modelOptionsBySource: new Map(),
  modelContextBySource: new Map(),
  modelReasoningBySource: new Map(),
  modelFetchBusy: false,
  modelFetchStatusMessage: "",
  modelFetchStatusKind: "",
  webSearchStatusMessage: "",
  webSearchStatusKind: "",
  customContextOpen: false,
  contextPreviewOpen: false,
  diagnosticsOpen: false,
  diagnostics: [],
  refreshers: new Map(),
  pendingToolFollowUp: new Map(),
  activeToolEventByKey: new Map(),
  approvedAnnotationOperationKeys: new Set(),
  detectedToolActionByKey: new Set(),
  pendingToolActionContentByMessage: new Map(),
  conversationStoreSaveTimer: null,
};

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

function isProviderConfigured(): boolean {
  const providerID = normalizeProviderID(getPref("provider"));
  if (!isApiKeyRequiredForProvider(providerID)) {
    return true;
  }
  const baseURL = normalizeString(getPref("openaiBaseUrl"), "");
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  if (!normalizedBaseURL) {
    return false;
  }
  return Boolean(getProviderApiKey(providerID, normalizedBaseURL));
}

function renderProviderGate(body: HTMLDivElement, doc: Document) {
  const root = doc.createElement("div");
  root.className = "za-agent-root za-agent-gate";
  applyRootDimensions(root, body);
  ensureBodyResizeObserver(body);

  const title = doc.createElement("div");
  title.className = "za-agent-gate-title";
  title.textContent = getString("agent-gate-title");

  const message = doc.createElement("div");
  message.className = "za-agent-gate-message";
  message.textContent = getString("agent-gate-message");

  const button = doc.createElement("button");
  button.className = "za-agent-gate-button";
  button.textContent = getString("agent-gate-open-settings");
  button.addEventListener("click", () => {
    try {
      openAgentPreferences();
    } catch (error) {
      recordDiagnostic("error", formatError(error));
    }
  });

  root.append(title, message, button);
  body.replaceChildren(root);
}

function renderConversationStoreLoading(body: HTMLDivElement, doc: Document) {
  const root = doc.createElement("div");
  root.className = "za-agent-root";
  applyRootDimensions(root, body);
  ensureBodyResizeObserver(body);

  const loading = doc.createElement("div");
  loading.className = "za-agent-empty";
  loading.textContent = getString("agent-waiting-label");
  root.appendChild(loading);
  body.replaceChildren(root);
}

function renderSectionBody(body: HTMLDivElement, item: Zotero.Item) {
  const doc = body.ownerDocument;
  if (!doc) {
    return;
  }
  if (!isProviderConfigured()) {
    renderProviderGate(body, doc);
    return;
  }
  if (!runtime.conversationStoreLoaded) {
    ensureConversationStoreLoaded();
    renderConversationStoreLoading(body, doc);
    return;
  }
  const customContextKey = resolveCustomContextKey(item);
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

  const messages = doc.createElement("div");
  messages.className = "za-agent-messages";
  if (!conversationMessages.length) {
    const empty = doc.createElement("div");
    empty.className = "za-agent-empty";
    empty.textContent = getString("agent-empty-state");
    messages.appendChild(empty);
  } else {
    for (const [index, message] of conversationMessages.entries()) {
      if (message.kind === "tool-event") {
        const eventBubble = renderToolEventBubble(doc, message);
        if (eventBubble) {
          messages.appendChild(eventBubble);
        }
        continue;
      }
      // Tool-result messages are kept in conversation history so future
      // requests can pair them with the preceding assistant tool_calls turn,
      // but they have no UI of their own — the tool-event bubble above
      // already conveys progress to the user.
      if (message.role === "tool") {
        continue;
      }
      const bubble = doc.createElement("div");
      bubble.className = `za-agent-message za-agent-${message.role}`;
      const isStreamingCurrent = pointsToMessage(
        runtime.streamingAssistant,
        conversationKey,
        index,
      );
      const isWaitingCurrent = pointsToMessage(
        runtime.waitingAssistant,
        conversationKey,
        index,
      );
      if (isStreamingCurrent) {
        bubble.classList.add("za-agent-streaming");
      }
      if (isWaitingCurrent && !message.content.trim()) {
        bubble.classList.add("za-agent-waiting");
        const waitingText = doc.createElement("div");
        waitingText.className = "za-agent-message-content";
        waitingText.textContent = `${getString("agent-waiting-label")}${".".repeat(runtime.waitingStep + 1)}`;
        bubble.append(waitingText, createMessageMeta(doc, message));
      } else {
        const content = doc.createElement("div");
        content.className = "za-agent-message-content";
        renderMessageMarkdown(content, message.content);
        bubble.append(
          content,
          createMessageMeta(doc, message),
          createCopyButton(doc, message.content),
        );
      }
      messages.appendChild(bubble);
    }
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
        onAccept(id) {
          setProposalStatus(conversationKey, id, "accepted");
          void maybeApplyResolvedBatch(conversationKey);
        },
        onReject(id) {
          setProposalStatus(conversationKey, id, "rejected");
          void maybeApplyResolvedBatch(conversationKey);
        },
        onAcceptAll() {
          acceptAllPending(conversationKey);
          void applyBatchAndContinue(conversationKey, false);
        },
        onAlwaysAllow() {
          const batch = getBatchForConversation(conversationKey);
          if (batch) {
            rememberAnnotationOperationApprovals(batch);
          }
          acceptAllPending(conversationKey);
          void applyBatchAndContinue(conversationKey, false);
        },
        onRejectAll() {
          rejectAllPending(conversationKey);
          void maybeApplyResolvedBatch(conversationKey);
        },
        onDismiss() {
          runtime.pendingToolFollowUp.delete(conversationKey);
          clearBatch(conversationKey);
          void refreshAllSections();
        },
      }),
    );
  }

  const composer = doc.createElement("div");
  composer.className = "za-agent-composer";

  const controls = doc.createElement("div");
  controls.className = "za-agent-controls";

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

  const modelRow = doc.createElement("div");
  modelRow.className = "za-agent-model-row";

  const modelLabel = doc.createElement("span");
  modelLabel.className = "za-agent-template-label";
  modelLabel.textContent = `${getModelLabel()}:`;

  const modelSelect = doc.createElement("select");
  modelSelect.className = "za-agent-model-select";
  modelSelect.disabled = runtime.sending || runtime.modelFetchBusy;
  renderModelOptions(modelSelect, modelOptions);
  modelSelect.value = currentModel;
  modelSelect.addEventListener("change", () => {
    const nextModel = normalizeString(modelSelect.value, currentModel);
    setPref("openaiModel", nextModel);
    syncReasoningEffortPref(
      resolveReasoningOptions(providerID, baseURL, nextModel),
      normalizeReasoningEffort(getPref("openaiReasoningEffort")),
    );
    void refreshAllSections();
  });

  const fetchModelsButton = doc.createElement("button");
  fetchModelsButton.className = "za-agent-model-fetch";
  fetchModelsButton.disabled = runtime.sending || runtime.modelFetchBusy;
  fetchModelsButton.textContent = runtime.modelFetchBusy
    ? getFetchingModelsLabel()
    : getFetchModelsLabel();
  fetchModelsButton.addEventListener("click", () => {
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
  });

  const reasoningLabel = doc.createElement("span");
  reasoningLabel.className = "za-agent-template-label";
  reasoningLabel.textContent = `${getReasoningLabel()}:`;

  const reasoningSelect = doc.createElement("select");
  reasoningSelect.className = "za-agent-reasoning-select";
  reasoningSelect.disabled = runtime.sending || runtime.modelFetchBusy;
  renderReasoningOptions(reasoningSelect, reasoningOptions);
  reasoningSelect.value = effectiveReasoningEffort;
  reasoningSelect.addEventListener("change", () => {
    setPref(
      "openaiReasoningEffort",
      normalizeReasoningEffort(reasoningSelect.value),
    );
    void refreshAllSections();
  });

  const reasoningStatus = doc.createElement("span");
  reasoningStatus.className = "za-agent-reasoning-status";
  reasoningStatus.textContent = getReasoningStatusText(
    providerID,
    baseURL,
    currentModel,
  );

  modelRow.append(modelLabel, modelSelect, fetchModelsButton);

  const templateRow = doc.createElement("div");
  templateRow.className = "za-agent-template-row";

  const templateLabel = doc.createElement("span");
  templateLabel.className = "za-agent-template-label";
  templateLabel.textContent = `${getString("agent-template-label")}:`;

  const templateSelect = doc.createElement("select");
  templateSelect.className = "za-agent-template-select";
  templateSelect.disabled = runtime.sending;
  for (const template of getPromptTemplates()) {
    const option = doc.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    templateSelect.appendChild(option);
  }
  templateSelect.value = getPromptTemplateByID(runtime.templateID).id;
  templateSelect.addEventListener("change", () => {
    runtime.templateID = getPromptTemplateByID(templateSelect.value).id;
    void refreshAllSections();
  });
  templateRow.append(
    templateLabel,
    templateSelect,
    reasoningLabel,
    reasoningSelect,
    reasoningStatus,
  );

  const contextRow = doc.createElement("div");
  contextRow.className = "za-agent-context-row";
  contextRow.append(
    createContextToggle(
      doc,
      "agent-context-metadata",
      runtime.contextOptions.includeMetadata,
      runtime.sending,
      (nextValue) => {
        runtime.contextOptions.includeMetadata = nextValue;
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-context-notes",
      runtime.contextOptions.includeNotes,
      runtime.sending,
      (nextValue) => {
        runtime.contextOptions.includeNotes = nextValue;
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-context-annotations",
      runtime.contextOptions.includeAnnotations,
      runtime.sending,
      (nextValue) => {
        runtime.contextOptions.includeAnnotations = nextValue;
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-context-selected-text",
      runtime.contextOptions.includeSelectedText,
      runtime.sending,
      (nextValue) => {
        runtime.contextOptions.includeSelectedText = nextValue;
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-web-search-toggle",
      isWebSearchEnabled(),
      runtime.sending,
      (nextValue) => {
        setPref("webSearchEnabled", nextValue);
        runtime.webSearchStatusMessage = "";
        runtime.webSearchStatusKind = "";
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-pdf-tools-toggle",
      isPdfToolsEnabledPref(),
      runtime.sending,
      (nextValue) => {
        setPref("pdfToolsEnabled", nextValue);
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-pdf-tools-auto-apply",
      isPdfToolsAutoApplyPref(),
      runtime.sending || !isPdfToolsEnabledPref(),
      (nextValue) => {
        setPref("pdfToolsAutoApply", nextValue);
        void refreshAllSections();
      },
    ),
  );
  controls.append(
    modelRow,
    templateRow,
    contextRow,
    createCustomContextInput(doc, customContextKey),
    createContextPreview(
      doc,
      item,
      {
        providerID,
        baseURL,
        model: currentModel,
      },
      customContextKey,
    ),
    createDiagnosticsPanel(doc),
  );
  if (runtime.modelFetchStatusMessage) {
    const status = doc.createElement("div");
    status.className = "za-agent-model-status";
    if (runtime.modelFetchStatusKind) {
      status.dataset.kind = runtime.modelFetchStatusKind;
    }
    status.textContent = runtime.modelFetchStatusMessage;
    controls.append(status);
  }
  if (runtime.webSearchStatusMessage) {
    const status = doc.createElement("div");
    status.className = "za-agent-model-status";
    if (runtime.webSearchStatusKind) {
      status.dataset.kind = runtime.webSearchStatusKind;
    }
    status.textContent = runtime.webSearchStatusMessage;
    controls.append(status);
  }

  const composerLocked = hasPendingBatch(conversationKey);

  const input = doc.createElement("input");
  input.className = "za-agent-input";
  input.type = "text";
  input.placeholder = composerLocked
    ? getString("agent-proposals-composer-locked")
    : getString("agent-input-placeholder");
  input.disabled = runtime.sending || composerLocked;

  const sendButton = doc.createElement("button");
  sendButton.className = "za-agent-send";
  sendButton.classList.add(runtime.sending ? "is-stop" : "is-send");
  sendButton.disabled = composerLocked && !runtime.sending;
  const buttonLabel = runtime.sending
    ? getString("agent-stop-tooltip")
    : getString("agent-send-tooltip");
  sendButton.title = buttonLabel;
  sendButton.setAttribute("aria-label", buttonLabel);

  sendButton.addEventListener("click", () => {
    if (runtime.sending) {
      requestCancel();
      return;
    }
    const prompt = input.value.trim();
    if (!prompt) {
      return;
    }
    runtime.sending = true;
    startWorkingState(conversationKey);
    runtime.cancelRequested = false;
    runtime.cancelActiveRequest = null;
    runtime.requestToken += 1;
    runtime.webSearchStatusMessage = "";
    runtime.webSearchStatusKind = "";
    const requestToken = runtime.requestToken;
    conversation.messages.push({
      role: "user",
      content: prompt,
      createdAt: Date.now(),
    });
    touchConversation(conversation);
    const requestMessages = toProviderMessages(conversation.messages);
    const templateID = runtime.templateID;
    const contextOptions = { ...runtime.contextOptions };
    const customContext = getCustomContextForKey(customContextKey);
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
    input.value = "";
    void refreshAllSections();
    void sendPreparedMessage(
      {
        requestMessages,
        item,
        contextOptions,
        templateID,
        customContext,
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
        await handleChatFailure(error, conversationKey, assistantMessageIndex);
      })
      .finally(() => {
        finishActiveRequest(conversationKey, requestToken);
      });
  });

  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendButton.click();
    }
  });

  composer.append(input, sendButton);
  const activityStatus = renderActivityStatus(doc, conversationKey);
  const rootChildren: HTMLElement[] = [
    createSessionControls(doc, conversationScopeKey, conversation),
    messages,
    controls,
  ];
  if (activityStatus) {
    rootChildren.push(activityStatus);
  }
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

function appendToolEventMessage(
  conversationKey: string,
  toolType: string,
): number {
  const conversation = getConversationForKey(conversationKey);
  if (!conversation) {
    return -1;
  }
  const index =
    conversation.messages.push(createRunningToolEventMessage(toolType)) - 1;
  runtime.activeToolEventByKey.set(conversationKey, index);
  if (runtime.sending) {
    startWorkingState(conversationKey);
  }
  touchConversationByKey(conversationKey);
  if (runtime.sending) {
    runtime.waitingToken += 1;
    const token = runtime.waitingToken;
    void runWaitingLoop(token);
  }
  return index;
}

function markToolEventDone(conversationKey: string, messageIndex: number) {
  const message = getConversationMessage(conversationKey, messageIndex);
  if (!markToolEventMessage(message, "done")) {
    return;
  }
  if (runtime.activeToolEventByKey.get(conversationKey) === messageIndex) {
    runtime.activeToolEventByKey.delete(conversationKey);
  }
  touchConversationByKey(conversationKey);
}

function markToolEventFailed(
  conversationKey: string,
  messageIndex: number,
  errorMessage: string,
) {
  const message = getConversationMessage(conversationKey, messageIndex);
  if (!markToolEventMessage(message, "failed", { errorMessage })) {
    return;
  }
  if (runtime.activeToolEventByKey.get(conversationKey) === messageIndex) {
    runtime.activeToolEventByKey.delete(conversationKey);
  }
  touchConversationByKey(conversationKey);
}

function failActiveToolEvent(conversationKey: string, errorMessage: string) {
  const index = runtime.activeToolEventByKey.get(conversationKey);
  if (typeof index === "number") {
    markToolEventFailed(conversationKey, index, errorMessage);
  }
}

function buildMessageActionKey(conversationKey: string, messageIndex: number) {
  return `${conversationKey}::${messageIndex}`;
}

function queueToolActionContent(
  conversationKey: string,
  messageIndex: number,
  content: string,
) {
  runtime.pendingToolActionContentByMessage.set(
    buildMessageActionKey(conversationKey, messageIndex),
    content,
  );
}

function takeToolActionContent(
  conversationKey: string,
  messageIndex: number,
): string {
  const key = buildMessageActionKey(conversationKey, messageIndex);
  const content = runtime.pendingToolActionContentByMessage.get(key) || "";
  runtime.pendingToolActionContentByMessage.delete(key);
  return content;
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
      '联网搜索: {"action":"联网搜索","action_input":{"query":"检索词"}}',
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
    'Web search: {"action":"web_search","action_input":{"query":"search terms"}}',
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

function renderModelOptions(select: HTMLSelectElement, models: string[]) {
  const doc = select.ownerDocument;
  if (!doc) {
    return;
  }
  select.replaceChildren();
  for (const model of models) {
    const option = doc.createElement("option");
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  }
}

function renderReasoningOptions(
  select: HTMLSelectElement,
  values: ReasoningEffortValue[],
) {
  const doc = select.ownerDocument;
  if (!doc) {
    return;
  }
  select.replaceChildren();
  for (const value of values) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = getReasoningOptionLabel(value);
    select.appendChild(option);
  }
}

function getReasoningOptionLabel(value: ReasoningEffortValue) {
  const zh = Zotero.locale.startsWith("zh");
  switch (value) {
    case "default":
      return zh ? "默认" : "Default";
    case "none":
      return zh ? "无" : "None";
    case "minimal":
      return zh ? "最小" : "Minimal";
    case "low":
      return zh ? "低" : "Low";
    case "medium":
      return zh ? "中" : "Medium";
    case "high":
      return zh ? "高" : "High";
    case "xhigh":
      return zh ? "最高" : "XHigh";
    default:
      return value;
  }
}

function getModelLabel() {
  return Zotero.locale.startsWith("zh") ? "模型" : "Model";
}

function getFetchModelsLabel() {
  return Zotero.locale.startsWith("zh") ? "获取模型列表" : "Fetch Model List";
}

function getFetchingModelsLabel() {
  return Zotero.locale.startsWith("zh") ? "获取中..." : "Fetching...";
}

function getReasoningLabel() {
  return Zotero.locale.startsWith("zh") ? "思考强度" : "Reasoning";
}

function getReasoningStatusText(
  providerID: string,
  baseURL: string,
  model: string,
) {
  if (hasReasoningMetadata(providerID, baseURL, model)) {
    return Zotero.locale.startsWith("zh")
      ? "由提供方声明"
      : "Provider declared";
  }
  if (hasQueriedModelReasoning(providerID, baseURL)) {
    return Zotero.locale.startsWith("zh") ? "提供方未声明" : "Not declared";
  }
  return Zotero.locale.startsWith("zh") ? "未查询" : "Not queried";
}

function getModelsFetchedMessage(
  availability: ReturnType<typeof summarizeModelMetadataAvailability>,
) {
  const { modelCount, contextWindowCount, reasoningEffortCount } = availability;
  return Zotero.locale.startsWith("zh")
    ? `已从站点获取 ${modelCount} 个模型；${contextWindowCount} 个声明模型上下文，${reasoningEffortCount} 个声明思考强度。`
    : `Fetched ${modelCount} models from site; ${contextWindowCount} declared context windows and ${reasoningEffortCount} declared reasoning options.`;
}

function getNoModelListMessage() {
  return Zotero.locale.startsWith("zh")
    ? "站点返回结果里没有模型列表字段。"
    : "Site response does not contain a model-list field.";
}

function getEmptyModelListMessage() {
  return Zotero.locale.startsWith("zh")
    ? "站点返回了空模型列表。"
    : "Site returned an empty model list.";
}

function getModelParseMessages() {
  return {
    emptyModelList: getEmptyModelListMessage(),
    invalidJSON: Zotero.locale.startsWith("zh")
      ? "站点返回 JSON 解析失败。"
      : "Failed to parse JSON from site.",
    noModelList: getNoModelListMessage(),
    nonJSON: Zotero.locale.startsWith("zh")
      ? "站点返回的不是 JSON。"
      : "Site did not return JSON.",
  };
}

function formatModelFetchError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const normalized = text.trim();
  return (
    normalized ||
    (Zotero.locale.startsWith("zh") ? "获取失败。" : "Fetch failed.")
  );
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

function normalizeAuthKey(rawKey: string) {
  let value = rawKey.trim();
  if (!value) {
    return "";
  }
  value = value.replace(/^['"]|['"]$/g, "").trim();
  value = value.replace(/^bearer\s+/i, "").trim();
  return value;
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

function isNearBottom(messages: HTMLDivElement) {
  const distance =
    messages.scrollHeight - (messages.scrollTop + messages.clientHeight);
  return distance <= SCROLL_BOTTOM_THRESHOLD_PX;
}

function scrollToBottom(messages: HTMLDivElement) {
  messages.scrollTop = messages.scrollHeight;
  const view = messages.ownerDocument?.defaultView;
  if (!view) {
    return;
  }
  view.requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
  view.setTimeout(() => {
    messages.scrollTop = messages.scrollHeight;
  }, 24);
}

function captureScrollState(messages: HTMLDivElement): ScrollState {
  return {
    scrollTop: messages.scrollTop,
    scrollHeight: messages.scrollHeight,
    clientHeight: messages.clientHeight,
  };
}

function restoreScrollPosition(messages: HTMLDivElement, state: ScrollState) {
  const previousDistanceFromBottom = Math.max(
    0,
    state.scrollHeight - (state.scrollTop + state.clientHeight),
  );
  messages.scrollTop = Math.max(
    0,
    messages.scrollHeight - messages.clientHeight - previousDistanceFromBottom,
  );
}

function computeFixedRootHeight(body: HTMLDivElement) {
  const doc = body.ownerDocument;
  if (!doc) {
    return 360;
  }
  const paneContent = doc.getElementById(
    "zotero-item-pane-content",
  ) as HTMLElement | null;
  const baseHeight = firstPositive(
    paneContent?.clientHeight,
    body.parentElement?.clientHeight,
    body.clientHeight,
    doc.defaultView ? Math.floor(doc.defaultView.innerHeight) : 0,
  );
  return Math.max(220, Math.floor(baseHeight * ROOT_HEIGHT_RATIO));
}

function firstPositive(...values: Array<number | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && value > 0) {
      return value;
    }
  }
  return 480;
}

function computeAvailableWidth(body: HTMLDivElement) {
  const doc = body.ownerDocument;
  if (!doc) {
    return 300;
  }
  const paneContent = doc.getElementById(
    "zotero-item-pane-content",
  ) as HTMLElement | null;
  return firstPositive(
    body.clientWidth,
    body.parentElement?.clientWidth,
    paneContent?.clientWidth,
  );
}

function applyRootDimensions(root: HTMLDivElement, body: HTMLDivElement) {
  const fixedHeight = computeFixedRootHeight(body);
  const availableWidth = computeAvailableWidth(body);
  root.style.height = `${fixedHeight}px`;
  root.style.minHeight = `${fixedHeight}px`;
  root.style.maxHeight = `${fixedHeight}px`;
  root.style.width = "100%";
  root.style.maxWidth = `${availableWidth}px`;
  root.style.overflow = "hidden";
}

function ensureBodyResizeObserver(body: HTMLDivElement) {
  if (resizeObservers.has(body)) {
    return;
  }
  const win = body.ownerDocument?.defaultView;
  if (!win) {
    return;
  }
  const ObserverCtor = (win as unknown as Record<string, unknown>)
    .ResizeObserver as
    | (new (callback: ResizeObserverCallback) => ResizeObserver)
    | undefined;
  if (!ObserverCtor) {
    return;
  }
  const observer = new ObserverCtor(() => {
    const root = body.querySelector<HTMLDivElement>(".za-agent-root");
    if (root) {
      applyRootDimensions(root, body);
    }
  });
  observer.observe(body);
  resizeObservers.set(body, observer);
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
  clearWorkingState(conversationKey);
  flushConversationStore();
}

function ensureConversationStoreLoaded() {
  if (runtime.conversationStoreLoaded || runtime.conversationStoreLoading) {
    return;
  }
  runtime.conversationStoreLoading = true;
  void loadConversationFileStore()
    .then((store) => {
      if (runtime.conversationStoreLoaded) {
        return;
      }
      applyConversationStore(store);
      runtime.conversationStoreLoaded = true;
    })
    .catch((error) => {
      recordDiagnostic(
        "error",
        "Failed to load conversation history",
        formatError(error),
      );
      runtime.conversationStoreLoaded = true;
    })
    .finally(() => {
      runtime.conversationStoreLoading = false;
      void refreshAllSections();
    });
}

function applyConversationStore(
  store: Awaited<ReturnType<typeof loadConversationFileStore>>,
) {
  applyConversationStoreToRuntime(runtime, store);
}

function saveConversationStore() {
  scheduleConversationStoreSave();
}

function flushConversationStore() {
  if (runtime.conversationStoreSaveTimer) {
    clearTimeout(runtime.conversationStoreSaveTimer);
    runtime.conversationStoreSaveTimer = null;
  }
  void writeConversationStoreNow();
}

function scheduleConversationStoreSave() {
  if (runtime.conversationStoreSaveTimer) {
    return;
  }
  runtime.conversationStoreSaveTimer = setTimeout(() => {
    runtime.conversationStoreSaveTimer = null;
    void writeConversationStoreNow();
  }, CONVERSATION_STORE_SAVE_DELAY_MS);
}

async function writeConversationStoreNow() {
  ensureConversationStoreLoaded();
  if (!runtime.conversationStoreLoaded) {
    return;
  }
  try {
    await saveConversationFileStore({
      conversations: runtime.conversationsByKey.values(),
      activeConversationKeyByScope: runtime.activeConversationKeyByScope,
      conversationsByKey: runtime.conversationsByKey,
    });
  } catch (error) {
    recordDiagnostic(
      "error",
      "Failed to save conversation history",
      formatError(error),
    );
  }
}

function requestCancel() {
  if (!runtime.sending) {
    return;
  }
  runtime.cancelRequested = true;
  if (runtime.cancelActiveRequest) {
    runtime.cancelActiveRequest();
  }
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
  runtime.detectedToolActionByKey.delete(conversationKey);
  runtime.requestToken += 1;
  flushConversationStore();
  void refreshAllSections();
}

function startWorkingState(conversationKey: string) {
  runtime.workingConversationKey = conversationKey;
}

function clearWorkingState(conversationKey: string) {
  if (runtime.workingConversationKey === conversationKey) {
    runtime.workingConversationKey = null;
  }
}

function startWaitingAnimation(
  conversationKey: string,
  assistantMessageIndex: number,
) {
  runtime.waitingAssistant = {
    conversationKey,
    messageIndex: assistantMessageIndex,
  };
  runtime.waitingStartedAt = Date.now();
  runtime.waitingStep = 0;
  runtime.waitingToken += 1;
  const token = runtime.waitingToken;
  void runWaitingLoop(token);
}

function stopWaitingAnimation() {
  const waiting = runtime.waitingAssistant;
  if (waiting && runtime.waitingStartedAt !== null) {
    const assistantMessage = getConversationMessage(
      waiting.conversationKey,
      waiting.messageIndex,
    );
    if (assistantMessage && assistantMessage.responseWaitMs === undefined) {
      assistantMessage.responseWaitMs = Math.max(
        0,
        Date.now() - runtime.waitingStartedAt,
      );
      touchConversationByKey(waiting.conversationKey);
    }
  }
  runtime.waitingAssistant = null;
  runtime.waitingStartedAt = null;
  runtime.waitingStep = 0;
  runtime.waitingToken += 1;
  // If a tool event is still running, restart the animation loop so its dots
  // and elapsed timer keep updating. Otherwise the loop has been invalidated
  // above.
  if (runtime.activeToolEventByKey.size > 0 && runtime.sending) {
    const token = runtime.waitingToken;
    void runWaitingLoop(token);
  }
}

async function runWaitingLoop(token: number) {
  while (runtime.waitingToken === token && runtime.sending) {
    const hasWaiting = runtime.waitingAssistant !== null;
    const hasRunningToolEvent = runtime.activeToolEventByKey.size > 0;
    if (!hasWaiting && !hasRunningToolEvent) {
      break;
    }
    runtime.waitingStep = (runtime.waitingStep + 1) % 3;
    await refreshAllSections();
    await Zotero.Promise.delay(320);
  }
}

function renderActivityStatus(
  doc: Document,
  conversationKey: string,
): HTMLElement | null {
  if (!runtime.sending || runtime.workingConversationKey !== conversationKey) {
    return null;
  }

  const status = doc.createElement("div");
  status.className = "za-agent-activity-status";

  const indicator = doc.createElement("span");
  indicator.className = "za-agent-activity-indicator";

  const label = doc.createElement("span");
  label.className = "za-agent-activity-label";
  label.textContent = runtime.detectedToolActionByKey.has(conversationKey)
    ? getString("agent-tool-detected-label")
    : getString("agent-working-label");

  status.append(indicator, label);
  return status;
}

function renderToolEventBubble(
  doc: Document,
  message: RuntimeMessage,
): HTMLElement | null {
  const event = message.toolEvent;
  if (!event) {
    return null;
  }
  const toolKind = normalizeToolKind(event.toolType);
  const bubble = doc.createElement("div");
  bubble.className = "za-agent-tool-event";
  bubble.classList.add(`za-agent-tool-event-${event.status}`);

  const row = doc.createElement("div");
  row.className = "za-agent-tool-event-row";

  const indicator = doc.createElement("span");
  indicator.className = "za-agent-tool-event-indicator";
  row.append(indicator);

  const labelNode = doc.createElement("span");
  labelNode.className = "za-agent-tool-event-label";
  let label: string;
  if (event.status === "running") {
    const base = getString(getToolEventLabelID(toolKind, "running")).replace(
      /\.+$/,
      "",
    );
    const dots = ".".repeat(runtime.waitingStep + 1);
    label = `${base}${dots}`;
  } else if (event.status === "done") {
    label = getString(getToolEventLabelID(toolKind, "done"));
  } else {
    label = getString(getToolEventLabelID(toolKind, "failed"));
  }
  labelNode.textContent = label;
  row.append(labelNode);

  const elapsedMs =
    event.status === "running"
      ? Date.now() - event.startedAt
      : (event.finishedAt ?? event.startedAt) - event.startedAt;
  const meta = doc.createElement("span");
  meta.className = "za-agent-tool-event-meta";
  meta.textContent = getString("agent-tool-event-elapsed", {
    args: { seconds: formatWaitSeconds(elapsedMs) },
  });
  row.append(meta);
  bubble.append(row);

  if (event.status === "failed" && event.errorMessage) {
    const detail = doc.createElement("div");
    detail.className = "za-agent-tool-event-detail";
    const text = doc.createElement("span");
    text.className = "za-agent-tool-event-detail-text";
    text.textContent = event.errorMessage;
    const copyButton = createInlineCopyButton(
      doc,
      () => event.errorMessage || "",
    );
    detail.append(text, copyButton);
    bubble.append(detail);
  }

  return bubble;
}

function createMessageMeta(doc: Document, message: RuntimeMessage) {
  const meta = doc.createElement("div");
  meta.className = "za-agent-message-meta";
  const parts = [formatMessageDateTime(message.createdAt)];
  if (
    message.role === "assistant" &&
    typeof message.responseWaitMs === "number" &&
    Number.isFinite(message.responseWaitMs)
  ) {
    parts.push(
      getString("agent-meta-response-wait", {
        args: {
          seconds: formatWaitSeconds(message.responseWaitMs),
        },
      }),
    );
  }
  meta.textContent = parts.join(" · ");
  return meta;
}

function formatMessageDateTime(timestamp: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
  }
}

function formatWaitSeconds(durationMs: number) {
  const seconds = Math.max(0, durationMs) / 1000;
  return seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1);
}

function formatTokenCount(count: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(count);
  } catch {
    return String(Math.round(count));
  }
}

function recordDiagnostic(
  level: DiagnosticEntry["level"],
  message: string,
  detail?: string,
) {
  runtime.diagnostics.push({
    id: createRuntimeID("diag"),
    level,
    createdAt: Date.now(),
    message,
    detail,
  });
  if (runtime.diagnostics.length > MAX_DIAGNOSTIC_ENTRIES) {
    runtime.diagnostics = runtime.diagnostics.slice(-MAX_DIAGNOSTIC_ENTRIES);
  }
}

function createSessionControls(
  doc: Document,
  scopeKey: string,
  conversation: ConversationState,
) {
  const row = doc.createElement("div");
  row.className = "za-agent-session-row";
  const allConversations = getConversationsForScope(scopeKey);
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
    selectConversation(scopeKey, select.value);
    runtime.shouldAutoScroll = true;
    void refreshAllSections();
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
    startNewConversation(scopeKey);
    runtime.shouldAutoScroll = true;
    void refreshAllSections();
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
    clearConversationMessages(conversation.key);
    runtime.shouldAutoScroll = true;
    void refreshAllSections();
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
    deleteConversation(scopeKey, conversation.key);
    runtime.shouldAutoScroll = true;
    void refreshAllSections();
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
    exportConversationToClipboard(conversation);
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
    renameConversation(doc, conversation);
    void refreshAllSections();
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
    flushConversationStore();
    void refreshAllSections();
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

function limitConversationOptions(
  conversations: ConversationState[],
  activeConversationKey: string,
) {
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

function formatConversationOptionLabel(conversation: ConversationState) {
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

function exportConversationToClipboard(conversation: ConversationState) {
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
  const text = lines.join("\n");
  try {
    const win = Zotero.getMainWindow();
    if (win?.navigator?.clipboard) {
      void win.navigator.clipboard.writeText(text);
    }
  } catch {
    // Ignore clipboard errors
  }
  showToast(getString("agent-export-copied"));
}

function renameConversation(doc: Document, conversation: ConversationState) {
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
  flushConversationStore();
}

function showToast(message: string) {
  try {
    const win = Zotero.getMainWindow();
    if (!win) {
      return;
    }
    const indicator = win.document?.getElementById("zotero-catsync-indicator");
    if (indicator) {
      // Use Zotero's built-in status message if available
    }
    // Simple fallback: log to console
    Zotero.log(`[Zotero-Cat] ${message}`);
  } catch {
    // Ignore
  }
}

function createContextToggle(
  doc: Document,
  labelKey:
    | "agent-context-metadata"
    | "agent-context-notes"
    | "agent-context-annotations"
    | "agent-context-selected-text"
    | "agent-web-search-toggle"
    | "agent-pdf-tools-toggle"
    | "agent-pdf-tools-auto-apply",
  checked: boolean,
  disabled: boolean,
  onChange: (value: boolean) => void,
) {
  const label = doc.createElement("label");
  label.className = "za-agent-context-toggle";
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.disabled = disabled;
  checkbox.addEventListener("change", () => {
    onChange(checkbox.checked);
  });
  const text = doc.createElement("span");
  text.textContent = getString(labelKey);
  label.append(checkbox, text);
  return label;
}

function createDiagnosticsPanel(doc: Document) {
  const details = doc.createElement("details");
  details.className = "za-agent-diagnostics";
  details.open = runtime.diagnosticsOpen;
  details.addEventListener("toggle", () => {
    runtime.diagnosticsOpen = details.open;
  });

  const summary = doc.createElement("summary");
  summary.className = "za-agent-diagnostics-summary";

  const title = doc.createElement("span");
  title.className = "za-agent-diagnostics-title";
  title.textContent = getString("agent-diagnostics-title");

  const count = doc.createElement("span");
  count.className = "za-agent-diagnostics-count";
  count.textContent = String(runtime.diagnostics.length);
  summary.append(title, count);

  const body = doc.createElement("div");
  body.className = "za-agent-diagnostics-body";
  if (!runtime.diagnostics.length) {
    const empty = doc.createElement("div");
    empty.className = "za-agent-diagnostics-empty";
    empty.textContent = getString("agent-diagnostics-empty");
    body.appendChild(empty);
  } else {
    const clearButton = doc.createElement("button");
    clearButton.className = "za-agent-secondary-button";
    clearButton.type = "button";
    clearButton.textContent = getString("agent-diagnostics-clear");
    clearButton.addEventListener("click", () => {
      runtime.diagnostics = [];
      void refreshAllSections();
    });
    body.appendChild(clearButton);
    for (const entry of runtime.diagnostics.slice().reverse()) {
      const item = doc.createElement("div");
      item.className = "za-agent-diagnostic-entry";
      item.dataset.level = entry.level;

      const meta = doc.createElement("div");
      meta.className = "za-agent-diagnostic-meta";
      meta.textContent = `${formatMessageDateTime(entry.createdAt)} · ${entry.level}`;

      const message = doc.createElement("div");
      message.className = "za-agent-diagnostic-message";
      message.textContent = entry.message;
      item.append(meta, message);

      if (entry.detail) {
        const detail = doc.createElement("pre");
        detail.className = "za-agent-diagnostic-detail";
        detail.textContent = entry.detail;
        item.appendChild(detail);
      }
      body.appendChild(item);
    }
  }

  details.append(summary, body);
  return details;
}

function createCustomContextInput(doc: Document, customContextKey: string) {
  const container = doc.createElement("details");
  container.className = "za-agent-custom-context";
  container.open = runtime.customContextOpen;
  container.addEventListener("toggle", () => {
    runtime.customContextOpen = container.open;
  });

  const summary = doc.createElement("summary");
  summary.className = "za-agent-custom-context-summary";

  const label = doc.createElement("span");
  label.className = "za-agent-custom-context-title";
  label.textContent = getString("agent-custom-context-label");

  const currentContext = getCustomContextForKey(customContextKey);
  summary.appendChild(label);
  if (currentContext.trim()) {
    const status = doc.createElement("span");
    status.className = "za-agent-custom-context-status";
    status.textContent = getString("agent-custom-context-filled");
    summary.appendChild(status);
  }

  const textarea = doc.createElement("textarea");
  textarea.className = "za-agent-custom-context-input";
  textarea.placeholder = getString("agent-custom-context-placeholder");
  textarea.value = currentContext;
  textarea.disabled = runtime.sending;
  textarea.rows = 3;
  textarea.addEventListener("input", () => {
    setCustomContextForKey(customContextKey, textarea.value);
  });
  textarea.addEventListener("change", () => {
    setCustomContextForKey(customContextKey, textarea.value);
    void refreshAllSections();
  });
  textarea.addEventListener("blur", () => {
    setCustomContextForKey(customContextKey, textarea.value);
    void refreshAllSections();
  });

  container.append(summary, textarea);
  return container;
}

function createContextPreview(
  doc: Document,
  item: Zotero.Item | null,
  modelRef: { providerID: string; baseURL: string; model: string },
  customContextKey: string,
) {
  const modelContextWindow = resolveModelContextWindow(
    modelRef.providerID,
    modelRef.baseURL,
    modelRef.model,
  );
  const preview = buildContextPreview({
    item,
    contextOptions: runtime.contextOptions,
    templateID: runtime.templateID,
    customContext: getCustomContextForKey(customContextKey),
    modelContextWindow,
  });
  const details = doc.createElement("details");
  details.className = "za-agent-context-preview";
  details.open = runtime.contextPreviewOpen;
  details.addEventListener("toggle", () => {
    runtime.contextPreviewOpen = details.open;
  });

  const summary = doc.createElement("summary");
  summary.className = "za-agent-context-preview-summary";

  const title = doc.createElement("span");
  title.className = "za-agent-context-preview-title";
  title.textContent = getString("agent-context-preview-title");

  const budgets = doc.createElement("span");
  budgets.className = "za-agent-context-budgets";

  const injectionBudget = doc.createElement("span");
  injectionBudget.className = "za-agent-context-budget";
  injectionBudget.textContent = getString("agent-context-preview-budget", {
    args: {
      used: formatTokenCount(preview.estimatedTokens),
      budget: formatTokenCount(preview.tokenBudget),
    },
  });
  if (preview.truncated || preview.estimatedTokens > preview.tokenBudget) {
    injectionBudget.dataset.kind = "warning";
  }

  const modelLimit = doc.createElement("span");
  modelLimit.className = "za-agent-context-budget";
  modelLimit.textContent = getString("agent-context-preview-model-limit", {
    args: {
      limit: modelContextWindow
        ? `${formatTokenCount(modelContextWindow)} tokens`
        : getString("agent-context-preview-model-limit-unknown"),
    },
  });
  if (!modelContextWindow) {
    modelLimit.dataset.kind = "muted";
  }
  budgets.append(injectionBudget, modelLimit);
  summary.append(title, budgets);

  const body = doc.createElement("div");
  body.className = "za-agent-context-preview-body";
  const readonlyNote = doc.createElement("div");
  readonlyNote.className = "za-agent-context-preview-note";
  readonlyNote.textContent = getString("agent-context-preview-readonly");
  body.appendChild(readonlyNote);
  if (!preview.hasZoteroContext) {
    const empty = doc.createElement("div");
    empty.className = "za-agent-context-preview-note";
    empty.textContent = getString("agent-context-preview-system-only");
    body.appendChild(empty);
  }
  if (preview.truncated) {
    const warning = doc.createElement("div");
    warning.className = "za-agent-context-preview-note";
    warning.dataset.kind = "warning";
    warning.textContent = getString("agent-context-preview-truncated");
    body.appendChild(warning);
  }

  const text = doc.createElement("pre");
  text.className = "za-agent-context-preview-text";
  text.textContent = preview.text || getString("agent-context-preview-empty");
  body.appendChild(text);
  details.append(summary, body);
  return details;
}

function createCopyButton(doc: Document, messageContent: string) {
  const button = doc.createElement("button");
  button.className = "za-agent-copy";
  const defaultLabel = getString("agent-copy-tooltip");
  button.title = defaultLabel;
  button.setAttribute("aria-label", defaultLabel);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const copied = await copyMessageText(messageContent);
    if (!copied) {
      return;
    }
    showCopyFeedback(doc, getString("agent-copied-feedback"));
    button.classList.add("is-copied");
    const copiedLabel = getString("agent-copied-tooltip");
    button.title = copiedLabel;
    button.setAttribute("aria-label", copiedLabel);
    const view = doc.defaultView;
    view?.setTimeout(() => {
      button.classList.remove("is-copied");
      button.title = defaultLabel;
      button.setAttribute("aria-label", defaultLabel);
    }, 900);
  });
  return button;
}

async function copyMessageText(text: string) {
  return copyTextToClipboard(text);
}
