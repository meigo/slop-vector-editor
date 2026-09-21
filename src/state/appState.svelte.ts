import { booleanShapes, type BoolOutcome } from "../doc/boolean-edit";
import {
  createDoc,
  isHidden,
  isLocked,
  type Doc,
  type NodeType,
  type PathShape,
  type Style,
  type TextMeta,
} from "../doc/document";
import {
  addShape,
  convertToPath,
  deleteNodes,
  duplicateNodes,
  flattenTransform,
  setNodeHidden,
  setNodeLocked,
  setNodeOpacity,
  setPolygon,
  setRectRadius,
  setStyle,
  translateNodes,
  type PolygonPatch,
} from "../doc/edits";
import {
  addLayer,
  blockMessage,
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
import {
  combine,
  breakApart,
  pathOpRefusal,
  reverseSelection,
  subdivideSelection,
  PATH_LABEL,
} from "../doc/path-ops";
import { simplifyShapes, type SimplifyOutcome } from "../doc/simplify-edit";
import { allIds, invertIds, sameIds, type MatchField } from "../doc/select-match";
import { filterToSelection } from "../doc/subset";
import { ancestorIds, findNode, mapNodes, pruneSelection } from "../doc/tree";
import { BOOL_LABEL, BOOL_REASON, type BoolOp } from "../geom/boolean";
import type { Box } from "../geom/box";
import type { Vec } from "../geom/vec";
import type { CharOverride } from "../text/attrs";
import { applyMat, invert as invertMat, multiply as multiplyMat } from "../geom/mat";
import { latchOn, type Latch } from "../input/dock";
import { clearedOverride, propsOpen } from "../lib/split";
import { BUNDLED } from "../text/fonts";
import { newSeed } from "../text/random";
import { serializeDoc } from "../svg/serialize";
import {
  loadFont,
  charQuads,
  outlineText,
  FontUnavailableError,
  noGlyphsFor,
  registerFontFile,
  setFontRegistryListener,
  unshapedScript,
  Woff2Error,
  type LoadedFont,
} from "../text/font";
import {
  loadPrefs,
  sanitizePrefs,
  savePrefs,
  type PolygonPrefs,
  type Prefs,
  type SectionId,
} from "../persist/preferences";
import type { DeliverResult } from "../persist/deliver";
import { errorMessage } from "../persist/errors";
import { downloadBlob, writePngFile } from "../persist/file-io";
import { rasterise, writeClipboardPng } from "../persist/png";
import { shareFile } from "../persist/share";
import { readClipboardText, writeClipboardText } from "../persist/system-clipboard";
import type { Overlay } from "../tools/tool";
import type { Mods, ToolId } from "../tools/types";
import { clipboardText, isPasteError, looksLikeSvg, planPaste, type Clip } from "./clipboard";
import { canRedo, canUndo } from "./history";
import { droppedTitle } from "../doc/resize";
import {
  exportBox,
  exportRefusal,
  exportSize,
  pngFileName,
  type ExportRegion,
} from "./export-plan";
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
export type DialogKind = "new" | "settings" | "export" | null;
export type ConfirmRequest = {
  text: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
};
/** A built file waiting for a fresh tap to open the share sheet (spec M13 §5). Carries a payload,
 *  so it follows `ConfirmRequest`'s shape rather than the `DialogKind` enum. */
export type ShareReadyRequest = {
  file: File;
  /** A document save rather than an export: only a document retires the dirty marker. */
  isDoc: boolean;
  /** Extra context for the notice, e.g. a PNG's pixel size. */
  note: string;
  /** The browser's own message when a direct share failed outright; empty for an expired tap. */
  error: string;
  /** The document the file was built from, so a later share marks exactly it saved. */
  doc: Doc | null;
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
  shareReady = $state.raw<ShareReadyRequest | null>(null);
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
  /** The Properties panel's collapse, when the user has overridden what the selection implies
   *  (spec M8 §5). Not saved and not undoable: a decision made with nothing selected does not
   *  survive selecting something. */
  propsOverride = $state<boolean | null>(null);
  /** The character of the selected title being tweaked (spec M10 §6), and the quads a click is
   *  tested against. Store state like `nodeSel`: not saved, not undoable, cleared with the
   *  selection. The quads are cached because computing them needs the font, which is an async
   *  lazy-chunk load, and a tool's `down` is synchronous. */
  charSel = $state<number | null>(null);
  charQuads = $state.raw<Vec[][]>([]);
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

/** Set once by `tools/context.ts`: drops the active tool's draft without committing it (spec M4b
 *  §2). A draft is not a registered gesture, so `cancelActiveGesture` deliberately doesn't reach
 *  it; only the three store paths that replace the whole document do. */
let toolDiscard: (() => void) | null = null;

export function registerToolDiscard(fn: (() => void) | null): void {
  toolDiscard = fn;
}

/** A draft is built on a document that these paths throw away, so it can't be committed after. */
function discardToolDraft(): void {
  toolDiscard?.();
}

/** Keeps the Properties panel's override tied to the selection state it was made in (spec M8 §5).
 *  Called from every path that assigns `app.selection`, never from an effect.
 *
 *  The comparison is deferred to a microtask, and only the first `wasEmpty` of a tick is kept, so
 *  one user action is judged by its net effect. Unite and Ungroup both delete every selected id and
 *  select the result on the next statement: seen per assignment, that is a flip to empty and back,
 *  which would throw away a collapse the user had just asked for. */
let pendingWasEmpty: boolean | null = null;

/** A character selection belongs to one title; any change of selection ends it. */
function clearCharSel(): void {
  if (app.charSel !== null) app.charSel = null;
}

function syncPropsOverride(wasEmpty: boolean): void {
  if (pendingWasEmpty !== null) return;
  pendingWasEmpty = wasEmpty;
  queueMicrotask(() => {
    const was = pendingWasEmpty ?? false;
    pendingWasEmpty = null;
    const next = clearedOverride(app.propsOverride, was, app.selection.length === 0);
    if (next !== app.propsOverride) app.propsOverride = next;
  });
}

/** Every session change goes through here, so the selection never names a node that is gone,
 *  hidden or locked. */
function setSession(s: Session): void {
  const wasEmpty = app.selection.length === 0;
  app.session = s;
  const pruned = pruneSelection(s.doc, app.selection);
  if (pruned !== app.selection) app.selection = pruned;
  syncPropsOverride(wasEmpty);
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
  if (!canUndo(app.session.history)) return;
  discardToolDraft();
  setSession(undoSession(app.session));
}

export function redo(): void {
  cancelActiveGesture();
  if (!canRedo(app.session.history)) return;
  discardToolDraft();
  setSession(redoSession(app.session));
}

export function replaceDocument(
  doc: Doc,
  fileName: string,
  handle: FileSystemFileHandle | null,
  saved: boolean,
): void {
  cancelActiveGesture();
  discardToolDraft();
  app.selection = [];
  app.propsOverride = null;
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

/** Map a `deliverFile` result onto notices, the dirty marker and the fresh-tap dialog.
 *
 *  **A completed sheet clears the dirty marker, and the wording never says "Saved"** (spec M13 §6).
 *  The sheet completing does not prove the file reached Files — AirDrop, Messages and Copy complete
 *  it too, and iPadOS reports nothing about which. Treating it as saved is the lesser evil: the
 *  alternative is a dirty dot that no action on iPad can ever clear, which teaches people to ignore
 *  it and never retires the autosave warning either. The honest wording is the price of that, and
 *  it is not optional. */
export function reportDelivery(
  result: DeliverResult,
  { file, isDoc, note, doc }: { file: File; isDoc: boolean; note: string; doc: Doc | null },
): void {
  const tail = note ? ` — ${note}` : "";
  switch (result.kind) {
    case "shared":
      if (isDoc && doc) markDocSaved(doc, file.name, null);
      notify("info", `Sent ${file.name} to the share sheet${tail}`);
      return;
    case "downloaded":
      if (isDoc && doc) markDocSaved(doc, file.name, null);
      notify("info", `Downloaded ${file.name}${tail}`);
      return;
    case "dismissed":
      // Closing the sheet is a choice, not a failure, and nothing was saved.
      notify("info", `${file.name} was not saved — the share sheet was closed.`);
      return;
    case "ready":
      app.shareReady = { file, isDoc, note, error: result.error, doc };
      return;
  }
}

/** The dialog's Save to Files… button. THIS tap is the fresh activation the direct attempt
 *  lacked, so `shareFile` must be called before anything awaits (spec M13 §4). */
export async function shareReadyRetry(): Promise<void> {
  const r = app.shareReady;
  if (!r) return;
  const out = await shareFile(r.file);
  if (out.outcome === "shared") {
    app.shareReady = null;
    reportDelivery({ kind: "shared" }, r);
    return;
  }
  app.shareReady = {
    ...r,
    error:
      out.outcome === "dismissed"
        ? ""
        : out.outcome === "needs-tap"
          ? "The browser refused to open the share sheet."
          : errorMessage(out.error),
  };
}

export function shareReadyDownload(): void {
  const r = app.shareReady;
  if (!r) return;
  app.shareReady = null;
  downloadBlob(r.file, r.file.name);
  reportDelivery({ kind: "downloaded" }, r);
}

export function shareReadyCancel(): void {
  app.shareReady = null;
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
  const wasEmpty = app.selection.length === 0;
  const before = app.selection;
  app.selection = pruneSelection(app.doc, ids);
  if (app.selection !== before) clearCharSel();
  syncPropsOverride(wasEmpty);
  // The layer of the last selected object becomes current (spec M3a §2).
  const last = app.selection[app.selection.length - 1];
  const found = last === undefined ? null : findNode(app.doc, last);
  if (found && found.layer.id !== app.currentLayerId) app.currentLayerId = found.layer.id;
}

export function setCurrentLayer(id: string): void {
  app.currentLayerId = resolveLayerId(app.doc, id);
}

/** Set once by `tools/context.ts`: finishes a tool that still holds a draft (spec M4b §3). The
 *  store can't import the registry itself without a cycle through the tool context. */
let finishActiveTool: (() => void) | null = null;

export function registerToolFinish(fn: (() => void) | null): void {
  finishActiveTool = fn;
}

export function setTool(id: ToolId): void {
  if (app.toolId === id) return;
  finishActiveTool?.();
  app.toolId = id;
  app.overlay = null;
}

export function setOverlay(o: Overlay): void {
  app.overlay = o;
}

export function setDock(key: keyof DockState, latch: Latch): void {
  app.dock = { ...app.dock, [key]: latch };
}

/** The dock's own contribution. Everything it turns on is latched by definition — `Canvas.svelte`
 *  combines this with the physical keys and decides `shiftLatched` from both. */
export function dockMods(): Mods {
  return {
    shift: latchOn(app.dock.shift),
    alt: latchOn(app.dock.alt),
    shiftLatched: latchOn(app.dock.shift),
  };
}

/** A properties-panel section's collapse (spec M10e §1). Prefs, not session state: it is a view
 *  preference, not document data, so it is neither saved in the file nor undoable. */
export function toggleSection(id: SectionId): void {
  const closed = app.prefs.closedSections;
  setPrefs({
    ...app.prefs,
    closedSections: closed.includes(id) ? closed.filter((s) => s !== id) : [...closed, id],
  });
}

export function setPrefs(p: Prefs): void {
  const clean = sanitizePrefs(p);
  app.prefs = clean;
  savePrefs(clean);
}

/** The Properties panel's header chevron (spec M8 §5). It records the opposite of what is showing,
 *  and every path that assigns the selection drops it again when the selection's emptiness flips.
 *  Unlike `prefs.dockExpanded`, this never returns to `null` by toggling: "undecided" is the state
 *  the selection puts it in, not one the user can ask for, and the two agree in every case a click
 *  can reach (`propsOpen(false, false) === propsOpen(null, false)`). */
export function togglePropsPanel(): void {
  app.propsOverride = !propsOpen(app.propsOverride, app.selection.length > 0);
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
  const before = app.doc;
  const next = applyGeometryField(before, app.selection, field, value);
  commitDoc(next);
  // W and H change one axis, so they are non-uniform by construction and always cost a title its
  // text (spec M10e §7). Worth saying out loud here more than anywhere: unlike a corner drag,
  // there is no proportional way to do this from the geometry fields.
  if (droppedTitle(before, next, app.selection)) {
    notify("info", "Resizing one axis made the text no longer editable — undo to keep it.");
  }
}

/** One operation at a time. Every operation is async, even with paper already loaded, so two quick
 *  clicks would otherwise overlap and the second would see the first's commit as "the document
 *  changed while it loaded" — a misleading notice about the user's own click. */
let booleanRunning = false;

/** Spec (M7) §4, §7. One operation is one commit and one undo step; a refusal, an empty result or a
 *  failed load says so and leaves the document alone. */
export async function booleanSelection(op: BoolOp): Promise<void> {
  if (booleanRunning) return;
  booleanRunning = true;
  try {
    cancelActiveGesture();
    // The first operation of a session waits for paper to download, and nothing blocks the rest of
    // the UI meanwhile. The result is computed from the document and selection as they were before
    // that wait, so committing it blindly would overwrite anything the user did during it — an
    // undo, a delete, a finished drag — with a document that never saw it (invariant 15's hazard,
    // across an await).
    const before = app.doc;
    const sel = app.selection;
    let out: BoolOutcome;
    try {
      out = await booleanShapes(before, sel, op);
    } catch {
      // Paper is fetched on first use, so the realistic failure here is the network, not the
      // geometry: a dropped connection, or a tab whose build's chunk a deploy has replaced. An
      // error notice stays until dismissed — an info one would fade on a failure with no other
      // sign — and the loader cached nothing, so trying again re-fetches (spec M7 §7).
      notify(
        "error",
        // Reload, not "try again": a module fetch that failed is recorded in the browser's module
        // map, so every later import of the same chunk fails without asking the network again.
        // Clearing our own cache is necessary but cannot undo that.
        `${BOOL_LABEL[op]} — the operation could not load. Check your connection, then reload the page.`,
      );
      return;
    }
    cancelActiveGesture();
    if (app.doc !== before) {
      notify("info", `${BOOL_LABEL[op]} — the document changed while it loaded; try again.`);
      return;
    }
    if (out.kind === "refused") {
      notify("info", `${BOOL_LABEL[op]} — ${BOOL_REASON[out.why]}`);
      return;
    }
    if (out.kind === "empty") {
      notify("info", `${BOOL_LABEL[op]} left nothing.`);
      return;
    }
    // Selecting something else during the wait changes no document, so the edit still lands — it
    // was asked for — but the selection is the user's newer intent and is left alone. Checked
    // before the commit, which prunes the old ids away and replaces the array either way.
    const keepResult = app.selection === sel;
    commitDoc(out.doc);
    if (keepResult) setSelection([out.id]);
  } finally {
    booleanRunning = false;
  }
}

/** Spec (M11) §5. */
export function subdivideSelectionNodes(): void {
  cancelActiveGesture();
  const why = pathOpRefusal(app.doc, app.selection, "subdivide");
  if (why) return notify("info", `${PATH_LABEL.subdivide} — ${why}`);
  commitDoc(subdivideSelection(app.doc, app.selection));
  // Subdivide renumbers every subpath's nodes (i → 2i), so a stale node selection would land on
  // different nodes rather than being dropped — setSession's pruning only checks the index is in
  // range, not that it still names the same node.
  setNodeSel([]);
}

/** Spec (M11) §4. */
export function reverseSelectionDirection(): void {
  cancelActiveGesture();
  const why = pathOpRefusal(app.doc, app.selection, "reverse");
  if (why) return notify("info", `${PATH_LABEL.reverse} — ${why}`);
  commitDoc(reverseSelection(app.doc, app.selection));
  // Reverse inverts each subpath's node order, so a stale node selection would land on different
  // nodes rather than being dropped — setSession's pruning only checks the index is in range, not
  // that it still names the same node.
  setNodeSel([]);
}

/** Spec (M11) §3. */
export function breakApartSelection(): void {
  cancelActiveGesture();
  const why = pathOpRefusal(app.doc, app.selection, "breakApart");
  if (why) return notify("info", `${PATH_LABEL.breakApart} — ${why}`);
  const out = breakApart(app.doc, app.selection);
  commitDoc(out.doc);
  setSelection(out.ids);
}

/** Spec (M11) §3. */
export function combineSelection(): void {
  cancelActiveGesture();
  const why = pathOpRefusal(app.doc, app.selection, "combine");
  if (why) return notify("info", `${PATH_LABEL.combine} — ${why}`);
  const out = combine(app.doc, app.selection);
  if (!out) return notify("info", `${PATH_LABEL.combine} — nothing to combine.`);
  commitDoc(out.doc);
  setSelection([out.id]);
}

let simplifyRunning = false;

/** Spec (M11) §6. Async even when paper is cached, so it refuses to run twice at once and
 *  re-checks the document after the await — the same hazard `booleanSelection` guards. */
export async function simplifySelection(): Promise<void> {
  if (simplifyRunning) return;
  simplifyRunning = true;
  try {
    cancelActiveGesture();
    const why = pathOpRefusal(app.doc, app.selection, "simplify");
    if (why) {
      notify("info", `${PATH_LABEL.simplify} — ${why}`);
      return;
    }
    const before = app.doc;
    const sel = app.selection;
    let out: SimplifyOutcome;
    try {
      out = await simplifyShapes(before, sel);
    } catch {
      notify(
        "error",
        // Reload, not "try again": a module fetch that failed is recorded in the browser's module
        // map, so every later import of the same chunk fails without asking the network again.
        `${PATH_LABEL.simplify} — the operation could not load. Check your connection, then reload the page.`,
      );
      return;
    }
    cancelActiveGesture();
    if (app.doc !== before) {
      notify("info", `${PATH_LABEL.simplify} — the document changed while it loaded; try again.`);
      return;
    }
    if (out.kind === "refused") {
      notify("info", `${PATH_LABEL.simplify} — ${out.why}`);
      return;
    }
    if (out.kind === "none") {
      notify("info", `${PATH_LABEL.simplify} — nothing to remove.`);
      return;
    }
    commitDoc(out.doc);
    notify("info", `Simplified — ${out.before} nodes → ${out.after}.`);
  } finally {
    simplifyRunning = false;
  }
}

/** Spec (M6) §2–§4. These change no document, but a selection that moves under a running drag is
 *  the hazard invariant 15 exists for, so the gesture is cancelled first. */
export function selectAll(): void {
  cancelActiveGesture();
  setSelection(allIds(app.doc, app.enteredGroupId));
}

export function invertSelection(): void {
  cancelActiveGesture();
  setSelection(invertIds(app.doc, app.selection, app.enteredGroupId));
}

/** Escape does this too, but Escape is a keyboard: the modifier dock exists for devices that have
 *  none, and with Shift latched a tap on empty canvas is the only other route. This is the one that
 *  always works. */
export function deselectAll(): void {
  cancelActiveGesture();
  setSelection([]);
}

export function selectSame(field: MatchField): void {
  cancelActiveGesture();
  setSelection(sameIds(app.doc, app.selection, app.enteredGroupId, field));
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

// ----- PNG export (spec M12) -----

/** Spec (M12) §3–§6. Builds the SVG for a region and hands it to the rasteriser.
 *
 *  This reads the document but never edits it, so it needs no `cancelActiveGesture()` — nothing it
 *  does can be clobbered by, or clobber, a running tool drag. */
async function pngFor(
  region: ExportRegion,
  scale: number,
  transparent: boolean,
): Promise<{ blob: Blob; w: number; h: number } | string> {
  const doc = app.doc;
  const ids = app.selection;
  const box = exportBox(doc, region, ids);
  const why = exportRefusal(box, scale);
  // `!box` only narrows the type for the `exportSize(box, …)` below — `exportRefusal(null, …)`
  // always returns a string, so `why` alone already covers the null case; `?? "nothing to export"`
  // is dead in practice, not a second way this can fail.
  if (why || !box) return why ?? "nothing to export";
  const { w, h } = exportSize(box, scale);
  const picked = region === "selection" ? filterToSelection(doc, ids) : doc;
  const source = transparent
    ? { ...picked, artboard: { ...picked.artboard, background: null } }
    : picked;
  const blob = await rasterise(serializeDoc(source, box), w, h);
  return { blob, w, h };
}

export async function exportPng(
  region: ExportRegion,
  scale: number,
  transparent: boolean,
): Promise<void> {
  try {
    const out = await pngFor(region, scale, transparent);
    if (typeof out === "string") return notify("info", `Export PNG — ${out}`);
    const name = await writePngFile(out.blob, pngFileName(app.fileName));
    // A null name is the user cancelling the picker, which is not a failure and says nothing.
    if (name) notify("info", `Exported ${name} — ${out.w} × ${out.h}.`);
  } catch (err) {
    notify("error", `Export PNG — ${errorMessage(err)}`);
  }
}

/** Spec (M12) §8. The whole artboard at 1×, with its background — the clipboard has no dialog.
 *
 *  Everything up to `writeClipboardPng` must stay synchronous: that call has to happen inside the
 *  click's user activation for Safari to allow it, which is the whole reason the blob is handed
 *  over as a PENDING promise rather than awaited first. `pngFor` (which itself awaits
 *  `img.decode()`) is started but never awaited here — only its returned promise, still settling,
 *  is passed on. */
export async function copyPng(): Promise<void> {
  const box = exportBox(app.doc, "artboard", app.selection);
  const why = exportRefusal(box, 1);
  if (why || !box) return notify("info", `Copy as PNG — ${why ?? "nothing to export"}`);
  const { w, h } = exportSize(box, 1);
  const pending = pngFor("artboard", 1, false).then((out) =>
    typeof out === "string" ? Promise.reject(new Error(out)) : out.blob,
  );
  const ok = await writeClipboardPng(pending);
  notify(
    ok ? "info" : "error",
    ok
      ? `Copied ${w} × ${h} to the clipboard.`
      : "Copy as PNG — this browser refused the clipboard. Use File ▸ Export PNG… instead.",
  );
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

/** Spec M9 §6. A hidden or locked node cannot be selected, so these two are reached from its row
 *  in the Layers panel — which is why that row's own buttons stay live while the row is blocked. */
export function toggleNodeVisible(id: string): void {
  cancelActiveGesture();
  const found = findNode(app.doc, id);
  if (found) commitDoc(setNodeHidden(app.doc, [id], !isHidden(found.node)));
}

export function toggleNodeLocked(id: string): void {
  cancelActiveGesture();
  const found = findNode(app.doc, id);
  if (found) commitDoc(setNodeLocked(app.doc, [id], !isLocked(found.node)));
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
  // Spec M10 §6: a character is the innermost thing selected, so Escape lets it go first
  // (the same walk invariant 31 describes for node selection).
  if (app.charSel !== null) {
    app.charSel = null;
    return;
  }
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
    if (app.selection.length > 0) {
      app.selection = [];
      syncPropsOverride(false);
    }
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

// ---------------------------------------------------------------------------
// Titles (spec M10). Outlining needs the font, which is a lazy-chunk load, so every one of these
// is async and follows M7's rule: capture the document before awaiting and refuse to commit if it
// moved meanwhile, and raise an **error** notice when the load fails, because a failed chunk fetch
// is cached by the browser's module map and only a reload clears it.
// ---------------------------------------------------------------------------

/** The font a new title gets, and what the picker last showed. Not saved, not undoable. */
let currentFontId = BUNDLED[0].id;

/** Bumped when a font is added, so the picker's `$derived` list actually recomputes. */
let fontsVersion = $state(0);
setFontRegistryListener(() => fontsVersion++);

export function fontsChangedTick(): number {
  return fontsVersion;
}

function defaultMeta(text: string): TextMeta {
  return {
    text,
    font: currentFontId,
    size: 96,
    letterSpacing: 0,
    lineHeight: 1.2,
    align: "left",
    seed: newSeed(),
    amounts: { rotate: 0, scale: 0, offset: 0, skew: 0 },
    overrides: {},
  };
}

/** True when the string needs shaping we cannot do (spec M10 §9) — refused, not drawn wrongly. */
function refuseUnshaped(text: string, quiet = false): boolean {
  if (!unshapedScript(text)) return false;
  if (!quiet) {
    notify(
      "error",
      "That script needs letter shaping this editor can't do yet — the glyphs would come out detached.",
    );
  }
  return true;
}

async function withFont<T>(id: string, run: (f: LoadedFont) => T): Promise<T | null> {
  try {
    return run(await loadFont(id));
  } catch (e) {
    // Three different causes, three different truths. Telling someone to reload when nothing was
    // ever downloaded — a session font from a previous session — is simply false.
    const text =
      e instanceof Woff2Error || e instanceof FontUnavailableError
        ? e.message
        : "The font couldn't be loaded. Reload the page and try again — a failed download is cached until you do.";
    notify("error", text);
    return null;
  }
}

/** Only one outline job at a time (invariant 37): these all await a lazy-chunk fetch, and two in
 *  flight would race to commit from the same base document. */
let titleRunning = false;

export async function placeTitle(at: Vec): Promise<void> {
  if (titleRunning) return;
  cancelActiveGesture();
  const layerId = app.currentLayerId;
  const b = layerBlock(app.doc, layerId);
  if (b) {
    notify("info", blockMessage(b, "draw"));
    return;
  }
  const before = app.doc;
  const meta = defaultMeta("Title");
  titleRunning = true;
  const subpaths = await withFont(meta.font, (f) => outlineText(f, meta)).finally(() => {
    titleRunning = false;
  });
  if (!subpaths || subpaths.length === 0) return;
  if (app.doc !== before) {
    notify("info", "The document changed while the font loaded — try placing the title again.");
    return;
  }
  // Re-checked after the await: the layer may have been locked, and a canvas drag may have begun
  // (invariant 15 — the first `cancelActiveGesture` was before the fetch, which is too early).
  const again = layerBlock(app.doc, layerId);
  if (again) {
    notify("info", blockMessage(again, "draw"));
    return;
  }
  cancelActiveGesture();
  const shape: PathShape = {
    kind: "path",
    id: "",
    transform: [1, 0, 0, 1, at.x, at.y],
    style: { ...app.prefs.style },
    subpaths,
    text: meta,
  };
  const r = addShape(app.doc, layerId, shape);
  commitDoc(r.doc);
  setSelection([r.id]);
  // Spec §6: placing a title is immediately followed by typing it. On iPad this is the difference
  // between the keyboard appearing and hunting for the field in a panel that just re-laid out.
  queueMicrotask(() =>
    (document.querySelector('input[aria-label="Title text"]') as HTMLInputElement | null)?.focus(),
  );
}

/** The single selected title, or null. */
export function selectedTitle(): PathShape | null {
  if (app.selection.length !== 1) return null;
  const found = findNode(app.doc, app.selection[0]);
  const n = found?.node;
  return n && n.kind === "path" && n.text ? n : null;
}

/** The newest request that arrived while one was already running. Dropping it outright was wrong:
 *  every move of a character drag calls in here, and discarding all but the first left the letter
 *  lagging well behind the pointer and stopping short of where it was released. Coalescing keeps
 *  the "one outline at a time" property the guard exists for, while making the **last** intent the
 *  one that lands. */
let queuedPatch: Partial<TextMeta> | null = null;
/** True while the text field is being typed in (spec M10e §5). A live keystroke is a state the
 *  user is passing THROUGH, not one they asked for: an empty field on the way to retyping, or a
 *  half-typed word the font has no glyph for, are both ordinary. So a live reshape fails silently
 *  and the panel keeps whatever is in the field; the commit on blur is what reports and corrects.
 *  Without this, typing raised an error notice per keystroke and yanked the caret back. */
let titleQuiet = false;

async function reshapeTitle(patch: Partial<TextMeta>, quiet = false): Promise<void> {
  if (titleRunning) {
    queuedPatch = { ...queuedPatch, ...patch };
    // A burst that ends on a live keystroke must stay quiet when it drains, and one that ends on
    // the commit must not — so the flag follows the newest arrival, like the patch itself.
    titleQuiet = quiet;
    return;
  }
  cancelActiveGesture();
  const target = selectedTitle();
  if (!target?.text) return;
  const meta: TextMeta = { ...target.text, ...patch };
  // Invariant 1: an edit that changes nothing must not outline, commit or push an undo step.
  // Re-picking the current font, or tapping the alignment button already on, reached here.
  if (sameMeta(meta, target.text)) return;
  if (refuseUnshaped(meta.text, quiet)) return;
  // Overrides never outlive the string they were made for (spec M10 §4).
  const len = [...meta.text].length;
  meta.overrides = Object.fromEntries(
    Object.entries(meta.overrides).filter(([k]) => Number(k) < len),
  );
  const before = app.doc;
  const beforeSel = app.selection;
  const id = target.id;
  titleRunning = true;
  let noGlyphs = false;
  const subpaths = await withFont(meta.font, (f) => {
    noGlyphs = noGlyphsFor(f, meta.text);
    return noGlyphs ? [] : outlineText(f, meta);
  }).finally(() => {
    titleRunning = false;
  });
  if (!subpaths) return;
  if (noGlyphs) {
    if (!quiet) notify("error", "This font has no letters for that text.");
    return;
  }
  if (app.doc !== before || app.selection !== beforeSel) {
    notify("info", "The selection changed while the font loaded — try that again.");
    return;
  }
  if (subpaths.length === 0) {
    // The importer drops a path with no subpaths (the M2 constraint), so an empty title may not
    // be written. The old outlines stay until there is something to replace them with.
    if (!quiet) notify("info", "A title needs at least one character.");
    return;
  }
  cancelActiveGesture();
  commitDoc(
    mapNodes(app.doc, [id], (n) => (n.kind === "path" ? { ...n, subpaths, text: meta } : n)),
  );
}

/** Field by field, because `amounts` and `overrides` are nested objects. */
function sameMeta(a: TextMeta, b: TextMeta): boolean {
  return (
    a.text === b.text &&
    a.font === b.font &&
    a.size === b.size &&
    a.letterSpacing === b.letterSpacing &&
    a.lineHeight === b.lineHeight &&
    a.align === b.align &&
    a.seed === b.seed &&
    JSON.stringify(a.amounts) === JSON.stringify(b.amounts) &&
    JSON.stringify(a.overrides) === JSON.stringify(b.overrides)
  );
}

/** Runs `reshapeTitle` and then whatever arrived while it was busy, newest wins. */
/** The drain currently in flight, so a caller that only queued a patch can still await the work
 *  that will pick it up. Without this, `await setTitleText(...)` resolved the instant it queued —
 *  and the typing gesture closed while keystrokes were still draining, so those last commits
 *  landed outside the bracket and became undo steps of their own. */
let titleWork: Promise<void> | null = null;

function reshapeTitleDraining(patch: Partial<TextMeta>, quiet = false): Promise<void> {
  if (titleRunning) {
    // Queued onto the running drain; awaiting *that* is what makes the caller wait for this patch.
    queuedPatch = { ...queuedPatch, ...patch };
    titleQuiet = quiet;
    return titleWork ?? Promise.resolve();
  }
  titleQuiet = quiet;
  titleWork = (async () => {
    await reshapeTitle(patch, quiet);
    while (queuedPatch !== null && !titleRunning) {
      const next = queuedPatch;
      queuedPatch = null;
      await reshapeTitle(next, titleQuiet);
    }
  })().finally(() => {
    titleWork = null;
  });
  return titleWork;
}

export const setTitleText = (text: string): Promise<void> => reshapeTitleDraining({ text });

/** A keystroke in the text field (spec M10e §5). The canvas follows the typing, and the whole
 *  burst is one undo step because `TextPanel` brackets it in a document gesture (invariant 41) —
 *  the same shape as dragging the colour picker. `quiet`, so the states a burst passes through
 *  raise nothing. */
export const typeTitleText = (text: string): Promise<void> => reshapeTitleDraining({ text }, true);
export const setTitleOpts = (patch: Partial<TextMeta>): Promise<void> =>
  reshapeTitleDraining(patch);

/** Spec M10 §4. Amounts of zero make this a visible no-op, which is correct and needs no special
 *  case: the seed changes, `sameMeta` lets it through, and the outlines come back identical. */
export function rerollTitle(): Promise<void> {
  return setTitleOpts({ seed: newSeed() });
}

export async function setTitleFont(id: string): Promise<void> {
  currentFontId = id;
  if (selectedTitle()) await reshapeTitleDraining({ font: id });
}

/** Registers a font file for the session and switches the selection to it. */
export async function addFontFile(file: File): Promise<void> {
  try {
    const id = await registerFontFile(file);
    await setTitleFont(id);
    notify("info", `Added ${file.name}.`);
  } catch (e) {
    notify("error", e instanceof Error ? e.message : "That font couldn't be read.");
  }
}

// ---------------------------------------------------------------------------
// Per-character tweaking (spec M10 §6).
// ---------------------------------------------------------------------------

export function setCharSel(i: number | null): void {
  app.charSel = i;
}

/** Picks the character under a document point. Synchronous on purpose: the quads are kept up to
 *  date as the selection changes, because loading the font is async and a tool's `down` is not. */
export function pickCharacter(at: Vec): void {
  const t = selectedTitle();
  const quads = app.charQuads;
  if (!t || quads.length === 0) return;
  const found = findNode(app.doc, t.id);
  if (!found) return;
  const world = multiplyMat(found.parent, t.transform);
  const inv = invertMat(world);
  if (!inv) return; // a singular matrix has no inside (invariant 26)
  const p = applyMat(inv, at);
  // Last match wins: later characters are drawn on top, so that is what the eye picked.
  for (let i = quads.length - 1; i >= 0; i--) {
    if (pointInQuad(p, quads[i])) {
      app.charSel = i;
      return;
    }
  }
  app.charSel = null;
}

function pointInQuad(p: Vec, q: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const a = q[i];
    const b = q[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Writes one character's override. Goes through `reshapeTitle`, so it inherits its guards. */
export function setCharOverride(patch: CharOverride): Promise<void> {
  const t = selectedTitle();
  const i = app.charSel;
  if (!t?.text || i === null) return Promise.resolve();
  const overrides = { ...t.text.overrides, [i]: { ...t.text.overrides[i], ...patch } };
  return setTitleOpts({ overrides });
}

export function clearCharOverride(): Promise<void> {
  const t = selectedTitle();
  const i = app.charSel;
  if (!t?.text || i === null || t.text.overrides[i] === undefined) return Promise.resolve();
  const overrides = { ...t.text.overrides };
  delete overrides[i];
  return setTitleOpts({ overrides });
}

/** The selected character's current offset, so a drag can work from an absolute base. */
export function charOffset(): { dx: number; dy: number } {
  const o = selectedTitle()?.text?.overrides[app.charSel ?? -1];
  return { dx: o?.dx ?? 0, dy: o?.dy ?? 0 };
}

/** Sets the selected character's offset **absolutely** (spec M10 §6).
 *
 *  Deliberately not an increment. Every call re-outlines, which is async, and `reshapeTitle`'s
 *  re-entrancy guard drops a call that arrives while one is in flight — during a drag that is most
 *  of them. An increment loses each dropped delta for good, so the character crawled along at a
 *  fraction of the pointer's speed. An absolute value makes every call carry the whole drag, so a
 *  dropped one costs nothing and the next one lands the character exactly where the pointer is. */
export function setCharOffset(dx: number, dy: number): Promise<void> {
  return setCharOverride({ dx, dy });
}

/** The quads follow the selected title. This lives in the store, not in `TextPanel`, because M8 put
 *  that panel behind `{#if expanded}` — with Properties collapsed, character picking would have
 *  silently stopped working. */
$effect.root(() => {
  $effect(() => {
    const t = selectedTitle();
    if (!t?.text) {
      if (app.charQuads.length > 0) app.charQuads = [];
      return;
    }
    const id = t.id;
    const meta = t.text;
    void loadFont(meta.font)
      .then((f) => {
        if (selectedTitle()?.id === id) app.charQuads = charQuads(f, meta);
      })
      .catch(() => {
        app.charQuads = [];
      });
  });
});
