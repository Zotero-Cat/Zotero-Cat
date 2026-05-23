import type { ReasoningEffortValue } from "../modelMetadata";
import { getReasoningOptionLabel } from "./labels";

export function renderModelOptions(
  select: HTMLSelectElement,
  models: string[],
): void {
  const doc = select.ownerDocument;
  if (!doc) {
    return;
  }
  select.replaceChildren();
  for (const model of models) {
    const option = doc.createElement("option");
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  }
}

export function renderReasoningOptions(
  select: HTMLSelectElement,
  values: ReasoningEffortValue[],
): void {
  const doc = select.ownerDocument;
  if (!doc) {
    return;
  }
  select.replaceChildren();
  for (const value of values) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = getReasoningOptionLabel(value);
    select.appendChild(option);
  }
}
