import type { Doc } from "../doc/document";
import { resolveLayerId } from "../doc/layers";
import { pruneSelection } from "../doc/tree";
import { DEFAULT_PREFS, type Prefs } from "../persist/preferences";
import { beginGesture, commit, endGesture, newSession, type Session } from "../state/session";
import type { View } from "../state/viewport";
import type { Overlay, ToolContext, ToolEvent } from "../tools/tool";
import { NO_MODS, type Mods } from "../tools/types";

export type FakeState = {
  session: Session;
  selection: readonly string[];
  currentLayerId: string;
  overlay: Overlay;
  notices: string[];
  view: View;
};

/** A ToolContext over a plain session, mirroring the real store's semantics. */
export function fakeContext(
  doc: Doc,
  prefs: Prefs = DEFAULT_PREFS,
): { ctx: ToolContext; state: FakeState } {
  const state: FakeState = {
    session: newSession(doc, true),
    selection: [],
    currentLayerId: resolveLayerId(doc, null),
    overlay: null,
    notices: [],
    view: { x: 0, y: 0, zoom: 1 },
  };
  const ctx: ToolContext = {
    doc: () => state.session.doc,
    view: () => state.view,
    selection: () => state.selection,
    currentLayerId: () => state.currentLayerId,
    setSelection: (ids) => {
      state.selection = pruneSelection(state.session.doc, ids);
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
    prefs: () => prefs,
    snapEnabled: () => prefs.snap,
    notify: (_kind, text) => {
      state.notices.push(text);
    },
    setOverlay: (o) => {
      state.overlay = o;
    },
  };
  return { ctx, state };
}

/** A pointer event at (x, y); the fake view is the identity, so doc = screen. */
export function ev(
  x: number,
  y: number,
  mods: Partial<Mods> = {},
  pointerType = "mouse",
): ToolEvent {
  return { doc: { x, y }, screen: { x, y }, pointerType, mods: { ...NO_MODS, ...mods } };
}
