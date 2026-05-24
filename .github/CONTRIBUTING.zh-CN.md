# 参与 Zotero-Cat 开发

[English](./CONTRIBUTING.md) | [中文](./CONTRIBUTING.zh-CN.md)

感谢你的贡献。

## 基本约定

- 许可证：除非维护者明确说明，所有贡献默认按 `AGPL-3.0-or-later` 授权。
- 较大改动先讨论：涉及 UI、存储、Provider 或 release workflow 的大改动，请先开 Issue 说明设计和范围。
- PR 保持聚焦：每个 PR 只处理一个功能、修复或文档改动。

## 本地开发

- 使用 Node.js 24 LTS。仓库已提供 `.nvmrc` 和 `.node-version`。
- 开发前运行 `nvm use`。如果本机没有 Node 24，运行 `nvm install`。
- 使用 npm 管理依赖和执行脚本。
- 首个候选版本的目标运行环境为 Zotero 9.x。

## Pull Request 清单

- 变更有 Issue、PR 描述或 release note，说明用户影响。
- PR 不包含无关重构。
- 高风险变更包含自动化测试或人工验证记录。
- 面向用户的 Markdown 更新同时提供英文和中文版本。
- 必要文档已更新，包括 README、TODO、release notes 或实现说明。

## 代码风格

- 优先使用 TypeScript，并保持模块边界清晰。
- 不要硬编码模型厂商；通过 Provider 抽象接入。
- 可脱离 Zotero UI 状态测试的 provider-independent 逻辑，应放进小型纯逻辑模块。
- 错误要可观察：通过日志、UI 提示或可复制诊断详情暴露。
