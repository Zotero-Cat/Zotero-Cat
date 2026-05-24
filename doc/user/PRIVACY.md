# Privacy And Data Storage

[English](./PRIVACY.md) | [中文](./PRIVACY.zh-CN.md)

Zotero-Cat is a local Zotero plugin. It does not provide or use a Zotero-Cat
cloud backend.

## Data Sent To Model Providers

When you send a chat request, Zotero-Cat sends the selected prompt and enabled
context directly from Zotero to the configured provider endpoint.

Depending on enabled options, a request may include:

- Your current chat messages.
- The selected Zotero item's title, creators, year, DOI, URL, and abstract.
- Child notes for the selected item.
- PDF annotations for the selected item.
- Text recently selected in Zotero's PDF reader.
- Custom context typed into the Zotero-Cat chat panel.
- When PDF tools are enabled, extracted PDF text, existing annotation details,
  and the summary of accepted/rejected annotation proposals may be sent to the
  configured model provider as part of tool follow-up prompts.

Disable context toggles before sending if a provider should not receive that
data.

## Data Sent To Search Providers

Web search is off by default. If you enable it in the chat panel, Zotero-Cat
sends a search query to the configured search provider before the model request.
The query can include your prompt and selected item hints such as title, DOI, or
year. Returned search snippets and URLs are then injected into the model context.

Search-provider retention, logging, and deletion policies are controlled by the
search provider you configure.

## PDF Tool Access

PDF tools are off by default. When enabled, Zotero-Cat may read the selected
item's PDF attachment locally through `pdfjs-dist` or Zotero indexed full text,
list existing Zotero annotations, and prepare annotation changes for review.
Write operations are routed through Zotero-Cat proposal cards before Zotero
annotation APIs are called.

Accepted annotation proposals are saved inside the Zotero library as normal
Zotero annotations. Rejected proposals are kept only in the in-memory proposal
batch for the current session and are not saved as Zotero annotations.

## Local Data Storage

Zotero-Cat stores:

- Conversation history in a local JSON file at
  `<Zotero data directory>/zotero-cat/agent-conversations.json`.
- Provider ID, Base URL, selected model, reasoning effort, and endpoint hints in
  Zotero prefs under `extensions.zotero.zoterocat.*`.
- Web search enablement, provider ID, and endpoint in Zotero prefs under
  `extensions.zotero.zoterocat.*`.
- PDF tools enablement and auto-apply preference in Zotero prefs under
  `extensions.zotero.zoterocat.*`.
- API Keys in Firefox Login Manager, scoped by provider and Base URL.
- Per-item custom context in Zotero pref
  `extensions.zotero.zoterocat.customContextStore`.

Conversation history is capped globally, per item, per conversation, and per
message to reduce unbounded local storage growth. Custom context is scoped by
Zotero item key.

## Data Not Stored By Zotero-Cat

Zotero-Cat does not intentionally store API Keys in plain Zotero prefs.
Zotero-Cat does not upload data to a project-operated service.

Provider-side retention, logging, training, and deletion policies are controlled
by the provider you configure.

## Removing Local Data

- Delete conversations from the Zotero-Cat session controls.
- To remove all conversation history outside the UI, delete
  `<Zotero data directory>/zotero-cat/agent-conversations.json`.
- Clear custom context from the Zotero-Cat context editor for the relevant item.
- Clear or change provider settings from the Zotero-Cat preferences pane.
- Remove saved API Keys through the host Firefox/Zotero Login Manager storage if
  you need to purge credentials outside the plugin UI.
