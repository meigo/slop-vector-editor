import { beforeEach, describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  isGradient,
  isLinear,
  isRadial,
  type Doc,
  type LinearGradient,
  type Node,
  type Shape,
} from "../doc/document";
import { findNode } from "../doc/tree";
import { IDENTITY } from "../geom/mat";
import {
  app,
  clearOrLeaveGroup,
  replaceDocument,
  setGradientStop,
  setGradientTarget,
  setGradientType,
  setSelection,
  setSelectionGradientStop,
  setSelectionPaintKind,
  undo,
} from "../state/appState.svelte";

/** Real-store coverage for M15 §6–§7: the gradient kind/stop actions and the picked-stop store
 *  state, modelled on node-store.test.ts. */

const rect = (id: string, x: number, y: number, w: number, h: number): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: { ...DEFAULT_STYLE, fill: { color: "#ff0000", opacity: 1 } },
  x,
  y,
  w,
  h,
  rx: 0,
});

/** Two red rects "a" and "b", both on layer "L0". */
function makeDoc(): Doc {
  return {
    ...createDoc(100, 100),
    layers: [
      {
        id: "L0",
        name: "L0",
        visible: true,
        locked: false,
        children: [rect("a", 0, 0, 10, 10), rect("b", 40, 40, 10, 10)],
      },
    ],
  };
}

function styleOf(id: string): Shape["style"] {
  return (findNode(app.doc, id)!.node as Shape).style;
}

beforeEach(() => {
  replaceDocument(makeDoc(), "Untitled.svg", null, true);
  setSelection(["a", "b"]);
  // Neither is undone by `replaceDocument`; reset explicitly so a test run after "the target
  // defaults to fill and is kept" (which leaves `gradientTarget` on "stroke") isn't polluted.
  setGradientTarget("fill");
  setGradientType("linear");
});

describe("gradient store actions", () => {
  it("Flat→Linear and a stop edit are single undo steps per shape", () => {
    setSelectionPaintKind("fill", "linear");
    expect(isGradient(styleOf("a").fill)).toBe(true);
    setSelectionGradientStop("fill", "end", { color: "#00ff00", opacity: 1 });
    expect((styleOf("b").fill as LinearGradient).end.color).toBe("#00ff00");
    undo();
    expect((styleOf("b").fill as LinearGradient).end.color).toBe("#ff0000");
    undo();
    expect(isGradient(styleOf("a").fill)).toBe(false);
  });

  it("a picked stop is cleared by a selection change and by Escape before the selection", () => {
    setGradientStop({ id: "a", stop: "start", which: "fill" });
    setSelection(["a"]);
    expect(app.gradientStop).toBeNull();
    setGradientStop({ id: "a", stop: "end", which: "fill" });
    clearOrLeaveGroup();
    expect(app.gradientStop).toBeNull();
    expect(app.selection).toEqual(["a"]);
    clearOrLeaveGroup();
    expect(app.selection).toEqual([]);
  });

  it("the target defaults to fill and is kept", () => {
    expect(app.gradientTarget).toBe("fill");
    setGradientTarget("stroke");
    expect(app.gradientTarget).toBe("stroke");
  });
});

describe("Type switch (spec M16 §5)", () => {
  it("converts the selection's gradients in one undo step and leaves flat paints alone", () => {
    setSelection(["a"]);
    setSelectionPaintKind("fill", "linear");
    setSelection(["a", "b"]);
    const bBefore = styleOf("b").fill;
    setGradientType("radial");
    expect(app.gradientType).toBe("radial");
    expect(isRadial(styleOf("a").fill)).toBe(true);
    expect(styleOf("b").fill).toBe(bBefore);
    undo();
    expect(isLinear(styleOf("a").fill)).toBe(true);
  });

  it("with nothing to convert only sets the kind to draw", () => {
    setSelection([]);
    setGradientType("radial");
    expect(app.gradientType).toBe("radial");
  });

  it("Flat→Radial from the panel", () => {
    setSelection(["a"]);
    setSelectionPaintKind("fill", "radial");
    expect(isRadial(styleOf("a").fill)).toBe(true);
  });
});

describe("Flat and back to Linear (session memory)", () => {
  it("restores the gradient the paint had before it went flat", () => {
    setSelection(["a"]);
    setSelectionPaintKind("fill", "linear");
    setSelectionGradientStop("fill", "end", { color: "#0000ff", opacity: 1 });
    const before = styleOf("a").fill;
    setSelectionPaintKind("fill", "flat");
    expect(isGradient(styleOf("a").fill)).toBe(false);
    setSelectionPaintKind("fill", "linear");
    expect(styleOf("a").fill).toEqual(before);
  });

  it("forgets everything when the document is replaced", () => {
    setSelection(["a"]);
    setSelectionPaintKind("fill", "linear");
    setSelectionGradientStop("fill", "end", { color: "#0000ff", opacity: 1 });
    setSelectionPaintKind("fill", "flat");
    replaceDocument(makeDoc(), "x.svg", null, true);
    setSelection(["a"]);
    setSelectionPaintKind("fill", "linear");
    expect((styleOf("a").fill as LinearGradient).end).toEqual({ color: "#ff0000", opacity: 0 });
  });
});
