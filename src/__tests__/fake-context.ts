import type { Doc } from "../doc/document";
import { resolveLayerId } from "../doc/layers";
import type { GradientKind, PaintSlot, StopEnd } from "../doc/paint-edit";
import type { NodeRef } from "../doc/path-edit";
import { pruneSelection } from "../doc/tree";
import { DEFAULT_PREFS, type Prefs } from "../persist/preferences";
import { beginGesture, commit, endGesture, newSession, type Session } from "../state/session";
import type { View } from "../state/viewport";
import type { Overlay, ToolContext, ToolEvent } from "../tools/tool";
import type { Vec } from "../geom/vec";
import { NO_MODS, type Mods, type ToolId } from "../tools/types";

export type FakeState = {
  /** Where the Text tool asked for a title (spec M10 §6). */
  titlesPlaced: Vec[];
  charsPicked: Vec[];
  charNudges: Vec[];
  fakeTitleId: string | null;
  fakeCharSel: number | null;
  fakeCharOffset: { dx: number; dy: number };
  session: Session;
  selection: readonly string[];
  currentLayerId: string;
  enteredGroupId: string | null;
  nodeTarget: string | null;
  nodeSel: readonly NodeRef[];
  toolId: ToolId;
  overlay: Overlay;
  notices: string[];
  view: View;
  gradientTarget: PaintSlot;
  gradientType: GradientKind;
  gradientStop: { id: string; stop: StopEnd; which: PaintSlot } | null;
  /** Calls to `forgetGradients` (fix M16 review finding 1), recorded rather than acted on — the
   *  fake has no `gradientMemory` of its own; the tool tests only check who got called with what. */
  forgotten: { ids: readonly string[]; which: PaintSlot }[];
  /** Set by `setHoverCursor` (spec M17 §6). */
  hoverCursor: string | null;
  /** Each `commitBrushStroke` call's outline (spec M21 §4.2), recorded rather than committed. */
  brushStrokes: Vec[][];
};

/** A ToolContext over a plain session, mirroring the real store's semantics. */
export function fakeContext(
  doc: Doc,
  prefs: Prefs = DEFAULT_PREFS,
): { ctx: ToolContext; state: FakeState } {
  const state: FakeState = {
    titlesPlaced: [],
    charsPicked: [],
    charNudges: [],
    fakeTitleId: null,
    fakeCharSel: null,
    fakeCharOffset: { dx: 0, dy: 0 },
    session: newSession(doc, true),
    selection: [],
    currentLayerId: resolveLayerId(doc, null),
    enteredGroupId: null,
    nodeTarget: null,
    nodeSel: [],
    toolId: "select",
    overlay: null,
    notices: [],
    view: { x: 0, y: 0, zoom: 1 },
    gradientTarget: "fill",
    gradientType: "linear",
    gradientStop: null,
    forgotten: [],
    hoverCursor: null,
    brushStrokes: [],
  };
  const ctx: ToolContext = {
    doc: () => state.session.doc,
    view: () => state.view,
    selection: () => state.selection,
    currentLayerId: () => state.currentLayerId,
    enteredGroupId: () => state.enteredGroupId,
    setEnteredGroup: (id) => {
      state.enteredGroupId = id;
    },
    nodeTarget: () => state.nodeTarget,
    setNodeTarget: (id) => {
      state.nodeTarget = id;
      state.nodeSel = [];
    },
    nodeSel: () => state.nodeSel,
    setNodeSel: (refs) => {
      state.nodeSel = refs;
    },
    setTool: (id) => {
      state.toolId = id;
    },
    setSelection: (ids) => {
      state.selection = pruneSelection(state.session.doc, ids);
      state.gradientStop = null;
    },
    commit: (d) => {
      state.session = commit(state.session, d);
    },
    beginGesture: () => {
      state.session = beginGesture(state.session);
    },
    endGesture: () => {
      state.session = endGesture(state.session);
    },
    finishCharDrag: () => {
      state.session = endGesture(state.session);
    },
    prefs: () => prefs,
    snapEnabled: () => prefs.snap,
    placeTitle: (at) => {
      state.titlesPlaced.push(at);
    },
    commitBrushStroke: (o) => {
      state.brushStrokes.push([...o]);
    },
    pickCharacter: (at) => {
      state.charsPicked.push(at);
    },
    charOffset: () => state.fakeCharOffset,
    setCharOffset: (dx, dy) => {
      state.charNudges.push({ x: dx, y: dy });
    },
    titleId: () => state.fakeTitleId,
    charSel: () => state.fakeCharSel,
    notify: (_kind, text) => {
      state.notices.push(text);
    },
    setOverlay: (o) => {
      state.overlay = o;
    },
    gradientTarget: () => state.gradientTarget,
    gradientType: () => state.gradientType,
    gradientStop: () => state.gradientStop,
    setGradientStop: (pick) => {
      state.gradientStop = pick;
    },
    forgetGradients: (ids, which) => {
      state.forgotten.push({ ids, which });
    },
    setHoverCursor: (c) => {
      state.hoverCursor = c;
    },
  };
  return { ctx, state };
}

/** Synthetic events are a second apart unless a test says otherwise, so an ordinary click followed
 *  by a drag is never mistaken for a double tap. */
let clock = 0;

/** A pointer event at (x, y); the fake view is the identity, so doc = screen. */
export function ev(
  x: number,
  y: number,
  mods: Partial<Mods> = {},
  pointerType = "mouse",
  time = (clock += 1000),
  pressure = 0.5,
): ToolEvent {
  return {
    doc: { x, y },
    screen: { x, y },
    pointerType,
    mods: { ...NO_MODS, ...mods },
    time,
    pressure,
  };
}
