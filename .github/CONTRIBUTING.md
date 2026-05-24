# Contributing to Zotero-Cat

[English](./CONTRIBUTING.md) | [中文](./CONTRIBUTING.zh-CN.md)

Thank you for contributing.

## Ground Rules

- License: all contributions use `AGPL-3.0-or-later` unless the maintainers explicitly say otherwise.
- Discuss larger changes first: open an issue before broad UI, storage, provider, or release-workflow changes.
- Keep pull requests focused: each PR should cover one feature, fix, or documentation change.

## Local Development

- Use Node.js 24 LTS. The repository includes `.nvmrc` and `.node-version`.
- Run `nvm use` before development. If Node 24 is missing, run `nvm install`.
- Use npm for dependency management and scripts.
- Target runtime: Zotero 9.x for the first release candidate.

## Pull Request Checklist

- The change has an issue, PR description, or release-note entry explaining the user impact.
- The PR does not include unrelated refactors.
- Higher-risk changes include tests or a manual verification note.
- User-facing Markdown updates include matching English and Chinese versions.
- Necessary docs are updated, including README, TODO, release notes, or implementation notes when relevant.

## Code Style

- Prefer TypeScript and clear module boundaries.
- Do not hard-code model vendors. Use the Provider abstraction.
- Keep provider-independent logic in small pure modules when it can be tested without Zotero UI state.
- Make errors observable through logs, UI feedback, or copyable diagnostic details.
