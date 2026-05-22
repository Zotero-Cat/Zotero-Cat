import { collapseWhitespace, normalizeMultiline } from "../../utils/text";

// esbuild bundles the literal require call but defers evaluation until the
// first getPdfJs() call. Static `import * as` would hoist pdf.js's top-level
// code to plugin startup, and any XUL-sandbox incompatibility there aborts
// the whole plugin before `addon.data.initialized` is set.
declare const require: (moduleName: string) => unknown;

interface PdfJsModule {
  getDocument: (src: {
    data: Uint8Array;
    useWorkerFetch?: boolean;
    isEvalSupported?: boolean;
    disableFontFace?: boolean;
  }) => { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerSrc: string | null };
}

interface PdfDocument {
  numPages: number;
  getPage(index: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfPage {
  pageNumber: number;
  getViewport(options: { scale: number }): PdfViewport;
  getTextContent(): Promise<PdfTextContent>;
}

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfTextContent {
  items: PdfTextItem[];
}

interface PdfTextItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
}

export interface ExtractedTextSpan {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedPage {
  pageIndex: number;
  pageLabel: string;
  pageWidth: number;
  pageHeight: number;
  text: string;
  spans: ExtractedTextSpan[];
}

export interface ResolvedRects {
  pageIndex: number;
  pageLabel: string;
  rects: number[][];
  matchedText: string;
}

export interface FindTextRectsOptions {
  strictPage?: boolean;
}

const SEARCH_WINDOW_PAGES = 2;

let pdfjsModule: PdfJsModule | null = null;
let cachedDocumentByPath = new Map<
  string,
  Promise<{ pages: ExtractedPage[]; mtime: number }>
>();

function getPdfJs(): PdfJsModule {
  if (pdfjsModule) {
    return pdfjsModule;
  }
  ensurePdfJsGlobals();
  let loaded: unknown;
  try {
    loaded = require("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (error) {
    logToZotero(error);
    throw new Error(
      `Failed to load pdfjs-dist bundle: ${formatLoadError(error)}`,
    );
  }
  const resolved =
    (loaded as { default?: PdfJsModule }).default || (loaded as PdfJsModule);
  if (!resolved || typeof resolved.getDocument !== "function") {
    throw new Error(
      "pdfjs-dist loaded but did not expose getDocument(). The bundle may be corrupt.",
    );
  }
  registerMainThreadWorker();
  pdfjsModule = resolved;
  return resolved;
}

function registerMainThreadWorker(): void {
  // pdfjs v4 only skips the real-Worker code path if either workerSrc points
  // to a fetchable URL or `globalThis.pdfjsWorker.WorkerMessageHandler` is
  // present. Zotero's bootstrap sandbox can't fetch a worker URL, so we load
  // the worker module synchronously and publish its message handler here.
  const target = globalThis as Record<string, unknown>;
  const existing = target.pdfjsWorker as
    | { WorkerMessageHandler?: unknown }
    | undefined;
  if (existing?.WorkerMessageHandler) {
    return;
  }
  try {
    const workerModule = require("pdfjs-dist/legacy/build/pdf.worker.mjs") as {
      WorkerMessageHandler?: unknown;
      default?: { WorkerMessageHandler?: unknown };
    };
    const handler =
      workerModule?.WorkerMessageHandler ||
      workerModule?.default?.WorkerMessageHandler;
    if (handler) {
      target.pdfjsWorker = { WorkerMessageHandler: handler };
    } else {
      logToZotero(
        new Error(
          "pdfjs-dist worker module loaded but did not expose WorkerMessageHandler.",
        ),
      );
    }
  } catch (error) {
    logToZotero(error);
  }
}

function ensurePdfJsGlobals(): void {
  const target = globalThis as Record<string, unknown>;
  const mainWindow = (
    Zotero as unknown as { getMainWindow?: () => Record<string, unknown> }
  ).getMainWindow?.();

  // Bulk-mirror well-known browser/DOM globals from the Zotero main window so
  // pdfjs has the standard environment it expects. This is the catch-all to
  // stop the whack-a-mole of "X is not defined" errors during PDF parsing.
  if (mainWindow) {
    const bridged = [
      "Blob",
      "File",
      "FileReader",
      "URL",
      "URLSearchParams",
      "TextDecoder",
      "TextEncoder",
      "ReadableStream",
      "WritableStream",
      "TransformStream",
      "ByteLengthQueuingStrategy",
      "CountQueuingStrategy",
      "Request",
      "Response",
      "Headers",
      "FormData",
      "AbortController",
      "AbortSignal",
      "DOMException",
      "Event",
      "EventTarget",
      "MessageChannel",
      "MessagePort",
      "Worker",
      "structuredClone",
      "queueMicrotask",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "crypto",
      "performance",
      "fetch",
      "atob",
      "btoa",
      "ImageData",
      "OffscreenCanvas",
      "Path2D",
    ];
    for (const name of bridged) {
      if (target[name] === undefined && mainWindow[name] !== undefined) {
        target[name] = mainWindow[name];
      }
    }
  }

  ensureGlobal(target, "console", mainWindow?.console, () => {
    const debug = (Zotero as unknown as { debug?: (msg: string) => void })
      .debug;
    const sink = (level: string) =>
      function (...args: unknown[]) {
        if (typeof debug !== "function") return;
        try {
          debug(
            `[Zotero-Cat pdfjs ${level}] ${args
              .map((arg) =>
                arg instanceof Error
                  ? `${arg.name}: ${arg.message}`
                  : typeof arg === "string"
                    ? arg
                    : (() => {
                        try {
                          return JSON.stringify(arg);
                        } catch {
                          return String(arg);
                        }
                      })(),
              )
              .join(" ")}`,
          );
        } catch {
          // ignore logging failures
        }
      };
    return {
      log: sink("log"),
      info: sink("info"),
      warn: sink("warn"),
      error: sink("error"),
      debug: sink("debug"),
      trace: sink("trace"),
      dir: sink("dir"),
      assert: sink("assert"),
      group: () => {},
      groupCollapsed: () => {},
      groupEnd: () => {},
      time: () => {},
      timeEnd: () => {},
    };
  });

  ensureGlobal(target, "DOMException", mainWindow?.DOMException, () => {
    class DOMExceptionStub extends Error {
      code: number;
      constructor(message?: string, name: string = "Error") {
        super(message || "");
        this.name = name;
        this.code = 0;
      }
    }
    return DOMExceptionStub;
  });

  // pdfjs uses AbortController for stream cancellation and worker teardown.
  // Prefer the main window's native implementation so signals are real DOM
  // objects; fall back to a minimal stub if the window is unavailable.
  ensureGlobal(target, "AbortSignal", mainWindow?.AbortSignal, () => {
    class AbortSignalStub {
      aborted = false;
      reason: unknown = undefined;
      onabort: (() => void) | null = null;
      private listeners = new Set<(event?: unknown) => void>();
      addEventListener(_type: string, listener: (event?: unknown) => void) {
        this.listeners.add(listener);
      }
      removeEventListener(_type: string, listener: (event?: unknown) => void) {
        this.listeners.delete(listener);
      }
      dispatchEvent(_event?: unknown) {
        return true;
      }
      _fire() {
        try {
          this.onabort?.();
        } catch {
          /* ignore */
        }
        for (const listener of this.listeners) {
          try {
            listener();
          } catch {
            /* ignore */
          }
        }
      }
    }
    return AbortSignalStub;
  });
  ensureGlobal(target, "AbortController", mainWindow?.AbortController, () => {
    const SignalCtor = target.AbortSignal as unknown as new () => {
      aborted: boolean;
      reason: unknown;
      _fire?: () => void;
    };
    class AbortControllerStub {
      signal = new SignalCtor();
      abort(reason?: unknown) {
        if (this.signal.aborted) return;
        this.signal.aborted = true;
        this.signal.reason = reason;
        this.signal._fire?.();
      }
    }
    return AbortControllerStub;
  });

  // pdfjs builds reference both `DOMException` and (historically) a captured
  // alias `NativeDOMException`. Mirror the alias so any internal indirection
  // resolves the same constructor.
  if (!target.NativeDOMException) {
    target.NativeDOMException = target.DOMException;
  }

  // Some pdfjs entry points poke at `navigator.userAgent` / `window` during
  // module evaluation. Fall back to the Zotero main window when those are
  // missing in the bootstrap sandbox.
  if (mainWindow) {
    if (!target.window) {
      target.window = mainWindow;
    }
    if (!target.navigator && mainWindow.navigator) {
      target.navigator = mainWindow.navigator;
    }
    if (!target.document && mainWindow.document) {
      target.document = mainWindow.document;
    }
  }
}

function ensureGlobal(
  target: Record<string, unknown>,
  name: string,
  fromWindow: unknown,
  buildFallback: () => unknown,
): void {
  if (target[name]) {
    return;
  }
  if (fromWindow) {
    target[name] = fromWindow;
    return;
  }
  try {
    target[name] = buildFallback();
  } catch (error) {
    logToZotero(error);
  }
}

function formatLoadError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function logToZotero(error: unknown): void {
  try {
    const zoteroAny = Zotero as unknown as {
      logError?: (e: unknown) => void;
      debug?: (msg: string) => void;
    };
    if (typeof zoteroAny.logError === "function") {
      zoteroAny.logError(error);
    } else if (typeof zoteroAny.debug === "function") {
      zoteroAny.debug(`[Zotero-Cat pdfReader] ${formatLoadError(error)}`);
    }
  } catch {
    // ignore logging failures
  }
}

export async function extractPages(
  attachment: Zotero.Item,
): Promise<ExtractedPage[]> {
  const path = await resolveAttachmentPath(attachment);
  if (!path) {
    throw new Error("PDF attachment has no readable file path.");
  }
  const mtime = await resolveFileMTime(path);
  const cached = cachedDocumentByPath.get(path);
  if (cached) {
    const resolved = await cached;
    if (resolved.mtime === mtime) {
      return resolved.pages;
    }
    cachedDocumentByPath.delete(path);
  }
  const promise = (async () => {
    const pages = await readDocumentPages(path, attachment);
    return { pages, mtime };
  })();
  cachedDocumentByPath.set(path, promise);
  try {
    return (await promise).pages;
  } catch (error) {
    cachedDocumentByPath.delete(path);
    throw error;
  }
}

export function renderPagesAsText(pages: ExtractedPage[]): string {
  return pages
    .map((page) => `[p.${page.pageLabel}]\n${page.text}`)
    .join("\n\n");
}

export function findTextRects(
  pages: ExtractedPage[],
  targetPageIndex: number | null | undefined,
  query: string,
  options: FindTextRectsOptions = {},
): ResolvedRects | null {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return null;
  }
  const direct = searchPages(pages, targetPageIndex, normalizedQuery, options);
  if (direct) {
    return direct;
  }
  // Keep exact matching first, but tolerate common orthographic differences
  // between model prose and PDF extraction: "can not" vs "cannot", and
  // dehyphenated line-break compounds such as "intra- cluster" that become
  // "intracluster" in the indexed PDF text while the model writes
  // "intra-cluster".
  for (const fallback of buildOrthographicFallbackQueries(normalizedQuery)) {
    const fromOrthography = searchPages(
      pages,
      targetPageIndex,
      fallback,
      options,
    );
    if (fromOrthography) {
      return fromOrthography;
    }
  }
  // Some models (notably glm-4.5-air) abbreviate quotes with a trailing
  // ellipsis instead of copying the full span. Prefer the last complete
  // sentence before the ellipsis so a half-written next sentence does not make
  // the whole quote unmatchable, then keep the older prefix retry as fallback.
  for (const fallback of buildEllipsisFallbackQueries(normalizedQuery)) {
    const fromEllipsis = searchPages(pages, targetPageIndex, fallback, options);
    if (fromEllipsis) {
      return fromEllipsis;
    }
  }
  // The error UI truncates long quoted text with an ellipsis, but the actual
  // model argument may be a long multi-sentence quote without a literal
  // ellipsis. If the whole quote fails, try complete sentence-sized spans
  // before giving up. This keeps the annotation grounded in verbatim PDF text
  // while avoiding failures caused by one non-verbatim trailing sentence.
  for (const fallback of buildCompleteSentenceFallbackQueries(
    normalizedQuery,
  )) {
    const fromSentence = searchPages(pages, targetPageIndex, fallback, options);
    if (fromSentence) {
      return fromSentence;
    }
  }
  // Last resort: models sometimes splice short verbatim phrases together with
  // their own connective wording. Direct/prefix matching fails because the
  // connective bits don't appear verbatim in the PDF, but the verbatim islands
  // do. When the caller pinned a page, look for the longest contiguous
  // substring of the normalized query that appears verbatim on that page. The
  // 40-char floor keeps this from latching onto generic 1-2 word fragments.
  if (
    typeof targetPageIndex !== "number" ||
    !Number.isFinite(targetPageIndex)
  ) {
    return null;
  }
  const candidateOrder = options.strictPage
    ? pages.filter((page) => page.pageIndex === targetPageIndex)
    : buildSearchOrder(pages, targetPageIndex);
  for (const page of candidateOrder) {
    const match = matchPageByLongestCommonSubstring(page, normalizedQuery);
    if (match) {
      return match;
    }
  }
  return null;
}

function searchPages(
  pages: ExtractedPage[],
  targetPageIndex: number | null | undefined,
  normalizedQuery: string,
  options: FindTextRectsOptions,
): ResolvedRects | null {
  if (
    typeof targetPageIndex !== "number" ||
    !Number.isFinite(targetPageIndex)
  ) {
    let found: ResolvedRects | null = null;
    for (const page of pages) {
      const match = matchPage(page, normalizedQuery);
      if (!match) {
        continue;
      }
      if (found) {
        return null;
      }
      found = match;
    }
    return found;
  }
  const candidateOrder = options.strictPage
    ? pages.filter((page) => page.pageIndex === targetPageIndex)
    : buildSearchOrder(pages, targetPageIndex);
  for (const page of candidateOrder) {
    const match = matchPage(page, normalizedQuery);
    if (match) {
      return match;
    }
  }
  return null;
}

const MIN_ELLIPSIS_FALLBACK_PREFIX = 20;
const MIN_SENTENCE_FALLBACK_LEN = 40;
const MIN_LCS_FALLBACK_LEN = 40;

function matchPageByLongestCommonSubstring(
  page: ExtractedPage,
  normalizedQuery: string,
): ResolvedRects | null {
  if (!page.spans.length) {
    return null;
  }
  const { normalizedText, spanIndexMap } = buildNormalizedIndex(page.spans);
  if (!normalizedText) {
    return null;
  }
  const { textStart, length } = findLongestCommonSubstring(
    normalizedQuery,
    normalizedText,
  );
  if (length < MIN_LCS_FALLBACK_LEN) {
    return null;
  }
  const endIdx = textStart + length;
  const startSpan = spanIndexMap[textStart];
  const endSpan = spanIndexMap[endIdx - 1];
  if (startSpan === undefined || endSpan === undefined) {
    return null;
  }
  const rects = mergeSpanRects(
    page.spans.slice(startSpan, endSpan + 1),
    page.pageHeight,
  );
  const matchedText = page.spans
    .slice(startSpan, endSpan + 1)
    .map((span) => span.text)
    .join("");
  return {
    pageIndex: page.pageIndex,
    pageLabel: page.pageLabel,
    rects,
    matchedText,
  };
}

function findLongestCommonSubstring(
  query: string,
  text: string,
): { queryStart: number; textStart: number; length: number } {
  const m = query.length;
  const n = text.length;
  if (m === 0 || n === 0) {
    return { queryStart: 0, textStart: 0, length: 0 };
  }
  // Rolling two-row DP keeps memory at O(n) — text can be a few thousand chars,
  // query is bounded by the model's 240-char quoted-text cap, so this stays
  // well under a millisecond per page.
  let prev = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);
  let bestLen = 0;
  let bestQueryEnd = 0;
  let bestTextEnd = 0;
  for (let i = 1; i <= m; i += 1) {
    const qChar = query.charCodeAt(i - 1);
    for (let j = 1; j <= n; j += 1) {
      if (qChar === text.charCodeAt(j - 1)) {
        const len = prev[j - 1] + 1;
        curr[j] = len;
        if (len > bestLen) {
          bestLen = len;
          bestQueryEnd = i;
          bestTextEnd = j;
        }
      } else {
        curr[j] = 0;
      }
    }
    const swap = prev;
    prev = curr;
    curr = swap;
    curr.fill(0);
  }
  return {
    queryStart: bestQueryEnd - bestLen,
    textStart: bestTextEnd - bestLen,
    length: bestLen,
  };
}

function stripTrailingEllipsis(normalized: string): string | null {
  // normalizeForMatching collapses whitespace and converts `…` to `...`, so
  // detecting a trailing run of 3+ dots is sufficient to spot both forms.
  const trimmed = getPrefixBeforeTrailingEllipsis(normalized);
  if (!trimmed) {
    return null;
  }
  if (trimmed.length < MIN_ELLIPSIS_FALLBACK_PREFIX) {
    return null;
  }
  return trimmed;
}

function buildEllipsisFallbackQueries(normalized: string): string[] {
  const candidates = [
    getCompleteSentenceBeforeTrailingEllipsis(normalized),
    stripTrailingEllipsis(normalized),
  ];
  return candidates.filter((candidate, index): candidate is string => {
    if (!candidate) {
      return false;
    }
    return candidates.indexOf(candidate) === index;
  });
}

function buildCompleteSentenceFallbackQueries(normalized: string): string[] {
  const sentences = extractCompleteSentences(normalized).filter(
    (sentence) =>
      sentence.length >= MIN_SENTENCE_FALLBACK_LEN && sentence !== normalized,
  );
  return dedupeStrings(sentences);
}

function buildOrthographicFallbackQueries(normalized: string): string[] {
  const baseVariants = dedupeStrings([
    normalized.replace(/\bcan\s+not\b/g, "cannot"),
    normalized.replace(/\bcannot\b/g, "can not"),
  ]).filter((candidate) => candidate && candidate !== normalized);
  const candidates = [...baseVariants];
  for (const base of [normalized, ...baseVariants]) {
    candidates.push(base.replace(/(\w)-(\w)/g, "$1$2"));
  }
  return dedupeStrings(
    candidates.filter((candidate) => candidate && candidate !== normalized),
  );
}

function getPrefixBeforeTrailingEllipsis(normalized: string): string | null {
  if (!/\.{3,}$/.test(normalized)) {
    return null;
  }
  const trimmed = normalized.replace(/\s*\.{3,}\s*$/u, "").trimEnd();
  if (!trimmed || trimmed === normalized) {
    return null;
  }
  return trimmed;
}

function getCompleteSentenceBeforeTrailingEllipsis(
  normalized: string,
): string | null {
  const prefix = getPrefixBeforeTrailingEllipsis(normalized);
  if (!prefix) {
    return null;
  }
  const sentences = extractCompleteSentences(prefix);
  const sentence = sentences[sentences.length - 1];
  if (!sentence) {
    return null;
  }
  if (sentence.length < MIN_ELLIPSIS_FALLBACK_PREFIX) {
    return null;
  }
  return sentence;
}

function extractCompleteSentences(normalized: string): string[] {
  const sentenceEnds: number[] = [];
  const sentenceEndPattern = /[.!?。！？](?=\s|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = sentenceEndPattern.exec(normalized)) !== null) {
    sentenceEnds.push(match.index + match[0].length);
  }
  const sentences: string[] = [];
  let start = 0;
  for (const end of sentenceEnds) {
    const sentence = normalized.slice(start, end).trim();
    if (sentence) {
      sentences.push(sentence);
    }
    start = end;
  }
  return sentences;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function buildSearchOrder(
  pages: ExtractedPage[],
  targetPageIndex: number | null | undefined,
): ExtractedPage[] {
  if (
    typeof targetPageIndex !== "number" ||
    !Number.isFinite(targetPageIndex)
  ) {
    return pages;
  }
  const seen = new Set<number>();
  const ordered: ExtractedPage[] = [];
  for (let offset = 0; offset <= SEARCH_WINDOW_PAGES; offset += 1) {
    for (const direction of [0, -1, 1]) {
      const index = targetPageIndex + direction * offset;
      if (offset === 0 && direction !== 0) {
        continue;
      }
      if (seen.has(index) || index < 0 || index >= pages.length) {
        continue;
      }
      seen.add(index);
      ordered.push(pages[index]);
    }
  }
  for (const page of pages) {
    if (!seen.has(page.pageIndex)) {
      seen.add(page.pageIndex);
      ordered.push(page);
    }
  }
  return ordered;
}

function matchPage(
  page: ExtractedPage,
  normalizedQuery: string,
): ResolvedRects | null {
  if (!page.spans.length) {
    return null;
  }
  const { normalizedText, spanIndexMap } = buildNormalizedIndex(page.spans);
  const idx = normalizedText.indexOf(normalizedQuery);
  if (idx < 0) {
    return null;
  }
  const endIdx = idx + normalizedQuery.length;
  const startSpan = spanIndexMap[idx];
  const endSpan = spanIndexMap[endIdx - 1];
  if (startSpan === undefined || endSpan === undefined) {
    return null;
  }
  const rects = mergeSpanRects(
    page.spans.slice(startSpan, endSpan + 1),
    page.pageHeight,
  );
  const matchedText = page.spans
    .slice(startSpan, endSpan + 1)
    .map((span) => span.text)
    .join("");
  return {
    pageIndex: page.pageIndex,
    pageLabel: page.pageLabel,
    rects,
    matchedText,
  };
}

function buildNormalizedIndex(spans: ExtractedTextSpan[]): {
  normalizedText: string;
  spanIndexMap: number[];
} {
  const pieces: string[] = [];
  const rawMap: number[] = [];
  spans.forEach((span, spanIndex) => {
    const normalized = normalizeForMatching(span.text);
    if (!normalized) {
      return;
    }
    pieces.push(normalized);
    for (let i = 0; i < normalized.length; i += 1) {
      rawMap.push(spanIndex);
    }
    if (spanIndex < spans.length - 1) {
      pieces.push(" ");
      rawMap.push(spanIndex);
    }
  });
  const rawText = pieces.join("");
  // Rejoin line-break hyphenation that straddles span boundaries: pdf.js emits
  // "syn-" and "chronous" as separate items, which we join with " " above,
  // producing "syn- chronous". Per-span normalization can't see this. Strip the
  // intervening "-<whitespace>" only when surrounded by word characters so
  // inline compound hyphens ("anti-pattern", no following space) stay intact.
  // We keep spanIndexMap aligned by dropping exactly the removed entries.
  const removals: Array<{ start: number; end: number }> = [];
  const pattern = /(\w)-(\s+)(\w)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(rawText)) !== null) {
    const hyphenAt = m.index + 1;
    const segmentEnd = hyphenAt + 1 + m[2].length;
    removals.push({ start: hyphenAt, end: segmentEnd });
    pattern.lastIndex = segmentEnd;
  }
  if (!removals.length) {
    return { normalizedText: rawText, spanIndexMap: rawMap };
  }
  let result = "";
  const spanIndexMap: number[] = [];
  let cursor = 0;
  for (const removal of removals) {
    while (cursor < removal.start) {
      result += rawText[cursor];
      spanIndexMap.push(rawMap[cursor]);
      cursor += 1;
    }
    cursor = removal.end;
  }
  while (cursor < rawText.length) {
    result += rawText[cursor];
    spanIndexMap.push(rawMap[cursor]);
    cursor += 1;
  }
  return { normalizedText: result, spanIndexMap };
}

function normalizeQuery(query: string): string {
  return normalizeForMatching(query);
}

// PDF.js often emits Latin ligatures and soft hyphens straight from the
// source PDF, while models tend to write the decomposed ASCII form. We also
// see frequent smart-quote / em-dash / ellipsis mismatches: the PDF uses
// curly quotes from typesetting, the model writes straight ASCII. Both sides
// must reduce to the same normalized form before `indexOf` runs.
//
// Keep the transform restricted to character-level equivalents (no accent
// stripping, no fuzzy-distance match) so we never silently align a paraphrase
// to a wrong span.
const PDF_LIGATURE_MAP: Record<string, string> = {
  ﬀ: "ff",
  ﬁ: "fi",
  ﬂ: "fl",
  ﬃ: "ffi",
  ﬄ: "ffl",
  ﬅ: "st",
  ﬆ: "st",
};

function normalizeForMatching(text: string): string {
  // NFKC unifies compatibility forms: ligatures (ﬁ → fi), full-width punctuation,
  // and decomposed accented characters collapse to a single canonical form on
  // both sides of the comparison.
  let normalized = text.normalize("NFKC");
  // Strip zero-width formatting chars PDF.js sometimes carries through from
  // font encoding tables: U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM,
  // U+2060 WORD JOINER. Spelled as escapes so they remain readable in source.
  normalized = normalized.replace(/[\u200B-\u200D\uFEFF\u2060]/g, "");
  normalized = collapseWhitespace(normalized).toLowerCase();
  // Drop PDF soft hyphens (U+00AD) — line-break artifacts.
  normalized = normalized.replace(/\u00AD/g, "");
  // Safety net for Latin ligatures that bypass NFKC's mapping. Redundant for
  // the standard ﬁ/ﬂ/etc. forms but cheap.
  normalized = normalized.replace(/[ﬀ-ﬆ]/g, (ch) => PDF_LIGATURE_MAP[ch] || ch);
  // Normalize typesetters' smart quotes / dashes / ellipsis to their ASCII
  // equivalents so a model writing `"foo - bar..."` still aligns with a PDF
  // span containing `"foo — bar…"`.
  normalized = normalized
    .replace(/[‘’ʼ‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...");
  // Rejoin words split across a PDF line break: pdf.js emits "syn-" and
  // "chronous" as two text items, which we glue with a space → "syn- chronous".
  // Only fire when the hyphen sits between word characters with whitespace on
  // the right; inline hyphens in compound words ("anti-pattern") have no
  // following space and are preserved.
  normalized = normalized.replace(/(\w)-\s+(\w)/g, "$1$2");
  return normalized;
}

function mergeSpanRects(
  spans: ExtractedTextSpan[],
  pageHeight: number,
): number[][] {
  void pageHeight;
  if (!spans.length) {
    return [];
  }
  const rectsByLine = new Map<
    number,
    { x1: number; y1: number; x2: number; y2: number }
  >();
  for (const span of spans) {
    // pdf.js text item transforms are already in PDF user space here. Zotero
    // annotation rects also use PDF user space: [left, bottom, right, top].
    // Do not flip Y. Flipping places highlights in the opposite vertical
    // position, often over page margins or blank areas.
    const x1 = Math.min(span.x, span.x + span.width);
    const x2 = Math.max(span.x, span.x + span.width);
    const y1 = Math.min(span.y, span.y + span.height);
    const y2 = Math.max(span.y, span.y + span.height);
    const lineKey = Math.round(y1);
    const existing = rectsByLine.get(lineKey);
    if (!existing) {
      rectsByLine.set(lineKey, { x1, y1, x2, y2 });
      continue;
    }
    existing.x1 = Math.min(existing.x1, x1);
    existing.x2 = Math.max(existing.x2, x2);
    existing.y1 = Math.min(existing.y1, y1);
    existing.y2 = Math.max(existing.y2, y2);
  }
  return [...rectsByLine.values()]
    .sort((a, b) => b.y1 - a.y1)
    .map((rect) => [
      round(rect.x1),
      round(rect.y1),
      round(rect.x2),
      round(rect.y2),
    ]);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function readDocumentPages(
  path: string,
  attachment: Zotero.Item,
): Promise<ExtractedPage[]> {
  const pdfjs = getPdfJs();
  let data: Uint8Array;
  try {
    data = await readFileAsUint8Array(path);
  } catch (error) {
    logToZotero(error);
    throw new Error(
      `Failed to read PDF file at ${path}: ${formatLoadError(error)}`,
    );
  }
  if (!data || data.length === 0) {
    throw new Error(`PDF file at ${path} is empty.`);
  }
  let document: PdfDocument;
  try {
    const loadingTask = pdfjs.getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    });
    document = await loadingTask.promise;
  } catch (error) {
    logToZotero(error);
    throw new Error(
      `pdfjs failed to parse the PDF (${data.length} bytes): ${formatLoadError(error)}`,
    );
  }
  const pages: ExtractedPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const spans: ExtractedTextSpan[] = [];
      for (const item of content.items) {
        if (!item.str) {
          continue;
        }
        const transform = item.transform;
        const x = transform[4];
        const y = transform[5];
        const height = item.height || Math.abs(transform[3]);
        const width = item.width;
        spans.push({
          text: item.str,
          x,
          y,
          width,
          height,
        });
      }
      const pageIndex = pageNumber - 1;
      const pageLabel =
        resolvePageLabel(attachment, pageIndex) || String(pageNumber);
      pages.push({
        pageIndex,
        pageLabel,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        spans,
        text: normalizeMultiline(spans.map((span) => span.text).join(" ")),
      });
    }
  } finally {
    try {
      await document.destroy();
    } catch {
      // ignore cleanup failures
    }
  }
  return pages;
}

function resolvePageLabel(attachment: Zotero.Item, pageIndex: number): string {
  try {
    const annotations = attachment.getAnnotations?.(false) || [];
    for (const annotation of annotations) {
      const position = parseAnnotationPosition(annotation.annotationPosition);
      if (position && position.pageIndex === pageIndex) {
        return annotation.annotationPageLabel || String(pageIndex + 1);
      }
    }
  } catch {
    // fall through to default
  }
  return String(pageIndex + 1);
}

function parseAnnotationPosition(value: string | undefined): {
  pageIndex?: number;
} | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function resolveAttachmentPath(
  attachment: Zotero.Item,
): Promise<string | null> {
  try {
    if (typeof attachment.getFilePathAsync === "function") {
      const path = await attachment.getFilePathAsync();
      return path || null;
    }
    const path = attachment.getFilePath?.();
    return path || null;
  } catch {
    return null;
  }
}

async function resolveFileMTime(path: string): Promise<number> {
  const ioUtils = resolveIOUtils();
  if (ioUtils?.stat) {
    try {
      const stat = await ioUtils.stat(path);
      if (stat?.lastModified) {
        return stat.lastModified;
      }
    } catch {
      // fall through to Zotero.File
    }
  }
  try {
    const zFile = (Zotero as unknown as { File?: ZoteroFileAPI }).File;
    if (zFile?.pathToFile) {
      const file = zFile.pathToFile(path);
      const mtime = (file as unknown as { lastModifiedTime?: number })
        ?.lastModifiedTime;
      if (typeof mtime === "number") {
        return mtime;
      }
    }
  } catch {
    // ignore - mtime is best effort for caching
  }
  return 0;
}

async function readFileAsUint8Array(path: string): Promise<Uint8Array> {
  const ioUtils = resolveIOUtils();
  if (ioUtils?.read) {
    try {
      return await ioUtils.read(path);
    } catch (error) {
      // Continue to fallbacks rather than failing outright. Some plugin
      // sandboxes expose IOUtils but block certain scheme/path combinations.
      lastFileReadError = error;
    }
  }
  const zFile = (Zotero as unknown as { File?: ZoteroFileAPI }).File;
  if (zFile?.getBinaryContentsAsync) {
    const binaryString = await zFile.getBinaryContentsAsync(path);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      bytes[i] = binaryString.charCodeAt(i) & 0xff;
    }
    return bytes;
  }
  throw new Error(
    `Unable to read PDF file (no available reader). ${formatCause(lastFileReadError)}`,
  );
}

interface IOUtilsLike {
  read: (path: string) => Promise<Uint8Array>;
  stat: (path: string) => Promise<{ lastModified?: number }>;
}

interface ZoteroFileAPI {
  pathToFile?: (path: string) => unknown;
  getBinaryContentsAsync?: (
    pathOrFile: unknown,
    maxLength?: number,
  ) => Promise<string>;
}

let lastFileReadError: unknown = null;

function resolveIOUtils(): IOUtilsLike | null {
  const fromGlobal = (globalThis as unknown as { IOUtils?: IOUtilsLike })
    .IOUtils;
  if (fromGlobal) {
    return fromGlobal;
  }
  const fromZoteroWindow = (
    Zotero as unknown as { getMainWindow?: () => { IOUtils?: IOUtilsLike } }
  ).getMainWindow?.();
  if (fromZoteroWindow?.IOUtils) {
    return fromZoteroWindow.IOUtils;
  }
  return null;
}

function formatCause(error: unknown): string {
  if (!error) {
    return "";
  }
  if (error instanceof Error) {
    return `Cause: ${error.message}`;
  }
  return `Cause: ${String(error)}`;
}

export function clearPdfReaderCache(): void {
  cachedDocumentByPath = new Map();
}

export const pdfReaderTestUtils = {
  buildNormalizedIndex,
  matchPage,
  mergeSpanRects,
  findTextRects,
  normalizeQuery,
  buildSearchOrder,
  stripTrailingEllipsis,
  buildOrthographicFallbackQueries,
  buildEllipsisFallbackQueries,
  buildCompleteSentenceFallbackQueries,
  findLongestCommonSubstring,
  matchPageByLongestCommonSubstring,
};
