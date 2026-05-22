// Plain text → clipboard. Tries Zotero's internal helper first, then falls
// back to the standard browser API. Returns true if the copy succeeded.
//
// Centralized here so both `section.ts` and `proposalView.ts` can share the
// same fallback chain — annotation proposal errors and tool-event failures
// both need a reliable copy path so users can paste a real error message
// back to us when something goes wrong.
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) {
    return false;
  }
  try {
    Zotero.Utilities.Internal.copyTextToClipboard(value);
    return true;
  } catch {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) {
        return false;
      }
      await globalThis.navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }
}
