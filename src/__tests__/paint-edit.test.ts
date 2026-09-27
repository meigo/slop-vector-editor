import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  midOf,
  midPaintOf,
  type Doc,
  type Fill,
  type Gradient,
  type LinearGradient,
  type Node,
  type RadialGradient,
  type Shape,
} from "../doc/document";
import {
  convertGradients,
  drawGradientLine,
  gradientsToRemember,
  setGradientGeometry,
  setGradientMid,
  setGradientMidAuto,
  setGradientStop,
  setPaintKind,
  toLinear,
  toRadial,
  type RememberedGradient,
} from "../doc/paint-edit";
import { findNode } from "../doc/tree";
import { IDENTITY, translate, type Mat } from "../geom/mat";
import { deepFreeze } from "./helpers";

const red = { color: "#ff0000", opacity: 1 };
const blue = { color: "#0000ff", opacity: 1 };
const lin = (fx: number, tx: number): LinearGradient => ({
  kind: "linear",
  from: { x: fx, y: 0 },
  to: { x: tx, y: 0 },
  start: red,
  end: blue,
});
const rect = (id: string, x: number, fill: Shape["style"]["fill"], t: Mat = IDENTITY): Node => ({
  kind: "rect",
  id,
  transform: t,
  style: { ...DEFAULT_STYLE, fill },
  x,
  y: 0,
  w: 100,
  h: 50,
  rx: 0,
});
const doc = (children: Node[]): Doc => {
  const d = createDoc(400, 400);
  return deepFreeze({ ...d, layers: [{ ...d.layers[0], id: "L0", children }] });
};
const fill = (d: Doc, id: string) => (findNode(d, id)!.node as Shape).style.fill;

describe("setPaintKind (spec M15 §6)", () => {
  it("Flat→Linear fades the colour across each shape's own box at mid-height", () => {
    const d = doc([rect("a", 0, red), rect("b", 200, blue, translate(0, 100))]);
    const out = setPaintKind(d, ["a", "b"], "fill", "linear");
    expect(fill(out, "a")).toEqual({
      kind: "linear",
      from: { x: 0, y: 25 },
      to: { x: 100, y: 25 },
      start: red,
      end: { ...red, opacity: 0 },
    });
    expect(fill(out, "b")).toEqual({
      kind: "linear",
      from: { x: 200, y: 25 },
      to: { x: 300, y: 25 },
      start: blue,
      end: { ...blue, opacity: 0 },
    });
  });

  it("Linear→Flat keeps the start stop; null and already-matching paints are left alone", () => {
    const d = doc([rect("a", 0, lin(0, 10)), rect("b", 0, null), rect("c", 0, red)]);
    const out = setPaintKind(d, ["a", "b", "c"], "fill", "flat");
    expect(fill(out, "a")).toEqual(red);
    expect(fill(out, "b")).toBeNull();
    expect(findNode(out, "c")!.node).toBe(findNode(d, "c")!.node);
    expect(setPaintKind(d, ["c"], "fill", "flat")).toBe(d);
  });

  it("Flat→Linear on a zero-width shape (a vertical line) lays the default line vertically (review finding 3)", () => {
    const verticalLine: Node = {
      kind: "path",
      id: "v",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, fill: red },
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 5, y: 0 }, in: null, out: null, type: "corner" },
            { p: { x: 5, y: 40 }, in: null, out: null, type: "corner" },
          ],
        },
      ],
    };
    const d = doc([verticalLine]);
    const out = setPaintKind(d, ["v"], "fill", "linear");
    expect(fill(out, "v")).toEqual({
      kind: "linear",
      from: { x: 5, y: 0 },
      to: { x: 5, y: 40 },
      start: red,
      end: { ...red, opacity: 0 },
    });
  });

  it("leaves a shape with zero width AND zero height alone", () => {
    const point: Node = {
      kind: "path",
      id: "p",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, fill: red },
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 5, y: 5 }, in: null, out: null, type: "corner" },
            { p: { x: 5, y: 5 }, in: null, out: null, type: "corner" },
          ],
        },
      ],
    };
    const d = doc([point]);
    expect(setPaintKind(d, ["p"], "fill", "linear")).toBe(d);
  });
});

describe("setGradientStop", () => {
  it("replaces one stop on every linear paint and leaves flat ones alone", () => {
    const d = doc([rect("a", 0, lin(0, 10)), rect("b", 0, red)]);
    const green = { color: "#00ff00", opacity: 0.5 };
    const out = setGradientStop(d, ["a", "b"], "fill", "end", green);
    expect(fill(out, "a")).toEqual({ ...lin(0, 10), end: green });
    expect(findNode(out, "b")!.node).toBe(findNode(d, "b")!.node);
    expect(setGradientStop(out, ["a"], "fill", "end", green)).toBe(out);
  });
});

describe("setGradientGeometry", () => {
  it("sets the points in own space, and collapses coincident ones to the end stop", () => {
    const d = doc([rect("a", 0, lin(0, 10))]);
    expect(
      fill(
        setGradientGeometry(d, "a", "fill", {
          ...lin(0, 10),
          from: { x: 1, y: 2 },
          to: { x: 3, y: 4 },
        }),
        "a",
      ),
    ).toEqual({ ...lin(0, 10), from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });
    expect(
      fill(
        setGradientGeometry(d, "a", "fill", {
          ...lin(0, 10),
          from: { x: 5, y: 5 },
          to: { x: 5, y: 5 },
        }),
        "a",
      ),
    ).toEqual(blue);
    expect(setGradientGeometry(d, "a", "fill", lin(0, 10))).toBe(d);
  });
});

describe("drawGradientLine (spec M15 §7)", () => {
  it("maps one document-space line into every shape's own space, through groups", () => {
    const group: Node = {
      kind: "group",
      id: "g",
      transform: translate(0, 100),
      opacity: 1,
      children: [rect("b", 0, red, translate(10, 0))],
    };
    const d = doc([rect("a", 0, lin(0, 10)), group]);
    const out = drawGradientLine(d, ["a", "g"], "fill", { x: 0, y: 110 }, { x: 50, y: 110 });
    expect(fill(out, "a")).toEqual({
      ...lin(0, 10),
      from: { x: 0, y: 110 },
      to: { x: 50, y: 110 },
    });
    // b's world = translate(0,100)·translate(10,0): own = doc − (10, 100).
    expect(fill(out, "b")).toEqual({
      kind: "linear",
      from: { x: -10, y: 10 },
      to: { x: 40, y: 10 },
      start: red,
      end: { ...red, opacity: 0 },
    });
  });

  it("starts a null paint from the default paint for that slot", () => {
    const d = doc([rect("a", 0, null)]);
    const f = fill(
      drawGradientLine(d, ["a"], "fill", { x: 0, y: 0 }, { x: 10, y: 0 }),
      "a",
    ) as LinearGradient;
    expect(f.start).toEqual(DEFAULT_STYLE.fill);
    expect(f.end).toEqual({ ...DEFAULT_STYLE.fill!, opacity: 0 });
  });

  it("skips a shape whose world matrix is singular", () => {
    const d = doc([rect("a", 0, red, [0, 0, 0, 1, 0, 0])]);
    expect(drawGradientLine(d, ["a"], "fill", { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(d);
  });
});

describe("remembering a gradient across Flat and back", () => {
  const recall = (m: Map<string, RememberedGradient>) => (id: string) => m.get(id);

  it("records each linear paint with its own-space box, and nothing for flat ones", () => {
    const d = doc([rect("a", 0, lin(10, 60)), rect("b", 0, red)]);
    expect(gradientsToRemember(d, ["a", "b"], "fill")).toEqual([
      ["a", { g: lin(10, 60), box: { x: 0, y: 0, w: 100, h: 50 } }],
    ]);
  });

  it("restores the remembered line and end stop exactly after a round trip", () => {
    const d = doc([rect("a", 0, lin(10, 60))]);
    const memory = new Map(gradientsToRemember(d, ["a"], "fill"));
    const flat = setPaintKind(d, ["a"], "fill", "flat");
    const back = setPaintKind(flat, ["a"], "fill", "linear", recall(memory));
    expect(fill(back, "a")).toEqual(lin(10, 60));
  });

  it("takes the start stop from a colour picked while flat", () => {
    const d = doc([rect("a", 0, lin(10, 60))]);
    const memory = new Map(gradientsToRemember(d, ["a"], "fill"));
    const green = { color: "#00ff00", opacity: 0.5 };
    const recoloured = doc([rect("a", 0, green)]);
    expect(fill(setPaintKind(recoloured, ["a"], "fill", "linear", recall(memory)), "a")).toEqual({
      ...lin(10, 60),
      start: green,
    });
  });

  it("stretches the remembered line with the box when the shape was resized while flat", () => {
    const memory = new Map(gradientsToRemember(doc([rect("a", 0, lin(10, 60))]), ["a"], "fill"));
    // Resized to twice the width and moved 100 right while flat.
    const resized = doc([{ ...(rect("a", 100, red) as Shape), w: 200 } as Node]);
    expect(fill(setPaintKind(resized, ["a"], "fill", "linear", recall(memory)), "a")).toEqual({
      ...lin(120, 220),
      start: red,
    });
  });

  it("falls back to the default fade when nothing is remembered", () => {
    const d = doc([rect("a", 0, red)]);
    expect(
      fill(
        setPaintKind(d, ["a"], "fill", "linear", () => undefined),
        "a",
      ),
    ).toEqual(fill(setPaintKind(d, ["a"], "fill", "linear"), "a"));
  });
});

const rad0 = (c: [number, number], a: [number, number], b: [number, number]): RadialGradient => ({
  kind: "radial",
  center: { x: c[0], y: c[1] },
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  start: red,
  end: blue,
});

describe("radial edits (spec M16 §5–§6)", () => {
  it("Flat→Radial draws a circle centred on the box, radius half its larger side", () => {
    expect(fill(setPaintKind(doc([rect("a", 0, red)]), ["a"], "fill", "radial"), "a")).toEqual({
      kind: "radial",
      center: { x: 50, y: 25 },
      a: { x: 100, y: 25 },
      b: { x: 50, y: 75 },
      start: red,
      end: { ...red, opacity: 0 },
    });
  });

  it("converts linear ↔ radial keeping the stops", () => {
    expect(toRadial(lin(0, 10))).toEqual(rad0([0, 0], [10, 0], [0, 10]));
    expect(toLinear(rad0([0, 0], [10, 0], [0, 10]))).toEqual(lin(0, 10));
    const d = doc([rect("a", 0, lin(0, 10)), rect("b", 0, red)]);
    const out = convertGradients(d, ["a", "b"], "fill", "radial");
    expect(fill(out, "a")).toEqual(rad0([0, 0], [10, 0], [0, 10]));
    expect(findNode(out, "b")!.node).toBe(findNode(d, "b")!.node);
    expect(convertGradients(out, ["a"], "fill", "radial")).toBe(out);
  });

  it("Linear→Radial through setPaintKind converts instead of starting over", () => {
    expect(
      fill(setPaintKind(doc([rect("a", 0, lin(0, 10))]), ["a"], "fill", "radial"), "a"),
    ).toEqual(rad0([0, 0], [10, 0], [0, 10]));
  });

  it("setGradientGeometry keeps the current stops and collapses a singular radial", () => {
    const d = doc([rect("a", 0, rad0([0, 0], [10, 0], [0, 10]))]);
    const moved = setGradientGeometry(d, "a", "fill", {
      ...rad0([5, 5], [15, 5], [5, 15]),
      start: blue,
      end: red,
    });
    expect(fill(moved, "a")).toEqual(rad0([5, 5], [15, 5], [5, 15]));
    expect(fill(setGradientGeometry(d, "a", "fill", rad0([0, 0], [0, 0], [0, 10])), "a")).toEqual(
      blue,
    );
    expect(setGradientGeometry(d, "a", "fill", rad0([0, 0], [10, 0], [0, 10]))).toBe(d);
  });

  it("drawGradientLine with kind radial draws a document-space circle into each shape", () => {
    const group: Node = {
      kind: "group",
      id: "g",
      transform: translate(0, 100),
      opacity: 1,
      children: [rect("b", 0, red)],
    };
    const out = drawGradientLine(
      doc([rect("a", 0, lin(0, 10)), group]),
      ["a", "g"],
      "fill",
      { x: 0, y: 110 },
      { x: 10, y: 110 },
      "radial",
    );
    expect(fill(out, "a")).toEqual(rad0([0, 110], [10, 110], [0, 120]));
    expect(fill(out, "b")).toEqual({
      kind: "radial",
      center: { x: 0, y: 10 },
      a: { x: 10, y: 10 },
      b: { x: 0, y: 20 },
      start: red,
      end: { ...red, opacity: 0 },
    });
  });

  it("remembers a radial across Flat and restores it, converting when Linear is asked for", () => {
    const r = rad0([50, 25], [100, 25], [50, 75]);
    const d = doc([rect("a", 0, r)]);
    const memory = new Map(gradientsToRemember(d, ["a"], "fill"));
    const flat = setPaintKind(d, ["a"], "fill", "flat");
    const recall = (id: string) => memory.get(id);
    expect(fill(setPaintKind(flat, ["a"], "fill", "radial", recall), "a")).toEqual({
      ...r,
      end: blue,
    });
    expect(fill(setPaintKind(flat, ["a"], "fill", "linear", recall), "a")).toEqual({
      kind: "linear",
      from: r.center,
      to: r.a,
      start: red,
      end: blue,
    });
  });
});

describe("converting kind remembers the gradient given up (fix M16)", () => {
  it("convertGradients: restores an ellipse exactly with the lookup, keeps a stop edited while linear, and defaults to a circle without one", () => {
    const ellipse = rad0([50, 25], [100, 25], [50, 40]);
    const d = doc([rect("a", 0, ellipse)]);
    const memory = new Map(gradientsToRemember(d, ["a"], "fill"));
    const recall = (id: string) => memory.get(id);
    const linear = convertGradients(d, ["a"], "fill", "linear");
    expect(fill(linear, "a")).toEqual(toLinear(ellipse));

    // Without a lookup, converting back builds a fresh circle (today's default).
    expect(fill(convertGradients(linear, ["a"], "fill", "radial"), "a")).toEqual(
      rad0([50, 25], [100, 25], [50, 75]),
    );

    // With the lookup, the ellipse comes back exactly.
    expect(fill(convertGradients(linear, ["a"], "fill", "radial", recall), "a")).toEqual(ellipse);

    // An end stop edited while linear survives the round trip.
    const green = { color: "#00ff00", opacity: 0.5 };
    const linearEdited = doc([
      rect("a", 0, { ...(fill(linear, "a") as LinearGradient), end: green }),
    ]);
    expect(fill(convertGradients(linearEdited, ["a"], "fill", "radial", recall), "a")).toEqual({
      ...ellipse,
      end: green,
    });
  });

  it("setPaintKind's gradient-to-other-kind branch restores the same way", () => {
    const ellipse = rad0([50, 25], [100, 25], [50, 40]);
    const d = doc([rect("a", 0, ellipse)]);
    const memory = new Map(gradientsToRemember(d, ["a"], "fill"));
    const recall = (id: string) => memory.get(id);
    const linear = setPaintKind(d, ["a"], "fill", "linear");
    expect(fill(setPaintKind(linear, ["a"], "fill", "radial", recall), "a")).toEqual(ellipse);
    expect(fill(setPaintKind(linear, ["a"], "fill", "radial"), "a")).toEqual(
      rad0([50, 25], [100, 25], [50, 75]),
    );
  });
});

describe("midpoint edits (spec M17 §2)", () => {
  const red = { color: "#ff0000", opacity: 1 };
  const blue = { color: "#0000ff", opacity: 1 };
  const lin: LinearGradient = {
    kind: "linear",
    from: { x: 0, y: 5 },
    to: { x: 10, y: 5 },
    start: red,
    end: blue,
  };
  const docWith = (fill: Fill): Doc => {
    const d = createDoc(100, 100);
    const r: Node = {
      kind: "rect",
      id: "a",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, fill },
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      rx: 0,
    };
    return { ...d, layers: [{ ...d.layers[0], id: "L0", children: [r] }] };
  };
  const fillA = (d: Doc) => (findNode(d, "a")!.node as Shape).style.fill as Gradient;

  it("setGradientMid sets it, deletes it at 0.5, and returns the same doc for a no-op", () => {
    const d0 = docWith(lin);
    const d1 = setGradientMid(d0, ["a"], "fill", 0.3);
    expect(fillA(d1).mid).toBe(0.3);
    const d2 = setGradientMid(d1, ["a"], "fill", 0.5);
    expect("mid" in fillA(d2)).toBe(false);
    expect(setGradientMid(d0, ["a"], "fill", 0.5)).toBe(d0);
    expect(setGradientMid(d1, ["a"], "fill", 0.3)).toBe(d1);
  });

  it("setGradientMid leaves flat paints alone", () => {
    const d0 = docWith(red);
    expect(setGradientMid(d0, ["a"], "fill", 0.3)).toBe(d0);
  });

  it("toRadial / toLinear carry the midpoint", () => {
    expect(toRadial({ ...lin, mid: 0.3 }).mid).toBe(0.3);
    expect(toLinear(toRadial({ ...lin, mid: 0.3 })).mid).toBe(0.3);
    expect("mid" in toRadial(lin)).toBe(false);
  });

  it("drawGradientLine and setGradientGeometry keep the current midpoint (Review Focus 4)", () => {
    const d0 = docWith({ ...lin, mid: 0.3 });
    const drawn = drawGradientLine(d0, ["a"], "fill", { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(fillA(drawn).mid).toBe(0.3);
    const radial = drawGradientLine(d0, ["a"], "fill", { x: 5, y: 5 }, { x: 9, y: 5 }, "radial");
    expect(fillA(radial).mid).toBe(0.3);
    const moved = setGradientGeometry(d0, "a", "fill", { ...lin, to: { x: 8, y: 5 } });
    expect(fillA(moved).mid).toBe(0.3);
  });

  it("a Type round trip through the memory keeps the CURRENT midpoint", () => {
    const d0 = docWith({ ...lin, mid: 0.3 });
    const remembered = { g: { ...lin, mid: 0.3 } as Gradient, box: { x: 0, y: 0, w: 10, h: 10 } };
    const asRadial = convertGradients(d0, ["a"], "fill", "radial");
    const edited = setGradientMid(asRadial, ["a"], "fill", 0.7);
    const back = convertGradients(edited, ["a"], "fill", "linear", () => remembered);
    expect(midOf(fillA(back))).toBe(0.7);
  });

  it("Flat → gradient restores the remembered midpoint", () => {
    const d0 = docWith(red);
    const remembered = { g: { ...lin, mid: 0.3 } as Gradient, box: { x: 0, y: 0, w: 10, h: 10 } };
    const back = setPaintKind(d0, ["a"], "fill", "linear", () => remembered);
    expect(midOf(fillA(back))).toBe(0.3);
  });
});

describe("custom midpoint colour edits (spec M18 §2)", () => {
  const red = { color: "#ff0000", opacity: 1 };
  const blue = { color: "#0000ff", opacity: 1 };
  const black = { color: "#000000", opacity: 1 };
  const lin: LinearGradient = {
    kind: "linear",
    from: { x: 0, y: 5 },
    to: { x: 10, y: 5 },
    start: red,
    end: blue,
  };
  const docWith = (fill: Fill): Doc => {
    const d = createDoc(100, 100);
    const r: Node = {
      kind: "rect",
      id: "a",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, fill },
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      rx: 0,
    };
    return { ...d, layers: [{ ...d.layers[0], id: "L0", children: [r] }] };
  };
  const fillA = (d: Doc) => (findNode(d, "a")!.node as Shape).style.fill as Gradient;

  it("setGradientStop 'mid' stores a custom colour; same doc when unchanged", () => {
    const d0 = docWith(lin);
    const d1 = setGradientStop(d0, ["a"], "fill", "mid", black);
    expect(fillA(d1).midPaint).toEqual(black);
    expect(setGradientStop(d1, ["a"], "fill", "mid", { ...black })).toBe(d1);
  });

  it("Auto follows a Start edit; a custom colour stays put (Review Focus 2)", () => {
    const auto = setGradientStop(docWith(lin), ["a"], "fill", "start", {
      color: "#ffffff",
      opacity: 1,
    });
    expect(midPaintOf(fillA(auto))).toEqual({ color: "#8080ff", opacity: 1 });
    const custom = setGradientStop(docWith({ ...lin, midPaint: black }), ["a"], "fill", "start", {
      color: "#ffffff",
      opacity: 1,
    });
    expect(midPaintOf(fillA(custom))).toEqual(black);
  });

  it("setGradientMidAuto(false) seeds the mix; (true) drops it; no-ops keep the doc (Review Focus 4)", () => {
    const d0 = docWith(lin);
    const off = setGradientMidAuto(d0, ["a"], "fill", false);
    expect(fillA(off).midPaint).toEqual({ color: "#800080", opacity: 1 });
    expect(setGradientMidAuto(off, ["a"], "fill", false)).toBe(off);
    const custom = docWith({ ...lin, midPaint: black });
    expect(setGradientMidAuto(custom, ["a"], "fill", false)).toBe(custom);
    const on = setGradientMidAuto(custom, ["a"], "fill", true);
    expect("midPaint" in fillA(on)).toBe(false);
    expect(setGradientMidAuto(d0, ["a"], "fill", true)).toBe(d0);
    const flat = docWith(red);
    expect(setGradientMidAuto(flat, ["a"], "fill", false)).toBe(flat);
  });

  it("conversions, redraw and geometry keep midPaint", () => {
    const g = { ...lin, midPaint: black, mid: 0.7 };
    expect(toRadial(g).midPaint).toEqual(black);
    expect(toLinear(toRadial(g)).midPaint).toEqual(black);
    expect(toLinear(toRadial(g)).mid).toBe(0.7);
    const d0 = docWith(g);
    expect(
      fillA(drawGradientLine(d0, ["a"], "fill", { x: 0, y: 0 }, { x: 9, y: 9 })).midPaint,
    ).toEqual(black);
    expect(
      fillA(setGradientGeometry(d0, "a", "fill", { ...lin, to: { x: 8, y: 5 } })).midPaint,
    ).toEqual(black);
  });

  it("a kind restore keeps the CURRENT midPaint; Flat → gradient restores the remembered one", () => {
    const white = { color: "#ffffff", opacity: 1 };
    const remembered = {
      g: { ...lin, midPaint: white } as Gradient,
      box: { x: 0, y: 0, w: 10, h: 10 },
    };
    const asRadial = convertGradients(docWith(lin), ["a"], "fill", "radial");
    const edited = setGradientStop(asRadial, ["a"], "fill", "mid", black);
    const back = convertGradients(edited, ["a"], "fill", "linear", () => remembered);
    expect(fillA(back).midPaint).toEqual(black);
    const fromFlat = setPaintKind(docWith(red), ["a"], "fill", "linear", () => remembered);
    expect(fillA(fromFlat).midPaint).toEqual(white);
  });
});
