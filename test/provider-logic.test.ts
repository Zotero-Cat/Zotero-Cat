import { assert } from "chai";
import {
  isApiKeyRequiredForProvider,
  providerTestUtils,
} from "../src/modules/agent/provider";

describe("provider logic", function () {
  it("should allow providers without API key", function () {
    assert.isFalse(isApiKeyRequiredForProvider("ollama"));
    assert.isFalse(isApiKeyRequiredForProvider("OLLAMA"));
    assert.isTrue(isApiKeyRequiredForProvider("openai"));
  });

  it("should keep both streaming and non-streaming attempts", function () {
    const attempts = providerTestUtils.buildEndpointAttempts(
      "https://api.example.com/v1",
      null,
    );
    const baseAttempts = attempts.filter(
      (attempt) =>
        attempt.endpoint === "https://api.example.com/v1" &&
        attempt.wireAPI === "chat-completions",
    );
    assert.lengthOf(baseAttempts, 2);
    assert.deepEqual(baseAttempts.map((attempt) => attempt.stream).sort(), [
      false,
      true,
    ]);
  });

  it("should fallback when stream mode is unsupported", function () {
    const fallback = providerTestUtils.canFallbackWithMessage(
      true,
      0,
      2,
      "400 Bad Request: stream is not supported by this endpoint",
    );
    assert.isTrue(fallback);
  });

  it("should not fallback for invalid api key", function () {
    const fallback = providerTestUtils.canFallbackWithMessage(
      true,
      0,
      2,
      "401 INVALID_API_KEY: invalid api key",
    );
    assert.isFalse(fallback);
  });

  it("should fallback for non-json response when next attempt exists", function () {
    assert.isTrue(providerTestUtils.canFallbackForNonJSON(true, 0, 2));
    assert.isFalse(providerTestUtils.canFallbackForNonJSON(true, 1, 2));
  });

  it("should parse stream deltas from common payload shapes", function () {
    assert.equal(providerTestUtils.extractStreamDelta({ delta: "A" }), "A");
    assert.equal(
      providerTestUtils.extractStreamDelta({
        choices: [{ delta: { content: "B" } }],
      }),
      "B",
    );
    assert.equal(
      providerTestUtils.extractStreamDelta({
        choices: [{ delta: { content: [{ text: "C1" }, { text: "C2" }] } }],
      }),
      "C1C2",
    );
    assert.equal(
      providerTestUtils.extractStreamDelta({
        item: { type: "response.output_text.delta", delta: "D" },
      }),
      "D",
    );
    assert.equal(
      providerTestUtils.extractStreamDelta({
        type: "response.output_text.delta",
        delta: "E",
      }),
      "E",
    );
  });

  it("should use idle response timeout instead of a short HTTP wall timeout", function () {
    const config = providerTestUtils.getChatTimeoutConfig();
    assert.equal(config.httpTimeoutMs, 0);
    assert.isAtLeast(config.responseIdleTimeoutMs, 300_000);
  });

  it("should attach reasoning effort payload and keep compatibility fallback", function () {
    const responsesPayloads = providerTestUtils.buildPayloadVariants(
      "responses",
      "high",
      false,
    );
    assert.lengthOf(responsesPayloads, 2);
    assert.deepEqual((responsesPayloads[0] as any).reasoning, {
      effort: "high",
    });
    assert.isUndefined((responsesPayloads[1] as any).reasoning);

    const chatPayloads = providerTestUtils.buildPayloadVariants(
      "chat-completions",
      "minimal",
      false,
    );
    assert.lengthOf(chatPayloads, 2);
    assert.equal((chatPayloads[0] as any).reasoning_effort, "minimal");
    assert.isUndefined((chatPayloads[1] as any).reasoning_effort);
  });

  it("includes tools and tool_choice in chat-completions payload when provided", function () {
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "read_pdf",
          description: "Read PDF",
          parameters: { type: "object", properties: {} },
        },
      },
    ];
    const payload = providerTestUtils.buildChatPayload(
      [{ role: "user", content: "hi" }],
      tools,
      "auto",
    ) as any;
    assert.deepEqual(payload.tools, tools);
    assert.equal(payload.tool_choice, "auto");
    assert.isUndefined(
      providerTestUtils.buildChatPayload([{ role: "user", content: "hi" }])
        .tools,
    );
  });

  it("serializes assistant tool_calls and tool-role messages for the chat API", function () {
    const payload = providerTestUtils.buildChatPayload([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_1",
            name: "read_pdf",
            arguments: '{"fromPage": 3}',
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        toolName: "read_pdf",
        content: "page 3 text...",
      },
    ]) as any;
    const messages = payload.messages as any[];
    assert.equal(messages[0].role, "assistant");
    assert.equal(messages[0].tool_calls[0].id, "call_1");
    assert.equal(messages[0].tool_calls[0].function.name, "read_pdf");
    assert.equal(
      messages[0].tool_calls[0].function.arguments,
      '{"fromPage": 3}',
    );
    assert.equal(messages[1].role, "tool");
    assert.equal(messages[1].tool_call_id, "call_1");
    assert.equal(messages[1].content, "page 3 text...");
  });

  it("reconstructs assistant tool_calls from streamed SSE events", function () {
    const events: Record<string, unknown>[] = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_xyz",
                  function: { name: "read_pdf", arguments: "" },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"fromP' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'age": 4}' } }],
            },
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
      },
    ];
    const parsed = providerTestUtils.parseStreamEvents(events);
    assert.equal(parsed.text, "");
    assert.equal(parsed.finishReason, "tool_calls");
    assert.lengthOf(parsed.toolCalls, 1);
    assert.equal(parsed.toolCalls[0].id, "call_xyz");
    assert.equal(parsed.toolCalls[0].name, "read_pdf");
    assert.equal(parsed.toolCalls[0].arguments, '{"fromPage": 4}');
  });

  it("extracts tool_calls from a non-streaming chat response", function () {
    const calls = providerTestUtils.extractResponseToolCalls({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: "",
            tool_calls: [
              {
                id: "call_42",
                type: "function",
                function: {
                  name: "list_annotations",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    });
    assert.lengthOf(calls, 1);
    assert.equal(calls[0].name, "list_annotations");
    assert.equal(calls[0].arguments, "{}");
    assert.equal(
      providerTestUtils.extractFinishReason({
        choices: [{ finish_reason: "tool_calls" }],
      }),
      "tool_calls",
    );
  });

  it("recognizes tool-unsupported error messages so the loop can fall back", function () {
    assert.isTrue(
      providerTestUtils.isToolsUnsupportedErrorMessage(
        "Unsupported parameter: tools",
      ),
    );
    assert.isTrue(
      providerTestUtils.isToolsUnsupportedErrorMessage(
        "Unknown parameter: tool_choice",
      ),
    );
    assert.isFalse(
      providerTestUtils.isToolsUnsupportedErrorMessage("Invalid API key"),
    );
  });

  it("accumulates reasoning_content from streamed deltas", function () {
    const events: Record<string, unknown>[] = [
      {
        choices: [
          {
            delta: { reasoning_content: "step 1 " },
          },
        ],
      },
      {
        choices: [
          {
            delta: { reasoning_content: "step 2 done" },
          },
        ],
      },
      {
        choices: [
          {
            delta: { content: "Final answer" },
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: "stop" }],
      },
    ];
    const parsed = providerTestUtils.parseStreamEvents(events);
    assert.equal(parsed.text, "Final answer");
    assert.equal(parsed.reasoningContent, "step 1 step 2 done");
    assert.equal(parsed.finishReason, "stop");
  });

  it("extracts reasoning_content from a non-streaming chat response", function () {
    const value = providerTestUtils.extractResponseReasoningContent({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: "ok",
            reasoning_content: "internal thinking",
          },
        },
      ],
    });
    assert.equal(value, "internal thinking");
  });

  it("omits reasoning_content from assistant payload by default", function () {
    const payload = providerTestUtils.buildChatPayload([
      {
        role: "assistant",
        content: "hello",
        reasoningContent: "internal thinking",
      },
      { role: "user", content: "again" },
    ]) as { messages: Array<Record<string, unknown>> };
    assert.equal(payload.messages[0].role, "assistant");
    assert.isUndefined(payload.messages[0].reasoning_content);
  });

  it("echoes reasoning_content on assistant messages when enabled", function () {
    const payload = providerTestUtils.buildChatPayload(
      [
        {
          role: "assistant",
          content: "hello",
          reasoningContent: "internal thinking",
        },
        { role: "user", content: "again" },
      ],
      undefined,
      undefined,
      true,
    ) as { messages: Array<Record<string, unknown>> };
    assert.equal(payload.messages[0].reasoning_content, "internal thinking");
  });

  it("emits empty reasoning_content when echo is enabled but none was captured", function () {
    const payload = providerTestUtils.buildChatPayload(
      [
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ],
      undefined,
      undefined,
      true,
    ) as { messages: Array<Record<string, unknown>> };
    assert.equal(payload.messages[0].reasoning_content, "");
  });

  it("echoes reasoning_content alongside assistant tool_calls when enabled", function () {
    const payload = providerTestUtils.buildChatPayload(
      [
        {
          role: "assistant",
          content: "",
          reasoningContent: "considering tools",
          toolCalls: [
            {
              id: "call_1",
              name: "read_pdf",
              arguments: '{"fromPage": 1}',
            },
          ],
        },
      ],
      undefined,
      undefined,
      true,
    ) as { messages: Array<Record<string, unknown>> };
    const first = payload.messages[0] as Record<string, unknown>;
    assert.equal(first.role, "assistant");
    assert.equal(first.reasoning_content, "considering tools");
    assert.isArray(first.tool_calls);
  });

  it("recognizes reasoning_content-required error messages", function () {
    assert.isTrue(
      providerTestUtils.isReasoningContentRequiredErrorMessage(
        "The reasoning_content in the thinking mode must be passed back to the API.",
      ),
    );
    assert.isTrue(
      providerTestUtils.isReasoningContentRequiredErrorMessage(
        "reasoning_content is required for thinking-mode follow-ups",
      ),
    );
    assert.isTrue(
      providerTestUtils.isReasoningContentRequiredErrorMessage(
        "缺失 reasoning_content 字段",
      ),
    );
    assert.isFalse(
      providerTestUtils.isReasoningContentRequiredErrorMessage(
        "Unsupported parameter: tools",
      ),
    );
    assert.isFalse(
      providerTestUtils.isReasoningContentRequiredErrorMessage(
        "Invalid API key",
      ),
    );
  });
});
