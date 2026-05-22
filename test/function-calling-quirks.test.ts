import { assert } from "chai";
import {
  buildEndpointKey,
  defaultProviderQuirks,
  getQuirksForEndpoint,
  hostDefaultQuirks,
  isNativeToolsUnsupported,
  normalizeBaseURLForKey,
  quirksTestUtils,
  rememberNativeToolsUnsupported,
  rememberReasoningContentEcho,
  shouldEchoReasoningContent,
  updateQuirksForEndpoint,
} from "../src/modules/agent/functionCalling/quirks";

describe("functionCalling/quirks", function () {
  beforeEach(function () {
    quirksTestUtils.reset();
  });

  it("starts with conservative defaults", function () {
    const quirks = defaultProviderQuirks();
    assert.isFalse(quirks.echoReasoningContent);
    assert.isFalse(quirks.nativeToolsUnsupported);
    assert.equal(quirks.reasoningContentEmptyPolicy, "empty");
  });

  it("normalizes the base URL by stripping trailing slashes", function () {
    assert.equal(
      normalizeBaseURLForKey("https://api.example.com/v1//"),
      "https://api.example.com/v1",
    );
    assert.equal(normalizeBaseURLForKey("  trim/me/  "), "trim/me");
  });

  it("builds an endpoint key from provider + normalized URL", function () {
    assert.equal(
      buildEndpointKey("OpenAI-Compatible", "https://api.deepseek.com/v1/"),
      "openai-compatible|https://api.deepseek.com/v1",
    );
  });

  it("returns a stable record when retrieving the same endpoint", function () {
    const key = buildEndpointKey("openai", "https://api.example.com/v1");
    const first = getQuirksForEndpoint(key, "https://api.example.com/v1");
    const second = getQuirksForEndpoint(key);
    assert.strictEqual(first, second);
  });

  it("seeds DeepSeek endpoints with the single-space empty policy", function () {
    const direct = hostDefaultQuirks("https://api.deepseek.com/v1");
    assert.equal(direct.reasoningContentEmptyPolicy, "space");
    const subdomain = hostDefaultQuirks("https://relay.deepseek.com/v1");
    assert.equal(subdomain.reasoningContentEmptyPolicy, "space");
  });

  it("does not seed unknown hosts", function () {
    assert.deepEqual(hostDefaultQuirks("https://api.openai.com/v1"), {});
    assert.deepEqual(hostDefaultQuirks(""), {});
    assert.deepEqual(hostDefaultQuirks("not-a-url"), {});
  });

  it("records observed quirks via remember helpers", function () {
    const baseURL = "https://api.example.com/v1";
    const key = buildEndpointKey("openai-compatible", baseURL);

    assert.isFalse(shouldEchoReasoningContent(key));
    assert.isFalse(isNativeToolsUnsupported(key));

    rememberReasoningContentEcho(key, baseURL);
    rememberNativeToolsUnsupported(key, baseURL);

    assert.isTrue(shouldEchoReasoningContent(key));
    assert.isTrue(isNativeToolsUnsupported(key));
  });

  it("preserves host-default policies when observed quirks update", function () {
    const baseURL = "https://api.deepseek.com/v1";
    const key = buildEndpointKey("deepseek", baseURL);
    rememberReasoningContentEcho(key, baseURL);
    const quirks = getQuirksForEndpoint(key, baseURL);
    assert.isTrue(quirks.echoReasoningContent);
    assert.equal(quirks.reasoningContentEmptyPolicy, "space");
  });

  it("merges patches into an existing endpoint entry", function () {
    const baseURL = "https://api.example.com/v1";
    const key = buildEndpointKey("openai", baseURL);
    updateQuirksForEndpoint(key, baseURL, {
      echoReasoningContent: true,
      reasoningContentEmptyPolicy: "space",
    });
    updateQuirksForEndpoint(key, baseURL, {
      nativeToolsUnsupported: true,
    });
    const quirks = getQuirksForEndpoint(key, baseURL);
    assert.isTrue(quirks.echoReasoningContent);
    assert.isTrue(quirks.nativeToolsUnsupported);
    assert.equal(quirks.reasoningContentEmptyPolicy, "space");
  });

  it("isolates entries per endpoint key", function () {
    const baseA = "https://a.example.com/v1";
    const baseB = "https://b.example.com/v1";
    const keyA = buildEndpointKey("openai", baseA);
    const keyB = buildEndpointKey("openai", baseB);
    rememberReasoningContentEcho(keyA, baseA);
    assert.isTrue(shouldEchoReasoningContent(keyA));
    assert.isFalse(shouldEchoReasoningContent(keyB));
  });
});
