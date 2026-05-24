# TODO - Zotero-Cat

[English](./TODO.md) | [中文](./TODO.zh-CN.md)

This file tracks the project plan by phase. Keep it practical: each checked item
should correspond to implemented code, a committed document, or a verified
workflow.

## Current Project State

- Project name: `Zotero-Cat`
- Package name: `zotero-cat`
- Plugin ID: `zotero-cat@qianjindexiaozu.dev`
- Namespace / chrome path: `zoterocat`
- Global Zotero instance: `Zotero.ZoteroCat`
- Pref prefix: `extensions.zotero.zoterocat`
- License: `AGPL-3.0-or-later`
- Runtime for development: Node.js 24 LTS
- Current implementation target: Zotero 9
- Released: `v0.3.1` (item-pane chat, OpenAI-compatible provider, Zotero
  context, streaming, history, optional web search, and experimental PDF tool
  agency behind the `PDF tools` toggle, with hardened tool-call orchestration
  and patched PDF quote matching for GLM-style ellipses and hyphen spacing)

## Phase 0: Repository Initialization

- [x] Choose and declare open-source license: `AGPL-3.0-or-later`.
- [x] Create base docs: `README.md`, `CONTRIBUTING.md`, `TODO.md`.
- [x] Initialize Zotero plugin scaffold with Zotero 9 compatibility target.
- [x] Rename project to Zotero-Cat across package metadata, plugin metadata,
      localization, prompt identity, docs, and Git remote.
- [x] Add Node version files: `.nvmrc`, `.node-version`.

## Phase 1: MVP

Goal: load inside Zotero, render a usable assistant panel, and send a basic
model request through a configurable provider.

- [x] Register a Zotero item-pane section through `ItemPaneManager.registerSection`.
- [x] Render basic chat UI with fixed-height layout and bottom composer.
- [x] Create Provider abstraction: `provider -> chat`.
- [x] Implement first OpenAI-compatible provider.
- [x] Add configurable Provider, Base URL, model, and API Key settings with
      presets and a separate Test Connection action.
- [x] Store API Key through Firefox Login Manager.
- [x] Add localized UI text for Chinese and English Zotero.

## Phase 2: Zotero Context

Goal: make responses useful for reading and reviewing Zotero items without
forcing users to paste context by hand.

- [x] Inject current item metadata, optional notes, and optional PDF annotations.
- [x] Capture selected text from Zotero PDF reader selection popup.
- [x] Add prompt template system, context preview, and token budget estimate.
- [x] Show model context window when provider metadata declares it.
- [x] Add user custom context input; keep provided Zotero context read-only in
      preview and fold custom context until clicked.

## Phase 3: Experience Enhancements

Goal: make the assistant feel usable across repeated reading sessions.

- [x] Stream assistant output with typewriter-like incremental rendering.
- [x] Add request cancellation, send/stop icon toggle, and tooltips.
- [x] Add 60-second request timeout and retry policy for recoverable errors
      before output starts.
- [x] Probe third-party endpoint paths and remember successful hints; fetch
      model list from OpenAI-compatible `/models` endpoint.
- [x] Add model selection, custom model input, and reasoning effort selection.
- [x] Add copy button with visible feedback.
- [x] Add per-item history sessions with native dropdown, new/clear/delete
      actions, capacity limits, and per-item active-conversation pointer
      persistence.
- [x] Add `Thinking.` / `..` / `...` animation and first-output wait timer.
- [x] Fix chat at 90 percent height; keep composer at bottom; auto-scroll during
      stream without bouncing.
- [x] Render assistant Markdown safely.
- [x] Add diagnostics panel for retry and request errors.

## Phase 3.5: Engineering Quality

Goal: reduce regression risk before packaging and public release.

- [x] Add unit tests for provider endpoint fallback, model-list probing,
      connection parsing, context preview/token estimate, conversation parser,
      and startup scaffold.
- [x] Add `doc/release/UI_REGRESSION_CHECKLIST.md`.
- [x] Make `npm test` exit after completion; use `.nvmrc` + `npm ci` in CI.
- [x] Extract pure modules out of `section.ts` (model metadata, conversation
      persistence, item scoping, chat retry classification, shared message types).
- [x] Remove duplicated model-list parser between chat UI and Test Connection.
- [x] Point pure logic tests at pure modules, not test-only UI exports.

## Phase 4: Compatibility And Release

Goal: produce an installable XPI and make the project usable outside the local
development machine.

- [x] Run `doc/release/UI_REGRESSION_CHECKLIST.md` against Zotero 9 current stable.
- [x] Build and install XPI through Zotero Add-ons Manager; verify settings
      and conversation persistence survive install.
- [x] Add `CHANGELOG.md`; define `0.x` versioning and release branch/tag rules.
- [x] Add GitHub release workflow with dry-run path; record automated local
      release verification with XPI hash.
- [x] Add installation instructions, provider setup examples, privacy notes,
      and Zotero non-affiliation disclaimer in English + Chinese.
- [x] Confirm `strict_min_version` = `9.0`, `strict_max_version` = `9.*`.
- [ ] Record a detailed manual regression note per release: Zotero version, OS,
      date, provider used.
- [ ] Verify the latest Zotero beta when available; do not declare Zotero 10
      compatibility until the manual checklist passes.
- [ ] Verify `Components.Constructor(...)` for `nsILoginInfo` in
      `secureApiKey.ts` on the Zotero 10 ESR base before widening
      `strict_max_version`.

## Phase 5: Public Product Polish

Goal: prepare for GitHub stars, early users, and issue reports without
overbuilding.

- [ ] Create project website at `zoterocat.org` or redirect it to the GitHub
      repo first.
- [ ] Add a concise product screenshot and short demo GIF or video to README.
- [ ] Add issue templates: bug report, provider compatibility, feature request.
- [ ] Add `security@zoterocat.org` and `contact@zoterocat.org` after mail setup.
- [ ] Add GitHub repository topics.
- [ ] Add a short architecture document if contributors start asking for
      internals.
- [ ] Prepare launch notes for Zotero community channels.

## Phase 6: v0.2 — PDF Tool Agency

Goal: let the assistant read a PDF, propose highlights, notes, and edits to
existing annotations, and apply them only after per-item user confirmation
(Accept / Reject / Accept All / Reject All).

Status: the first end-to-end implementation was released in `v0.2.0` behind the
`PDF tools` toggle. `v0.3.0` hardens the tool pipeline and PDF text matching.
PDF tools remain experimental and need continued Zotero UI validation on real
PDFs.

### Onboarding gate

- [ ] When no API key is stored, replace the chat UI with a single
      "Configure provider" prompt and a one-click button that opens the
      preferences pane.
- [x] Add bilingual strings for the first-run provider gate.

### Tool pipeline

- [x] Extend `toolAction.ts` so `parseAssistantToolActions` returns
      `ToolAction[]` and each handler declares `readOnly: boolean`.
- [x] Split the follow-up flow in `section.ts`: read tools run immediately and
      feed results back; write tools queue into a proposal batch.

### PDF extraction (headless)

- [x] Add `pdfjs-dist` as a runtime dependency and lazy-load it from
      `src/modules/tools/pdfReader.ts`.
- [ ] Pin `pdfjs-dist` exactly and re-check the bundle/worker strategy before
      release.
- [x] Implement `src/modules/tools/pdfReader.ts`:
  - `extractPages(attachment)` — per-page text items with `transform`,
    `width`, `height`, and page size.
  - `findTextRects(pages, pageIndex, text, fuzz)` — locate the snippet in the
    target page ±2 pages with whitespace-normalized fuzzy match; return the
    resolved `pageIndex` and `rects[][]` in PDF user space.
- [x] Add lazy pdf.js initialization, document cleanup, cache invalidation, and
      plugin-shutdown cache clearing; surface readable extraction errors for
      unusable PDFs.

### Annotation operations

- [x] Implement `src/modules/tools/pdfAnnotations.ts` with
      `createAnnotation` / `updateAnnotation` / `deleteAnnotation` — thin
      wrappers around `Zotero.Annotations.saveFromJSON` and `Zotero.Item.eraseTx`
      with JSON validation, sort-index generation, and position-size splitting.

### Proposal state machine

- [x] Implement `src/modules/agent/annotationProposals.ts`:
  - Per-conversation in-memory queue; at most one pending batch per
    assistant turn; cap at 10 proposals.
  - States: `pending` → `accepted` / `rejected` / `failed`.
  - Subscriber hook for UI refresh.
- [x] Implement `src/modules/agent/annotationTools.ts` registering 5 handlers:
      `read_pdf`, `list_annotations`, `propose_annotation`,
      `modify_annotation`, `delete_annotation`.

### Confirmation UI

- [x] Add `src/modules/agent/proposalView.ts` — render a proposal batch card
      inside the chat: op badge, page, snippet preview, comment, color swatch,
      per-card Accept / Reject buttons.
- [x] Batch toolbar: Accept All / Reject All / pending count.
- [ ] Keyboard: Enter = accept focused, Esc = reject focused,
      Shift+Enter = Accept All.
- [x] Lock the composer while a batch is pending; unlock on resolve.
- [x] After apply: summarize accepted / rejected / failed and send one
      follow-up user message back to the model so the turn continues.

### Preferences, prompts, locale

- [x] Add `pdfToolsEnabled` (default `false`) and `pdfToolsAutoApply`
      (default `false`) prefs in `addon/prefs.js`.
- [x] Surface both toggles in the chat controls. Decide later whether they
      should also live in the preferences pane with tooltips.
- [x] When `pdfToolsEnabled` is on, append a tool-rules block to the system
      prompt (JSON schema for each action, batch size cap, required reads
      before writes).
- [x] Add bilingual Fluent strings in `addon/locale/{en-US,zh-CN}/addon.ftl`
      for the gate, toolbar, cards, and status messages.

### Tests & verification

- [x] Add `test/pdf-tools-logic.test.ts` — text→rects fuzzy matching and
      annotation JSON validation with mocked Zotero APIs.
- [x] Add `test/proposal-state.test.ts` — state machine edge cases.
- [x] Update `doc/release/UI_REGRESSION_CHECKLIST.md` with create/modify/delete
      annotation cases and the onboarding gate.
- [x] `npm run lint:check && npm run build && npm test` all green.

## Phase 7: Function Calling Standardization

Goal: extract the tool-call orchestration loop out of `section.ts` into a
dedicated, testable runner; centralize per-endpoint provider quirks
(reasoning_content echo, native tool_calls unsupported, etc.); unify native
(`tool_calls`) and text-mode JSON tool-action paths under one state machine.
This is the structural response to the parade of provider-specific bugs
(MiMo / DeepSeek-V4-Thinking reasoning_content, silent `MAX_TOOL_CHAIN_DEPTH`
truncation, two divergent tool dispatch paths).

Constraints (do not violate):

- No `langchain` / `langgraph` runtime dependency. Evolve our internal runtime
  with LangGraph-style ideas instead (explicit state transitions, depth gate,
  human-confirmation checkpoints, deterministic tool ownership).
- Tool execution stays owned by Zotero-Cat; provider-native function calling
  is read-only for us — we receive `tool_calls`, we never delegate execution.
- `Zotero.HTTP.request` remains the only HTTP entry point.
- `toolProtocol.ts` (MCP/OpenAI-compatible tool contract) is the existing
  foundation. Do not duplicate.

### Foundation modules

- [x] `src/modules/agent/functionCalling/errors.ts` — relocate
      `ToolsNotSupportedError` and `ReasoningContentRequiredError` from
      `provider.ts`; add `MaxToolDepthExceededError`. `provider.ts` re-exports
      for backward compatibility.
- [x] `src/modules/agent/functionCalling/quirks.ts` — `ProviderQuirks` type
      and per-endpoint registry; replaces the
      `nativeToolsUnsupportedEndpoints` / `reasoningContentEchoEndpoints`
      sets scattered across `section.ts`. Endpoint key normalization stays
      consistent with the current `getActiveEndpointKey()`.
- [x] `src/modules/agent/functionCalling/messageShape.ts` — move
      `serializeChatMessage` and `buildRequestPayload` logic here so quirks
      (e.g. `reasoningContentEmptyPolicy: "empty" | "omit" | "space"`) are
      applied once, in one place. `provider.ts` becomes thinner.
- [~] `src/modules/agent/functionCalling/types.ts` — superseded for now:
  the single-turn runner exports `RunAssistantTurnInput` /
  `AssistantTurnReply` inline. Re-introduce a dedicated `types.ts` once a
  multi-turn loop lands and there is more than one consumer.

### Runner

- [x] `src/modules/agent/functionCalling/runner.ts` implementing
      `runAssistantTurn`. Pure logic, no Zotero UI imports. Scope is
      intentionally single-turn for now: tool execution and multi-turn
      follow-up live in `section.ts` because they own UI state and the
      pause-for-user-confirmation lifecycle.
- [ ] Unify native (`tool_calls`) and text-mode JSON paths inside the runner:
      both should produce a normalized `AssistantTurn` with optional
      `toolCalls`. Today the text-mode JSON detection still happens inside
      `section.ts` mid-stream. Defer to the multi-turn loop refactor.
- [ ] Make `MAX_TOOL_CHAIN_DEPTH` a runner parameter, not a magic constant.
      Surface depth exhaustion through `MaxToolDepthExceededError` (UI then
      maps it to a visible message). Defer until multi-turn loop lands.
- [x] Self-recovery for known quirks: catch `ReasoningContentRequiredError`
      and `ToolsNotSupportedError`, remember the endpoint quirk via the
      central registry, retry once with the updated quirks. No silent retries
      beyond that — every recovery emits one diagnostic event.

### Migration

- [x] Migrate `section.ts` `runChatAttempt` to call `runAssistantTurn`.
      Quirk-recovery retry is delegated; section.ts only logs the diagnostic
      and resets the in-flight bubble through `onDiagnostic`.
      `continueAfterAssistantToolAction` and `continueAfterNativeToolCalls`
      were later moved to `runtime/toolChain.ts`, leaving `section.ts` focused
      on UI/runtime wiring.
- [x] After migration, `section.ts` should drop below ~2,500 lines and stop
      importing provider quirks state directly. Current `section.ts` is ~935
      lines.

### Companion bug fixes (do alongside migration)

- [x] `conversationRuntime.ts:184` no longer filters out assistant messages
      whose content is empty but who carry `toolCalls`, and also propagates
      `toolCalls` / `toolCallId` / `toolName` into the provider payload.
- [x] Strengthen the DeepSeek-V4-Thinking quirk: default
      `reasoningContentEmptyPolicy` to `"space"` for endpoints whose host
      matches `api.deepseek.com` (single space sidesteps both empty-string
      and missing-field validation paths in the observed relays).
- [x] Persist tool results into `conversation.messages` so multi-turn
      replays send a well-formed `[assistant{tool_calls}, tool, ...]`
      sequence. `section.ts` now calls `appendToolResultMessage(...)` for
      every read tool as it finishes, for write tools after the proposal
      batch resolves in `applyBatchAndContinue`, and for unrecognized /
      write-unavailable tool calls in the immediate follow-up path.
      `conversationRuntime.toProviderMessages` applies
      `sanitizeToolCallSequences` as a defensive last-line guard for
      cancellation paths that still leave an orphan `assistant.toolCalls`.
      Fixes DeepSeek 400 "insufficient tool messages following tool_calls
      message" on the next user turn after a tool round-trip.

### Tests

- [x] `test/function-calling-runner.test.ts` — happy path,
      ReasoningContentRequiredError recovery, ToolsNotSupportedError
      recovery, native → text-mode fallback, host-default propagation.
- [x] `test/function-calling-quirks.test.ts` — endpoint key normalization,
      hot-add quirks, per-host defaults (DeepSeek).
- [x] `test/function-calling-message-shape.test.ts` — assistant `tool_calls`
      round-trip with `reasoning_content` echo, system / user / tool message
      shape, empty-policy variants.
- [x] `test/conversation-runtime.test.ts` — `sanitizeToolCallSequences`
      cases: orphan `toolCalls` stripped (prose preserved / dropped when
      empty), partial `tool_call_id` coverage rejected, stray
      `role: "tool"` messages dropped, well-formed sequences kept.

### Future (Phase 8 candidate, not in this phase)

- [ ] Spike `@modelcontextprotocol/sdk` inside the Zotero XPI; if it loads
      cleanly under XPCOM, adopt it for tool spec definition. Until the
      spike passes, keep the lightweight contract in `toolProtocol.ts`.
- [ ] Multi-turn `runFunctionCallingLoop` that owns tool execution and the
      depth gate; collapses `continueAfterAssistantToolAction` /
      `continueAfterNativeToolCalls` into a single state machine and pushes
      `MAX_TOOL_CHAIN_DEPTH` into runner config. UI keeps the human-in-the-
      loop pause for write-action proposals.
- [ ] Resumable tool checkpoints across plugin restart.

## Backlog

These are useful but not part of the current release path.

- [ ] More provider-specific adapters if OpenAI-compatible behavior is
      insufficient.
- [ ] Better token counting with provider/model-specific tokenizers.
- [ ] UI tests beyond scaffold startup if Zotero automation becomes stable
      enough.
