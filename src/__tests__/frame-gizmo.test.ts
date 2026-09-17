import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node } from "../doc/document";
import { applyMat, IDENTITY, rotateAbout, skewX, translate, type Mat } from "../geom/mat";
import {
  docToFrame,
  frameCenter,
  frameResizeMap,
  frameToDoc,
  selectionBounds,
  selectionFrame,
} from "../tools/frame";
import {
  activeHandles,
  dragHandle,
  frameOutline,
  handleAt,
  handlePositions,
  handleSize,
  normalizeAngle,
  rotateDelta,
} from "../tools/gizmo";
import { NO_MODS } from "../tools/types";

const view = { x: 0, y: 0, zoom: 1 };
const rect = (id: string, x: number, y: number, w: number, h: number, t: Mat = IDENTITY): Node => ({
  kind: "rect",
  id,
  transform: t,
  style: DEFAULT_STYLE,
  x,
  y,
  w,
  h,
  rx: 0,
});
const doc = (...children: Node[]): Doc => ({
  ...createDoc(100, 100),
  layers: [{ id: "L", name: "L", visible: true, locked: false, children }],
});
const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x);
  expect(p.y).toBeCloseTo(y);
};

describe("selection frame", () => {
  it("uses a single node's rotation and its local box", () => {
    const d = doc(rect("a", 0, 0, 10, 20, rotateAbout(Math.PI / 6, { x: 0, y: 0 })));
    const f = selectionFrame(d, ["a"])!;
    expect(f.angle).toBeCloseTo(Math.PI / 6);
    expect(f.box.x).toBeCloseTo(0);
    expect(f.box.y).toBeCloseTo(0);
    expect(f.box.w).toBeCloseTo(10);
    expect(f.box.h).toBeCloseTo(20);
    near(
      frameCenter(f),
      applyMat(rotateAbout(Math.PI / 6, { x: 0, y: 0 }), { x: 5, y: 10 }).x,
      applyMat(rotateAbout(Math.PI / 6, { x: 0, y: 0 }), { x: 5, y: 10 }).y,
    );
  });

  it("uses the node's parent matrix for a node inside a rotated group", () => {
    const gt = rotateAbout(Math.PI / 6, { x: 0, y: 0 });
    const d = doc({
      kind: "group",
      id: "g",
      transform: gt,
      opacity: 1,
      children: [rect("a", 0, 0, 10, 20)],
    });
    const b = selectionBounds(d, ["a"])!;
    const corners = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ].map((p) => applyMat(gt, p));
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    expect(b.x).toBeCloseTo(Math.min(...xs));
    expect(b.y).toBeCloseTo(Math.min(...ys));
    expect(b.w).toBeCloseTo(Math.max(...xs) - Math.min(...xs));
    expect(b.h).toBeCloseTo(Math.max(...ys) - Math.min(...ys));

    // The frame's own box stays axis-aligned in the rotated space; the group's rotation
    // becomes the frame's angle.
    const f = selectionFrame(d, ["a"])!;
    expect(f.angle).toBeCloseTo(Math.PI / 6);
    expect(f.box.x).toBeCloseTo(0);
    expect(f.box.y).toBeCloseTo(0);
    expect(f.box.w).toBeCloseTo(10);
    expect(f.box.h).toBeCloseTo(20);
  });

  it("uses angle 0 for multiple or skewed nodes", () => {
    const d = doc(
      rect("a", 0, 0, 10, 10),
      rect("b", 20, 0, 10, 10, translate(0, 5)),
      rect("s", 0, 0, 10, 10, skewX(0.5)),
    );
    expect(selectionFrame(d, ["a", "b"])).toEqual({ angle: 0, box: { x: 0, y: 0, w: 30, h: 15 } });
    expect(selectionFrame(d, ["s"])!.angle).toBe(0);
    expect(selectionFrame(d, ["zz"])).toBeNull();
    expect(selectionBounds(d, ["a", "b"])).toEqual({ x: 0, y: 0, w: 30, h: 15 });
  });

  it("converts between frame and doc coordinates and builds resize maps", () => {
    const f = { angle: Math.PI / 2, box: { x: 0, y: 0, w: 1, h: 1 } };
    near(frameToDoc(f, { x: 1, y: 0 }), 0, 1);
    near(docToFrame(f, { x: 0, y: 1 }), 1, 0);
    const m = frameResizeMap(0, { x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 20, h: 10 });
    expect(applyMat(m, { x: 10, y: 10 })).toEqual({ x: 20, y: 10 });
    const r = frameResizeMap(
      Math.PI / 2,
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 0, y: 0, w: 20, h: 10 },
    );
    // Doubling the frame's x axis doubles doc y when the frame is rotated 90°.
    near(applyMat(r, { x: 0, y: 10 }), 0, 20);
  });
});

describe("gizmo handles", () => {
  const f = { angle: 0, box: { x: 0, y: 0, w: 100, h: 50 } };

  it("positions handles and the rotate knob in screen space", () => {
    const h = handlePositions(f, view);
    expect(h.nw).toEqual({ x: 0, y: 0 });
    expect(h.se).toEqual({ x: 100, y: 50 });
    expect(h.n).toEqual({ x: 50, y: 0 });
    near(h.rotate, 50, -24);
    const zoomed = handlePositions(f, { x: 10, y: 20, zoom: 2 });
    expect(zoomed.se).toEqual({ x: 210, y: 120 });
    near(zoomed.rotate, 110, -4);
    const rot = handlePositions(
      { angle: Math.PI / 2, box: { x: 0, y: -100, w: 50, h: 100 } },
      view,
    );
    near(rot.nw, 100, 0);
    near(rot.n, 100, 25);
    near(rot.rotate, 124, 25);
    expect(frameOutline(f, view)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]);
  });

  it("finds the handle under the pointer", () => {
    expect(handleSize("mouse")).toBe(8);
    expect(handleSize("pen")).toBe(16);
    expect(handleAt(f, view, { x: 101, y: 49 }, 8)).toBe("se");
    expect(handleAt(f, view, { x: 50, y: -24 }, 8)).toBe("rotate");
    expect(handleAt(f, view, { x: 56, y: 1 }, 8)).toBe("n");
    expect(handleAt(f, view, { x: 60, y: 25 }, 8)).toBeNull();
    const tiny = { angle: 0, box: { x: 0, y: 0, w: 2, h: 2 } };
    expect(handleAt(tiny, view, { x: 1, y: 0 }, 8)).toBe("nw");
  });

  it("drops handles that would act on a zero-size axis", () => {
    const line = { angle: 0, box: { x: 0, y: 10, w: 100, h: 0 } };
    expect(activeHandles(line)).toEqual(["nw", "ne", "e", "se", "sw", "w"]);
    expect(handleAt(line, view, { x: 50, y: 10 }, 8)).toBeNull();
    expect(handleAt(line, view, { x: 100, y: 10 }, 8)).toBe("ne");
    expect(activeHandles({ angle: 0, box: { x: 0, y: 0, w: 0, h: 0 } })).toEqual([]);
  });
});

describe("dragHandle", () => {
  const start = { x: 0, y: 0, w: 100, h: 50 };

  it("moves a corner with the opposite corner fixed", () => {
    expect(dragHandle("se", start, { x: 150, y: 100 }, NO_MODS)).toEqual({
      x: 0,
      y: 0,
      w: 150,
      h: 100,
    });
    expect(dragHandle("nw", start, { x: 10, y: 20 }, NO_MODS)).toEqual({
      x: 10,
      y: 20,
      w: 90,
      h: 30,
    });
  });

  it("moves an edge on one axis only", () => {
    expect(dragHandle("w", start, { x: -20, y: 30 }, NO_MODS)).toEqual({
      x: -20,
      y: 0,
      w: 120,
      h: 50,
    });
    expect(dragHandle("n", start, { x: 999, y: -30 }, NO_MODS)).toEqual({
      x: 0,
      y: -30,
      w: 100,
      h: 80,
    });
  });

  it("mirrors when dragged past the fixed side", () => {
    expect(dragHandle("se", start, { x: -50, y: 20 }, NO_MODS)).toEqual({
      x: 0,
      y: 0,
      w: -50,
      h: 20,
    });
    expect(dragHandle("w", start, { x: 130, y: 0 }, NO_MODS)).toEqual({
      x: 130,
      y: 0,
      w: -30,
      h: 50,
    });
  });

  it("resizes from the centre with Alt and keeps proportions with Shift", () => {
    expect(dragHandle("se", start, { x: 150, y: 75 }, { shift: false, alt: true })).toEqual({
      x: -50,
      y: -25,
      w: 200,
      h: 100,
    });
    expect(dragHandle("se", start, { x: 200, y: 60 }, { shift: true, alt: false })).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
    expect(dragHandle("e", start, { x: 200, y: 60 }, { shift: true, alt: false })).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 50,
    });
  });

  it("keeps a zero-size axis and clamps tiny sizes", () => {
    expect(dragHandle("se", { x: 0, y: 10, w: 100, h: 0 }, { x: 150, y: 40 }, NO_MODS)).toEqual({
      x: 0,
      y: 10,
      w: 150,
      h: 0,
    });
    expect(dragHandle("se", start, { x: 0.001, y: -0.001 }, NO_MODS)).toEqual({
      x: 0,
      y: 0,
      w: 0.01,
      h: -0.01,
    });
  });
});

describe("rotation", () => {
  it("normalises angles", () => {
    expect(normalizeAngle((5 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle((-3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2);
  });

  it("measures the drag angle around the centre, optionally snapped to 15°", () => {
    const c = { x: 0, y: 0 };
    expect(rotateDelta(c, { x: 10, y: 0 }, { x: 0, y: 10 }, 0, false)).toBeCloseTo(Math.PI / 2);
    const p = { x: Math.cos(0.5) * 10, y: Math.sin(0.5) * 10 };
    const snapped = rotateDelta(c, { x: 10, y: 0 }, p, 0.1, true);
    expect(0.1 + snapped).toBeCloseTo(Math.PI / 6);
  });
});
