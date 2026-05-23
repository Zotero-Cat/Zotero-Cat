import type { AnnotationBatch } from "../../tools/annotationProposals";
import { getProposalApprovalKey } from "../../tools/annotationProposals";
import type { AgentRuntime } from "./state";

export function shouldAutoApplyAnnotationBatch(
  runtime: AgentRuntime,
  batch: AnnotationBatch,
  pdfToolsAutoApply: boolean,
): boolean {
  const approvalKeys = getScopedPendingApprovalKeys(batch);
  if (!approvalKeys.length) {
    return false;
  }
  if (pdfToolsAutoApply) {
    return true;
  }
  return approvalKeys.every((key) =>
    runtime.approvedAnnotationOperationKeys.has(key),
  );
}

export function rememberAnnotationOperationApprovals(
  runtime: AgentRuntime,
  batch: AnnotationBatch,
): void {
  for (const key of getScopedPendingApprovalKeys(batch)) {
    runtime.approvedAnnotationOperationKeys.add(key);
  }
}

export function getScopedPendingApprovalKeys(batch: AnnotationBatch): string[] {
  const keys = new Set<string>();
  for (const proposal of batch.proposals) {
    if (proposal.status !== "pending") {
      continue;
    }
    keys.add(
      `${batch.conversationKey}:${proposal.attachmentKey}:${getProposalApprovalKey(proposal)}`,
    );
  }
  return [...keys].sort();
}
