import type {
  AnnotationBatch,
  AnnotationProposal,
} from "./annotationProposals";
import { summarizeBatch } from "./annotationProposals";
import { truncate } from "../../utils/text";
import {
  extractPages,
  renderPagesAsText,
  type ExtractedPage,
} from "./pdfReader";

interface RepairOptions {
  alreadyRepaired: boolean;
  depth: number;
  maxDepth: number;
}

const MAX_REPAIR_TOOL_RESULT_CHARS = 9000;

export function shouldRepairFailedAnnotationBatch(
  batch: AnnotationBatch,
  options: RepairOptions,
): boolean {
  if (options.alreadyRepaired || options.depth >= options.maxDepth - 1) {
    return false;
  }
  const summary = summarizeBatch(batch);
  if (summary.pending > 0 || summary.failed === 0) {
    return false;
  }
  return batch.proposals.some(isRepairableFailedProposal);
}

function isRepairableFailedProposal(proposal: AnnotationProposal): boolean {
  if (proposal.status !== "failed" || proposal.op !== "create") {
    return false;
  }
  const type = proposal.resolved.type;
  if (type !== "highlight" && type !== "underline") {
    return false;
  }
  const error = (proposal.errorMessage || "").toLowerCase();
  return (
    error.includes("could not locate") ||
    error.includes("requested page") ||
    error.includes("missing `text`")
  );
}

export function buildFailedAnnotationRepairPrompt(
  batch: AnnotationBatch,
  readResults: string,
  locale: "en" | "zh",
): string {
  const failures = batch.proposals
    .filter((proposal) => proposal.status === "failed")
    .map(formatFailureLine)
    .join("\n");
  const sourceText = readResults.trim()
    ? truncate(readResults, MAX_REPAIR_TOOL_RESULT_CHARS)
    : "";
  if (locale === "zh") {
    return [
      "上一批标注提议没有被应用，因为 Zotero-Cat 无法在 PDF 中定位你给出的 quoted text。",
      "请修正后重新输出可执行工具 action。高亮/下划线的 text 必须是 PDF 工具结果中连续出现的原文片段；不要使用摘要、翻译、改写或自行概括的句子。",
      "不要提交跨页 text。若要标注的内容跨页，请拆成每页一条 propose_annotation，并为每条提供对应页面内连续出现的原文。",
      "如果下方没有 PDF 原文，先输出 read_pdf action 读取相关页面；如果有 PDF 原文，请只输出一个 JSON 代码块，重新给出 propose_annotation action，可包含多条。",
      "失败提议:",
      failures || "- unknown failure",
      sourceText ? `PDF 工具结果:\n${sourceText}` : "PDF 工具结果: unavailable",
    ].join("\n\n");
  }
  return [
    "The previous annotation proposals were not applied because Zotero-Cat could not locate the quoted text in the PDF.",
    "Repair the proposal by emitting executable tool action JSON again. For highlight/underline, text must be one continuous verbatim span from the PDF tool result; do not use summaries, translations, paraphrases, or synthesized claims.",
    "Do not submit cross-page text. If the intended highlight spans pages, split it into one propose_annotation per page, each with a continuous verbatim span from that page.",
    "If no PDF text is available below, emit a read_pdf action for the relevant pages first. If PDF text is available, output only one JSON code block with corrected propose_annotation action(s).",
    "Failed proposals:",
    failures || "- unknown failure",
    sourceText
      ? `PDF tool result:\n${sourceText}`
      : "PDF tool result: unavailable",
  ].join("\n\n");
}

function formatFailureLine(proposal: AnnotationProposal): string {
  const page = proposal.resolved.pageLabel || "?";
  const snippet = truncate(
    proposal.sourceSnippet || proposal.resolved.text || "",
    180,
  );
  const error = proposal.errorMessage || "unknown error";
  return `- ${proposal.op} ${proposal.resolved.type} p.${page}: ${error}${snippet ? ` | text=${snippet}` : ""}`;
}

// When a propose_annotation batch fails because we couldn't locate quoted
// text and the model never called read_pdf, the repair prompt would otherwise
// say "PDF tool result: unavailable" and the second attempt would be just as
// blind. Pre-fetch the target pages (plus ±1 to absorb off-by-one page hints)
// so the model can see what's actually on the page and re-quote verbatim.
const REPAIR_PAGE_NEIGHBORHOOD = 1;

export async function gatherFailedAnnotationPageText(
  batch: AnnotationBatch,
): Promise<string> {
  const targets = collectRepairTargets(batch);
  if (!targets.size) {
    return "";
  }
  const sections: string[] = [];
  for (const [attachmentID, pageIndices] of targets) {
    const attachment = resolveAttachmentByID(attachmentID);
    if (!attachment) {
      continue;
    }
    let pages: ExtractedPage[];
    try {
      pages = await extractPages(attachment);
    } catch {
      continue;
    }
    const wanted = expandPageNeighborhood(pageIndices, pages.length);
    const subset = pages.filter((page) => wanted.has(page.pageIndex));
    if (!subset.length) {
      continue;
    }
    sections.push(
      `[attachment ${attachment.key} pages ${describePageList(subset)}]\n${renderPagesAsText(subset)}`,
    );
  }
  return sections.join("\n\n");
}

function collectRepairTargets(
  batch: AnnotationBatch,
): Map<number, Set<number>> {
  const targets = new Map<number, Set<number>>();
  for (const proposal of batch.proposals) {
    if (proposal.status !== "failed" || proposal.op !== "create") {
      continue;
    }
    const type = proposal.resolved.type;
    if (type !== "highlight" && type !== "underline") {
      continue;
    }
    const error = (proposal.errorMessage || "").toLowerCase();
    if (
      !error.includes("could not locate") &&
      !error.includes("requested page")
    ) {
      continue;
    }
    let pageIndices = targets.get(proposal.attachmentID);
    if (!pageIndices) {
      pageIndices = new Set<number>();
      targets.set(proposal.attachmentID, pageIndices);
    }
    pageIndices.add(Math.max(0, proposal.resolved.pageIndex));
  }
  return targets;
}

function expandPageNeighborhood(
  pageIndices: Set<number>,
  pageCount: number,
): Set<number> {
  const expanded = new Set<number>();
  for (const idx of pageIndices) {
    for (
      let offset = -REPAIR_PAGE_NEIGHBORHOOD;
      offset <= REPAIR_PAGE_NEIGHBORHOOD;
      offset += 1
    ) {
      const candidate = idx + offset;
      if (candidate >= 0 && candidate < pageCount) {
        expanded.add(candidate);
      }
    }
  }
  return expanded;
}

function describePageList(pages: ExtractedPage[]): string {
  return pages
    .map((page) => page.pageLabel || String(page.pageIndex + 1))
    .join(", ");
}

function resolveAttachmentByID(attachmentID: number): Zotero.Item | null {
  try {
    const item = (
      Zotero as unknown as {
        Items: { get: (id: number) => Zotero.Item | false };
      }
    ).Items.get(attachmentID);
    return item || null;
  } catch {
    return null;
  }
}

export const annotationRepairTestUtils = {
  collectRepairTargets,
  expandPageNeighborhood,
};
