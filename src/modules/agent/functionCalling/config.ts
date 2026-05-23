import { getPref } from "../../../utils/prefs";
import { buildEndpointKey, isNativeToolsUnsupported } from "./quirks";
import { getOpenAIToolSpecs } from "../toolAction";
import { isPdfToolsEnabledPref } from "../../tools/annotationTools";

export function getToolCallMode(): "auto" | "native" | "text" {
  const raw = String(getPref("toolCallMode") || "")
    .trim()
    .toLowerCase();
  if (raw === "native" || raw === "text") {
    return raw;
  }
  return "auto";
}

export function getActiveBaseURL(): string {
  return String(getPref("openaiBaseUrl") || "").trim();
}

export function getActiveEndpointKey(): string {
  const provider = String(getPref("provider") || "");
  return buildEndpointKey(provider, getActiveBaseURL());
}

export function shouldUseNativeToolCalls(): boolean {
  if (!isPdfToolsEnabledPref()) {
    return false;
  }
  const mode = getToolCallMode();
  if (mode === "text") {
    return false;
  }
  if (mode === "auto" && isNativeToolsUnsupported(getActiveEndpointKey())) {
    return false;
  }
  return true;
}

export function buildNativeToolSpecs() {
  const allowed = new Set<string>();
  if (isPdfToolsEnabledPref()) {
    for (const name of [
      "read_pdf",
      "list_annotations",
      "propose_annotation",
      "modify_annotation",
      "delete_annotation",
    ]) {
      allowed.add(name);
    }
  }
  if (!allowed.size) {
    return [];
  }
  return getOpenAIToolSpecs().filter((spec) => allowed.has(spec.function.name));
}
