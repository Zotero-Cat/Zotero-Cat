import {
  loadConversationFileStore,
  saveConversationFileStore,
} from "../conversationFileStore";
import { applyConversationStoreToRuntime } from "../conversationRuntime";
import { recordDiagnostic } from "./diagnostics";
import type { AgentRuntime } from "./state";

export const CONVERSATION_STORE_SAVE_DELAY_MS = 1200;

export interface ConversationStoreServiceDeps {
  refreshAllSections: () => Promise<void>;
  formatError: (error: unknown) => string;
}

export function ensureConversationStoreLoaded(
  runtime: AgentRuntime,
  deps: ConversationStoreServiceDeps,
): void {
  if (runtime.conversationStoreLoaded || runtime.conversationStoreLoading) {
    return;
  }
  runtime.conversationStoreLoading = true;
  void loadConversationFileStore()
    .then((store) => {
      if (runtime.conversationStoreLoaded) {
        return;
      }
      applyConversationStoreToRuntime(runtime, store);
      runtime.conversationStoreLoaded = true;
    })
    .catch((error) => {
      recordDiagnostic(
        runtime,
        "error",
        "Failed to load conversation history",
        deps.formatError(error),
      );
      runtime.conversationStoreLoaded = true;
    })
    .finally(() => {
      runtime.conversationStoreLoading = false;
      void deps.refreshAllSections();
    });
}

export function flushConversationStore(
  runtime: AgentRuntime,
  deps: ConversationStoreServiceDeps,
): void {
  if (runtime.conversationStoreSaveTimer) {
    clearTimeout(runtime.conversationStoreSaveTimer);
    runtime.conversationStoreSaveTimer = null;
  }
  void writeConversationStoreNow(runtime, deps);
}

export function scheduleConversationStoreSave(
  runtime: AgentRuntime,
  deps: ConversationStoreServiceDeps,
): void {
  if (runtime.conversationStoreSaveTimer) {
    return;
  }
  runtime.conversationStoreSaveTimer = setTimeout(() => {
    runtime.conversationStoreSaveTimer = null;
    void writeConversationStoreNow(runtime, deps);
  }, CONVERSATION_STORE_SAVE_DELAY_MS);
}

export async function writeConversationStoreNow(
  runtime: AgentRuntime,
  deps: ConversationStoreServiceDeps,
): Promise<void> {
  ensureConversationStoreLoaded(runtime, deps);
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
      runtime,
      "error",
      "Failed to save conversation history",
      deps.formatError(error),
    );
  }
}
