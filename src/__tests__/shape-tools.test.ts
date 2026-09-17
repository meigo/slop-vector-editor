import { describe, expect, it } from "vitest";
import {
  createDoc,
  type Doc,
  type PathShape,
  type PolygonShape,
  type RectShape,
  type EllipseShape,
} from "../doc/document";
import { applyMat, IDENTITY } from "../geom/mat";
import { polygonSubpath } from "../geom/shapes";
import { DEFAULT_PREFS } from "../persist/preferences";
import {
  createEllipseTool,
  createHandTool,
  createLineTool,
  createPolygonTool,
  createRectTool,
  dragBox,
  lineStyle,
  snapLineEnd,
} from "../tools/shape-tools";
import { movedEnough, pointerTolerance, type Tool } from "../tools/tool";
import { NO_MODS } from "../tools/types";
import { ev, fakeContext } from "./fake-context";

const blank = (): Doc => createDoc(100, 100);

function drag(
  tool: Tool,
  ctx: ReturnType<typeof fakeContext>["ctx"],
  from: [number, number],
  to: [number, number],
  mods = {},
) {
  tool.down(ctx, ev(from[0], from[1], mods));
  tool.move(ctx, ev((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, mods));
  tool.move(ctx, ev(to[0], to[1], mods));
  tool.up(ctx, ev(to[0], to[1], mods));
}

const children = (d: Doc) => d.layers[0].children;

describe("tool helpers", () => {
  it("measures tolerance and drag distance", () => {
    expect(pointerTolerance("mouse")).toBe(6);
    expect(pointerTolerance("touch")).toBe(14);
    expect(movedEnough({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true);
    expect(movedEnough({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  it("builds drag boxes", () => {
    expect(dragBox({ x: 10, y: 10 }, { x: 0, y: 30 }, NO_MODS)).toEqual({
      x: 0,
      y: 10,
      w: 10,
      h: 20,
    });
    expect(dragBox({ x: 10, y: 10 }, { x: 0, y: 30 }, { shift: true, alt: false })).toEqual({
      x: -10,
      y: 10,
      w: 20,
      h: 20,
    });
    expect(dragBox({ x: 10, y: 10 }, { x: 15, y: 12 }, { shift: false, alt: true })).toEqual({
      x: 5,
      y: 8,
      w: 10,
      h: 4,
    });
  });

  it("snaps line ends to 45° and gives lines a stroke", () => {
    const p = snapLineEnd({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.x).toBeCloseTo(Math.hypot(10, 1));
    expect(p.y).toBeCloseTo(0);
    const q = snapLineEnd({ x: 0, y: 0 }, { x: 10, y: 9 });
    expect(q.x).toBeCloseTo(q.y);
    expect(lineStyle({ ...DEFAULT_PREFS.style, stroke: null }).stroke).toEqual({
      color: "#000000",
      opacity: 1,
    });
    expect(lineStyle(DEFAULT_PREFS.style).fill).toBeNull();
  });
});

describe("rect tool", () => {
  it("draws a rect as one undo step and selects it", () => {
    const { ctx, state } = fakeContext(blank());
    drag(createRectTool(), ctx, [10, 10], [40, 30]);
    const [r] = children(state.session.doc) as RectShape[];
    expect(r).toMatchObject({ kind: "rect", id: "n2", x: 10, y: 10, w: 30, h: 20, rx: 0 });
    expect(r.style).toEqual(DEFAULT_PREFS.style);
    expect(state.selection).toEqual(["n2"]);
    expect(state.session.history.past).toHaveLength(1);
    expect(state.session.gestureBase).toBeNull();
  });

  it("honours Shift and Alt", () => {
    const { ctx, state } = fakeContext(blank());
    drag(createRectTool(), ctx, [10, 10], [40, 20], { shift: true, alt: true });
    expect(children(state.session.doc)[0]).toMatchObject({ x: -20, y: -20, w: 60, h: 60 });
  });

  it("creates nothing for a tiny or zero-area drag", () => {
    const { ctx, state } = fakeContext(blank());
    const tool = createRectTool();
    drag(tool, ctx, [10, 10], [11, 10]);
    drag(tool, ctx, [10, 10], [40, 10]);
    expect(children(state.session.doc)).toHaveLength(0);
    expect(state.session.history.past).toHaveLength(0);
    expect(state.selection).toEqual([]);
  });

  it("removes the shape when a drag comes back to its start, and on cancel", () => {
    const { ctx, state } = fakeContext(blank());
    const tool = createRectTool();
    tool.down(ctx, ev(10, 10));
    tool.move(ctx, ev(40, 40));
    expect(children(state.session.doc)).toHaveLength(1);
    tool.move(ctx, ev(10, 10));
    expect(children(state.session.doc)).toHaveLength(0);
    tool.move(ctx, ev(40, 40));
    tool.cancel(ctx);
    expect(children(state.session.doc)).toHaveLength(0);
    expect(state.session.history.past).toHaveLength(0);
    expect(state.session.gestureBase).toBeNull();
    tool.move(ctx, ev(50, 50)); // ignored after cancel
    expect(children(state.session.doc)).toHaveLength(0);
  });

  it("draws consecutive shapes with fresh ids", () => {
    const { ctx, state } = fakeContext(blank());
    const tool = createRectTool();
    drag(tool, ctx, [0, 0], [10, 10]);
    drag(tool, ctx, [20, 0], [30, 10]);
    expect(children(state.session.doc).map((n) => n.id)).toEqual(["n2", "n3"]);
    expect(state.selection).toEqual(["n3"]);
    expect(state.session.history.past).toHaveLength(2);
  });

  it("refuses to draw on a hidden or locked current layer", () => {
    const d = blank();
    const locked: Doc = { ...d, layers: [{ ...d.layers[0], locked: true }] };
    const l = fakeContext(locked);
    drag(createRectTool(), l.ctx, [0, 0], [10, 10]);
    expect(children(l.state.session.doc)).toHaveLength(0);
    expect(l.state.notices).toEqual(['"Layer 1" is locked — unlock it to draw.']);
    const hidden: Doc = { ...d, layers: [{ ...d.layers[0], visible: false }] };
    const h = fakeContext(hidden);
    drag(createRectTool(), h.ctx, [0, 0], [10, 10]);
    expect(h.state.notices).toEqual(['"Layer 1" is hidden — show it to draw.']);
  });

  it("draws into the current layer", () => {
    const d = blank();
    const two: Doc = { ...d, layers: [d.layers[0], { ...d.layers[0], id: "top", name: "Top" }] };
    const { ctx, state } = fakeContext(two);
    expect(state.currentLayerId).toBe("top");
    state.currentLayerId = d.layers[0].id;
    drag(createRectTool(), ctx, [0, 0], [10, 10]);
    expect(state.session.doc.layers[0].children).toHaveLength(1);
    expect(state.session.doc.layers[1].children).toHaveLength(0);
  });
});

describe("ellipse, line and polygon tools", () => {
  it("draws an ellipse inside the drag box", () => {
    const { ctx, state } = fakeContext(blank());
    drag(createEllipseTool(), ctx, [0, 0], [20, 10]);
    expect(children(state.session.doc)[0] as EllipseShape).toMatchObject({
      kind: "ellipse",
      cx: 10,
      cy: 5,
      rx: 10,
      ry: 5,
    });
  });

  it("draws a line path, snapped with Shift", () => {
    const { ctx, state } = fakeContext(blank());
    drag(createLineTool(), ctx, [0, 0], [10, 1], { shift: true });
    const line = children(state.session.doc)[0] as PathShape;
    expect(line.kind).toBe("path");
    expect(line.style.fill).toBeNull();
    const [a, b] = line.subpaths[0].nodes;
    expect(a.p).toEqual({ x: 0, y: 0 });
    expect(b.p.y).toBeCloseTo(0);
    expect(line.subpaths[0].closed).toBe(false);
  });

  it("draws live polygons and stars from the preferences", () => {
    const poly = fakeContext(blank());
    drag(createPolygonTool(), poly.ctx, [50, 50], [60, 50]);
    const p = children(poly.state.session.doc)[0] as PolygonShape;
    expect(p).toMatchObject({
      kind: "polygon",
      cx: 50,
      cy: 50,
      rx: 10,
      ry: 10,
      sides: 5,
      star: false,
      innerRatio: 0.5,
    });
    // Some corner points at the pointer, using the smallest equivalent rotation.
    const tips = polygonSubpath(p).nodes.map((n) => applyMat(p.transform, n.p));
    expect(tips.some((t) => Math.abs(t.x - 60) < 1e-9 && Math.abs(t.y - 50) < 1e-9)).toBe(true);
    const t = p.transform;
    expect(Math.abs(Math.atan2(t[1], t[0]))).toBeLessThanOrEqual(Math.PI / 5 + 1e-12);

    const starPrefs = { ...DEFAULT_PREFS, polygon: { sides: 6, star: true, innerRatio: 0.4 } };
    const star = fakeContext(blank(), starPrefs);
    drag(createPolygonTool(), star.ctx, [50, 50], [60, 50], { shift: true });
    const s = children(star.state.session.doc)[0] as PolygonShape;
    expect(s).toMatchObject({ kind: "polygon", sides: 6, star: true, innerRatio: 0.4 });
    expect(s.transform).toBe(IDENTITY);
    expect(polygonSubpath(s).nodes).toHaveLength(12);
    expect(polygonSubpath(s).nodes[0].p.x).toBeCloseTo(50);
    expect(polygonSubpath(s).nodes[0].p.y).toBeCloseTo(40);
  });

  it("draws a square dragged sideways unrotated", () => {
    const prefs = { ...DEFAULT_PREFS, polygon: { sides: 4, star: false, innerRatio: 0.5 } };
    const { ctx, state } = fakeContext(blank(), prefs);
    drag(createPolygonTool(), ctx, [50, 50], [60, 50]);
    expect((children(state.session.doc)[0] as PolygonShape).transform).toBe(IDENTITY);
  });

  it("keeps an upward drag unrotated", () => {
    const { ctx, state } = fakeContext(blank());
    drag(createPolygonTool(), ctx, [50, 50], [50, 40]);
    expect((children(state.session.doc)[0] as PolygonShape).transform).toBe(IDENTITY);
  });

  it("has a hand tool that never edits", () => {
    const { ctx, state } = fakeContext(blank());
    drag(createHandTool(), ctx, [0, 0], [10, 10]);
    expect(children(state.session.doc)).toHaveLength(0);
    expect(createHandTool().cursor).toBe("grab");
  });
});

describe("snapping while drawing", () => {
  const withRect = (): Doc => {
    const d = createDoc(100, 100);
    return {
      ...d,
      layers: [
        {
          ...d.layers[0],
          children: [
            {
              kind: "rect",
              id: "a",
              transform: IDENTITY,
              style: DEFAULT_PREFS.style,
              x: 20,
              y: 20,
              w: 10,
              h: 10,
              rx: 0,
            },
          ],
        },
      ],
    };
  };

  it("snaps the start and current points to the artboard and shows guides", () => {
    const { ctx, state } = fakeContext(blank());
    const tool = createRectTool();
    tool.down(ctx, ev(1, 1));
    tool.move(ctx, ev(48, 30));
    expect(state.overlay).toEqual({ kind: "guides", xs: [50], ys: [] });
    tool.up(ctx, ev(48, 30));
    expect(children(state.session.doc)[0]).toMatchObject({ x: 0, y: 0, w: 50, h: 30 });
    expect(state.overlay).toBeNull();
  });

  it("snaps to other objects' edges", () => {
    const { ctx, state } = fakeContext(withRect());
    drag(createRectTool(), ctx, [60, 60], [31, 71]);
    expect(children(state.session.doc)[1]).toMatchObject({ x: 30, y: 60, w: 30, h: 11 });
  });

  it("does nothing when Snap is off", () => {
    const { ctx, state } = fakeContext(blank(), { ...DEFAULT_PREFS, snap: false });
    drag(createRectTool(), ctx, [1, 1], [48, 30]);
    expect(children(state.session.doc)[0]).toMatchObject({ x: 1, y: 1, w: 47, h: 29 });
    expect(state.overlay).toBeNull();
  });

  it("uses a screen-sized threshold", () => {
    const { ctx, state } = fakeContext(blank());
    state.view = { x: 0, y: 0, zoom: 4 };
    drag(createRectTool(), ctx, [3, 3], [40, 40]);
    expect(children(state.session.doc)[0]).toMatchObject({ x: 3, y: 3 });
  });

  it("does not snap a Shift-constrained line end", () => {
    const { ctx, state } = fakeContext(blank());
    drag(createLineTool(), ctx, [1, 1], [48, 3], { shift: true });
    const line = children(state.session.doc)[0] as PathShape;
    const [a, b] = line.subpaths[0].nodes;
    expect(a.p).toEqual({ x: 0, y: 0 });
    expect(b.p.x).toBeCloseTo(Math.hypot(48, 3));
    expect(b.p.y).toBeCloseTo(0);
  });

  it("clears the guides on cancel", () => {
    const { ctx, state } = fakeContext(blank());
    const tool = createRectTool();
    tool.down(ctx, ev(1, 1));
    tool.move(ctx, ev(48, 30));
    tool.cancel(ctx);
    expect(state.overlay).toBeNull();
  });
});
