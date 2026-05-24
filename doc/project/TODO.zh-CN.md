# TODO - Zotero-Cat

[English](./TODO.md) | [中文](./TODO.zh-CN.md)

本文件按阶段记录项目计划。保持务实：每个已勾选项目都应对应已实现代码、已提交
文档或已验证流程。

## 当前项目状态

- 项目名：`Zotero-Cat`
- 包名：`zotero-cat`
- 插件 ID：`zotero-cat@qianjindexiaozu.dev`
- Namespace / chrome path：`zoterocat`
- 全局 Zotero 实例：`Zotero.ZoteroCat`
- Pref prefix：`extensions.zotero.zoterocat`
- License：`AGPL-3.0-or-later`
- 开发运行时：Node.js 24 LTS
- 当前实现目标：Zotero 9
- 已发布版本：`v0.3.1`(item-pane 聊天、OpenAI-compatible provider、Zotero
  上下文、流式输出、历史会话、可选联网搜索，以及由 `PDF 工具` 开关控制的实验性
  PDF 工具代理，并强化了工具调用编排，修复 GLM 省略号和断行连字符空格的
  PDF 引文匹配)

## Phase 0: 仓库初始化

- [x] 选择并声明开源许可证：`AGPL-3.0-or-later`。
- [x] 创建基础文档：`README.md`、`CONTRIBUTING.md`、`TODO.md`。
- [x] 使用 Zotero 9 兼容目标初始化 Zotero 插件脚手架。
- [x] 在 package metadata、plugin metadata、本地化、prompt identity、文档和
      Git remote 中把项目重命名为 Zotero-Cat。
- [x] 添加 Node 版本文件:`.nvmrc`、`.node-version`。

## Phase 1: MVP

目标:插件能在 Zotero 内加载、渲染可用助手面板,并通过可配置 Provider 发送基础
模型请求。

- [x] 通过 `ItemPaneManager.registerSection` 注册 Zotero item-pane section。
- [x] 渲染基础聊天 UI、固定高度布局和底部输入区。
- [x] 创建 Provider 抽象:`provider -> chat`。
- [x] 实现第一个 OpenAI-compatible provider。
- [x] 添加 Provider、Base URL、模型和 API Key 设置,含 preset 下拉与独立的
      Test Connection 操作。
- [x] 通过 Firefox Login Manager 存储 API Key。
- [x] 为中文和英文 Zotero 添加本地化 UI 文本。

## Phase 2: Zotero 上下文

目标:让模型回复能利用阅读和审阅 Zotero 条目所需的上下文,减少用户手动粘贴。

- [x] 注入当前条目元数据、可选笔记、可选 PDF 批注。
- [x] 从 Zotero PDF reader selection popup 捕获选中文本。
- [x] 添加 prompt template 系统、上下文预览、token 预算估算。
- [x] 当 Provider metadata 声明模型上下文窗口时显示该信息。
- [x] 添加用户自定义上下文输入;自动注入的 Zotero 上下文在预览中保持只读,
      自定义上下文默认折叠。

## Phase 3: 体验增强

目标:让助手适合反复阅读和多轮使用。

- [x] 支持助手输出流式返回与打字机式增量渲染。
- [x] 添加请求取消、发送/终止图标切换、tooltip。
- [x] 添加 60 秒请求超时;在输出开始前对可恢复错误执行重试策略。
- [x] 探测第三方端点路径并记住成功路径提示;从 OpenAI-compatible `/models`
      endpoint 获取模型列表。
- [x] 在聊天区域添加模型选择、自定义模型输入、reasoning effort 选择。
- [x] 添加复制按钮和可见复制反馈。
- [x] 添加每条目的历史会话(原生下拉)、新建/清空/删除会话、容量上限、每条目
      active conversation pointer。
- [x] 添加 `Thinking.` / `..` / `...` 动画和首字返回等待耗时显示。
- [x] 聊天窗口固定 90% 高度,输入区底部固定,流式输出时自动滚动。
- [x] 安全渲染助手 Markdown。
- [x] 添加重试和请求错误诊断面板。

## Phase 3.5: 工程质量

目标:在打包和公开发布前降低回归风险。

- [x] 为 provider endpoint fallback、模型列表探测、连接解析、上下文预览和
      token 估算、会话持久化解析、启动脚手架添加单元测试。
- [x] 添加 `doc/release/UI_REGRESSION_CHECKLIST.md`。
- [x] `npm test` 完成后自动退出;CI 使用 `.nvmrc` + `npm ci`。
- [x] 从 `section.ts` 拆出模型 metadata、会话持久化、条目作用域、聊天重试
      分类、共享 message types 等纯模块。
- [x] 消除聊天 UI 与 Test Connection 之间重复的模型列表解析逻辑。
- [x] 纯逻辑测试直接导入纯模块。

## Phase 4: 兼容性和发布

目标:产出可安装 XPI,让本地开发机器之外的用户可以使用。

- [x] 在 Zotero 9 当前稳定版运行 `doc/release/UI_REGRESSION_CHECKLIST.md`。
- [x] 本地构建 XPI;通过 Zotero Add-ons Manager 安装;验证设置和会话持久化
      在安装后保持。
- [x] 添加 `CHANGELOG.md`;定义 `0.x` 版本策略和 release branch/tag 规则。
- [x] 添加 GitHub release workflow dry-run 路径;记录本地自动化 release
      校验与 XPI hash。
- [x] 补齐安装说明、provider 设置样例、隐私说明、Zotero 非关联声明,中英双版。
- [x] 首次发布前确认 `strict_min_version = 9.0`、`strict_max_version = 9.*`。
- [ ] 每次 release 补详细人工回归记录:Zotero version、OS、date、provider。
- [ ] 有新 Zotero beta 时验证;在人工清单通过前不声明 Zotero 10 兼容。
- [ ] 放宽 `strict_max_version` 前,验证 `secureApiKey.ts` 中
      `Components.Constructor(...)` 对 `nsILoginInfo` 在 Zotero 10 ESR 基础
      上仍可用。

## Phase 5: 公开产品打磨

目标:为 GitHub stars、早期用户和 issue reports 做准备,不提前过度建设。

- [ ] 创建项目网站 `zoterocat.org`,或先重定向到 GitHub repo。
- [ ] 在 README 添加简洁产品截图和短 demo GIF/视频。
- [ ] 添加 issue templates:bug report、provider compatibility、feature
      request。
- [ ] 邮件配置完成后添加 `security@zoterocat.org` 和 `contact@zoterocat.org`。
- [ ] 添加 GitHub repository topics。
- [ ] 如果贡献者开始询问内部结构,添加简短 architecture document。
- [ ] 准备 Zotero community channels launch notes。

## Phase 6: v0.2 — PDF 工具代理

目标:助手能读 PDF、自己提议高亮、批注以及对已有标注的修改/删除,所有写操作
在用户逐条确认(Accept / Reject / Accept All / Reject All)之后才落盘。

状态：第一版端到端实现已随 `v0.2.0` 发布，并由 `PDF 工具` 开关控制。`v0.3.0` 强化了工具管道和 PDF 文本匹配。该功能仍为实验性能力，需要继续在真实 PDF 上做 Zotero UI 验证。

### 首次使用引导

- [ ] 检测到 API Key 未配置时,Item Pane Section 隐藏所有聊天组件,只显示
      "请配置 Provider"文案和一键打开设置的按钮。
- [x] 添加首次使用 Provider 引导的中英双语字符串。

### 工具管道

- [x] 扩展 `toolAction.ts`:`parseAssistantToolActions` 返回 `ToolAction[]`,
      每个 handler 声明 `readOnly: boolean`。
- [x] 拆分 `section.ts` 的 follow-up 流:读类工具立即执行并回灌结果,写类
      工具排入待审批次。

### PDF 抽取(headless)

- [x] 加入 `pdfjs-dist` 运行时依赖，并在 `src/modules/tools/pdfReader.ts`
      中懒加载。
- [ ] 发布前把 `pdfjs-dist` 精确 pin 住，并重新检查 bundle/worker 策略。
- [x] 实现 `src/modules/tools/pdfReader.ts`:
  - `extractPages(attachment)`:按页返回 text items(含 `transform`、
    `width`、`height`)与页面尺寸。
  - `findTextRects(pages, pageIndex, text, fuzz)`:在目标页 ±2 页做空白
    归一化的模糊匹配,返回实际 `pageIndex` 与 `rects[][]`(PDF 用户空间)。
- [x] 加入 pdf.js 懒初始化、document 清理、缓存失效和插件 shutdown 缓存清理；
      不可用 PDF 的抽取错误会用可读信息暴露。

### 标注操作

- [x] 实现 `src/modules/tools/pdfAnnotations.ts`:`createAnnotation` /
      `updateAnnotation` / `deleteAnnotation` 对 `Zotero.Annotations.saveFromJSON`
      与 `Zotero.Item.eraseTx` 的薄封装,含 JSON 校验、sortIndex 生成、位置
      超限切分。

### 待审状态机

- [x] 实现 `src/modules/agent/annotationProposals.ts`:
  - per-conversation 内存队列;每个 assistant 回合至多一个待审批次;
    上限 10 条。
  - 状态流转:`pending` → `accepted` / `rejected` / `failed`。
  - 订阅钩子供 UI 刷新。
- [x] 实现 `src/modules/agent/annotationTools.ts`,注册 5 个 handler:
      `read_pdf`、`list_annotations`、`propose_annotation`、
      `modify_annotation`、`delete_annotation`。

### 确认 UI

- [x] 新增 `src/modules/agent/proposalView.ts`:在聊天里渲染批次卡片,含
      操作徽标、页码、片段预览、批注内容、色块、单条 Accept / Reject。
- [x] 批次顶栏:Accept All / Reject All / 待处理计数。
- [ ] 键盘:Enter 接受当前、Esc 拒绝当前、Shift+Enter 全部接受。
- [x] 有待审批次时锁定 composer,解决后解锁。
- [x] 落盘完成后汇总 accepted / rejected / failed,作为一条 follow-up user
      消息回灌模型继续对话。

### 偏好、提示、本地化

- [x] `addon/prefs.js` 增 `pdfToolsEnabled`(默认 `false`)和
      `pdfToolsAutoApply`(默认 `false`)。
- [x] 在聊天控件区暴露两个开关。之后再决定是否也要放进偏好面板并加说明。
- [x] `pdfToolsEnabled` 开启时,向系统提示追加工具规则块(每个动作的 JSON
      Schema、批次上限、"先读后写"约束)。
- [x] `addon/locale/{en-US,zh-CN}/addon.ftl` 为引导页、批次顶栏、卡片、
      状态消息补双语字符串。

### 测试与验收

- [x] 新增 `test/pdf-tools-logic.test.ts`:文本→rects 模糊匹配与标注 JSON
      校验(Mock Zotero APIs)。
- [x] 新增 `test/proposal-state.test.ts`:状态机边界。
- [x] 更新 `doc/release/UI_REGRESSION_CHECKLIST.md`:新增创建/修改/删除标注用例
      与引导页。
- [x] `npm run lint:check && npm run build && npm test` 全绿。

## Phase 7: Function Calling 规范化

目标：把工具调用编排循环从 `section.ts` 抽出到一个独立的、可单测的 runner；
把按 endpoint 维度的 provider quirks（`reasoning_content` 回传、原生
`tool_calls` 不支持等）集中管理；把原生（`tool_calls`）和 text-mode JSON
工具动作两条路径统一到一个状态机里。这是对一连串 provider 适配 bug
（MiMo / DeepSeek-V4-Thinking 的 `reasoning_content`、`MAX_TOOL_CHAIN_DEPTH`
默默截断、native 和 text-mode 两套分支）的结构性回应。

硬约束（不要违反）：

- 不引入 `langchain` / `langgraph` 运行时依赖。改用 LangGraph 风格思路演进
  自家 runtime：显式状态机、深度门控、人工确认 checkpoint、工具所有权由
  Zotero-Cat 决定。
- 工具执行权一直归 Zotero-Cat；provider-native function calling 只用来
  接收 `tool_calls`，绝不让模型直接落盘。
- HTTP 入口只走 `Zotero.HTTP.request`。
- `toolProtocol.ts`（MCP / OpenAI 兼容工具协议）已经在了，复用不要重复造。

### 基础模块

- [x] `src/modules/agent/functionCalling/errors.ts`：把
      `ToolsNotSupportedError` 和 `ReasoningContentRequiredError` 从
      `provider.ts` 搬过来；新增 `MaxToolDepthExceededError`。`provider.ts`
      做兼容性 re-export。
- [x] `src/modules/agent/functionCalling/quirks.ts`：`ProviderQuirks` 类型
      与按 endpoint 维度的注册表；取代分散在 `section.ts` 的
      `nativeToolsUnsupportedEndpoints` / `reasoningContentEchoEndpoints`。
      Endpoint key 归一化与当前 `getActiveEndpointKey()` 保持一致。
- [x] `src/modules/agent/functionCalling/messageShape.ts`：把
      `serializeChatMessage` 与 `buildRequestPayload` 搬过来，让 quirks
      （例如 `reasoningContentEmptyPolicy: "empty" | "omit" | "space"`）
      在统一位置生效，`provider.ts` 瘦身。
- [~] `src/modules/agent/functionCalling/types.ts`：暂时按下不表。
  单回合的 runner 直接 inline 导出 `RunAssistantTurnInput` /
  `AssistantTurnReply`；待多回合 loop 落地、出现第二个 consumer 时再
  抽 `types.ts`。

### Runner

- [x] `src/modules/agent/functionCalling/runner.ts`：实现 `runAssistantTurn`。
      纯逻辑，不引入任何 Zotero UI 类型。当前刻意保持单回合：工具执行
      与多回合接续仍由 `section.ts` 持有，因为它们与 UI 状态、人工
      确认环节绑定。
- [ ] 把 native（`tool_calls`）和 text-mode JSON 工具调用合到一个 loop 里，
      产出统一的 `AssistantTurn`（可选 `toolCalls`）。目前 text-mode JSON
      的流式检测仍在 `section.ts` 里。延后到多回合 loop 重构再处理。
- [ ] `MAX_TOOL_CHAIN_DEPTH` 变成 runner 入参，不再是 section.ts 里的魔数。
      到顶时抛 `MaxToolDepthExceededError`，由 UI 层映射成可见提示。
      延后到多回合 loop 重构再处理。
- [x] 对已知 quirks 自恢复：捕获 `ReasoningContentRequiredError` /
      `ToolsNotSupportedError`，通过中心注册表登记 quirk，按新 quirks
      重试一次；不再做沉默重试，每次恢复发出一条 diagnostic。

### 迁移

- [x] 把 `section.ts` 的 `runChatAttempt` 改为调用 `runAssistantTurn`。
      quirk 恢复的重试由 runner 负责；section.ts 只在 `onDiagnostic` 里
      记一条 warning 并复位流式状态。
      `continueAfterAssistantToolAction` / `continueAfterNativeToolCalls`
      继续留在 `section.ts`，因为它们要协调 UI 状态和写操作的人工
      确认。`continueAfterAssistantToolAction` /
      `continueAfterNativeToolCalls` 后续已迁入 `runtime/toolChain.ts`，
      `section.ts` 现在只保留 UI/runtime 接线。
- [x] 迁移完成后 `section.ts` 应回落到 ~2500 行以下，并且不再直接持有
      provider quirks 状态。当前 `section.ts` 约 935 行。

### 配套 bug 修复（与迁移一起做）

- [x] `conversationRuntime.ts:184` 不再把 `content` 为空但带 `toolCalls`
      的 assistant 消息过滤掉，同时把 `toolCalls` / `toolCallId` /
      `toolName` 一并透传给 provider payload。
- [x] 加固 DeepSeek-V4-Thinking quirk：对 host 匹配 `api.deepseek.com`
      的 endpoint，把 `reasoningContentEmptyPolicy` 默认设为 `"space"`
      （单个空格能同时绕开实测中遇到的空字符串拒绝和字段缺失校验）。
- [x] 把工具结果落到 `conversation.messages` 里，保证多轮回放发出的
      `[assistant{tool_calls}, tool, ...]` 序列闭合。`section.ts` 现在
      在每个 read 工具完成时、在 `applyBatchAndContinue` 里写工具批次
      落定后、以及未识别 / 写工具不可用的直接 follow-up 路径里都会调用
      `appendToolResultMessage(...)`。`conversationRuntime.toProviderMessages`
      额外用 `sanitizeToolCallSequences` 做兜底，处理那些已经把
      `assistant.toolCalls` 留在历史里、但没来得及补 tool 结果的取消
      / 异常路径。修掉 DeepSeek 在工具回合后下一轮请求里抛出的
      400 "insufficient tool messages following tool_calls message"。

### 测试

- [x] `test/function-calling-runner.test.ts`：happy path、
      `ReasoningContentRequiredError` 恢复、`ToolsNotSupportedError`
      恢复、native → text-mode 兜底、host-default 透传。
- [x] `test/function-calling-quirks.test.ts`：endpoint key 归一化、
      运行期新增 quirks、按 host 的默认值（DeepSeek）。
- [x] `test/function-calling-message-shape.test.ts`：assistant `tool_calls` + `reasoning_content` 往返、system / user / tool 消息 shape、
      empty-policy 多种行为。
- [x] `test/conversation-runtime.test.ts`：`sanitizeToolCallSequences`
      用例集 —— 孤儿 `toolCalls` 被剥离（有 prose 时保留消息，无 prose 整条丢
      弃）、`tool_call_id` 仅部分匹配也按孤儿处理、没有前置 assistant
      `tool_calls` 的 `role: "tool"` 消息被丢弃、完整序列原样保留。

### 后续（Phase 8 候选，本阶段不做）

- [ ] 在 Zotero XPI 里 spike `@modelcontextprotocol/sdk`；若能在 XPCOM
      下干净加载，迁移工具规范到该 SDK。在 spike 通过前继续用
      `toolProtocol.ts` 里的轻量契约。
- [ ] 多回合 `runFunctionCallingLoop`：由 runner 持有工具执行和深度门控，
      把 `continueAfterAssistantToolAction` / `continueAfterNativeToolCalls`
      合并为一台状态机，`MAX_TOOL_CHAIN_DEPTH` 进 runner config；UI 仍
      负责写操作的人工确认。
- [ ] 跨插件重启可恢复的工具调用 checkpoint。

## Backlog

这些有用,但不属于当前 release path。

- [ ] 如果 OpenAI-compatible 行为不足,添加更多 provider-specific adapters。
- [ ] 使用 provider/model-specific tokenizer 改进 token counting。
- [ ] 当 Zotero automation 足够稳定后,添加启动测试之外的 UI tests。
