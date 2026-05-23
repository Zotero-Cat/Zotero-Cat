import {
  ReasoningEffortValue,
  summarizeModelMetadataAvailability,
} from "../modelMetadata";

function isZh(): boolean {
  return Zotero.locale.startsWith("zh");
}

export function getModelLabel(): string {
  return isZh() ? "模型" : "Model";
}

export function getFetchModelsLabel(): string {
  return isZh() ? "获取模型列表" : "Fetch Model List";
}

export function getFetchingModelsLabel(): string {
  return isZh() ? "获取中..." : "Fetching...";
}

export function getReasoningLabel(): string {
  return isZh() ? "思考强度" : "Reasoning";
}

export function getReasoningOptionLabel(value: ReasoningEffortValue): string {
  const zh = isZh();
  switch (value) {
    case "default":
      return zh ? "默认" : "Default";
    case "none":
      return zh ? "无" : "None";
    case "minimal":
      return zh ? "最小" : "Minimal";
    case "low":
      return zh ? "低" : "Low";
    case "medium":
      return zh ? "中" : "Medium";
    case "high":
      return zh ? "高" : "High";
    case "xhigh":
      return zh ? "最高" : "XHigh";
    default:
      return value;
  }
}

export function getReasoningStatusLabel(
  state: "declared" | "queried-undeclared" | "not-queried",
): string {
  const zh = isZh();
  if (state === "declared") {
    return zh ? "由提供方声明" : "Provider declared";
  }
  if (state === "queried-undeclared") {
    return zh ? "提供方未声明" : "Not declared";
  }
  return zh ? "未查询" : "Not queried";
}

export function getModelsFetchedMessage(
  availability: ReturnType<typeof summarizeModelMetadataAvailability>,
): string {
  const { modelCount, contextWindowCount, reasoningEffortCount } = availability;
  return isZh()
    ? `已从站点获取 ${modelCount} 个模型；${contextWindowCount} 个声明模型上下文，${reasoningEffortCount} 个声明思考强度。`
    : `Fetched ${modelCount} models from site; ${contextWindowCount} declared context windows and ${reasoningEffortCount} declared reasoning options.`;
}

export function getNoModelListMessage(): string {
  return isZh()
    ? "站点返回结果里没有模型列表字段。"
    : "Site response does not contain a model-list field.";
}

export function getEmptyModelListMessage(): string {
  return isZh()
    ? "站点返回了空模型列表。"
    : "Site returned an empty model list.";
}

export function getModelParseMessages(): {
  emptyModelList: string;
  invalidJSON: string;
  noModelList: string;
  nonJSON: string;
} {
  return {
    emptyModelList: getEmptyModelListMessage(),
    invalidJSON: isZh()
      ? "站点返回 JSON 解析失败。"
      : "Failed to parse JSON from site.",
    noModelList: getNoModelListMessage(),
    nonJSON: isZh() ? "站点返回的不是 JSON。" : "Site did not return JSON.",
  };
}

export function formatModelFetchError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const normalized = text.trim();
  return normalized || (isZh() ? "获取失败。" : "Fetch failed.");
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function normalizeAuthKey(rawKey: string): string {
  let value = rawKey.trim();
  if (!value) {
    return "";
  }
  value = value.replace(/^['"]|['"]$/g, "").trim();
  value = value.replace(/^bearer\s+/i, "").trim();
  return value;
}
