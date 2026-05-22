// Single-turn function-calling runner.
//
// Wraps `provider.chat` so that:
//   - The active ProviderQuirks for the endpoint are resolved + applied
//     consistently before every request.
//   - Recoverable provider 400s (reasoning_content must be echoed, native
//     tool_calls unsupported) are caught exactly once, the matching quirk is
//     persisted in the central registry, and the call is retried with the
//     updated quirks. There is no second silent retry beyond that.
//   - The caller observes recovery through `onDiagnostic`, so the UI can
//     surface a single diagnostic line per observed quirk.
//
// The runner intentionally stays single-turn: tool execution + multi-turn
// follow-up coordination belongs to the caller (section.ts), which owns UI
// state, proposal batches, and pause-for-user-confirmation semantics. The
// runner just removes the chat-call + quirk-recovery boilerplate.

import type { AgentMessage, AssistantToolCall } from "../types";
import type {
  ChatOptions,
  ChatProvider,
  ChatToolChoice,
  ChatToolSpec,
} from "../provider";
import type { ReasoningEffortValue } from "../modelMetadata";
import {
  ReasoningContentRequiredError,
  ToolsNotSupportedError,
} from "./errors";
import {
  getQuirksForEndpoint,
  rememberNativeToolsUnsupported,
  rememberReasoningContentEcho,
  type ProviderQuirks,
} from "./quirks";

export type RunnerDiagnostic =
  | {
      kind: "reasoning-content-required";
      message: string;
    }
  | {
      kind: "native-tools-unsupported";
      message: string;
    };

export interface RunAssistantTurnInput {
  provider: ChatProvider;
  messages: AgentMessage[];
  endpointKey: string;
  baseURL?: string;
  tools?: ChatToolSpec[];
  toolChoice?: ChatToolChoice;
  reasoningEffort?: ReasoningEffortValue;
  onCanceller?: ChatOptions["onCanceller"];
  onStreamDelta?: ChatOptions["onStreamDelta"];
  onToolCallStarted?: ChatOptions["onToolCallStarted"];
  onDiagnostic?: (event: RunnerDiagnostic) => void;
}

export interface AssistantTurnReply {
  content: string;
  reasoningContent?: string;
  toolCalls: AssistantToolCall[];
  finishReason: string;
  quirks: ProviderQuirks;
}

export async function runAssistantTurn(
  input: RunAssistantTurnInput,
): Promise<AssistantTurnReply> {
  let quirks = getQuirksForEndpoint(input.endpointKey, input.baseURL);
  const wantsTools = Boolean(input.tools?.length);
  let attempt = 0;
  while (true) {
    attempt += 1;
    const useNativeTools = wantsTools && !quirks.nativeToolsUnsupported;
    const chatOptions: ChatOptions = {
      reasoningEffort: input.reasoningEffort,
      tools: useNativeTools ? input.tools : undefined,
      toolChoice: useNativeTools ? input.toolChoice || "auto" : undefined,
      quirks,
      onCanceller: input.onCanceller,
      onStreamDelta: input.onStreamDelta,
      onToolCallStarted: input.onToolCallStarted,
    };
    try {
      const reply = await input.provider.chat(input.messages, chatOptions);
      return {
        content: reply.content,
        reasoningContent: reply.reasoningContent,
        toolCalls: reply.toolCalls,
        finishReason: reply.finishReason,
        quirks,
      };
    } catch (error) {
      if (
        error instanceof ReasoningContentRequiredError &&
        !quirks.echoReasoningContent &&
        attempt <= 2
      ) {
        quirks = rememberReasoningContentEcho(input.endpointKey, input.baseURL);
        input.onDiagnostic?.({
          kind: "reasoning-content-required",
          message: error.message,
        });
        continue;
      }
      if (
        error instanceof ToolsNotSupportedError &&
        useNativeTools &&
        !quirks.nativeToolsUnsupported &&
        attempt <= 2
      ) {
        quirks = rememberNativeToolsUnsupported(
          input.endpointKey,
          input.baseURL,
        );
        input.onDiagnostic?.({
          kind: "native-tools-unsupported",
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }
}
