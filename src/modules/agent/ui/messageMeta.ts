import { getString } from "../../../utils/locale";
import { copyTextToClipboard } from "../../../utils/clipboard";
import { showCopyFeedback } from "../../../utils/copyButton";
import type { RuntimeMessage } from "../conversationStore";

export function createMessageMeta(
  doc: Document,
  message: RuntimeMessage,
): HTMLElement {
  const meta = doc.createElement("div");
  meta.className = "za-agent-message-meta";
  const parts = [formatMessageDateTime(message.createdAt)];
  if (
    message.role === "assistant" &&
    typeof message.responseWaitMs === "number" &&
    Number.isFinite(message.responseWaitMs)
  ) {
    parts.push(
      getString("agent-meta-response-wait", {
        args: {
          seconds: formatWaitSeconds(message.responseWaitMs),
        },
      }),
    );
  }
  meta.textContent = parts.join(" · ");
  return meta;
}

export function formatMessageDateTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
  }
}

export function formatWaitSeconds(durationMs: number): string {
  const seconds = Math.max(0, durationMs) / 1000;
  return seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1);
}

export function createCopyButton(
  doc: Document,
  messageContent: string,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.className = "za-agent-copy";
  const defaultLabel = getString("agent-copy-tooltip");
  button.title = defaultLabel;
  button.setAttribute("aria-label", defaultLabel);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const copied = await copyTextToClipboard(messageContent);
    if (!copied) {
      return;
    }
    showCopyFeedback(doc, getString("agent-copied-feedback"));
    button.classList.add("is-copied");
    const copiedLabel = getString("agent-copied-tooltip");
    button.title = copiedLabel;
    button.setAttribute("aria-label", copiedLabel);
    const view = doc.defaultView;
    view?.setTimeout(() => {
      button.classList.remove("is-copied");
      button.title = defaultLabel;
      button.setAttribute("aria-label", defaultLabel);
    }, 900);
  });
  return button;
}

export function createContextToggle(
  doc: Document,
  labelKey:
    | "agent-web-search-toggle"
    | "agent-pdf-tools-toggle"
    | "agent-pdf-tools-auto-apply",
  checked: boolean,
  disabled: boolean,
  onChange: (value: boolean) => void,
): HTMLLabelElement {
  const label = doc.createElement("label");
  label.className = "za-agent-context-toggle";
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.disabled = disabled;
  checkbox.addEventListener("change", () => {
    onChange(checkbox.checked);
  });
  const text = doc.createElement("span");
  text.textContent = getString(labelKey);
  label.append(checkbox, text);
  return label;
}
