import {
  app,
  beginDocGesture,
  commitDoc,
  endDocGesture,
  notify,
  registerToolFinish,
  setEnteredGroup,
  setNodeSel,
  setNodeTarget,
  setOverlay,
  setSelection,
  setTool,
} from "../state/appState.svelte";
import { TOOLS } from "./registry";
import type { ToolContext } from "./tool";

/** The real ToolContext: tools reach the store only through this object. */
export const storeContext: ToolContext = {
  doc: () => app.doc,
  view: () => app.view,
  selection: () => app.selection,
  currentLayerId: () => app.currentLayerId,
  enteredGroupId: () => app.enteredGroupId,
  setEnteredGroup,
  nodeTarget: () => app.nodeTarget,
  setNodeTarget,
  nodeSel: () => app.nodeSel,
  setNodeSel,
  setTool,
  setSelection,
  commit: commitDoc,
  beginGesture: beginDocGesture,
  endGesture: endDocGesture,
  prefs: () => app.prefs,
  snapEnabled: () => app.prefs.snap,
  notify,
  setOverlay,
};

// A tool that still holds a draft finishes when the user picks another tool (spec M4b §3).
registerToolFinish(() => {
  const tool = TOOLS[app.toolId];
  if (tool.busy?.()) tool.keydown?.(storeContext, "enter");
});
