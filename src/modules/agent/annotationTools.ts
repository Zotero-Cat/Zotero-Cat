import { getPref } from "../../utils/prefs";
import {
  isRecord,
  normalizeMultiline,
  truncate,
  truncateAtSentence,
} from "../../utils/text";
import {
  registerToolActionHandler,
  type ToolAction,
  type ToolActionHandler,
} from "./toolAction";
import type { AnnotationProposalInput } from "./annotationProposals";
import type { ToolJSONSchema } from "./toolProtocol";
import {
  extractPages,
  findTextRects,
  renderPagesAsText,
  type ExtractedPage,
} from "../tools/pdfReader";

const MAX_READ_PDF_CHARS = 8_000;
const MAX_LIST_ANNOTATION_ENTRIES = 80;

interface ReadPdfPageRequest {
  explicitRange: boolean;
  fromIndex?: number;
  toIndex?: number;
  pageLabel?: string;
}

async function readAttachmentText(
  attachment: Zotero.Item,
  request: ReadPdfPageRequest,
): Promise<string> {
  try {
    const pages = await extractPages(attachment);
    const text = renderSelectedReadPdfPages(pages, request);
    if (text) {
      return text;
    }
  } catch (error) {
    try {
      (Zotero as unknown as { logError?: (e: unknown) => void }).logError?.(
        error,
      );
    } catch {
      // ignore logging failures
    }
    if (request.explicitRange) {
      throw error;
    }
    const fallback = await readZoteroIndexedText(attachment);
    if (fallback) {
      return fallback;
    }
    throw error;
  }
  const fallback = await readZoteroIndexedText(attachment);
  return fallback;
}

function renderSelectedReadPdfPages(
  pages: ExtractedPage[],
  request: ReadPdfPageRequest,
): string {
  const selectedPages = selectReadPdfPages(pages, request);
  if (request.explicitRange && !selectedPages.length) {
    throw new Error("No PDF pages matched the requested page range.");
  }
  const hasExtractableText = selectedPages.some((page) => page.text.trim());
  if (!hasExtractableText) {
    if (request.explicitRange) {
      throw new Error(
        "The requested PDF page range produced no extractable text.",
      );
    }
    return "";
  }
  const text = renderPagesAsText(selectedPages).trim();
  if (text) {
    return text;
  }
  if (request.explicitRange) {
    throw new Error(
      "The requested PDF page range produced no extractable text.",
    );
  }
  return "";
}

async function readZoteroIndexedText(attachment: Zotero.Item): Promise<string> {
  try {
    const indexed = (attachment as unknown as { attachmentText?: string })
      .attachmentText;
    if (typeof indexed === "string" && indexed.trim()) {
      return indexed.trim();
    }
  } catch {
    // fall through
  }
  try {
    const fulltext = (
      Zotero as unknown as {
        Fulltext?: {
          getItemContent?: (id: number) => Promise<string> | string;
          indexItems?: (ids: number[]) => Promise<void>;
        };
      }
    ).Fulltext;
    if (fulltext?.indexItems) {
      try {
        await fulltext.indexItems([attachment.id]);
      } catch {
        // ignore - attempt to read whatever is indexed
      }
    }
    if (fulltext?.getItemContent) {
      const content = await Promise.resolve(
        fulltext.getItemContent(attachment.id),
      );
      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }
    }
  } catch {
    // fall through
  }
  return "";
}

export type ResolvedProposalInput = AnnotationProposalInput;

export interface ResolveWriteContext {
  item: Zotero.Item | null;
  locale: "en" | "zh";
}

export function isPdfToolsEnabledPref(): boolean {
  return getPref("pdfToolsEnabled") === true;
}

export function isPdfToolsAutoApplyPref(): boolean {
  return getPref("pdfToolsAutoApply") === true;
}

export function registerAnnotationReadTools(): void {
  const readPdfHandler: ToolActionHandler = {
    type: "read-pdf",
    readOnly: true,
    description:
      "Read text from the current Zotero PDF attachment, optionally scoped to pages.",
    aliases: [
      "read_pdf",
      "read pdf",
      "read-pdf",
      "查看pdf",
      "读取pdf",
      "read-paper",
      "read_paper",
    ],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Read intent or topic." },
        topic: { type: "string", description: "Alias for query." },
        page: { type: "integer", description: "1-based page number." },
        fromPage: {
          type: "integer",
          description: "1-based start page for a page range.",
        },
        toPage: {
          type: "integer",
          description: "1-based end page for a page range.",
        },
        pageIndex: {
          type: "integer",
          description: "0-based page index.",
        },
        pageLabel: {
          type: "string",
          description: "PDF page label, such as 7 or iv.",
        },
      },
      additionalProperties: true,
    },
    extractQuery(actionInput, rawRecord) {
      const query =
        asStringField(actionInput.query) ||
        asStringField(actionInput.topic) ||
        asStringField(rawRecord.query);
      return query.trim() || "__full__";
    },
    isAvailable() {
      return isPdfToolsEnabledPref();
    },
    async execute(query, options) {
      const item = extractItemFromOptions(options);
      if (!item) {
        return formatToolError("No active Zotero item for read_pdf.");
      }
      const attachment = findPrimaryPdfAttachment(item);
      if (!attachment) {
        return formatToolError("No PDF attachment found for the current item.");
      }
      try {
        const text = await readAttachmentText(
          attachment,
          resolveReadPdfPageRequest(query, options.rawInput || {}),
        );
        if (!text) {
          return formatToolError(
            "The PDF produced no extractable text. Try opening it in Zotero first so its full text is indexed.",
          );
        }
        return formatReadPdfResult(attachment, text);
      } catch (error) {
        return formatToolError(formatErrorMessage(error));
      }
    },
  };
  registerToolActionHandler(readPdfHandler);

  const listAnnotationsHandler: ToolActionHandler = {
    type: "list-annotations",
    readOnly: true,
    description: "List existing Zotero annotations on PDF attachments.",
    aliases: [
      "list_annotations",
      "list annotations",
      "list-annotations",
      "get_annotations",
      "查看标注",
      "列出标注",
    ],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    extractQuery(_actionInput) {
      return "__all__";
    },
    isAvailable() {
      return isPdfToolsEnabledPref();
    },
    async execute(_query, options) {
      const item = extractItemFromOptions(options);
      if (!item) {
        return formatToolError("No active Zotero item for list_annotations.");
      }
      const attachments = collectPdfAttachments(item);
      if (!attachments.length) {
        return formatToolError(
          "No PDF attachments found for the current item.",
        );
      }
      const entries: string[] = [];
      for (const attachment of attachments) {
        const annotations = attachment.getAnnotations?.(false) || [];
        for (const annotation of annotations) {
          if (entries.length >= MAX_LIST_ANNOTATION_ENTRIES) {
            break;
          }
          entries.push(summarizeExistingAnnotation(annotation, attachment));
        }
        if (entries.length >= MAX_LIST_ANNOTATION_ENTRIES) {
          break;
        }
      }
      if (!entries.length) {
        return "No annotations on this item yet.";
      }
      return entries.join("\n");
    },
  };
  registerToolActionHandler(listAnnotationsHandler);
}

export function isAnnotationWriteAction(action: ToolAction): boolean {
  if (action.readOnly) {
    return false;
  }
  return (
    action.type === "propose-annotation" ||
    action.type === "modify-annotation" ||
    action.type === "delete-annotation"
  );
}

export function registerAnnotationWriteStubs(): void {
  // Write actions bypass executeToolAction but still need handler entries so
  // parseAssistantToolActions recognizes their names and returns them with
  // readOnly = false. The execute bodies are never invoked; section.ts
  // intercepts these actions and routes them through resolveWriteAction.
  for (const type of [
    "propose-annotation",
    "modify-annotation",
    "delete-annotation",
  ] as const) {
    registerToolActionHandler({
      type,
      readOnly: false,
      description: buildWriteDescription(type),
      aliases: buildWriteAliases(type),
      inputSchema: buildWriteInputSchema(type),
      extractQuery(actionInput) {
        const candidate =
          asStringField(actionInput.text) ||
          asStringField(actionInput.key) ||
          asStringField(actionInput.query) ||
          type;
        return candidate.trim() || type;
      },
      isAvailable() {
        return isPdfToolsEnabledPref();
      },
      async execute() {
        return "";
      },
    });
  }
}

function buildWriteAliases(type: string): string[] {
  if (type === "propose-annotation") {
    return [
      "propose_annotation",
      "propose annotation",
      "propose-annotation",
      "add_annotation",
      "add annotation",
      "add-annotation",
      "create_annotation",
      "highlight",
      "add_highlight",
      "add_note",
      "创建标注",
      "添加标注",
      "添加高亮",
      "添加批注",
    ];
  }
  if (type === "modify-annotation") {
    return [
      "modify_annotation",
      "modify annotation",
      "modify-annotation",
      "update_annotation",
      "edit_annotation",
      "修改标注",
      "编辑标注",
    ];
  }
  return [
    "delete_annotation",
    "delete annotation",
    "delete-annotation",
    "remove_annotation",
    "删除标注",
  ];
}

function buildWriteDescription(type: string): string {
  if (type === "propose-annotation") {
    return "Propose a new PDF annotation. Zotero-Cat resolves text to PDF coordinates before asking the user to approve.";
  }
  if (type === "modify-annotation") {
    return "Propose updates to an existing Zotero PDF annotation.";
  }
  return "Propose deleting an existing Zotero PDF annotation.";
}

function buildWriteInputSchema(type: string): ToolJSONSchema {
  const common: Record<string, ToolJSONSchema> = {
    type: {
      type: "string",
      enum: ["highlight", "underline", "note", "text"],
      description: "Annotation type.",
    },
    text: {
      type: "string",
      description: "Exact PDF text for highlight/underline.",
    },
    comment: {
      type: "string",
      description: "Annotation comment.",
    },
    color: {
      type: "string",
      description: "Hex color such as #ffd400.",
    },
    page: {
      type: "integer",
      description: "1-based page number.",
    },
    pageIndex: {
      type: "integer",
      description: "0-based page index.",
    },
    pageLabel: {
      type: "string",
      description: "PDF page label.",
    },
    attachmentKey: {
      type: "string",
      description: "Target PDF attachment key.",
    },
    attachmentID: {
      type: "integer",
      description: "Target PDF attachment ID.",
    },
  };
  if (type !== "propose-annotation") {
    common.key = {
      type: "string",
      description: "Existing Zotero annotation key.",
    };
  }
  return {
    type: "object",
    properties: common,
    additionalProperties: true,
  };
}

export async function resolveWriteAction(
  action: ToolAction,
  context: ResolveWriteContext,
): Promise<ResolvedProposalInput[]> {
  if (!context.item) {
    return [];
  }
  const attachments = collectPdfAttachments(context.item);
  if (!attachments.length) {
    return [];
  }
  const input = action.rawInput;
  if (action.type === "propose-annotation") {
    const attachment = selectTargetPdfAttachment(attachments, input);
    if (!attachment) {
      return [
        failedProposal(
          "create",
          attachments[0],
          buildFallbackResolvedAnnotation(input),
          "Multiple PDF attachments found. Include attachmentKey or attachmentID in the action input.",
        ),
      ];
    }
    return resolveProposeAnnotation(attachment, input);
  }
  if (action.type === "modify-annotation") {
    const attachment = resolveAttachmentForAnnotationKey(attachments, input);
    if (!attachment) {
      return [
        failedProposal(
          "update",
          attachments[0],
          buildFallbackResolvedAnnotation(input),
          "Target annotation does not belong to the current PDF attachment.",
        ),
      ];
    }
    return resolveModifyAnnotation(attachment, input);
  }
  if (action.type === "delete-annotation") {
    const attachment = resolveAttachmentForAnnotationKey(attachments, input);
    if (!attachment) {
      return [
        failedProposal(
          "delete",
          attachments[0],
          buildFallbackResolvedAnnotation(input),
          "Target annotation does not belong to the current PDF attachment.",
        ),
      ];
    }
    return resolveDeleteAnnotation(attachment, input);
  }
  return [];
}

function selectTargetPdfAttachment(
  attachments: Zotero.Item[],
  input: Record<string, unknown>,
): Zotero.Item | null {
  const attachmentKey =
    asStringField(input.attachmentKey).trim() ||
    asStringField(input.pdfKey).trim();
  if (attachmentKey) {
    return (
      attachments.find((attachment) => attachment.key === attachmentKey) || null
    );
  }
  const attachmentID =
    readIntegerLike(input.attachmentID) ?? readIntegerLike(input.pdfID);
  if (attachmentID !== null) {
    return (
      attachments.find((attachment) => attachment.id === attachmentID) || null
    );
  }
  return attachments.length === 1 ? attachments[0] : null;
}

function resolveAttachmentForAnnotationKey(
  attachments: Zotero.Item[],
  input: Record<string, unknown>,
): Zotero.Item | null {
  const explicit = selectTargetPdfAttachment(attachments, input);
  if (explicit) {
    return explicit;
  }
  const key = asStringField(input.key).trim();
  if (!key) {
    return attachments.length === 1 ? attachments[0] : null;
  }
  for (const attachment of attachments) {
    const existing = Zotero.Items.getByLibraryAndKey(
      attachment.libraryID,
      key,
    ) as Zotero.Item | false;
    if (
      existing &&
      existing.isAnnotation?.() &&
      isAnnotationOnAttachment(existing, attachment)
    ) {
      return attachment;
    }
  }
  return null;
}

function buildFallbackResolvedAnnotation(input: Record<string, unknown>): {
  type: AnnotationResolvedJSONType;
  pageIndex: number;
  pageLabel: string;
  rects: number[][];
  text?: string;
  comment?: string;
  color?: string;
  key?: string;
} {
  const pageLabelHint = asStringField(input.pageLabel).trim();
  const pageIndex = resolvePageHint(input, pageLabelHint) ?? 0;
  return {
    type: normalizeAnnotationType(asStringField(input.type)) || "highlight",
    pageIndex,
    pageLabel: pageLabelHint || String(pageIndex + 1),
    rects: [],
    text: asStringField(input.text).trim(),
    comment: asStringField(input.comment).trim(),
    color: asStringField(input.color).trim(),
    key: asStringField(input.key).trim() || undefined,
  };
}

async function resolveProposeAnnotation(
  attachment: Zotero.Item,
  input: Record<string, unknown>,
): Promise<ResolvedProposalInput[]> {
  const type =
    normalizeAnnotationType(asStringField(input.type)) || "highlight";
  const text = asStringField(input.text).trim();
  const comment = asStringField(input.comment).trim();
  const color = asStringField(input.color).trim();
  const pageLabelHint = asStringField(input.pageLabel).trim();
  const pageHint = resolvePageHint(input, pageLabelHint);
  const hasExplicitPageHint = pageHint !== null || Boolean(pageLabelHint);
  const needsRects = type === "highlight" || type === "underline";
  if (needsRects) {
    if (!text) {
      return [
        failedProposal(
          "create",
          attachment,
          {
            type,
            pageIndex: pageHint ?? 0,
            pageLabel: pageLabelHint || String((pageHint ?? 0) + 1),
            rects: [],
            text,
            comment,
            color,
          },
          "Missing `text` field for highlight/underline.",
        ),
      ];
    }
    try {
      const pages = await extractPages(attachment);
      const resolvedPageHint = resolvePageHintFromExtractedPages(
        pages,
        pageHint,
        pageLabelHint,
      );
      if (hasExplicitPageHint && resolvedPageHint === null) {
        return [
          failedProposal(
            "create",
            attachment,
            {
              type,
              pageIndex: pageHint ?? 0,
              pageLabel: pageLabelHint || String((pageHint ?? 0) + 1),
              rects: [],
              text,
              comment,
              color,
            },
            "Requested page was not found in the PDF.",
          ),
        ];
      }
      const match = findTextRects(pages, resolvedPageHint, text, {
        strictPage: hasExplicitPageHint,
      });
      if (!match) {
        return [
          failedProposal(
            "create",
            attachment,
            {
              type,
              pageIndex: pageHint ?? 0,
              pageLabel: pageLabelHint || String((pageHint ?? 0) + 1),
              rects: [],
              text,
              comment,
              color,
            },
            pageHint === null && !pageLabelHint
              ? `Could not locate the quoted text unambiguously in the PDF. Include pageLabel or pageIndex in the action input. Quoted text was: "${truncate(text, 140)}".`
              : `Could not locate the quoted text in the PDF. For highlight/underline, use one continuous verbatim span from the requested page. If the intended quote crosses a page boundary, split it into separate page-local proposals. Quoted text was: "${truncate(text, 140)}".`,
          ),
        ];
      }
      const matchedPage = pages.find((p) => p.pageIndex === match.pageIndex);
      return [
        {
          op: "create",
          attachmentKey: attachment.key,
          attachmentID: attachment.id,
          resolved: {
            type,
            pageIndex: match.pageIndex,
            pageLabel: match.pageLabel,
            rects: match.rects,
            pageWidth: matchedPage?.pageWidth,
            pageHeight: matchedPage?.pageHeight,
            text: match.matchedText,
            comment,
            color,
          },
          sourceSnippet: truncate(text, 160),
        },
      ];
    } catch (error) {
      return [
        failedProposal(
          "create",
          attachment,
          {
            type,
            pageIndex: pageHint ?? 0,
            pageLabel: pageLabelHint || String((pageHint ?? 0) + 1),
            rects: [],
            text,
            comment,
            color,
          },
          formatErrorMessage(error),
        ),
      ];
    }
  }
  const pageIndex = pageHint ?? 0;
  return [
    {
      op: "create",
      attachmentKey: attachment.key,
      attachmentID: attachment.id,
      resolved: {
        type,
        pageIndex,
        pageLabel: pageLabelHint || String(pageIndex + 1),
        rects: [],
        text,
        comment,
        color,
      },
      sourceSnippet: truncate(comment || text || "note", 160),
    },
  ];
}

async function resolveModifyAnnotation(
  attachment: Zotero.Item,
  input: Record<string, unknown>,
): Promise<ResolvedProposalInput[]> {
  const key = asStringField(input.key).trim();
  if (!key) {
    return [];
  }
  const existing = Zotero.Items.getByLibraryAndKey(
    attachment.libraryID,
    key,
  ) as Zotero.Item | false;
  if (!existing || !existing.isAnnotation?.()) {
    return [
      failedProposal(
        "update",
        attachment,
        {
          type: "note",
          pageIndex: 0,
          pageLabel: "?",
          rects: [],
          key,
        },
        "Target annotation does not exist.",
      ),
    ];
  }
  if (!isAnnotationOnAttachment(existing, attachment)) {
    return [
      failedProposal(
        "update",
        attachment,
        {
          type: "note",
          pageIndex: 0,
          pageLabel: "?",
          rects: [],
          key,
        },
        "Target annotation does not belong to the selected PDF attachment.",
      ),
    ];
  }
  const pageIndex = parseAnnotationPageIndex(existing.annotationPosition);
  return [
    {
      op: "update",
      attachmentKey: attachment.key,
      attachmentID: attachment.id,
      annotationKey: key,
      resolved: {
        type: (existing.annotationType as AnnotationResolvedJSONType) || "note",
        pageIndex,
        pageLabel:
          asStringField(input.pageLabel).trim() ||
          existing.annotationPageLabel ||
          String(pageIndex + 1),
        rects: mergeRectsFromExisting(existing),
        text: asStringField(input.text).trim() || existing.annotationText || "",
        comment:
          asStringField(input.comment).trim() ||
          existing.annotationComment ||
          "",
        color:
          asStringField(input.color).trim() || existing.annotationColor || "",
        key,
      },
      sourceSnippet: truncate(
        asStringField(input.comment).trim() ||
          asStringField(input.text).trim() ||
          existing.annotationText ||
          key,
        160,
      ),
    },
  ];
}

async function resolveDeleteAnnotation(
  attachment: Zotero.Item,
  input: Record<string, unknown>,
): Promise<ResolvedProposalInput[]> {
  const key = asStringField(input.key).trim();
  if (!key) {
    return [];
  }
  const existing = Zotero.Items.getByLibraryAndKey(
    attachment.libraryID,
    key,
  ) as Zotero.Item | false;
  if (!existing || !existing.isAnnotation?.()) {
    return [
      failedProposal(
        "delete",
        attachment,
        {
          type: "note",
          pageIndex: 0,
          pageLabel: "?",
          rects: [],
          key,
        },
        "Target annotation does not exist.",
      ),
    ];
  }
  if (!isAnnotationOnAttachment(existing, attachment)) {
    return [
      failedProposal(
        "delete",
        attachment,
        {
          type: "note",
          pageIndex: 0,
          pageLabel: "?",
          rects: [],
          key,
        },
        "Target annotation does not belong to the selected PDF attachment.",
      ),
    ];
  }
  const pageIndex = parseAnnotationPageIndex(existing.annotationPosition);
  return [
    {
      op: "delete",
      attachmentKey: attachment.key,
      attachmentID: attachment.id,
      annotationKey: key,
      resolved: {
        type: (existing.annotationType as AnnotationResolvedJSONType) || "note",
        pageIndex,
        pageLabel: existing.annotationPageLabel || String(pageIndex + 1),
        rects: [],
        key,
      },
      sourceSnippet: truncate(
        existing.annotationText || existing.annotationComment || key,
        160,
      ),
    },
  ];
}

type AnnotationResolvedJSONType = "highlight" | "underline" | "note" | "text";

function normalizeAnnotationType(
  raw: string,
): AnnotationResolvedJSONType | null {
  const value = raw.trim().toLowerCase();
  if (
    value === "highlight" ||
    value === "underline" ||
    value === "note" ||
    value === "text"
  ) {
    return value;
  }
  return null;
}

function failedProposal(
  op: "create" | "update" | "delete",
  attachment: Zotero.Item,
  resolved: {
    type: AnnotationResolvedJSONType;
    pageIndex: number;
    pageLabel: string;
    rects: number[][];
    text?: string;
    comment?: string;
    color?: string;
    key?: string;
  },
  errorMessage: string,
): ResolvedProposalInput {
  return {
    op,
    attachmentKey: attachment.key,
    attachmentID: attachment.id,
    annotationKey: resolved.key,
    resolved,
    status: "failed",
    sourceSnippet: truncate(
      resolved.text || resolved.comment || errorMessage,
      160,
    ),
    errorMessage,
  };
}

function resolvePageHint(
  input: Record<string, unknown>,
  pageLabelHint: string,
): number | null {
  const pageIndex = readIntegerLike(input.pageIndex);
  if (pageIndex !== null) {
    return Math.max(0, pageIndex);
  }
  const pageNumber =
    readIntegerLike(input.page) ?? readIntegerLike(input.pageNumber);
  if (pageNumber !== null) {
    return Math.max(0, pageNumber - 1);
  }
  const numericLabel = readIntegerLike(pageLabelHint);
  if (numericLabel !== null && numericLabel > 0) {
    return Math.max(0, numericLabel - 1);
  }
  return null;
}

function resolveReadPdfPageRequest(
  query: string,
  input: Record<string, unknown>,
): ReadPdfPageRequest {
  const pageLabel = asStringField(input.pageLabel).trim();
  const exactPage =
    readIntegerLike(input.pageIndex) !== null
      ? readIntegerLike(input.pageIndex)! + 1
      : (readIntegerLike(input.page) ?? readIntegerLike(input.pageNumber));
  const fromPage =
    readIntegerLike(input.fromPage) ??
    readIntegerLike(input.startPage) ??
    readIntegerLike(input.pageFrom) ??
    readIntegerLike(input.start);
  const toPage =
    readIntegerLike(input.toPage) ??
    readIntegerLike(input.endPage) ??
    readIntegerLike(input.pageTo) ??
    readIntegerLike(input.end);

  if (exactPage !== null && exactPage > 0) {
    return {
      explicitRange: true,
      fromIndex: exactPage - 1,
      toIndex: exactPage - 1,
    };
  }
  if (fromPage !== null || toPage !== null) {
    return {
      explicitRange: true,
      fromIndex: fromPage !== null && fromPage > 0 ? fromPage - 1 : undefined,
      toIndex: toPage !== null && toPage > 0 ? toPage - 1 : undefined,
    };
  }
  if (pageLabel) {
    return { explicitRange: true, pageLabel };
  }
  return parseReadPdfRangeFromQuery(query);
}

function parseReadPdfRangeFromQuery(query: string): ReadPdfPageRequest {
  const normalized = query.trim();
  if (!normalized || normalized === "__full__") {
    return { explicitRange: false };
  }
  const rangeMatch = normalized.match(
    /(?:p(?:age)?\.?\s*)?(\d+)\s*(?:-|–|—|到|至|through|to)\s*(?:p(?:age)?\.?\s*)?(\d+)/i,
  );
  if (rangeMatch) {
    const from = Number.parseInt(rangeMatch[1], 10);
    const to = Number.parseInt(rangeMatch[2], 10);
    if (from > 0 && to > 0) {
      return {
        explicitRange: true,
        fromIndex: Math.min(from, to) - 1,
        toIndex: Math.max(from, to) - 1,
      };
    }
  }
  const onwardMatch = normalized.match(
    /(?:第\s*)?(\d+)\s*(?:页|p\.?|page)?\s*(?:及以后|以后|之后|后|起|开始|onwards?|and later|to end)/i,
  );
  if (onwardMatch) {
    const from = Number.parseInt(onwardMatch[1], 10);
    if (from > 0) {
      return { explicitRange: true, fromIndex: from - 1 };
    }
  }
  const fromMatch = normalized.match(
    /(?:from|start(?:ing)? at|从|自)\s*(?:第\s*)?(?:p(?:age)?\.?\s*)?(\d+)/i,
  );
  if (fromMatch) {
    const from = Number.parseInt(fromMatch[1], 10);
    if (from > 0) {
      return { explicitRange: true, fromIndex: from - 1 };
    }
  }
  const singlePageMatch = normalized.match(
    /(?:第\s*)?(\d+)\s*(?:页|page|p\.)/i,
  );
  if (singlePageMatch) {
    const page = Number.parseInt(singlePageMatch[1], 10);
    if (page > 0) {
      return {
        explicitRange: true,
        fromIndex: page - 1,
        toIndex: page - 1,
      };
    }
  }
  return { explicitRange: false };
}

function selectReadPdfPages(
  pages: ExtractedPage[],
  request: ReadPdfPageRequest,
): ExtractedPage[] {
  if (!request.explicitRange) {
    return pages;
  }
  if (request.pageLabel) {
    const normalizedLabel = request.pageLabel.trim().toLowerCase();
    return pages.filter(
      (page) => page.pageLabel.trim().toLowerCase() === normalizedLabel,
    );
  }
  const fromIndex = Math.max(0, request.fromIndex ?? 0);
  const toIndex = Math.min(
    pages.length - 1,
    request.toIndex ?? pages.length - 1,
  );
  if (fromIndex > toIndex) {
    return [];
  }
  return pages.filter(
    (page) => page.pageIndex >= fromIndex && page.pageIndex <= toIndex,
  );
}

function resolvePageHintFromExtractedPages(
  pages: ExtractedPage[],
  pageHint: number | null,
  pageLabelHint: string,
): number | null {
  if (pageHint !== null && pageHint >= 0 && pageHint < pages.length) {
    return pageHint;
  }
  const normalizedLabel = pageLabelHint.trim().toLowerCase();
  if (normalizedLabel) {
    const exact = pages.find(
      (page) => page.pageLabel.trim().toLowerCase() === normalizedLabel,
    );
    if (exact) {
      return exact.pageIndex;
    }
    const numericLabel = readIntegerLike(normalizedLabel);
    if (numericLabel !== null && numericLabel > 0) {
      const fromNumber = numericLabel - 1;
      if (fromNumber >= 0 && fromNumber < pages.length) {
        return fromNumber;
      }
    }
  }
  return null;
}

function readIntegerLike(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const direct = Number.parseInt(trimmed, 10);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const embedded = trimmed.match(/\d+/);
  if (!embedded) {
    return null;
  }
  const parsed = Number.parseInt(embedded[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAnnotationPageIndex(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  try {
    const parsed = JSON.parse(value);
    if (
      isRecord(parsed) &&
      typeof parsed.pageIndex === "number" &&
      Number.isFinite(parsed.pageIndex)
    ) {
      return Math.max(0, Math.floor(parsed.pageIndex));
    }
  } catch {
    // ignore
  }
  return 0;
}

function mergeRectsFromExisting(item: Zotero.Item): number[][] {
  try {
    const parsed = JSON.parse(item.annotationPosition || "{}");
    if (Array.isArray(parsed?.rects)) {
      return parsed.rects as number[][];
    }
  } catch {
    // ignore
  }
  return [];
}

function collectPdfAttachments(item: Zotero.Item): Zotero.Item[] {
  const output: Zotero.Item[] = [];
  if (item.isPDFAttachment?.()) {
    output.push(item);
  }
  const attachmentIDs = item.getAttachments?.(false) || [];
  if (attachmentIDs.length) {
    const children = Zotero.Items.get(attachmentIDs);
    for (const child of children) {
      if (child?.isPDFAttachment?.()) {
        output.push(child);
      }
    }
  }
  return output;
}

function isAnnotationOnAttachment(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
): boolean {
  if (annotation.libraryID !== attachment.libraryID) {
    return false;
  }
  const annotationParentID = (
    annotation as unknown as { parentID?: number | false }
  ).parentID;
  if (annotationParentID === attachment.id) {
    return true;
  }
  const annotationParentKey = (
    annotation as unknown as { parentKey?: string | false }
  ).parentKey;
  if (annotationParentKey && annotationParentKey === attachment.key) {
    return true;
  }
  try {
    return (attachment.getAnnotations?.(false) || []).some(
      (candidate) => candidate.key === annotation.key,
    );
  } catch {
    return false;
  }
}

function findPrimaryPdfAttachment(item: Zotero.Item): Zotero.Item | null {
  const attachments = collectPdfAttachments(item);
  return attachments[0] || null;
}

function summarizeExistingAnnotation(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
): string {
  const pageLabel = annotation.annotationPageLabel || "?";
  const type = annotation.annotationType || "note";
  const text = normalizeMultiline(annotation.annotationText || "");
  const comment = normalizeMultiline(annotation.annotationComment || "");
  const snippetText = text ? truncate(text, 140) : "";
  const snippetComment = comment ? truncate(comment, 140) : "";
  const parts = [
    `key=${annotation.key}`,
    `attachmentKey=${attachment.key}`,
    `attachmentID=${attachment.id}`,
    `page=${pageLabel}`,
    `type=${type}`,
  ];
  if (snippetText) {
    parts.push(`text="${snippetText}"`);
  }
  if (snippetComment) {
    parts.push(`comment="${snippetComment}"`);
  }
  return `- ${parts.join(" | ")}`;
}

function formatReadPdfResult(attachment: Zotero.Item, text: string): string {
  const output = `PDF attachmentKey=${attachment.key} attachmentID=${attachment.id}\n${text}`;
  if (output.length <= MAX_READ_PDF_CHARS) {
    return output;
  }
  return [
    truncateAtSentence(output, MAX_READ_PDF_CHARS),
    "[read_pdf result truncated. For exact annotation text, call read_pdf with page/fromPage/toPage for the target page before proposing highlights. Highlight/underline text must be a continuous verbatim span on one page; split cross-page highlights into separate page-local proposals.]",
  ].join("\n\n");
}

function formatToolError(message: string): string {
  return `ERROR: ${message}`;
}

function formatErrorMessage(error: unknown): string {
  // XPCOM exceptions thrown by Zotero APIs are not `Error` instances and their
  // fields are non-enumerable getters; `JSON.stringify` collapses them to "{}".
  // Read the known fields explicitly so the model sees the real reason.
  if (typeof error === "string") {
    return error || "Unknown error";
  }
  if (error == null) {
    return "Unknown error";
  }
  if (error instanceof Error) {
    return error.message || error.name || String(error) || "Unknown error";
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts: string[] = [];
    const message = readField(record, "message");
    if (message) parts.push(message);
    const name = readField(record, "name");
    if (name && name !== message) parts.push(`(${name})`);
    const result = readField(record, "result");
    if (result) parts.push(`[result=${result}]`);
    if (parts.length) {
      return parts.join(" ");
    }
    const coerced = String(error);
    if (coerced && coerced !== "[object Object]") {
      return coerced;
    }
  }
  const coerced = String(error);
  return coerced && coerced !== "[object Object]" ? coerced : "Unknown error";
}

function readField(record: Record<string, unknown>, field: string): string {
  try {
    const value = record[field];
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "bigint") {
      return String(value);
    }
    return "";
  } catch {
    return "";
  }
}

function asStringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const annotationToolsTestUtils = {
  formatReadPdfResult,
  parseReadPdfRangeFromQuery,
  renderSelectedReadPdfPages,
  resolveReadPdfPageRequest,
  selectReadPdfPages,
};

function extractItemFromOptions(options: {
  item?: Zotero.Item | null;
}): Zotero.Item | null {
  return options.item || null;
}
