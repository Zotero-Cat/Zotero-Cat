import { setPref } from "../../utils/prefs";
import type { AgentRuntime } from "./runtime/state";
import {
  buildModelContextMap,
  buildModelReasoningMap,
  buildModelSourceKey,
  resolveEffectiveReasoningEffort,
  type ModelInfo,
  type ReasoningEffortValue,
} from "./modelMetadata";

export type ReasoningMetadataState =
  | "declared"
  | "queried-undeclared"
  | "not-queried";

export function resolveRuntimeModelContextWindow(
  runtime: AgentRuntime,
  providerID: string,
  baseURL: string,
  model: string,
): number | null {
  const contextByModel = runtime.modelContextBySource.get(
    buildModelSourceKey(providerID, baseURL),
  );
  return contextByModel?.get(model) || null;
}

export function resolveRuntimeReasoningOptions(
  runtime: AgentRuntime,
  providerID: string,
  baseURL: string,
  model: string,
): ReasoningEffortValue[] {
  const reasoningByModel = runtime.modelReasoningBySource.get(
    buildModelSourceKey(providerID, baseURL),
  );
  const providerOptions = reasoningByModel?.get(model);
  if (!providerOptions?.length) {
    return ["default"];
  }
  const options: ReasoningEffortValue[] = ["default"];
  for (const option of providerOptions) {
    if (option !== "default" && !options.includes(option)) {
      options.push(option);
    }
  }
  return options;
}

export function syncReasoningEffortPref(
  options: ReasoningEffortValue[],
  requested: ReasoningEffortValue,
): ReasoningEffortValue {
  const effective = resolveEffectiveReasoningEffort(options, requested);
  if (effective !== requested) {
    setPref("openaiReasoningEffort", effective);
  }
  return effective;
}

export function getReasoningMetadataState(
  runtime: AgentRuntime,
  providerID: string,
  baseURL: string,
  model: string,
): ReasoningMetadataState {
  const sourceKey = buildModelSourceKey(providerID, baseURL);
  const hasDeclaredMetadata = Boolean(
    runtime.modelReasoningBySource.get(sourceKey)?.get(model)?.length,
  );
  if (hasDeclaredMetadata) {
    return "declared";
  }
  if (runtime.modelReasoningBySource.has(sourceKey)) {
    return "queried-undeclared";
  }
  return "not-queried";
}

export function cacheModelInfos(
  runtime: AgentRuntime,
  providerID: string,
  baseURL: string,
  modelInfos: ModelInfo[],
): string[] {
  const sourceKey = buildModelSourceKey(providerID, baseURL);
  const models = modelInfos.map((modelInfo) => modelInfo.id);
  runtime.modelOptionsBySource.set(sourceKey, models);
  runtime.modelContextBySource.set(sourceKey, buildModelContextMap(modelInfos));
  runtime.modelReasoningBySource.set(
    sourceKey,
    buildModelReasoningMap(modelInfos),
  );
  return models;
}
