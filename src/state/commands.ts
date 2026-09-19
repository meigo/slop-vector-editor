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
  invertSelection,
  moveSelectedNodes,
  nudgeSelection,
  redo,
  selectAll,
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

/** Runs the action and reports whether it was consumed, so the caller knows to `preventDefault`.
 *  Only `commit` can decline: Enter with no busy tool does nothing, and must keep activating the
 *  focused button. */
export function runEditAction(a: EditAction): boolean {
  switch (a.kind) {
    case "tool":
      setTool(a.tool);
      return true;
    case "delete":
      if (!toolTook("backspace")) {
        if (app.toolId === "node" && app.nodeSel.length > 0) deleteSelectedNodes();
        else deleteSelection();
      }
      return true;
    case "duplicate":
      duplicateSelection();
      return true;
    case "clear":
      if (!toolTook("escape")) clearOrLeaveGroup();
      return true;
    case "commit":
      return toolTook("enter");
    case "nudge":
      if (app.toolId === "node" && app.nodeSel.length > 0) moveSelectedNodes(a.dx, a.dy);
      else nudgeSelection(a.dx, a.dy);
      return true;
    case "toggleSnap":
      toggleSnap();
      return true;
    case "zorder":
      switch (a.op) {
        case "forward":
          bringSelectionForward();
          break;
        case "backward":
          sendSelectionBackward();
          break;
        case "front":
          bringSelectionToFront();
          break;
        case "back":
          sendSelectionToBack();
          break;
      }
      return true;
    case "group":
      groupSelection();
      return true;
    case "ungroup":
      ungroupSelection();
      return true;
    case "selectAll":
      selectAll();
      return true;
    case "invertSelection":
      invertSelection();
      return true;
  }
}
