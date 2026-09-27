import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  isGradient,
  type Doc,
  type LinearGradient,
  type Node,
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
    expect(hs[0].from).toEqual({ x: 10, y: 35 });
    expect(hs[0].to).toEqual({ x: 110, y: 35 });
    expect(pickHandle(hs, { x: 12, y: 36 }, 6)?.part).toBe("start");
    expect(pickHandle(hs, { x: 60, y: 37 }, 6)?.part).toBe("line");
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
      [50, 25],
      [60, 35],
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

  it("a click on a knob picks that stop; a click on empty canvas clears the selection", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    ctx.setSelection(["a"]);
    const tool = createGradientTool();
    tool.down(ctx, ev(100, 25));
    tool.up(ctx, ev(100, 25));
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "end" });
    tool.down(ctx, ev(300, 300));
    tool.up(ctx, ev(300, 300));
    expect(state.selection).toEqual([]);
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
});
