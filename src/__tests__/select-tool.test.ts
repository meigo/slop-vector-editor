import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node, type RectShape } from "../doc/document";
import { applyMat, IDENTITY } from "../geom/mat";
import { createSelectTool } from "../tools/select";
import type { Tool } from "../tools/tool";
import { ev, fakeContext } from "./fake-context";

const rect = (id: string, x: number): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: { ...DEFAULT_STYLE, stroke: null },
  x,
  y: 0,
  w: 40,
  h: 40,
  rx: 0,
});

/** a: x 0–40, b: x 60–100, both y 0–40. */
function twoRects(): Doc {
  const d = createDoc(200, 200);
  return {
    ...d,
    nextId: 10,
    layers: [{ ...d.layers[0], children: [rect("a", 0), rect("b", 60)] }],
  };
}

type Ctx = ReturnType<typeof fakeContext>["ctx"];
const tap = (t: Tool, ctx: Ctx, x: number, y: number, mods = {}) => {
  t.down(ctx, ev(x, y, mods));
  t.up(ctx, ev(x, y, mods));
};
const drag = (t: Tool, ctx: Ctx, from: [number, number], to: [number, number], mods = {}) => {
  t.down(ctx, ev(from[0], from[1], mods));
  t.move(ctx, ev(to[0], to[1], mods));
  t.up(ctx, ev(to[0], to[1], mods));
};
const node = (d: Doc, id: string) => d.layers[0].children.find((n) => n.id === id)!;
const origin = (d: Doc, id: string) => applyMat(node(d, id).transform, { x: 0, y: 0 });

describe("select tool: selection", () => {
  it("selects on tap, adds and toggles with Shift, clears on empty space", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    expect(state.selection).toEqual(["a"]);
    tap(t, ctx, 80, 20, { shift: true });
    expect(state.selection).toEqual(["a", "b"]);
    tap(t, ctx, 20, 20, { shift: true });
    expect(state.selection).toEqual(["b"]);
    tap(t, ctx, 20, 20);
    expect(state.selection).toEqual(["a"]);
    tap(t, ctx, 150, 150, { shift: true });
    expect(state.selection).toEqual(["a"]);
    tap(t, ctx, 150, 150);
    expect(state.selection).toEqual([]);
    expect(state.session.history.past).toHaveLength(0);
  });

  it("a plain tap on a member narrows a multi-selection to it", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    tap(t, ctx, 80, 20, { shift: true });
    expect(state.selection).toEqual(["a", "b"]);
    tap(t, ctx, 20, 20);
    expect(state.selection).toEqual(["a"]);
  });

  it("marquee-selects nodes fully inside and adds with Shift", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    t.down(ctx, ev(-10, -10));
    t.move(ctx, ev(50, 50));
    expect(state.overlay).toEqual({ kind: "marquee", box: { x: -10, y: -10, w: 60, h: 60 } });
    expect(state.selection).toEqual(["a"]);
    t.up(ctx, ev(50, 50));
    expect(state.overlay).toBeNull();
    drag(t, ctx, [50, -10], [110, 50], { shift: true });
    expect(state.selection).toEqual(["a", "b"]);
    drag(t, ctx, [50, -10], [110, 50]);
    expect(state.selection).toEqual(["b"]);
  });
});

describe("select tool: transforms", () => {
  it("moves the hit node as one undo step", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    drag(t, ctx, [20, 20], [30, 40]);
    expect(state.selection).toEqual(["a"]);
    expect(origin(state.session.doc, "a")).toEqual({ x: 10, y: 20 });
    expect(node(state.session.doc, "b").transform).toEqual(IDENTITY);
    expect(state.session.history.past).toHaveLength(1);
  });

  it("records nothing for a drag that ends where it started", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    t.down(ctx, ev(20, 20));
    t.move(ctx, ev(30, 40));
    t.move(ctx, ev(20, 20));
    t.up(ctx, ev(20, 20));
    expect(state.session.history.past).toHaveLength(0);
    expect(node(state.session.doc, "a").transform).toEqual(IDENTITY);
  });

  it("constrains moves to 45° steps with Shift", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    drag(t, ctx, [20, 20], [30, 22], { shift: true });
    const p = origin(state.session.doc, "a");
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(0);
    expect(state.selection).toEqual(["a"]);
  });

  it("duplicates with Alt and moves the copy", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    drag(t, ctx, [20, 20], [20, 50], { alt: true });
    expect(state.session.doc.layers[0].children.map((n) => n.id)).toEqual(["a", "n10", "b"]);
    expect(state.selection).toEqual(["n10"]);
    expect(node(state.session.doc, "a").transform).toEqual(IDENTITY);
    expect(origin(state.session.doc, "n10")).toEqual({ x: 0, y: 30 });
    expect(state.session.history.past).toHaveLength(1);
  });

  it("resizes with a corner handle, baking into the rect", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    drag(t, ctx, [40, 40], [50, 60]);
    expect(node(state.session.doc, "a")).toMatchObject({ x: 0, y: 0, w: 50, h: 60 });
    expect(node(state.session.doc, "a").transform).toEqual(IDENTITY);
    expect(state.selection).toEqual(["a"]);
    expect(state.session.history.past).toHaveLength(1);
  });

  it("rotates with the knob about the frame centre, snapping with Shift", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    drag(t, ctx, [20, -24], [64, 20.5], { shift: true });
    const p = origin(state.session.doc, "a");
    expect(p.x).toBeCloseTo(40);
    expect(p.y).toBeCloseTo(0);
    expect((node(state.session.doc, "a") as RectShape).w).toBe(40);
    expect(state.session.history.past).toHaveLength(1);
  });

  it("dragging a member of a multi-selection moves the whole selection", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    tap(t, ctx, 80, 20, { shift: true });
    drag(t, ctx, [20, 20], [30, 20]);
    expect(origin(state.session.doc, "a")).toEqual({ x: 10, y: 0 });
    expect(origin(state.session.doc, "b")).toEqual({ x: 10, y: 0 });
    expect(state.selection).toEqual(["a", "b"]);
  });

  it("a new pointer-down cancels an active drag", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    t.down(ctx, ev(20, 20));
    t.move(ctx, ev(60, 60));
    t.down(ctx, ev(150, 150));
    expect(state.session.gestureBase).toBeNull();
    expect(node(state.session.doc, "a").transform).toEqual(IDENTITY);
  });

  it("cancel restores the document and the previous selection", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 80, 20);
    t.down(ctx, ev(20, 20));
    t.move(ctx, ev(60, 60));
    expect(state.selection).toEqual(["a"]);
    t.cancel(ctx);
    expect(state.selection).toEqual(["b"]);
    expect(node(state.session.doc, "a").transform).toEqual(IDENTITY);
    expect(state.session.history.past).toHaveLength(0);
    expect(state.session.gestureBase).toBeNull();
    t.down(ctx, ev(150, 150));
    t.move(ctx, ev(170, 170));
    expect(state.overlay).not.toBeNull();
    t.cancel(ctx);
    expect(state.overlay).toBeNull();
    expect(state.selection).toEqual(["b"]);
  });
});
