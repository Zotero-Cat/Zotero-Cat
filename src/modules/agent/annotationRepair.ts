import type {
  AnnotationBatch,
  AnnotationProposal,
} from "./annotationProposals";
import { summarizeBatch } from "./annotationProposals";
import { truncate } from "../../utils/text";

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
