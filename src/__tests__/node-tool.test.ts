import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node, type PathShape } from "../doc/document";
import { IDENTITY, rotate } from "../geom/mat";
import { DEFAULT_PREFS } from "../persist/preferences";
import { createNodeTool } from "../tools/node-tool";
import { ev, fakeContext } from "./fake-context";

const line = (id: string, x: number): PathShape => ({
  kind: "path",
  id,
  transform: IDENTITY,
  style: { ...DEFAULT_STYLE, stroke: { color: "#000000", opacity: 1 } },
  subpaths: [
    {
      closed: false,
      nodes: [
        { p: { x, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: x + 40, y: 0 }, in: null, out: null, type: "corner" },
      ],
    },
  ],
});

const rect = (id: string): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x: 100,
  y: 0,
  w: 40,
  h: 40,
  rx: 0,
});

function doc(): Doc {
  const d = createDoc(300, 200);
  return { ...d, layers: [{ ...d.layers[0], children: [line("p", 0), rect("r")] }] };
}

describe("node tool: picking", () => {
  it("targets a path that is clicked, and selects it", () => {
    const { ctx, state } = fakeContext(doc());
    const tool = createNodeTool();
    tool.down(ctx, ev(10, 0));
    tool.up(ctx, ev(10, 0));
    expect(state.nodeTarget).toBe("p");
    expect(state.selection).toEqual(["p"]);
    expect(state.nodeSel).toEqual([]);
  });

  it("refuses a live shape with a notice", () => {
    const { ctx, state } = fakeContext(doc());
    const tool = createNodeTool();
    tool.down(ctx, ev(120, 20));
    tool.up(ctx, ev(120, 20));
    expect(state.nodeTarget).toBeNull();
    expect(state.selection).toEqual(["r"]);
    expect(state.notices).toEqual([
      "“Rectangle” is a live shape — use Convert to path to edit its nodes.",
    ]);
  });

  it("clears the selection when empty space is clicked with no target", () => {
    const { ctx, state } = fakeContext(doc());
    const tool = createNodeTool();
    state.selection = ["p"];
    tool.down(ctx, ev(250, 150));
    tool.up(ctx, ev(250, 150));
    expect(state.nodeTarget).toBeNull();
    expect(state.selection).toEqual([]);
  });

  it("keeps the target when empty space is clicked, so a marquee can start", () => {
    const { ctx, state } = fakeContext(doc());
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [{ sub: 0, i: 0 }];
    tool.down(ctx, ev(250, 150));
    tool.up(ctx, ev(250, 150));
    expect(state.nodeTarget).toBe("p");
    expect(state.nodeSel).toEqual([]);
  });
});

describe("node tool: editing", () => {
  const curvedPath = (): PathShape => ({
    kind: "path",
    id: "p",
    transform: IDENTITY,
    style: { ...DEFAULT_STYLE, stroke: { color: "#000000", opacity: 1 } },
    subpaths: [
      {
        closed: false,
        nodes: [
          { p: { x: 0, y: 0 }, in: null, out: { x: 0, y: 40 }, type: "smooth" },
          { p: { x: 40, y: 0 }, in: { x: 40, y: 40 }, out: null, type: "smooth" },
        ],
      },
    ],
  });
  const curvedDoc = (): Doc => {
    const d = createDoc(300, 200);
    return { ...d, layers: [{ ...d.layers[0], children: [curvedPath()] }] };
  };
  const target = (state: ReturnType<typeof fakeContext>["state"]) =>
    state.session.doc.layers[0].children[0] as PathShape;

  it("selects a node, and Shift adds another", () => {
    const { ctx, state } = fakeContext(curvedDoc());
    const tool = createNodeTool();
    state.nodeTarget = "p";
    tool.down(ctx, ev(0, 0));
    tool.up(ctx, ev(0, 0));
    expect(state.nodeSel).toEqual([{ sub: 0, i: 0 }]);
    tool.down(ctx, ev(40, 0, { shift: true }));
    tool.up(ctx, ev(40, 0, { shift: true }));
    expect(state.nodeSel).toEqual([
      { sub: 0, i: 0 },
      { sub: 0, i: 1 },
    ]);
  });

  it("drags the selected nodes", () => {
    // Snapping off: this checks the drag maths, not the snap targets.
    const { ctx, state } = fakeContext(curvedDoc(), { ...DEFAULT_PREFS, snap: false });
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [{ sub: 0, i: 0 }];
    tool.down(ctx, ev(0, 0));
    tool.move(ctx, ev(5, 5));
    tool.move(ctx, ev(10, 6));
    tool.up(ctx, ev(10, 6));
    const n = target(state).subpaths[0].nodes[0];
    expect(n.p).toEqual({ x: 10, y: 6 });
    expect(n.out).toEqual({ x: 10, y: 46 });
    expect(state.session.history.past).toHaveLength(1);
  });

  it("restores a node dragged back to where it started", () => {
    const { ctx, state } = fakeContext(curvedDoc(), { ...DEFAULT_PREFS, snap: false });
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [{ sub: 0, i: 0 }];
    tool.down(ctx, ev(0, 0));
    tool.move(ctx, ev(10, 0));
    tool.move(ctx, ev(0, 0));
    tool.up(ctx, ev(0, 0));
    expect(target(state).subpaths[0].nodes[0].p).toEqual({ x: 0, y: 0 });
  });

  it("applies the pointer-up position when it's only reported on up, not on a prior move", () => {
    // Snapping off: this checks the drag maths, not the snap targets. Only one intermediate
    // move is sent before up, and up itself carries the final position — nothing reports it
    // beforehand, so a fix that drops the up event entirely would leave the node at (5, 5).
    const { ctx, state } = fakeContext(curvedDoc(), { ...DEFAULT_PREFS, snap: false });
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [{ sub: 0, i: 0 }];
    tool.down(ctx, ev(0, 0));
    tool.move(ctx, ev(5, 5));
    tool.up(ctx, ev(10, 6));
    const n = target(state).subpaths[0].nodes[0];
    expect(n.p).toEqual({ x: 10, y: 6 });
    expect(n.out).toEqual({ x: 10, y: 46 });
  });

  it("drags a handle of a selected node", () => {
    const { ctx, state } = fakeContext(curvedDoc());
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [{ sub: 0, i: 0 }];
    tool.down(ctx, ev(0, 40));
    tool.move(ctx, ev(0, 30));
    tool.up(ctx, ev(0, 30));
    expect(target(state).subpaths[0].nodes[0].out).toEqual({ x: 0, y: 30 });
    expect(target(state).subpaths[0].nodes[0].p).toEqual({ x: 0, y: 0 });
  });

  it("double-clicks a segment to add a node and a node to cycle its type", () => {
    const { ctx, state } = fakeContext(curvedDoc());
    const tool = createNodeTool();
    state.nodeTarget = "p";
    const mid = { x: 20, y: 30 };
    tool.down(ctx, ev(mid.x, mid.y, {}, "mouse", 0));
    tool.up(ctx, ev(mid.x, mid.y, {}, "mouse", 0));
    tool.down(ctx, ev(mid.x, mid.y, {}, "mouse", 100));
    tool.up(ctx, ev(mid.x, mid.y, {}, "mouse", 100));
    expect(target(state).subpaths[0].nodes).toHaveLength(3);
    expect(state.nodeSel).toEqual([{ sub: 0, i: 1 }]);

    tool.down(ctx, ev(0, 0, {}, "mouse", 500));
    tool.up(ctx, ev(0, 0, {}, "mouse", 500));
    tool.down(ctx, ev(0, 0, {}, "mouse", 600));
    tool.up(ctx, ev(0, 0, {}, "mouse", 600));
    expect(target(state).subpaths[0].nodes[0].type).toBe("symmetric");
  });

  it("marquees nodes on empty space", () => {
    const { ctx, state } = fakeContext(curvedDoc());
    const tool = createNodeTool();
    state.nodeTarget = "p";
    tool.down(ctx, ev(-20, -20));
    tool.move(ctx, ev(10, 10));
    tool.move(ctx, ev(60, 20));
    tool.up(ctx, ev(60, 20));
    expect(state.nodeSel).toEqual([
      { sub: 0, i: 0 },
      { sub: 0, i: 1 },
    ]);
    expect(state.overlay).toBeNull();
  });

  it("marquees nodes by their world position on a rotated path", () => {
    // A straight two-node path (0,0)-(40,0) rotated 90° about the origin: node 0 stays at
    // world (0,0), node 1 lands at world (0,40). A document-space box that covers only the
    // second point must select only that node, even though in the path's own space both nodes
    // sit on y = 0.
    const rotated: PathShape = { ...line("p", 0), transform: rotate(Math.PI / 2) };
    const d = createDoc(300, 200);
    const { ctx, state } = fakeContext({
      ...d,
      layers: [{ ...d.layers[0], children: [rotated] }],
    });
    const tool = createNodeTool();
    state.nodeTarget = "p";
    tool.down(ctx, ev(-30, 30));
    tool.move(ctx, ev(10, 50));
    tool.up(ctx, ev(10, 50));
    expect(state.nodeSel).toEqual([{ sub: 0, i: 1 }]);
  });

  it("Shift constrains a node drag to 45° in document space", () => {
    // Snapping off: this checks the constrain maths, not the snap targets.
    const { ctx, state } = fakeContext(curvedDoc(), { ...DEFAULT_PREFS, snap: false });
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [{ sub: 0, i: 0 }];
    tool.down(ctx, ev(0, 0));
    tool.move(ctx, ev(10, 3, { shift: true }));
    tool.up(ctx, ev(10, 3, { shift: true }));
    const n = target(state).subpaths[0].nodes[0];
    expect(n.p.x).toBeCloseTo(10);
    expect(n.p.y).toBe(0);
  });

  it("Shift-dragging a selected node does not toggle it out of the drag", () => {
    const { ctx, state } = fakeContext(curvedDoc(), { ...DEFAULT_PREFS, snap: false });
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [
      { sub: 0, i: 0 },
      { sub: 0, i: 1 },
    ];
    tool.down(ctx, ev(0, 0, { shift: true }));
    tool.move(ctx, ev(10, 4, { shift: true }));
    tool.up(ctx, ev(10, 4, { shift: true }));
    expect(state.nodeSel).toEqual([
      { sub: 0, i: 0 },
      { sub: 0, i: 1 },
    ]);
    expect(target(state).subpaths[0].nodes[0].p.x).toBeCloseTo(10);
  });

  it("a plain click on an already-selected node collapses the selection to it", () => {
    const { ctx, state } = fakeContext(curvedDoc());
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [
      { sub: 0, i: 0 },
      { sub: 0, i: 1 },
    ];
    tool.down(ctx, ev(0, 0));
    tool.up(ctx, ev(0, 0));
    expect(state.nodeSel).toEqual([{ sub: 0, i: 0 }]);
  });

  it("dragging an already-selected node keeps the multi-selection instead of collapsing it", () => {
    // Snapping off: only the selection outcome is under test here.
    const { ctx, state } = fakeContext(curvedDoc(), { ...DEFAULT_PREFS, snap: false });
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [
      { sub: 0, i: 0 },
      { sub: 0, i: 1 },
    ];
    tool.down(ctx, ev(0, 0));
    tool.move(ctx, ev(5, 5));
    tool.up(ctx, ev(5, 5));
    expect(state.nodeSel).toEqual([
      { sub: 0, i: 0 },
      { sub: 0, i: 1 },
    ]);
  });

  it("distinguishes a node's two handles for double-tap purposes", () => {
    const twoHandled: PathShape = {
      ...curvedPath(),
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 0, y: 0 }, in: { x: -10, y: -10 }, out: { x: 0, y: 40 }, type: "smooth" },
            { p: { x: 40, y: 0 }, in: { x: 40, y: 40 }, out: null, type: "smooth" },
          ],
        },
      ],
    };
    const d = createDoc(300, 200);
    const { ctx, state } = fakeContext({
      ...d,
      layers: [{ ...d.layers[0], children: [twoHandled] }],
    });
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [{ sub: 0, i: 0 }];
    // Tapping the `in` handle, then the `out` handle of the same node shortly after, must not
    // be read as a double tap on "the same thing" (it would otherwise have no effect here since
    // handles have no double-tap action, but the key must still distinguish them).
    tool.down(ctx, ev(-10, -10, {}, "mouse", 0));
    tool.up(ctx, ev(-10, -10, {}, "mouse", 0));
    tool.down(ctx, ev(0, 40, {}, "mouse", 100));
    tool.up(ctx, ev(0, 40, {}, "mouse", 100));
    expect(target(state).subpaths[0].nodes[0].type).toBe("smooth");
    expect(target(state).subpaths[0].nodes).toHaveLength(2);
  });

  it("a new pointer-down cancels a leftover gesture", () => {
    const { ctx, state } = fakeContext(curvedDoc());
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [{ sub: 0, i: 0 }];
    tool.down(ctx, ev(0, 0));
    tool.move(ctx, ev(5, 5));
    expect(state.session.gestureBase).not.toBeNull();
    tool.down(ctx, ev(250, 150));
    expect(state.session.gestureBase).toBeNull();
    expect(target(state).subpaths[0].nodes[0].p).toEqual({ x: 0, y: 0 });
  });

  it("a new pointer-down rolls back an abandoned marquee's selection", () => {
    // Shift keeps the pre-marquee selection as its base, so the rollback target is non-empty
    // and distinguishable from what the marquee itself picked up.
    const { ctx, state } = fakeContext(curvedDoc());
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [{ sub: 0, i: 0 }];
    tool.down(ctx, ev(-20, -20, { shift: true }));
    tool.move(ctx, ev(60, 20, { shift: true }));
    expect(state.nodeSel).toEqual([
      { sub: 0, i: 0 },
      { sub: 0, i: 1 },
    ]);
    // A fresh press elsewhere abandons the marquee; its selection change must roll back too.
    // (Shift again, only so the new marquee this press starts doesn't itself clear the
    // selection — which would mask whether the rollback happened.)
    tool.down(ctx, ev(250, 150, { shift: true }));
    expect(state.nodeSel).toEqual([{ sub: 0, i: 0 }]);
    expect(state.overlay).toBeNull();
  });

  it("keeps a Shift-constrained node drag exact even when a target sits near the locked axis", () => {
    // "p" (the drag target) sits at y 37 — away from the artboard's own snap lines (0/100/200)
    // so those can't mask the effect. "q" offers a node point at y 39, two pixels off — within
    // snapping range — that would otherwise pull a horizontally Shift-constrained drag's y off
    // its exact, locked value.
    const p: PathShape = {
      kind: "path",
      id: "p",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, stroke: { color: "#000000", opacity: 1 } },
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 0, y: 37 }, in: null, out: null, type: "corner" },
            { p: { x: 40, y: 37 }, in: null, out: null, type: "corner" },
          ],
        },
      ],
    };
    const q: PathShape = {
      kind: "path",
      id: "q",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, stroke: { color: "#000000", opacity: 1 } },
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 10, y: 39 }, in: null, out: null, type: "corner" },
            { p: { x: 60, y: 39 }, in: null, out: null, type: "corner" },
          ],
        },
      ],
    };
    const d = createDoc(300, 200);
    const { ctx, state } = fakeContext({
      ...d,
      layers: [{ ...d.layers[0], children: [p, q] }],
    });
    const tool = createNodeTool();
    state.nodeTarget = "p";
    state.nodeSel = [{ sub: 0, i: 0 }];
    tool.down(ctx, ev(0, 37));
    tool.move(ctx, ev(10, 40, { shift: true }));
    tool.up(ctx, ev(10, 40, { shift: true }));
    const n = (state.session.doc.layers[0].children[0] as PathShape).subpaths[0].nodes[0];
    expect(n.p.y).toBe(37);
  });
});
