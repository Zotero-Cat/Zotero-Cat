import { getString } from "../../../utils/locale";
import { getPref } from "../../../utils/prefs";
import { isApiKeyRequiredForProvider } from "../provider";
import {
  normalizeBaseURL,
  normalizeProviderID,
  normalizeString,
} from "../modelMetadata";
import { getProviderApiKey } from "../secureApiKey";
import { applyRootDimensions, ensureBodyResizeObserver } from "./layout";

export interface ProviderGateHandlers {
  openPreferences: () => void;
  onOpenPreferencesError: (error: unknown) => void;
}

export function isProviderConfigured(): boolean {
  const providerID = normalizeProviderID(getPref("provider"));
  if (!isApiKeyRequiredForProvider(providerID)) {
    return true;
  }
  const baseURL = normalizeString(getPref("openaiBaseUrl"), "");
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  if (!normalizedBaseURL) {
    return false;
  }
  return Boolean(getProviderApiKey(providerID, normalizedBaseURL));
}

export function renderProviderGate(
  body: HTMLDivElement,
  doc: Document,
  handlers: ProviderGateHandlers,
): void {
  const root = doc.createElement("div");
  root.className = "za-agent-root za-agent-gate";
  applyRootDimensions(root, body);
  ensureBodyResizeObserver(body);

  const title = doc.createElement("div");
  title.className = "za-agent-gate-title";
  title.textContent = getString("agent-gate-title");

  const message = doc.createElement("div");
  message.className = "za-agent-gate-message";
  message.textContent = getString("agent-gate-message");

  const button = doc.createElement("button");
  button.className = "za-agent-gate-button";
  button.textContent = getString("agent-gate-open-settings");
  button.addEventListener("click", () => {
    try {
      handlers.openPreferences();
    } catch (error) {
      handlers.onOpenPreferencesError(error);
    }
  });

  root.append(title, message, button);
  body.replaceChildren(root);
}

export function renderConversationStoreLoading(
  body: HTMLDivElement,
  doc: Document,
): void {
  const root = doc.createElement("div");
  root.className = "za-agent-root";
  applyRootDimensions(root, body);
  ensureBodyResizeObserver(body);

  const loading = doc.createElement("div");
  loading.className = "za-agent-empty";
  loading.textContent = getString("agent-waiting-label");
  root.appendChild(loading);
  body.replaceChildren(root);
}
