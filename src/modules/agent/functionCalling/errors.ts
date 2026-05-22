// Typed errors emitted by the function-calling runner and the underlying
// provider. Kept in one place so callers can install single-source recovery
// without depending on provider.ts internals.

export class ToolsNotSupportedError extends Error {
  name = "ToolsNotSupportedError";
}

// Some "thinking-mode" relays (DeepSeek-V4-Thinking, certain xiaomimimo /
// Doubao / Qwen3 relays) reject follow-up requests unless the original
// assistant turn's reasoning_content is echoed back. The runner uses this to
// detect that quirk and remember it per endpoint.
export class ReasoningContentRequiredError extends Error {
  name = "ReasoningContentRequiredError";
}

export class MaxToolDepthExceededError extends Error {
  name = "MaxToolDepthExceededError";
  readonly maxDepth: number;
  constructor(maxDepth: number) {
    super(`Tool-call depth limit reached (max ${maxDepth}).`);
    this.maxDepth = maxDepth;
  }
}

export function isFunctionCallingRecoverableError(
  error: unknown,
): error is ToolsNotSupportedError | ReasoningContentRequiredError {
  return (
    error instanceof ToolsNotSupportedError ||
    error instanceof ReasoningContentRequiredError
  );
}
