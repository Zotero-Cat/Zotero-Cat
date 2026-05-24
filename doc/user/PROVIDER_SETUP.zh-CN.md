# Provider 配置

[English](./PROVIDER_SETUP.md) | [中文](./PROVIDER_SETUP.zh-CN.md)

Zotero-Cat 会从 Zotero 直接请求用户配置的 OpenAI-compatible API 端点。它不会通过 Zotero-Cat 服务器代理请求。

## 设置字段

- Provider ID：除非以后增加了提供方专用 adapter，否则使用 `openai-compatible`。
- Base URL：填写 API base URL，不要填写提供方网站首页。
- API Key：填写提供方发放的 key。
- Test Connection：用表单当前值探测连接，不保存。
- Save Settings：用户明确确认后才保存设置。

## 示例

| 服务类型                    | Base URL 示例                    | 模型字段                                |
| --------------------------- | -------------------------------- | --------------------------------------- |
| OpenAI API                  | `https://api.openai.com/v1`      | 获取模型列表，或输入 API Key 可用的模型 |
| OpenAI-compatible 网关      | `https://gateway.example.com/v1` | 使用网关自己的模型 ID 格式              |
| 本地 OpenAI-compatible 服务 | `http://127.0.0.1:8000/v1`       | 使用本地服务暴露的模型名                |

不要把完整聊天端点填入 Base URL，例如 `/chat/completions` 或 `/responses`。Zotero-Cat 会自己探测兼容端点路径。

## 模型列表和 Reasoning Effort

模型列表按钮期望 `/models` 返回 OpenAI-compatible JSON。

Zotero-Cat 使用 API 返回的结构化元数据，不抓取提供方文档页面。只有模型记录里声明了 `context_length`、`context_window`、`max_context_window`、`max_model_len` 或兼容嵌套字段时，界面才会显示模型上下文。

Zotero-Cat 只在提供方元数据声明支持时显示 reasoning effort 选项，例如 `supported_reasoning_efforts`、`reasoning_efforts` 或 `supported_reasoning_levels`。没有声明支持时，Zotero-Cat 会把该设置保持为 `default`。

有些提供方会在文档里单独列出模型限制，但不会从 `/models` 返回这些信息。DeepSeek 就是这种情况之一：它的思考模式通常体现为模型选择，例如 `deepseek-reasoner`，而不是模型列表里通用的逐请求 `reasoning_effort` 选项。这种情况下 Zotero-Cat 可以获取模型名，但上下文窗口和思考强度选择会保持未知，除非 API 响应本身声明这些字段。

## 故障排查

- 401 或 403 通常表示 API Key 错误或账号权限不足。
- 如果响应内容是 HTML，Base URL 通常指向了网页或登录页，而不是 API 端点。
- 超时可能来自网络问题、慢速本地模型，或会缓冲流式响应的网关。
- 如果模型获取失败但聊天可用，手动输入模型名。
