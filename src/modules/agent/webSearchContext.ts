import { getPref } from "../../utils/prefs";
import { normalizeString } from "./modelMetadata";
import {
  registerToolActionHandler,
  type ToolActionHandler,
} from "./toolAction";
import {
  buildWebSearchContext,
  buildWebSearchQuery,
  getDefaultWebSearchEndpoint,
  getWebSearchProviderLabel,
  normalizeWebSearchProvider,
  searchWeb,
  type WebSearchItemHint,
} from "../tools/webSearch";

export type WebSearchRunStatus =
  | { type: "searching" }
  | { type: "results"; count: number; provider: string }
  | { type: "no-results" }
  | { type: "failed"; error: unknown };

export interface WebSearchContextOptions {
  prompt: string;
  item: Zotero.Item | null;
  locale: "en" | "zh";
  isCancelled(): boolean;
  onStatus(status: WebSearchRunStatus): Promise<void> | void;
}

export function isWebSearchEnabledPref() {
  return getPref("webSearchEnabled") === true;
}

export async function buildExternalWebSearchContext(
  options: WebSearchContextOptions,
) {
  if (!isWebSearchEnabledPref()) {
    return "";
  }
  const query = buildWebSearchQuery(
    options.prompt,
    buildWebSearchItemHint(options.item),
  );
  if (!query) {
    return "";
  }
  return runWebSearchQuery(query, options);
}

export async function buildExternalWebSearchContextForQuery(
  query: string,
  options: Omit<WebSearchContextOptions, "prompt" | "item">,
) {
  if (!isWebSearchEnabledPref()) {
    return "";
  }
  const normalizedQuery = buildWebSearchQuery(query);
  if (!normalizedQuery) {
    return "";
  }
  return runWebSearchQuery(normalizedQuery, options);
}

async function runWebSearchQuery(
  query: string,
  options: Omit<WebSearchContextOptions, "prompt" | "item">,
) {
  const provider = normalizeWebSearchProvider(getPref("webSearchProvider"));
  const endpoint = normalizeString(
    getPref("webSearchBaseUrl"),
    getDefaultWebSearchEndpoint(provider),
  );
  await options.onStatus({ type: "searching" });
  if (options.isCancelled()) {
    return "";
  }
  try {
    const response = await searchWeb(query, { provider, endpoint });
    if (options.isCancelled()) {
      return "";
    }
    if (response.results.length) {
      await options.onStatus({
        type: "results",
        count: response.results.length,
        provider: getWebSearchProviderLabel(response.provider),
      });
    } else {
      await options.onStatus({ type: "no-results" });
    }
    return buildWebSearchContext(response, options.locale);
  } catch (error) {
    if (!options.isCancelled()) {
      await options.onStatus({ type: "failed", error });
    }
    return "";
  }
}

function buildWebSearchItemHint(item: Zotero.Item | null): WebSearchItemHint {
  const primaryItem = resolveSearchPrimaryItem(item);
  if (!primaryItem) {
    return {};
  }
  return {
    title:
      safeGetDisplayTitle(primaryItem) ||
      safeGetItemField(primaryItem, "title"),
    doi: safeGetItemField(primaryItem, "DOI"),
    year: extractSearchYear(safeGetItemField(primaryItem, "date")),
  };
}

function resolveSearchPrimaryItem(item: Zotero.Item | null) {
  let current: Zotero.Item | null = item;
  let guard = 0;
  while (current?.parentItem && guard < 6) {
    current = current.parentItem;
    guard += 1;
  }
  return current;
}

function safeGetDisplayTitle(item: Zotero.Item) {
  try {
    return item.getDisplayTitle() || "";
  } catch {
    return "";
  }
}

function safeGetItemField(item: Zotero.Item, field: string) {
  try {
    return item.getField(field) || "";
  } catch {
    return "";
  }
}

function extractSearchYear(value: string) {
  return value.match(/\b(\d{4})\b/)?.[1] || "";
}

export function registerWebSearchToolHandler() {
  const handler: ToolActionHandler = {
    type: "web-search",
    readOnly: true,
    description: "Search the web and return compact citation-ready snippets.",
    aliases: [
      "联网搜索",
      "搜索",
      "web_search",
      "web search",
      "search_web",
      "search web",
      "search",
    ],
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query.",
        },
        q: {
          type: "string",
          description: "Alias for query.",
        },
      },
      additionalProperties: true,
    },
    extractQuery(actionInput, rawRecord) {
      const query =
        asStringField(actionInput.query) ||
        asStringField(actionInput.q) ||
        asStringField(rawRecord.query);
      return query.replace(/\s+/g, " ").trim();
    },
    isAvailable() {
      return isWebSearchEnabledPref();
    },
    async execute(query, options) {
      const locale = (Zotero.locale || "en").startsWith("zh") ? "zh" : "en";
      const statusCallback = options.onStatus;
      return runWebSearchQuery(query, {
        locale,
        isCancelled: () => false,
        onStatus: statusCallback || (() => {}),
      });
    },
  };
  registerToolActionHandler(handler);
}

function asStringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}
