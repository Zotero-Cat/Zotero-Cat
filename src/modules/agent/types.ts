export type AgentRole = "system" | "user" | "assistant" | "tool";

export interface AssistantToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AgentMessage {
  role: AgentRole;
  content: string;
  toolCalls?: AssistantToolCall[];
  toolCallId?: string;
  toolName?: string;
  // Original reasoning_content from "thinking-mode" backends (DeepSeek-R1 /
  // Doubao / Qwen3-Thinking style). Some relays require it to be echoed back
  // in subsequent requests; others reject it. Captured here so the provider
  // can decide per-endpoint whether to serialize it.
  reasoningContent?: string;
}
