import { createDoc, type Doc, type NodeType, type PathShape, type Style } from "../doc/document";
import {
  convertToPath,
  deleteNodes,
  duplicateNodes,
  flattenTransform,
  setNodeOpacity,
  setPolygon,
  setRectRadius,
  setStyle,
  translateNodes,
  type PolygonPatch,
} from "../doc/edits";
import {
  addLayer,
  bringForward,
  bringToFront,
  deleteLayer,
  layerBlock,
  moveLayer,
  moveNodes,
  renameLayer,
  renameNode,
  resolveLayerId,
  sendBackward,
  sendToBack,
  setLayerLocked,
  setLayerVisible,
} from "../doc/layers";
import { groupNodes, ungroupNodes } from "../doc/group";
import {
  closeSubpath,
  deletePathNodes,
  movePathNodes,
  setNodeType,
  type NodeRef,
} from "../doc/path-edit";
import { ancestorIds, findNode, mapNodes, pruneSelection } from "../doc/tree";
import type { Box } from "../geom/box";
import { latchOn, type Latch } from "../input/dock";
import {
  loadPrefs,
  sanitizePrefs,
  savePrefs,
  type PolygonPrefs,
  type Prefs,
} from "../persist/preferences";
import { readClipboardText, writeClipboardText } from "../persist/system-clipboard";
import type { Overlay } from "../tools/tool";
import type { Mods, ToolId } from "../tools/types";
import { clipboardText, isPasteError, looksLikeSvg, planPaste, type Clip } from "./clipboard";
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
import { fitRect, screenToDoc, zoomAt, type View } from "./viewport";

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
  /** Where new objects go (spec M3a §2). Not saved, not undoable. */
  currentLayerId = $state<string>(resolveLayerId(this.session.doc, null));
  /** The group being worked inside (spec M3b §3). Not saved, not undoable. */
  enteredGroupId = $state<string | null>(null);
  /** The path being node-edited and the nodes selected in it (spec M4a §2). Not saved, not undoable. */
  nodeTarget = $state<string | null>(null);
  nodeSel = $state.raw<readonly NodeRef[]>([]);
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
  /** Tooltip text of whatever the mouse is over, shown in the status bar (spec M2e §4). */
  hoverHint = $state<string | null>(null);

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
  const current = resolveLayerId(s.doc, app.currentLayerId);
  if (current !== app.currentLayerId) app.currentLayerId = current;
  if (app.enteredGroupId !== null) {
    const entered = findNode(s.doc, app.enteredGroupId);
    if (
      !entered ||
      entered.node.kind !== "group" ||
      !entered.layer.visible ||
      entered.layer.locked
    ) {
      app.enteredGroupId = null;
    }
  }
  if (app.nodeTarget !== null) {
    const target = findNode(s.doc, app.nodeTarget);
    const path = target && target.node.kind === "path" ? target.node : null;
    if (!path || !target?.layer.visible || target?.layer.locked) {
      app.nodeTarget = null;
      app.nodeSel = [];
    } else {
      const kept = app.nodeSel.filter((r) => (path.subpaths[r.sub]?.nodes.length ?? 0) > r.i);
      if (kept.length !== app.nodeSel.length) app.nodeSel = kept;
    }
  }
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
  app.currentLayerId = resolveLayerId(doc, null);
  app.enteredGroupId = null;
  app.nodeTarget = null;
  app.nodeSel = [];
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
  // The layer of the last selected object becomes current (spec M3a §2).
  const last = app.selection[app.selection.length - 1];
  const found = last === undefined ? null : findNode(app.doc, last);
  if (found && found.layer.id !== app.currentLayerId) app.currentLayerId = found.layer.id;
}

export function setCurrentLayer(id: string): void {
  app.currentLayerId = resolveLayerId(app.doc, id);
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

// ----- selection actions (keyboard, top bar, context menu) -----

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

export function setSelectionPolygon(patch: PolygonPatch): void {
  cancelActiveGesture();
  commitDoc(setPolygon(app.doc, app.selection, patch));
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

// ----- clipboard (spec M2b §2) -----

/** Our last copy, used to recognise repeated pastes and as the fallback when the system
 *  clipboard can't be read. Nothing renders it, so it isn't reactive. */
let clip: Clip | null = null;

/** The canvas viewport in document coordinates. */
export function visibleDocBox(): Box {
  const { w, h } = app.viewportSize;
  const a = screenToDoc(app.view, { x: 0, y: 0 });
  const b = screenToDoc(app.view, { x: w, y: h });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** Returns the SVG text for the system clipboard, or null when nothing is selected. */
export function copySelection(): string | null {
  cancelActiveGesture();
  const text = clipboardText(app.doc, app.selection);
  if (text !== null) clip = { text, pastes: 0 };
  return text;
}

export function cutSelection(): string | null {
  const text = copySelection();
  if (text !== null) commitDoc(deleteNodes(app.doc, app.selection));
  return text;
}

/** One undo step; selects what was pasted. */
export function pasteText(text: string): void {
  cancelActiveGesture();
  const r = planPaste(app.doc, text, clip, visibleDocBox(), app.currentLayerId);
  if (isPasteError(r)) {
    notify("error", r.error);
    return;
  }
  clip = r.clip;
  commitDoc(r.doc);
  setSelection(r.ids);
  if (r.dropped.length > 0) {
    notify("info", `Some content was not imported: ${r.dropped.join(", ")}`);
  }
}

/** For buttons and menu items. Keyboard paste uses the window `paste` event instead. */
export async function pasteFromClipboard(): Promise<void> {
  cancelActiveGesture();
  const system = await readClipboardText();
  if (system !== null && looksLikeSvg(system)) return pasteText(system);
  if (clip) return pasteText(clip.text);
  if (system !== null) return pasteText(system);
  notify("info", "Nothing to paste.");
}

/** For buttons and menu items: a failed system write is silent — the in-app copy still works. */
export function copyToSystem(): void {
  const text = copySelection();
  if (text !== null) void writeClipboardText(text);
}

export function cutToSystem(): void {
  const text = cutSelection();
  if (text !== null) void writeClipboardText(text);
}

// ----- layers, objects and z-order (spec M3a §4) -----

export function addLayerAboveCurrent(): void {
  cancelActiveGesture();
  const r = addLayer(app.doc, app.currentLayerId);
  commitDoc(r.doc);
  app.currentLayerId = r.id;
}

export async function deleteCurrentLayer(): Promise<void> {
  cancelActiveGesture();
  const layer = app.doc.layers.find((l) => l.id === app.currentLayerId);
  if (!layer || app.doc.layers.length <= 1) return;
  const n = layer.children.length;
  if (n > 0) {
    const what = `${n} ${n === 1 ? "object" : "objects"}`;
    if (!(await askConfirm(`Delete layer “${layer.name}” and its ${what}?`, "Delete"))) return;
  }
  cancelActiveGesture();
  commitDoc(deleteLayer(app.doc, layer.id));
}

export function renameLayerById(id: string, name: string): void {
  cancelActiveGesture();
  commitDoc(renameLayer(app.doc, id, name));
}

export function toggleLayerVisible(id: string): void {
  cancelActiveGesture();
  const layer = app.doc.layers.find((l) => l.id === id);
  if (layer) commitDoc(setLayerVisible(app.doc, id, !layer.visible));
}

export function toggleLayerLocked(id: string): void {
  cancelActiveGesture();
  const layer = app.doc.layers.find((l) => l.id === id);
  if (layer) commitDoc(setLayerLocked(app.doc, id, !layer.locked));
}

export function moveLayerTo(id: string, index: number): void {
  cancelActiveGesture();
  commitDoc(moveLayer(app.doc, id, index));
}

/** The moved objects become the selection (and so their new layer becomes current). */
export function moveNodesTo(ids: readonly string[], parentId: string, index: number): void {
  cancelActiveGesture();
  const layerId = app.doc.layers.some((l) => l.id === parentId)
    ? parentId
    : findNode(app.doc, parentId)?.layer.id;
  if (layerId === undefined || layerBlock(app.doc, layerId)) return;
  const next = moveNodes(app.doc, ids, parentId, index);
  if (next === app.doc) return;
  commitDoc(next);
  setSelection(ids);
}

export function renameNodeById(id: string, name: string): void {
  cancelActiveGesture();
  commitDoc(renameNode(app.doc, id, name));
}

/** A panel row tap: replace the selection, or toggle the row in it. */
export function selectFromPanel(id: string, additive: boolean): void {
  cancelActiveGesture();
  if (!additive) {
    setSelection([id]);
  } else {
    setSelection(
      app.selection.includes(id) ? app.selection.filter((s) => s !== id) : [...app.selection, id],
    );
  }
  app.enteredGroupId = ancestorIds(app.doc, id).at(-1) ?? null;
}

export function bringSelectionForward(): void {
  cancelActiveGesture();
  commitDoc(bringForward(app.doc, app.selection));
}

export function sendSelectionBackward(): void {
  cancelActiveGesture();
  commitDoc(sendBackward(app.doc, app.selection));
}

export function bringSelectionToFront(): void {
  cancelActiveGesture();
  commitDoc(bringToFront(app.doc, app.selection));
}

export function sendSelectionToBack(): void {
  cancelActiveGesture();
  commitDoc(sendToBack(app.doc, app.selection));
}

// ----- groups (spec M3b §3, §4) -----

export function setEnteredGroup(id: string | null): void {
  app.enteredGroupId = id;
}

export function setNodeTarget(id: string | null): void {
  app.nodeTarget = id;
  app.nodeSel = [];
}

export function setNodeSel(refs: readonly NodeRef[]): void {
  app.nodeSel = refs;
}

/** The path being node-edited, or null when there isn't one. */
function targetPath(): PathShape | null {
  if (app.nodeTarget === null) return null;
  const found = findNode(app.doc, app.nodeTarget);
  return found && found.node.kind === "path" ? found.node : null;
}

export function moveSelectedNodes(dx: number, dy: number): void {
  cancelActiveGesture();
  const path = targetPath();
  if (!path || app.nodeSel.length === 0) return;
  commitDoc(mapNodes(app.doc, [path.id], () => movePathNodes(path, app.nodeSel, dx, dy)));
}

export function deleteSelectedNodes(): void {
  cancelActiveGesture();
  const path = targetPath();
  if (!path || app.nodeSel.length === 0) return;
  const next = deletePathNodes(path, app.nodeSel);
  if (next === path) return;
  if (next === null) {
    commitDoc(deleteNodes(app.doc, [path.id]));
    app.nodeTarget = null;
  } else {
    commitDoc(mapNodes(app.doc, [path.id], () => next));
  }
  app.nodeSel = [];
}

export function setSelectedNodeType(type: NodeType): void {
  cancelActiveGesture();
  const path = targetPath();
  if (!path || app.nodeSel.length === 0) return;
  commitDoc(mapNodes(app.doc, [path.id], () => setNodeType(path, app.nodeSel, type)));
}

export function closeTargetSubpath(sub: number): void {
  cancelActiveGesture();
  const path = targetPath();
  if (!path) return;
  commitDoc(mapNodes(app.doc, [path.id], () => closeSubpath(path, sub)));
}

/** Escape: leave the group one level at a time, and only then clear the selection. */
export function clearOrLeaveGroup(): void {
  cancelActiveGesture();
  if (app.toolId === "node" && app.nodeSel.length > 0) {
    app.nodeSel = [];
    return;
  }
  if (app.toolId === "node" && app.nodeTarget !== null) {
    app.nodeTarget = null;
    setTool("select");
    return;
  }
  const entered = app.enteredGroupId;
  if (entered === null) {
    if (app.selection.length > 0) app.selection = [];
    return;
  }
  const above = ancestorIds(app.doc, entered);
  app.enteredGroupId = above.length > 0 ? above[above.length - 1] : null;
  setSelection([entered]);
}

export function groupSelection(): void {
  cancelActiveGesture();
  const r = groupNodes(app.doc, app.selection);
  if (r.id === null) return;
  commitDoc(r.doc);
  setSelection([r.id]);
}

export function ungroupSelection(): void {
  cancelActiveGesture();
  const r = ungroupNodes(app.doc, app.selection);
  if (r.doc === app.doc) return;
  commitDoc(r.doc);
  setSelection(r.ids);
}

export function setSelectionOpacity(value: number): void {
  cancelActiveGesture();
  if (app.selection.length === 0) {
    setPrefs({ ...app.prefs, style: { ...app.prefs.style, opacity: value } });
    return;
  }
  commitDoc(setNodeOpacity(app.doc, app.selection, value));
}
