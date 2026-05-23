import { createRuntimeID } from "../runtimeIds";
import type { AgentRuntime, DiagnosticEntry } from "./state";

export const MAX_DIAGNOSTIC_ENTRIES = 30;

export function recordDiagnostic(
  runtime: AgentRuntime,
  level: DiagnosticEntry["level"],
  message: string,
  detail?: string,
): void {
  runtime.diagnostics.push({
    id: createRuntimeID("diag"),
    level,
    createdAt: Date.now(),
    message,
    detail,
  });
  if (runtime.diagnostics.length > MAX_DIAGNOSTIC_ENTRIES) {
    runtime.diagnostics = runtime.diagnostics.slice(-MAX_DIAGNOSTIC_ENTRIES);
  }
}
