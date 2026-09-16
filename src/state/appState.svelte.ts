import { createDoc, type Doc, type Style } from "../doc/document";
import {
  convertToPath,
  deleteNodes,
  duplicateNodes,
  flattenTransform,
  setRectRadius,
  setStyle,
  translateNodes,
} from "../doc/edits";
import { pruneSelection } from "../doc/tree";
import { latchOn, type Latch } from "../input/dock";
import {
  loadPrefs,
  sanitizePrefs,
  savePrefs,
  type PolygonPrefs,
  type Prefs,
} from "../persist/preferences";
import type { Overlay } from "../tools/tool";
import type { Mods, ToolId } from "../tools/types";
import { canRedo, canUndo } from "./history";
import { applyGeometryField, type GeometryField } from "./properties";
import {
  beginGesture,
  commit,
  endGesture,
  isDirty,
  markSaved,
  newSession,
  redoSession,
  undoSession,
  type Session,
} from "./session";
import { fitRect, zoomAt, type View } from "./viewport";

export type Notice = { id: number; kind: "info" | "error"; text: string };
export type DialogKind = "new" | "settings" | null;
export type ConfirmRequest = {
  text: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
};
export type ContextMenuState = { x: number; y: number } | null;
export type DockState = { shift: Latch; alt: Latch };

/** The single app store. Exported as `app`, never `state`, so components that use the `$state`
 *  rune can import it without the `store_rune_conflict` error the sibling apps hit.
 *  Immutable values are `$state.raw`: they are replaced, never mutated, and raw keeps reference
 *  equality intact for the dirty check and for selection pruning. */
class AppState {
  session = $state.raw<Session>(newSession(createDoc(1920, 1080), true));
  fileName = $state("Untitled.svg");
  view = $state.raw<View>({ x: 0, y: 0, zoom: 1 });
  viewportSize = $state.raw({ w: 0, h: 0 });
  /** Bumped to ask the canvas to fit the artboard (on load and on document replace). */
  fitNonce = $state(0);
  notices = $state.raw<Notice[]>([]);
  dialog = $state<DialogKind>(null);
  confirm = $state.raw<ConfirmRequest | null>(null);
  /** Where Save writes without asking. Not reactive: nothing renders from it. */
  fileHandle: FileSystemFileHandle | null = null;

  /** Top-level node ids; not part of undo history. */
  selection = $state.raw<readonly string[]>([]);
  toolId = $state<ToolId>("select");
  prefs = $state.raw<Prefs>(loadPrefs());
  dock = $state.raw<DockState>({ shift: "off", alt: "off" });
  spaceHeld = $state(false);
  overlay = $state.raw<Overlay>(null);
  contextMenu = $state.raw<ContextMenuState>(null);
  /** The properties drawer on narrow screens. */
  propertiesOpen = $state(false);
  /** Last pointer type on the canvas; handle sizes follow it. */
  lastPointerType = $state("mouse");

  get doc(): Doc {
    return this.session.doc;
  }
  get dirty(): boolean {
    return isDirty(this.session);
  }
  get canUndo(): boolean {
    return canUndo(this.session.history);
  }
  get canRedo(): boolean {
    return canRedo(this.session.history);
  }
}

export const app = new AppState();

/** Set by the canvas while a tool gesture is running; any outside edit cancels the drag first. */
let gestureCancel: (() => void) | null = null;

export function registerGestureCancel(fn: (() => void) | null): void {
  gestureCancel = fn;
}

export function cancelActiveGesture(): void {
  const fn = gestureCancel;
  gestureCancel = null;
  fn?.();
}

/** Every session change goes through here, so the selection never names a node that is gone,
 *  hidden or locked. */
function setSession(s: Session): void {
  app.session = s;
  const pruned = pruneSelection(s.doc, app.selection);
  if (pruned !== app.selection) app.selection = pruned;
}

export function commitDoc(next: Doc): void {
  setSession(commit(app.session, next));
}

export function beginDocGesture(): void {
  setSession(beginGesture(app.session));
}

export function endDocGesture(): void {
  setSession(endGesture(app.session));
}

export function undo(): void {
  cancelActiveGesture();
  setSession(undoSession(app.session));
}

export function redo(): void {
  cancelActiveGesture();
  setSession(redoSession(app.session));
}

export function replaceDocument(
  doc: Doc,
  fileName: string,
  handle: FileSystemFileHandle | null,
  saved: boolean,
): void {
  cancelActiveGesture();
  app.selection = [];
  app.overlay = null;
  setSession(newSession(doc, saved));
  app.fileName = fileName;
  app.fileHandle = handle;
  app.fitNonce++;
}

export function markDocSaved(
  doc: Doc,
  fileName: string,
  handle: FileSystemFileHandle | null,
): void {
  setSession(markSaved(app.session, doc));
  app.fileName = fileName;
  app.fileHandle = handle;
}

export function setView(v: View): void {
  app.view = v;
}

export function setViewportSize(w: number, h: number): void {
  if (app.viewportSize.w !== w || app.viewportSize.h !== h) app.viewportSize = { w, h };
}

export function fitArtboard(): void {
  const { w, h } = app.viewportSize;
  if (w <= 0 || h <= 0) return;
  const ab = app.doc.artboard;
  app.view = fitRect({ x: 0, y: 0, w: ab.w, h: ab.h }, w, h);
}

export function zoomBy(factor: number): void {
  const { w, h } = app.viewportSize;
  app.view = zoomAt(app.view, { x: w / 2, y: h / 2 }, factor);
}

export function zoomTo(zoom: number): void {
  zoomBy(zoom / app.view.zoom);
}

let noticeSeq = 0;

export function notify(kind: Notice["kind"], text: string): void {
  const id = ++noticeSeq;
  app.notices = [...app.notices, { id, kind, text }];
  // Errors stay until dismissed; info fades on its own.
  if (kind === "info") setTimeout(() => dismissNotice(id), 6000);
}

export function dismissNotice(id: number): void {
  app.notices = app.notices.filter((n) => n.id !== id);
}

/** In-app replacement for window.confirm (native dialogs block the page and browser automation). */
export function askConfirm(text: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    app.confirm = {
      text,
      confirmLabel,
      resolve: (ok) => {
        app.confirm = null;
        resolve(ok);
      },
    };
  });
}

// ----- selection, tools, preferences -----

export function setSelection(ids: readonly string[]): void {
  app.selection = pruneSelection(app.doc, ids);
}

export function clearSelection(): void {
  cancelActiveGesture();
  if (app.selection.length > 0) app.selection = [];
}

export function setTool(id: ToolId): void {
  if (app.toolId === id) return;
  app.toolId = id;
  app.overlay = null;
}

export function setOverlay(o: Overlay): void {
  app.overlay = o;
}

export function setDock(key: keyof DockState, latch: Latch): void {
  app.dock = { ...app.dock, [key]: latch };
}

export function dockMods(): Mods {
  return { shift: latchOn(app.dock.shift), alt: latchOn(app.dock.alt) };
}

export function setPrefs(p: Prefs): void {
  const clean = sanitizePrefs(p);
  app.prefs = clean;
  savePrefs(clean);
}

export function setPolygonPrefs(patch: Partial<PolygonPrefs>): void {
  setPrefs({ ...app.prefs, polygon: { ...app.prefs.polygon, ...patch } });
}

export function toggleSnap(): void {
  setPrefs({ ...app.prefs, snap: !app.prefs.snap });
}

// ----- selection actions (keyboard, context bar, context menu) -----

export function deleteSelection(): void {
  cancelActiveGesture();
  if (app.selection.length > 0) commitDoc(deleteNodes(app.doc, app.selection));
}

export function duplicateSelection(): void {
  cancelActiveGesture();
  const r = duplicateNodes(app.doc, app.selection, 10, 10);
  if (r.ids.length === 0) return;
  commitDoc(r.doc);
  setSelection(r.ids);
}

export function nudgeSelection(dx: number, dy: number): void {
  cancelActiveGesture();
  if (app.selection.length > 0) commitDoc(translateNodes(app.doc, app.selection, dx, dy));
}

export function convertSelectionToPath(): void {
  cancelActiveGesture();
  commitDoc(convertToPath(app.doc, app.selection));
}

export function flattenSelection(): void {
  cancelActiveGesture();
  commitDoc(flattenTransform(app.doc, app.selection));
}

export function setSelectionRectRadius(rx: number): void {
  cancelActiveGesture();
  commitDoc(setRectRadius(app.doc, app.selection, rx));
}

/** With nothing selected, style edits change the defaults for new shapes instead. */
export function setSelectionStyle(patch: Partial<Style>): void {
  cancelActiveGesture();
  if (app.selection.length === 0) {
    setPrefs({ ...app.prefs, style: { ...app.prefs.style, ...patch } });
    return;
  }
  commitDoc(setStyle(app.doc, app.selection, patch));
}

export function applyGeometry(field: GeometryField, value: number): void {
  cancelActiveGesture();
  commitDoc(applyGeometryField(app.doc, app.selection, field, value));
}
