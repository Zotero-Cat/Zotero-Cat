import { getString } from "../../../utils/locale";

export interface AgentComposerState {
  locked: boolean;
  sending: boolean;
}

export interface AgentComposerHandlers {
  onStop: () => void;
  onSubmit: (prompt: string) => void;
}

export function createAgentComposer(
  doc: Document,
  state: AgentComposerState,
  handlers: AgentComposerHandlers,
): HTMLDivElement {
  const composer = doc.createElement("div");
  composer.className = "za-agent-composer";

  const input = doc.createElement("input");
  input.className = "za-agent-input";
  input.type = "text";
  input.placeholder = state.locked
    ? getString("agent-proposals-composer-locked")
    : getString("agent-input-placeholder");
  input.disabled = state.sending || state.locked;

  const sendButton = doc.createElement("button");
  sendButton.className = "za-agent-send";
  sendButton.classList.add(state.sending ? "is-stop" : "is-send");
  sendButton.disabled = state.locked && !state.sending;
  const buttonLabel = state.sending
    ? getString("agent-stop-tooltip")
    : getString("agent-send-tooltip");
  sendButton.title = buttonLabel;
  sendButton.setAttribute("aria-label", buttonLabel);

  sendButton.addEventListener("click", () => {
    if (state.sending) {
      handlers.onStop();
      return;
    }
    const prompt = input.value.trim();
    if (!prompt) {
      return;
    }
    handlers.onSubmit(prompt);
    input.value = "";
  });

  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendButton.click();
    }
  });

  composer.append(input, sendButton);
  return composer;
}
