import { assert } from "chai";
import type { AgentMessage } from "../src/modules/agent/types";
import type {
  ChatOptions,
  ChatProvider,
  ChatResult,
} from "../src/modules/agent/provider";
import {
  ReasoningContentRequiredError,
  ToolsNotSupportedError,
} from "../src/modules/agent/functionCalling/errors";
import {
  buildEndpointKey,
  quirksTestUtils,
} from "../src/modules/agent/functionCalling/quirks";
import {
  runAssistantTurn,
  type RunnerDiagnostic,
} from "../src/modules/agent/functionCalling/runner";

interface RecordedCall {
  options: ChatOptions;
}

function makeProvider(
  outcomes: Array<ChatResult | Error>,
  recorded: RecordedCall[],
): ChatProvider {
  let cursor = 0;
  return {
    id: "mock-provider",
    async chat(_messages: AgentMessage[], options?: ChatOptions) {
      recorded.push({ options: options || {} });
      const outcome = outcomes[cursor++];
      if (!outcome) {
        throw new Error("provider has no more outcomes");
      }
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome;
    },
  };
}

function reply(overrides: Partial<ChatResult> = {}): ChatResult {
  return {
    content: "",
    toolCalls: [],
    finishReason: "stop",
    ...overrides,
  };
}

describe("functionCalling/runner", function () {
  beforeEach(function () {
    quirksTestUtils.reset();
  });

  it("returns the model reply when the provider succeeds on the first try", async function () {
    const recorded: RecordedCall[] = [];
    const provider = makeProvider(
      [reply({ content: "ok", finishReason: "stop" })],
      recorded,
    );
    const result = await runAssistantTurn({
      provider,
      messages: [{ role: "user", content: "hello" }],
      endpointKey: buildEndpointKey("openai", "https://api.example.com/v1"),
      baseURL: "https://api.example.com/v1",
    });
    assert.equal(result.content, "ok");
    assert.lengthOf(recorded, 1);
    assert.isFalse(recorded[0].options.quirks?.echoReasoningContent ?? false);
    assert.isFalse(recorded[0].options.quirks?.nativeToolsUnsupported ?? false);
  });

  it("retries with reasoning_content echo after observing the matching 400", async function () {
    const recorded: RecordedCall[] = [];
    const diagnostics: RunnerDiagnostic[] = [];
    const provider = makeProvider(
      [
        new ReasoningContentRequiredError(
          "The reasoning_content in the thinking mode must be passed back",
        ),
        reply({ content: "ok after retry" }),
      ],
      recorded,
    );
    const endpointKey = buildEndpointKey(
      "openai",
      "https://api.example.com/v1",
    );
    const result = await runAssistantTurn({
      provider,
      messages: [{ role: "user", content: "hi" }],
      endpointKey,
      baseURL: "https://api.example.com/v1",
      onDiagnostic: (event) => diagnostics.push(event),
    });
    assert.equal(result.content, "ok after retry");
    assert.lengthOf(recorded, 2);
    assert.isFalse(recorded[0].options.quirks?.echoReasoningContent ?? false);
    assert.isTrue(recorded[1].options.quirks?.echoReasoningContent ?? false);
    assert.lengthOf(diagnostics, 1);
    assert.equal(diagnostics[0].kind, "reasoning-content-required");
    assert.isTrue(result.quirks.echoReasoningContent);
  });

  it("falls back to no-tools after observing tools-not-supported", async function () {
    const recorded: RecordedCall[] = [];
    const diagnostics: RunnerDiagnostic[] = [];
    const provider = makeProvider(
      [
        new ToolsNotSupportedError("Unknown parameter: tools"),
        reply({ content: "fallback ok" }),
      ],
      recorded,
    );
    const result = await runAssistantTurn({
      provider,
      messages: [{ role: "user", content: "hi" }],
      endpointKey: buildEndpointKey("openai", "https://api.example.com/v1"),
      baseURL: "https://api.example.com/v1",
      tools: [
        {
          type: "function",
          function: { name: "read_pdf", description: "Read PDF" },
        },
      ],
      onDiagnostic: (event) => diagnostics.push(event),
    });
    assert.equal(result.content, "fallback ok");
    assert.lengthOf(recorded, 2);
    assert.isArray(recorded[0].options.tools);
    assert.isUndefined(recorded[1].options.tools);
    assert.equal(diagnostics[0].kind, "native-tools-unsupported");
    assert.isTrue(result.quirks.nativeToolsUnsupported);
  });

  it("does not retry a reasoning_content error a second time", async function () {
    const recorded: RecordedCall[] = [];
    const provider = makeProvider(
      [
        new ReasoningContentRequiredError("first 400"),
        new ReasoningContentRequiredError("second 400"),
      ],
      recorded,
    );
    let caught: unknown = null;
    try {
      await runAssistantTurn({
        provider,
        messages: [{ role: "user", content: "hi" }],
        endpointKey: buildEndpointKey("openai", "https://api.example.com/v1"),
        baseURL: "https://api.example.com/v1",
      });
    } catch (error) {
      caught = error;
    }
    assert.instanceOf(caught, ReasoningContentRequiredError);
    assert.lengthOf(recorded, 2);
  });

  it("rethrows unrecognized errors without retry", async function () {
    const recorded: RecordedCall[] = [];
    const provider = makeProvider([new Error("connection reset")], recorded);
    let caught: unknown = null;
    try {
      await runAssistantTurn({
        provider,
        messages: [{ role: "user", content: "hi" }],
        endpointKey: buildEndpointKey("openai", "https://api.example.com/v1"),
        baseURL: "https://api.example.com/v1",
      });
    } catch (error) {
      caught = error;
    }
    assert.instanceOf(caught, Error);
    assert.match((caught as Error).message, /connection reset/);
    assert.lengthOf(recorded, 1);
  });

  it("starts with echo on when the endpoint quirk was previously remembered", async function () {
    const recorded: RecordedCall[] = [];
    const endpointKey = buildEndpointKey(
      "deepseek",
      "https://api.deepseek.com/v1",
    );
    // Seed the registry as if a prior turn had observed the requirement.
    quirksTestUtils.reset();
    // Manually mark the endpoint by triggering an observed recovery first.
    const seedProvider = makeProvider(
      [
        new ReasoningContentRequiredError("must be passed back"),
        reply({ content: "seed" }),
      ],
      recorded,
    );
    await runAssistantTurn({
      provider: seedProvider,
      messages: [{ role: "user", content: "seed" }],
      endpointKey,
      baseURL: "https://api.deepseek.com/v1",
    });
    assert.lengthOf(recorded, 2);
    recorded.length = 0;

    // Subsequent call should already have echo on for the first attempt.
    const provider = makeProvider([reply({ content: "fast path" })], recorded);
    const result = await runAssistantTurn({
      provider,
      messages: [{ role: "user", content: "real" }],
      endpointKey,
      baseURL: "https://api.deepseek.com/v1",
    });
    assert.equal(result.content, "fast path");
    assert.lengthOf(recorded, 1);
    assert.isTrue(recorded[0].options.quirks?.echoReasoningContent);
    assert.equal(
      recorded[0].options.quirks?.reasoningContentEmptyPolicy,
      "space",
    );
  });

  it("preserves DeepSeek host-default empty policy across retries", async function () {
    const recorded: RecordedCall[] = [];
    const provider = makeProvider(
      [
        new ReasoningContentRequiredError("must be passed back"),
        reply({ content: "ok" }),
      ],
      recorded,
    );
    await runAssistantTurn({
      provider,
      messages: [{ role: "user", content: "hi" }],
      endpointKey: buildEndpointKey("deepseek", "https://api.deepseek.com/v1"),
      baseURL: "https://api.deepseek.com/v1",
    });
    assert.equal(
      recorded[1].options.quirks?.reasoningContentEmptyPolicy,
      "space",
    );
    assert.isTrue(recorded[1].options.quirks?.echoReasoningContent);
  });
});
