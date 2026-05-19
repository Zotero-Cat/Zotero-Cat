export const REASONING_EFFORT_VALUES = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffortValue = (typeof REASONING_EFFORT_VALUES)[number];

export const FALLBACK_MODEL_ID = "gpt-4o-mini";

export type ModelProbeErrorCode =
  | "non_json"
  | "invalid_json"
  | "empty_model_list"
  | "no_model_list";

export interface ModelInfo {
  id: string;
  contextWindow: number | null;
  reasoningEfforts: ReasoningEffortValue[] | null;
}

export interface ModelMetadataAvailability {
  modelCount: number;
  contextWindowCount: number;
  reasoningEffortCount: number;
}

export interface ModelParseMessages {
  emptyModelList: string;
  invalidJSON: string;
  noModelList: string;
  nonJSON: string;
}

export class ModelProbeError extends Error {
  constructor(
    readonly code: ModelProbeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelProbeError";
  }
}

const DEFAULT_PARSE_MESSAGES: ModelParseMessages = {
  emptyModelList: "Site returned an empty model list.",
  invalidJSON: "Failed to parse JSON from site.",
  noModelList: "Site response does not contain a model-list field.",
  nonJSON: "Site did not return JSON.",
};

export function normalizeProviderID(value: unknown) {
  if (typeof value !== "string") {
    return "openai-compatible";
  }
  const normalized = value.trim().toLowerCase();
  return normalized || "openai-compatible";
}

export function normalizeString(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffortValue {
  if (typeof value !== "string") {
    return "default";
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, "");
  if (normalized === "extra" || normalized === "extrahigh") {
    return "xhigh";
  }
  return REASONING_EFFORT_VALUES.includes(normalized as ReasoningEffortValue)
    ? (normalized as ReasoningEffortValue)
    : "default";
}

export function getDefaultModelForProvider(_providerID: string) {
  return FALLBACK_MODEL_ID;
}

export function buildModelSourceKey(providerID: string, baseURL: string) {
  return `${normalizeProviderID(providerID)}|${normalizeBaseURL(baseURL)}`;
}

export function normalizeBaseURL(baseURL: string) {
  return baseURL.trim().replace(/\/+$/, "");
}

export function resolveModelOptions(
  providerID: string,
  baseURL: string,
  currentModel: string,
  cache: Map<string, string[]>,
) {
  const cached = cache.get(buildModelSourceKey(providerID, baseURL));
  if (cached?.length) {
    return cached;
  }
  return currentModel ? [currentModel] : [FALLBACK_MODEL_ID];
}

export function buildModelContextMap(modelInfos: ModelInfo[]) {
  const contextByModel = new Map<string, number>();
  for (const modelInfo of modelInfos) {
    if (modelInfo.contextWindow && modelInfo.contextWindow > 0) {
      contextByModel.set(modelInfo.id, modelInfo.contextWindow);
    }
  }
  return contextByModel;
}

export function buildModelReasoningMap(modelInfos: ModelInfo[]) {
  const reasoningByModel = new Map<string, ReasoningEffortValue[]>();
  for (const modelInfo of modelInfos) {
    if (modelInfo.reasoningEfforts?.length) {
      reasoningByModel.set(modelInfo.id, modelInfo.reasoningEfforts);
    }
  }
  return reasoningByModel;
}

export function summarizeModelMetadataAvailability(
  modelInfos: readonly ModelInfo[],
): ModelMetadataAvailability {
  return {
    modelCount: modelInfos.length,
    contextWindowCount: modelInfos.filter(
      (modelInfo) => modelInfo.contextWindow && modelInfo.contextWindow > 0,
    ).length,
    reasoningEffortCount: modelInfos.filter(
      (modelInfo) => modelInfo.reasoningEfforts?.length,
    ).length,
  };
}

export function resolveEffectiveReasoningEffort(
  options: readonly ReasoningEffortValue[],
  requested: ReasoningEffortValue,
) {
  return options.includes(requested) ? requested : "default";
}

export function buildModelEndpointCandidates(baseURL: string) {
  const endpoints: string[] = [];
  const trimmed = baseURL.trim();
  if (!trimmed) {
    return endpoints;
  }
  addCandidateEndpoint(endpoints, trimmed);
  if (!/\/models(?:[/?#]|$)/i.test(trimmed)) {
    addCandidateEndpoint(endpoints, `${trimmed.replace(/\/+$/, "")}/models`);
  }
  const stripped = trimmed.replace(
    /\/(chat\/completions|responses|completions)(?:[/?#].*)?$/i,
    "",
  );
  if (stripped !== trimmed) {
    addCandidateEndpoint(endpoints, `${stripped.replace(/\/+$/, "")}/models`);
  }
  try {
    const parsed = new URL(trimmed);
    addCandidateEndpoint(endpoints, `${parsed.origin}/v1/models`);
    addCandidateEndpoint(endpoints, `${parsed.origin}/models`);
  } catch {
    // Ignore invalid URL parse and keep literal candidates.
  }
  return endpoints;
}

export function parseModelIDs(
  responseText: string,
  messages?: Partial<ModelParseMessages>,
) {
  return parseModelInfos(responseText, messages).map(
    (modelInfo) => modelInfo.id,
  );
}

export function parseModelInfos(
  responseText: string,
  messages: Partial<ModelParseMessages> = {},
): ModelInfo[] {
  const labels = { ...DEFAULT_PARSE_MESSAGES, ...messages };
  const trimmed = responseText.trim();
  if (!trimmed) {
    throw new ModelProbeError("empty_model_list", labels.emptyModelList);
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    throw new ModelProbeError("non_json", labels.nonJSON);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    throw new ModelProbeError("invalid_json", labels.invalidJSON);
  }
  let foundModelArray = false;
  const items: unknown[] = [];
  if (Array.isArray(payload)) {
    foundModelArray = true;
    items.push(...payload);
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["data", "models", "items", "result", "results"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        foundModelArray = true;
        items.push(...value);
      }
    }
  }
  if (!foundModelArray) {
    throw new ModelProbeError("no_model_list", labels.noModelList);
  }
  const modelInfos: ModelInfo[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const value = item.trim();
      if (value && !modelInfos.some((modelInfo) => modelInfo.id === value)) {
        modelInfos.push({
          id: value,
          contextWindow: null,
          reasoningEfforts: null,
        });
      }
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const modelID = [record.id, record.model, record.name]
      .find((candidate) => typeof candidate === "string")
      ?.toString()
      .trim();
    if (modelID && !modelInfos.some((modelInfo) => modelInfo.id === modelID)) {
      modelInfos.push({
        id: modelID,
        contextWindow: extractModelContextWindow(record),
        reasoningEfforts: extractModelReasoningEfforts(record),
      });
    }
  }
  if (!modelInfos.length) {
    throw new ModelProbeError("empty_model_list", labels.emptyModelList);
  }
  return modelInfos;
}

export function canRetryModelEndpoint(
  index: number,
  total: number,
  error: Error,
) {
  if (index >= total - 1) {
    return false;
  }
  if (error instanceof ModelProbeError) {
    return true;
  }
  const statusCode = parseStatusCodeFromError(error);
  if (statusCode === 404 || statusCode === 405) {
    return true;
  }
  const text = error.message.toLowerCase();
  return (
    text.includes("not found") ||
    text.includes("unsupported endpoint") ||
    text.includes("cannot get")
  );
}

function addCandidateEndpoint(target: string[], endpoint: string) {
  const normalized = endpoint.trim();
  if (!normalized || target.includes(normalized)) {
    return;
  }
  target.push(normalized);
}

function extractModelContextWindow(record: Record<string, unknown>) {
  const candidates = [
    record.context_length,
    record.context_window,
    record.contextWindow,
    record.max_context_window,
    record.maxContextWindow,
    record.max_context_length,
    record.max_context_tokens,
    record.max_model_len,
    record.max_sequence_length,
    record.input_token_limit,
    record.max_input_tokens,
    readNestedValue(record, ["top_provider", "context_length"]),
    readNestedValue(record, ["topProvider", "contextLength"]),
    readNestedValue(record, ["limits", "context_length"]),
    readNestedValue(record, ["limits", "contextWindow"]),
    readNestedValue(record, ["limits", "max_context_window"]),
    readNestedValue(record, ["limits", "maxContextWindow"]),
    readNestedValue(record, ["capabilities", "context_length"]),
    readNestedValue(record, ["capabilities", "contextWindow"]),
    readNestedValue(record, ["capabilities", "max_context_window"]),
    readNestedValue(record, ["capabilities", "maxContextWindow"]),
  ];
  for (const candidate of candidates) {
    const normalized = normalizePositiveInteger(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function normalizePositiveInteger(value: unknown) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : 0;
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }
  return Math.floor(numberValue);
}

function extractModelReasoningEfforts(record: Record<string, unknown>) {
  const candidates = [
    record.reasoning_efforts,
    record.supported_reasoning_efforts,
    record.reasoningEfforts,
    record.supportedReasoningEfforts,
    record.reasoning_effort_values,
    record.supported_reasoning_levels,
    readNestedValue(record, ["reasoning", "efforts"]),
    readNestedValue(record, ["reasoning", "supported_efforts"]),
    readNestedValue(record, ["reasoning", "supportedReasoningEfforts"]),
    readNestedValue(record, ["capabilities", "reasoning_efforts"]),
    readNestedValue(record, ["capabilities", "supported_reasoning_efforts"]),
  ];
  const output: ReasoningEffortValue[] = [];
  for (const candidate of candidates) {
    for (const value of normalizeReasoningEffortList(candidate)) {
      if (!output.includes(value)) {
        output.push(value);
      }
    }
  }
  return output.length ? output : null;
}

function readNestedValue(record: Record<string, unknown>, path: string[]) {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function normalizeReasoningEffortList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(normalizeReasoningEffortEntry)
      .filter((entry) => entry !== "default");
  }
  if (typeof value === "string") {
    return value
      .split(/[,\s|/]+/)
      .map(normalizeReasoningEffort)
      .filter((entry) => entry !== "default");
  }
  return [];
}

function normalizeReasoningEffortEntry(value: unknown) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return normalizeReasoningEffort(
      record.effort ?? record.value ?? record.level ?? record.name ?? record.id,
    );
  }
  return normalizeReasoningEffort(value);
}

function parseStatusCodeFromError(error: Error) {
  const match = error.message.match(/\b(\d{3})\b/);
  if (!match) {
    return 0;
  }
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : 0;
}
