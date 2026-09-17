import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Layer, type Node } from "../doc/document";
import { IDENTITY, translate } from "../geom/mat";
import {
  collectTargets,
  hasGuides,
  NO_GUIDES,
  SNAP_PX,
  snapBox,
  snapPoint,
  snapValue,
} from "../geom/snap";
import { deepFreeze } from "./helpers";

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

const layer = (id: string, children: Node[], over: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  children,
  ...over,
});

describe("snapValue", () => {
  it("picks the closest target within the threshold", () => {
    expect(SNAP_PX).toBe(8);
    expect(snapValue([10], [0, 12, 50], 3)).toEqual({ delta: 2, at: 12 });
    expect(snapValue([10], [0, 12, 50], 1)).toBeNull();
    expect(snapValue([], [1], 5)).toBeNull();
  });

  it("breaks ties by earlier value, then smaller target", () => {
    expect(snapValue([10, 20], [12, 18], 5)).toEqual({ delta: 2, at: 12 });
    expect(snapValue([10], [8, 12], 5)).toEqual({ delta: -2, at: 8 });
  });
});

describe("collectTargets", () => {
  it("uses the artboard and visible top-level bounds, skipping excluded ids", () => {
    const base = createDoc(100, 50);
    const doc: Doc = {
      ...base,
      layers: [
        layer("L0", [rect("a", 10, 10, 20, 20), rect("b", 50, 0, 10, 10)]),
        layer("L1", [rect("c", 80, 0, 10, 10)], { visible: false }),
        layer("L2", [rect("d", 70, 30, 10, 10)], { locked: true }),
      ],
    };
    expect(collectTargets(doc, ["b"])).toEqual({
      xs: [0, 10, 20, 30, 50, 70, 75, 80, 100],
      ys: [0, 10, 20, 25, 30, 30, 35, 40, 50],
    });
  });
});

describe("snapBox and snapPoint", () => {
  const targets = { xs: [0, 50, 100], ys: [0, 25, 50] };

  it("snaps a box by its edges and centre, per enabled axis", () => {
    expect(snapBox({ x: 48, y: 0, w: 10, h: 10 }, targets, 3)).toEqual({
      dx: 2,
      dy: 0,
      guides: { xs: [50], ys: [0] },
    });
    expect(snapBox({ x: 48, y: 0, w: 10, h: 10 }, targets, 3, { x: true, y: false })).toEqual({
      dx: 2,
      dy: 0,
      guides: { xs: [50], ys: [] },
    });
    expect(snapBox({ x: 20, y: 10, w: 5, h: 5 }, targets, 3)).toEqual({
      dx: 0,
      dy: 0,
      guides: NO_GUIDES,
    });
  });

  it("snaps a point", () => {
    expect(snapPoint({ x: 49, y: 26 }, targets, 2)).toEqual({
      p: { x: 50, y: 25 },
      guides: { xs: [50], ys: [25] },
    });
    const none = snapPoint({ x: 49, y: 26 }, targets, 0.5);
    expect(none.p).toEqual({ x: 49, y: 26 });
    expect(hasGuides(none.guides)).toBe(false);
    expect(snapPoint({ x: 49, y: 26 }, targets, 2, { x: false, y: true }).p).toEqual({
      x: 49,
      y: 25,
    });
  });
});

describe("node snapping", () => {
  it("offers path node points when asked", () => {
    const d = deepFreeze({
      ...createDoc(100, 100),
      layers: [
        {
          id: "L0",
          name: "L0",
          visible: true,
          locked: false,
          children: [
            {
              kind: "path",
              id: "p",
              transform: translate(5, 0),
              style: DEFAULT_STYLE,
              subpaths: [
                {
                  closed: false,
                  nodes: [
                    { p: { x: 10, y: 20 }, in: null, out: null, type: "corner" },
                    { p: { x: 30, y: 40 }, in: null, out: null, type: "corner" },
                  ],
                },
              ],
            } as Node,
          ],
        },
      ],
    });
    const withNodes = collectTargets(d, [], { nodes: true });
    expect(withNodes.xs).toContain(15);
    expect(withNodes.ys).toContain(20);
    // 15 is the first node's x; the bounds alone would only offer the box edges and centre.
    expect(collectTargets(d, []).xs).not.toContain(20);
    expect(collectTargets(d, [], { nodes: true }).xs).toContain(35);
    expect(collectTargets(d, ["p"], { nodes: true }).xs).not.toContain(15);
  });
});
