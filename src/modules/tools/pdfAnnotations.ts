import type { AnnotationResolvedJSON } from "../agent/annotationProposals";

export interface SaveAnnotationResult {
  success: boolean;
  annotationKey?: string;
  error?: string;
}

const DEFAULT_COLOR = "#ffd400";
const DEFAULT_NOTE_RECT = [50, 750, 60, 760] as const;
const MIN_RECT_EDGE = 0.5;
const MAX_RECT_HEIGHT_POINTS = 96;
const MAX_RECT_PAGE_HEIGHT_RATIO = 0.14;
const MAX_SINGLE_RECT_PAGE_AREA_RATIO = 0.2;
const MAX_TOTAL_RECT_PAGE_AREA_RATIO = 0.35;
const MAX_RECTS_PER_ANNOTATION = 80;

export async function createAnnotation(
  attachment: Zotero.Item,
  resolved: AnnotationResolvedJSON,
): Promise<SaveAnnotationResult> {
  try {
    if (!attachment || typeof attachment.isPDFAttachment !== "function") {
      return {
        success: false,
        error: "Missing PDF attachment reference.",
      };
    }
    if (!attachment.isPDFAttachment()) {
      return {
        success: false,
        error: "Target item is not a PDF attachment.",
      };
    }
    const json = buildAnnotationJSON(resolved, attachment);
    const variants = splitIfNeeded(json);
    let firstKey: string | undefined;
    for (const variant of variants) {
      const saved = await Zotero.Annotations.saveFromJSON(attachment, variant);
      if (!firstKey && saved?.key) {
        firstKey = saved.key;
      }
    }
    return { success: true, annotationKey: firstKey };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

export async function updateAnnotation(
  attachment: Zotero.Item,
  resolved: AnnotationResolvedJSON & { key: string },
): Promise<SaveAnnotationResult> {
  try {
    if (!attachment || typeof attachment.isPDFAttachment !== "function") {
      return { success: false, error: "Missing PDF attachment reference." };
    }
    if (!attachment.isPDFAttachment()) {
      return { success: false, error: "Target item is not a PDF attachment." };
    }
    if (!resolved.key) {
      return { success: false, error: "Missing annotation key for update." };
    }
    const existing = Zotero.Items.getByLibraryAndKey(
      attachment.libraryID,
      resolved.key,
    ) as Zotero.Item | false;
    if (!existing || !existing.isAnnotation?.()) {
      return { success: false, error: "Target annotation does not exist." };
    }
    if (!isAnnotationOnAttachment(existing, attachment)) {
      return {
        success: false,
        error: "Target annotation does not belong to this PDF attachment.",
      };
    }
    const json = buildAnnotationJSON(resolved, attachment);
    json.key = resolved.key;
    await Zotero.Annotations.saveFromJSON(attachment, json);
    return { success: true, annotationKey: resolved.key };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

export async function deleteAnnotation(
  attachment: Zotero.Item,
  annotationKey: string,
): Promise<SaveAnnotationResult> {
  try {
    if (!annotationKey) {
      return { success: false, error: "Missing annotation key for delete." };
    }
    const existing = Zotero.Items.getByLibraryAndKey(
      attachment.libraryID,
      annotationKey,
    ) as Zotero.Item | false;
    if (!existing || !existing.isAnnotation?.()) {
      return { success: false, error: "Target annotation does not exist." };
    }
    if (!isAnnotationOnAttachment(existing, attachment)) {
      return {
        success: false,
        error: "Target annotation does not belong to this PDF attachment.",
      };
    }
    await existing.eraseTx();
    return { success: true, annotationKey };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
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

export function buildAnnotationJSON(
  resolved: AnnotationResolvedJSON,
  attachment: Zotero.Item,
): _ZoteroTypes.Annotations.AnnotationJson {
  const pageIndex = Math.max(0, Math.floor(resolved.pageIndex || 0));
  const rects = normalizeAnnotationRects(
    Array.isArray(resolved.rects) ? resolved.rects : [],
    resolved.pageWidth,
    resolved.pageHeight,
  );
  const type = resolved.type;
  const key = resolved.key || generateAnnotationKey();
  const position =
    type === "note" || type === "text"
      ? {
          pageIndex,
          rects: rects.length
            ? rects.slice(0, 1)
            : [getDefaultNoteRect(resolved.pageWidth, resolved.pageHeight)],
        }
      : buildTextMarkupPosition(pageIndex, rects);
  return {
    id: key,
    libraryID: attachment.libraryID,
    key,
    type,
    text: resolved.text || "",
    comment: resolved.comment || "",
    color: normalizeColor(resolved.color),
    pageLabel: resolved.pageLabel || String(pageIndex + 1),
    sortIndex: buildSortIndex(pageIndex, position.rects, resolved.pageHeight),
    position,
    tags: resolved.tags
      ? (resolved.tags as unknown as {
          name: string;
          color: string;
        })
      : undefined,
    dateModified: new Date().toISOString().replace("T", " ").slice(0, 19),
    readOnly: false,
  } as _ZoteroTypes.Annotations.AnnotationJson;
}

function buildTextMarkupPosition(
  pageIndex: number,
  rects: number[][],
): {
  pageIndex: number;
  rects: number[][];
} {
  if (!rects.length) {
    throw new Error("Annotation position is invalid or outside the page.");
  }
  return { pageIndex, rects };
}

function generateAnnotationKey(): string {
  try {
    const utilities = (
      Zotero as unknown as {
        Utilities?: { randomString?: (len?: number, chars?: string) => string };
      }
    ).Utilities;
    const key = utilities?.randomString?.(
      8,
      "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ",
    );
    if (key && key.length === 8) {
      return key;
    }
  } catch {
    // fall through to local fallback
  }
  return Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, "A");
}

function splitIfNeeded(
  json: _ZoteroTypes.Annotations.AnnotationJson,
): _ZoteroTypes.Annotations.AnnotationJson[] {
  try {
    const variants = Zotero.Annotations.splitAnnotationJSON(json);
    if (Array.isArray(variants) && variants.length) {
      return variants;
    }
  } catch {
    // Fall back to the original JSON if splitting is unavailable or throws.
  }
  return [json];
}

function normalizeAnnotationRects(
  rects: number[][],
  pageWidth?: number,
  pageHeight?: number,
): number[][] {
  const safePageWidth = getPositiveNumber(pageWidth);
  const safePageHeight = getPositiveNumber(pageHeight);
  const pageArea =
    safePageWidth !== null && safePageHeight !== null
      ? safePageWidth * safePageHeight
      : null;
  const normalized: number[][] = [];
  let totalArea = 0;

  for (const rect of rects) {
    if (!Array.isArray(rect) || rect.length < 4) {
      continue;
    }
    const values = rect.slice(0, 4).map((value) => Number(value));
    if (!values.every((value) => Number.isFinite(value))) {
      continue;
    }
    let [x1, y1, x2, y2] = [
      Math.min(values[0], values[2]),
      Math.min(values[1], values[3]),
      Math.max(values[0], values[2]),
      Math.max(values[1], values[3]),
    ];
    if (safePageWidth !== null) {
      x1 = clamp(x1, 0, safePageWidth);
      x2 = clamp(x2, 0, safePageWidth);
    }
    if (safePageHeight !== null) {
      y1 = clamp(y1, 0, safePageHeight);
      y2 = clamp(y2, 0, safePageHeight);
    }

    const width = x2 - x1;
    const height = y2 - y1;
    if (width < MIN_RECT_EDGE || height < MIN_RECT_EDGE) {
      continue;
    }
    if (
      safePageHeight !== null &&
      height >
        Math.max(
          MAX_RECT_HEIGHT_POINTS,
          safePageHeight * MAX_RECT_PAGE_HEIGHT_RATIO,
        )
    ) {
      continue;
    }
    const area = width * height;
    if (
      pageArea !== null &&
      area > pageArea * MAX_SINGLE_RECT_PAGE_AREA_RATIO
    ) {
      continue;
    }
    totalArea += area;
    normalized.push([round(x1), round(y1), round(x2), round(y2)]);
    if (normalized.length >= MAX_RECTS_PER_ANNOTATION) {
      break;
    }
  }

  if (
    pageArea !== null &&
    normalized.length &&
    totalArea > pageArea * MAX_TOTAL_RECT_PAGE_AREA_RATIO
  ) {
    return [];
  }

  return normalized.sort((a, b) => {
    const yDelta = b[1] - a[1];
    if (Math.abs(yDelta) > 0.5) {
      return yDelta;
    }
    return a[0] - b[0];
  });
}

function getDefaultNoteRect(pageWidth?: number, pageHeight?: number): number[] {
  const safePageWidth = getPositiveNumber(pageWidth);
  const safePageHeight = getPositiveNumber(pageHeight);
  if (safePageWidth === null || safePageHeight === null) {
    return [...DEFAULT_NOTE_RECT];
  }
  const left = clamp(DEFAULT_NOTE_RECT[0], 0, Math.max(0, safePageWidth - 10));
  const bottom = clamp(
    DEFAULT_NOTE_RECT[1],
    0,
    Math.max(0, safePageHeight - 10),
  );
  return [left, bottom, left + 10, bottom + 10].map(round);
}

function getPositiveNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildSortIndex(
  pageIndex: number,
  rects: number[][],
  pageHeight?: number,
): string {
  // Zotero validates sortIndex against /^\d{5}\|\d{6,7}\|\d{5}$/
  // Format: PageIndex(5) | DistanceFromPageTop(6-7) | LeftEdge(5)
  // Distance-from-top is computed as (pageHeight - top-y-of-highest-rect), so
  // annotations near the top of a page sort before ones lower down.
  const topMost = rects.length
    ? Math.max(...rects.map((r) => Number(r[3]) || 0))
    : 0;
  const leftMost = rects.length
    ? Math.min(...rects.map((r) => Number(r[0]) || 0))
    : 0;
  const safePageHeight =
    typeof pageHeight === "number" &&
    Number.isFinite(pageHeight) &&
    pageHeight > 0
      ? pageHeight
      : 1000;
  // PDF user space puts origin at bottom-left; top-of-rect (y2) closer to the
  // top of the page means a larger y, so we invert with pageHeight.
  const distanceFromTop = Math.max(0, safePageHeight - topMost);
  return [
    padNumber(pageIndex, 5),
    padNumber(Math.floor(distanceFromTop), 6),
    padNumber(Math.floor(leftMost), 5),
  ].join("|");
}

function padNumber(value: number, width: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  // Cap so a malformed input doesn't blow past the regex's max width. The
  // middle segment allows 7 digits; everything else is fixed to its width.
  const maxAllowed = width === 6 ? 9_999_999 : 10 ** width - 1;
  return String(Math.min(safe, maxAllowed)).padStart(width, "0");
}

function normalizeColor(value: string | undefined): string {
  if (!value) {
    return DEFAULT_COLOR;
  }
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed}`;
  }
  return DEFAULT_COLOR;
}

function formatError(error: unknown): string {
  return describeUnknownError(error);
}

// XPCOM exceptions thrown by Zotero APIs (saveFromJSON, eraseTx, …) are not
// `Error` instances and their fields are non-enumerable getters, so a naive
// `JSON.stringify` collapses them to `"{}"`. Pull the well-known fields by
// name before falling back to coercion.
function describeUnknownError(error: unknown): string {
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
    const message = readErrorField(record, "message");
    if (message) parts.push(message);
    const name = readErrorField(record, "name");
    if (name && name !== message) parts.push(`(${name})`);
    const result = readErrorField(record, "result");
    if (result) parts.push(`[result=${result}]`);
    const filename = readErrorField(record, "filename");
    const lineNumber = readErrorField(record, "lineNumber");
    if (filename || lineNumber) {
      parts.push(`at ${filename || "?"}:${lineNumber || "?"}`);
    }
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

function readErrorField(
  record: Record<string, unknown>,
  field: string,
): string {
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

export const pdfAnnotationsTestUtils = {
  buildAnnotationJSON,
  buildSortIndex,
  generateAnnotationKey,
  isAnnotationOnAttachment,
  normalizeAnnotationRects,
  normalizeColor,
};
