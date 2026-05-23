export type AnnotationOp = "create" | "update" | "delete";

export type AnnotationProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "failed";

export interface AnnotationResolvedJSON {
  type: "highlight" | "underline" | "note" | "text";
  pageIndex: number;
  pageLabel: string;
  rects: number[][];
  pageWidth?: number;
  pageHeight?: number;
  text?: string;
  comment?: string;
  color?: string;
  tags?: { name: string; color?: string }[];
  key?: string;
}

export interface AnnotationProposal {
  id: string;
  op: AnnotationOp;
  attachmentKey: string;
  attachmentID: number;
  annotationKey?: string;
  resolved: AnnotationResolvedJSON;
  sourceSnippet: string;
  status: AnnotationProposalStatus;
  errorMessage?: string;
  createdAt: number;
}

export interface AnnotationBatch {
  id: string;
  conversationKey: string;
  assistantMessageIndex: number;
  createdAt: number;
  proposals: AnnotationProposal[];
}

export type AnnotationProposalInput = Omit<
  AnnotationProposal,
  "id" | "status" | "createdAt"
> & {
  status?: AnnotationProposalStatus;
};

export interface BatchSummary {
  accepted: number;
  rejected: number;
  failed: number;
  pending: number;
}

const MAX_PROPOSALS_PER_BATCH = 10;

const batchesByConversation = new Map<string, AnnotationBatch>();
const subscribers = new Set<() => void>();

export function subscribeAnnotationProposals(handler: () => void): () => void {
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}

function emitChange() {
  for (const handler of subscribers) {
    try {
      handler();
    } catch {
      // subscriber errors must not break state updates
    }
  }
}

export function getBatchForConversation(
  conversationKey: string,
): AnnotationBatch | null {
  return batchesByConversation.get(conversationKey) || null;
}

export function hasPendingBatch(conversationKey: string): boolean {
  const batch = batchesByConversation.get(conversationKey);
  if (!batch) {
    return false;
  }
  return batch.proposals.some((proposal) => proposal.status === "pending");
}

export function summarizeBatch(batch: AnnotationBatch): BatchSummary {
  const summary: BatchSummary = {
    accepted: 0,
    rejected: 0,
    failed: 0,
    pending: 0,
  };
  for (const proposal of batch.proposals) {
    summary[proposal.status] += 1;
  }
  return summary;
}

export function getProposalApprovalKey(
  proposal: Pick<AnnotationProposal, "op" | "resolved">,
): string {
  return `${proposal.op}:${proposal.resolved.type}`;
}

export function getPendingApprovalKeys(batch: AnnotationBatch): string[] {
  const keys = new Set<string>();
  for (const proposal of batch.proposals) {
    if (proposal.status === "pending") {
      keys.add(getProposalApprovalKey(proposal));
    }
  }
  return [...keys].sort();
}

export function createBatch(
  conversationKey: string,
  assistantMessageIndex: number,
  proposals: AnnotationProposalInput[],
): AnnotationBatch {
  const capped = proposals.slice(0, MAX_PROPOSALS_PER_BATCH);
  const now = Date.now();
  const batch: AnnotationBatch = {
    id: `batch-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    conversationKey,
    assistantMessageIndex,
    createdAt: now,
    proposals: capped.map((input, index) => ({
      ...input,
      id: `prop-${now.toString(36)}-${index}`,
      status: input.status || "pending",
      createdAt: now,
    })),
  };
  batchesByConversation.set(conversationKey, batch);
  emitChange();
  return batch;
}

export function addProposals(
  conversationKey: string,
  assistantMessageIndex: number,
  proposals: AnnotationProposalInput[],
): AnnotationBatch {
  const existing = batchesByConversation.get(conversationKey);
  if (
    !existing ||
    existing.assistantMessageIndex !== assistantMessageIndex ||
    !hasPendingBatch(conversationKey)
  ) {
    return createBatch(conversationKey, assistantMessageIndex, proposals);
  }
  const remainingSlots = MAX_PROPOSALS_PER_BATCH - existing.proposals.length;
  if (remainingSlots <= 0) {
    return existing;
  }
  const now = Date.now();
  const appended = proposals.slice(0, remainingSlots).map((input, index) => ({
    ...input,
    id: `prop-${now.toString(36)}-${existing.proposals.length + index}`,
    status: input.status || ("pending" as AnnotationProposalStatus),
    createdAt: now,
  }));
  existing.proposals.push(...appended);
  emitChange();
  return existing;
}

export function setProposalStatus(
  conversationKey: string,
  proposalID: string,
  status: AnnotationProposalStatus,
  errorMessage?: string,
): boolean {
  const batch = batchesByConversation.get(conversationKey);
  if (!batch) {
    return false;
  }
  const proposal = batch.proposals.find((entry) => entry.id === proposalID);
  if (!proposal) {
    return false;
  }
  proposal.status = status;
  if (errorMessage) {
    proposal.errorMessage = errorMessage;
  } else if (status !== "failed") {
    delete proposal.errorMessage;
  }
  emitChange();
  return true;
}

export function acceptAllPending(conversationKey: string): string[] {
  const batch = batchesByConversation.get(conversationKey);
  if (!batch) {
    return [];
  }
  const ids: string[] = [];
  for (const proposal of batch.proposals) {
    if (proposal.status === "pending") {
      proposal.status = "accepted";
      ids.push(proposal.id);
    }
  }
  if (ids.length) {
    emitChange();
  }
  return ids;
}

export function rejectAllPending(conversationKey: string): string[] {
  const batch = batchesByConversation.get(conversationKey);
  if (!batch) {
    return [];
  }
  const ids: string[] = [];
  for (const proposal of batch.proposals) {
    if (proposal.status === "pending") {
      proposal.status = "rejected";
      ids.push(proposal.id);
    }
  }
  if (ids.length) {
    emitChange();
  }
  return ids;
}

export function clearBatch(conversationKey: string): boolean {
  if (!batchesByConversation.has(conversationKey)) {
    return false;
  }
  batchesByConversation.delete(conversationKey);
  emitChange();
  return true;
}

export function clearAllBatches(): void {
  if (!batchesByConversation.size) {
    return;
  }
  batchesByConversation.clear();
  emitChange();
}

export const annotationProposalsTestUtils = {
  maxPerBatch: MAX_PROPOSALS_PER_BATCH,
  reset() {
    batchesByConversation.clear();
    subscribers.clear();
  },
};
