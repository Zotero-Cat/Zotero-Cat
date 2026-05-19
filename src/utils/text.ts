/**
 * Shared text utility functions used across agent modules.
 * Consolidates duplicate implementations from context.ts, webSearch.ts,
 * toolAction.ts, section.ts, and provider.ts.
 */

/**
 * Return a string value, or "" for non-strings.
 */
export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Type guard: value is a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Decode common HTML entities in a string.
 */
export function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/**
 * Strip HTML tags and decode basic entities.
 * Block-level elements (br, p, div, li, h1-h6) insert newlines.
 */
export function stripHTML(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Normalize multi-line text: unify line endings, trim trailing spaces on lines,
 * collapse 3+ blank lines to 2.
 */
export function normalizeMultiline(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Collapse all whitespace to single spaces, adjust punctuation spacing,
 * and decode basic HTML entities.
 */
export function collapseWhitespace(text: string): string {
  return decodeBasicEntities(text)
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/**
 * Truncate text to a character limit, adding "…" when truncated.
 * Tries to break at sentence boundaries (., 。, ！, ？) or word boundaries.
 */
export function truncateAtSentence(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const sliced = text.slice(0, limit);
  const sentenceEnd = Math.max(
    sliced.lastIndexOf(". "),
    sliced.lastIndexOf(".\n"),
    sliced.lastIndexOf("。"),
    sliced.lastIndexOf("！"),
    sliced.lastIndexOf("？"),
  );
  if (sentenceEnd > limit * 0.5) {
    return `${sliced.slice(0, sentenceEnd + 1).trimEnd()}`;
  }
  const wordEnd = sliced.lastIndexOf(" ");
  if (wordEnd > limit * 0.5) {
    return `${sliced.slice(0, wordEnd).trimEnd()}…`;
  }
  return `${sliced.trimEnd()}…`;
}

/**
 * Simple truncation: trim and add "…" when text exceeds limit.
 */
export function truncate(text: string, limit: number): string {
  const normalized = text.trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/**
 * Normalize whitespace within a single line and truncate with "…".
 */
export function truncateInline(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/**
 * Format a timestamp as a short localized date/time string.
 * Falls back to ISO format when Intl is unavailable.
 */
export function formatShortDateTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().replace("T", " ").slice(5, 16);
  }
}
