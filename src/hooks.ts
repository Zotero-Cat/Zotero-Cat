import {
  registerAgentSection,
  unregisterAgentSection,
  refreshAgentSections,
} from "./modules/agent/section";
import { rememberReaderSelectedText } from "./modules/agent/context";
import { registerWebSearchToolHandler } from "./modules/agent/webSearchContext";
import {
  registerAnnotationReadTools,
  registerAnnotationWriteStubs,
} from "./modules/tools/annotationTools";
import { clearAllBatches } from "./modules/tools/annotationProposals";
import { clearPdfReaderCache } from "./modules/tools/pdfReader";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { registerPrefsPane } from "./modules/prefsPane";
import { initLocale } from "./utils/locale";

const onReaderSelectionPopup: _ZoteroTypes.Reader.EventHandler<
  "renderTextSelectionPopup"
> = ({ reader, params }) => {
  const text = params.annotation?.text || "";
  if (!text.trim()) {
    return;
  }
  rememberReaderSelectedText(text, reader._item || null);
  void refreshAgentSections();
};

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );
  registerPrefsPane();
  registerWebSearchToolHandler();
  registerAnnotationReadTools();
  registerAnnotationWriteStubs();
  const sectionID = registerAgentSection();
  if (!sectionID) {
    Zotero.log(
      `[${addon.data.config.addonName}] Failed to register item pane section.`,
      "error",
    );
  }
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    onReaderSelectionPopup,
    addon.data.config.addonID,
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );
  ensureMainWindowStyle(win);
}

async function onMainWindowUnload(_win: Window): Promise<void> {}

function onShutdown(): void {
  unregisterAgentSection();
  Zotero.Reader.unregisterEventListener(
    "renderTextSelectionPopup",
    onReaderSelectionPopup,
  );
  clearAllBatches();
  clearPdfReaderCache();
  ztoolkit.unregisterAll();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this funcion clear.
 */
async function onNotify(
  _event: string,
  _type: string,
  _ids: Array<string | number>,
  _extraData: { [key: string]: any },
) {}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

function onShortcuts(_type: string) {}

function onDialogEvents(_type: string) {}

function ensureMainWindowStyle(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  const styleID = `${addon.data.config.addonRef}-style`;
  if (doc.getElementById(styleID)) {
    return;
  }
  const style = ztoolkit.UI.createElement(doc, "link", {
    namespace: "html",
    properties: {
      id: styleID,
      type: "text/css",
      rel: "stylesheet",
      href: `chrome://${addon.data.config.addonRef}/content/zoteroPane.css`,
    },
  });
  doc.documentElement?.appendChild(style);
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
