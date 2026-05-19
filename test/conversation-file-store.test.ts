import { assert } from "chai";
import {
  getConversationStorePath,
  loadConversationFileStore,
  saveConversationFileStore,
} from "../src/modules/agent/conversationFileStore";
import type { ConversationState } from "../src/modules/agent/conversationStore";

type TestGlobal = typeof globalThis & {
  Zotero?: unknown;
  PathUtils?: unknown;
  IOUtils?: unknown;
};

describe("conversation file store", function () {
  const testGlobal = globalThis as TestGlobal;
  let originalZotero: unknown;
  let originalPathUtils: unknown;
  let originalIOUtils: unknown;
  let files: Map<string, string>;
  let legacyPrefValue = "";
  let clearedLegacyPref = false;

  before(function () {
    originalZotero = testGlobal.Zotero;
    originalPathUtils = testGlobal.PathUtils;
    originalIOUtils = testGlobal.IOUtils;
  });

  beforeEach(function () {
    files = new Map();
    legacyPrefValue = "";
    clearedLegacyPref = false;
    testGlobal.PathUtils = {
      profileDir: "/profile",
      join(...parts: string[]) {
        return parts.join("/");
      },
    };
    testGlobal.IOUtils = {
      async exists(path: string) {
        return files.has(path);
      },
      async readUTF8(path: string) {
        return files.get(path) || "";
      },
      async makeDirectory() {
        // no-op in tests
      },
    };
    testGlobal.Zotero = {
      DataDirectory: { dir: "/zotero-data" },
      File: {
        async putContentsAsync(path: string, content: string) {
          files.set(path, content);
        },
      },
      Prefs: {
        get(key: string) {
          return key.endsWith(".agentConversationStore") ? legacyPrefValue : "";
        },
        clear(key: string) {
          if (key.endsWith(".agentConversationStore")) {
            clearedLegacyPref = true;
            legacyPrefValue = "";
          }
        },
      },
      logError() {
        // no-op in tests
      },
    };
  });

  afterEach(function () {
    testGlobal.Zotero = originalZotero;
    testGlobal.PathUtils = originalPathUtils;
    testGlobal.IOUtils = originalIOUtils;
  });

  it("should load legacy pref history when no file exists", async function () {
    legacyPrefValue = JSON.stringify({
      version: 2,
      active: { item: "item::session-1" },
      conversations: [
        {
          id: "session-1",
          key: "item::session-1",
          scopeKey: "item",
          createdAt: 1,
          updatedAt: 2,
          messages: [{ role: "user", content: "hello", createdAt: 3 }],
        },
      ],
    });

    const store = await loadConversationFileStore();

    assert.equal(store.active.item, "item::session-1");
    assert.lengthOf(store.conversations, 1);
    assert.equal(store.conversations[0].messages[0].content, "hello");
  });

  it("should save history to disk and clear legacy pref storage", async function () {
    const conversation: ConversationState = {
      id: "session-1",
      key: "item::session-1",
      scopeKey: "item",
      createdAt: 1,
      updatedAt: 2,
      messages: [{ role: "assistant", content: "saved", createdAt: 3 }],
    };
    const activeConversationKeyByScope = new Map([["item", conversation.key]]);
    const conversationsByKey = new Map([[conversation.key, conversation]]);

    await saveConversationFileStore({
      conversations: conversationsByKey.values(),
      activeConversationKeyByScope,
      conversationsByKey,
    });

    const path = await getConversationStorePath();
    const saved = JSON.parse(files.get(path) || "{}") as {
      active?: Record<string, string>;
      conversations?: Array<{ messages?: Array<{ content?: string }> }>;
    };
    assert.equal(path, "/zotero-data/zotero-cat/agent-conversations.json");
    assert.equal(saved.active?.item, conversation.key);
    assert.equal(saved.conversations?.[0]?.messages?.[0]?.content, "saved");
    assert.isTrue(clearedLegacyPref);
  });
});
