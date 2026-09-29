import { beforeEach, describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type PathShape } from "../doc/document";
import { brushStyle, brushTolerance } from "../brush/commit";
import { deleteLayer } from "../doc/layers";
import {
  app,
  commitBrushStroke,
  commitDoc,
  replaceDocument,
  setCurrentLayer,
  setSelection,
  toggleLayerLocked,
  undo,
} from "../state/appState.svelte";
import type { Vec } from "../geom/vec";

/** A wavy stroke's outline: 200 points around a 100×10 band. */
const wavy = (x0 = 20, y0 = 50): Vec[] => {
  const top = Array.from({ length: 100 }, (_, i) => ({
    x: x0 + i,
    y: y0 - 5 + Math.sin(i / 8) * 3,
  }));
  const bottom = top.map((p) => ({ x: p.x, y: p.y + 10 })).reverse();
  return [...top, ...bottom];
};
const twoLayers = (): Doc => {
  const d = createDoc(200, 200);
  return {
    ...d,
    layers: [
      { ...d.layers[0], id: "L0", name: "Back", children: [] },
      { ...d.layers[0], id: "L1", name: "Front", children: [] },
    ],
  };
};
const paths = (): PathShape[] =>
  app.doc.layers.flatMap((l) => l.children).filter((n): n is PathShape => n.kind === "path");

beforeEach(() => {
  replaceDocument(twoLayers(), "Untitled.svg", null, true);
  app.notices = [];
});

describe("brushStyle", () => {
  it("paints with the stroke colour, no stroke", () => {
    const s = brushStyle({ ...DEFAULT_STYLE, opacity: 0.5 });
    expect(s.fill).toEqual(DEFAULT_STYLE.stroke);
    expect(s.stroke).toBeNull();
    expect(s.opacity).toBe(0.5);
  });
  it("falls back to the fill, then black", () => {
    expect(brushStyle({ ...DEFAULT_STYLE, stroke: null }).fill).toEqual(DEFAULT_STYLE.fill);
    expect(brushStyle({ ...DEFAULT_STYLE, stroke: null, fill: null }).fill).toEqual({
      color: "#000000",
      opacity: 1,
    });
  });
  it("tolerance is squared screen px over zoom", () => {
    expect(brushTolerance(1)).toBeCloseTo(0.25);
    expect(brushTolerance(2)).toBeCloseTo(0.0625);
  });
});

describe("commitBrushStroke", () => {
  it("adds one simplified filled path to the current layer, one undo step, selection untouched", async () => {
    setSelection([]);
    await commitBrushStroke(wavy());
    const ps = paths();
    expect(ps).toHaveLength(1);
    expect(app.doc.layers[1].children).toHaveLength(1);
    const nodes = ps[0].subpaths.reduce((n, s) => n + s.nodes.length, 0);
    expect(nodes).toBeGreaterThanOrEqual(2);
    expect(nodes).toBeLessThan(200 / 4);
    expect(ps[0].style.stroke).toBeNull();
    expect(app.selection).toEqual([]);
    expect(app.brushPending).toEqual([]);
    undo();
    expect(paths()).toHaveLength(0);
  });

  it("lands strokes in drawing order", async () => {
    const a = commitBrushStroke(wavy(20, 30));
    const b = commitBrushStroke(wavy(20, 120));
    await Promise.all([a, b]);
    const ys = app.doc.layers[1].children.map((n) => (n as PathShape).subpaths[0].nodes[0].p.y);
    expect(ys[0]).toBeLessThan(ys[1]);
  });

  it("drops pending strokes when the document is replaced", async () => {
    const p = commitBrushStroke(wavy());
    // Nothing locked or hidden in the new document: only the epoch can keep the stroke out.
    replaceDocument(twoLayers(), "Untitled.svg", null, true);
    await p;
    // replaceDocument drops pending strokes: nothing lands, nothing is thrown.
    expect(paths()).toHaveLength(0);
    expect(app.brushPending).toEqual([]);
    expect(app.notices).toEqual([]);
  });

  it("lands in the current layer when its own layer was deleted meanwhile", async () => {
    setCurrentLayer("L1");
    const p = commitBrushStroke(wavy());
    commitDoc(deleteLayer(app.doc, "L1")); // the store then resolves L0 as current
    await p;
    expect(app.doc.layers.map((l) => l.id)).toEqual(["L0"]);
    expect(app.doc.layers[0].children).toHaveLength(1);
  });

  it("refuses when its layer was locked during the await, with the block notice", async () => {
    setCurrentLayer("L1");
    const p = commitBrushStroke(wavy());
    toggleLayerLocked("L1");
    await p;
    expect(paths()).toHaveLength(0);
    expect(app.notices.map((n) => n.text)).toContain("“Front” is locked — unlock it to draw.");
  });

  it("reports a stroke that fails to land, and the next stroke still lands", async () => {
    // A point whose coordinate throws on read: `land` reads it after the call returns.
    const bad: Vec[] = [
      {
        get x(): number {
          throw new Error("boom");
        },
        y: 0,
      },
      ...wavy(20, 30),
    ];
    const a = commitBrushStroke(bad);
    const b = commitBrushStroke(wavy(20, 120));
    await expect(a).resolves.toBeUndefined();
    await b;
    expect(paths()).toHaveLength(1);
    expect(app.brushPending).toEqual([]);
    expect(app.notices.map((n) => [n.kind, n.text])).toEqual([
      ["error", "Brush — the stroke could not be added."],
    ]);
  });
});
