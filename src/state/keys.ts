import type { ToolId } from "../tools/types";

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

export type EditAction =
  | { kind: "tool"; tool: ToolId }
  | { kind: "delete" }
  | { kind: "duplicate" }
  | { kind: "clear" }
  | { kind: "nudge"; dx: number; dy: number }
  | { kind: "toggleSnap" };

const TOOL_KEYS: Readonly<Record<string, ToolId>> = {
  v: "select",
  r: "rect",
  e: "ellipse",
  l: "line",
  y: "polygon",
  h: "hand",
};

/** Editing keys. Checked after `commandForKey`, and never while a text field has focus. */
export function editActionForKey(e: KeyLike): EditAction | null {
  const k = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) return k === "d" ? { kind: "duplicate" } : null;
  if (e.key === "%") return { kind: "toggleSnap" };
  if (k === "delete" || k === "backspace") return { kind: "delete" };
  if (k === "escape") return { kind: "clear" };
  const step = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case "ArrowLeft":
      return { kind: "nudge", dx: -step, dy: 0 };
    case "ArrowRight":
      return { kind: "nudge", dx: step, dy: 0 };
    case "ArrowUp":
      return { kind: "nudge", dx: 0, dy: -step };
    case "ArrowDown":
      return { kind: "nudge", dx: 0, dy: step };
  }
  const tool = e.shiftKey ? undefined : TOOL_KEYS[k];
  return tool ? { kind: "tool", tool } : null;
}
