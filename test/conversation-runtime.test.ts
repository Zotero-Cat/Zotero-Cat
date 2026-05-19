import { assert } from "chai";
import {
  applyConversationStoreToRuntime,
  createConversationRuntimeState,
  createNewConversationForScope,
  deleteConversation,
  getActiveConversationForScope,
  pointsToMessage,
  selectConversation,
  toProviderMessages,
} from "../src/modules/agent/conversationRuntime";
import type { ConversationState } from "../src/modules/agent/conversationStore";
import {
  createRunningToolEventMessage,
  getToolEventLabelID,
  markToolEventMessage,
  normalizeToolKind,
} from "../src/modules/agent/toolEventState";

describe("conversation runtime state", function () {
  it("repairs invalid active pointers by choosing the latest scoped session", function () {
    const state = createConversationRuntimeState();
    const older = createNewConversationForScope(state, "item-1");
    older.updatedAt = 100;
    const newer = createNewConversationForScope(state, "item-1");
    newer.updatedAt = 200;
    state.activeConversationKeyByScope.set("item-1", "missing");

    const active = getActiveConversationForScope(state, "item-1");

    assert.equal(active.key, newer.key);
    assert.equal(state.activeConversationKeyByScope.get("item-1"), newer.key);
  });

  it("selects and deletes conversations without leaking cross-scope state", function () {
    const state = createConversationRuntimeState();
    const itemOne = createNewConversationForScope(state, "item-1");
    const itemTwo = createNewConversationForScope(state, "item-2");

    assert.isFalse(selectConversation(state, "item-1", itemTwo.key));
    assert.equal(state.activeConversationKeyByScope.get("item-1"), itemOne.key);

    const replacement = deleteConversation(state, "item-1", itemOne.key);

    assert.isNotNull(replacement);
    assert.notEqual(replacement?.key, itemOne.key);
    assert.equal(
      state.activeConversationKeyByScope.get("item-1"),
      replacement?.key,
    );
    assert.equal(state.activeConversationKeyByScope.get("item-2"), itemTwo.key);
    assert.isFalse(state.conversationsByKey.has(itemOne.key));
  });

  it("applies persisted store payloads and ignores stale active entries", function () {
    const state = createConversationRuntimeState();
    const older = buildConversation("item-1", "older", 100);
    const newer = buildConversation("item-1", "newer", 200);

    applyConversationStoreToRuntime(state, {
      active: { "item-1": "missing" },
      conversations: [older, newer],
    });

    assert.equal(state.conversationsByKey.size, 2);
    assert.equal(state.activeConversationKeyByScope.get("item-1"), newer.key);
  });

  it("builds provider messages from chat messages only", function () {
    const messages = [
      { role: "user" as const, content: "hello", createdAt: 1 },
      createRunningToolEventMessage("read_pdf", 2),
      { role: "assistant" as const, content: "   ", createdAt: 3 },
      { role: "assistant" as const, content: "answer", createdAt: 4 },
    ];

    assert.deepEqual(toProviderMessages(messages), [
      { role: "user", content: "hello" },
      { role: "assistant", content: "answer" },
    ]);
  });

  it("checks message pointers without depending on UI runtime", function () {
    assert.isTrue(
      pointsToMessage({ conversationKey: "conv", messageIndex: 2 }, "conv", 2),
    );
    assert.isFalse(
      pointsToMessage({ conversationKey: "conv", messageIndex: 2 }, "conv", 3),
    );
    assert.isFalse(pointsToMessage(null, "conv", 2));
  });

  it("normalizes tool names and maps labels by state", function () {
    assert.equal(normalizeToolKind("read_pdf"), "read-pdf");
    assert.equal(normalizeToolKind("unknown_tool"), "generic");
    assert.equal(
      getToolEventLabelID("web-search", "running"),
      "agent-tool-running-web-search",
    );
    assert.equal(
      getToolEventLabelID("propose-annotation", "done"),
      "agent-tool-event-done-proposals",
    );
  });

  it("creates and finalizes tool event messages explicitly", function () {
    const message = createRunningToolEventMessage("read_pdf", 1000);

    assert.equal(message.kind, "tool-event");
    assert.equal(message.toolEvent?.status, "running");
    assert.equal(message.toolEvent?.toolType, "read-pdf");

    assert.isTrue(
      markToolEventMessage(message, "failed", {
        now: 1500,
        errorMessage: "boom",
      }),
    );
    assert.equal(message.toolEvent?.status, "failed");
    assert.equal(message.toolEvent?.finishedAt, 1500);
    assert.equal(message.toolEvent?.errorMessage, "boom");

    assert.isTrue(markToolEventMessage(message, "done", { now: 2000 }));
    assert.equal(message.toolEvent?.status, "done");
    assert.equal(message.toolEvent?.finishedAt, 2000);
    assert.isUndefined(message.toolEvent?.errorMessage);
  });
});

function buildConversation(
  scopeKey: string,
  id: string,
  updatedAt: number,
): ConversationState {
  return {
    id,
    key: `${scopeKey}::${id}`,
    scopeKey,
    createdAt: updatedAt - 1,
    updatedAt,
    messages: [],
  };
}
