import { assert } from "chai";
import {
  customContextStoreTestUtils,
  getCustomContextForKey,
  setCustomContextForKey,
} from "../src/modules/agent/customContextStore";

type TestGlobal = typeof globalThis & {
  Zotero?: unknown;
};

describe("custom context store", function () {
  const testGlobal = globalThis as TestGlobal;
  let originalZotero: unknown;
  let storedPref = "";

  before(function () {
    originalZotero = testGlobal.Zotero;
  });

  beforeEach(function () {
    customContextStoreTestUtils.reset();
    storedPref = "";
    testGlobal.Zotero = {
      Prefs: {
        get() {
          return storedPref;
        },
        set(_key: string, value: unknown) {
          storedPref = String(value);
        },
      },
    };
  });

  afterEach(function () {
    customContextStoreTestUtils.reset();
    testGlobal.Zotero = originalZotero;
  });

  it("loads valid non-empty custom context entries defensively", function () {
    storedPref = JSON.stringify({
      "item-1": "important context",
      "item-2": "",
      "item-3": 42,
    });

    assert.equal(getCustomContextForKey("item-1"), "important context");
    assert.equal(getCustomContextForKey("item-2"), "");
    assert.equal(getCustomContextForKey("item-3"), "");
  });

  it("persists updates and removes blank entries", function () {
    storedPref = JSON.stringify({ "item-1": "old" });

    setCustomContextForKey("item-2", "new");
    setCustomContextForKey("item-1", "   ");

    assert.deepEqual(JSON.parse(storedPref), { "item-2": "new" });
    assert.deepEqual(
      [...customContextStoreTestUtils.snapshot().entries()],
      [["item-2", "new"]],
    );
  });
});
