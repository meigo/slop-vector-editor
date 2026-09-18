import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Layer,
  type Node,
  type PathShape,
} from "../doc/document";
import { mapNodes } from "../doc/tree";
import { IDENTITY, translate } from "../geom/mat";
import { DEFAULT_PREFS } from "../persist/preferences";
import { parseSvg } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";
import { createPenTool } from "../tools/pen";
import { ev, fakeContext } from "./fake-context";

const blank = (): Doc => createDoc(200, 200);
const noSnap = { ...DEFAULT_PREFS, snap: false };

const layer = (id: string, children: Node[] = []): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  children,
});

/** Two empty layers, so a test can make the second one current. */
const twoLayers = (): Doc => ({ ...createDoc(200, 200), layers: [layer("L0"), layer("L1")] });

const rect = (id: string, x: number, y: number, w: number, h: number): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x,
  y,
  w,
  h,
  rx: 0,
});

/** A 400×400 document with a rect at (100, 100): its corner is a snap target. */
const withRect = (): Doc => ({
  ...createDoc(400, 400),
  layers: [layer("L0", [rect("r", 100, 100, 60, 60)])],
});

/** A 400×400 document whose only snap target near (252, 252) is the x line at 250. */
const withCorner = (): Doc => ({
  ...createDoc(400, 400),
  layers: [layer("L0", [rect("r", 250, 0, 100, 20)])],
});

const paths = (d: Doc): PathShape[] =>
  d.layers.flatMap((l) => l.children).filter((n): n is PathShape => n.kind === "path");
/** A click: press and release without moving. */
const click = (
  tool: ReturnType<typeof createPenTool>,
  ctx: Parameters<typeof tool.down>[0],
  x: number,
  y: number,
  mods = {},
  time?: number,
) => {
  tool.down(ctx, ev(x, y, mods, "mouse", time));
  tool.up(ctx, ev(x, y, mods, "mouse", time));
};

describe("pen: drawing a new path", () => {
  it("draws a straight path from two clicks and finishes with Enter", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 10, 10);
    expect(paths(state.session.doc)).toHaveLength(0);
    expect(tool.busy?.()).toBe(true);
    click(tool, ctx, 50, 10);
    tool.keydown?.(ctx, "enter");
    const [p] = paths(state.session.doc);
    expect(p.subpaths[0].nodes.map((n) => n.p)).toEqual([
      { x: 10, y: 10 },
      { x: 50, y: 10 },
    ]);
    expect(p.subpaths[0].closed).toBe(false);
    expect(state.selection).toEqual([p.id]);
    expect(state.session.history.past).toHaveLength(1);
    expect(tool.busy?.()).toBe(false);
    expect(state.overlay).toBeNull();
  });

  it("pulls mirrored handles when a press drags, and Alt breaks them", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    tool.down(ctx, ev(40, 0));
    tool.move(ctx, ev(40, 20));
    tool.up(ctx, ev(40, 20));
    tool.keydown?.(ctx, "enter");
    const n = paths(state.session.doc)[0].subpaths[0].nodes[1];
    expect(n.out).toEqual({ x: 40, y: 20 });
    expect(n.in).toEqual({ x: 40, y: -20 });
    expect(n.type).toBe("symmetric");

    const second = fakeContext(blank(), noSnap);
    const t2 = createPenTool();
    click(t2, second.ctx, 0, 0);
    t2.down(second.ctx, ev(40, 0, { alt: true }));
    t2.move(second.ctx, ev(40, 20, { alt: true }));
    t2.up(second.ctx, ev(40, 20, { alt: true }));
    t2.keydown?.(second.ctx, "enter");
    const m = paths(second.state.session.doc)[0].subpaths[0].nodes[1];
    expect(m.out).toEqual({ x: 40, y: 20 });
    expect(m.in).toBeNull();
    expect(m.type).toBe("corner");
  });

  it("closes when the first node is clicked", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    click(tool, ctx, 40, 0);
    click(tool, ctx, 40, 40);
    click(tool, ctx, 0, 0);
    const sp = paths(state.session.doc)[0].subpaths[0];
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(3);
    expect(tool.busy?.()).toBe(false);
  });

  it("constrains to 45° with Shift", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    click(tool, ctx, 40, 6, { shift: true });
    tool.keydown?.(ctx, "enter");
    expect(paths(state.session.doc)[0].subpaths[0].nodes[1].p).toEqual({ x: 40, y: 0 });
  });

  it("removes the last node with Backspace, and discards a one-node draft", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    click(tool, ctx, 40, 0);
    click(tool, ctx, 80, 0);
    tool.keydown?.(ctx, "backspace");
    tool.keydown?.(ctx, "enter");
    expect(paths(state.session.doc)[0].subpaths[0].nodes).toHaveLength(2);

    const second = fakeContext(blank(), noSnap);
    const t2 = createPenTool();
    click(t2, second.ctx, 0, 0);
    t2.keydown?.(second.ctx, "enter");
    expect(paths(second.state.session.doc)).toHaveLength(0);
    expect(second.state.session.history.past).toHaveLength(0);
  });

  it("discards the draft on Escape and finishes on a double click", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    click(tool, ctx, 40, 0);
    tool.keydown?.(ctx, "escape");
    expect(paths(state.session.doc)).toHaveLength(0);
    expect(tool.busy?.()).toBe(false);
    expect(state.overlay).toBeNull();

    click(tool, ctx, 0, 0, {}, 0);
    click(tool, ctx, 40, 0, {}, 1000);
    click(tool, ctx, 40, 0, {}, 1100);
    expect(paths(state.session.doc)[0].subpaths[0].nodes).toHaveLength(2);
  });

  it("requires both timing and proximity for the second press to finish", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0, {}, 0);
    click(tool, ctx, 40, 0, {}, 100);
    // Within the double-tap time window, but far from where the last press landed: places a
    // third node instead of finishing the path.
    click(tool, ctx, 100, 0, {}, 200);
    expect(tool.busy?.()).toBe(true);
    tool.keydown?.(ctx, "enter");
    expect(paths(state.session.doc)[0].subpaths[0].nodes).toHaveLength(3);

    const second = fakeContext(blank(), noSnap);
    const t2 = createPenTool();
    click(t2, second.ctx, 0, 0, {}, 0);
    click(t2, second.ctx, 40, 0, {}, 100);
    // Within the window and at the same point as the last press: finishes.
    click(t2, second.ctx, 40, 0, {}, 200);
    expect(t2.busy?.()).toBe(false);
    expect(paths(second.state.session.doc)[0].subpaths[0].nodes).toHaveLength(2);
  });

  it("refuses a blocked layer and draws into the current one", () => {
    const d = blank();
    const locked: Doc = { ...d, layers: [{ ...d.layers[0], locked: true }] };
    const { ctx, state } = fakeContext(locked, noSnap);
    const tool = createPenTool();
    click(tool, ctx, 10, 10);
    expect(state.notices).toEqual(["“Layer 1” is locked — unlock it to draw."]);
    expect(tool.busy?.()).toBe(false);

    // The other half: a new path goes into the current layer, not the first one (invariant 25).
    const two = fakeContext(twoLayers(), noSnap);
    two.state.currentLayerId = "L1";
    const t2 = createPenTool();
    click(t2, two.ctx, 10, 10);
    click(t2, two.ctx, 50, 10);
    t2.keydown?.(two.ctx, "enter");
    const layers = two.state.session.doc.layers;
    expect(layers[0].children).toHaveLength(0);
    expect(layers[1].children.map((n) => n.kind)).toEqual(["path"]);
    expect(two.state.selection).toEqual([layers[1].children[0].id]);
  });

  it("commits into the current layer when the draft's own layer is gone", () => {
    const { ctx, state } = fakeContext(twoLayers(), noSnap);
    state.currentLayerId = "L1";
    const tool = createPenTool();
    click(tool, ctx, 10, 10);
    click(tool, ctx, 50, 10);
    // The layer the stroke started on is deleted mid-draft, exactly as `setSession` would leave
    // the store: the current layer falls back to the one that is left.
    const doc = state.session.doc;
    ctx.commit({ ...doc, layers: doc.layers.filter((l) => l.id !== "L1") });
    state.currentLayerId = "L0";
    expect(() => tool.keydown?.(ctx, "enter")).not.toThrow();
    expect(state.session.doc.layers[0].children.map((n) => n.kind)).toEqual(["path"]);
    expect(tool.busy?.()).toBe(false);

    // With no usable layer at all the drawing is dropped rather than throwing.
    const orphan = fakeContext(twoLayers(), noSnap);
    orphan.state.currentLayerId = "L1";
    const t2 = createPenTool();
    click(t2, orphan.ctx, 10, 10);
    click(t2, orphan.ctx, 50, 10);
    const d2 = orphan.state.session.doc;
    orphan.ctx.commit({ ...d2, layers: d2.layers.filter((l) => l.id !== "L1") });
    orphan.state.currentLayerId = "gone";
    const before = orphan.state.session.doc;
    expect(() => t2.keydown?.(orphan.ctx, "enter")).not.toThrow();
    expect(orphan.state.session.doc).toBe(before);
    expect(t2.busy?.()).toBe(false);
  });

  it("closes instead of repeating the first node when snapping pulls a press onto it", () => {
    // Spec §9 / the M4b constraint: a closed subpath whose last node repeats its first loses a
    // node on reload. The close tolerance is 6px for a mouse but snapping reaches 8px.
    const { ctx, state } = fakeContext(withRect(), DEFAULT_PREFS);
    const tool = createPenTool();
    click(tool, ctx, 102, 102); // snaps onto the rect's corner at (100, 100)
    click(tool, ctx, 250, 330);
    click(tool, ctx, 105, 105); // 7.07px away — outside the close tolerance, inside the snap
    const sp = paths(state.session.doc)[0].subpaths[0];
    expect(sp.closed).toBe(true);
    expect(sp.nodes.map((n) => n.p)).toEqual([
      { x: 100, y: 100 },
      { x: 250, y: 330 },
    ]);
    // And the file round-trips with the same node count.
    const reread = parseSvg(serializeDoc(state.session.doc)).doc;
    const back = reread.layers.flatMap((l) => l.children).find((n) => n.kind === "path");
    expect(back?.kind === "path" && back.subpaths[0].nodes).toHaveLength(2);
  });

  it("ignores a press that snapping puts on top of the previous node", () => {
    const { ctx, state } = fakeContext(withRect(), DEFAULT_PREFS);
    const tool = createPenTool();
    click(tool, ctx, 102, 102); // → (100, 100)
    click(tool, ctx, 104, 104); // → (100, 100) again: a zero-length segment, so nothing is placed
    const o = state.overlay as { knobs: unknown[] };
    expect(o.knobs).toHaveLength(1);
    tool.keydown?.(ctx, "enter");
    expect(paths(state.session.doc)).toHaveLength(0);
  });

  it("keeps a Shift-constrained point on its 45° ray when a snap target is near", () => {
    const { ctx, state } = fakeContext(withCorner(), DEFAULT_PREFS);
    const tool = createPenTool();
    click(tool, ctx, 100, 100);
    click(tool, ctx, 255, 250, { shift: true });
    tool.keydown?.(ctx, "enter");
    const p = paths(state.session.doc)[0].subpaths[0].nodes[1].p;
    // x = 250 is a snap target (the rect's left edge); taking it would tilt the segment.
    expect(p.x).toBeCloseTo(252.5, 6);
    expect(p.y).toBeCloseTo(252.5, 6);
    expect(p.x - 100).toBeCloseTo(p.y - 100, 6);
  });

  it("flattens the draft's outline at the on-screen scale", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    tool.down(ctx, ev(100, 0));
    tool.move(ctx, ev(100, 40));
    tool.up(ctx, ev(100, 40));
    const at1 = (state.overlay as { outline: unknown[][] }).outline[0].length;
    state.view = { x: 0, y: 0, zoom: 16 };
    tool.hover?.(ctx, ev(120, 40));
    const at16 = (state.overlay as { outline: unknown[][] }).outline[0].length;
    expect(at16).toBeGreaterThan(at1);
  });

  it("fills the first knob only while a press would close the path", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    click(tool, ctx, 40, 0);
    tool.hover?.(ctx, ev(100, 100));
    expect((state.overlay as { closeHint: boolean }).closeHint).toBe(false);
    tool.hover?.(ctx, ev(2, 2));
    expect((state.overlay as { closeHint: boolean }).closeHint).toBe(true);
  });

  it("shows the draft and a rubber band while hovering", () => {
    const { ctx, state } = fakeContext(blank(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 0, 0);
    click(tool, ctx, 40, 0);
    tool.hover?.(ctx, ev(60, 20));
    expect(state.overlay?.kind).toBe("pen");
    const o = state.overlay as { knobs: unknown[]; rubber: { a: unknown; b: unknown } | null };
    expect(o.knobs).toHaveLength(2);
    expect(o.rubber).toEqual({ a: { x: 40, y: 0 }, b: { x: 60, y: 20 } });
    tool.cancel(ctx);
    expect(tool.busy?.()).toBe(true);
  });
});

describe("pen: resuming an open path", () => {
  const withPath = (closed = false): Doc => {
    const d = createDoc(200, 200);
    const path: PathShape = {
      kind: "path",
      id: "p",
      transform: translate(100, 0),
      style: DEFAULT_PREFS.style,
      subpaths: [
        {
          closed,
          nodes: [
            { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
            { p: { x: 40, y: 0 }, in: null, out: null, type: "corner" },
          ],
        },
      ],
    };
    return { ...d, layers: [{ ...d.layers[0], children: [path] }] };
  };

  it("continues from the last node", () => {
    const { ctx, state } = fakeContext(withPath(), noSnap);
    const tool = createPenTool();
    // The path sits at x 100–140 in document space.
    click(tool, ctx, 140, 0);
    expect(tool.busy?.()).toBe(true);
    click(tool, ctx, 180, 0);
    tool.keydown?.(ctx, "enter");
    const sp = paths(state.session.doc)[0].subpaths[0];
    expect(sp.nodes.map((n) => n.p.x)).toEqual([0, 40, 80]);
    expect(state.session.history.past).toHaveLength(1);
    expect(state.selection).toEqual(["p"]);
  });

  it("reverses when it starts from the first node, so drawing still appends", () => {
    const { ctx, state } = fakeContext(withPath(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 100, 0);
    click(tool, ctx, 60, 0);
    tool.keydown?.(ctx, "enter");
    const sp = paths(state.session.doc)[0].subpaths[0];
    expect(sp.nodes.map((n) => n.p.x)).toEqual([40, 0, -40]);
  });

  it("closes the path when the other end is clicked", () => {
    const { ctx, state } = fakeContext(withPath(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 140, 0);
    click(tool, ctx, 140, 40);
    click(tool, ctx, 100, 0);
    const sp = paths(state.session.doc)[0].subpaths[0];
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(3);
  });

  /** Moves one node of path "p", standing in for any edit made while a draft is open (an undo, a
   *  nudge, the node tool). */
  const moveNode = (doc: Doc, i: number, dy: number): Doc =>
    mapNodes(doc, ["p"], (n) => {
      if (n.kind !== "path") return n;
      const nodes = n.subpaths[0].nodes.map((node, j) =>
        j === i ? { ...node, p: { x: node.p.x, y: node.p.y + dy } } : node,
      );
      return { ...n, subpaths: [{ ...n.subpaths[0], nodes }] };
    });

  it("appends only this stroke's nodes, over the path as it is at commit time", () => {
    const { ctx, state } = fakeContext(withPath(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 140, 0);
    click(tool, ctx, 180, 0);
    // The path changes under the open draft; the copy taken at resume is now stale.
    ctx.commit(moveNode(state.session.doc, 0, 20));
    tool.keydown?.(ctx, "enter");
    expect(paths(state.session.doc)[0].subpaths[0].nodes.map((n) => n.p)).toEqual([
      { x: 0, y: 20 },
      { x: 40, y: 0 },
      { x: 80, y: 0 },
    ]);
  });

  it("reverses the subpath as it is now, not the copy taken at resume", () => {
    const { ctx, state } = fakeContext(withPath(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 100, 0); // resume from the first node: the draft is reversed
    ctx.commit(moveNode(state.session.doc, 1, 20));
    click(tool, ctx, 60, 0);
    tool.keydown?.(ctx, "enter");
    expect(paths(state.session.doc)[0].subpaths[0].nodes.map((n) => n.p)).toEqual([
      { x: 40, y: 20 },
      { x: 0, y: 0 },
      { x: -40, y: 0 },
    ]);
  });

  it("Backspace stops at the resumed path's own nodes", () => {
    const { ctx, state } = fakeContext(withPath(), noSnap);
    const tool = createPenTool();
    click(tool, ctx, 140, 0);
    // Nothing has been placed yet, so there is nothing to remove — and the draft stays open.
    tool.keydown?.(ctx, "backspace");
    tool.keydown?.(ctx, "backspace");
    expect(tool.busy?.()).toBe(true);
    click(tool, ctx, 180, 0);
    tool.keydown?.(ctx, "enter");
    expect(paths(state.session.doc)[0].subpaths[0].nodes.map((n) => n.p.x)).toEqual([0, 40, 80]);
  });

  it("resumes a path nested in a group, through its parent's matrix", () => {
    const d = createDoc(400, 400);
    const path: PathShape = {
      kind: "path",
      id: "p",
      transform: translate(0, 50),
      style: DEFAULT_PREFS.style,
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
            { p: { x: 40, y: 0 }, in: null, out: null, type: "corner" },
          ],
        },
      ],
    };
    const group: Node = {
      kind: "group",
      id: "g",
      transform: translate(100, 0),
      opacity: 1,
      children: [path],
    };
    const nested: Doc = { ...d, layers: [{ ...d.layers[0], children: [group] }] };
    const { ctx, state } = fakeContext(nested, noSnap);
    const tool = createPenTool();
    // The path's world matrix is translate(100, 50), so its last node sits at (140, 50).
    click(tool, ctx, 140, 50);
    expect(tool.busy?.()).toBe(true);
    click(tool, ctx, 180, 50);
    tool.keydown?.(ctx, "enter");
    const g = state.session.doc.layers[0].children[0];
    const inner = g.kind === "group" ? (g.children[0] as PathShape) : null;
    expect(inner?.subpaths[0].nodes.map((n) => n.p)).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 80, y: 0 },
    ]);
  });

  it("skips a path whose world matrix is singular instead of throwing", () => {
    const d = createDoc(200, 200);
    const flat: PathShape = {
      kind: "path",
      id: "p",
      transform: [0, 0, 0, 0, 0, 0],
      style: DEFAULT_PREFS.style,
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
            { p: { x: 40, y: 0 }, in: null, out: null, type: "corner" },
          ],
        },
      ],
    };
    const { ctx, state } = fakeContext(
      { ...d, layers: [{ ...d.layers[0], children: [flat] }] },
      noSnap,
    );
    const tool = createPenTool();
    // Every node of that path maps to (0, 0); a press there must not try to resume it.
    expect(() => click(tool, ctx, 0, 0)).not.toThrow();
    click(tool, ctx, 40, 40);
    tool.keydown?.(ctx, "enter");
    // A second, brand-new path — the singular one is untouched.
    expect(paths(state.session.doc)).toHaveLength(2);
    expect(paths(state.session.doc)[0].subpaths[0].nodes).toHaveLength(2);
  });

  it("leaves the path untouched on Escape, and ignores a closed path", () => {
    const { ctx, state } = fakeContext(withPath(), noSnap);
    const tool = createPenTool();
    const before = state.session.doc;
    click(tool, ctx, 140, 0);
    click(tool, ctx, 180, 0);
    tool.keydown?.(ctx, "escape");
    expect(state.session.doc).toBe(before);

    const shut = fakeContext(withPath(true), noSnap);
    const t2 = createPenTool();
    click(t2, shut.ctx, 140, 0);
    click(t2, shut.ctx, 180, 0);
    t2.keydown?.(shut.ctx, "enter");
    // A closed path can't be resumed, so this drew a new one.
    expect(paths(shut.state.session.doc)).toHaveLength(2);
  });
});
