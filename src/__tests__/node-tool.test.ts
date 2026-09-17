import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node, type PathShape } from "../doc/document";
import { IDENTITY } from "../geom/mat";
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
});
