# Zotero-Cat

[English](./README.md) | [中文](./README.zh-CN.md)

## 快速开始

从 [GitHub Releases](https://github.com/Zotero-Cat/Zotero-Cat/releases/tag/v0.3.1)
下载当前正式版本，或直接下载
[`zotero-cat-v0.3.1.xpi`](https://github.com/Zotero-Cat/Zotero-Cat/releases/download/v0.3.1/zotero-cat-v0.3.1.xpi)。在
Zotero 中通过 `Tools -> Plugins` 安装。

Zotero-Cat 是一个 Zotero 条目面板助手，用于阅读、总结、审阅和讨论文献条目。它的交互风格参考 Codex in VS Code，但模型提供方由用户配置，可接入 OpenAI-compatible 网关、本地服务或自托管模型端点。

这个名字来自宿舍楼下那正在找东西的猫咪，也来自 Linux `cat` 命令：把内容读出来，交给下一段流程使用。

Zotero-Cat 是独立开源项目，不隶属于 Zotero，也不由 Zotero 或 Digital Scholar 背书。

## 当前状态

当前版本是 `v0.3.1`。它修复 GLM 风格省略号引文和模型输出断行连字符空格导致的 PDF 文本匹配回归，并保留 `v0.3.0` 的工具调用加固。

插件当前通过 `ItemPaneManager.registerSection` 作为 Zotero 条目面板里的一个 section 运行，不替换 Zotero 原生右侧栏。

## PDF 工具代理

PDF 工具仍是实验功能，默认关闭。当前 PDF 工具工作包括：

- `read_pdf` 和 `list_annotations` 工具 action。
- 将 `propose_annotation`、`modify_annotation`、`delete_annotation` 转换为可审阅的待确认卡片。
- 在 Zotero 批注保存前提供 Accept / Reject / Accept All / Reject All 控件。
- 使用 `pdfjs-dist` 抽取 PDF 文本，并在需要时回退到 Zotero 索引文本。
- 高亮使用单页内原文定位；跨页内容需要拆成每页一条提议。
- Zotero 标注新建/修改/删除封装，以及提议状态机测试。

## 已实现功能

- Zotero 右侧条目面板 `Zotero-Cat` section，带图标和中英文界面文本。
- 固定高度聊天面板，输入区固定在底部。
- 流式优先的助手输出和增量渲染。
- 发送按钮在请求中切换为终止按钮。
- `Thinking.` / `Thinking..` / `Thinking...` 等待动画。
- 助手消息显示本地响应等待耗时。
- 助手消息支持 Markdown 渲染。
- 消息可选中、可复制，复制后有可见反馈。
- 设置页支持 Provider、Base URL、API Key、保存和测试连接。
- API Key 使用 Firefox Login Manager 保存，不写入普通 Zotero prefs。
- 支持 OpenAI-compatible 的 `responses` 和 `chat.completions` 请求。
- 端点探测、流式优先 fallback、成功端点路径记忆。
- 从提供方 `/models` 获取模型列表。
- 聊天区支持模型选择、自定义模型输入和提供方声明的 reasoning effort。
- 注入 Zotero 条目元数据、笔记、PDF 批注和 PDF 选中文本。
- 可选联网搜索上下文注入，支持 DuckDuckGo、DuckDuckGo HTML fallback 或用户配置的 SearXNG JSON 接口。
- 支持解析模型输出的联网搜索 JSON action；只有用户开启 Web Search 开关时，才由 Zotero-Cat 执行工具。
- 只读上下文预览、token 预算估算、模型上下文窗口提示。
- 每个条目的折叠式自定义上下文输入，并按条目本地持久化。
- 每条 Zotero 文献独立的历史会话，支持新建、清空、删除、导出、重命名和收藏。
- 会话历史写入 Zotero 数据目录下的本地 JSON 文件，并设置容量上限。
- 诊断面板展示重试、模型列表失败和请求错误。
- 模型元数据、会话存储、条目作用域、重试判断和工具调用已拆到可测试的纯逻辑模块。
- 自动化测试覆盖 Provider fallback、模型探测、上下文预览、持久化解析、联网搜索解析、工具 action 解析和启动加载。
- 发布文档覆盖安装、Provider 配置、隐私、兼容性门禁、版本规则、分支/标签和 GitHub release 流程。

## 技术栈

- Zotero 插件脚手架：`zotero-plugin-scaffold`
- 基础模板来源：`windingwind/zotero-plugin-template`
- UI/runtime 语言：TypeScript
- Zotero 目标版本：当前正式版本支持 Zotero 9.x
- Node runtime：Node.js 24 LTS
- 包管理器：npm
- 许可证：`AGPL-3.0-or-later`

## 环境要求

- macOS 或其他 Zotero 支持的桌面系统
- Zotero 9.x
- Node.js 24 LTS
- npm
- 如需真实聊天回复，需要可用的模型提供方端点

仓库包含 `.nvmrc` 和 `.node-version`，两者均设置为 `24`。

## 本地开发

1. 切换到项目 Node 版本：

```bash
nvm use
```

如果本机没有 Node 24：

```bash
nvm install
```

2. 复制环境配置：

```bash
cp .env.example .env
```

3. 按本机脚手架配置填写 `.env` 中的 Zotero 路径。

4. 安装依赖：

```bash
npm install
```

5. 启动带插件的 Zotero：

```bash
npm start
```

6. 在 Zotero 中选中文献条目，打开右侧条目面板里的 `Zotero-Cat` section。

## 安装打包后的 XPI

发布候选安装时，先构建或下载 release XPI，然后在 Zotero `Tools -> Plugins` 中安装。

完整安装说明见 [doc/INSTALLATION.zh-CN.md](./doc/INSTALLATION.zh-CN.md)。英文版见 [doc/INSTALLATION.md](./doc/INSTALLATION.md)。

## Provider 配置

打开 Zotero 设置，找到 `Zotero-Cat` 设置页。

需要配置：

- Provider ID：当前使用 `openai-compatible`，除非在测试预设路径。
- Base URL：填写模型提供方真实 API base URL，不要填写网站首页。
- API Key：通过 Firefox Login Manager 保存。
- Test Connection：用当前表单值测试连接，不会隐式保存。
- Save Settings：用户明确点击后保存 Provider、Base URL 和 API Key。

聊天输入区可以从提供方获取模型列表。Zotero-Cat 期望 `/models` 返回 OpenAI-compatible JSON。没有模型元数据时，可以手动输入模型名，并把 reasoning effort 保持为 default。

Provider 示例见 [doc/PROVIDER_SETUP.zh-CN.md](./doc/PROVIDER_SETUP.zh-CN.md)。英文版见 [doc/PROVIDER_SETUP.md](./doc/PROVIDER_SETUP.md)。

## 数据存储

Zotero-Cat 把不同数据保存在不同位置：

- 会话历史：本地 JSON 文件 `<Zotero data directory>/zotero-cat/agent-conversations.json`。
- Provider、Base URL、当前模型、reasoning effort、端点提示：`extensions.zotero.zoterocat.*` 下的 Zotero prefs。
- 联网搜索开关、搜索提供方和搜索接口：`extensions.zotero.zoterocat.*` 下的 Zotero prefs。
- PDF 工具开关和自动应用设置：`extensions.zotero.zoterocat.*` 下的 Zotero prefs。
- API Key：Firefox Login Manager，按 Provider 和 Base URL 分作用域。
- 自定义上下文：Zotero pref `extensions.zotero.zoterocat.customContextStore`，按 Zotero 条目隔离。

会话持久化限制：

- 全局最多保存 128 个会话。
- 每个 Zotero 条目最多保存 24 个会话。
- 每个会话最多保存 80 条消息。
- 每条消息最多保存 12000 个字符。

隐私和存储说明见 [doc/PRIVACY.zh-CN.md](./doc/PRIVACY.zh-CN.md)。英文版见 [doc/PRIVACY.md](./doc/PRIVACY.md)。

## 开发命令

```bash
npm run lint:check
npm run build
npm test
npm start
```

`npm test` 使用 `zotero-plugin test --exit-on-finish`，测试完成后脚手架进程会退出。

## CI 与质量检查

GitHub Actions 通过 `.nvmrc` 使用 `actions/setup-node@v4`，执行 `npm ci`，并分别运行 lint、build 和 tests。

质量入口：

- 静态与格式检查：`npm run lint:check`
- 构建与类型检查：`npm run build`
- 脚手架测试套件：`npm test`
- Zotero UI 人工回归：[doc/UI_REGRESSION_CHECKLIST.zh-CN.md](./doc/UI_REGRESSION_CHECKLIST.zh-CN.md)

## 发布

发布策略和标签规则见 [doc/RELEASE.zh-CN.md](./doc/RELEASE.zh-CN.md)。英文版见 [doc/RELEASE.md](./doc/RELEASE.md)。更新日志见 [CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md) 和 [CHANGELOG.md](./CHANGELOG.md)。

当前打包插件声明：

- `strict_min_version`: `9.0`
- `strict_max_version`: `9.*`

Zotero 10 beta 兼容性需要等当前 beta 线的人工清单通过后再声明。

## 仓库结构

- `src/modules/agent/section.ts`：Zotero-Cat 条目面板 UI、运行时状态协调和 UI 事件。
- `src/modules/agent/provider.ts`：Provider 抽象、OpenAI-compatible 请求逻辑、流式解析、端点探测。
- `src/modules/agent/context.ts`：Zotero 元数据、笔记、批注和选中文本上下文组装。
- `src/modules/agent/modelMetadata.ts`：模型端点候选、模型列表解析、上下文窗口和 reasoning effort 元数据。
- `src/modules/agent/conversationStore.ts`：会话状态类型、防御性持久化解析、序列化和容量选择。
- `src/modules/agent/itemScope.ts`：主 Zotero 条目解析和条目作用域 key。
- `src/modules/agent/chatRetry.ts`：聊天重试和取消分类。
- `src/modules/agent/types.ts`：共享 agent 消息类型。
- `src/modules/agent/toolAction.ts`：工具 action 注册表、解析器和执行分发。
- `src/modules/agent/webSearchContext.ts`：联网搜索上下文编排和工具 handler 注册。
- `src/modules/agent/annotationTools.ts`：PDF 读写工具 handler 注册和标注提议解析。
- `src/modules/agent/annotationProposals.ts`：标注提议状态机。
- `src/modules/agent/proposalView.ts`：标注提议审核 UI 渲染。
- `src/modules/tools/webSearch.ts`：DuckDuckGo/SearXNG 搜索请求和结果解析。
- `src/modules/tools/pdfReader.ts`：PDF 文本抽取和文本到 rects 的定位。
- `src/modules/tools/pdfAnnotations.ts`：Zotero 标注持久化封装。
- `src/modules/agent/promptTemplates.ts`：提示词模板和本地化 system prompts。
- `src/modules/agent/secureApiKey.ts`：Firefox Login Manager API Key 存储。
- `src/modules/preferenceScript.ts`：设置页行为。
- `addon/locale/en-US/*` 和 `addon/locale/zh-CN/*`：Fluent 本地化文件。
- `addon/content/icons/*`：静态图标和 logo。
- `test/*`：单元测试和脚手架测试。
- `doc/UI_REGRESSION_CHECKLIST.md`：英文 Zotero UI 人工回归清单。
- `doc/UI_REGRESSION_CHECKLIST.zh-CN.md`：中文 Zotero UI 人工回归清单。
- `doc/INSTALLATION.md` / `doc/INSTALLATION.zh-CN.md`：XPI 安装说明。
- `doc/PROVIDER_SETUP.md` / `doc/PROVIDER_SETUP.zh-CN.md`：OpenAI-compatible Provider 配置示例。
- `doc/PRIVACY.md` / `doc/PRIVACY.zh-CN.md`：隐私和本地数据存储说明。
- `doc/RELEASE.md` / `doc/RELEASE.zh-CN.md`：版本、标签、兼容性和 release workflow。
- `doc/release-notes/*`：中英文 release notes。
- `doc/release-verification/*`：中英文发布校验记录。

## Roadmap

详细阶段计划见 [TODO.zh-CN.md](./TODO.zh-CN.md)。英文版见 [TODO.md](./TODO.md)。

`0.3.1` 后续加固：

- 继续在真实 Zotero 9 library 上验证 PDF 工具。
- 如果可用，验证最新 Zotero beta。
- 每次用户可见 UI 改动后，保持 Zotero 9 人工清单结果为最新。
- 为公开发布说明截取真实安装截图。

## 商标和非隶属声明

Zotero-Cat 是独立开源项目，不隶属于 Zotero，也不由 Zotero 或 Digital Scholar 背书或赞助。Zotero 是 Corporation for Digital Scholarship 的商标。
