import { assert } from "chai";
import type { AgentMessage } from "../src/modules/agent/types";
import { serializeMessageForChat } from "../src/modules/agent/functionCalling/messageShape";
import { defaultProviderQuirks } from "../src/modules/agent/functionCalling/quirks";

function quirksWith(
  overrides: Partial<ReturnType<typeof defaultProviderQuirks>>,
) {
  return { ...defaultProviderQuirks(), ...overrides };
}

describe("functionCalling/messageShape", function () {
  it("serializes a user message untouched", function () {
    const result = serializeMessageForChat({ role: "user", content: "hi" });
    assert.deepEqual(result, { role: "user", content: "hi" });
  });

  it("serializes a tool message with tool_call_id and content", function () {
    const message: AgentMessage = {
      role: "tool",
      content: "page text",
      toolCallId: "call_1",
      toolName: "read_pdf",
    };
    const result = serializeMessageForChat(message);
    assert.deepEqual(result, {
      role: "tool",
      tool_call_id: "call_1",
      content: "page text",
    });
  });

  it("serializes an assistant tool_calls turn and skips reasoning_content by default", function () {
    const message: AgentMessage = {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_1",
          name: "read_pdf",
          arguments: '{"fromPage": 3}',
        },
      ],
    };
    const result = serializeMessageForChat(message) as Record<string, unknown>;
    assert.equal(result.role, "assistant");
    assert.equal(result.content, "");
    assert.isArray(result.tool_calls);
    assert.isUndefined(result.reasoning_content);
  });

  it("echoes captured reasoning_content when echo is enabled", function () {
    const message: AgentMessage = {
      role: "assistant",
      content: "answer",
      reasoningContent: "internal thinking",
    };
    const result = serializeMessageForChat(message, {
      quirks: quirksWith({ echoReasoningContent: true }),
    }) as Record<string, unknown>;
    assert.equal(result.reasoning_content, "internal thinking");
  });

  it("applies the empty-string fallback when echo is enabled and nothing is captured", function () {
    const message: AgentMessage = {
      role: "assistant",
      content: "answer",
    };
    const result = serializeMessageForChat(message, {
      quirks: quirksWith({
        echoReasoningContent: true,
        reasoningContentEmptyPolicy: "empty",
      }),
    }) as Record<string, unknown>;
    assert.equal(result.reasoning_content, "");
  });

  it("falls back to a single space when the empty policy is space", function () {
    const message: AgentMessage = {
      role: "assistant",
      content: "answer",
    };
    const result = serializeMessageForChat(message, {
      quirks: quirksWith({
        echoReasoningContent: true,
        reasoningContentEmptyPolicy: "space",
      }),
    }) as Record<string, unknown>;
    assert.equal(result.reasoning_content, " ");
  });

  it("omits the field entirely when the empty policy is omit", function () {
    const message: AgentMessage = {
      role: "assistant",
      content: "answer",
    };
    const result = serializeMessageForChat(message, {
      quirks: quirksWith({
        echoReasoningContent: true,
        reasoningContentEmptyPolicy: "omit",
      }),
    }) as Record<string, unknown>;
    assert.isUndefined(result.reasoning_content);
  });

  it("echoes reasoning_content on assistant tool_calls turns when enabled", function () {
    const message: AgentMessage = {
      role: "assistant",
      content: "",
      reasoningContent: "weighing tools",
      toolCalls: [
        {
          id: "call_1",
          name: "list_annotations",
          arguments: "{}",
        },
      ],
    };
    const result = serializeMessageForChat(message, {
      quirks: quirksWith({ echoReasoningContent: true }),
    }) as Record<string, unknown>;
    assert.equal(result.reasoning_content, "weighing tools");
    assert.isArray(result.tool_calls);
  });

  it("never echoes reasoning_content on user or system messages", function () {
    const result = serializeMessageForChat(
      { role: "user", content: "hi" },
      { quirks: quirksWith({ echoReasoningContent: true }) },
    ) as Record<string, unknown>;
    assert.isUndefined(result.reasoning_content);
  });
});
