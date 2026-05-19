import { asString, isRecord, truncate } from "../../utils/text";
import {
  formatToolValidationIssues,
  toMCPToolSpec,
  toOpenAIToolSpec,
  validateToolInput,
  type ToolDefinition,
  type ToolJSONSchema,
  type ToolValidationIssue,
} from "./toolProtocol";

export interface ToolAction {
  type: string;
  query: string;
  rawInput: Record<string, unknown>;
  readOnly: boolean;
  validationIssues?: ToolValidationIssue[];
}

export interface ToolActionHandler extends ToolDefinition {
  type: string;
  aliases: string[];
  readOnly: boolean;
  description?: string;
  inputSchema?: ToolJSONSchema;
  extractQuery(
    actionInput: Record<string, unknown>,
    rawRecord: Record<string, unknown>,
  ): string;
  isAvailable(): boolean;
  execute(
    query: string,
    options: {
      requestToken: number;
      onStatus?: (status: unknown) => void;
      rawInput?: Record<string, unknown>;
      item?: Zotero.Item | null;
    },
  ): Promise<string>;
}

const MAX_TOOL_QUERY_CHARS = 240;
const MAX_ACTIONS_PER_TURN = 10;
const handlers = new Map<string, ToolActionHandler>();

export function registerToolActionHandler(handler: ToolActionHandler) {
  handlers.set(handler.type, {
    ...handler,
    aliases: normalizeToolAliases(handler),
  });
}

export function getRegisteredToolTypes(): string[] {
  return [...handlers.keys()];
}

export function getToolDefinitions(): ToolDefinition[] {
  return [...handlers.values()].map((handler) => ({
    type: handler.type,
    aliases: handler.aliases,
    readOnly: handler.readOnly,
    ...(handler.description ? { description: handler.description } : {}),
    ...(handler.inputSchema ? { inputSchema: handler.inputSchema } : {}),
    ...(handler.outputSchema ? { outputSchema: handler.outputSchema } : {}),
  }));
}

export function getOpenAIToolSpecs() {
  return getToolDefinitions().map(toOpenAIToolSpec);
}

export function getMCPToolSpecs() {
  return getToolDefinitions().map(toMCPToolSpec);
}

export function getToolActionHandler(type: string): ToolActionHandler | null {
  return handlers.get(type) || null;
}

export function parseAssistantToolActions(content: string): ToolAction[] {
  const records = collectToolActionRecords(content);
  const seen = new Set<string>();
  const actions: ToolAction[] = [];
  for (const record of records) {
    const action = toToolAction(record);
    if (!action) {
      continue;
    }
    const fingerprint = buildToolActionFingerprint(action);
    if (seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);
    actions.push(action);
    if (actions.length >= MAX_ACTIONS_PER_TURN) {
      return actions;
    }
  }
  return actions;
}

function buildToolActionFingerprint(action: ToolAction): string {
  return `${action.type}::${action.query}::${stableStringify(action.rawInput)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function parseFirstAssistantToolAction(
  content: string,
): ToolAction | null {
  return parseAssistantToolActions(content)[0] || null;
}

export function hasExecutableAssistantToolAction(content: string): boolean {
  if (!looksLikeExecutableToolMarkup(content)) {
    return false;
  }
  return parseAssistantToolActions(content).length > 0;
}

/**
 * @deprecated Use `parseFirstAssistantToolAction` or
 * `parseAssistantToolActions` instead. Kept for compatibility with the
 * existing single-tool follow-up path.
 */
export function parseAssistantToolAction(content: string): ToolAction | null {
  return parseFirstAssistantToolAction(content);
}

export async function executeToolAction(
  action: ToolAction,
  options: {
    requestToken: number;
    onStatus?: (status: unknown) => void;
    item?: Zotero.Item | null;
  },
): Promise<string> {
  const handler = handlers.get(action.type);
  if (!handler) {
    return `ERROR: Unrecognized tool action: ${action.type}`;
  }
  if (!handler.isAvailable()) {
    return `ERROR: Tool is not enabled or unavailable: ${action.type}`;
  }
  if (action.validationIssues?.length) {
    return `ERROR: Invalid tool input for ${action.type}: ${formatToolValidationIssues(action.validationIssues)}`;
  }
  return handler.execute(action.query, {
    requestToken: options.requestToken,
    onStatus: options.onStatus,
    rawInput: action.rawInput,
    item: options.item || null,
  });
}

export function stripAssistantToolActionMarkup(content: string): string {
  return stripTaggedToolCallBlocks(
    stripBareJSONToolActionMarkup(stripJSONToolActionBlocks(content)),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitAssistantToolActionMessage(content: string): {
  visibleContent: string;
  toolActionContent: string;
} {
  if (!hasExecutableAssistantToolAction(content)) {
    return {
      visibleContent: content,
      toolActionContent: "",
    };
  }
  return {
    visibleContent: stripAssistantToolActionMarkup(content),
    toolActionContent: content,
  };
}

export function looksLikeAssistantToolIntent(content: string): boolean {
  const text = stripAssistantToolActionMarkup(content)
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > 600) {
    return false;
  }
  return (
    looksLikePdfReadIntent(text) ||
    looksLikeAnnotationListIntent(text) ||
    looksLikeAnnotationWriteIntent(text) ||
    /(?:我(?:将|会|来|要|需要|继续)|现在|开始|准备|帮你).{0,40}(?:读取|阅读|阅读全文|调用|执行|搜索|联网搜索|标注|高亮|划重点)/i.test(
      text,
    ) ||
    /(?:read|continue reading|search|look up|call|run|use|annotate|highlight).{0,40}(?:pdf|tool|web|search|annotation|highlight)/i.test(
      text,
    )
  );
}

export function inferAssistantReadOnlyToolAction(
  content: string,
): ToolAction | null {
  const text = stripAssistantToolActionMarkup(content)
    .replace(/\s+/g, " ")
    .trim();
  if (!looksLikeAssistantToolIntent(text)) {
    return null;
  }
  if (looksLikeAnnotationListIntent(text)) {
    return toToolAction({
      action: "list_annotations",
      action_input: {},
    });
  }
  if (looksLikePdfReadIntent(text)) {
    return toToolAction({
      action: "read_pdf",
      action_input: { query: text },
    });
  }
  return null;
}

function toToolAction(record: Record<string, unknown>): ToolAction | null {
  const action = normalizeActionName(asString(record.action));
  if (!action) {
    return null;
  }
  const handler = findHandlerByAlias(action);
  if (!handler) {
    return null;
  }
  const rawInput = resolveActionInput(record);
  const validation = validateToolInput(rawInput, handler.inputSchema);
  const actionInput = validation.input;
  const query = handler.extractQuery(actionInput, record);
  return {
    type: handler.type,
    query: truncate(query || handler.type, MAX_TOOL_QUERY_CHARS),
    rawInput: actionInput,
    readOnly: handler.readOnly,
    ...(validation.issues.length || !query
      ? {
          validationIssues: validation.issues.concat(
            query
              ? []
              : [
                  {
                    path: "action_input",
                    message: "does not contain enough information to execute",
                  },
                ],
          ),
        }
      : {}),
  };
}

function findHandlerByAlias(alias: string): ToolActionHandler | null {
  for (const handler of handlers.values()) {
    if (handler.aliases.some((a) => a === alias)) {
      return handler;
    }
  }
  return null;
}

function normalizeToolAliases(handler: ToolActionHandler): string[] {
  return [
    ...new Set([handler.type, ...handler.aliases].map(normalizeActionName)),
  ];
}

function resolveActionInput(
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (isRecord(record.action_input)) {
    return record.action_input;
  }
  if (isRecord(record.input)) {
    return record.input;
  }
  return {};
}

function collectToolActionRecords(content: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const candidate of collectJSONCandidates(content)) {
    records.push(...parseJSONRecords(candidate));
  }
  records.push(...collectTaggedToolCallRecords(content));
  return records;
}

function collectJSONCandidates(content: string) {
  const candidates: string[] = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(content))) {
    if (match[1]?.trim()) {
      candidates.push(match[1].trim());
    }
  }
  const firstBrace = content.indexOf("{");
  const lastBracket = content.lastIndexOf("]");
  const lastBrace = content.lastIndexOf("}");
  const tail = Math.max(lastBrace, lastBracket);
  if (firstBrace >= 0 && tail > firstBrace) {
    candidates.push(content.slice(firstBrace, tail + 1));
  }
  const firstBracket = content.indexOf("[");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(content.slice(firstBracket, lastBracket + 1));
  }
  return candidates;
}

function looksLikeExecutableToolMarkup(content: string): boolean {
  return (
    /"action"\s*:/i.test(content) ||
    /<tool_call\b/i.test(content) ||
    /<function(?:\s*=|\b)/i.test(content)
  );
}

function collectTaggedToolCallRecords(
  content: string,
): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const toolCallPattern = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = toolCallPattern.exec(content))) {
    const record = parseTaggedToolCall(match[1] || "");
    if (record) {
      records.push(record);
    }
  }
  if (!records.length && looksLikeTaggedToolCall(content)) {
    const record = parseTaggedToolCall(content);
    if (record) {
      records.push(record);
    }
  }
  return records;
}

function parseJSONRecords(text: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) {
      return [parsed];
    }
    if (Array.isArray(parsed)) {
      return parsed.filter(isRecord) as Record<string, unknown>[];
    }
    return [];
  } catch {
    return [];
  }
}

function parseTaggedToolCall(text: string): Record<string, unknown> | null {
  const action = readTaggedToolName(text);
  if (!action) {
    return null;
  }
  return {
    action,
    action_input: readTaggedToolInput(text),
  };
}

function readTaggedToolName(text: string): string {
  const toolName = readFirstTagText(text, "tool_name");
  if (toolName) {
    return normalizeActionName(toolName);
  }
  const actionParameter = readNamedParameterText(text, "action");
  if (actionParameter) {
    return normalizeActionName(actionParameter);
  }
  const functionEquals = text.match(
    /<function\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/i,
  )?.[1];
  if (functionEquals) {
    return normalizeActionName(decodeMarkupText(functionEquals));
  }
  const functionName = text.match(
    /<function\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/i,
  )?.[1];
  return functionName
    ? normalizeActionName(decodeMarkupText(functionName))
    : "";
}

function readTaggedToolInput(text: string): Record<string, unknown> {
  for (const parameter of [
    "action_input",
    "arguments",
    "parameters",
    "args",
    "input",
  ]) {
    const body = readNamedParameterText(text, parameter);
    if (!body) {
      continue;
    }
    const parsed = parseFirstJSONObject(body);
    if (parsed) {
      return parsed;
    }
  }
  for (const tag of ["arguments", "parameters", "args", "input"]) {
    const body = readFirstTagText(text, tag);
    if (!body) {
      continue;
    }
    const parsed = parseFirstJSONObject(body);
    if (parsed) {
      return parsed;
    }
  }
  const parsed = parseFirstJSONObject(text);
  if (parsed) {
    return parsed;
  }
  return readSimpleTaggedFields(text);
}

function readSimpleTaggedFields(text: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of [
    "query",
    "q",
    "topic",
    "text",
    "type",
    "comment",
    "color",
    "key",
    "page",
    "pageNumber",
    "pageIndex",
    "pageLabel",
    "fromPage",
    "toPage",
    "from",
    "to",
  ]) {
    const value =
      readFirstTagText(text, key) || readNamedParameterText(text, key);
    if (value) {
      fields[key] = value;
    }
  }
  return fields;
}

function parseFirstJSONObject(text: string): Record<string, unknown> | null {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }
  const records = parseJSONRecords(text.slice(firstBrace, lastBrace + 1));
  return records.find(isRecord) || null;
}

function readFirstTagText(text: string, tagName: string): string {
  const escaped = escapeRegExp(tagName);
  const match = text.match(
    new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"),
  );
  return match?.[1] ? decodeMarkupText(match[1]).trim() : "";
}

function readNamedParameterText(text: string, parameterName: string): string {
  const expected = parameterName.trim().toLowerCase();
  const pattern = /<parameter\b([^>]*)>([\s\S]*?)<\/parameter>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const name = readTagAttribute(match[1] || "", "name")
      .trim()
      .toLowerCase();
    if (name !== expected) {
      continue;
    }
    return match[2] ? decodeMarkupText(match[2]).trim() : "";
  }
  return "";
}

function readTagAttribute(attributes: string, name: string): string {
  const escaped = escapeRegExp(name);
  const match = attributes.match(
    new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return decodeMarkupText(match?.[1] || match?.[2] || match?.[3] || "");
}

function stripJSONToolActionBlocks(content: string): string {
  return content.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (match, inner) => {
    const text = typeof inner === "string" ? inner.trim() : "";
    if (!text) {
      return match;
    }
    if (parseJSONRecords(text).some(looksLikeActionJSON)) {
      return "";
    }
    return match;
  });
}

function stripBareJSONToolActionMarkup(content: string): string {
  const firstBrace = content.indexOf("{");
  const firstBracket = content.indexOf("[");
  const first =
    firstBrace < 0
      ? firstBracket
      : firstBracket < 0
        ? firstBrace
        : Math.min(firstBrace, firstBracket);
  if (first < 0) {
    return content;
  }
  const lastBrace = content.lastIndexOf("}");
  const lastBracket = content.lastIndexOf("]");
  const last = Math.max(lastBrace, lastBracket);
  if (last <= first) {
    return content;
  }
  const candidate = content.slice(first, last + 1);
  if (!parseJSONRecords(candidate).some(looksLikeActionJSON)) {
    return content;
  }
  return `${content.slice(0, first)}${content.slice(last + 1)}`;
}

function stripTaggedToolCallBlocks(content: string): string {
  return content
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, "")
    .replace(
      /<function\s*=\s*["']?([^"'\s>]+)["']?[^>]*>[\s\S]*?<\/function>/gi,
      (match, name) => {
        const action = normalizeActionName(decodeMarkupText(String(name)));
        return findHandlerByAlias(action) ? "" : match;
      },
    )
    .replace(
      /<function\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/function>/gi,
      (match, name) => {
        const action = normalizeActionName(decodeMarkupText(String(name)));
        return findHandlerByAlias(action) ? "" : match;
      },
    );
}

function looksLikeActionJSON(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => looksLikeActionJSON(entry));
  }
  return "action" in (value as Record<string, unknown>);
}

function looksLikeTaggedToolCall(content: string): boolean {
  return /<tool_name\b/i.test(content) || /<function(?:\s*=|\b)/i.test(content);
}

function looksLikePdfReadIntent(text: string): boolean {
  return /(?:读取|阅读|阅读全文|读|read|continue reading).{0,60}(?:pdf|文章|全文|第\s*\d+\s*页|page|p\.)/i.test(
    text,
  );
}

function looksLikeAnnotationListIntent(text: string): boolean {
  return /(?:列出|查看|检查|读取|看一下|看下|先看|list|get).{0,40}(?:已有的?)?(?:标注|批注|annotations?)/i.test(
    text,
  );
}

function looksLikeAnnotationWriteIntent(text: string): boolean {
  return /(?:添加|新建|创建|继续为|进行|add|create|propose).{0,50}(?:标注|批注|高亮|划重点|annotations?|highlights?)/i.test(
    text,
  );
}

function decodeMarkupText(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeActionName(value: string) {
  return value.trim().toLowerCase();
}
