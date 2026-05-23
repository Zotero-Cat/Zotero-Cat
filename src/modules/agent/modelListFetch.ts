import { isApiKeyRequiredForProvider } from "./provider";
import {
  buildModelEndpointCandidates,
  canRetryModelEndpoint,
  normalizeBaseURL,
  parseModelInfos,
  type ModelInfo,
} from "./modelMetadata";
import { getProviderApiKey } from "./secureApiKey";

const MODEL_FETCH_TIMEOUT_MS = 25_000;

export async function fetchModelsFromCurrentProvider(
  providerID: string,
  baseURL: string,
): Promise<ModelInfo[]> {
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  if (!normalizedBaseURL) {
    throw new Error(
      Zotero.locale.startsWith("zh")
        ? "请先在设置中填写 Base URL。"
        : "Please set Base URL first in settings.",
    );
  }
  const apiKey = normalizeAuthKey(
    getProviderApiKey(providerID, normalizedBaseURL),
  );
  if (isApiKeyRequiredForProvider(providerID) && !apiKey) {
    throw new Error(
      Zotero.locale.startsWith("zh")
        ? "当前 Provider 需要 API Key。"
        : "This provider requires an API key.",
    );
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const candidates = buildModelEndpointCandidates(normalizedBaseURL);
  let lastError: Error | null = null;
  for (const [index, endpoint] of candidates.entries()) {
    try {
      const request = await Zotero.HTTP.request("GET", endpoint, {
        headers,
        timeout: MODEL_FETCH_TIMEOUT_MS,
      });
      const modelInfos = parseModelInfos(
        request.responseText || "",
        getModelParseMessages(),
      );
      if (modelInfos.length) {
        return modelInfos;
      }
      throw new Error(
        Zotero.locale.startsWith("zh")
          ? "站点返回了空模型列表。"
          : "Site returned an empty model list.",
      );
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      if (canRetryModelEndpoint(index, candidates.length, normalizedError)) {
        lastError = normalizedError;
        continue;
      }
      throw normalizedError;
    }
  }
  throw lastError || new Error(formatModelFetchError(""));
}

export function formatModelFetchError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const normalized = text.trim();
  return (
    normalized ||
    (Zotero.locale.startsWith("zh") ? "获取失败。" : "Fetch failed.")
  );
}

function getModelParseMessages(): {
  emptyModelList: string;
  invalidJSON: string;
  noModelList: string;
  nonJSON: string;
} {
  const isZh = Zotero.locale.startsWith("zh");
  return {
    emptyModelList: isZh
      ? "站点返回了空模型列表。"
      : "Site returned an empty model list.",
    invalidJSON: isZh
      ? "站点返回 JSON 解析失败。"
      : "Failed to parse JSON from site.",
    noModelList: isZh
      ? "站点返回结果里没有模型列表字段。"
      : "Site response does not contain a model-list field.",
    nonJSON: isZh ? "站点返回的不是 JSON。" : "Site did not return JSON.",
  };
}

function normalizeAuthKey(rawKey: string): string {
  let value = rawKey.trim();
  if (!value) {
    return "";
  }
  value = value.replace(/^['"]|['"]$/g, "").trim();
  value = value.replace(/^bearer\s+/i, "").trim();
  return value;
}
