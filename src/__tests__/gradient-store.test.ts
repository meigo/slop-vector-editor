import { beforeEach, describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  isGradient,
  isLinear,
  isRadial,
  type Doc,
  type Group,
  type LinearGradient,
  type Node,
  type RadialGradient,
  type Shape,
} from "../doc/document";
import { setGradientGeometry } from "../doc/paint-edit";
import { findNode } from "../doc/tree";
import { IDENTITY } from "../geom/mat";
import {
  app,
  beginDocGesture,
  clearOrLeaveGroup,
  commitDoc,
  deleteSelection,
  endDocGesture,
  forgetGradients,
  replaceDocument,
  setGradientStop,
  setGradientTarget,
  setGradientType,
  setSelection,
  setSelectionGradientMid,
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

/** One rect "a" whose fill is already a radial ELLIPSE (rim B closer than the circle a Flat/Linear
 *  default would build), so a round trip that lost it would come back as a circle instead
 *  (fix M16). */
function ellipseDoc(): Doc {
  const a: Node = {
    kind: "rect",
    id: "a",
    transform: IDENTITY,
    style: {
      ...DEFAULT_STYLE,
      fill: {
        kind: "radial",
        center: { x: 5, y: 5 },
        a: { x: 15, y: 5 },
        b: { x: 5, y: 8 },
        start: { color: "#ff0000", opacity: 1 },
        end: { color: "#0000ff", opacity: 1 },
      },
    },
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    rx: 0,
  };
  return {
    ...createDoc(100, 100),
    layers: [{ id: "L0", name: "L0", visible: true, locked: false, children: [a] }],
  };
}

function styleOf(id: string): Shape["style"] {
  return (findNode(app.doc, id)!.node as Shape).style;
}

/** A group "g" holding one red rect "c" — memory is keyed by LEAF shape id (`gradientsToRemember`/
 *  `convertGradients` descend into groups via `mapShapesWorld`), so forgetting the GROUP's id must
 *  reach "c:fill" too (fix M16 final review finding 1, still open after the leaf-shape fix). */
function groupDoc(): Doc {
  const g: Group = {
    kind: "group",
    id: "g",
    transform: IDENTITY,
    opacity: 1,
    children: [rect("c", 0, 0, 10, 10)],
  };
  return {
    ...createDoc(100, 100),
    layers: [{ id: "L0", name: "L0", visible: true, locked: false, children: [g] }],
  };
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

describe("switching Type back restores the gradient (fix M16)", () => {
  it("via setGradientType, Radial→Linear→Radial gets the ellipse back, not a fresh circle", () => {
    replaceDocument(ellipseDoc(), "Untitled.svg", null, true);
    setSelection(["a"]);
    const before = styleOf("a").fill;
    expect(isRadial(before)).toBe(true);
    setGradientType("linear");
    expect(isLinear(styleOf("a").fill)).toBe(true);
    setGradientType("radial");
    expect(styleOf("a").fill).toEqual(before);
  });

  it("via setSelectionPaintKind, the same round trip restores the ellipse", () => {
    replaceDocument(ellipseDoc(), "Untitled.svg", null, true);
    setSelection(["a"]);
    const before = styleOf("a").fill;
    setSelectionPaintKind("fill", "linear");
    expect(isLinear(styleOf("a").fill)).toBe(true);
    setSelectionPaintKind("fill", "radial");
    expect(styleOf("a").fill).toEqual(before);
  });
});

describe("forgetGradients drops stale memory (fix M16 review finding 1a)", () => {
  it("a newer radial drawn after Linear→Radial survives a Type round trip instead of the old linear", () => {
    setSelection(["a"]);
    setSelectionPaintKind("fill", "linear");
    const oldLinear = styleOf("a").fill;
    expect(isLinear(oldLinear)).toBe(true);
    // Linear → Radial: "a" gets a fresh circle, and the old linear is stashed as memory.
    setGradientType("radial");
    expect(isRadial(styleOf("a").fill)).toBe(true);
    // The Gradient tool draws or drags a NEWER radial on "a" — a plain geometry commit, exactly
    // what `setGradientGeometry` does — and then, per the fix, forgets the stale memory.
    const newer: RadialGradient = {
      kind: "radial",
      center: { x: 1, y: 1 },
      a: { x: 21, y: 1 },
      b: { x: 1, y: 15 },
      start: { color: "#000000", opacity: 1 }, // overridden: setGradientGeometry keeps current stops
      end: { color: "#000000", opacity: 1 },
    };
    commitDoc(setGradientGeometry(app.doc, "a", "fill", newer));
    const newerRadial = styleOf("a").fill as RadialGradient;
    forgetGradients(["a"], "fill");
    // Radial → Linear: with the memory forgotten, this must be the ordinary point conversion of
    // the shape's CURRENT radial, not a restore of the old linear.
    setGradientType("linear");
    const after = styleOf("a").fill as LinearGradient;
    expect(after).not.toEqual(oldLinear);
    expect(after).toEqual({
      kind: "linear",
      from: newerRadial.center,
      to: newerRadial.a,
      start: newerRadial.start,
      end: newerRadial.end,
    });
  });

  it("forgetting a GROUP reaches its leaf shapes' memory too (fix M16 final review finding 1)", () => {
    replaceDocument(groupDoc(), "Untitled.svg", null, true);
    setSelection(["g"]);
    setSelectionPaintKind("fill", "linear");
    const oldLinear = styleOf("c").fill;
    expect(isLinear(oldLinear)).toBe(true);
    // Linear → Radial on the group: "c" gets a fresh circle, stashed under its OWN id ("c:fill"),
    // never "g:fill" — the group itself carries no paint.
    setGradientType("radial");
    expect(isRadial(styleOf("c").fill)).toBe(true);
    // A newer radial committed directly on "c" (the Gradient tool always addresses the leaf shape,
    // group selected or not).
    const newer: RadialGradient = {
      kind: "radial",
      center: { x: 1, y: 1 },
      a: { x: 21, y: 1 },
      b: { x: 1, y: 15 },
      start: { color: "#000000", opacity: 1 },
      end: { color: "#000000", opacity: 1 },
    };
    commitDoc(setGradientGeometry(app.doc, "c", "fill", newer));
    const newerRadial = styleOf("c").fill as RadialGradient;
    // Forgetting the GROUP's id must still reach "c:fill".
    forgetGradients(["g"], "fill");
    setGradientType("linear");
    const after = styleOf("c").fill as LinearGradient;
    expect(after).not.toEqual(oldLinear);
    expect(after).toEqual({
      kind: "linear",
      from: newerRadial.center,
      to: newerRadial.a,
      start: newerRadial.start,
      end: newerRadial.end,
    });
  });

  it("without forgetting, the same round trip would wrongly resurrect the old linear (documents the bug)", () => {
    setSelection(["a"]);
    setSelectionPaintKind("fill", "linear");
    const oldLinear = styleOf("a").fill;
    setGradientType("radial");
    const newer: RadialGradient = {
      kind: "radial",
      center: { x: 1, y: 1 },
      a: { x: 21, y: 1 },
      b: { x: 1, y: 15 },
      start: { color: "#000000", opacity: 1 },
      end: { color: "#000000", opacity: 1 },
    };
    commitDoc(setGradientGeometry(app.doc, "a", "fill", newer));
    // No forgetGradients call here.
    setGradientType("linear");
    expect(styleOf("a").fill).toEqual(oldLinear);
  });
});

describe("gradientMemory is pruned once its shape is gone (fix M16 review finding 1c)", () => {
  it("deleting the shape drops its memory entry", () => {
    setSelection(["a"]);
    setSelectionPaintKind("fill", "linear");
    setSelectionPaintKind("fill", "flat");
    expect(app.gradientMemory.has("a:fill")).toBe(true);
    deleteSelection();
    expect(app.gradientMemory.has("a:fill")).toBe(false);
  });
});

describe("setSelectionGradientMid (spec M17 §5)", () => {
  beforeEach(() => {
    replaceDocument(makeDoc(), "t.svg", null, true);
    setSelection(["a"]);
    setSelectionPaintKind("fill", "linear");
  });

  it("sets the midpoint on the selection and deletes it at 50%", () => {
    setSelectionGradientMid("fill", 0.3);
    expect((styleOf("a").fill as { mid?: number }).mid).toBe(0.3);
    setSelectionGradientMid("fill", 0.5);
    expect("mid" in (styleOf("a").fill as object)).toBe(false);
  });

  it("a live slider drag inside a doc gesture is one undo step (Review Focus 3)", () => {
    beginDocGesture();
    for (const m of [0.4, 0.35, 0.3, 0.25]) setSelectionGradientMid("fill", m);
    endDocGesture();
    expect((styleOf("a").fill as { mid?: number }).mid).toBe(0.25);
    undo();
    expect("mid" in (styleOf("a").fill as object)).toBe(false);
  });
});
