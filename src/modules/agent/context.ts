import {
  normalizeMultiline,
  truncateAtSentence,
  stripHTML,
} from "../../utils/text";
import type { AgentMessage } from "./types";
import {
  DEFAULT_PROMPT_TEMPLATE_ID,
  getPdfToolsNativeHintBlock,
  getPdfToolsRulesBlock,
  getPromptTemplateByID,
} from "./promptTemplates";

const MAX_NOTE_ITEMS = 3;
const MAX_ANNOTATION_ITEMS = 8;
const MAX_SELECTED_TEXT_CHARS = 4_000;
const MAX_NOTE_CHARS = 2_000;
const MAX_ANNOTATION_TEXT_CHARS = 600;
const DEFAULT_SYSTEM_CONTEXT_CHARS = 16_000;
const MAX_SYSTEM_CONTEXT_CHARS = 1_000_000;
const SYSTEM_CONTEXT_CHARS_PER_TOKEN = 4;
const SYSTEM_CONTEXT_MODEL_RATIO = 0.75;
const SELECTED_TEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const SYSTEM_CONTEXT_TOKEN_BUDGET = Math.ceil(
  DEFAULT_SYSTEM_CONTEXT_CHARS / SYSTEM_CONTEXT_CHARS_PER_TOKEN,
);
const CJK_PATTERN =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;

interface SelectedTextCacheEntry {
  text: string;
  expiresAt: number;
}

const selectedTextCacheByItemKey = new Map<string, SelectedTextCacheEntry>();

function purgeExpiredSelectedTextCache(): void {
  const now = Date.now();
  for (const [key, entry] of selectedTextCacheByItemKey) {
    if (entry.expiresAt <= now) {
      selectedTextCacheByItemKey.delete(key);
    }
  }
}

interface ContextLabels {
  zoteroContext: string;
  itemMetadata: string;
  title: string;
  itemType: string;
  authors: string;
  year: string;
  publication: string;
  abstract: string;
  notes: string;
  annotations: string;
  text: string;
  comment: string;
  selectedText: string;
  customContext: string;
}

export interface AgentContextOptions {
  includeMetadata: boolean;
  includeNotes: boolean;
  includeAnnotations: boolean;
  includeSelectedText: boolean;
}

interface BuildRequestOptions {
  item: Zotero.Item | null;
  contextOptions: AgentContextOptions;
  templateID: string;
  customContext?: string;
  externalContext?: string;
  modelContextWindow?: number | null;
  includePdfToolsRules?: boolean;
  useNativeToolCalls?: boolean;
}

export interface AgentContextPreview {
  text: string;
  fullText: string;
  contextText: string;
  customContextText: string;
  externalContextText: string;
  estimatedTokens: number;
  sentEstimatedTokens: number;
  tokenBudget: number;
  truncated: boolean;
  hasZoteroContext: boolean;
}

export function getDefaultContextOptions(): AgentContextOptions {
  return {
    includeMetadata: true,
    includeNotes: false,
    includeAnnotations: false,
    includeSelectedText: false,
  };
}

export function buildRequestMessagesWithContext(
  messages: AgentMessage[],
  options: BuildRequestOptions,
): AgentMessage[] {
  const preview = buildContextPreview(options);
  if (!preview.text) {
    return messages;
  }
  return [
    {
      role: "system",
      content: preview.text,
    },
    ...messages,
  ];
}

export function buildContextPreview(
  options: BuildRequestOptions,
): AgentContextPreview {
  const template = getPromptTemplateByID(options.templateID);
  const contextText = buildItemContext(options.item, options.contextOptions);
  const customContextText = buildCustomContextBlock(
    options.customContext || "",
  );
  const externalContextText = buildExternalContextBlock(
    options.externalContext || "",
  );
  const systemChunks = [template.systemPrompt];
  if (options.includePdfToolsRules) {
    systemChunks.push(
      options.useNativeToolCalls
        ? getPdfToolsNativeHintBlock()
        : getPdfToolsRulesBlock(),
    );
  }
  if (contextText) {
    systemChunks.push(contextText);
  }
  if (customContextText) {
    systemChunks.push(customContextText);
  }
  if (externalContextText) {
    systemChunks.push(externalContextText);
  }
  const fullText = systemChunks.join("\n\n").trim();
  const budget = resolveSystemContextBudget(options.modelContextWindow);
  const text = fullText.slice(0, budget.charLimit);
  return {
    text,
    fullText,
    contextText,
    customContextText,
    externalContextText,
    estimatedTokens: estimateTextTokens(fullText),
    sentEstimatedTokens: estimateTextTokens(text),
    tokenBudget: budget.tokenBudget,
    truncated: fullText.length > text.length,
    hasZoteroContext: Boolean(contextText),
  };
}

export function normalizeTemplateID(templateID: string) {
  return getPromptTemplateByID(templateID || DEFAULT_PROMPT_TEMPLATE_ID).id;
}

export function rememberReaderSelectedText(
  text: string,
  item: Zotero.Item | null,
) {
  const normalizedText = normalizeMultiline(text);
  if (!normalizedText) {
    return;
  }
  purgeExpiredSelectedTextCache();
  const keys = collectRelatedItemKeys(item);
  if (!keys.length) {
    return;
  }
  const entry: SelectedTextCacheEntry = {
    text: truncateAtSentence(normalizedText, MAX_SELECTED_TEXT_CHARS),
    expiresAt: Date.now() + SELECTED_TEXT_CACHE_TTL_MS,
  };
  for (const key of keys) {
    selectedTextCacheByItemKey.set(key, entry);
  }
}

function buildItemContext(
  item: Zotero.Item | null,
  options: AgentContextOptions,
) {
  if (!item) {
    return "";
  }
  const labels = getContextLabels();
  const primaryItem = resolvePrimaryItem(item);
  const blocks: string[] = [];
  if (options.includeMetadata) {
    const metadataBlock = buildMetadataBlock(primaryItem, labels);
    if (metadataBlock) {
      blocks.push(metadataBlock);
    }
  }
  if (options.includeNotes) {
    const notesBlock = buildNotesBlock(primaryItem, labels);
    if (notesBlock) {
      blocks.push(notesBlock);
    }
  }
  if (options.includeAnnotations) {
    const annotationsBlock = buildAnnotationsBlock(primaryItem, labels);
    if (annotationsBlock) {
      blocks.push(annotationsBlock);
    }
  }
  if (options.includeSelectedText) {
    const selectedTextBlock = buildSelectedTextBlock(item, labels);
    if (selectedTextBlock) {
      blocks.push(selectedTextBlock);
    }
  }
  if (!blocks.length) {
    return "";
  }
  return [`${labels.zoteroContext}:`, ...blocks].join("\n\n");
}

function resolvePrimaryItem(item: Zotero.Item) {
  let current: Zotero.Item = item;
  let guard = 0;
  while (current.parentItem && guard < 6) {
    current = current.parentItem;
    guard += 1;
  }
  return current;
}

function buildMetadataBlock(item: Zotero.Item, labels: ContextLabels) {
  const rows: string[] = [];
  const title = item.getDisplayTitle() || item.getField("title");
  if (title) {
    rows.push(`- ${labels.title}: ${title}`);
  }
  const itemType = getItemTypeName(item);
  if (itemType) {
    rows.push(`- ${labels.itemType}: ${itemType}`);
  }
  const creators = formatCreators(item.getCreators());
  if (creators) {
    rows.push(`- ${labels.authors}: ${creators}`);
  }
  const year = extractYear(item.getField("date"));
  if (year) {
    rows.push(`- ${labels.year}: ${year}`);
  }
  const doi = item.getField("DOI");
  if (doi) {
    rows.push(`- doi: ${doi}`);
  }
  const publication = item.getField("publicationTitle");
  if (publication) {
    rows.push(`- ${labels.publication}: ${publication}`);
  }
  const abstractNote = normalizeMultiline(
    stripHTML(item.getField("abstractNote")),
  );
  if (abstractNote) {
    rows.push(`- ${labels.abstract}: ${abstractNote}`);
  }
  if (!rows.length) {
    return "";
  }
  return [`${labels.itemMetadata}:`, ...rows].join("\n");
}

function buildNotesBlock(item: Zotero.Item, labels: ContextLabels) {
  const noteIDs = item.getNotes(false).slice(0, MAX_NOTE_ITEMS);
  if (!noteIDs.length) {
    return "";
  }
  const notes = Zotero.Items.get(noteIDs).filter((note) => note?.isNote());
  const lines: string[] = [];
  for (const [index, note] of notes.entries()) {
    const noteText = normalizeMultiline(stripHTML(note.getNote()));
    if (!noteText) {
      continue;
    }
    lines.push(`${index + 1}. ${truncateAtSentence(noteText, MAX_NOTE_CHARS)}`);
  }
  if (!lines.length) {
    return "";
  }
  return [`${labels.notes}:`, ...lines].join("\n");
}

function buildAnnotationsBlock(item: Zotero.Item, labels: ContextLabels) {
  const attachments = gatherAttachmentItems(item);
  if (!attachments.length) {
    return "";
  }
  const lines: string[] = [];
  for (const attachment of attachments) {
    const annotations = attachment.getAnnotations(false);
    for (const annotation of annotations) {
      const text = normalizeMultiline(annotation.annotationText || "");
      const comment = normalizeMultiline(annotation.annotationComment || "");
      const textPart = text
        ? truncateAtSentence(text, MAX_ANNOTATION_TEXT_CHARS)
        : "";
      const commentPart = comment
        ? truncateAtSentence(comment, MAX_ANNOTATION_TEXT_CHARS)
        : "";
      if (!textPart && !commentPart) {
        continue;
      }
      const page = annotation.annotationPageLabel || "?";
      const segments = [
        `p.${page}`,
        annotation.annotationType,
        textPart ? `${labels.text}: ${textPart}` : "",
        commentPart ? `${labels.comment}: ${commentPart}` : "",
      ].filter(Boolean);
      lines.push(`- ${segments.join(" | ")}`);
      if (lines.length >= MAX_ANNOTATION_ITEMS) {
        break;
      }
    }
    if (lines.length >= MAX_ANNOTATION_ITEMS) {
      break;
    }
  }
  if (!lines.length) {
    return "";
  }
  return [`${labels.annotations}:`, ...lines].join("\n");
}

function buildSelectedTextBlock(item: Zotero.Item, labels: ContextLabels) {
  const candidates: string[] = [];
  const activeReaderSelection = readSelectedTextFromActiveReader(item);
  if (activeReaderSelection) {
    candidates.push(activeReaderSelection);
  }
  const cachedSelection = readCachedSelectedText(item);
  if (cachedSelection) {
    candidates.push(cachedSelection);
  }
  if (item.isAnnotation()) {
    if (item.annotationText) {
      candidates.push(item.annotationText);
    }
    if (item.annotationComment) {
      candidates.push(item.annotationComment);
    }
  }
  const merged = normalizeMultiline(candidates.join("\n"));
  if (!merged) {
    return "";
  }
  return `${labels.selectedText}:\n${truncateAtSentence(merged, MAX_SELECTED_TEXT_CHARS)}`;
}

function buildCustomContextBlock(customContext: string) {
  const normalized = normalizeMultiline(customContext);
  if (!normalized) {
    return "";
  }
  return `${getContextLabels().customContext}:\n${normalized}`;
}

function buildExternalContextBlock(externalContext: string) {
  return externalContext.trim();
}

function getContextLabels(): ContextLabels {
  if (isChineseLocale()) {
    return {
      zoteroContext: "Zotero 上下文",
      itemMetadata: "条目元数据",
      title: "标题",
      itemType: "条目类型",
      authors: "作者",
      year: "年份",
      publication: "出版物",
      abstract: "摘要",
      notes: "笔记",
      annotations: "批注",
      text: "文本",
      comment: "评论",
      selectedText: "选中文本",
      customContext: "用户自定义上下文",
    };
  }
  return {
    zoteroContext: "Zotero Context",
    itemMetadata: "Item Metadata",
    title: "title",
    itemType: "itemType",
    authors: "authors",
    year: "year",
    publication: "publication",
    abstract: "abstract",
    notes: "Notes",
    annotations: "Annotations",
    text: "text",
    comment: "comment",
    selectedText: "Selected Text",
    customContext: "User Custom Context",
  };
}

function getItemTypeName(item: Zotero.Item) {
  if (!item.itemTypeID) {
    return "";
  }
  try {
    return Zotero.ItemTypes.getName(item.itemTypeID) || "";
  } catch {
    return "";
  }
}

function isChineseLocale() {
  return (Zotero.locale || "").startsWith("zh");
}

function gatherAttachmentItems(item: Zotero.Item) {
  const output: Zotero.Item[] = [];
  if (item.isPDFAttachment()) {
    output.push(item);
  }
  const attachmentIDs = item.getAttachments(false);
  if (attachmentIDs.length) {
    const children = Zotero.Items.get(attachmentIDs);
    for (const child of children) {
      if (child?.isPDFAttachment()) {
        output.push(child);
      }
    }
  }
  return output;
}

function readCachedSelectedText(item: Zotero.Item) {
  cleanupExpiredSelectionCache();
  const keys = collectRelatedItemKeys(item);
  for (const key of keys) {
    const entry = selectedTextCacheByItemKey.get(key);
    if (entry?.text) {
      return entry.text;
    }
  }
  return "";
}

function collectRelatedItemKeys(item: Zotero.Item | null) {
  if (!item) {
    return [];
  }
  const keys: string[] = [];
  let current: Zotero.Item | undefined = item;
  let guard = 0;
  while (current && guard < 6) {
    if (current.key && !keys.includes(current.key)) {
      keys.push(current.key);
    }
    current = current.parentItem;
    guard += 1;
  }
  return keys;
}

function cleanupExpiredSelectionCache() {
  const now = Date.now();
  for (const [key, entry] of selectedTextCacheByItemKey.entries()) {
    if (entry.expiresAt <= now) {
      selectedTextCacheByItemKey.delete(key);
    }
  }
}

function readSelectedTextFromActiveReader(item: Zotero.Item) {
  const readerManager = Zotero.Reader as unknown as {
    _readers?: Array<{
      _item?: Zotero.Item;
      _internalReader?: {
        _primaryView?: {
          getSelectedAnnotations?: () => Array<{
            text?: string;
            comment?: string;
          }>;
        };
      };
    }>;
  };
  const readers = readerManager._readers;
  if (!Array.isArray(readers) || !readers.length) {
    return "";
  }
  const validKeys = new Set(collectRelatedItemKeys(item));
  for (const reader of readers) {
    const readerItem = reader?._item;
    if (!readerItem) {
      continue;
    }
    const readerKeys = collectRelatedItemKeys(readerItem);
    const isSameContext = readerKeys.some((key) => validKeys.has(key));
    if (!isSameContext) {
      continue;
    }
    const selected =
      reader?._internalReader?._primaryView?.getSelectedAnnotations?.();
    if (!Array.isArray(selected) || !selected.length) {
      continue;
    }
    const selectedText = normalizeMultiline(
      selected
        .map((entry) => [entry.text || "", entry.comment || ""].join("\n"))
        .join("\n"),
    );
    if (selectedText) {
      return truncateAtSentence(selectedText, MAX_SELECTED_TEXT_CHARS);
    }
  }
  return "";
}

function formatCreators(creators: _ZoteroTypes.Item.Creator[]) {
  const names = creators
    .slice(0, 6)
    .map((creator) => {
      if (creator.fieldMode === 1) {
        return creator.lastName?.trim();
      }
      return [creator.firstName?.trim(), creator.lastName?.trim()]
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean);
  return names.join(", ");
}

function extractYear(dateField: string) {
  const match = dateField.match(/\b(\d{4})\b/);
  return match?.[1] || "";
}

function estimateTextTokens(text: string) {
  const normalized = normalizeMultiline(text);
  if (!normalized) {
    return 0;
  }
  const cjkMatches = normalized.match(CJK_PATTERN);
  const cjkCount = cjkMatches?.length || 0;
  const nonCjkText = normalized.replace(CJK_PATTERN, " ");
  const pieces = nonCjkText.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || [];
  const nonCjkTokenCount = pieces.reduce((count, piece) => {
    if (/^[A-Za-z0-9_]+$/.test(piece)) {
      return count + Math.max(1, Math.ceil(piece.length / 4));
    }
    return count + 1;
  }, 0);
  return Math.max(1, cjkCount + nonCjkTokenCount);
}

function resolveSystemContextBudget(modelContextWindow: number | null = null) {
  const defaultBudget = {
    charLimit: DEFAULT_SYSTEM_CONTEXT_CHARS,
    tokenBudget: SYSTEM_CONTEXT_TOKEN_BUDGET,
  };
  if (
    typeof modelContextWindow !== "number" ||
    !Number.isFinite(modelContextWindow) ||
    modelContextWindow <= 0
  ) {
    return defaultBudget;
  }
  const modelTokenBudget = Math.floor(
    modelContextWindow * SYSTEM_CONTEXT_MODEL_RATIO,
  );
  const tokenBudget = Math.max(SYSTEM_CONTEXT_TOKEN_BUDGET, modelTokenBudget);
  const charLimit = Math.min(
    MAX_SYSTEM_CONTEXT_CHARS,
    tokenBudget * SYSTEM_CONTEXT_CHARS_PER_TOKEN,
  );
  return {
    charLimit,
    tokenBudget: Math.ceil(charLimit / SYSTEM_CONTEXT_CHARS_PER_TOKEN),
  };
}

// Exported for unit tests and UI budget hints. This is intentionally a rough
// estimator; provider-specific tokenizers would add avoidable dependency weight.
export const contextTestUtils = {
  estimateTextTokens,
  maxSystemContextChars: DEFAULT_SYSTEM_CONTEXT_CHARS,
  maxDynamicSystemContextChars: MAX_SYSTEM_CONTEXT_CHARS,
  resolveSystemContextBudget,
  systemContextTokenBudget: SYSTEM_CONTEXT_TOKEN_BUDGET,
};
