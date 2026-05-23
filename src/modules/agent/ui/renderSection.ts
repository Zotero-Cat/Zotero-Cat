import { getPref, setPref } from "../../../utils/prefs";
import type { AgentContextOptions } from "../context";
import type { AgentMessage } from "../types";
import type { AgentRuntime } from "../runtime/state";
import type { ConversationState } from "../conversationStore";
import type { ReasoningEffortValue } from "../modelMetadata";
import {
  getDefaultModelForProvider,
  normalizeProviderID,
  normalizeReasoningEffort,
  normalizeString,
  resolveModelOptions,
} from "../modelMetadata";
import {
  resolveRuntimeReasoningOptions,
  syncReasoningEffortPref,
  cacheModelInfos,
} from "../modelMetadataRuntime";
import { fetchModelsFromCurrentProvider } from "../modelListFetch";
import {
  getModelsFetchedMessage,
  formatModelFetchError,
  formatError,
} from "./labels";
import { summarizeModelMetadataAvailability } from "../modelMetadata";
import { beginUserTurn } from "../runtime/userTurn";
import {
  isProviderConfigured,
  renderConversationStoreLoading,
  renderProviderGate,
} from "./sectionGates";
import { renderMessageList } from "./messageList";
import { createAgentControlPanel } from "./controlPanel";
import { createAgentComposer } from "./composer";
import { createSessionControls } from "./sessionControls";
import {
  applyRootDimensions,
  captureScrollState,
  ensureBodyResizeObserver,
  isNearBottom,
  restoreScrollPosition,
  scrollToBottom,
} from "./layout";
import {
  setProposalStatus,
  acceptAllPending,
  rejectAllPending,
  clearBatch,
  hasPendingBatch,
  type AnnotationBatch,
} from "../../tools/annotationProposals";
import {
  isPdfToolsAutoApplyPref,
  isPdfToolsEnabledPref,
} from "../../tools/annotationTools";
import { isWebSearchEnabledPref } from "../webSearchContext";
import { resolveConversationScopeKey } from "../itemScope";
import { openAgentPreferences } from "../../prefsPane";

export interface PreparedMessageOptions {
  requestMessages: AgentMessage[];
  item: Zotero.Item;
  contextOptions: AgentContextOptions;
  templateID: string;
  customContext: string;
  modelContextWindow: number | null;
  prompt: string;
}

export interface RenderSectionBodyDeps {
  runtime: AgentRuntime;
  ensureConversationStoreLoaded(): void;
  saveConversationStore(): void;
  flushConversationStore(): void;
  getActiveConversationForScope(scopeKey: string): ConversationState;
  getConversationsForScope(scopeKey: string): ConversationState[];
  startNewConversation(scopeKey: string): void;
  clearConversationMessages(conversationKey: string): void;
  selectConversation(scopeKey: string, conversationKey: string): void;
  deleteConversation(scopeKey: string, conversationKey: string): void;
  refreshAllSections(): Promise<void>;
  recordDiagnostic(
    level: "warning" | "error",
    message: string,
    detail?: string,
  ): void;
  requestCancel(): void;
  finishActiveRequest(conversationKey: string, requestToken: number): void;
  sendPreparedMessage(
    options: PreparedMessageOptions,
    conversationKey: string,
    assistantMessageIndex: number,
    requestToken: number,
    reasoningEffort: ReasoningEffortValue,
  ): Promise<void>;
  handleChatFailure(
    error: unknown,
    conversationKey: string,
    assistantMessageIndex: number,
  ): Promise<void>;
  maybeApplyResolvedBatch(conversationKey: string): void;
  applyBatchAndContinue(conversationKey: string, autoAcceptAll: boolean): void;
  rememberAnnotationOperationApprovals(batch: AnnotationBatch): void;
  getReasoningStatusText(
    providerID: string,
    baseURL: string,
    model: string,
  ): string;
  resolveModelContextWindow(
    providerID: string,
    baseURL: string,
    model: string,
  ): number | null;
  getAutomaticContextOptions(): AgentContextOptions;
}

export function renderSectionBody(
  body: HTMLDivElement,
  item: Zotero.Item,
  deps: RenderSectionBodyDeps,
) {
  const doc = body.ownerDocument;
  if (!doc) {
    return;
  }
  const { runtime } = deps;

  if (!isProviderConfigured()) {
    renderProviderGate(body, doc, {
      openPreferences: openAgentPreferences,
      onOpenPreferencesError: (error) => {
        deps.recordDiagnostic("error", formatError(error));
      },
    });
    return;
  }
  if (!runtime.conversationStoreLoaded) {
    deps.ensureConversationStoreLoaded();
    renderConversationStoreLoading(body, doc);
    return;
  }
  const conversationScopeKey = resolveConversationScopeKey(item);
  const conversation = deps.getActiveConversationForScope(conversationScopeKey);
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
        void deps.maybeApplyResolvedBatch(conversationKey);
      },
      onRejectProposal(id) {
        setProposalStatus(conversationKey, id, "rejected");
        void deps.maybeApplyResolvedBatch(conversationKey);
      },
      onAcceptAllProposals() {
        acceptAllPending(conversationKey);
        void deps.applyBatchAndContinue(conversationKey, false);
      },
      onAlwaysAllowProposals(batch) {
        deps.rememberAnnotationOperationApprovals(batch);
        acceptAllPending(conversationKey);
        void deps.applyBatchAndContinue(conversationKey, false);
      },
      onRejectAllProposals() {
        rejectAllPending(conversationKey);
        void deps.maybeApplyResolvedBatch(conversationKey);
      },
      onDismissProposals() {
        runtime.pendingToolFollowUp.delete(conversationKey);
        clearBatch(conversationKey);
        void deps.refreshAllSections();
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
  const reasoningOptions = resolveRuntimeReasoningOptions(
    runtime,
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
      reasoningStatusText: deps.getReasoningStatusText(
        providerID,
        baseURL,
        currentModel,
      ),
      sending: runtime.sending,
      templateID: runtime.templateID,
      webSearchEnabled: isWebSearchEnabledPref(),
    },
    {
      onModelChange(model) {
        const nextModel = normalizeString(model, currentModel);
        setPref("openaiModel", nextModel);
        syncReasoningEffortPref(
          resolveRuntimeReasoningOptions(
            runtime,
            providerID,
            baseURL,
            nextModel,
          ),
          normalizeReasoningEffort(getPref("openaiReasoningEffort")),
        );
        void deps.refreshAllSections();
      },
      onFetchModels() {
        if (runtime.sending || runtime.modelFetchBusy) {
          return;
        }
        runtime.modelFetchBusy = true;
        runtime.modelFetchStatusMessage = "";
        runtime.modelFetchStatusKind = "";
        void deps.refreshAllSections();
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
              resolveRuntimeReasoningOptions(
                runtime,
                providerID,
                baseURL,
                nextModel,
              ),
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
            deps.recordDiagnostic("error", message);
          })
          .finally(() => {
            runtime.modelFetchBusy = false;
            void deps.refreshAllSections();
          });
      },
      onReasoningChange(value) {
        setPref("openaiReasoningEffort", normalizeReasoningEffort(value));
        void deps.refreshAllSections();
      },
      onTemplateChange(templateID) {
        runtime.templateID = templateID;
        void deps.refreshAllSections();
      },
      onWebSearchChange(nextValue) {
        setPref("webSearchEnabled", nextValue);
        runtime.webSearchStatusMessage = "";
        runtime.webSearchStatusKind = "";
        void deps.refreshAllSections();
      },
      onPdfToolsChange(nextValue) {
        setPref("pdfToolsEnabled", nextValue);
        void deps.refreshAllSections();
      },
      onPdfToolsAutoApplyChange(nextValue) {
        setPref("pdfToolsAutoApply", nextValue);
        void deps.refreshAllSections();
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
      onStop: deps.requestCancel,
      onSubmit(prompt) {
        const turn = beginUserTurn(
          runtime,
          conversation,
          conversationKey,
          prompt,
        );
        const templateID = runtime.templateID;
        const contextOptions = deps.getAutomaticContextOptions();
        const modelContextWindow = deps.resolveModelContextWindow(
          providerID,
          baseURL,
          currentModel,
        );
        const requestReasoningEffort = syncReasoningEffortPref(
          resolveRuntimeReasoningOptions(
            runtime,
            providerID,
            baseURL,
            currentModel,
          ),
          normalizeReasoningEffort(getPref("openaiReasoningEffort")),
        );
        deps.saveConversationStore();
        void deps.refreshAllSections();
        void deps
          .sendPreparedMessage(
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
            await deps.handleChatFailure(
              error,
              conversationKey,
              turn.assistantMessageIndex,
            );
          })
          .finally(() => {
            deps.finishActiveRequest(conversationKey, turn.requestToken);
          });
      },
    },
  );
  const rootChildren: HTMLElement[] = [
    createSessionControls(doc, runtime, conversationScopeKey, conversation, {
      getConversationsForScope: deps.getConversationsForScope,
      startNewConversation: deps.startNewConversation,
      clearConversationMessages: deps.clearConversationMessages,
      selectConversation: deps.selectConversation,
      deleteConversation: deps.deleteConversation,
      flushConversationStore: deps.flushConversationStore,
      refreshAllSections: deps.refreshAllSections,
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
