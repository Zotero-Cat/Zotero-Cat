import type { AgentMessage } from "../types";
import type { PendingToolFollowUp } from "./state";

export function buildBatchFollowUpMessages(
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
