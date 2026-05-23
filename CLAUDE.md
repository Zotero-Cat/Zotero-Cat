# CLAUDE.md

Guidance for Claude Code sessions working in this repository. Keep this file
short. The authoritative handoff document is [`AGENTS.md`](./AGENTS.md); read it
before making non-trivial code changes. Public status and features live in
[`README.md`](./README.md); phased roadmap lives in [`TODO.md`](./TODO.md).

## Behavioral Guidelines

These principles bias toward caution over speed. For trivial tasks, use
judgment.

**Think Before Coding**

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

**Simplicity First**

- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes,
  simplify.

**Surgical Changes**

- Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that **your** changes made unused.
- Don't remove pre-existing dead code unless asked.
- The test: every changed line should trace directly to the user's request.

**Goal-Driven Execution**

- Transform tasks into verifiable goals:
  - "Add validation" → "Write tests for invalid inputs, then make them pass"
  - "Fix the bug" → "Write a test that reproduces it, then make it pass"
  - "Refactor X" → "Ensure tests pass before and after"
- For multi-step tasks, state a brief plan:
  1. [Step] → verify: [check]
  2. [Step] → verify: [check]
  3. [Step] → verify: [check]
- Strong success criteria let you loop independently. Weak criteria ("make it
  work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer
rewrites due to overcomplication, and clarifying questions come before
implementation rather than after mistakes.

## Project Identity

- Product name: `Zotero-Cat`
- Package name: `zotero-cat`
- Current release: `v0.1.2` (`package.json` at this version on `main`)
- Plugin ID: `zotero-cat@qianjindexiaozu.dev`
- Namespace / prefs prefix: `zoterocat` / `extensions.zotero.zoterocat`
- Global Zotero instance: `Zotero.ZoteroCat`
- License: `AGPL-3.0-or-later`
- Zotero target: Zotero 9.x only (do not widen `strict_max_version` above `9.*`
  until the manual checklist passes on a Zotero 10 beta)
- Node runtime: Node.js 24 LTS (`.nvmrc` / `.node-version` / `engines`)

Zotero-Cat is independent from Zotero. Keep the non-affiliation statement in
public-facing docs.

## Commands

Run these from the repo root. `npm install` after pulling dependency changes.

```bash
npm run lint:check   # prettier --check . && eslint .
npm run lint:fix     # prettier --write . && eslint . --fix
npm run build        # zotero-plugin build && tsc --noEmit
npm test             # zotero-plugin test --exit-on-finish
npm start            # zotero-plugin serve (launches Zotero with the plugin)
```

After any behavior change run `npm run lint:check`, `npm run build`, and
`npm test`. For user-visible UI changes also record a result against
[`doc/UI_REGRESSION_CHECKLIST.md`](./doc/UI_REGRESSION_CHECKLIST.md).

Lint policy: ESLint `no-unused-vars` is `warn`, not `off`. Treat new warnings as
something to clean up, not something to ignore.

## Source Layout

- `src/index.ts`, `src/addon.ts`, `src/hooks.ts` — bootstrap, shared state,
  Zotero lifecycle hooks (startup, shutdown, reader selected-text capture).
- `src/modules/agent/section.ts` — item-pane UI, runtime state, event wiring.
  Keep this file focused on UI/runtime coordination; push pure logic into
  sibling modules.
- `src/modules/agent/` pure modules:
  - `provider.ts` — OpenAI-compatible request, streaming, endpoint probing.
  - `context.ts` — Zotero metadata, notes, annotations, selected-text.
  - `modelMetadata.ts` — model list + context window + reasoning effort parsing.
  - `conversationStore.ts` — defensive persistence parsing and capacity limits.
  - `itemScope.ts`, `chatRetry.ts`, `runtimeIds.ts`, `types.ts` — small utils.
  - `promptTemplates.ts`, `secureApiKey.ts`, `markdown.ts` (Markdown → DOM).
  - `toolAction.ts`, `webSearchContext.ts` — tool registry + web search glue.
- `src/modules/tools/webSearch.ts` — DuckDuckGo / SearXNG requests.
- `src/modules/prefsPane.ts`, `src/modules/preferenceScript.ts` — preferences.
- `src/utils/text.ts` — shared text helpers (`collapseWhitespace`, `stripHTML`,
  `truncate`, …). Prefer these over re-implementing in a module.
- `addon/` — `manifest.json`, `prefs.js`, `content/` (icons, CSS, XHTML),
  `locale/en-US/*` and `locale/zh-CN/*` (Fluent strings). Keep locales paired.
- `test/` — pure-logic tests (provider, model probe, context preview, web
  search, startup). Import the pure modules directly; do not add test-only
  exports to `section.ts` or `preferenceScript.ts`.
- `doc/` — release, installation, provider setup, privacy, UI regression
  checklist, and `release-notes/` / `release-verification/`. All user-facing
  Markdown is bilingual (`.md` + `.zh-CN.md`).

## Conventions And Guardrails

- **Keep `section.ts` small.** New provider-independent logic belongs in a pure
  module under `src/modules/agent/`, not inlined into the UI file.
- **Provider behavior is conservative.** Use the user's Base URL as source of
  truth; probe candidate paths, remember successful hints, fall back only on
  recoverable errors before output starts. Never fall back on an invalid API
  key.
- **Tools are owned by Zotero-Cat.** Model emits a JSON action
  (`{ "action": "...", "action_input": { … } }`); `toolAction.ts` parses it,
  executes the registered handler only if the user has enabled the feature, and
  sends one follow-up model request with the result. Do not route through
  provider-native function calling, and do not pull in LangChain/LangGraph.
- **Storage split.** API keys live in Firefox Login Manager via
  `secureApiKey.ts` (keyed by provider + normalized Base URL). Everything else
  (provider, Base URL, model, reasoning effort, endpoint hints, web-search
  settings, conversation store, custom context) lives under Zotero prefs at
  `extensions.zotero.zoterocat.*`. Do not add new API keys to plain prefs.
- **Persistence limits** (in `conversationStore.ts`): 64 conversations global,
  8 per scope, 40 messages per conversation, 8000 chars per message. Honor them.
- **UI strategy.** The plugin is an item-pane section via
  `ItemPaneManager.registerSection`, not a sidebar replacement. Fixed-height
  chat, bottom composer, native dropdown session selector, custom context
  folded by default, Zotero context read-only in preview.
- **Public Markdown is bilingual.** When you change any user-facing doc, update
  both `NAME.md` and `NAME.zh-CN.md` and keep cross-links intact.
- **Preserve user work.** Treat a dirty worktree as in-progress; do not reset,
  force-push, or discard changes without explicit confirmation. Commits only on
  request.
- **Release gate.** Zotero 10 compatibility is not declared until the manual
  checklist passes on the current beta. `strict_max_version` stays at `9.*`.

## CI

`.github/workflows/ci.yml` runs three jobs on push/PR to `main` — `lint`,
`build`, `test`. All use Node from `.nvmrc` via `actions/setup-node@v4` and
install with `npm ci`. Release workflow (`release.yml`) runs the same checks on
`v*` tags and then `npm run release`.

## Further Reading

- [`AGENTS.md`](./AGENTS.md) — full architecture, storage, release workflow,
  and editing notes. Consult this for anything not covered above.
- [`TODO.md`](./TODO.md) — phase plan and backlog.
- [`CHANGELOG.md`](./CHANGELOG.md) — release history.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contributor workflow.
