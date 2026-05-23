# Zotero-Cat Implementation Notes

This file is the handoff document for future coding sessions. Read it before changing code. Keep it factual and update it whenever architecture, storage, provider behavior, or release workflow changes.

## Project Identity

- Product name: `Zotero-Cat`
- Package name: `zotero-cat`
- Add-on display name: `Zotero-Cat`
- Add-on ID: `zotero-cat@qianjindexiaozu.dev`
- Add-on namespace: `zoterocat`
- Zotero global instance: `Zotero.ZoteroCat`
- Zotero pref prefix: `extensions.zotero.zoterocat`
- Repository path on the current machine: `/Users/qianjindexiaozu/projects/Zotero-Cat`
- Remote: `git@github.com:qianjindexiaozu/Zotero-Cat.git`
- Domain owned by the maintainer: `zoterocat.org`
- License: `AGPL-3.0-or-later`

Zotero-Cat is independent from Zotero. Public docs should include a non-affiliation statement.

## Current Position

Zotero-Cat is a Zotero item-pane assistant. It uses Zotero's official `ItemPaneManager.registerSection` API, so it appears as a section in Zotero's existing right item pane. It does not replace Zotero's native right sidebar and does not try to own the full pane.

The current implementation covers MVP, Zotero context injection, streaming chat UX, per-item history, persistence, internal diagnostics, Phase 3.5 engineering quality, repository-side Phase 4 release preparation, optional web search tooling, tool-action orchestration, session export/rename/favorite controls, and experimental PDF tool agency. PDF tool agency currently includes `read_pdf`, `list_annotations`, annotation proposal generation, Accept / Reject / Accept All / Reject All review cards, optional auto-apply, and Zotero annotation create/update/delete wrappers. Structure work moved model metadata parsing, conversation persistence, item scoping, retry classification, shared message types, web search logic, tool-action parsing, PDF text extraction, annotation persistence, and proposal state out of the item-pane UI file. Release docs, changelog, provider setup notes, privacy notes, and the direct GitHub release workflow are present. Public Markdown intended for users has English and Chinese versions; `README.md` remains the English GitHub homepage and links to `README.zh-CN.md`.

The current public release is `v0.2.0`. It promotes the first experimental PDF-tool milestone behind the `PDF tools` toggle. The public release asset is `zotero-cat.xpi` under the version tag. The special GitHub release tag named `release` is used only for updater manifests and should remain marked as pre-release and not Latest. Zotero 10 beta compatibility is still not declared; keep `strict_max_version` at `9.*` until the current Zotero beta line passes the manual checklist.

## Development Environment

Use Node.js 24 LTS.

Version files:

- `.nvmrc`: `24`
- `.node-version`: `24`
- `package.json` engines: `>=24 <25`

Core commands:

```bash
nvm use
npm install
npm run lint:check
npm run build
npm test
npm start
```

`npm test` runs `zotero-plugin test --exit-on-finish`. This matters because the scaffold test runner otherwise keeps Zotero test processes alive after the suite finishes.

CI uses `actions/setup-node@v4` with `node-version-file: .nvmrc`, then `npm ci`.

## Main Architecture

### Add-on bootstrap

- `src/index.ts` creates `Zotero.ZoteroCat` if it does not exist.
- `src/addon.ts` holds shared add-on state and hook references.
- `src/hooks.ts` handles startup, shutdown, main-window loading, preference pane registration, and reader selected-text event registration.
- `zotero-plugin.config.ts` reads package config and passes name, ID, namespace, prefs prefix, and script output path to `zotero-plugin-scaffold`.

### Agent UI

Primary file: `src/modules/agent/section.ts`.

Responsibilities:

- Register and unregister the item-pane section.
- Render the full chat UI.
- Manage runtime UI state.
- Handle send, stop, retry, streaming output, copy feedback, internal diagnostics, model selection, tool toggles, and session controls.
- Coordinate conversation loading and saving through `conversationFileStore.ts`, and keep in-memory session selection/mutation in `conversationRuntime.ts`.
- Render annotation proposal batches and route accepted proposals through the PDF annotation tool wrappers.

Important UI decisions:

- The chat panel uses a fixed height derived from 85 percent of the visible page.
- The input composer belongs at the bottom of the panel.
- The session selector stays at the top of the chat area.
- History uses a native dropdown, not a custom lazy list.
- The dropdown shows up to 8 recent conversations for the current Zotero item.
- Custom context, context preview, and diagnostics disclosure panels are not rendered in the chat controls.
- The item-pane UI does not inject custom context text.
- Session controls support export, rename, and favorite.
- PDF tools are off by default and exposed from the chat controls.
- PDF write actions must become proposal cards first; direct model-driven annotation mutation is not allowed.
- The composer is locked while a proposal batch is pending.
- Long-running requests show one persistent activity status inside the message list so model/tool follow-up work is visible even when no new text is streaming. The status should reflect the currently running tool, such as web search, PDF read, annotation preparation, or annotation application.

Do not convert this into a full replacement sidebar unless the product direction changes. The current strategy favors plugin-template compatibility and low blast radius inside Zotero.

### Shared agent logic

Pure logic lives outside `section.ts` so it can be tested without importing the UI module:

- `src/modules/agent/types.ts`: shared `AgentRole` and `AgentMessage` types.
- `src/modules/agent/modelMetadata.ts`: model endpoint candidate generation, model-list parsing, context-window extraction, reasoning-effort extraction, and model endpoint retry classification.
- `src/modules/agent/conversationStore.ts`: conversation state types, defensive persistence parsing, serialization, capacity limits, and active-conversation payload building.
- `src/modules/agent/conversationRuntime.ts`: in-memory conversation maps, active-session selection, session mutation, message-pointer checks, provider-message projection, and `sanitizeToolCallSequences` — the defensive filter that strips orphan assistant `tool_calls` / orphan `role: "tool"` messages before they reach the provider.
- `src/modules/agent/customContextStore.ts`: legacy per-item custom context loading, defensive pref parsing, mutation, and persistence. The current item-pane UI does not render or inject custom context.
- `src/modules/agent/itemScope.ts`: parent-item resolution and stable per-item scope keys.
- `src/modules/agent/chatRetry.ts`: retry classification for recoverable chat failures and abort/cancel detection.
- `src/modules/agent/runtimeIds.ts`: runtime ID generation for sessions and diagnostics.
- `src/modules/agent/toolEventState.ts`: tool-event type normalization, running/done/failed state mutation, and localized label ID selection.
- `src/modules/agent/annotationProposals.ts`: in-memory annotation proposal batches and status transitions.

Tests for these behaviors should import these pure modules directly. Do not add new test-only exports to `section.ts` or `preferenceScript.ts` for logic that can live in a pure module.

### Provider layer

Primary file: `src/modules/agent/provider.ts`.

Current provider behavior:

- Supports OpenAI-compatible providers.
- Tries streaming first.
- Handles `responses` and `chat.completions` style endpoints.
- Probes endpoint candidates from the user-supplied Base URL.
- Remembers successful endpoint hints in Zotero prefs.
- Falls back only for compatible/recoverable failures before output starts.
- Does not fall back on invalid API keys.
- Parses common streaming delta shapes.
- Chat request timeout is idle-response based, not a fixed 60-second wall-clock cap; streaming progress should keep the request alive.
- Sends reasoning effort when the selected model/provider declares support.

Product rule: use the user's Base URL as the source of truth. Do not blindly append one fixed path to every provider. Many third-party gateways use different path rules.

### Model metadata

Primary file: `src/modules/agent/modelMetadata.ts`.

Model list fetching expects OpenAI-compatible JSON from `/models`.

Model metadata can provide:

- Model IDs.
- Context window fields such as `context_length` or `max_model_len`.
- Reasoning effort fields such as `reasoning_efforts`, `supported_reasoning_efforts`, or `reasoning.efforts`.

If the provider does not declare reasoning efforts, the UI should show default only. Do not invent unsupported reasoning levels.

### Zotero context

Primary file: `src/modules/agent/context.ts`.

Supported context:

- Current item metadata.
- Notes.
- PDF annotations.
- Selected text from Zotero reader.
- Optional web search context passed through `externalContext`.

Selected text capture happens through Zotero reader event handling in `src/hooks.ts`, then context assembly reads the remembered text.

The token budget is an estimate and should be described as an estimate, not exact tokenizer output.

### Tool layer

Primary files: `src/modules/agent/toolAction.ts`, `src/modules/tools/webSearch.ts`, `src/modules/agent/webSearchContext.ts`, `src/modules/agent/annotationTools.ts`, `src/modules/agent/annotationProposals.ts`, `src/modules/agent/proposalView.ts`, `src/modules/tools/pdfReader.ts`, and `src/modules/tools/pdfAnnotations.ts`.

Current tool behavior:

- Tool actions use a registry pattern. `toolAction.ts` defines the `ToolActionHandler` interface and provides `registerToolActionHandler` / `executeToolAction` / `parseAssistantToolActions`.
- Tool definitions follow a lightweight MCP/OpenAI-compatible contract in `toolProtocol.ts`: each tool can declare `description`, `inputSchema`, and optional `outputSchema` using a JSON Schema subset. The registry can export OpenAI-style function specs and MCP-style tool specs, but Zotero-Cat still owns execution internally.
- Parsed tool calls must be normalized and validated against the registered tool schema before execution. Invalid inputs should produce a visible tool error and, when useful, a repair follow-up instead of silently falling back to broad behavior.
- Handlers declare `readOnly`, and the parser can return multiple actions per assistant turn.
- Web search registers via `registerWebSearchToolHandler()` called from `hooks.ts` during startup.
- PDF read tools and annotation write stubs register from `hooks.ts` through `registerAnnotationReadTools()` and `registerAnnotationWriteStubs()`.
- To add a new tool, implement `ToolActionHandler` and call `registerToolActionHandler` in the startup path.
- Web search is explicit and user-enabled from the chat panel.
- Default provider is DuckDuckGo Instant Answer with HTML-result fallback, plus optional SearXNG JSON endpoint support.
- Search results are formatted as external context before the model request.
- If a model emits a JSON action such as `{ "action": "联网搜索", "action_input": { "query": "..." } }`, Zotero-Cat parses the action, executes the registered tool when enabled, and sends one follow-up model request with the tool result. Do not let models execute tools directly.
- Some OpenAI-compatible gateways emit XML-like tool-call markup such as `<tool_call><tool_name>read_pdf</tool_name>...</tool_call>` even without provider-native function calling. Zotero-Cat treats recognized tagged tool calls as tool actions and strips the markup from visible/persisted chat text.
- During streaming, once a complete executable tool action JSON or tagged tool call is detected, Zotero-Cat may cancel the still-open model stream and immediately switch into tool handling. This prevents providers with slow or dangling stream finalization from leaving visible tool JSON on screen with no progress feedback.
- Content display and tool handling are separate runtime pipelines. Once a complete executable tool action is detected, the assistant message is split into visible prose and agent-only tool payload. The tool payload is queued by conversation/message key and the tool pipeline is released through an internal detection promise, so it no longer waits for the provider stream to fully close. Late deltas from the cancelled/slow provider are ignored.
- Model/tool turns must keep the UI busy until the full tool chain and any post-tool follow-up finish. When a turn finishes, the active request token is invalidated so late streaming callbacks from a cancelled or slow provider cannot append text after the UI has returned to idle.
- If a model emits PDF read actions such as `read_pdf` or `list_annotations`, Zotero-Cat executes them only when PDF tools are enabled and sends one follow-up request with the tool result.
- If a model says it will call/read/search/annotate but omits a machine-readable action, Zotero-Cat first infers safe read-only PDF/list-annotation actions when obvious, and otherwise performs one repair follow-up asking for an executable action instead of silently stopping. `read_pdf` supports page-scoped reads through fields such as `page`, `fromPage`, and `toPage`.
- If a model emits PDF write actions such as `propose_annotation`, `modify_annotation`, or `delete_annotation`, Zotero-Cat converts them into proposal batches. Accepted proposals are applied through `Zotero.Annotations.saveFromJSON` or `Zotero.Item.eraseTx`.
- PDF read results include `attachmentKey` and `attachmentID`. In multi-PDF items, write actions must specify a target attachment or resolve from an existing annotation key; do not silently write to the first attachment.
- Explicit page-scoped PDF reads must not fall back to unscoped Zotero indexed full text. If requested pages cannot be selected or have no extractable text, return an actionable tool error.
- `read_pdf` results are bounded and may be truncated. Truncated results must explicitly tell the model to call `read_pdf` with the exact target page before proposing highlights.
- Explicit page hints for highlight/underline matching are strict. Do not search other pages after the requested page fails, because that creates plausible but wrong highlights.
- Highlight and underline `text` must be a continuous verbatim span from one PDF page. If intended content crosses a page boundary, split it into separate page-local proposals instead of submitting cross-page text.
- Annotation update/delete must verify that the target annotation belongs to the selected PDF attachment before mutation.
- Failed annotation proposals remain failed and non-actionable. Do not turn failed proposal inputs into pending cards.
- Failed-only annotation proposal batches must not show disabled approval controls as if user confirmation were possible. Show the failure reason and provide a dismiss path.
- Repairable failed-only annotation proposal batches, such as highlight/underline text that cannot be located in the PDF, may trigger one automatic repair follow-up. The repair prompt must ask the model to use exact PDF text or call `read_pdf` first; never create guessed highlight rects.
- “Always allow” annotation approval is scoped to the current conversation and attachment as well as operation/type; do not make it global across items or PDFs.
- Tool execution is owned by Zotero-Cat, not by provider-native function calling, so OpenAI-compatible gateways behave consistently.
- Native `tool_calls` round-trips must persist their tool results into the in-memory conversation. `section.ts` calls `appendToolResultMessage(...)` for every read tool as it finishes, for write tools after the proposal batch resolves in `applyBatchAndContinue`, and for unrecognized / write-unavailable tool calls in the immediate follow-up path. Without this, the next user turn replays the prior `assistant{tool_calls}` without matching `role: "tool"` messages and strict providers (DeepSeek, OpenAI) reject the request with "insufficient tool messages following tool_calls message". `conversationRuntime.toProviderMessages` runs `sanitizeToolCallSequences` as a final safety net for cancelled or partially-executed turns.
- `role: "tool"` runtime messages are not rendered in the chat UI; the tool-event bubble (kind: `tool-event`) already conveys progress to the user. Tool messages exist only to keep provider history well-formed.
- Do not migrate wholesale to LangChain or LangGraph inside the Zotero plugin unless the complexity clearly justifies the dependency and runtime cost. Instead, evolve the internal tool runtime with LangGraph-style ideas: explicit state transitions, resumable steps where needed, deterministic tool ownership, and human-confirmation checkpoints before user-visible document changes.

### PDF tool agency

Primary files:

- `src/modules/tools/pdfReader.ts`: lazy `pdfjs-dist` loading, PDF text extraction, text-to-rect matching, indexed-text fallback support, cache cleanup.
- `src/modules/tools/pdfAnnotations.ts`: Zotero annotation JSON building, create/update/delete wrappers, sort-index generation, split handling, and error formatting.
- `src/modules/agent/annotationTools.ts`: tool handler registration and action-to-proposal resolution.
- `src/modules/agent/annotationProposals.ts`: per-conversation proposal state machine.
- `src/modules/agent/proposalView.ts`: proposal batch rendering.

Rules:

- Keep `pdfToolsEnabled` default `false`.
- Keep `pdfToolsAutoApply` default `false`; treat auto-apply as an opt-in risky path because it bypasses per-card review by accepting and applying the generated batch.
- Highlight and underline proposals must be grounded in text found by `findTextRects`; do not create guessed highlights from metadata or summaries.
- `read_pdf` may fall back to Zotero indexed full text if pdf.js extraction fails or returns no text.
- Keep write operations previewable and reversible where possible. User-visible document mutation must remain owned by Zotero-Cat, not by direct provider/tool calls.

### Prompt templates

Primary file: `src/modules/agent/promptTemplates.ts`.

Current templates:

- General QA.
- Paper summary.
- Method critique.
- Related work.

System prompts identify the assistant as `Zotero-Cat`.

### Preferences pane

Primary files:

- `src/modules/prefsPane.ts`
- `src/modules/preferenceScript.ts`
- `addon/content/preferences.xhtml`
- `addon/locale/en-US/preferences.ftl`
- `addon/locale/zh-CN/preferences.ftl`

Behavior rules:

- Save and Test Connection are separate actions.
- Test Connection must not implicitly save settings.
- Save button should only be active when form state differs from saved state.
- Settings text should be selectable and copyable.
- Save failure should show visible feedback and copyable details.

### API Key storage

Primary file: `src/modules/agent/secureApiKey.ts`.

API keys are stored in Firefox Login Manager. They are keyed by provider and normalized Base URL. Do not store new API keys in plain Zotero prefs.

Older plain-pref migration logic exists for the former `openaiApiKey` path. Current active project prefix is `extensions.zotero.zoterocat`.

### Conversation persistence

Primary files:

- `src/modules/agent/conversationStore.ts`: payload shape, parsing, serialization, and retention limits.
- `src/modules/agent/conversationFileStore.ts`: disk-backed load/save and legacy pref migration.

Conversation history is stored as JSON on disk under Zotero's data directory:

```text
<Zotero data directory>/zotero-cat/agent-conversations.json
```

The former pref `extensions.zotero.zoterocat.agentConversationStore` is treated as a legacy migration source only. Do not write large conversation payloads back into Zotero prefs; Zotero warns and can block UI responsiveness on large pref writes.

Payload shape:

```json
{
  "version": 2,
  "active": {},
  "conversations": []
}
```

Conversations support optional `title` and `favorite` fields. The legacy `customContextStore` pref may store per-item custom context as a JSON object keyed by custom context key, but the current chat UI does not render or inject custom context.

Persistence limits:

- `MAX_PERSISTED_CONVERSATIONS = 128`
- `MAX_PERSISTED_CONVERSATIONS_PER_SCOPE = 24`
- `MAX_VISIBLE_CONVERSATION_OPTIONS = 8`
- `MAX_PERSISTED_MESSAGES_PER_CONVERSATION = 80`
- `MAX_PERSISTED_MESSAGE_CHARS = 12000`

Storage behavior:

- Scope key isolates conversations by Zotero item.
- Active conversation pointer persists per scope.
- Empty conversations do not persist.
- On first successful disk save after legacy pref migration, the old `agentConversationStore` pref is cleared.
- Legacy custom context data may exist per item in `extensions.zotero.zoterocat.customContextStore`, but the current item-pane UI does not write or inject it.
- High-frequency streaming/tool paths should call the scheduled `saveConversationStore()` only. Use immediate flush only for stable user actions or final request cleanup.
- In-memory `conversation.messages` retains `role: "tool"` runtime messages and the originating `assistant.toolCalls` for the lifetime of a session so provider requests stay well-formed across multi-turn replays. Disk serialization deliberately drops both (only `user` / `assistant` plain-text content is persisted) — on reload there are no orphans because `toolCalls` is not restored either. The `sanitizeToolCallSequences` filter inside `toProviderMessages` is the last-line guard against mid-session cancellations or partial failures leaving an orphan assistant `tool_calls`.

## Current Limitations

- Web search currently uses search snippets only; it does not crawl full webpages.
- PDF tools are experimental in `v0.2.0`, off by default, and still need continued Zotero UI regression on real PDFs.
- PDF highlight placement depends on extractable text and matching rects; scanned, encrypted, or OCR-poor PDFs can fail.
- The no-API-key onboarding gate has localized strings, but the gate is not wired as the only first-run UI yet.
- Proposal keyboard shortcuts are still pending.
- Token budget is approximate.
- Model list and reasoning effort support depend on provider metadata.
- Streamed output that has already started will not auto-retry.
- Current UI lives inside Zotero's right item pane and shares space with Zotero's native item details.

## Tests And Validation

Automated tests live under `test/`.

Covered areas:

- Context preview token pressure.
- Endpoint candidate generation.
- Retry logic for parser errors.
- Model list parsing.
- Model context window parsing.
- Provider-declared reasoning effort parsing.
- Custom context scoping.
- Recoverable chat retry behavior.
- Conversation store defensive parsing.
- Conversation title and favorite parsing.
- Defensive sanitization of orphan assistant `tool_calls` and stray `role: "tool"` messages in `toProviderMessages` (`test/conversation-runtime.test.ts`).
- Streaming delta parsing.
- Web search parsing and tool-action parsing.
- PDF text matching and annotation JSON helpers.
- Annotation proposal state machine.
- Startup instance definition.

Pure logic tests should import `modelMetadata.ts`, `conversationStore.ts`, `conversationRuntime.ts`, `customContextStore.ts`, `toolEventState.ts`, `itemScope.ts`, and `chatRetry.ts` directly. Keep `section.ts` focused on UI/runtime coordination rather than acting as a test utility barrel.

Validation commands:

```bash
npm run lint:check
npm run build
npm test
```

Manual Zotero UI validation lives in:

```text
doc/UI_REGRESSION_CHECKLIST.md
```

Run the manual checklist before release work and record Zotero version, OS, date, provider, and result.

## CI

Workflow file: `.github/workflows/ci.yml`.

Jobs:

- `lint`: checkout, setup Node from `.nvmrc`, `npm ci`, `npm run lint:check`.
- `build`: checkout, setup Node from `.nvmrc`, `npm ci`, `npm run build`, upload `.scaffold/build`.
- `test`: checkout, setup Node from `.nvmrc`, `npm ci`, `npm test`.

Do not go back to relying on `zotero-plugin-dev/workflows/setup-js@main` unless the action is pinned and its Node behavior is verified.

## Release Workflow

Workflow file: `.github/workflows/release.yml`.

Release workflow behavior:

- Manual `workflow_dispatch` runs lint, build, tests, and uploads `.scaffold/build` as a release-candidate artifact. It does not publish a GitHub Release.
- Pushing a `v*` tag runs the same checks, uploads the artifact, then runs `npm run release`.
- Release tags use `v0.x.y`; pre-release tags use `v0.x.y-alpha`, `v0.x.y-beta.n`, or another SemVer pre-release suffix.
- The scaffold-managed updater assets are published to the special GitHub release tag named `release`.

The packaged manifest currently targets Zotero 9 only:

- `strict_min_version`: `9.0`
- `strict_max_version`: `9.*`

Do not widen compatibility to Zotero 10 until `doc/UI_REGRESSION_CHECKLIST.md` passes on the current Zotero beta.

## Important Files

- `package.json`: package metadata, add-on identity, scripts, Node engine.
- `zotero-plugin.config.ts`: scaffold config and generated script path.
- `src/modules/agent/section.ts`: item-pane UI and runtime coordination.
- `src/modules/agent/types.ts`: shared agent message types.
- `src/modules/agent/modelMetadata.ts`: model endpoint and metadata parsing.
- `src/modules/agent/conversationStore.ts`: session history parsing and persistence serialization.
- `src/modules/agent/conversationRuntime.ts`: in-memory session selection and mutation helpers.
- `src/modules/agent/customContextStore.ts`: legacy per-item custom context pref storage.
- `src/modules/agent/itemScope.ts`: item scope keys.
- `src/modules/agent/chatRetry.ts`: chat retry and abort classification.
- `src/modules/agent/runtimeIds.ts`: runtime ID generation.
- `src/modules/agent/provider.ts`: model provider behavior.
- `src/modules/agent/context.ts`: Zotero context collection.
- `src/modules/agent/toolAction.ts`: tool action registry and orchestration.
- `src/modules/agent/toolEventState.ts`: tool-event state helpers and label mapping.
- `src/modules/agent/webSearchContext.ts`: web search context orchestration and web-search tool registration.
- `src/modules/agent/annotationTools.ts`: PDF read/write tool handler registration and proposal resolution.
- `src/modules/agent/annotationProposals.ts`: annotation proposal state machine.
- `src/modules/agent/proposalView.ts`: annotation proposal review UI rendering.
- `src/modules/tools/webSearch.ts`: DuckDuckGo/SearXNG search requests and result parsing.
- `src/modules/tools/pdfReader.ts`: PDF text extraction and text-to-rect matching.
- `src/modules/tools/pdfAnnotations.ts`: Zotero annotation persistence wrappers.
- `src/modules/agent/promptTemplates.ts`: localized prompt templates.
- `src/modules/agent/secureApiKey.ts`: API Key storage.
- `src/modules/preferenceScript.ts`: settings page logic.
- `addon/prefs.js`: default pref values before scaffold prefixing.
- `addon/content/zoteroPane.css`: item-pane UI styles.
- `addon/content/icons/*`: icon and logo assets.
- `addon/locale/en-US/*`: English Fluent strings.
- `addon/locale/zh-CN/*`: Chinese Fluent strings.
- `test/*`: automated tests.
- `README.md` / `README.zh-CN.md`: public project homepage in English and Chinese.
- `CONTRIBUTING.md` / `CONTRIBUTING.zh-CN.md`: contribution guide in English and Chinese.
- `TODO.md` / `TODO.zh-CN.md`: public phase plan in English and Chinese.
- `doc/UI_REGRESSION_CHECKLIST.md` / `doc/UI_REGRESSION_CHECKLIST.zh-CN.md`: manual UI checklist in English and Chinese.
- `doc/INSTALLATION.md` / `doc/INSTALLATION.zh-CN.md`: packaged XPI installation notes in English and Chinese.
- `doc/PROVIDER_SETUP.md` / `doc/PROVIDER_SETUP.zh-CN.md`: provider setup examples in English and Chinese.
- `doc/PRIVACY.md` / `doc/PRIVACY.zh-CN.md`: privacy and local storage notes in English and Chinese.
- `doc/RELEASE.md` / `doc/RELEASE.zh-CN.md`: release gates, versioning, branch/tag policy, and workflow notes in English and Chinese.
- `doc/release-notes/*`: release notes in English and Chinese.
- `doc/release-verification/*`: release verification records in English and Chinese.
- `CHANGELOG.md` / `CHANGELOG.zh-CN.md`: user-facing release history in English and Chinese.

## Next Phase

The next milestone is post-`0.2.0` PDF-tool hardening and Zotero UI regression on real PDFs.

Recommended order:

1. Re-run lint, build, tests, and the Zotero 9 manual UI checklist after each user-visible UI change.
2. Manually validate PDF tools on text-based, scanned/OCR-poor, encrypted, and multi-page PDFs.
3. Confirm create/update/delete annotation operations produce the expected Zotero UI state and do not corrupt existing annotations.
4. Decide whether `pdfjs-dist` should be pinned exactly and whether the worker/bundle strategy needs release hardening.
5. Wire or defer the no-API-key onboarding gate.
6. Test the current Zotero 10 beta before widening manifest compatibility.
7. Capture real installation screenshots for public docs and release notes.
8. Add issue templates and support/security contact details before broader announcement.
9. Keep release notes and public docs bilingual whenever user-facing Markdown changes.
10. Add public contact and security email after Zoho Mail is configured for `zoterocat.org`.

## Ongoing Refactoring (Phase 1 Partial — 2026-05-23)

A systematic refactoring pass is in progress to reduce coupling in `section.ts` and `provider.ts`. Phase 1 (pure leaf extraction + provider split) is complete. Phases 2 and 3 are pending.

### Completed

- **`section.ts`**: 3710 → ~2187 lines. Extracted 25 modules:
  - `runtime/state.ts` — `AgentRuntime`, `DiagnosticEntry`, `PendingToolFollowUp`, `createAgentRuntime()`
  - `runtime/annotationApprovals.ts` — scoped annotation approval keys, conversation/attachment-scoped always-allow memory, auto-apply decision
  - `runtime/annotationFollowUp.ts` — post-annotation batch follow-up message construction for text-mode and native tool-call turns
  - `runtime/diagnostics.ts` — `recordDiagnostic()`
  - `runtime/requestState.ts` — `requestCancel`, `startWorkingState`, `clearWorkingState`, `startWaitingAnimation`, `stopWaitingAnimation`
  - `runtime/toolActionContent.ts` — `buildMessageActionKey`, `queueToolActionContent`, `takeToolActionContent`
  - `runtime/conversationMessages.ts` — `appendToolResultMessage`, `appendAssistantContinuation`
  - `runtime/conversationStoreService.ts` — `ensureConversationStoreLoaded`, `flushConversationStore`, `scheduleConversationStoreSave`, `writeConversationStoreNow` (uses `ConversationStoreServiceDeps` for DI)
  - `runtime/toolEvents.ts` — `appendToolEventMessage`, `markToolEventDone`, `markToolEventFailed`, `failActiveToolEvent` (uses `ToolEventDeps` for DI)
  - `runtime/userTurn.ts` — user-turn start state, user/assistant message insertion, request-token allocation, initial provider-message projection
  - `toolFollowUpPrompts.ts` — missing-tool repair prompt, tool-result follow-up prompt, annotation batch follow-up prompt
  - `ui/activityStatus.ts` — `renderActivityStatus`, `getActivityStatusInfo`, `formatWebSearchStatus`, `formatToolEventStatus`
  - `ui/composer.ts` — input composer, send/stop button state, submit/Enter handling
  - `ui/controlPanel.ts` — model selector, model fetch button, prompt template selector, reasoning selector/status, web-search/PDF tool toggles
  - `ui/sessionControls.ts` — `SessionControlsHandlers` interface, `createSessionControls()`
  - `ui/sessionOptions.ts` — `limitConversationOptions`, `formatConversationOptionLabel`, `buildConversationExportText`, `copyConversationToClipboard`, `promptRenameConversation`, `showToast`
  - `ui/labels.ts` — `getModelLabel`, `getFetchModelsLabel`, `getReasoningLabel`, `getReasoningOptionLabel`, `getReasoningStatusLabel`, `formatError`, `normalizeAuthKey`, etc.
  - `ui/layout.ts` — `ScrollState`, `isNearBottom`, `scrollToBottom`, `captureScrollState`, `restoreScrollPosition`, `applyRootDimensions`, `ensureBodyResizeObserver`
  - `ui/messageList.ts` — message bubbles, annotation proposal card mount, activity-status mount, message-list scroll tracking
  - `ui/messageMeta.ts` — `createMessageMeta`, `formatMessageDateTime`, `formatWaitSeconds`, `createCopyButton`, `createContextToggle`
  - `ui/modelControls.ts` — `renderModelOptions`, `renderReasoningOptions`
  - `ui/sectionGates.ts` — provider configuration gate, loading gate, provider-configured check
  - `modelListFetch.ts` — model-list HTTP probing, API-key header preparation, `/models` retry and parse handling
  - `modelMetadataRuntime.ts` — runtime model metadata cache helpers, context-window lookup, reasoning-option/status resolution

- **`provider.ts`**: 1356 → ~803 lines. Extracted 3 modules:
  - `provider/streaming.ts` — `StreamCollector`, `ResponseIdleWatchdog`, `createStreamCollector`, `createResponseIdleWatchdog`, SSE parsing, `extractStreamDelta`, `extractReasoningDelta`
  - `provider/responseParsing.ts` — `OpenAIChatResponse`, `extractResponseToolCalls`, `extractFinishReason`, `extractResponseReasoningContent`, error-message classification
  - `provider/endpointHints.ts` — `EndpointHintsMap`, `readEndpointHint`, `rememberEndpointHint`, `isValidWireAPI`

- **Tool module reorganization**: Moved annotation tool state and repair logic under `src/modules/tools/`:
  - `tools/annotationTools.ts` — PDF read/write tool registration and action-to-proposal resolution
  - `tools/annotationProposals.ts` — annotation proposal state machine
  - `tools/annotationRepair.ts` — failed-only annotation batch repair prompt/context helpers
  - `tools/annotationApply.ts` — proposal-to-Zotero annotation mutation helper and attachment lookup cache helper

- **PDF text matching hardening**: Added regression coverage for hyphenated word line-break artifacts across spans and inside a single span. Matching now normalizes Unicode hyphen variants before line-break rejoin so PDF text such as `set‑` + `tings` can match model text `settings`.

- All extraction uses explicit dependency injection (handler/deps interfaces), no runtime singleton coupling.
- Lint, build, and all 161 tests pass.

### Pending Tasks

#### Task #5 — Extract orchestration from `section.ts`

Extract the large orchestration functions into a dedicated module. These are the core chat/tool/annotation flows with deep coupling to 25+ local helpers and the `AgentRuntime`:

- `sendChat()` and follow-up request logic
- `runToolChain()` — tool-action parsing → execute → follow-up loop
- `applyAnnotationBatch()` — proposal batch → Zotero annotation save → follow-up
- `repairAnnotationBatch()` — failed-only batch repair follow-up
- Helper functions: `cancelActiveRequest`, `appendAssistantMessage`, `appendToolResultMessage`, `buildProviderMessages`, `handleStreamProgress`, `handleStreamFinish`

**Challenge**: These functions read and mutate `AgentRuntime` state (messages, pendingToolFollowUp, diagnostics, activeRequestToken) and call back into UI rendering (`renderSectionBody`, `renderMessages`, `scrollToBottom`). The extraction must define a clear orchestration-deps interface that provides:

- State access: `getRuntime()`, `getConversationKey()`, `getScopeKey()`
- Mutation: `appendMessage()`, `updateMessage()`, `touchConversation()`
- UI callbacks: `renderMessages()`, `scrollToBottom()`, `showActivityStatus()`
- Provider: `sendProviderRequest()`
- Tool execution: `executeToolAction()`

Estimated size: ~1000–1200 lines to extract.

#### Task #6 — Extract `renderSectionBody`

Extract into `agent/ui/sectionBody.ts`:

- `renderSectionBody(doc, root, runtime, ...)` — ~470 lines of DOM coordination

**Challenge**: `renderSectionBody` orchestrates the full DOM tree and wires all event handlers. It currently closes over many `section.ts` locals. The extraction must pass a render-context object with all required callbacks.

Estimated size: ~500–600 lines to extract.

### Current State

- Branch: `main`, worktree may be dirty (pending extraction commits)
- Lint: clean
- Build: passes
- Tests: 161 pass, 0 fail
- `section.ts`: ~2187 lines (down from 3710)
- `provider.ts`: ~803 lines (down from 1356)

## Editing Notes For Future Agents

- Preserve user changes. The worktree may be dirty.
- Keep public user-facing Markdown bilingual. English is the primary GitHub-facing version; add a `.zh-CN.md` counterpart and cross-link the pair.
- Keep `section.ts` focused on UI/runtime coordination. New provider-independent logic should usually go into a small pure module under `src/modules/agent/`.
- Keep provider behavior conservative. Third-party gateways differ, so avoid hard-coded endpoint assumptions.
- Keep UI changes compatible with Zotero's native item pane.
- Use official Zotero/plugin-template APIs where possible.
- Run `npm run lint:check`, `npm run build`, and `npm test` after behavior changes.
