import type { AnnotationProposal } from "./annotationProposals";
import {
  createAnnotation,
  deleteAnnotation,
  updateAnnotation,
  type SaveAnnotationResult,
} from "./pdfAnnotations";

export async function applyProposal(
  attachment: Zotero.Item,
  proposal: AnnotationProposal,
): Promise<SaveAnnotationResult> {
  if (proposal.op === "create") {
    return createAnnotation(attachment, proposal.resolved);
  }
  if (proposal.op === "update") {
    if (!proposal.annotationKey) {
      return { success: false, error: "Missing annotation key." };
    }
    return updateAnnotation(attachment, {
      ...proposal.resolved,
      key: proposal.annotationKey,
    });
  }
  if (proposal.op === "delete") {
    if (!proposal.annotationKey) {
      return { success: false, error: "Missing annotation key." };
    }
    return deleteAnnotation(attachment, proposal.annotationKey);
  }
  return { success: false, error: "Unknown proposal op." };
}

export function resolveAttachmentFor(
  proposal: AnnotationProposal,
  cache: Map<number, Zotero.Item | null>,
): Zotero.Item | null {
  if (cache.has(proposal.attachmentID)) {
    return cache.get(proposal.attachmentID) || null;
  }
  const attachment =
    (Zotero.Items.get(proposal.attachmentID) as Zotero.Item | false) || null;
  cache.set(proposal.attachmentID, attachment);
  return attachment;
}
