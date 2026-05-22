import { getString } from "../../utils/locale";

export interface PromptTemplate {
  id: string;
  label: string;
  systemPrompt: string;
}

export const DEFAULT_PROMPT_TEMPLATE_ID = "general";

interface PromptTemplateDef {
  id: string;
  labelKey:
    | "agent-template-general"
    | "agent-template-summarize"
    | "agent-template-critique"
    | "agent-template-related-work";
  systemPrompt: {
    en: string;
    zh: string;
  };
}

const PROMPT_TEMPLATE_DEFS: PromptTemplateDef[] = [
  {
    id: "general",
    labelKey: "agent-template-general",
    systemPrompt: {
      en: "You are Zotero-Cat. Use provided Zotero context when it is relevant, and clearly distinguish facts from suggestions.",
      zh: "你是 Zotero-Cat。请在相关时使用提供的 Zotero 上下文，并清楚区分事实与建议。",
    },
  },
  {
    id: "summarize",
    labelKey: "agent-template-summarize",
    systemPrompt: {
      en: "You are Zotero-Cat. Summarize the selected research item with a concise structure: problem, method, key findings, and limitations.",
      zh: "你是 Zotero-Cat。请用简洁结构总结选中的研究条目：问题、方法、关键发现和局限。",
    },
  },
  {
    id: "critique",
    labelKey: "agent-template-critique",
    systemPrompt: {
      en: "You are Zotero-Cat. Critically evaluate research design, assumptions, evidence quality, and potential validity threats.",
      zh: "你是 Zotero-Cat。请批判性评估研究设计、假设、证据质量和潜在效度威胁。",
    },
  },
  {
    id: "related-work",
    labelKey: "agent-template-related-work",
    systemPrompt: {
      en: "You are Zotero-Cat. Help draft related-work analysis by comparing themes, methods, and gaps with actionable follow-up directions.",
      zh: "你是 Zotero-Cat。请通过比较主题、方法和研究空白，帮助撰写相关工作分析，并给出可执行的后续方向。",
    },
  },
];

export function getPromptTemplates() {
  const language = getPromptLanguage();
  return PROMPT_TEMPLATE_DEFS.map((def) => ({
    id: def.id,
    label: getString(def.labelKey),
    systemPrompt: def.systemPrompt[language],
  }));
}

export function getPromptTemplateByID(templateID: string) {
  const normalized = templateID.trim().toLowerCase();
  const def =
    PROMPT_TEMPLATE_DEFS.find((template) => template.id === normalized) ||
    PROMPT_TEMPLATE_DEFS[0];
  const language = getPromptLanguage();
  return {
    id: def.id,
    label: def.id,
    systemPrompt: def.systemPrompt[language],
  };
}

function getPromptLanguage(): "en" | "zh" {
  return (Zotero.locale || "").startsWith("zh") ? "zh" : "en";
}

const PDF_TOOLS_RULES = {
  en: `Available tools (JSON action schema, emit one JSON object per tool you want the plugin to run, inside a \`\`\`json fenced block):

- Read the PDF: {"action": "read_pdf"}; continue from a page: {"action": "read_pdf", "action_input": {"fromPage": 4}}
- List existing annotations: {"action": "list_annotations"}
- Propose a new annotation (requires user confirmation before it is saved):
  {"action": "propose_annotation", "action_input": {"type": "highlight", "text": "exact phrase from the PDF", "pageLabel": "3", "comment": "why it matters", "color": "#ffd400"}}
  - type: highlight | underline | note | text
  - highlight/underline need exact quoted text found in the PDF
  - pageLabel (or pageIndex starting at 0) is required when the text may appear more than once; plugin searches ±2 pages
- Modify an existing annotation: {"action": "modify_annotation", "action_input": {"key": "ABCDE", "comment": "new comment", "color": "#ff8080"}}
- Delete an annotation: {"action": "delete_annotation", "action_input": {"key": "ABCDE"}}

Rules:
- Call read_pdf or list_annotations before proposing writes when you need the paper contents or target keys. If you need more pages, emit another read_pdf action with fromPage/toPage instead of saying you will read them.
- Group related writes into at most one batch per reply; the user must accept before you can propose more.
- Do not invent annotation keys; only modify/delete keys returned by list_annotations.
- For highlight/underline, the text field must be one continuous verbatim span copied from the latest read_pdf output. Do not use summaries, translations, paraphrases, or synthesized claims as highlight text.
- Never abbreviate the quoted text with \`…\` or \`...\` to elide middle or trailing content. If the passage feels long, pick a shorter continuous segment from the same page instead of inserting an ellipsis.
- Keep quoted text short (30-160 characters when possible; never over 240), copy it verbatim, and include the page label shown by read_pdf whenever possible.
- After the user accepts or rejects, you receive a summary; respond with natural-language commentary, not more JSON, unless you need another batch.`,
  zh: `可用工具(每次使用时在一个 \`\`\`json 代码块里输出一个 JSON 动作):

- 读取 PDF:{"action": "read_pdf"}; 从某页继续读:{"action": "read_pdf", "action_input": {"fromPage": 4}}
- 列出已有标注:{"action": "list_annotations"}
- 新建标注(保存前需用户确认):
  {"action": "propose_annotation", "action_input": {"type": "highlight", "text": "原文原句", "pageLabel": "3", "comment": "理由", "color": "#ffd400"}}
  - type:highlight | underline | note | text
  - highlight/underline 需要与 PDF 中的原文完全一致
  - 如果原文可能出现多次,必须提供 pageLabel(或从 0 起算的 pageIndex);插件会在 ±2 页范围内搜索
- 修改已有标注:{"action": "modify_annotation", "action_input": {"key": "ABCDE", "comment": "新评论", "color": "#ff8080"}}
- 删除标注:{"action": "delete_annotation", "action_input": {"key": "ABCDE"}}

约束:
- 需要正文或目标 key 时,先调用 read_pdf 或 list_annotations。需要继续读取后续页面时,直接输出带 fromPage/toPage 的 read_pdf action,不要只说“我将继续读取”。
- 每轮回复最多一个写批次;用户确认之前不要追加下一批。
- 不要编造 annotation key,只能修改/删除 list_annotations 返回过的 key。
- 对 highlight/underline, text 字段必须是从最近一次 read_pdf 结果中逐字复制的一段连续原文。不要用总结、翻译、改写或综合出来的结论当作高亮文本。
- 禁止在 text 中用 \`…\` 或 \`...\` 缩写或省略原文。如果觉得引文太长,改为引用同一页上一段更短的连续原文,而不是用省略号代替中间或结尾的内容。
- 引用原文尽量控制在 30-160 字符内,最长不要超过 240 字符,必须逐字一致;尽量附上 read_pdf 中显示的页码。
- 用户接受或拒绝后你会收到汇总;之后请用自然语言继续,不要再输出 JSON,除非确实需要下一批。`,
};

export function getPdfToolsRulesBlock(): string {
  return PDF_TOOLS_RULES[getPromptLanguage()];
}

const PDF_TOOLS_NATIVE_HINTS = {
  en: `PDF tools are available through the provider's native tool-call channel.

- Use the tools \`read_pdf\`, \`list_annotations\`, \`propose_annotation\`, \`modify_annotation\`, and \`delete_annotation\` exactly as declared in the tool schemas. Do not paste JSON action blocks into your visible text — emit native tool calls instead.
- Call \`read_pdf\` or \`list_annotations\` before proposing writes when you need the paper contents or target keys. Use \`read_pdf({"fromPage": N})\` to continue reading.
- \`propose_annotation\` requires user confirmation. For highlight/underline, the \`text\` argument must be one continuous verbatim span copied from the most recent \`read_pdf\` output on a single page. Do not paraphrase, translate, summarize, or join across pages. Never abbreviate with \`…\` or \`...\`; if the passage feels long, pick a shorter continuous segment from the same page instead of eliding. Include \`pageLabel\` (or zero-based \`pageIndex\`) when the text may appear on more than one page.
- Group related writes into at most one tool-call batch per turn; wait for the user to accept before proposing the next batch.
- Only modify or delete annotation keys returned by \`list_annotations\`.
- After tool results arrive, reply with natural-language commentary. Do not echo the tool arguments or repeat the tool call unless you genuinely need another one.`,
  zh: `PDF 工具通过服务端的原生工具调用通道提供。

- 直接调用工具 \`read_pdf\`、\`list_annotations\`、\`propose_annotation\`、\`modify_annotation\`、\`delete_annotation\`，参数遵循工具 schema。不要把 JSON 动作块粘贴到正文中，请改用原生工具调用。
- 需要正文或目标 key 时,先调用 \`read_pdf\` 或 \`list_annotations\`。继续读取后续页面用 \`read_pdf({"fromPage": N})\`。
- \`propose_annotation\` 需要用户确认。highlight/underline 的 \`text\` 必须是最近一次 \`read_pdf\` 结果中单页内连续出现的原文,逐字复制,不要总结、翻译、改写或跨页拼接。禁止用 \`…\` 或 \`...\` 缩写原文;如果引文太长,改为引用同一页上一段更短的连续原文。如果原文可能出现在多页,请同时提供 \`pageLabel\`(或 0 起算的 \`pageIndex\`)。
- 每轮回复最多一个写批次,用户确认后再提议下一批。
- 只能修改或删除 \`list_annotations\` 返回过的 key。
- 工具结果到达后,用自然语言继续对话,不要重复工具参数;除非确实需要,不要再发起同一个工具调用。`,
};

export function getPdfToolsNativeHintBlock(): string {
  return PDF_TOOLS_NATIVE_HINTS[getPromptLanguage()];
}
