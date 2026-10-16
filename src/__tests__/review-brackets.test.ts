import { beforeEach, describe, expect, it } from "vitest";
import { createDoc, type Doc, type PathShape } from "../doc/document";
import type { Vec } from "../geom/vec";
import {
  app,
  beginUiGesture,
  commitBrushStroke,
  commitDoc,
  endUiGesture,
  finishCharDrag,
  redo,
  replaceDocument,
  startTitleTyping,
  endTitleTyping,
  undo,
} from "../state/appState.svelte";

/** Review 2026-10-17, L1-L3: undo steps around brackets the UI opens. */

const withWidth = (w: number): Doc => ({ ...app.doc, artboard: { ...app.doc.artboard, w } });
const past = () => app.session.history.past.length;

beforeEach(() => {
  replaceDocument(createDoc(100, 100), "Untitled.svg", null, true);
  app.notices = [];
});

describe("L1: undo or redo while a panel drag is open", () => {
  it("is ignored, so the whole drag stays one undo step", () => {
    commitDoc(withWidth(101));
    beginUiGesture();
    commitDoc(withWidth(102));
    undo();
    redo();
    commitDoc(withWidth(103));
    commitDoc(withWidth(104));
    endUiGesture();
    expect(app.doc.artboard.w).toBe(104);
    expect(past()).toBe(2);
    undo();
    expect(app.doc.artboard.w).toBe(101);
  });

  it("a new drag starting while the last one's close is still pending gets its own bracket", async () => {
    beginUiGesture();
    commitDoc(withWidth(101));
    finishCharDrag(); // closes once the title queue drains: a microtask from now
    beginUiGesture();
    commitDoc(withWidth(102));
    await Promise.resolve();
    await Promise.resolve();
    commitDoc(withWidth(103));
    endUiGesture();
    expect(past()).toBe(2);
  });
});

describe("L2: a panel drag inside the typing bracket", () => {
  it("does not close the typing bracket, so the session stays one undo step", () => {
    startTitleTyping();
    commitDoc(withWidth(101));
    beginUiGesture();
    commitDoc(withWidth(102));
    endUiGesture();
    commitDoc(withWidth(103));
    endTitleTyping();
    expect(past()).toBe(1);
  });
});

describe("L3: undo while a brush stroke is still landing", () => {
  const band = (): Vec[] => {
    const top = Array.from({ length: 50 }, (_, i) => ({ x: 10 + i, y: 40 }));
    return [...top, ...top.map((p) => ({ x: p.x, y: 50 })).reverse()];
  };
  const paths = () =>
    app.doc.layers.flatMap((l) => l.children).filter((n): n is PathShape => n.kind === "path");

  it("waits for the stroke and undoes it, keeping the edit before it", async () => {
    commitDoc(withWidth(150));
    const landing = commitBrushStroke(band());
    undo();
    await landing;
    await Promise.resolve();
    expect(paths()).toHaveLength(0);
    expect(app.doc.artboard.w).toBe(150);
    redo();
    await Promise.resolve();
    expect(paths()).toHaveLength(1);
  });
});
