/** A thin, never-throwing wrapper around `navigator.clipboard` (spec M2b §2.4). The parameter
 *  exists for tests; the app always uses the browser's clipboard. */
export type ClipboardLike = {
  writeText?: (text: string) => Promise<void>;
  readText?: () => Promise<string>;
};

function browserClipboard(): ClipboardLike | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.clipboard;
}

export async function writeClipboardText(
  text: string,
  clipboard: ClipboardLike | undefined = browserClipboard(),
): Promise<boolean> {
  try {
    if (!clipboard?.writeText) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Null when the clipboard is unavailable, refused (permission) or holds no text. */
export async function readClipboardText(
  clipboard: ClipboardLike | undefined = browserClipboard(),
): Promise<string | null> {
  try {
    if (!clipboard?.readText) return null;
    const text = await clipboard.readText();
    return text ? text : null;
  } catch {
    return null;
  }
}
