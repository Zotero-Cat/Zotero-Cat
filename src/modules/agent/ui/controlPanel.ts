import { getString } from "../../../utils/locale";
import type { ReasoningEffortValue } from "../modelMetadata";
import { getPromptTemplateByID, getPromptTemplates } from "../promptTemplates";
import {
  getFetchModelsLabel,
  getFetchingModelsLabel,
  getModelLabel,
  getReasoningLabel,
} from "./labels";
import { createContextToggle } from "./messageMeta";
import { renderModelOptions, renderReasoningOptions } from "./modelControls";

export interface AgentControlPanelState {
  currentModel: string;
  effectiveReasoningEffort: ReasoningEffortValue;
  modelFetchBusy: boolean;
  modelFetchStatusKind: string;
  modelFetchStatusMessage: string;
  modelOptions: string[];
  pdfToolsAutoApply: boolean;
  pdfToolsEnabled: boolean;
  reasoningOptions: ReasoningEffortValue[];
  reasoningStatusText: string;
  sending: boolean;
  templateID: string;
  webSearchEnabled: boolean;
}

export interface AgentControlPanelHandlers {
  onFetchModels: () => void;
  onModelChange: (model: string) => void;
  onPdfToolsAutoApplyChange: (enabled: boolean) => void;
  onPdfToolsChange: (enabled: boolean) => void;
  onReasoningChange: (value: ReasoningEffortValue) => void;
  onTemplateChange: (templateID: string) => void;
  onWebSearchChange: (enabled: boolean) => void;
}

export function createAgentControlPanel(
  doc: Document,
  state: AgentControlPanelState,
  handlers: AgentControlPanelHandlers,
): HTMLDivElement {
  const controls = doc.createElement("div");
  controls.className = "za-agent-controls";

  const modelRow = doc.createElement("div");
  modelRow.className = "za-agent-model-row";

  const modelLabel = doc.createElement("span");
  modelLabel.className = "za-agent-template-label";
  modelLabel.textContent = `${getModelLabel()}:`;

  const modelSelect = doc.createElement("select");
  modelSelect.className = "za-agent-model-select";
  modelSelect.disabled = state.sending || state.modelFetchBusy;
  renderModelOptions(modelSelect, state.modelOptions);
  modelSelect.value = state.currentModel;
  modelSelect.addEventListener("change", () => {
    handlers.onModelChange(modelSelect.value);
  });

  const fetchModelsButton = doc.createElement("button");
  fetchModelsButton.className = "za-agent-model-fetch";
  fetchModelsButton.disabled = state.sending || state.modelFetchBusy;
  fetchModelsButton.textContent = state.modelFetchBusy
    ? getFetchingModelsLabel()
    : getFetchModelsLabel();
  fetchModelsButton.addEventListener("click", handlers.onFetchModels);
  modelRow.append(modelLabel, modelSelect, fetchModelsButton);

  const templateRow = doc.createElement("div");
  templateRow.className = "za-agent-template-row";

  const templateLabel = doc.createElement("span");
  templateLabel.className = "za-agent-template-label";
  templateLabel.textContent = `${getString("agent-template-label")}:`;

  const templateSelect = doc.createElement("select");
  templateSelect.className = "za-agent-template-select";
  templateSelect.disabled = state.sending;
  for (const template of getPromptTemplates()) {
    const option = doc.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    templateSelect.appendChild(option);
  }
  templateSelect.value = getPromptTemplateByID(state.templateID).id;
  templateSelect.addEventListener("change", () => {
    handlers.onTemplateChange(getPromptTemplateByID(templateSelect.value).id);
  });

  const reasoningLabel = doc.createElement("span");
  reasoningLabel.className = "za-agent-template-label";
  reasoningLabel.textContent = `${getReasoningLabel()}:`;

  const reasoningSelect = doc.createElement("select");
  reasoningSelect.className = "za-agent-reasoning-select";
  reasoningSelect.disabled = state.sending || state.modelFetchBusy;
  renderReasoningOptions(reasoningSelect, state.reasoningOptions);
  reasoningSelect.value = state.effectiveReasoningEffort;
  reasoningSelect.addEventListener("change", () => {
    handlers.onReasoningChange(reasoningSelect.value as ReasoningEffortValue);
  });

  const reasoningStatus = doc.createElement("span");
  reasoningStatus.className = "za-agent-reasoning-status";
  reasoningStatus.textContent = state.reasoningStatusText;

  templateRow.append(
    templateLabel,
    templateSelect,
    reasoningLabel,
    reasoningSelect,
    reasoningStatus,
  );

  const contextRow = doc.createElement("div");
  contextRow.className = "za-agent-context-row";
  contextRow.append(
    createContextToggle(
      doc,
      "agent-web-search-toggle",
      state.webSearchEnabled,
      state.sending,
      handlers.onWebSearchChange,
    ),
    createContextToggle(
      doc,
      "agent-pdf-tools-toggle",
      state.pdfToolsEnabled,
      state.sending,
      handlers.onPdfToolsChange,
    ),
    createContextToggle(
      doc,
      "agent-pdf-tools-auto-apply",
      state.pdfToolsAutoApply,
      state.sending || !state.pdfToolsEnabled,
      handlers.onPdfToolsAutoApplyChange,
    ),
  );

  controls.append(modelRow, templateRow, contextRow);
  if (state.modelFetchStatusMessage) {
    const status = doc.createElement("div");
    status.className = "za-agent-model-status";
    if (state.modelFetchStatusKind) {
      status.dataset.kind = state.modelFetchStatusKind;
    }
    status.textContent = state.modelFetchStatusMessage;
    controls.append(status);
  }
  return controls;
}
