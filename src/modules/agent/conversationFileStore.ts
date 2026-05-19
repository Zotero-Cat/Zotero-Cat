import { clearPref, getPref } from "../../utils/prefs";
import {
  CONVERSATION_STORE_VERSION,
  buildActiveConversationStore,
  parseConversationStorePayload,
  selectConversationsForPersistence,
  serializeConversation,
  type ConversationState,
  type ParsedConversationStore,
} from "./conversationStore";

const STORE_DIRECTORY_NAME = "zotero-cat";
const STORE_FILE_NAME = "agent-conversations.json";

export interface ConversationFileStoreInput {
  conversations: Iterable<ConversationState>;
  activeConversationKeyByScope: Map<string, string>;
  conversationsByKey: Map<string, ConversationState>;
}

export async function loadConversationFileStore(): Promise<ParsedConversationStore> {
  const fileStore = await readConversationStoreFile();
  if (fileStore.conversations.length || Object.keys(fileStore.active).length) {
    return fileStore;
  }
  const prefStore = parseConversationStorePayload(
    getPref("agentConversationStore"),
  );
  if (prefStore.conversations.length || Object.keys(prefStore.active).length) {
    return prefStore;
  }
  return fileStore;
}

export async function saveConversationFileStore(
  input: ConversationFileStoreInput,
): Promise<void> {
  const conversations = selectConversationsForPersistence(
    [...input.conversations].filter(
      (conversation) => conversation.messages.length > 0,
    ),
  ).map(serializeConversation);
  const active = buildActiveConversationStore(
    input.activeConversationKeyByScope,
    input.conversationsByKey,
  );
  const payload = {
    version: CONVERSATION_STORE_VERSION,
    active,
    conversations,
  };
  const path = await getConversationStorePath();
  await ensureConversationStoreDirectory();
  await Zotero.File.putContentsAsync(path, JSON.stringify(payload));
  clearPref("agentConversationStore");
}

export async function getConversationStorePath(): Promise<string> {
  return resolvePathUtils().join(
    getConversationStoreDirectory(),
    STORE_FILE_NAME,
  );
}

async function readConversationStoreFile(): Promise<ParsedConversationStore> {
  try {
    const path = await getConversationStorePath();
    const raw = await readTextFileIfExists(path);
    if (raw === null) {
      return { active: {}, conversations: [] };
    }
    return parseConversationStorePayload(raw);
  } catch (error) {
    try {
      (Zotero as unknown as { logError?: (e: unknown) => void }).logError?.(
        error,
      );
    } catch {
      // ignore logging failures
    }
    return { active: {}, conversations: [] };
  }
}

async function ensureConversationStoreDirectory(): Promise<void> {
  const dir = getConversationStoreDirectory();
  const ioUtils = resolveIOUtils();
  if (ioUtils?.makeDirectory) {
    await ioUtils.makeDirectory(dir, { ignoreExisting: true });
    return;
  }
  await Zotero.File.createDirectoryIfMissingAsync(dir);
}

function getConversationStoreDirectory(): string {
  const dataDirectory = (
    Zotero as unknown as {
      DataDirectory?: { dir?: string };
    }
  ).DataDirectory?.dir;
  const pathUtils = resolvePathUtils();
  const base = (dataDirectory || pathUtils.profileDir || "").trim();
  return pathUtils.join(base, STORE_DIRECTORY_NAME);
}

async function readTextFileIfExists(path: string): Promise<string | null> {
  const ioUtils = resolveIOUtils();
  if (ioUtils?.exists && !(await ioUtils.exists(path))) {
    return null;
  }
  if (ioUtils?.readUTF8) {
    return ioUtils.readUTF8(path);
  }
  const zFile = Zotero.File as _ZoteroTypes.File | undefined;
  if (!zFile?.getContentsAsync) {
    return null;
  }
  const content = await zFile.getContentsAsync(path, "utf-8");
  if (typeof content === "string") {
    return content;
  }
  if (content instanceof Uint8Array) {
    return new TextDecoder().decode(content);
  }
  return null;
}

interface IOUtilsLike {
  exists?: (path: string) => Promise<boolean>;
  readUTF8?: (path: string) => Promise<string>;
  makeDirectory?: (
    path: string,
    options?: { ignoreExisting?: boolean },
  ) => Promise<void>;
}

interface PathUtilsLike {
  profileDir?: string;
  join: (...parts: string[]) => string;
}

function resolveIOUtils(): IOUtilsLike | null {
  const fromGlobal = (globalThis as unknown as { IOUtils?: IOUtilsLike })
    .IOUtils;
  if (fromGlobal) {
    return fromGlobal;
  }
  const fromZoteroWindow = (
    Zotero as unknown as { getMainWindow?: () => { IOUtils?: IOUtilsLike } }
  ).getMainWindow?.();
  return fromZoteroWindow?.IOUtils || null;
}

function resolvePathUtils(): PathUtilsLike {
  const fromGlobal = (globalThis as unknown as { PathUtils?: PathUtilsLike })
    .PathUtils;
  if (fromGlobal) {
    return fromGlobal;
  }
  const fromZoteroWindow = (
    Zotero as unknown as {
      getMainWindow?: () => { PathUtils?: PathUtilsLike };
    }
  ).getMainWindow?.();
  if (fromZoteroWindow?.PathUtils) {
    return fromZoteroWindow.PathUtils;
  }
  return {
    profileDir: "",
    join(...parts: string[]) {
      return parts.filter(Boolean).join("/");
    },
  };
}
