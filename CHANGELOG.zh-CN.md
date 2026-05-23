# 更新日志

[English](./CHANGELOG.md) | [中文](./CHANGELOG.zh-CN.md)

这里记录 Zotero-Cat 的重要变更。首次公开稳定承诺前，Zotero-Cat 使用 `0.x` 版本。

## [Unreleased]

## [0.3.1] - 2026-05-23

### 修复

- PDF 高亮/下划线匹配现在会把模型输出里的断行连字符空格形态（例如
  `fine- tuning`）作为 PDF 行内复合词（例如 `fine-tuning`）的候选，同时保留
  原有的断行去连字符匹配路径。
- GLM 风格的截断引文在省略号后跟闭合引号或句末标点时，也会继续进入省略号
  fallback。

## [0.3.0] - 2026-05-23

### 修复

- 原生 `tool_calls` 回合现在会把 `role: "tool"` 消息落到会话历史里，
  下一轮用户提问不会再把孤儿 `assistant{tool_calls}` 重放出去，DeepSeek
  等严格 provider 也不会再返回
  "insufficient tool messages following tool_calls message" 的 400。
  `toProviderMessages` 增加了 `sanitizeToolCallSequences` 兜底，覆盖
  取消 / 半失败等仍可能留下孤儿 `tool_calls` 的路径。
- PDF 高亮/下划线匹配现在会处理 GLM 这类模型把引文下一句写到一半再用
  省略号结尾的情况：定位失败前会先改用省略号前最后一个完整句子重试。
- 工具执行不再在聊天里渲染独立工具事件气泡或空的助手占位消息；聊天区
  现在只显示一条会随工具 / 搜索进度刷新的内联活动状态。
- 活动状态现在会优先显示当前正在运行的工具，不会让上一段联网搜索状态
  残留并盖过“正在准备标注 / 正在写入标注”等后续工具状态。
- 活动状态现在会在整个模型 / 工具回合中使用连续 CSS 加载圆圈，聊天面板
  高度也默认按可见页面的 85% 计算。
- 联网搜索默认不再把结果限制为 5 条。
- 联网搜索工具现在暴露 `maxResults` / `count` / `limit`，模型可以按任务
  自己请求需要的结果数量；SearXNG 在请求较多有限结果时会继续翻页补齐。
- 聊天控件中移除了手动 Zotero 上下文注入开关。开启 PDF 工具时，
  Zotero-Cat 会优先让模型通过工具读取 PDF，而不是预先注入元数据、
  笔记、批注或选中文本。
- 聊天控件中移除了自定义上下文、上下文预览和诊断折叠窗口；条目窗格
  UI 不再注入自定义上下文文本。
- PDF 高亮/下划线匹配在长引文后半句不是逐字原文时，也会回退到完整句子
  级别的 PDF 原文片段。
- PDF 高亮/下划线匹配现在会容忍有限的正字法差异，例如 `can not` /
  `cannot`，以及 PDF 换行断词抽取后被合并、但模型写成复合连字符的词。

## [0.2.0] - 2026-05-19

### 新增

- 由 `PDF 工具` 开关控制的实验性 PDF 工具代理，包括 `read_pdf`、
  `list_annotations`、标注提议 action、待确认卡片，以及 Zotero 标注
  新建/修改/删除封装。
- 懒加载 `pdfjs-dist` 的 PDF 文本抽取，并在需要时回退到 Zotero 已索引全文。
- 标注提议状态机，以及提议状态流转测试。
- PDF 文本匹配和标注 JSON 辅助逻辑测试。
- 会话历史改为写入 Zotero 数据目录下的本地文件，并支持从旧 pref 迁移。
- 新增独立纯逻辑模块，分别管理内存会话运行时状态、自定义上下文存储和工具事件状态。

### 变更

- 工具 action 解析现在可以在单个助手回合返回多个 action，handler 也会声明
  是否只读。
- 模型输出展示与工具 action 处理拆成两条管道，可在 provider 流式响应收尾较慢时先执行已识别的工具调用。
- PDF 高亮定位现在保留 pdf.js 文本 span 的 PDF 用户坐标，不再翻转 Y 轴，降低高亮错位概率。
- 标注提议缺少可靠页码提示且在多页命中同一句时，现在会失败并要求补页码，而不是静默选择第一次出现的位置。
- `read_pdf` 结果被截断时会明确提示模型先精确读取目标页，再提出高亮。
- 高亮/下划线修复提示现在要求使用单页内连续出现的 PDF 原文，并要求跨页内容拆成多条提议。
- PDF 工具的自动应用开关现在会跳过待确认卡片，直接进入批准并应用流程。
- 工具调用状态提示改为更紧凑的行内状态行，不再使用虚线卡片。

### 修复

- 标注失败后，如果助手只回复“我将使用第 16 页内的完整句子”等计划文本而没有输出 JSON action，现在会被识别为遗漏工具调用并触发修复回合，不再静默停止。
- 当 PDF quote 无法定位时，失败的标注提议保持不可操作状态，避免生成猜测位置的高亮。

## [0.1.2] - 2026-05-10

### 变更

- 提取共享文本工具函数（`collapseWhitespace`、`stripHTML`、`truncate` 等）到
  `src/utils/text.ts`，合并了 `context.ts`、`webSearch.ts`、`toolAction.ts`、
  `provider.ts` 和 `section.ts` 中的重复实现。
- 将 Markdown 转 DOM 渲染逻辑（约 230 行）从 `section.ts` 提取到
  `src/modules/agent/markdown.ts`。
- ESLint `no-unused-vars` 规则从 `off` 改为 `warn`。
- `section.ts` 体积缩小，移除了内联 Markdown 渲染和重复工具函数。
- 为 `context.ts` 中的选中文本缓存添加了定期过期条目清理。
- 在项目阶段计划中添加 Zotero 10 `Components.Constructor` 兼容性验证项。

## [0.1.1] - 2026-05-09

### 新增

- 可选联网搜索工具流程，支持 DuckDuckGo、DuckDuckGo HTML fallback 和 SearXNG JSON。
- 工具 action 注册表和解析器，可处理模型输出的联网搜索等 JSON action。
- 通过 `customContextStore` 按条目持久化自定义上下文。
- 会话导出、重命名和收藏控件。

### 变更

- 扩大选中文本、笔记、批注和系统上下文预算，降低长 prompt 被过早截断的概率。
- README、TODO、隐私说明和实现交接文档已同步当前发布状态和本地存储行为。
- 包版本升级到 `0.1.1`，让已安装早期 `v0.1.0-alpha` 预发布版本的用户能获得真实包版本升级。

## [0.1.0-alpha] - 2026-05-03

### 新增

- Zotero 条目面板助手 section，带本地化聊天界面。
- OpenAI-compatible Provider 支持：流式输出、端点探测、端点 fallback、模型列表获取，以及提供方声明的 reasoning effort 控制。
- Zotero 上下文注入：条目元数据、笔记、PDF 批注、PDF 选中文本，以及按请求注入的自定义上下文。
- 每个 Zotero 条目独立的会话历史，支持 Zotero pref 持久化、活动会话跟踪和容量上限。
- API Key 通过 Firefox Login Manager 保存。
- 诊断面板展示重试、模型列表、超时、取消和 Provider 错误。
- 共享纯逻辑模块：模型元数据解析、会话存储、条目作用域、重试分类、运行时 ID 和 agent 消息类型。
- 自动化测试覆盖 Provider fallback、模型探测、上下文预览、会话持久化解析、流式 delta 解析和启动加载。
- 发布文档覆盖安装、Provider 配置、隐私、版本规则、标签规则和人工兼容性门禁。

### 变更

- 初始 alpha 的打包插件只声明兼容 Zotero 9：`strict_min_version` 为 `9.0`，`strict_max_version` 为 `9.*`。
- GitHub release workflow 现在在仓库内直接运行 lint、build、tests 和 artifact upload，然后只在 `v*` 标签推送时发布。

### 发布说明

- 当前不声明 Zotero 10 beta 兼容性；需要先在当前 Zotero beta 线运行人工 UI 清单。
- 公开 GitHub release 打标签前，必须记录打包 XPI 安装和持久化验证结果。
