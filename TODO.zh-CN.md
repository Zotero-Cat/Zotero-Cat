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
- 已发布版本：`v0.2.0`(item-pane 聊天、OpenAI-compatible provider、Zotero
  上下文、流式输出、历史会话、可选联网搜索，以及由 `PDF 工具` 开关控制的实验性
  PDF 工具代理)

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
- [x] 添加 `doc/UI_REGRESSION_CHECKLIST.md`。
- [x] `npm test` 完成后自动退出;CI 使用 `.nvmrc` + `npm ci`。
- [x] 从 `section.ts` 拆出模型 metadata、会话持久化、条目作用域、聊天重试
      分类、共享 message types 等纯模块。
- [x] 消除聊天 UI 与 Test Connection 之间重复的模型列表解析逻辑。
- [x] 纯逻辑测试直接导入纯模块。

## Phase 4: 兼容性和发布

目标:产出可安装 XPI,让本地开发机器之外的用户可以使用。

- [x] 在 Zotero 9 当前稳定版运行 `doc/UI_REGRESSION_CHECKLIST.md`。
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

状态：第一版端到端实现已随 `v0.2.0` 发布，并由 `PDF 工具` 开关控制。该功能仍为实验性能力，需要继续在真实 PDF 上做 Zotero UI 验证。

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
- [x] 更新 `doc/UI_REGRESSION_CHECKLIST.md`:新增创建/修改/删除标注用例
      与引导页。
- [ ] `npm run lint:check && npm run build && npm test` 全绿。

## Backlog

这些有用,但不属于当前 release path。

- [ ] 如果 OpenAI-compatible 行为不足,添加更多 provider-specific adapters。
- [ ] 使用 provider/model-specific tokenizer 改进 token counting。
- [ ] 当 Zotero automation 足够稳定后,添加启动测试之外的 UI tests。
