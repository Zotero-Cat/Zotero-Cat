# Zotero-Cat

[English](./README.md) | [中文](./README.zh-CN.md)

Zotero-Cat 在 Zotero 条目面板里加入一个 AI 助手。你可以用它讨论论文、总结笔记、解释选中的 PDF 文本、在允许时联网搜索，并在 Zotero 写入前先审阅 PDF 标注提议。

Zotero-Cat 是独立开源项目，不隶属于 Zotero，也不由 Zotero 或 Digital Scholar 背书。

## 快速开始

1. 从 [GitHub Releases](https://github.com/Zotero-Cat/Zotero-Cat/releases/tag/v0.3.1)
   下载当前正式版本，或直接下载
   [`zotero-cat-v0.3.1.xpi`](https://github.com/Zotero-Cat/Zotero-Cat/releases/download/v0.3.1/zotero-cat-v0.3.1.xpi)。
2. 打开 Zotero。
3. 进入 `Tools -> Plugins`。
4. 安装 XPI 文件。
5. 打开 Zotero 设置，配置 Zotero-Cat。
6. 选中文献条目，在右侧条目面板中打开 `Zotero-Cat` section。

## 环境要求

- Zotero 9.x
- Zotero 支持的 macOS、Windows 或 Linux
- 如需真实聊天回复，需要一个 OpenAI-compatible 模型提供方

Zotero 10 beta 兼容性尚未声明。

## 连接模型提供方

在 Zotero 设置中打开 `Zotero-Cat` 设置页。

填写：

- `Provider`：一般使用 `openai-compatible`，除非你明确需要其他预设。
- `Base URL`：填写提供方的 API base URL，不要填写网站首页。
- `API Key`：Zotero-Cat 会把它保存到 Firefox Login Manager。
- `Model`：如果提供方支持 `/models`，可以拉取模型列表；否则手动输入模型名。
- `Reasoning effort`：只有提供方在模型列表中声明时才会显示更多选项。没有声明时保持 `Default`。

第一次接入提供方时，建议先点 `Test Connection`。

Provider 示例：[doc/user/PROVIDER_SETUP.zh-CN.md](./doc/user/PROVIDER_SETUP.zh-CN.md) |
[English](./doc/user/PROVIDER_SETUP.md)

## 可以用来做什么

- 围绕当前 Zotero 条目聊天。
- 生成摘要、审稿意见、相关工作笔记和方法解释。
- 把 Zotero PDF 阅读器中的选中文本作为上下文。
- 按 Zotero 条目保存独立会话历史。
- 重命名、导出、收藏或删除会话。
- 在需要时开启联网搜索，让 Zotero-Cat 获取搜索片段。

联网搜索目前只使用搜索片段，不抓取完整网页。

## PDF 工具

PDF 工具仍是实验功能，默认关闭。需要让助手读取 PDF 或提议标注时，在聊天控制区打开 `PDF tools`。

当前 PDF 工具可以：

- 读取当前条目的 PDF 文本；
- 列出已有 PDF 标注；
- 提议高亮、下划线、笔记、修改和删除；
- 在 Zotero 写入前展示审阅卡片；
- 通过 Zotero 标注 API 应用已接受的提议。

Zotero-Cat 不允许模型直接写入 PDF。写操作会先变成提议卡片，除非你明确开启自动应用。

PDF 已知限制：

- 高亮需要来自单个 PDF 页面的精确文本。
- 跨页高亮应拆成每页一条提议。
- 扫描件、加密 PDF 或 OCR 质量较差的 PDF 可能无法提供可靠文本。

## 隐私和存储

除非你发送聊天请求或开启联网搜索，Zotero-Cat 的数据都保存在本地。

- API Key：Firefox Login Manager
- 设置：Zotero preferences
- 会话历史：`<Zotero data directory>/zotero-cat/agent-conversations.json`
- 聊天内容：发送给你配置的模型提供方
- 联网搜索查询：只在你开启联网搜索时发送

隐私说明：[doc/user/PRIVACY.zh-CN.md](./doc/user/PRIVACY.zh-CN.md) |
[English](./doc/user/PRIVACY.md)

## 帮助

- 安装说明：[doc/user/INSTALLATION.zh-CN.md](./doc/user/INSTALLATION.zh-CN.md) |
  [English](./doc/user/INSTALLATION.md)
- Provider 设置：[doc/user/PROVIDER_SETUP.zh-CN.md](./doc/user/PROVIDER_SETUP.zh-CN.md) |
  [English](./doc/user/PROVIDER_SETUP.md)
- 更新日志：[CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md) |
  [English](./CHANGELOG.md)
- Roadmap：[doc/project/TODO.zh-CN.md](./doc/project/TODO.zh-CN.md) |
  [English](./doc/project/TODO.md)
- 发布页：[GitHub Releases](https://github.com/Zotero-Cat/Zotero-Cat/releases)

## 贡献者入口

开发说明见 [.github/CONTRIBUTING.zh-CN.md](./.github/CONTRIBUTING.zh-CN.md)
和 [AGENTS.md](./AGENTS.md)。项目使用 Node.js 24 LTS 和 `zotero-plugin-scaffold` 工具链。
