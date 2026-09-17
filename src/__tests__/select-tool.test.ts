import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node, type RectShape } from "../doc/document";
import { findNode } from "../doc/tree";
import { applyMat, IDENTITY, translate } from "../geom/mat";
import { DEFAULT_PREFS } from "../persist/preferences";
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

  it("a mostly-vertical Shift-drag leaves x exactly 0, not a float residue", () => {
    const { ctx, state } = fakeContext(twoRects(), { ...DEFAULT_PREFS, snap: false });
    const t = createSelectTool();
    drag(t, ctx, [20, 20], [22, 50], { shift: true });
    expect(origin(state.session.doc, "a").x).toBe(0);
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

  it("keeps the grab offset when a handle is pressed off-centre", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    t.down(ctx, ev(37, 37));
    t.move(ctx, ev(39, 37));
    t.up(ctx, ev(39, 37));
    expect(node(state.session.doc, "a")).toMatchObject({ x: 0, y: 0, w: 42, h: 40 });
    expect(state.session.history.past).toHaveLength(1);
  });

  it("a tap on a handle changes nothing", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    tap(t, ctx, 40, 40);
    expect(node(state.session.doc, "a")).toMatchObject({ x: 0, y: 0, w: 40, h: 40 });
    expect(state.session.history.past).toHaveLength(0);
    expect(state.selection).toEqual(["a"]);
  });

  it("cancel during a resize restores the rect", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    t.down(ctx, ev(40, 40));
    t.move(ctx, ev(60, 60));
    expect(node(state.session.doc, "a")).toMatchObject({ w: 60, h: 60 });
    t.cancel(ctx);
    expect(node(state.session.doc, "a")).toMatchObject({ x: 0, y: 0, w: 40, h: 40 });
    expect(state.session.history.past).toHaveLength(0);
    expect(state.session.gestureBase).toBeNull();
  });

  it("drags a horizontal line by its middle instead of hitting a handle", () => {
    const d = createDoc(200, 200);
    const line: Node = {
      kind: "path",
      id: "l",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 0, y: 50 }, in: null, out: null, type: "corner" },
            { p: { x: 100, y: 50 }, in: null, out: null, type: "corner" },
          ],
        },
      ],
    };
    const { ctx, state } = fakeContext({
      ...d,
      layers: [{ ...d.layers[0], children: [line] }],
    });
    const t = createSelectTool();
    tap(t, ctx, 50, 50);
    expect(state.selection).toEqual(["l"]);
    drag(t, ctx, [50, 50], [50, 80]);
    expect(node(state.session.doc, "l").transform).toEqual(translate(0, 30));
    expect(state.session.history.past).toHaveLength(1);
  });
});

describe("select tool: snapping", () => {
  // twoRects(): a at x 0–40, b at x 60–100, both y 0–40; artboard 200 × 200.
  it("snaps a moved selection to other objects and shows guides", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    t.down(ctx, ev(20, 20));
    t.move(ctx, ev(37, 20));
    expect(state.overlay).toEqual({ kind: "guides", xs: [60], ys: [0] });
    t.up(ctx, ev(37, 20));
    expect(origin(state.session.doc, "a")).toEqual({ x: 20, y: 0 });
    expect(state.overlay).toBeNull();
    expect(state.session.history.past).toHaveLength(1);
  });

  it("does not snap when Snap is off", () => {
    const { ctx, state } = fakeContext(twoRects(), { ...DEFAULT_PREFS, snap: false });
    drag(createSelectTool(), ctx, [20, 20], [37, 20]);
    expect(origin(state.session.doc, "a")).toEqual({ x: 17, y: 0 });
  });

  it("snaps only along a Shift-constrained axis", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    t.down(ctx, ev(20, 20, { shift: true }));
    t.move(ctx, ev(37, 22, { shift: true }));
    expect(state.overlay).toEqual({ kind: "guides", xs: [60], ys: [] });
    t.up(ctx, ev(37, 22, { shift: true }));
    const p = origin(state.session.doc, "a");
    expect(p.x).toBeCloseTo(20);
    expect(p.y).toBeCloseTo(0);
  });

  it("snaps a resize handle", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    drag(t, ctx, [40, 40], [57, 43]);
    expect(node(state.session.doc, "a")).toMatchObject({ x: 0, y: 0, w: 60, h: 40 });
  });

  it("cancel during a snapped move clears the guides overlay and restores the doc", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    t.down(ctx, ev(20, 20));
    t.move(ctx, ev(37, 20));
    expect(state.overlay).toEqual({ kind: "guides", xs: [60], ys: [0] });
    t.cancel(ctx);
    expect(state.overlay).toBeNull();
    expect(node(state.session.doc, "a").transform).toEqual(IDENTITY);
    expect(state.session.history.past).toHaveLength(0);
  });

  it("an Alt-drag that ends where it started leaves nothing behind", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    t.down(ctx, ev(20, 20, { alt: true }));
    t.move(ctx, ev(20, 60, { alt: true }));
    expect(state.session.doc.layers[0].children).toHaveLength(3);
    t.move(ctx, ev(20, 20, { alt: true }));
    t.up(ctx, ev(20, 20, { alt: true }));
    expect(state.session.doc.layers[0].children.map((n) => n.id)).toEqual(["a", "b"]);
    expect(state.session.history.past).toHaveLength(0);
    expect(state.selection).toEqual(["a"]);
    expect(state.overlay).toBeNull();
  });

  // Confirmed (node one-liner reproducing the snapBox arithmetic): with a rect at fractional
  // x 215.115, pressing at 216 and ending the drag at 218.4 makes the copy's right edge snap onto
  // the original's, and dx0 (2.4000000000000057) plus the snap delta (-2.3999999999999773) is
  // 2.842170943040401e-14, not exactly 0 — the old `=== 0` check misses this residue.
  it("an Alt-drag back to a fractional-origin start is caught despite float residue", () => {
    const d = createDoc(400, 100);
    const a: RectShape = {
      kind: "rect",
      id: "a",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, stroke: null },
      x: 215.115,
      y: 0,
      w: 40,
      h: 40,
      rx: 0,
    };
    const doc: Doc = { ...d, nextId: 10, layers: [{ ...d.layers[0], children: [a] }] };
    const { ctx, state } = fakeContext(doc);
    const t = createSelectTool();
    t.down(ctx, ev(216, 20, { alt: true }));
    t.move(ctx, ev(216, 60, { alt: true }));
    expect(state.session.doc.layers[0].children).toHaveLength(2);
    t.move(ctx, ev(218.4, 20, { alt: true }));
    t.up(ctx, ev(218.4, 20, { alt: true }));
    expect(state.session.doc.layers[0].children.map((n) => n.id)).toEqual(["a"]);
    expect(state.session.history.past).toHaveLength(0);
    expect(state.selection).toEqual(["a"]);
    expect(state.overlay).toBeNull();
  });

  it("does not snap a child to its own group's bounding box", () => {
    // child at x 60–100, y 0–40, well clear of the 300×300 artboard's own snap targets
    // (0/150/300), so the only thing it could snap to is its enclosing group's bounds.
    const g: Node = {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [rect("child", 60)],
    };
    const d = createDoc(300, 300);
    const doc: Doc = { ...d, nextId: 10, layers: [{ ...d.layers[0], children: [g] }] };
    const { ctx, state } = fakeContext(doc);
    state.enteredGroupId = "g";
    const t = createSelectTool();
    tap(t, ctx, 80, 20);
    expect(state.selection).toEqual(["child"]);
    drag(t, ctx, [80, 20], [84, 20]);
    expect(findNode(state.session.doc, "child")!.node.transform).toEqual(translate(4, 0));
  });
});

describe("entering a group", () => {
  /** g holds a (x 0–40) and b (x 60–100); z sits apart at x 120–160. */
  function groupDoc(): Doc {
    const d = createDoc(300, 200);
    return {
      ...d,
      layers: [
        {
          ...d.layers[0],
          children: [
            {
              kind: "group",
              id: "g",
              transform: IDENTITY,
              opacity: 1,
              children: [rect("a", 0), rect("b", 60)],
            } as Node,
            rect("z", 120),
          ],
        },
      ],
    };
  }

  it("enters on a double click and selects the child under the pointer", () => {
    const { ctx, state } = fakeContext(groupDoc());
    const tool: Tool = createSelectTool();
    tool.down(ctx, ev(10, 10, {}, "mouse", 0));
    tool.up(ctx, ev(10, 10, {}, "mouse", 0));
    expect(state.selection).toEqual(["g"]);
    expect(state.enteredGroupId).toBeNull();
    tool.down(ctx, ev(10, 10, {}, "mouse", 100));
    tool.up(ctx, ev(10, 10, {}, "mouse", 100));
    expect(state.enteredGroupId).toBe("g");
    expect(state.selection).toEqual(["a"]);
  });

  it("leaves the group when a click lands outside it", () => {
    const { ctx, state } = fakeContext(groupDoc());
    const tool: Tool = createSelectTool();
    state.enteredGroupId = "g";
    state.selection = ["a"];
    tool.down(ctx, ev(130, 10, {}, "mouse", 0));
    tool.up(ctx, ev(130, 10, {}, "mouse", 0));
    expect(state.enteredGroupId).toBeNull();
    expect(state.selection).toEqual(["z"]);
  });

  it("stays inside when a click lands on another child", () => {
    const { ctx, state } = fakeContext(groupDoc());
    const tool: Tool = createSelectTool();
    state.enteredGroupId = "g";
    state.selection = ["a"];
    tool.down(ctx, ev(70, 10, {}, "mouse", 0));
    tool.up(ctx, ev(70, 10, {}, "mouse", 0));
    expect(state.enteredGroupId).toBe("g");
    expect(state.selection).toEqual(["b"]);
  });

  it("leaves the group when a click lands on empty canvas", () => {
    const { ctx, state } = fakeContext(groupDoc());
    const tool: Tool = createSelectTool();
    state.enteredGroupId = "g";
    state.selection = ["a"];
    tool.down(ctx, ev(250, 10, {}, "mouse", 0));
    tool.up(ctx, ev(250, 10, {}, "mouse", 0));
    expect(state.enteredGroupId).toBeNull();
    expect(state.selection).toEqual([]);
  });
});
