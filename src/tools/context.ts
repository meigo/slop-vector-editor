import {
  app,
  beginDocGesture,
  commitDoc,
  endDocGesture,
  notify,
  setEnteredGroup,
  setOverlay,
  setSelection,
} from "../state/appState.svelte";
import type { ToolContext } from "./tool";

/** The real ToolContext: tools reach the store only through this object. */
export const storeContext: ToolContext = {
  doc: () => app.doc,
  view: () => app.view,
  selection: () => app.selection,
  currentLayerId: () => app.currentLayerId,
  enteredGroupId: () => app.enteredGroupId,
  setEnteredGroup,
  setSelection,
  commit: commitDoc,
  beginGesture: beginDocGesture,
  endGesture: endDocGesture,
  prefs: () => app.prefs,
  snapEnabled: () => app.prefs.snap,
  notify,
  setOverlay,
};
