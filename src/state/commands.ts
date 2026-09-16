import { openDocument, saveDocument } from "../persist/project-io";
import {
  clearSelection,
  deleteSelection,
  duplicateSelection,
  fitArtboard,
  nudgeSelection,
  redo,
  setTool,
  undo,
  zoomBy,
  zoomTo,
} from "./appState.svelte";
import type { Command, EditAction } from "./keys";

export const ZOOM_STEP = 1.25;

/** One place that maps a command to its action, shared by keyboard and buttons. */
export function runCommand(cmd: Command): void {
  switch (cmd) {
    case "undo":
      return undo();
    case "redo":
      return redo();
    case "save":
      void saveDocument(false);
      return;
    case "saveAs":
      void saveDocument(true);
      return;
    case "open":
      void openDocument();
      return;
    case "fit":
      return fitArtboard();
    case "zoom100":
      return zoomTo(1);
    case "zoomIn":
      return zoomBy(ZOOM_STEP);
    case "zoomOut":
      return zoomBy(1 / ZOOM_STEP);
  }
}

export function runEditAction(a: EditAction): void {
  switch (a.kind) {
    case "tool":
      return setTool(a.tool);
    case "delete":
      return deleteSelection();
    case "duplicate":
      return duplicateSelection();
    case "clear":
      return clearSelection();
    case "nudge":
      return nudgeSelection(a.dx, a.dy);
  }
}
