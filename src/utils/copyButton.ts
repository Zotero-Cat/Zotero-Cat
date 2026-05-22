// Inline "copy to clipboard" button factory shared by every section that
// shows machine-generated text users may want to grab — assistant messages,
// proposal error rows, tool-event failure details.
//
// Keeps button label flipping ("Copy" → "Copied") and toast feedback in one
// place so all surfaces behave the same regardless of where they live.

import { getString } from "./locale";
import { copyTextToClipboard } from "./clipboard";

const TOAST_HIDE_DELAY_MS = 950;
const TOAST_REMOVE_DELAY_MS = 160;
const BUTTON_FLIP_DURATION_MS = 900;

export interface InlineCopyButtonOptions {
  className?: string;
  label?: string;
  copiedLabel?: string;
  toastMessage?: string;
}

// Create a small inline copy button that copies `getValue()` on click. The
// caller controls how the button is positioned (the returned element has no
// inherent layout). Use `className` to namespace styling per call site.
export function createInlineCopyButton(
  doc: Document,
  getValue: () => string,
  options: InlineCopyButtonOptions = {},
): HTMLButtonElement {
  const button = doc.createElement("button");
  const className = options.className?.trim() || "za-agent-inline-copy";
  button.type = "button";
  button.className = className;
  button.textContent = "⧉";
  const defaultLabel = options.label ?? getString("agent-copy-tooltip");
  const copiedLabel = options.copiedLabel ?? getString("agent-copied-tooltip");
  button.title = defaultLabel;
  button.setAttribute("aria-label", defaultLabel);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const value = getValue();
    if (!value.trim()) {
      return;
    }
    const success = await copyTextToClipboard(value);
    if (!success) {
      return;
    }
    showCopyFeedback(
      doc,
      options.toastMessage ?? getString("agent-copied-feedback"),
    );
    button.classList.add("is-copied");
    button.title = copiedLabel;
    button.setAttribute("aria-label", copiedLabel);
    const view = doc.defaultView;
    view?.setTimeout(() => {
      button.classList.remove("is-copied");
      button.title = defaultLabel;
      button.setAttribute("aria-label", defaultLabel);
    }, BUTTON_FLIP_DURATION_MS);
  });
  return button;
}

// Toast pinned to the section root. No-ops when the root is not in the tree
// (e.g., the section was just torn down).
export function showCopyFeedback(doc: Document, message: string): void {
  const root = doc.querySelector<HTMLElement>(".za-agent-root");
  if (!root) {
    return;
  }
  const previous = root.querySelector(".za-agent-copy-toast");
  if (previous) {
    previous.remove();
  }
  const toast = doc.createElement("div");
  toast.className = "za-agent-copy-toast";
  toast.textContent = message;
  root.appendChild(toast);
  const view = doc.defaultView;
  if (!view) {
    return;
  }
  view.requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });
  view.setTimeout(() => {
    toast.classList.remove("is-visible");
    view.setTimeout(() => {
      toast.remove();
    }, TOAST_REMOVE_DELAY_MS);
  }, TOAST_HIDE_DELAY_MS);
}
