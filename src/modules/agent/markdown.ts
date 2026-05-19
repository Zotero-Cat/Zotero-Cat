/**
 * Lightweight Markdown-to-DOM renderer for Zotero-Cat chat messages.
 * Extracted from section.ts to keep the UI coordinator focused on runtime state.
 *
 * Renders: headings (h1-h6), code blocks (fenced), unordered/ordered lists,
 * blockquotes, paragraphs, inline **bold**, *italic*, `code`, and [links](url).
 * Links are sanitized to http/https only.
 */

const INLINE_MARKDOWN_PATTERN =
  /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
const MARKDOWN_BLOCK_START_PATTERN = /^(#{1,6}\s+|```|>\s?|[-*+]\s+|\d+\.\s+)/;

/**
 * Render a Markdown string into the given container element.
 * Replaces the container's children with a DocumentFragment.
 */
export function renderMessageMarkdown(
  container: HTMLElement,
  source: string,
): void {
  const doc = container.ownerDocument;
  if (!doc) {
    container.textContent = source;
    return;
  }
  const fragment = doc.createDocumentFragment();
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("```")) {
      index = appendCodeBlock(fragment, lines, index, doc);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const headingLevel = Math.min(6, headingMatch[1].length);
      const heading = doc.createElement(`h${headingLevel}`);
      appendInlineMarkdown(heading, headingMatch[2], doc);
      fragment.appendChild(heading);
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      index = appendListBlock(fragment, lines, index, doc, false);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      index = appendListBlock(fragment, lines, index, doc, true);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      index = appendQuoteBlock(fragment, lines, index, doc);
      continue;
    }

    index = appendParagraphBlock(fragment, lines, index, doc);
  }

  if (!fragment.childNodes.length) {
    const paragraph = doc.createElement("p");
    paragraph.textContent = "";
    fragment.appendChild(paragraph);
  }
  container.replaceChildren(fragment);
}

function appendCodeBlock(
  fragment: DocumentFragment,
  lines: string[],
  start: number,
  doc: Document,
): number {
  let cursor = start + 1;
  const codeLines: string[] = [];
  while (cursor < lines.length && !lines[cursor].trim().startsWith("```")) {
    codeLines.push(lines[cursor]);
    cursor += 1;
  }
  const pre = doc.createElement("pre");
  const code = doc.createElement("code");
  code.textContent = codeLines.join("\n");
  pre.appendChild(code);
  fragment.appendChild(pre);
  if (cursor < lines.length) {
    cursor += 1;
  }
  return cursor;
}

function appendListBlock(
  fragment: DocumentFragment,
  lines: string[],
  start: number,
  doc: Document,
  ordered: boolean,
): number {
  const list = doc.createElement(ordered ? "ol" : "ul");
  const pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/;
  let cursor = start;
  while (cursor < lines.length && pattern.test(lines[cursor])) {
    const item = doc.createElement("li");
    appendInlineMarkdown(item, lines[cursor].replace(pattern, ""), doc);
    list.appendChild(item);
    cursor += 1;
  }
  fragment.appendChild(list);
  return cursor;
}

function appendQuoteBlock(
  fragment: DocumentFragment,
  lines: string[],
  start: number,
  doc: Document,
): number {
  const quote = doc.createElement("blockquote");
  const quoteLines: string[] = [];
  let cursor = start;
  while (cursor < lines.length && /^\s*>\s?/.test(lines[cursor])) {
    quoteLines.push(lines[cursor].replace(/^\s*>\s?/, ""));
    cursor += 1;
  }
  const paragraph = doc.createElement("p");
  appendInlineMarkdown(paragraph, quoteLines.join("\n"), doc);
  quote.appendChild(paragraph);
  fragment.appendChild(quote);
  return cursor;
}

function appendParagraphBlock(
  fragment: DocumentFragment,
  lines: string[],
  start: number,
  doc: Document,
): number {
  const paragraphLines: string[] = [];
  let cursor = start;
  while (
    cursor < lines.length &&
    lines[cursor].trim() &&
    !MARKDOWN_BLOCK_START_PATTERN.test(lines[cursor].trim())
  ) {
    paragraphLines.push(lines[cursor]);
    cursor += 1;
  }
  const paragraph = doc.createElement("p");
  appendInlineMarkdown(paragraph, paragraphLines.join("\n"), doc);
  fragment.appendChild(paragraph);
  return cursor;
}

function appendInlineMarkdown(
  node: HTMLElement,
  text: string,
  doc: Document,
): void {
  INLINE_MARKDOWN_PATTERN.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null = null;
  while ((match = INLINE_MARKDOWN_PATTERN.exec(text))) {
    appendTextWithBreaks(node, text.slice(cursor, match.index), doc);
    const [full, linkText, linkHref, inlineCode, boldText, italicText] = match;
    if (linkText && linkHref) {
      const safeHref = normalizeLink(linkHref);
      if (!safeHref) {
        appendTextWithBreaks(node, full, doc);
      } else {
        const anchor = doc.createElement("a");
        anchor.href = safeHref;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = linkText;
        node.appendChild(anchor);
      }
    } else if (inlineCode) {
      const code = doc.createElement("code");
      code.textContent = inlineCode;
      node.appendChild(code);
    } else if (boldText) {
      const strong = doc.createElement("strong");
      strong.textContent = boldText;
      node.appendChild(strong);
    } else if (italicText) {
      const em = doc.createElement("em");
      em.textContent = italicText;
      node.appendChild(em);
    } else {
      appendTextWithBreaks(node, full, doc);
    }
    cursor = INLINE_MARKDOWN_PATTERN.lastIndex;
  }
  appendTextWithBreaks(node, text.slice(cursor), doc);
}

function appendTextWithBreaks(
  node: HTMLElement,
  text: string,
  doc: Document,
): void {
  if (!text) {
    return;
  }
  const segments = text.split("\n");
  for (const [index, segment] of segments.entries()) {
    if (segment) {
      node.appendChild(doc.createTextNode(segment));
    }
    if (index < segments.length - 1) {
      node.appendChild(doc.createElement("br"));
    }
  }
}

/**
 * Normalize a URL to http/https only. Returns "" for unsafe protocols.
 */
export function normalizeLink(href: string): string {
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
    return "";
  } catch {
    return "";
  }
}
