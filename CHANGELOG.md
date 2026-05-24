# Changelog

[English](./CHANGELOG.md) | [中文](./CHANGELOG.zh-CN.md)

All notable project changes are tracked here. Zotero-Cat uses `0.x`
versions until the first public stability commitment.

## [Unreleased]

### Changed

- README is now a user-focused guide with installation, provider setup, PDF
  tools, privacy, and help links instead of development internals and repository
  structure.
- User, project, and release Markdown has been grouped under `doc/user/`,
  `doc/project/`, and `doc/release/`; the Claude-specific handoff now lives
  under `.claude/`.

### Fixed

- GitHub Release notes now use absolute bilingual links so the Chinese release
  note link no longer resolves under `/releases/tag/...` and returns 404.
- The release workflow now applies `doc/release/notes/<version>.md` to the
  GitHub Release body after publishing, avoiding auto-generated placeholder
  notes.

## [0.3.1] - 2026-05-23

### Fixed

- PDF highlight/underline matching now treats model-emitted line-break hyphen
  spacing such as `fine- tuning` as an alternate for inline PDF compounds such
  as `fine-tuning`, while preserving the existing dehyphenated line-break path.
- GLM-style truncated quotes now still fall back when the trailing ellipsis is
  followed by closing quotes or sentence punctuation.

## [0.3.0] - 2026-05-23

### Fixed

- Native `tool_calls` round-trips now persist `role: "tool"` messages into
  conversation history, so the next user turn no longer replays an orphan
  `assistant{tool_calls}` and trips strict providers with
  "insufficient tool messages following tool_calls message" (observed against
  DeepSeek). `toProviderMessages` also runs a defensive
  `sanitizeToolCallSequences` pass for cancellation / partial-failure paths.
- PDF highlight/underline matching now handles GLM-style quoted text that ends
  with an ellipsis after a partial next sentence by retrying the last complete
  sentence before the ellipsis.
- Tool execution no longer renders separate tool-event chat bubbles or empty
  assistant placeholders; the chat now shows one inline activity row that
  updates as tools/search run.
- The activity row now prioritizes the currently running tool over stale web
  search status, so annotation preparation / application shows as annotation
  work instead of continuing to display search progress.
- The activity row now uses a continuous CSS spinner across the full model/tool
  turn, and the item-pane chat height defaults to 85% of the visible page.
- Web search no longer caps default results at 5 items.
- Web search tools now expose `maxResults` / `count` / `limit` so the model can
  request the amount of results it needs; SearXNG searches page forward when a
  larger finite result count is requested.
- Manual Zotero-context injection toggles were removed from the chat controls.
  When PDF tools are enabled, Zotero-Cat uses tool-first PDF access instead of
  pre-injecting metadata, notes, annotations, or selected text.
- The custom context, context preview, and diagnostics disclosure panels were
  removed from the chat controls; custom-context text is no longer injected
  from the item-pane UI.
- PDF highlight/underline matching also falls back to complete sentence-sized
  verbatim spans when a long model quote continues with a non-verbatim
  sentence.
- PDF highlight/underline matching now tolerates narrow orthographic variants
  such as `can not` / `cannot` and model-written compound hyphens where PDF
  line-break extraction dehyphenated the indexed text.

## [0.2.0] - 2026-05-19

### Added

- Experimental PDF tool agency behind the `PDF tools` toggle, including
  `read_pdf`, `list_annotations`, annotation proposal actions, proposal review
  cards, and Zotero annotation create/update/delete wrappers.
- Lazy `pdfjs-dist` PDF text extraction with Zotero indexed-text fallback.
- Annotation proposal state machine and tests for proposal status transitions.
- PDF text matching and annotation JSON helper tests.
- File-backed conversation history under the Zotero data directory, with
  legacy preference migration.
- Dedicated pure modules for in-memory conversation runtime state,
  custom-context storage, and tool-event state.

### Changed

- Tool-action parsing can now return multiple actions per assistant turn, and
  handlers declare whether they are read-only.
- Model output display and tool-action handling now run as separate pipelines
  so executable tool calls can proceed before slow provider stream finalization.
- PDF highlight placement now keeps pdf.js text spans in PDF user coordinates
  instead of flipping the Y axis, reducing misplaced highlights.
- Annotation proposals without a reliable page hint now fail on ambiguous
  multi-page matches instead of silently choosing the first occurrence.
- `read_pdf` now tells the model when its result is truncated and instructs it
  to read the exact target page before proposing highlights.
- Highlight and underline repair prompts now require continuous page-local PDF
  text and tell the model to split cross-page highlights into separate
  proposals.
- The PDF tool auto-apply toggle now skips the pending confirmation card and
  proceeds directly to applying accepted proposals.
- Tool-call status messages use a compact inline state row instead of a dashed
  card.

### Fixed

- Assistant replies such as "I will use a complete sentence from page 16" after
  a failed annotation are now treated as missing tool-action intent, prompting a
  repair turn instead of silently stopping.
- Failed annotation proposals remain non-actionable when the PDF quote cannot
  be located, preventing guessed highlights.

## [0.1.2] - 2026-05-10

### Changed

- Extracted shared text utilities (`collapseWhitespace`, `stripHTML`, `truncate`,
  etc.) to `src/utils/text.ts`, consolidating duplicated implementations across
  `context.ts`, `webSearch.ts`, `toolAction.ts`, `provider.ts`, and `section.ts`.
- Extracted Markdown-to-DOM rendering (~230 lines) from `section.ts` into
  `src/modules/agent/markdown.ts`.
- ESLint `no-unused-vars` rule changed from `off` to `warn`.
- `section.ts` size reduced by removing the inlined Markdown renderer and
  duplicated utility functions.
- Added periodic expired-entry cleanup for the selected-text cache in
  `context.ts`.
- Added a Zotero 10 `Components.Constructor` compatibility verification item
  to the project phase plan.

## [0.1.1] - 2026-05-09

### Added

- Optional web search tool flow with DuckDuckGo, DuckDuckGo HTML fallback, and
  SearXNG JSON support.
- Tool-action registry and parser for model-emitted JSON actions such as web
  search requests.
- Per-item custom context persistence through `customContextStore`.
- Conversation export, rename, and favorite controls.

### Changed

- Expanded selected-text, note, annotation, and system-context budgets to reduce
  premature prompt truncation.
- README, TODO, privacy notes, and implementation handoff docs now describe the
  current release state and local storage behavior.
- Package version is bumped to `0.1.1` so users who installed the earlier
  `v0.1.0-alpha` pre-release receive a real package-version upgrade.

## [0.1.0-alpha] - 2026-05-03

### Added

- Zotero item-pane assistant section with localized chat UI.
- OpenAI-compatible provider support with streaming output, endpoint probing,
  endpoint fallback, model list fetching, and provider-declared reasoning
  effort controls.
- Zotero context injection for item metadata, notes, PDF annotations, selected
  PDF text, and request-scoped custom context.
- Per-item conversation history with Zotero-pref persistence, active session
  tracking, and hard capacity limits.
- API Key storage through Firefox Login Manager.
- Diagnostics panel for retry, model-list, timeout, cancellation, and provider
  errors.
- Shared pure-logic modules for model metadata parsing, conversation storage,
  item scoping, retry classification, runtime IDs, and agent message types.
- Automated tests for provider fallback, model probing, context preview,
  conversation persistence parsing, streaming delta parsing, and startup.
- Release documentation for installation, provider setup, privacy, versioning,
  tagging, and manual compatibility gates.

### Changed

- Packaged add-on compatibility is restricted to Zotero 9 for the initial
  alpha: `strict_min_version` is `9.0` and `strict_max_version` is
  `9.*`.
- GitHub release workflow now runs lint, build, tests, and artifact upload
  directly in this repository before publishing on `v*` tags.

### Release Notes

- Zotero 10 beta compatibility is intentionally not declared until the manual
  UI checklist has been run against the current Zotero beta line.
- Packaged-XPI install and persistence checks must be recorded before a public
  GitHub release is tagged.
