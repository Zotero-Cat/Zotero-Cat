import type {
  AnnotationBatch,
  BatchSummary,
} from "../tools/annotationProposals";

function isZhLocale(locale: string): boolean {
  return (locale || "en").startsWith("zh");
}

export function buildMissingToolActionRepairPrompt(
  locale: string = Zotero.locale,
): string {
  if (isZhLocale(locale)) {
    return [
      "你上一条回复表示要调用工具,但没有包含 Zotero-Cat 可执行的工具 action,所以插件无法继续。",
      "如果确实需要工具,请只输出一个 JSON 代码块,不要再解释计划。",
      '读取 PDF 全文: {"action":"read_pdf"}',
      '从第 4 页开始读取: {"action":"read_pdf","action_input":{"fromPage":4}}',
      '修正高亮: {"action":"propose_annotation","action_input":{"type":"highlight","pageLabel":"16","text":"该页内连续出现的 PDF 原文","comment":"批注内容","color":"#ffd400"}}',
      '联网搜索: {"action":"联网搜索","action_input":{"query":"检索词","maxResults":20}}',
      "高亮/下划线 text 必须是单页内连续出现的 PDF 原文；不要提交跨页 text，跨页内容请拆成每页一条。",
      "如果不需要工具,请直接给出最终回答。",
    ].join("\n");
  }
  return [
    "Your previous response said you would use a tool, but it did not include an executable Zotero-Cat tool action.",
    "If you need a tool, reply with only one JSON code block and no planning prose.",
    'Read the full PDF: {"action":"read_pdf"}',
    'Read from page 4 onward: {"action":"read_pdf","action_input":{"fromPage":4}}',
    'Repair a highlight: {"action":"propose_annotation","action_input":{"type":"highlight","pageLabel":"16","text":"continuous verbatim PDF text on that page","comment":"comment text","color":"#ffd400"}}',
    'Web search: {"action":"web_search","action_input":{"query":"search terms","maxResults":20}}',
    "Highlight/underline text must be a continuous verbatim PDF span from one page. Do not submit cross-page text; split cross-page highlights into one proposal per page.",
    "If no tool is needed, answer directly.",
  ].join("\n");
}

export function buildAnnotationFollowUpPrompt(
  batch: AnnotationBatch,
  summary: BatchSummary,
  locale: string = Zotero.locale,
): string {
  const bullets = batch.proposals
    .map((proposal) => {
      const op = proposal.op.toUpperCase();
      const status = proposal.status.toUpperCase();
      const page = proposal.resolved.pageLabel;
      const snippet = (proposal.sourceSnippet || "").slice(0, 80);
      const err = proposal.errorMessage
        ? ` [error: ${proposal.errorMessage}]`
        : "";
      return `- ${op} p.${page} [${status}] ${snippet}${err}`;
    })
    .join("\n");
  const hasFailed = summary.failed > 0;
  if (isZhLocale(locale)) {
    const nextInstruction = hasFailed
      ? "部分标注失败。若要修复失败项,请先确保已读取目标页原文,然后只输出一个 JSON 代码块给出修正后的 propose_annotation；高亮/下划线 text 必须是单页内连续出现的 PDF 原文。不要提交跨页 text,跨页内容请拆成每页一条。若无法修复,请直接说明失败原因。"
      : "请基于此继续对话(例如确认、追加下一批,或说明不再需要写操作)。";
    return [
      "已处理你提议的标注批次,结果如下。",
      `汇总:accepted=${summary.accepted} rejected=${summary.rejected} failed=${summary.failed} pending=${summary.pending}`,
      bullets,
      nextInstruction,
    ].join("\n\n");
  }
  const nextInstruction = hasFailed
    ? "Some annotations failed. To repair them, first make sure you have read the target page text, then output only one JSON code block with corrected propose_annotation action(s). Highlight/underline text must be a continuous verbatim span from one PDF page. Do not submit cross-page text; split cross-page highlights into one proposal per page. If repair is not possible, state the failure reason directly."
    : "Continue the conversation based on the results (e.g. confirm, propose more, or state you no longer need write actions).";
  return [
    "The annotation batch you proposed has been processed.",
    `Summary: accepted=${summary.accepted} rejected=${summary.rejected} failed=${summary.failed} pending=${summary.pending}`,
    bullets,
    nextInstruction,
  ].join("\n\n");
}

export function buildToolActionFollowUpPrompt(
  toolType: string,
  toolResult: string,
  allowToolChaining: boolean = false,
  locale: string = Zotero.locale,
): string {
  const isZh = isZhLocale(locale);
  if (toolType === "web-search") {
    if (isZh) {
      return [
        "你刚才请求了联网搜索。插件已经执行搜索，结果如下。",
        toolResult || "搜索没有返回可用结果。",
        "请基于这些结果回答用户原始问题。不要再次输出 action JSON；如果结果不足，请明确说明局限。",
      ].join("\n\n");
    }
    return [
      "You requested web search. The plugin has executed the search. Results follow.",
      toolResult || "The search returned no usable results.",
      "Answer the user's original question based on these results. Do not output action JSON again; state limitations if results are insufficient.",
    ].join("\n\n");
  }
  const toolFailed = toolResult.trim().startsWith("ERROR:");
  if (isZh) {
    const chainingLine = allowToolChaining
      ? "请基于这些结果回答用户原始问题。如果需要,可以继续输出工具 action JSON(例如 propose_annotation),每轮回复最多一个写批次。若要高亮/下划线, text 必须是工具结果中单页内连续出现的 PDF 原文；不要使用跨页 text,跨页内容请拆成每页一条。若目标页原文不在结果中,先调用 read_pdf 精确读取该页。"
      : "请基于这些结果回答用户原始问题。不要再次输出 action JSON。";
    const errorLine = toolFailed
      ? "\n\n注意:工具执行失败。请如实告知用户失败原因并建议检查(如 PDF 附件、插件设置等),不要根据摘要或元数据猜测 PDF 原文来新建标注——那样会导致 propose_annotation 找不到文本而全部失败。"
      : "";
    return [
      `你刚才请求了工具操作（${toolType}）。插件已经执行，结果如下。`,
      toolResult || "工具没有返回可用结果。",
      `${chainingLine}${errorLine}`,
    ].join("\n\n");
  }
  const chainingLine = allowToolChaining
    ? "Answer the user's original question based on these results. If needed, emit more tool action JSON (e.g. propose_annotation), at most one write batch per reply. For highlight/underline, text must be a continuous verbatim PDF span from one page in the tool result. Do not use cross-page text; split cross-page highlights into one proposal per page. If the target page text is not in the result, call read_pdf for that exact page first."
    : "Answer the user's original question based on these results. Do not output action JSON again.";
  const errorLine = toolFailed
    ? "\n\nNote: the tool failed. Tell the user plainly what went wrong and suggest checks (e.g. the PDF attachment, plugin settings). Do NOT invent highlight text from the abstract or metadata — propose_annotation will fail to locate it and all proposals will be marked failed."
    : "";
  return [
    `You requested a tool action (${toolType}). The plugin has executed it. Results follow.`,
    toolResult || "The tool returned no usable results.",
    `${chainingLine}${errorLine}`,
  ].join("\n\n");
}
