import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  isGradient,
  type Doc,
  type Group,
  type LinearGradient,
  type Node,
  type RadialGradient,
  type Shape,
} from "../doc/document";
import { findNode } from "../doc/tree";
import { IDENTITY, rotate, translate, type Mat } from "../geom/mat";
import { gradientHandles, pickHandle } from "../tools/gradient-handles";
import { createGradientTool } from "../tools/gradient-tool";
import { ev, fakeContext } from "./fake-context";

const red = { color: "#ff0000", opacity: 1 };
const blue = { color: "#0000ff", opacity: 1 };
const lin: LinearGradient = {
  kind: "linear",
  from: { x: 0, y: 25 },
  to: { x: 100, y: 25 },
  start: red,
  end: blue,
};
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
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children }] };
};
const fillOf = (d: Doc, id: string) => (findNode(d, id)!.node as Shape).style.fill;
const drag = (
  tool: ReturnType<typeof createGradientTool>,
  ctx: ReturnType<typeof fakeContext>["ctx"],
  pts: [number, number][],
  mods = {},
) => {
  tool.down(ctx, ev(pts[0][0], pts[0][1], mods));
  for (const [x, y] of pts.slice(1)) tool.move(ctx, ev(x, y, mods));
  const [x, y] = pts[pts.length - 1];
  tool.up(ctx, ev(x, y, mods));
};

describe("gradientHandles / pickHandle", () => {
  it("returns document-space points through the world matrix and picks knobs before the line", () => {
    const hs = gradientHandles(doc([rect("a", 0, lin, translate(10, 10))]), ["a"], "fill");
    expect(hs).toHaveLength(1);
    const h = hs[0];
    if (h.kind !== "linear") throw new Error("linear expected");
    expect(h.from).toEqual({ x: 10, y: 35 });
    expect(h.to).toEqual({ x: 110, y: 35 });
    expect(pickHandle(hs, { x: 12, y: 36 }, 6)?.part).toBe("start");
    expect(pickHandle(hs, { x: 35, y: 37 }, 6)?.part).toBe("line");
    expect(pickHandle(hs, { x: 60, y: 60 }, 6)).toBeNull();
  });

  it("ignores shapes whose target paint is flat, and reads the stroke when asked", () => {
    const d = doc([
      rect("a", 0, red),
      { ...rect("b", 0, red), style: { ...DEFAULT_STYLE, stroke: lin } } as Node,
    ]);
    expect(gradientHandles(d, ["a", "b"], "fill")).toEqual([]);
    expect(gradientHandles(d, ["a", "b"], "stroke").map((h) => h.id)).toEqual(["b"]);
  });

  it("orders handles back to front regardless of selection order, so a coincident pick goes to the frontmost shape (controller fix round 1)", () => {
    // "a" is painted first (back), "b" second (front); both carry the same gradient, so their
    // knobs land exactly on top of each other.
    const d = doc([rect("a", 0, lin), rect("b", 0, lin)]);
    const front = pickHandle(gradientHandles(d, ["a", "b"], "fill"), { x: 100, y: 25 }, 6);
    const frontReversed = pickHandle(gradientHandles(d, ["b", "a"], "fill"), { x: 100, y: 25 }, 6);
    expect(front?.h.id).toBe("b");
    expect(frontReversed?.h.id).toBe("b");
  });

  it("within tolerance, the nearest knob wins and a tie goes to start (review finding 2)", () => {
    const smallLin: LinearGradient = {
      kind: "linear",
      from: { x: 50, y: 25 },
      to: { x: 53, y: 25 },
      start: red,
      end: blue,
    };
    const hs = gradientHandles(doc([rect("a", 0, smallLin)]), ["a"], "fill");
    const tol = 6;
    expect(pickHandle(hs, { x: 52.9, y: 25 }, tol)?.part).toBe("end");
    expect(pickHandle(hs, { x: 50.1, y: 25 }, tol)?.part).toBe("start");
    // Exactly equidistant from both knobs: the tie goes to start.
    expect(pickHandle(hs, { x: 51.5, y: 25 }, tol)?.part).toBe("start");
  });

  it("counts a selected group's own selected child only once (controller fix round 1)", () => {
    const g: Group = {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [rect("c", 0, lin)],
    };
    const d = doc([g]);
    expect(gradientHandles(d, ["g", "c"], "fill").map((h) => h.id)).toEqual(["c"]);
    expect(gradientHandles(d, ["c", "g"], "fill").map((h) => h.id)).toEqual(["c"]);
  });
});

describe("the Gradient tool (spec M15 §7)", () => {
  it("drags a knob in the shape's own space, as one undo step", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin, rotate(Math.PI / 2))]));
    ctx.setSelection(["a"]);
    // rotate(90°): own (100, 25) is at document (-25, 100).
    const tool = createGradientTool();
    drag(tool, ctx, [
      [-25, 100],
      [-25, 130],
      [-25, 150],
    ]);
    const f = fillOf(ctx.doc(), "a") as LinearGradient;
    expect(f.to.x).toBeCloseTo(150, 9);
    expect(f.to.y).toBeCloseTo(25, 9);
    expect(state.session.history.past.length).toBe(1);
  });

  it("drags the line to move both ends", () => {
    const { ctx } = fakeContext(doc([rect("a", 0, lin)]));
    ctx.setSelection(["a"]);
    drag(createGradientTool(), ctx, [
      [25, 25],
      [35, 35],
    ]);
    expect(fillOf(ctx.doc(), "a")).toEqual({
      ...lin,
      from: { x: 10, y: 35 },
      to: { x: 110, y: 35 },
    });
  });

  it("draws a new line across every selected shape", () => {
    const { ctx } = fakeContext(doc([rect("a", 0, red), rect("b", 200, red)]));
    ctx.setSelection(["a", "b"]);
    drag(createGradientTool(), ctx, [
      [0, 200],
      [150, 200],
      [300, 200],
    ]);
    for (const id of ["a", "b"]) {
      expect(fillOf(ctx.doc(), id)).toEqual({
        kind: "linear",
        from: { x: 0, y: 200 },
        to: { x: 300, y: 200 },
        start: red,
        end: { ...red, opacity: 0 },
      });
    }
  });

  it("with nothing selected, selects the shape under the press and draws its line", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, red)]));
    drag(createGradientTool(), ctx, [
      [10, 10],
      [60, 10],
      [90, 10],
    ]);
    expect(state.selection).toEqual(["a"]);
    expect(isGradient(fillOf(ctx.doc(), "a"))).toBe(true);
  });

  it("Shift constrains the dragged direction to 45°", () => {
    const { ctx } = fakeContext(doc([rect("a", 0, red)]));
    ctx.setSelection(["a"]);
    drag(
      createGradientTool(),
      ctx,
      [
        [0, 0],
        [100, 10],
      ],
      { shift: true },
    );
    const f = fillOf(ctx.doc(), "a") as LinearGradient;
    expect(f.to.y).toBeCloseTo(0, 9);
    expect(f.to.x).toBeCloseTo(Math.hypot(100, 10), 9);
  });

  it("a click on a knob picks that stop, recording which paint it was picked on (review finding 7)", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    ctx.setSelection(["a"]);
    const tool = createGradientTool();
    tool.down(ctx, ev(100, 25));
    tool.up(ctx, ev(100, 25));
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "end", which: "fill" });
    tool.down(ctx, ev(300, 300));
    tool.up(ctx, ev(300, 300));
    expect(state.selection).toEqual([]);
  });

  it("records which paint the pick belongs to, not just the current target (review finding 7)", () => {
    const dual: Node = {
      kind: "rect",
      id: "a",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, fill: lin, stroke: lin },
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      rx: 0,
    };
    const { ctx, state } = fakeContext(doc([dual]));
    ctx.setSelection(["a"]);
    const tool = createGradientTool();
    tool.down(ctx, ev(100, 25));
    tool.up(ctx, ev(100, 25));
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "end", which: "fill" });
    // Switching the target must not retroactively change which paint the earlier pick belongs to.
    state.gradientTarget = "stroke";
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "end", which: "fill" });
  });

  it("cancelling mid-drag restores the base document and closes the gesture (review finding 9)", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    ctx.setSelection(["a"]);
    const baseDoc = ctx.doc();
    const historyBefore = state.session.history;
    const tool = createGradientTool();
    tool.down(ctx, ev(100, 25));
    tool.move(ctx, ev(150, 25));
    // Mid-drag: the document has already changed and a gesture is open.
    expect(ctx.doc()).not.toBe(baseDoc);
    expect(state.session.gestureBase).not.toBeNull();
    tool.cancel(ctx);
    expect(ctx.doc()).toBe(baseDoc);
    expect(state.session.gestureBase).toBeNull();
    expect(state.session.history).toBe(historyBefore);
  });

  it("dropping one knob on the other collapses to the end stop's flat paint", () => {
    const { ctx } = fakeContext(doc([rect("a", 0, lin)]));
    ctx.setSelection(["a"]);
    drag(createGradientTool(), ctx, [
      [0, 25],
      [50, 25],
      [100, 25],
    ]);
    expect(fillOf(ctx.doc(), "a")).toEqual(blue);
  });

  it("a committed draw forgets the drawn shapes' target-slot memory (fix M16 review finding 1)", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, red), rect("b", 200, red)]));
    ctx.setSelection(["a", "b"]);
    drag(createGradientTool(), ctx, [
      [0, 200],
      [150, 200],
      [300, 200],
    ]);
    expect(state.forgotten).toEqual([{ ids: ["a", "b"], which: "fill" }]);
  });

  it("a committed knob drag forgets only that shape's memory", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    ctx.setSelection(["a"]);
    drag(createGradientTool(), ctx, [
      [100, 25],
      [150, 25],
    ]);
    expect(state.forgotten).toEqual([{ ids: ["a"], which: "fill" }]);
  });

  it("a committed line drag forgets that shape's memory", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    ctx.setSelection(["a"]);
    drag(createGradientTool(), ctx, [
      [25, 25],
      [35, 35],
    ]);
    expect(state.forgotten).toEqual([{ ids: ["a"], which: "fill" }]);
  });

  it("a cancelled drag does not forget anything — the document is restored instead", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    ctx.setSelection(["a"]);
    const tool = createGradientTool();
    tool.down(ctx, ev(100, 25));
    tool.move(ctx, ev(150, 25));
    tool.cancel(ctx);
    expect(state.forgotten).toEqual([]);
  });
});

const circleFill: RadialGradient = {
  kind: "radial",
  center: { x: 50, y: 25 },
  a: { x: 100, y: 25 },
  b: { x: 50, y: 75 },
  start: red,
  end: blue,
};
const radialCtx = (fillValue: Shape["style"]["fill"] = circleFill) => {
  const f = fakeContext(doc([rect("a", 0, fillValue)]));
  f.ctx.setSelection(["a"]);
  f.state.gradientType = "radial";
  return f;
};
const rOf = (ctx: ReturnType<typeof fakeContext>["ctx"]) =>
  fillOf(ctx.doc(), "a") as RadialGradient;
const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

describe("radial handles and drags (spec M16 §6)", () => {
  it("picks the centre, both rims and the lines", () => {
    const hs = gradientHandles(doc([rect("a", 0, circleFill)]), ["a"], "fill");
    expect(pickHandle(hs, { x: 50, y: 25 }, 6)?.part).toBe("center");
    expect(pickHandle(hs, { x: 100, y: 25 }, 6)?.part).toBe("rimA");
    expect(pickHandle(hs, { x: 50, y: 75 }, 6)?.part).toBe("rimB");
    expect(pickHandle(hs, { x: 62.5, y: 26 }, 6)?.part).toBe("line");
  });

  it("small radial: the nearest knob wins, and a tie goes to centre, then A, then B (review finding 2)", () => {
    const smallRadial: RadialGradient = {
      kind: "radial",
      center: { x: 50, y: 25 },
      a: { x: 53, y: 25 },
      b: { x: 50, y: 28 },
      start: red,
      end: blue,
    };
    const hs = gradientHandles(doc([rect("a", 0, smallRadial)]), ["a"], "fill");
    const tol = 6;
    expect(pickHandle(hs, { x: 50, y: 25 }, tol)?.part).toBe("center");
    // Nearer rim A than the centre or rim B.
    expect(pickHandle(hs, { x: 52.9, y: 25 }, tol)?.part).toBe("rimA");
    // Nearer rim B than the centre or rim A.
    expect(pickHandle(hs, { x: 50, y: 27.9 }, tol)?.part).toBe("rimB");
    // Exactly equidistant from the centre and rim A: the tie goes to the centre.
    expect(pickHandle(hs, { x: 51.5, y: 25 }, tol)?.part).toBe("center");
  });

  it("draws a document-space circle with Type = Radial", () => {
    const { ctx } = radialCtx(red);
    drag(createGradientTool(), ctx, [
      [50, 25],
      [65, 25],
      [80, 25],
    ]);
    expect(rOf(ctx)).toEqual({
      kind: "radial",
      center: { x: 50, y: 25 },
      a: { x: 80, y: 25 },
      b: { x: 50, y: 55 },
      start: red,
      end: { ...red, opacity: 0 },
    });
  });

  it("dragging the centre moves all three points", () => {
    const { ctx } = radialCtx();
    drag(createGradientTool(), ctx, [
      [50, 25],
      [60, 35],
    ]);
    near(rOf(ctx).center, 60, 35);
    near(rOf(ctx).a, 110, 35);
    near(rOf(ctx).b, 60, 85);
  });

  it("rim A rotates and scales the whole ellipse about the centre", () => {
    const { ctx } = radialCtx();
    drag(createGradientTool(), ctx, [
      [100, 25],
      [70, 60],
      [50, 75],
    ]);
    near(rOf(ctx).a, 50, 75);
    near(rOf(ctx).b, 0, 25); // +90°, scale 1
  });

  it("rim A with Shift snaps to 45° and scales B with it", () => {
    const { ctx } = radialCtx();
    drag(
      createGradientTool(),
      ctx,
      [
        [100, 25],
        [95, 30],
      ],
      { shift: true },
    );
    const s = Math.hypot(45, 5) / 50;
    near(rOf(ctx).a, 50 + 50 * s, 25);
    near(rOf(ctx).b, 50, 25 + 50 * s);
  });

  it("rim B moves alone, or stays perpendicular to A with Shift", () => {
    const free = radialCtx();
    drag(createGradientTool(), free.ctx, [
      [50, 75],
      [70, 70],
    ]);
    near(rOf(free.ctx).b, 70, 70);
    near(rOf(free.ctx).a, 100, 25);
    const snapped = radialCtx();
    drag(
      createGradientTool(),
      snapped.ctx,
      [
        [50, 75],
        [70, 70],
      ],
      { shift: true },
    );
    near(rOf(snapped.ctx).b, 50, 70);
  });

  it("rim A keeps the ellipse's on-screen shape on a skewed shape (computed in document space)", () => {
    const f = fakeContext(doc([rect("a", 0, circleFill, [1, 0, 0.5, 1, 0, 0])]));
    f.ctx.setSelection(["a"]);
    const h = gradientHandles(f.ctx.doc(), ["a"], "fill")[0];
    if (h.kind !== "radial") throw new Error("radial expected");
    const tool = createGradientTool();
    drag(tool, f.ctx, [
      [h.a.x, h.a.y],
      [h.center.x, h.center.y + 50],
    ]);
    const after = gradientHandles(f.ctx.doc(), ["a"], "fill")[0];
    if (after.kind !== "radial") throw new Error("radial expected");
    // On screen: A went from c+(50,0) to c+(0,50) — a +90° rotation at scale 1 — so B's on-screen
    // offset rotates by +90° as well.
    const before = { x: h.b.x - h.center.x, y: h.b.y - h.center.y };
    near({ x: after.b.x - after.center.x, y: after.b.y - after.center.y }, -before.y, before.x);
  });

  it("taps pick the start stop on the centre and the end stop on a rim", () => {
    const { ctx } = radialCtx();
    const tool = createGradientTool();
    tool.down(ctx, ev(50, 25));
    tool.up(ctx, ev(50, 25));
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "start", which: "fill" });
    tool.down(ctx, ev(50, 75));
    tool.up(ctx, ev(50, 75));
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "end", which: "fill" });
  });

  it("a rim dragged onto the centre collapses to the end colour", () => {
    const { ctx } = radialCtx();
    drag(createGradientTool(), ctx, [
      [100, 25],
      [70, 25],
      [50, 25],
    ]);
    expect(fillOf(ctx.doc(), "a")).toEqual(blue);
  });
});

describe("midpoint diamond (spec M17 §6)", () => {
  it("sits at mid along the line (linear) or centre→A (radial), in document space", () => {
    const d = doc([rect("a", 0, { ...lin, mid: 0.3 }, translate(10, 10))]);
    const [h] = gradientHandles(d, ["a"], "fill");
    expect(h.mid.x).toBeCloseTo(40, 9);
    expect(h.mid.y).toBeCloseTo(35, 9);
    const rad: RadialGradient = {
      kind: "radial",
      center: { x: 50, y: 25 },
      a: { x: 90, y: 25 },
      b: { x: 50, y: 45 },
      start: red,
      end: blue,
    };
    const [r] = gradientHandles(doc([rect("b", 0, rad)]), ["b"], "fill");
    expect(r.mid).toEqual({ x: 70, y: 25 });
  });

  it("picks knob, then diamond, then line", () => {
    const hs = gradientHandles(doc([rect("a", 0, lin)]), ["a"], "fill");
    expect(pickHandle(hs, { x: 51, y: 26 }, 6)?.part).toBe("mid");
    expect(pickHandle(hs, { x: 20, y: 26 }, 6)?.part).toBe("line");
    expect(pickHandle(hs, { x: 2, y: 25 }, 6)?.part).toBe("start");
  });

  it("on a tiny gradient the knobs win over the diamond (Review Focus 5)", () => {
    const tiny: LinearGradient = { ...lin, from: { x: 50, y: 25 }, to: { x: 54, y: 25 } };
    const hs = gradientHandles(doc([rect("a", 0, tiny)]), ["a"], "fill");
    expect(pickHandle(hs, { x: 52, y: 25 }, 6)?.part).toBe("start");
  });

  it("dragging the diamond sets a whole-percent midpoint, clamped to 1–99, one undo step", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    state.selection = ["a"];
    const tool = createGradientTool();
    drag(tool, ctx, [
      [50, 25],
      [40, 30],
      [30.4, 40],
    ]);
    expect((fillOf(ctx.doc(), "a") as LinearGradient).mid).toBe(0.3);
    drag(tool, ctx, [
      [30, 25],
      [-500, 25],
    ]);
    expect((fillOf(ctx.doc(), "a") as LinearGradient).mid).toBe(0.01);
    drag(tool, ctx, [
      [1.5, 25],
      [900, 25],
    ]);
    // The press at x=1.5 is on the start knob, not the diamond: it moves the start instead.
    expect((fillOf(ctx.doc(), "a") as LinearGradient).from.x).toBe(900);
  });

  it("a cancelled diamond drag restores the document; a click on it picks the middle stop (spec M18 §5)", () => {
    const d0 = doc([rect("a", 0, lin)]);
    const { ctx, state } = fakeContext(d0);
    state.selection = ["a"];
    const tool = createGradientTool();
    tool.down(ctx, ev(50, 25));
    tool.move(ctx, ev(30, 25));
    tool.cancel(ctx);
    expect(ctx.doc()).toBe(d0);
    tool.down(ctx, ev(50, 25));
    tool.up(ctx, ev(50, 25));
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "mid", which: "fill" });
    expect(state.selection).toEqual(["a"]);
  });

  it("a diamond drag does not forget the Type-row memory (the geometry did not change)", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    state.selection = ["a"];
    drag(createGradientTool(), ctx, [
      [50, 25],
      [30, 25],
    ]);
    expect(state.forgotten).toEqual([]);
  });

  it("a knob drag keeps the midpoint (Review Focus 4)", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, { ...lin, mid: 0.3 })]));
    state.selection = ["a"];
    drag(createGradientTool(), ctx, [
      [100, 25],
      [80, 25],
    ]);
    expect((fillOf(ctx.doc(), "a") as LinearGradient).mid).toBe(0.3);
  });
});

describe("hover cursors (spec M17 §6)", () => {
  const rad: RadialGradient = {
    kind: "radial",
    center: { x: 50, y: 25 },
    a: { x: 90, y: 25 },
    b: { x: 50, y: 45 },
    start: red,
    end: blue,
  };
  it("names each part's cursor and clears over nothing", () => {
    // "b"'s transform puts its radial's knobs at x 250–290 in document space.
    const { ctx, state } = fakeContext(
      doc([rect("a", 0, lin), rect("b", 0, rad, translate(200, 0))]),
    );
    state.selection = ["a"];
    const tool = createGradientTool();
    const at = (x: number, y: number) => {
      tool.hover!(ctx, ev(x, y));
      return state.hoverCursor;
    };
    expect(at(0, 25)).toBe("move");
    expect(at(100, 25)).toBe("move");
    expect(at(50, 25)).toBe("ew-resize");
    expect(at(20, 25)).toBe("move");
    expect(at(300, 300)).toBeNull();
    state.selection = ["b"];
    expect(at(250, 25)).toBe("move");
    expect(at(290, 25)).toBe("move");
    expect(at(250, 45)).toBe("grab");
  });

  it("a press clears the hover cursor", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    state.selection = ["a"];
    const tool = createGradientTool();
    tool.hover!(ctx, ev(50, 25));
    tool.down(ctx, ev(300, 300));
    expect(state.hoverCursor).toBeNull();
  });
});

describe("middle stop on the canvas (spec M18 §5)", () => {
  it("the handle carries the effective middle colour", () => {
    const black = { color: "#000000", opacity: 1 };
    const [auto] = gradientHandles(doc([rect("a", 0, lin)]), ["a"], "fill");
    expect(auto.midPaint).toEqual({ color: "#800080", opacity: 1 });
    const [custom] = gradientHandles(
      doc([rect("a", 0, { ...lin, midPaint: black })]),
      ["a"],
      "fill",
    );
    expect(custom.midPaint).toEqual(black);
  });

  it("a click on the diamond picks the middle stop and leaves Auto alone (Review Focus 5)", () => {
    const d0 = doc([rect("a", 0, lin)]);
    const { ctx, state } = fakeContext(d0);
    state.selection = ["a"];
    const tool = createGradientTool();
    tool.down(ctx, ev(50, 25));
    tool.up(ctx, ev(50, 25));
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "mid", which: "fill" });
    expect(ctx.doc()).toBe(d0);
  });

  it("a drag on the diamond still moves it rather than picking", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    state.selection = ["a"];
    drag(createGradientTool(), ctx, [
      [50, 25],
      [30, 25],
    ]);
    expect((fillOf(ctx.doc(), "a") as LinearGradient).mid).toBe(0.3);
    expect(ctx.gradientStop()).toBeNull();
  });
});
