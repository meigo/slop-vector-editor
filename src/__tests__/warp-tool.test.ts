import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node } from "../doc/document";
import { findNode } from "../doc/tree";
import { warpNodes } from "../doc/warp-edit";
import { IDENTITY } from "../geom/mat";
import { identityCage, type Cage } from "../geom/warp";
import { moveCagePart, pickCage } from "../tools/cage-handles";
import { selectionBounds } from "../tools/frame";
import { createWarpTool } from "../tools/warp-tool";
import { ev, fakeContext } from "./fake-context";

const rect = (id: string, x: number, w: number, h: number): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x,
  y: 0,
  w,
  h,
  rx: 0,
});
const flatLine: Node = {
  kind: "path",
  id: "l",
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  subpaths: [
    {
      closed: false,
      nodes: [
        { p: { x: 0, y: 300 }, in: null, out: null, type: "corner" },
        { p: { x: 100, y: 300 }, in: null, out: null, type: "corner" },
      ],
    },
  ],
};
const doc = (): Doc => {
  const d = createDoc(400, 400);
  return {
    ...d,
    layers: [
      { ...d.layers[0], children: [rect("a", 0, 100, 50), rect("b", 200, 50, 50), flatLine] },
    ],
  };
};

function setup(sel: string[]) {
  const f = fakeContext(doc());
  f.state.toolId = "warp";
  f.state.selection = sel;
  const tool = createWarpTool();
  return { ...f, tool };
}

function drag(
  tool: ReturnType<typeof createWarpTool>,
  ctx: ReturnType<typeof fakeContext>["ctx"],
  from: [number, number],
  to: [number, number],
) {
  tool.down(ctx, ev(...from));
  tool.move(ctx, ev((from[0] + to[0]) / 2, (from[1] + to[1]) / 2));
  tool.up(ctx, ev(...to));
}

const BOX_A = { x: 0, y: 0, w: 100, h: 50 };

describe("Warp tool (spec M14 §5)", () => {
  it("activate with one rect seeds a cage, no commit, no open gesture", () => {
    const { ctx, state, tool } = setup(["a"]);
    const before = state.session.doc;
    tool.activate!(ctx);
    expect(state.overlay?.kind).toBe("cage");
    expect(state.overlay).toEqual({ kind: "cage", cage: identityCage(BOX_A) });
    expect(state.session.doc).toBe(before);
    expect(state.session.gestureBase).toBeNull();
    expect(tool.busy!()).toBe(true);
  });

  it("activate with nothing selected notices and draws no cage", () => {
    const { ctx, state, tool } = setup([]);
    tool.activate!(ctx);
    expect(state.notices).toEqual(["Warp — select something to warp"]);
    expect(state.overlay).toBeNull();
    expect(tool.busy!()).toBe(false);
  });

  it("activate with a zero-height line gives the width-and-height notice", () => {
    const { ctx, state, tool } = setup(["l"]);
    tool.activate!(ctx);
    expect(state.notices).toEqual(["Warp — select something with width and height"]);
    expect(state.overlay).toBeNull();
    expect(tool.busy!()).toBe(false);
  });

  it("drags recompute from the original base", () => {
    const { ctx, state, tool } = setup(["a"]);
    const base = state.session.doc;
    tool.activate!(ctx);
    drag(tool, ctx, [100, 50], [120, 70]);
    const a = findNode(state.session.doc, "a")!.node;
    expect(a.kind).toBe("path");
    if (a.kind !== "path") return;
    const ps = a.subpaths[0].nodes.map((n) => n.p);
    expect(ps.some((p) => Math.abs(p.x - 120) < 1e-9 && Math.abs(p.y - 70) < 1e-9)).toBe(true);

    drag(tool, ctx, [0, 0], [-10, -10]);
    let cage: Cage = identityCage(BOX_A);
    cage = moveCagePart(cage, { kind: "corner", i: 2 }, { x: 120, y: 70 }, { x: 100, y: 50 });
    cage = moveCagePart(cage, { kind: "corner", i: 0 }, { x: -10, y: -10 }, { x: 0, y: 0 });
    expect(state.session.doc).toEqual(warpNodes(base, ["a"], cage, BOX_A));
    expect(state.session.gestureBase).toBe(base);
  });

  it("Enter after two drags is ONE undo step, a notice, and a fresh cage on the new bounds", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    const past = state.session.history.past.length;
    drag(tool, ctx, [100, 50], [120, 70]);
    drag(tool, ctx, [0, 0], [-10, -10]);
    expect(tool.keydown!(ctx, "enter")).toBe(true);
    expect(state.session.history.past.length).toBe(past + 1);
    expect(state.session.gestureBase).toBeNull();
    expect(state.notices).toEqual(["Warped — a rectangle is now an ordinary path."]);
    const box = selectionBounds(state.session.doc, ["a"])!;
    expect(state.overlay).toEqual({ kind: "cage", cage: identityCage(box) });
    expect(tool.busy!()).toBe(true);
  });

  it("Enter with no drag changes nothing (Review Focus 2)", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    const before = state.session.doc;
    const past = state.session.history.past.length;
    expect(tool.keydown!(ctx, "enter")).toBe(true);
    expect(state.session.doc).toBe(before);
    expect(state.session.history.past.length).toBe(past);
    expect(state.notices).toEqual([]);
  });

  it("a click on a corner opens the bracket but Enter adds no undo step", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    const before = state.session.doc;
    const past = state.session.history.past.length;
    tool.down(ctx, ev(100, 50));
    tool.up(ctx, ev(100, 50));
    tool.keydown!(ctx, "enter");
    expect(state.session.doc).toBe(before);
    expect(state.session.history.past.length).toBe(past);
  });

  it("Escape after a drag restores the base, no undo step, back to select", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    const base = state.session.doc;
    const past = state.session.history.past.length;
    drag(tool, ctx, [100, 50], [120, 70]);
    expect(tool.keydown!(ctx, "escape")).toBe(true);
    expect(state.session.doc).toBe(base);
    expect(state.session.gestureBase).toBeNull();
    expect(state.session.history.past.length).toBe(past);
    expect(state.toolId).toBe("select");
    expect(state.overlay).toBeNull();
    expect(tool.busy!()).toBe(false);
  });

  it("Backspace is left to the store", () => {
    const { ctx, tool } = setup(["a"]);
    tool.activate!(ctx);
    expect(tool.keydown!(ctx, "backspace")).toBe(false);
  });

  it("cancel mid-drag keeps the cage", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    tool.down(ctx, ev(100, 50));
    tool.move(ctx, ev(110, 60));
    tool.cancel(ctx);
    expect(tool.busy!()).toBe(true);
    expect(state.overlay?.kind).toBe("cage");
    // The drag is over: a further move changes nothing.
    const now = state.session.doc;
    tool.move(ctx, ev(150, 90));
    expect(state.session.doc).toBe(now);
  });

  it("settle after a drag commits exactly as Enter does", () => {
    const viaEnter = setup(["a"]);
    viaEnter.tool.activate!(viaEnter.ctx);
    drag(viaEnter.tool, viaEnter.ctx, [100, 50], [120, 70]);
    viaEnter.tool.keydown!(viaEnter.ctx, "enter");

    const viaSettle = setup(["a"]);
    viaSettle.tool.activate!(viaSettle.ctx);
    const past = viaSettle.state.session.history.past.length;
    drag(viaSettle.tool, viaSettle.ctx, [100, 50], [120, 70]);
    viaSettle.tool.settle!(viaSettle.ctx);

    expect(viaSettle.state.session.doc).toEqual(viaEnter.state.session.doc);
    expect(viaSettle.state.session.history.past.length).toBe(past + 1);
    expect(viaSettle.state.session.gestureBase).toBeNull();
    expect(viaSettle.state.notices).toEqual(viaEnter.state.notices);
    expect(viaSettle.state.overlay).toEqual(viaEnter.state.overlay);
  });

  it("Shift constrains a handle to 45° about its corner", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    // Right edge handle 0 sits at (100, 50/3); its corner is P10 (100, 0).
    const h = identityCage(BOX_A).edges[1][0];
    tool.down(ctx, ev(h.x, h.y));
    tool.up(ctx, ev(h.x + 20, h.y + 1, { shift: true }));
    const cage = (state.overlay as { kind: "cage"; cage: Cage }).cage;
    const moved = cage.edges[1][0];
    const angle = Math.atan2(moved.y - 0, moved.x - 100);
    expect(Math.abs(angle / (Math.PI / 4) - Math.round(angle / (Math.PI / 4)))).toBeLessThan(1e-9);
  });

  it("a press away from the cage on another shape selects it and reseeds", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    tool.down(ctx, ev(225, 25));
    expect(state.selection).toEqual(["b"]);
    // The fake has no store hook: the store would call settle from setSelection.
    tool.settle!(ctx);
    expect(state.overlay).toEqual({
      kind: "cage",
      cage: identityCage({ x: 200, y: 0, w: 50, h: 50 }),
    });
  });

  it("a press on empty canvas clears the selection and the cage", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    tool.down(ctx, ev(300, 200));
    expect(state.selection).toEqual([]);
    tool.settle!(ctx);
    expect(state.overlay).toBeNull();
    expect(tool.busy!()).toBe(false);
  });

  it("a press away from the cage after a drag commits the warp first", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    const past = state.session.history.past.length;
    drag(tool, ctx, [100, 50], [120, 70]);
    tool.down(ctx, ev(225, 25));
    expect(state.session.gestureBase).toBeNull();
    expect(state.session.history.past.length).toBe(past + 1);
    expect(findNode(state.session.doc, "a")!.node.kind).toBe("path");
  });

  it("an idle cage reseeds when the document changed under it", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    // Something outside the tool moved "a" (a nudge, say) after settle had already run.
    const d = state.session.doc;
    const moved = { ...(findNode(d, "a")!.node as Node & { kind: "rect" }), x: 10 };
    ctx.commit({
      ...d,
      layers: [{ ...d.layers[0], children: [moved, ...d.layers[0].children.slice(1)] }],
    });
    tool.hover!(ctx, ev(300, 300));
    expect(state.overlay).toEqual({
      kind: "cage",
      cage: identityCage({ x: 10, y: 0, w: 100, h: 50 }),
    });
  });

  it("hover over a corner shows move; elsewhere nothing", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    tool.hover!(ctx, ev(100, 50));
    expect(state.hoverCursor).toBe("move");
    tool.hover!(ctx, ev(300, 300));
    expect(state.hoverCursor).toBeNull();
  });

  it("discard drops the cage", () => {
    const { ctx, state, tool } = setup(["a"]);
    tool.activate!(ctx);
    tool.discard!(ctx);
    expect(state.overlay).toBeNull();
    expect(tool.busy!()).toBe(false);
  });
});

describe("cage handles (spec M14 §5, plan rulings 4–5)", () => {
  it("a corner beats a coincident handle", () => {
    const c = identityCage(BOX_A);
    const cage: Cage = {
      ...c,
      edges: [[{ x: 1, y: 0 }, c.edges[0][1]], c.edges[1], c.edges[2], c.edges[3]],
    };
    expect(pickCage(cage, { x: 0.5, y: 0 }, 6)).toEqual({ kind: "corner", i: 0 });
    expect(pickCage(cage, { x: 66.7, y: 0 }, 6)).toEqual({ kind: "handle", edge: 0, j: 1 });
    expect(pickCage(cage, { x: 50, y: 25 }, 6)).toBeNull();
  });

  it("the nearest handle wins", () => {
    const cage = identityCage({ x: 0, y: 0, w: 60, h: 60 });
    // Top handles at x = 20 and 40, both within reach of either press.
    expect(pickCage(cage, { x: 28, y: -3 }, 14)).toEqual({ kind: "handle", edge: 0, j: 0 });
    expect(pickCage(cage, { x: 32, y: -3 }, 14)).toEqual({ kind: "handle", edge: 0, j: 1 });
  });

  it("moving corner 2 carries Right handle 1 and Bottom handle 1 only", () => {
    const c = identityCage(BOX_A);
    const m = moveCagePart(c, { kind: "corner", i: 2 }, { x: 110, y: 57 }, { x: 100, y: 50 });
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: a.x - b.x,
      y: a.y - b.y,
    });
    expect(d(m.corners[2], c.corners[2])).toEqual({ x: 10, y: 7 });
    expect(d(m.edges[1][1], c.edges[1][1])).toEqual({ x: 10, y: 7 });
    expect(d(m.edges[2][1], c.edges[2][1])).toEqual({ x: 10, y: 7 });
    for (const i of [0, 1, 3]) expect(m.corners[i]).toEqual(c.corners[i]);
    expect(m.edges[0]).toEqual(c.edges[0]);
    expect(m.edges[3]).toEqual(c.edges[3]);
    expect(m.edges[1][0]).toEqual(c.edges[1][0]);
    expect(m.edges[2][0]).toEqual(c.edges[2][0]);
  });

  it("each corner carries its two adjacent near handles", () => {
    const c = identityCage(BOX_A);
    const moved = (i: 0 | 1 | 2 | 3) => {
      const m = moveCagePart(c, { kind: "corner", i }, { x: 1, y: 1 }, { x: 0, y: 0 });
      const out: string[] = [];
      m.edges.forEach((e, k) =>
        e.forEach((h, j) => {
          if (h.x !== c.edges[k][j].x) out.push(`${k}.${j}`);
        }),
      );
      return out;
    };
    expect(moved(0)).toEqual(["0.0", "3.0"]);
    expect(moved(1)).toEqual(["0.1", "1.0"]);
    expect(moved(2)).toEqual(["1.1", "2.1"]);
    expect(moved(3)).toEqual(["2.0", "3.1"]);
  });

  it("moving a handle sets it alone", () => {
    const c = identityCage(BOX_A);
    const m = moveCagePart(
      c,
      { kind: "handle", edge: 3, j: 1 },
      { x: -20, y: 40 },
      { x: 0, y: 33 },
    );
    expect(m.edges[3][1]).toEqual({ x: -20, y: 40 });
    expect(m.edges[3][0]).toEqual(c.edges[3][0]);
    expect(m.corners).toEqual(c.corners);
  });
});
