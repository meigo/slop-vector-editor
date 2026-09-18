import { openDocument, saveDocument } from "../persist/project-io";
import { storeContext } from "../tools/context";
import { TOOLS } from "../tools/registry";
import {
  app,
  bringSelectionForward,
  bringSelectionToFront,
  clearOrLeaveGroup,
  deleteSelectedNodes,
  deleteSelection,
  duplicateSelection,
  fitArtboard,
  groupSelection,
  moveSelectedNodes,
  nudgeSelection,
  redo,
  sendSelectionBackward,
  sendSelectionToBack,
  setTool,
  toggleSnap,
  undo,
  ungroupSelection,
  zoomBy,
  zoomTo,
} from "./appState.svelte";
import type { Command, EditAction } from "./keys";

export const ZOOM_STEP = 1.25;

/** Keys the active tool may consume while it has a gesture or draft in progress (spec M4b §8). */
function toolTook(key: "escape" | "enter" | "backspace"): boolean {
  const tool = TOOLS[app.toolId];
  return tool.busy?.() === true && tool.keydown?.(storeContext, key) === true;
}

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
      if (toolTook("backspace")) return;
      return app.toolId === "node" && app.nodeSel.length > 0
        ? deleteSelectedNodes()
        : deleteSelection();
    case "duplicate":
      return duplicateSelection();
    case "clear":
      return toolTook("escape") ? undefined : clearOrLeaveGroup();
    case "commit":
      toolTook("enter");
      return;
    case "nudge":
      return app.toolId === "node" && app.nodeSel.length > 0
        ? moveSelectedNodes(a.dx, a.dy)
        : nudgeSelection(a.dx, a.dy);
    case "toggleSnap":
      return toggleSnap();
    case "zorder":
      switch (a.op) {
        case "forward":
          return bringSelectionForward();
        case "backward":
          return sendSelectionBackward();
        case "front":
          return bringSelectionToFront();
        case "back":
          return sendSelectionToBack();
      }
      return;
    case "group":
      return groupSelection();
    case "ungroup":
      return ungroupSelection();
  }
}
