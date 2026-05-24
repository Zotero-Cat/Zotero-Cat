# Provider Setup

[English](./PROVIDER_SETUP.md) | [中文](./PROVIDER_SETUP.zh-CN.md)

Zotero-Cat talks directly from Zotero to the configured OpenAI-compatible API
endpoint. It does not proxy requests through a Zotero-Cat server.

## Settings Fields

- Provider ID: use `openai-compatible` unless a future provider-specific
  adapter is added.
- Base URL: enter the API base URL, not the provider website homepage.
- API Key: enter the key issued by the provider.
- Test Connection: probes the current form values without saving them.
- Save Settings: persists settings only after explicit confirmation.

## Examples

| Service type                   | Base URL example                 | Model field                                            |
| ------------------------------ | -------------------------------- | ------------------------------------------------------ |
| OpenAI API                     | `https://api.openai.com/v1`      | Fetch models or enter a model available to the API key |
| OpenAI-compatible gateway      | `https://gateway.example.com/v1` | Use the gateway's model ID format                      |
| Local OpenAI-compatible server | `http://127.0.0.1:8000/v1`       | Use the local server's served model name               |

Do not paste a full chat endpoint such as `/chat/completions` or `/responses`
as the Base URL. Zotero-Cat probes compatible endpoint paths itself.

## Model List And Reasoning Effort

The model list button expects OpenAI-compatible JSON from `/models`.

Zotero-Cat uses structured metadata returned by the API, not provider
documentation pages. Context windows are shown only when the model record
declares a field such as `context_length`, `context_window`,
`max_context_window`, `max_model_len`, or compatible nested variants.

Reasoning effort options are shown only when provider metadata declares support,
for example through `supported_reasoning_efforts`, `reasoning_efforts`, or
`supported_reasoning_levels`. If the provider does not declare supported
reasoning efforts, Zotero-Cat keeps the setting at `default`.

Some providers document model limits separately but do not return them from
`/models`. DeepSeek is one example: its thinking mode is exposed as model
selection, such as `deepseek-reasoner`, rather than a generic per-request
`reasoning_effort` option in the model list. In that case Zotero-Cat can fetch
the model names, but the context window and reasoning selector remain unknown
unless the API response itself declares them.

## Troubleshooting

- A 401 or 403 response usually means the API Key or account permission is
  wrong.
- HTML in the response usually means the Base URL points to a website or login
  page rather than an API endpoint.
- Timeout errors can come from network problems, slow local models, or gateways
  that buffer streaming responses.
- If model fetching fails but chat works, enter the model manually.
