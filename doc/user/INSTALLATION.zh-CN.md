# 安装

[English](./INSTALLATION.md) | [中文](./INSTALLATION.zh-CN.md)

Zotero-Cat 以 Zotero `.xpi` 插件包发布。

## 兼容性

首个候选版本支持 Zotero 9.x。扩大 add-on manifest 兼容范围前，必须先验证 Zotero 10 beta 兼容性。

## 从 Release XPI 安装

1. 从 GitHub release 下载 `zotero-cat-v<version>.xpi`。
2. 打开 Zotero。
3. 选择 `Tools -> Plugins`。
4. 把下载的 `.xpi` 文件拖入 Plugins 窗口。
5. 确认安装提示。
6. 如果 Zotero 提示重启，按提示重启。
7. 选中一个文献条目，在右侧条目面板打开 `Zotero-Cat` section。

Zotero 插件页面也说明了同样的 `.xpi` 安装方式：下载 `.xpi`，打开 `Tools -> Plugins`，把文件拖进 Plugins 窗口。

## 从本地构建安装

```bash
nvm use
npm ci
npm run build
```

本地包生成在：

```text
.scaffold/build/zotero-cat-v<version>.xpi
```

按上面的 `Tools -> Plugins` 流程安装这个文件。

## 安装后

打开 Zotero 设置，配置 Zotero-Cat：

- Provider ID：OpenAI-compatible 服务使用 `openai-compatible`。
- Base URL：填写提供方 API base URL。
- API Key：本地保存到 Firefox Login Manager。
- Test Connection：用表单当前值测试，不保存。
- Save Settings：用户明确点击后保存 Provider、Base URL 和 API Key。

然后选中一个 Zotero 条目，打开 Zotero-Cat 条目面板 section，获取或输入模型，发送一条短测试提示。

## 截图清单

发布公开说明前，从打包 XPI 安装流程中截取真实截图：

- 安装 XPI 前的 Zotero `Tools -> Plugins` 窗口。
- 安装确认提示。
- 安装后的 Zotero-Cat 插件条目。
- Zotero-Cat 设置页，敏感字段需打码。
- 在示例条目上打开的 Zotero-Cat 条目面板。

公开安装文档不要使用生成图或 mock 截图。
