# Installation

[English](./INSTALLATION.md) | [中文](./INSTALLATION.zh-CN.md)

Zotero-Cat is distributed as a Zotero `.xpi` plugin package.

## Compatibility

The first release candidate supports Zotero 9.x. Zotero 10 beta compatibility
must be verified before widening the add-on manifest range.

## Install From A Release XPI

1. Download the `zotero-cat-v<version>.xpi` asset from the GitHub release.
2. Open Zotero.
3. Choose `Tools -> Plugins`.
4. Drag the downloaded `.xpi` file onto the Plugins window.
5. Confirm the installation prompt.
6. Restart Zotero if prompted.
7. Select a library item and open the `Zotero-Cat` section in the right item
   pane.

Zotero's plugin page documents the same general installation path for `.xpi`
plugins: download the `.xpi`, open `Tools -> Plugins`, and drag the file onto
the Plugins window.

## Install From A Local Build

```bash
nvm use
npm ci
npm run build
```

The local package is generated at:

```text
.scaffold/build/zotero-cat-v<version>.xpi
```

Install that file through `Tools -> Plugins` as described above.

## After Installing

Open Zotero preferences and configure Zotero-Cat:

- Provider ID: use `openai-compatible` for OpenAI-compatible services.
- Base URL: use the provider's API base URL.
- API Key: saved locally through Firefox Login Manager.
- Test Connection: checks the form values without saving.
- Save Settings: persists provider, Base URL, and API Key after explicit user
  action.

Then select a Zotero item, open the Zotero-Cat item-pane section, fetch or enter
a model, and send a short test prompt.

## Screenshot Capture List

Before publishing public release notes, capture real screenshots from the
packaged XPI installation flow:

- Zotero `Tools -> Plugins` window before installing the XPI.
- Installation confirmation prompt.
- Installed Zotero-Cat plugin entry after installation.
- Zotero-Cat preferences pane with sensitive fields redacted.
- Zotero-Cat item-pane section opened on a sample item.

Do not use generated or mock screenshots for public installation docs.
