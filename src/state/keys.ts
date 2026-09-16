export type Command =
  "undo" | "redo" | "save" | "saveAs" | "open" | "fit" | "zoom100" | "zoomIn" | "zoomOut";

export type KeyLike = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean };

/** New document has no shortcut on purpose: browsers reserve ⌘N / Ctrl+N. */
export function commandForKey(e: KeyLike): Command | null {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod) {
    switch (k) {
      case "z":
        return e.shiftKey ? "redo" : "undo";
      case "y":
        return "redo";
      case "s":
        return e.shiftKey ? "saveAs" : "save";
      case "o":
        return "open";
      case "0":
        return "fit";
      case "1":
        return "zoom100";
    }
  }
  if (k === "=" || k === "+") return "zoomIn";
  if (k === "-" || k === "_") return "zoomOut";
  return null;
}
