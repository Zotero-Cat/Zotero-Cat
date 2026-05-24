# Zotero-Cat UI Regression Checklist

[English](./UI_REGRESSION_CHECKLIST.md) | [中文](./UI_REGRESSION_CHECKLIST.zh-CN.md)

Use this checklist before each release or after larger UI/provider changes. Automated tests cover provider logic, model-list parsing, context preview, and startup loading. This checklist covers interactions inside Zotero's main window that are hard to automate reliably.

## Environment

- Node.js: 24 LTS, run `nvm use`.
- Zotero: current Zotero 9 stable build.
- Launch mode: `npm start` for development checks, packaged `.xpi` for release checks.
- Test data: at least one item with a PDF, one child note, and several PDF annotations.
- Model service: at least one working OpenAI-compatible endpoint.

## Startup And Basic Loading

- [ ] Zotero starts without plugin load failure warnings.
- [ ] The right item pane shows a `Zotero-Cat` section.
- [ ] The `Zotero-Cat` section opens after clicking its sidenav icon.
- [ ] The icon renders without clipping or distortion.
- [ ] Chinese Zotero shows Chinese text; English Zotero shows English text.
- [ ] Zotero's native info, notes, tags, and other item-pane sections still work.

## Preferences Pane

- [ ] The preferences pane opens and the title is `Zotero-Cat`.
- [ ] Provider dropdown, Base URL, and API Key fields allow selection and copying.
- [ ] Save is disabled when nothing changed and enabled after edits.
- [ ] Saving shows success feedback.
- [ ] Save failure shows an error, and the error details are copyable.
- [ ] Test Connection does not save settings implicitly.
- [ ] Saved API Key is restored after closing and reopening preferences.

## Models And Reasoning Effort

- [ ] Fetching the model list loads available models from the endpoint.
- [ ] Model-list failure shows visible diagnostics and does not break the chat UI.
- [ ] The model dropdown and fetch-model button stay on one row and do not overlap at narrow widths.
- [ ] Custom model input works.
- [ ] Reasoning effort only shows provider-declared options; if none are declared, only default appears.
- [ ] Unknown model context window shows `Unknown`; declared context length shows as a number.

## Chat Panel

- [ ] Chat panel height stays fixed and does not grow with message count.
- [ ] Input and send button stay fixed at the bottom of the chat panel.
- [ ] The area below the input has enough space, and the send button is not clipped.
- [ ] Empty sessions show the empty-state text.
- [ ] Multi-turn conversations scroll to the bottom by default.
- [ ] When the user scrolls upward to read history, streaming does not force the view to the bottom.
- [ ] After a response completes, the conversation does not jump to the top.

## Send, Stream, And Stop

- [ ] Clicking send starts a request and switches the button to stop.
- [ ] Send and stop tooltips are correct on hover.
- [ ] Waiting state cycles through `Thinking.` / `Thinking..` / `Thinking...`.
- [ ] Model output renders incrementally during streaming.
- [ ] Response metadata shows local wait time.
- [ ] Clicking stop cancels the request and shows the stopped state.
- [ ] Empty model output shows a clear error.
- [ ] HTML or non-JSON gateway responses show a clear error and response snippet.

## Markdown And Copy

- [ ] Assistant messages render common Markdown: headings, lists, code blocks, quotes, and links.
- [ ] Markdown rendering does not execute scripts or inject unsafe HTML.
- [ ] Message content can be selected and copied.
- [ ] Copy button writes content to the clipboard.
- [ ] Copy success feedback is visible.
- [ ] Top-right toast contrast is readable.

## Zotero Context

- [ ] With metadata enabled, requests include current item title, creators, year, DOI, and related fields.
- [ ] With notes enabled, requests include child notes for the current item.
- [ ] With annotations enabled, requests include PDF annotations.
- [ ] Text selected in Zotero's PDF reader enters the context.
- [ ] Context preview uses the current Zotero language.
- [ ] Provided Zotero context is preview-only and cannot be edited in the preview area.
- [ ] Custom context is folded by default and opens only after user action.
- [ ] Custom context is included in the next request.
- [ ] Token budget hint updates when context changes.
- [ ] Over-budget context shows truncation feedback.

## Conversation History

- [ ] Sessions for the current item can be created, cleared, and deleted.
- [ ] History dropdown appears at the top of the chat area.
- [ ] Native history dropdown shows at most the 8 most recent sessions for the current item.
- [ ] Sessions are isolated between Zotero items.
- [ ] Switching back to an old session restores its messages.
- [ ] Sessions with messages restore after restarting Zotero.
- [ ] Empty sessions do not pollute the history list.

## Packaged XPI Checks

- [ ] Build artifact `.scaffold/build/zotero-cat-v<version>.xpi` installs through Zotero `Tools -> Plugins`.
- [ ] Zotero-Cat appears as an installed plugin after packaged install.
- [ ] Settings survive closing and reopening Zotero after packaged install.
- [ ] API Key lookup still works after packaged install.
- [ ] Conversation history survives a Zotero restart after packaged install.

## Regression Risks

- [ ] Plugin still loads after closing and reopening the Zotero main window.
- [ ] Plugin reload does not register duplicate `Zotero-Cat` sections.
- [ ] Network failure, 401, timeout, and user cancellation produce understandable feedback.
- [ ] Diagnostics panel can be opened and cleared.
- [ ] Console has no unhandled exceptions related to this plugin.

## v0.2 — Onboarding Gate

- [ ] Fresh install with no API key renders only the "Connect your model provider" prompt plus the "Open preferences" button; no chat composer, toggles, or history dropdown show.
- [ ] "Open preferences" navigates to the Zotero-Cat preferences pane.
- [ ] After a valid API key is saved, switching items or reopening the section reveals the full chat UI without requiring a restart.

## v0.2 — PDF Tool Agency

- [ ] `PDF tools` toggle in the chat controls is off by default. Turning it on enables `Auto-apply accepted proposals`.
- [ ] With PDF tools off, asking the model to highlight produces no proposal cards and no hidden mutations.
- [ ] `read_pdf` returns per-page text on a text-based PDF and surfaces a readable error on scanned or encrypted PDFs.
- [ ] `list_annotations` lists keys, pages, types, texts, and comments of existing annotations; keys match what Zotero stores.
- [ ] `propose_annotation` for `highlight` produces a card with a matched page and rects; accepting it creates the highlight at the correct location in Zotero.
- [ ] Highlight proposal with text that does not exist in the PDF is surfaced as a `failed` card with an explanatory error and creates no annotation on accept.
- [ ] `propose_annotation` for `note` succeeds without rects and lands on the requested page.
- [ ] `modify_annotation` updates comment/color/pageLabel of an existing key; `delete_annotation` removes it.
- [ ] While a batch is pending, the composer is locked with the reminder message and cannot send new prompts.
- [ ] Accept All / Reject All resolve every pending card in one click and trigger a model follow-up message summarising the outcome.
- [ ] With `Auto-apply` on, accepted proposals apply without manual clicks and the follow-up still fires.
- [ ] Cancelling the request or closing Zotero while a batch is pending does not corrupt conversation history or leave stray annotations.
