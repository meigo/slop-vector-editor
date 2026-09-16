import { describe, expect, it } from "vitest";
import { createDoc } from "../doc/document";
import { setArtboard } from "../doc/edits";
import { HISTORY_LIMIT } from "../state/history";
import {
  beginGesture,
  commit,
  endGesture,
  isDirty,
  markSaved,
  newSession,
  redoSession,
  undoSession,
} from "../state/session";

const resize = (w: number) => (d: ReturnType<typeof createDoc>) =>
  setArtboard(d, { ...d.artboard, w });

describe("session", () => {
  it("starts clean or dirty", () => {
    const doc = createDoc(10, 10);
    expect(isDirty(newSession(doc, true))).toBe(false);
    expect(isDirty(newSession(doc, false))).toBe(true);
  });

  it("commit records one undo step and ignores no-ops", () => {
    const s0 = newSession(createDoc(10, 10), true);
    expect(commit(s0, s0.doc)).toBe(s0);
    const s1 = commit(s0, resize(20)(s0.doc));
    expect(s1.doc.artboard.w).toBe(20);
    expect(s1.history.past).toEqual([s0.doc]);
    expect(isDirty(s1)).toBe(true);
    const back = undoSession(s1);
    expect(back.doc).toBe(s0.doc);
    expect(isDirty(back)).toBe(false);
    const again = redoSession(back);
    expect(again.doc).toBe(s1.doc);
  });

  it("a gesture records one step for many amends", () => {
    let s = newSession(createDoc(10, 10), true);
    const start = s.doc;
    s = beginGesture(s);
    s = commit(s, resize(11)(s.doc));
    s = commit(s, resize(12)(s.doc));
    s = beginGesture(s); // nested begin is ignored
    s = endGesture(s);
    expect(s.gestureBase).toBeNull();
    expect(s.history.past).toEqual([start]);
    expect(undoSession(s).doc).toBe(start);
  });

  it("a gesture that changes nothing records nothing", () => {
    let s = newSession(createDoc(10, 10), true);
    s = beginGesture(s);
    s = commit(s, resize(11)(s.doc));
    s = commit(s, resize(10)(s.doc));
    // setArtboard returned a NEW object equal in value; only a same-reference end is a no-op,
    // so move back to the base itself to model "dragged and returned".
    s = commit(s, s.gestureBase!);
    s = endGesture(s);
    expect(s.history.past).toEqual([]);
  });

  it("undo closes an open gesture first", () => {
    let s = newSession(createDoc(10, 10), true);
    const start = s.doc;
    s = beginGesture(s);
    s = commit(s, resize(30)(s.doc));
    s = undoSession(s);
    expect(s.doc).toBe(start);
    expect(s.gestureBase).toBeNull();
  });

  it("undo/redo with empty stacks are no-ops", () => {
    const s = newSession(createDoc(10, 10), true);
    expect(undoSession(s)).toBe(s);
    expect(redoSession(s)).toBe(s);
  });

  it("markSaved uses the doc that was written", () => {
    let s = newSession(createDoc(10, 10), false);
    const written = s.doc;
    s = commit(s, resize(40)(s.doc)); // edit while the save was in flight
    s = markSaved(s, written);
    expect(isDirty(s)).toBe(true);
    expect(isDirty(undoSession(s))).toBe(false);
  });

  it("caps history length", () => {
    let s = newSession(createDoc(10, 10), true);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) s = commit(s, resize(11 + i)(s.doc));
    expect(s.history.past).toHaveLength(HISTORY_LIMIT);
  });
});
