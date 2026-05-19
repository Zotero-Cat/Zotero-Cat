# 隐私和数据存储

[English](./PRIVACY.md) | [中文](./PRIVACY.zh-CN.md)

Zotero-Cat 是本地 Zotero 插件。项目不提供也不使用 Zotero-Cat 云端后端。

## 发送给模型提供方的数据

发送聊天请求时，Zotero-Cat 会把当前提示和已启用的上下文从 Zotero 直接发送到用户配置的提供方端点。

根据启用的选项，请求可能包含：

- 当前聊天消息。
- 当前 Zotero 条目的标题、作者、年份、DOI、URL 和摘要。
- 当前条目的子笔记。
- 当前条目的 PDF 批注。
- Zotero PDF 阅读器中最近选中的文本。
- 用户在 Zotero-Cat 聊天面板输入的自定义上下文。
- 启用 PDF 工具时，抽取出的 PDF 文本、已有标注详情，以及已接受/已拒绝标注提议的汇总，可能会作为工具后续提示的一部分发送给用户配置的模型提供方。

如果不希望提供方接收某些内容，请在发送前关闭对应上下文开关。

## 发送给搜索提供方的数据

联网搜索默认关闭。若在聊天面板启用联网搜索，Zotero-Cat 会在模型请求前向配置的搜索提供方发送查询。查询可能包含用户提示和当前条目的标题、DOI、年份等提示信息。搜索返回的摘要片段和 URL 会随后注入到模型上下文。

搜索提供方侧的数据保留、日志和删除策略由你配置的搜索提供方决定。

## PDF 工具访问

PDF 工具默认关闭。启用后，Zotero-Cat 可能通过 `pdfjs-dist` 或 Zotero 已索引全文在本地读取当前条目的 PDF 附件，列出已有 Zotero 标注，并准备待审的标注改动。写操作会先进入 Zotero-Cat 的提议卡片，再由 Zotero 标注 API 执行。

已接受的标注提议会作为普通 Zotero 标注保存在 Zotero library 中。已拒绝的提议只保留在当前会话的内存待审批次里，不会保存成 Zotero 标注。

## 本地数据存储

Zotero-Cat 会保存：

- 会话历史：本地 JSON 文件 `<Zotero data directory>/zotero-cat/agent-conversations.json`。
- Provider ID、Base URL、当前模型、reasoning effort 和端点提示：`extensions.zotero.zoterocat.*` 下的 Zotero prefs。
- 联网搜索开关、搜索提供方和搜索接口：`extensions.zotero.zoterocat.*` 下的 Zotero prefs。
- PDF 工具开关和自动应用偏好：`extensions.zotero.zoterocat.*` 下的 Zotero prefs。
- API Key：Firefox Login Manager，按 Provider 和 Base URL 分作用域。
- 每个条目的自定义上下文：Zotero pref `extensions.zotero.zoterocat.customContextStore`。

会话历史设置了全局、单条目、单会话和单消息容量上限，避免本地存储无限增长。自定义上下文按 Zotero 条目 key 隔离。

## Zotero-Cat 不保存的数据

Zotero-Cat 不会有意把 API Key 保存到普通 Zotero prefs。Zotero-Cat 不会把数据上传到项目运营的服务。

提供方侧的数据保留、日志、训练和删除策略由你配置的提供方决定。

## 删除本地数据

- 通过 Zotero-Cat 会话控件删除会话。
- 如需在插件 UI 之外删除全部会话历史，可以删除 `<Zotero data directory>/zotero-cat/agent-conversations.json`。
- 在对应条目的 Zotero-Cat 自定义上下文编辑区清空自定义上下文。
- 在 Zotero-Cat 设置页清空或修改 Provider 设置。
- 如需在插件 UI 之外清除凭据，可从宿主 Firefox/Zotero Login Manager 存储中移除保存的 API Key。
