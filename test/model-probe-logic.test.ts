import { assert } from "chai";
import { shouldRetryChatError } from "../src/modules/agent/chatRetry";
import {
  MAX_PERSISTED_CONVERSATIONS,
  MAX_PERSISTED_CONVERSATIONS_PER_SCOPE,
  MAX_PERSISTED_MESSAGE_CHARS,
  MAX_PERSISTED_MESSAGES_PER_CONVERSATION,
  parseConversationStore,
  selectConversationsForPersistence,
  serializeConversation,
  type ConversationState,
} from "../src/modules/agent/conversationStore";
import { resolveCustomContextKey } from "../src/modules/agent/itemScope";
import {
  buildModelEndpointCandidates,
  canRetryModelEndpoint,
  parseModelIDs,
  parseModelInfos,
  resolveEffectiveReasoningEffort,
  summarizeModelMetadataAvailability,
} from "../src/modules/agent/modelMetadata";

describe("model probe logic", function () {
  it("should build endpoint candidates from base url", function () {
    const candidates = buildModelEndpointCandidates("https://example.com/v1");
    assert.include(candidates, "https://example.com/v1");
    assert.include(candidates, "https://example.com/v1/models");
    assert.include(candidates, "https://example.com/models");
  });

  it("should retry endpoint probing for parser errors regardless locale message", function () {
    let parseError: Error | null = null;
    try {
      parseModelIDs("<!doctype html>");
    } catch (error) {
      parseError = error as Error;
    }
    assert.instanceOf(parseError, Error);
    assert.isTrue(canRetryModelEndpoint(0, 2, parseError!));
  });

  it("should fail test-connection parse when model list is missing or empty", function () {
    assert.throws(() => parseModelInfos('{"ok":true}'), /model|模型/i);
    assert.throws(() => parseModelInfos('{"data":[]}'), /empty|空/i);
  });

  it("should parse valid model list count", function () {
    const count = parseModelInfos(
      '{"data":[{"id":"gpt-4o"},{"id":"gpt-4.1"}]}',
    ).length;
    assert.equal(count, 2);
  });

  it("should parse model context windows when the site returns them", function () {
    const modelInfos = parseModelInfos(
      JSON.stringify({
        data: [
          { id: "gpt-4.1", context_length: 1047576 },
          { id: "glm-4.6", max_model_len: "200000" },
          {
            id: "openrouter-nested",
            top_provider: { context_length: 1048576 },
          },
          { id: "catalog-max", max_context_window: 1000000 },
          { id: "custom-model" },
        ],
      }),
    );

    assert.deepEqual(modelInfos, [
      { id: "gpt-4.1", contextWindow: 1047576, reasoningEfforts: null },
      { id: "glm-4.6", contextWindow: 200000, reasoningEfforts: null },
      {
        id: "openrouter-nested",
        contextWindow: 1048576,
        reasoningEfforts: null,
      },
      { id: "catalog-max", contextWindow: 1000000, reasoningEfforts: null },
      { id: "custom-model", contextWindow: null, reasoningEfforts: null },
    ]);
  });

  it("should parse provider-declared reasoning efforts from model metadata", function () {
    const modelInfos = parseModelInfos(
      JSON.stringify({
        data: [
          {
            id: "reasoning-a",
            supported_reasoning_efforts: ["low", "medium", "high"],
          },
          {
            id: "reasoning-b",
            reasoning: { efforts: "minimal high extra-high" },
          },
          {
            id: "reasoning-c",
            capabilities: { reasoning_efforts: ["none", "unknown", "xhigh"] },
          },
          {
            id: "reasoning-d",
            supported_reasoning_levels: [
              { effort: "low", description: "Fast" },
              { effort: "extra-high", description: "Deep" },
            ],
          },
        ],
      }),
    );

    assert.deepEqual(modelInfos, [
      {
        id: "reasoning-a",
        contextWindow: null,
        reasoningEfforts: ["low", "medium", "high"],
      },
      {
        id: "reasoning-b",
        contextWindow: null,
        reasoningEfforts: ["minimal", "high", "xhigh"],
      },
      {
        id: "reasoning-c",
        contextWindow: null,
        reasoningEfforts: ["none", "xhigh"],
      },
      {
        id: "reasoning-d",
        contextWindow: null,
        reasoningEfforts: ["low", "xhigh"],
      },
    ]);
  });

  it("should summarize metadata declared by the model list", function () {
    const modelInfos = parseModelInfos(
      JSON.stringify({
        data: [
          { id: "plain" },
          { id: "contextual", context_window: 128000 },
          { id: "reasoning", supported_reasoning_efforts: ["low", "high"] },
        ],
      }),
    );

    assert.deepEqual(summarizeModelMetadataAvailability(modelInfos), {
      modelCount: 3,
      contextWindowCount: 1,
      reasoningEffortCount: 1,
    });
  });

  it("should not infer reasoning effort from generic supported parameters", function () {
    const modelInfos = parseModelInfos(
      JSON.stringify({
        data: [
          {
            id: "generic-reasoning",
            supported_parameters: ["reasoning", "include_reasoning"],
          },
        ],
      }),
    );

    assert.deepEqual(modelInfos, [
      {
        id: "generic-reasoning",
        contextWindow: null,
        reasoningEfforts: null,
      },
    ]);
  });

  it("should normalize unsupported reasoning effort to default", function () {
    assert.equal(
      resolveEffectiveReasoningEffort(["default", "low", "high"], "high"),
      "high",
    );
    assert.equal(
      resolveEffectiveReasoningEffort(["default", "low"], "xhigh"),
      "default",
    );
  });

  it("should scope custom context to the primary item key", function () {
    const parent = {
      key: "PARENT1",
      libraryID: 7,
      parentItem: null,
    } as unknown as Zotero.Item;
    const child = {
      key: "CHILD1",
      libraryID: 7,
      parentItem: parent,
    } as unknown as Zotero.Item;

    assert.equal(resolveCustomContextKey(parent), "7:PARENT1");
    assert.equal(resolveCustomContextKey(child), "7:PARENT1");
  });

  it("should retry only recoverable chat errors before streaming starts", function () {
    assert.isTrue(
      shouldRetryChatError(
        new Error("HTTP 503 temporarily unavailable"),
        1,
        2,
        false,
        false,
      ),
    );
    assert.isFalse(
      shouldRetryChatError(
        new Error("HTTP 401 INVALID_API_KEY"),
        1,
        2,
        false,
        false,
      ),
    );
    assert.isFalse(
      shouldRetryChatError(
        new Error("HTTP 503 temporarily unavailable"),
        1,
        2,
        true,
        false,
      ),
    );
  });

  it("should parse persisted conversations defensively", function () {
    const conversations = parseConversationStore(
      JSON.stringify({
        version: 1,
        conversations: [
          {
            id: "session-1",
            key: "7:PARENT1",
            createdAt: 1000,
            updatedAt: 2000,
            messages: [
              { role: "user", content: "hello", createdAt: 1001 },
              {
                role: "assistant",
                content: "world",
                createdAt: 1002,
                responseWaitMs: 321,
              },
              { role: "system", content: "drop", createdAt: 1003 },
            ],
          },
          { key: "", messages: [] },
        ],
      }),
    );

    assert.lengthOf(conversations, 1);
    assert.equal(conversations[0].scopeKey, "7:PARENT1");
    assert.include(conversations[0].key, "7:PARENT1::session-1");
    assert.lengthOf(conversations[0].messages, 2);
    assert.equal(conversations[0].messages[1].responseWaitMs, 321);
  });

  it("should parse multi-session conversation store", function () {
    const conversations = parseConversationStore(
      JSON.stringify({
        version: 2,
        active: {
          "7:PARENT1": "7:PARENT1::session-2",
        },
        conversations: [
          {
            id: "session-1",
            key: "7:PARENT1::session-1",
            scopeKey: "7:PARENT1",
            createdAt: 1000,
            updatedAt: 1500,
            messages: [{ role: "user", content: "old", createdAt: 1001 }],
          },
          {
            id: "session-2",
            key: "7:PARENT1::session-2",
            scopeKey: "7:PARENT1",
            createdAt: 2000,
            updatedAt: 2500,
            messages: [{ role: "user", content: "new", createdAt: 2001 }],
          },
        ],
      }),
    );

    assert.lengthOf(conversations, 2);
    assert.deepEqual(
      conversations.map((conversation) => conversation.key),
      ["7:PARENT1::session-1", "7:PARENT1::session-2"],
    );
  });

  it("should parse conversation title and favorite from persisted store", function () {
    const conversations = parseConversationStore(
      JSON.stringify({
        version: 2,
        active: {},
        conversations: [
          {
            id: "session-fav",
            key: "7:PARENT1::session-fav",
            scopeKey: "7:PARENT1",
            createdAt: 1000,
            updatedAt: 2000,
            title: "My Research Notes",
            favorite: true,
            messages: [{ role: "user", content: "hello", createdAt: 1001 }],
          },
          {
            id: "session-plain",
            key: "7:PARENT1::session-plain",
            scopeKey: "7:PARENT1",
            createdAt: 3000,
            updatedAt: 4000,
            messages: [{ role: "user", content: "world", createdAt: 3001 }],
          },
        ],
      }),
    );

    assert.lengthOf(conversations, 2);
    assert.equal(conversations[0].title, "My Research Notes");
    assert.isTrue(conversations[0].favorite);
    assert.isUndefined(conversations[1].title);
    assert.isUndefined(conversations[1].favorite);
  });

  it("should keep persisted conversation payloads bounded for file storage", function () {
    assert.equal(MAX_PERSISTED_CONVERSATIONS, 128);
    assert.equal(MAX_PERSISTED_CONVERSATIONS_PER_SCOPE, 24);
    assert.equal(MAX_PERSISTED_MESSAGES_PER_CONVERSATION, 80);
    assert.equal(MAX_PERSISTED_MESSAGE_CHARS, 12000);

    const now = 1000;
    const conversations: ConversationState[] = Array.from(
      { length: MAX_PERSISTED_CONVERSATIONS + 4 },
      (_, index) => ({
        id: `session-${index}`,
        key: `scope-${index % 2}::session-${index}`,
        scopeKey: `scope-${index % 2}`,
        createdAt: now + index,
        updatedAt: now + index,
        messages: [
          {
            role: "assistant",
            content: "x".repeat(MAX_PERSISTED_MESSAGE_CHARS + 500),
            createdAt: now + index,
          },
        ],
      }),
    );

    const selected = selectConversationsForPersistence(conversations);
    assert.isAtMost(selected.length, MAX_PERSISTED_CONVERSATIONS);
    assert.isAtMost(
      selected.filter((conversation) => conversation.scopeKey === "scope-0")
        .length,
      MAX_PERSISTED_CONVERSATIONS_PER_SCOPE,
    );
    const serialized = serializeConversation(conversations[0]);
    assert.lengthOf(
      serialized.messages[0].content,
      MAX_PERSISTED_MESSAGE_CHARS,
    );
  });
});
