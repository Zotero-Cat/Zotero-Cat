# Zotero-Cat

[English](./README.md) | [中文](./README.zh-CN.md)

Zotero-Cat adds an AI assistant to Zotero's item pane. You can use it to ask
about a paper, summarize notes, discuss selected PDF text, search the web when
you allow it, and prepare PDF annotation proposals before Zotero writes them.

Zotero-Cat is independent from Zotero and is not affiliated with Zotero or
Digital Scholar.

## Quick Start

1. Download the current release from
   [GitHub Releases](https://github.com/Zotero-Cat/Zotero-Cat/releases/tag/v0.3.1),
   or download
   [`zotero-cat-v0.3.1.xpi`](https://github.com/Zotero-Cat/Zotero-Cat/releases/download/v0.3.1/zotero-cat-v0.3.1.xpi)
   directly.
2. Open Zotero.
3. Go to `Tools -> Plugins`.
4. Install the XPI file.
5. Open Zotero preferences and configure Zotero-Cat.
6. Select a Zotero item and open the `Zotero-Cat` section in the right item
   pane.

## Requirements

- Zotero 9.x
- macOS, Windows, or Linux supported by Zotero
- An OpenAI-compatible model provider for live chat responses

Zotero 10 beta compatibility is not declared yet.

## Connect A Model Provider

Open the `Zotero-Cat` settings pane in Zotero preferences.

Fill in:

- `Provider`: use `openai-compatible` unless you know you need another preset.
- `Base URL`: use the provider's API base URL, not the website homepage.
- `API Key`: Zotero-Cat stores it in Firefox Login Manager.
- `Model`: fetch the model list if your provider supports `/models`, or enter
  a model name manually.
- `Reasoning effort`: Zotero-Cat shows provider-declared options when the model
  list includes them. Otherwise, keep `Default`.

Use `Test Connection` before saving if you are trying a new provider.

Provider examples: [doc/PROVIDER_SETUP.md](./doc/PROVIDER_SETUP.md) |
[中文](./doc/PROVIDER_SETUP.zh-CN.md)

## What You Can Do

- Chat about the selected Zotero item.
- Ask for summaries, critiques, related-work notes, and method explanations.
- Use selected text from Zotero's PDF reader as context.
- Keep separate chat history per Zotero item.
- Rename, export, favorite, or delete sessions.
- Enable web search when you want Zotero-Cat to fetch search snippets.

Web search uses snippets only. It does not crawl full webpages.

## PDF Tools

PDF tools are experimental and off by default. Turn on `PDF tools` in the chat
controls when you want the assistant to read a PDF or propose annotations.

Current PDF tools can:

- read PDF text from the current item;
- list existing PDF annotations;
- propose highlights, underlines, notes, updates, and deletes;
- show review cards before Zotero writes changes;
- apply accepted proposals through Zotero's annotation APIs.

Zotero-Cat does not let the model write directly to your PDF. Write actions
become proposal cards first unless you explicitly enable auto-apply.

Known PDF limits:

- Highlights need exact text from one PDF page.
- Cross-page highlights should be split into page-local proposals.
- Scanned, encrypted, or OCR-poor PDFs may not provide reliable text.

## Privacy And Storage

Zotero-Cat stores data locally unless you send a chat request or enable web
search.

- API keys: Firefox Login Manager
- Settings: Zotero preferences
- Conversation history: `<Zotero data directory>/zotero-cat/agent-conversations.json`
- Chat content: sent to the model provider you configure
- Web search queries: sent only when you enable web search

Privacy notes: [doc/PRIVACY.md](./doc/PRIVACY.md) |
[中文](./doc/PRIVACY.zh-CN.md)

## Help

- Installation: [doc/INSTALLATION.md](./doc/INSTALLATION.md) |
  [中文](./doc/INSTALLATION.zh-CN.md)
- Provider setup: [doc/PROVIDER_SETUP.md](./doc/PROVIDER_SETUP.md) |
  [中文](./doc/PROVIDER_SETUP.zh-CN.md)
- Changelog: [CHANGELOG.md](./CHANGELOG.md) |
  [中文](./CHANGELOG.zh-CN.md)
- Roadmap: [TODO.md](./TODO.md) | [中文](./TODO.zh-CN.md)
- Releases:
  [GitHub Releases](https://github.com/Zotero-Cat/Zotero-Cat/releases)

## For Contributors

Development notes live in [CONTRIBUTING.md](./CONTRIBUTING.md) and
[AGENTS.md](./AGENTS.md). The project uses Node.js 24 LTS and the
`zotero-plugin-scaffold` toolchain.
