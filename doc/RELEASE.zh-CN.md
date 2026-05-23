# 发布流程

[English](./RELEASE.md) | [中文](./RELEASE.zh-CN.md)

本文定义 Zotero-Cat `0.x` release 门禁。

## 当前兼容目标

截至 2026-05-09，Zotero 下载页显示 release 版本为 Zotero 9，Zotero beta 页面说明 beta 构建来自 Zotero 10 开发线。

当前 Zotero-Cat 发布目标只声明支持 Zotero 9：

```json
{
  "strict_min_version": "9.0",
  "strict_max_version": "9.*"
}
```

当前 Zotero beta 或下一个主要预发布版本通过人工回归清单前，不要为 Zotero 10 扩大 `strict_max_version`。

上游参考：

- Zotero 下载页：<https://www.zotero.org/download/>
- Zotero beta builds：<https://www.zotero.org/support/beta_builds>
- Zotero 插件 manifest 兼容性说明：<https://www.zotero.org/support/dev/zotero_7_for_developers>

## 发布门禁

自动化门禁：

- `npm run lint:check`
- `npm run build`
- `npm test`
- 确认 `.scaffold/build/addon/manifest.json` 包含预期 Zotero 兼容范围。
- GitHub Release workflow 发布资产后，确认 release 中存在 `zotero-cat-v<version>.xpi`，并在发布验证记录中写入资产 digest。

人工门禁：

- 在 Zotero 9 stable 运行 `doc/UI_REGRESSION_CHECKLIST.zh-CN.md`。
- 通过 Zotero `Tools -> Plugins` 安装打包后的 XPI。
- 确认 Zotero 重开后设置仍保留。
- 确认 API Key 仍能通过 Firefox Login Manager 读取。
- 确认 Zotero 重启后会话历史仍保留。
- 声明 beta 或下一个主要版本兼容前，先在当前 Zotero beta 上运行清单。

## 版本策略

`1.0.0` 之前，Zotero-Cat 使用保守的 `0.x` 版本策略：

- Patch 版本，例如 `0.1.1`，用于 bug fix、兼容性元数据更新、文档修正和低风险 Provider 修复。
- Minor 版本，例如 `0.2.0`，可以包含新功能或用户可见行为变化。
- 即使仍处于 `0.x`，破坏性存储、Provider 或 UI contract 变化也必须写入 changelog。
- 预发布版本使用 SemVer pre-release 后缀，例如 `0.2.0-beta.1`。

## 分支和标签

- 主开发分支：`main`。
- 可选发布稳定分支：`release/v0.x`。
- 可选 hotfix 分支：`hotfix/v0.x.y`。
- 正式发布标签：`v0.x.y`。
- 预发布标签：`v0.x.y-alpha`、`v0.x.y-beta.n` 或其他等价 SemVer pre-release 后缀。
- 脚手架管理的 updater assets 发布到名为 `release` 的特殊 GitHub release tag。
- `release` tag 只用于 update manifests。应把它标记为 pre-release 且不设为 Latest，避免它成为公开页面上的可见包版本。

## GitHub Release Workflow

Release workflow 位于 `.github/workflows/release.yml`。

- 手动 `workflow_dispatch` 会运行 lint、build、tests，并上传 release candidate artifact。它不会发布 GitHub Release。
- 推送 `v*` 标签会运行同样检查，上传 artifact，然后执行 `npm run release` 发布 GitHub Release 并更新 manifest assets。
- 发布完成后，workflow 会对特殊 `release` tag 执行 `--prerelease --latest=false`，避免内部 manifest release 抢占公开页面上的 Latest。

每次公开 release 复用同一套检查：

```bash
nvm use
npm ci
npm run lint:check
npm run build
npm test
git status --short
```

相关门禁通过后，创建并推送 release 标签。例如：

```bash
git tag v0.3.1
git push origin v0.3.1
```

当前 release 相关的人工 Zotero 安装、持久化或兼容性检查未完成时，不要创建 release tag。
