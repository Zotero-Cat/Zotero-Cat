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
- Released: `v0.2.0` (item-pane chat, OpenAI-compatible provider, Zotero
  context, streaming, history, optional web search, and experimental PDF tool
  agency behind the `PDF tools` toggle)

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
- [x] Add `doc/UI_REGRESSION_CHECKLIST.md`.
- [x] Make `npm test` exit after completion; use `.nvmrc` + `npm ci` in CI.
- [x] Extract pure modules out of `section.ts` (model metadata, conversation
      persistence, item scoping, chat retry classification, shared message types).
- [x] Remove duplicated model-list parser between chat UI and Test Connection.
- [x] Point pure logic tests at pure modules, not test-only UI exports.

## Phase 4: Compatibility And Release

Goal: produce an installable XPI and make the project usable outside the local
development machine.

- [x] Run `doc/UI_REGRESSION_CHECKLIST.md` against Zotero 9 current stable.
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

Status: the first end-to-end implementation is released in `v0.2.0` behind the
`PDF tools` toggle. It remains experimental and needs continued Zotero UI
validation on real PDFs.

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
- [x] Update `doc/UI_REGRESSION_CHECKLIST.md` with create/modify/delete
      annotation cases and the onboarding gate.
- [ ] `npm run lint:check && npm run build && npm test` all green.

## Backlog

These are useful but not part of the current release path.

- [ ] More provider-specific adapters if OpenAI-compatible behavior is
      insufficient.
- [ ] Better token counting with provider/model-specific tokenizers.
- [ ] UI tests beyond scaffold startup if Zotero automation becomes stable
      enough.
