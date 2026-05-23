# Release Process

[English](./RELEASE.md) | [中文](./RELEASE.zh-CN.md)

This document defines the release gates for Zotero-Cat `0.x` releases.

## Current Compatibility Target

As of 2026-05-09, the Zotero download page lists Zotero 9 as the release
version, and the Zotero beta page says beta builds are from the Zotero 10
development line.

The current Zotero-Cat release target supports Zotero 9 only:

```json
{
  "strict_min_version": "9.0",
  "strict_max_version": "9.*"
}
```

Do not widen `strict_max_version` for Zotero 10 until the manual regression
checklist passes on the current Zotero beta or next major pre-release.

Useful upstream references:

- Zotero download page: <https://www.zotero.org/download/>
- Zotero beta builds: <https://www.zotero.org/support/beta_builds>
- Zotero plugin manifest compatibility guidance:
  <https://www.zotero.org/support/dev/zotero_7_for_developers>

## Release Gates

Automated gates:

- `npm run lint:check`
- `npm run build`
- `npm test`
- Confirm `.scaffold/build/addon/manifest.json` contains the intended
  Zotero compatibility range.
- After the GitHub Release workflow publishes the asset, confirm
  `zotero-cat-v<version>.xpi` exists on the release and record the asset digest
  in a release verification note.

Manual gates:

- Run `doc/UI_REGRESSION_CHECKLIST.md` on Zotero 9 stable.
- Install the packaged XPI through Zotero `Tools -> Plugins`.
- Confirm settings survive reopening Zotero.
- Confirm API Key lookup still works through Firefox Login Manager.
- Confirm conversation history survives a Zotero restart.
- Run the checklist on the current Zotero beta before declaring beta or next
  major compatibility.

## Versioning Policy

Until `1.0.0`, Zotero-Cat uses conservative `0.x` versioning:

- Patch releases, such as `0.1.1`, are for bug fixes, compatibility metadata
  updates, documentation fixes, and low-risk provider fixes.
- Minor releases, such as `0.2.0`, may include new features or user-visible
  behavior changes.
- Breaking storage, provider, or UI contract changes must be called out in the
  changelog even during `0.x`.
- Pre-releases use SemVer pre-release suffixes such as `0.2.0-beta.1`.

## Branches And Tags

- Main development branch: `main`.
- Optional release stabilization branch: `release/v0.x`.
- Optional hotfix branch: `hotfix/v0.x.y`.
- Published release tags: `v0.x.y`.
- Pre-release tags: `v0.x.y-alpha`, `v0.x.y-beta.n`, or equivalent SemVer
  pre-release suffixes.
- The scaffold-managed updater assets are published to the special GitHub
  release tag named `release`.
- The `release` tag is only for update manifests. Mark it as a pre-release and
  not Latest so it does not become the visible public package release.

## GitHub Release Workflow

The release workflow lives at `.github/workflows/release.yml`.

- Manual `workflow_dispatch` runs lint, build, tests, and uploads the release
  candidate artifact. It does not publish a GitHub Release.
- Pushing a `v*` tag runs the same checks, uploads the artifact, then runs
  `npm run release` to publish the GitHub Release and update manifest assets.
- After publishing, the workflow marks the special `release` tag as
  `--prerelease --latest=false` so the public package release remains the
  visible release.

Repeat the same checks for each public release:

```bash
nvm use
npm ci
npm run lint:check
npm run build
npm test
git status --short
```

After the relevant gates pass, create and push the release tag. For example:

```bash
git tag v0.3.1
git push origin v0.3.1
```

Do not tag a release while the relevant manual Zotero installation,
persistence, or compatibility checks for that release are still unresolved.
