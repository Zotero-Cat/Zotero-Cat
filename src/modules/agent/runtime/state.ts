import type { AgentMessage, AssistantToolCall } from "../types";
import {
  ConversationRuntimeState,
  MessagePointer,
  createConversationRuntimeState,
} from "../conversationRuntime";
import type { ReasoningEffortValue } from "../modelMetadata";
import { DEFAULT_PROMPT_TEMPLATE_ID } from "../promptTemplates";

export interface DiagnosticEntry {
  id: string;
  level: "info" | "warning" | "error";
  createdAt: number;
  message: string;
  detail?: string;
}

export interface PendingToolFollowUp {
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

export interface AgentRuntime extends ConversationRuntimeState {
  conversationStoreLoaded: boolean;
  conversationStoreLoading: boolean;
  sending: boolean;
  workingConversationKey: string | null;
  streamingAssistant: MessagePointer | null;
  waitingAssistant: MessagePointer | null;
  waitingStartedAt: number | null;
  waitingToken: number;
  requestToken: number;
  cancelRequested: boolean;
  cancelActiveRequest: (() => void) | null;
  shouldAutoScroll: boolean;
  templateID: string;
  modelOptionsBySource: Map<string, string[]>;
  modelContextBySource: Map<string, Map<string, number>>;
  modelReasoningBySource: Map<string, Map<string, ReasoningEffortValue[]>>;
  modelFetchBusy: boolean;
  modelFetchStatusMessage: string;
  modelFetchStatusKind: "success" | "error" | "";
  webSearchStatusMessage: string;
  webSearchStatusKind: "success" | "error" | "";
  diagnostics: DiagnosticEntry[];
  refreshers: Map<string, () => Promise<void>>;
  pendingToolFollowUp: Map<string, PendingToolFollowUp>;
  activeToolEventByKey: Map<string, number>;
  latestToolEventByKey: Map<string, number>;
  approvedAnnotationOperationKeys: Set<string>;
  detectedToolActionByKey: Set<string>;
  pendingToolActionContentByMessage: Map<string, string>;
  conversationStoreSaveTimer: ReturnType<typeof setTimeout> | null;
}

export function createAgentRuntime(): AgentRuntime {
  return {
    ...createConversationRuntimeState(),
    conversationStoreLoaded: false,
    conversationStoreLoading: false,
    sending: false,
    workingConversationKey: null,
    streamingAssistant: null,
    waitingAssistant: null,
    waitingStartedAt: null,
    waitingToken: 0,
    requestToken: 0,
    cancelRequested: false,
    cancelActiveRequest: null,
    shouldAutoScroll: true,
    templateID: DEFAULT_PROMPT_TEMPLATE_ID,
    modelOptionsBySource: new Map(),
    modelContextBySource: new Map(),
    modelReasoningBySource: new Map(),
    modelFetchBusy: false,
    modelFetchStatusMessage: "",
    modelFetchStatusKind: "",
    webSearchStatusMessage: "",
    webSearchStatusKind: "",
    diagnostics: [],
    refreshers: new Map(),
    pendingToolFollowUp: new Map(),
    activeToolEventByKey: new Map(),
    latestToolEventByKey: new Map(),
    approvedAnnotationOperationKeys: new Set(),
    detectedToolActionByKey: new Set(),
    pendingToolActionContentByMessage: new Map(),
    conversationStoreSaveTimer: null,
  };
}
