# Zotero-Cat

[English](./README.md) | [中文](./README.zh-CN.md)

## Quick Start

Download the current release from
[GitHub Releases](https://github.com/qianjindexiaozu/Zotero-Cat/releases/tag/v0.1.2),
or download
[`zotero-cat.xpi`](https://github.com/qianjindexiaozu/Zotero-Cat/releases/download/v0.1.2/zotero-cat.xpi)
directly. In Zotero, install it from `Tools -> Plugins`.

Zotero-Cat is a Zotero item-pane assistant for reading, summarizing, reviewing, and discussing research items with user-selected model providers. It follows the interaction style of Codex in VS Code, but keeps the provider configurable so users can use OpenAI-compatible gateways, local services, or self-hosted model endpoints.

The name comes from a cat downstairs in the dorm that was looking for something, and from the Linux `cat` command that reads content out loud enough for a pipeline to use.

Zotero-Cat is an independent open-source project and is not affiliated with Zotero.

## Current Status

The current release is `v0.1.2`. It supersedes the earlier
`v0.1.0-alpha` pre-release so alpha users can receive a real version bump from
the package metadata. Automated checks pass for the current Zotero 9 target.

The plugin currently runs as a Zotero item-pane section through `ItemPaneManager.registerSection`. It does not replace Zotero's native right sidebar.

## Main Branch After v0.1.2

The main branch now contains experimental PDF tool agency work that is not yet
promoted to a tagged public release. It is behind the `PDF tools` toggle and is
intended for local validation before a `v0.2.0-alpha` decision.

Current PDF tool work includes:

- `read_pdf` and `list_annotations` tool actions.
- `propose_annotation`, `modify_annotation`, and `delete_annotation` actions
  converted into reviewable proposal cards.
- Accept / Reject / Accept All / Reject All controls before Zotero annotations
  are saved.
- `pdfjs-dist` PDF text extraction with Zotero indexed-text fallback.
- Zotero annotation create/update/delete wrappers and proposal-state tests.

## Implemented Features

- Zotero right-pane `Zotero-Cat` section with icon and localized labels.
- Fixed-height chat panel with bottom input composer.
- Streaming-first assistant output with incremental rendering.
- Send button that switches to a stop button during active requests.
- `Thinking.` / `Thinking..` / `Thinking...` waiting animation.
- Response wait time shown in assistant message metadata.
- Markdown rendering for assistant messages.
- Message selection and copy button with visible copy feedback.
- Provider settings page with Provider, Base URL, API Key, Save, and Test Connection.
- API Key storage through Firefox Login Manager, not plain Zotero prefs.
- OpenAI-compatible request support for `responses` and `chat.completions` endpoints.
- Endpoint probing, stream-first fallback, and successful endpoint path memory.
- Model list fetching from provider `/models` endpoint.
- Model selection, custom model input, and provider-declared reasoning effort selection.
- Zotero context injection for metadata, notes, annotations, and selected PDF text.
- Optional web search context injection with DuckDuckGo, DuckDuckGo HTML fallback, or a user-configured SearXNG JSON endpoint.
- Tool-action parsing for model-emitted web-search JSON, with Zotero-Cat executing the tool only when the user-enabled Web Search toggle is on.
- Read-only context preview with token budget estimate and model context window hint.
- Folded custom context input for user-supplied context per item, persisted locally per item.
- Per-item conversation history with native dropdown, new session, clear, delete, export, rename, and favorite.
- Conversation persistence in a local JSON file under Zotero's data directory with hard capacity limits.
- Diagnostics panel for retries, model list failures, and final request errors.
- Shared pure-logic modules for model metadata parsing, conversation storage, item scoping, retry decisions, and tool actions.
- Unit tests for provider fallback, model probing, context preview, persistence parsing, web search parsing, tool-action parsing, and startup.
- Zotero UI manual regression checklist for release verification.
- Release documentation for installation, provider setup, privacy, compatibility gates, versioning, branches, tags, and GitHub release flow.

## Technology

- Zotero plugin scaffold: `zotero-plugin-scaffold`
- Base template lineage: `windingwind/zotero-plugin-template`
- UI/runtime language: TypeScript
- Zotero target: Zotero 9.x for the current release
- Node runtime: Node.js 24 LTS
- Package manager: npm
- License: `AGPL-3.0-or-later`

## Requirements

- macOS or another Zotero-supported desktop platform
- Zotero 9.x
- Node.js 24 LTS
- npm
- A model provider endpoint if you want live chat responses

The repository contains both `.nvmrc` and `.node-version`, each set to `24`.

## Development Quick Start

1. Switch to the project Node version:

```bash
nvm use
```

If Node 24 is not installed:

```bash
nvm install
```

2. Copy environment configuration:

```bash
cp .env.example .env
```

3. Fill Zotero paths in `.env` if needed by your local scaffold setup.

4. Install dependencies:

```bash
npm install
```

5. Start Zotero with the plugin loaded:

```bash
npm start
```

6. Open Zotero, select an item, and open the `Zotero-Cat` section in the right item pane.

## Install A Packaged XPI

For packaged installation, build or download `zotero-cat.xpi`, then install it from Zotero `Tools -> Plugins`.

Full installation notes are in [doc/INSTALLATION.md](./doc/INSTALLATION.md). A Chinese version is available at [doc/INSTALLATION.zh-CN.md](./doc/INSTALLATION.zh-CN.md).

## Provider Configuration

Open Zotero preferences and find the `Zotero-Cat` settings pane.

Configure:

- Provider ID: currently use `openai-compatible` unless testing a preset path.
- Base URL: use the provider's real API base URL, not the website homepage.
- API Key: saved through Firefox Login Manager.
- Test Connection: checks the current form values without saving them.
- Save Settings: persists provider, base URL, and key after explicit user action.

The chat input area can fetch the model list from the provider. Zotero-Cat expects OpenAI-compatible JSON from `/models`. If a provider does not expose model metadata, use a custom model name and default reasoning effort.

Provider setup examples are in [doc/PROVIDER_SETUP.md](./doc/PROVIDER_SETUP.md). A Chinese version is available at [doc/PROVIDER_SETUP.zh-CN.md](./doc/PROVIDER_SETUP.zh-CN.md).

## Data Storage

Zotero-Cat stores different data in different places:

- Conversation history: local JSON file at `<Zotero data directory>/zotero-cat/agent-conversations.json`.
- Provider, Base URL, selected model, reasoning effort, endpoint hints: Zotero prefs under `extensions.zotero.zoterocat.*`.
- Web search toggle, search provider, and search endpoint: Zotero prefs under `extensions.zotero.zoterocat.*`.
- PDF tools toggle and auto-apply setting: Zotero prefs under `extensions.zotero.zoterocat.*`.
- API Key: Firefox Login Manager, scoped by provider and base URL.
- Custom context: Zotero pref `extensions.zotero.zoterocat.customContextStore`, scoped by Zotero item key.

Conversation persistence limits:

- Maximum 128 persisted conversations globally.
- Maximum 24 persisted conversations per Zotero item.
- Maximum 80 persisted messages per conversation.
- Maximum 12000 characters per persisted message.

More privacy and storage notes are in [doc/PRIVACY.md](./doc/PRIVACY.md). A Chinese version is available at [doc/PRIVACY.zh-CN.md](./doc/PRIVACY.zh-CN.md).

## Development Commands

```bash
npm run lint:check
npm run build
npm test
npm start
```

`npm test` uses `zotero-plugin test --exit-on-finish` so the scaffold test process exits after the suite completes.

## CI And Quality

GitHub Actions uses `.nvmrc` through `actions/setup-node@v4`, installs dependencies with `npm ci`, and runs lint, build, and tests in separate jobs.

Quality entry points:

- Static and formatting check: `npm run lint:check`
- Build and type check: `npm run build`
- Scaffold test suite: `npm test`
- Zotero UI manual regression: [doc/UI_REGRESSION_CHECKLIST.md](./doc/UI_REGRESSION_CHECKLIST.md) and [doc/UI_REGRESSION_CHECKLIST.zh-CN.md](./doc/UI_REGRESSION_CHECKLIST.zh-CN.md)

## Release

Release policy and tagging rules are defined in [doc/RELEASE.md](./doc/RELEASE.md). A Chinese version is available at [doc/RELEASE.zh-CN.md](./doc/RELEASE.zh-CN.md). Changelog entries are tracked in [CHANGELOG.md](./CHANGELOG.md) and [CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md).

The packaged add-on currently declares:

- `strict_min_version`: `9.0`
- `strict_max_version`: `9.*`

Zotero 10 beta compatibility is not declared until the manual checklist passes on the current beta line.

## Repository Layout

- `src/modules/agent/section.ts`: Zotero-Cat item-pane UI, runtime state coordination, and UI events.
- `src/modules/agent/provider.ts`: Provider abstraction, OpenAI-compatible request logic, streaming parser, endpoint probing.
- `src/modules/agent/context.ts`: Zotero metadata, note, annotation, and selected-text context assembly.
- `src/modules/agent/modelMetadata.ts`: Model endpoint candidates, model-list parsing, context-window parsing, and reasoning-effort metadata.
- `src/modules/agent/conversationStore.ts`: Conversation state types, defensive persistence parsing, serialization, and capacity selection.
- `src/modules/agent/itemScope.ts`: Primary Zotero item resolution and per-item scope keys.
- `src/modules/agent/chatRetry.ts`: Chat retry and cancellation classification.
- `src/modules/agent/types.ts`: Shared agent message types.
- `src/modules/agent/toolAction.ts`: Tool action registry, parser, and execution dispatcher.
- `src/modules/agent/webSearchContext.ts`: Web search context orchestration and tool handler registration.
- `src/modules/agent/annotationTools.ts`: PDF read/write tool handler registration and annotation proposal resolution.
- `src/modules/agent/annotationProposals.ts`: Annotation proposal state machine.
- `src/modules/agent/proposalView.ts`: Annotation proposal review UI rendering.
- `src/modules/tools/webSearch.ts`: DuckDuckGo/SearXNG search requests and result parsing.
- `src/modules/tools/pdfReader.ts`: PDF text extraction and text-to-rect matching.
- `src/modules/tools/pdfAnnotations.ts`: Zotero annotation persistence wrappers.
- `src/modules/agent/promptTemplates.ts`: Prompt templates and localized system prompts.
- `src/modules/agent/secureApiKey.ts`: Firefox Login Manager API Key storage.
- `src/modules/preferenceScript.ts`: Preferences pane behavior.
- `addon/locale/en-US/*` and `addon/locale/zh-CN/*`: Fluent localization files.
- `addon/content/icons/*`: Static icon and logo assets.
- `test/*`: Unit and scaffold tests.
- `doc/UI_REGRESSION_CHECKLIST.md` / `doc/UI_REGRESSION_CHECKLIST.zh-CN.md`: Manual Zotero UI release checklist.
- `doc/INSTALLATION.md` / `doc/INSTALLATION.zh-CN.md`: Packaged XPI installation notes.
- `doc/PROVIDER_SETUP.md` / `doc/PROVIDER_SETUP.zh-CN.md`: OpenAI-compatible provider setup examples.
- `doc/PRIVACY.md` / `doc/PRIVACY.zh-CN.md`: Privacy and local data-storage notes.
- `doc/RELEASE.md` / `doc/RELEASE.zh-CN.md`: Versioning, tagging, compatibility, and release workflow.
- `doc/release-notes/*`: Release notes in English and Chinese.
- `doc/release-verification/*`: Release verification records in English and Chinese.

## Roadmap

See [TODO.md](./TODO.md) for the detailed phase plan. A Chinese version is available at [TODO.zh-CN.md](./TODO.zh-CN.md).

Post-0.1.2 hardening:

- Validate the experimental PDF tools on real Zotero 9 libraries before release.
- Verify the latest Zotero beta if available.
- Keep Zotero 9 manual checklist results current after user-visible UI changes.
- Decide whether the next tag is `v0.2.0-alpha` or a narrower patch release.
- Capture real installation screenshots for public release notes.

## Trademark And Non-Affiliation

Zotero-Cat is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Zotero or Digital Scholar. Zotero is a trademark of Corporation for Digital Scholarship.
