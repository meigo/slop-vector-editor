import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, type PathShape, type Subpath } from "../doc/document";
import {
  appendNode,
  closeSubpath,
  deletePathNodes,
  insertNode,
  moveHandle,
  movePathNodes,
  reverseSubpath,
  setNodeType,
} from "../doc/path-edit";
import { cubicPoint, flattenSubpath, segmentCubic } from "../geom/bezier";
import { IDENTITY } from "../geom/mat";
import { deepFreeze } from "./helpers";

const path = (...subpaths: Subpath[]): PathShape =>
  deepFreeze({
    kind: "path",
    id: "p",
    transform: IDENTITY,
    style: DEFAULT_STYLE,
    subpaths,
  });
const corner = (x: number, y: number): Subpath["nodes"][number] => ({
  p: { x, y },
  in: null,
  out: null,
  type: "corner",
});
/** A quarter-ish curve from (0,0) to (10,0) bulging upward. */
const curved = (): Subpath => ({
  closed: false,
  nodes: [
    { p: { x: 0, y: 0 }, in: null, out: { x: 0, y: 10 }, type: "smooth" },
    { p: { x: 10, y: 0 }, in: { x: 10, y: 10 }, out: null, type: "smooth" },
  ],
});

describe("movePathNodes", () => {
  it("moves the point and its handles together", () => {
    const p = path(curved());
    const out = movePathNodes(p, [{ sub: 0, i: 0 }], 5, -2);
    const n = out.subpaths[0].nodes[0];
    expect(n.p).toEqual({ x: 5, y: -2 });
    expect(n.out).toEqual({ x: 5, y: 8 });
    expect(out.subpaths[0].nodes[1]).toBe(p.subpaths[0].nodes[1]);
  });

  it("ignores duplicates and unknown refs, and is a no-op for zero", () => {
    const p = path(curved());
    const twice = movePathNodes(
      p,
      [
        { sub: 0, i: 0 },
        { sub: 0, i: 0 },
      ],
      1,
      0,
    );
    expect(twice.subpaths[0].nodes[0].p).toEqual({ x: 1, y: 0 });
    expect(movePathNodes(p, [{ sub: 9, i: 0 }], 1, 1)).toBe(p);
    expect(movePathNodes(p, [{ sub: 0, i: 9 }], 1, 1)).toBe(p);
    expect(movePathNodes(p, [{ sub: 0, i: 0 }], 0, 0)).toBe(p);
  });
});

describe("moveHandle", () => {
  const node = (type: "corner" | "smooth" | "symmetric") =>
    path({
      closed: false,
      nodes: [
        corner(-10, 0),
        { p: { x: 0, y: 0 }, in: { x: -4, y: 0 }, out: { x: 2, y: 0 }, type },
        corner(10, 0),
      ],
    });

  it("mirrors exactly for a symmetric node", () => {
    const out = moveHandle(node("symmetric"), { sub: 0, i: 1 }, "out", { x: 0, y: 3 }, false);
    const n = out.subpaths[0].nodes[1];
    expect(n.out).toEqual({ x: 0, y: 3 });
    expect(n.in!.x).toBeCloseTo(0, 9);
    expect(n.in!.y).toBeCloseTo(-3, 9);
  });

  it("keeps the other handle's length for a smooth node", () => {
    const out = moveHandle(node("smooth"), { sub: 0, i: 1 }, "out", { x: 0, y: 3 }, false);
    const n = out.subpaths[0].nodes[1];
    expect(n.in!.x).toBeCloseTo(0, 9);
    expect(n.in!.y).toBeCloseTo(-4, 9);
  });

  it("leaves the other handle alone for a corner node", () => {
    const out = moveHandle(node("corner"), { sub: 0, i: 1 }, "out", { x: 0, y: 3 }, false);
    expect(out.subpaths[0].nodes[1].in).toEqual({ x: -4, y: 0 });
  });

  it("breaks symmetry with Alt, turning the node into a corner", () => {
    const out = moveHandle(node("symmetric"), { sub: 0, i: 1 }, "out", { x: 0, y: 3 }, true);
    const n = out.subpaths[0].nodes[1];
    expect(n.type).toBe("corner");
    expect(n.in).toEqual({ x: -4, y: 0 });
  });

  it("drops a handle dragged onto its own node", () => {
    const out = moveHandle(node("smooth"), { sub: 0, i: 1 }, "out", { x: 0, y: 0 }, false);
    expect(out.subpaths[0].nodes[1].out).toBeNull();
    const p = node("smooth");
    expect(moveHandle(p, { sub: 0, i: 1 }, "out", { x: 2, y: 0 }, false)).toBe(p);
    expect(moveHandle(p, { sub: 9, i: 0 }, "out", { x: 1, y: 1 }, false)).toBe(p);
  });
});

describe("insertNode", () => {
  it("splits a curve without moving the outline", () => {
    const p = path(curved());
    const before = segmentCubic(p.subpaths[0].nodes[0], p.subpaths[0].nodes[1])!;
    const r = insertNode(p, 0, 0, 0.5);
    expect(r.ref).toEqual({ sub: 0, i: 1 });
    const nodes = r.path.subpaths[0].nodes;
    expect(nodes).toHaveLength(3);
    expect(nodes[1].type).toBe("smooth");
    const first = segmentCubic(nodes[0], nodes[1])!;
    const second = segmentCubic(nodes[1], nodes[2])!;
    for (const u of [0, 0.5, 1]) {
      const whole = cubicPoint(before, u / 2);
      const half = cubicPoint(first, u);
      expect(half.x).toBeCloseTo(whole.x, 9);
      expect(half.y).toBeCloseTo(whole.y, 9);
      const late = cubicPoint(before, 0.5 + u / 2);
      const secondHalf = cubicPoint(second, u);
      expect(secondHalf.x).toBeCloseTo(late.x, 9);
      expect(secondHalf.y).toBeCloseTo(late.y, 9);
    }
  });

  it("splits a straight segment into a corner node", () => {
    const p = path({ closed: false, nodes: [corner(0, 0), corner(10, 0)] });
    const r = insertNode(p, 0, 0, 0.25);
    const n = r.path.subpaths[0].nodes[1];
    expect(n.p).toEqual({ x: 2.5, y: 0 });
    expect(n.type).toBe("corner");
    expect(n.in).toBeNull();
    expect(n.out).toBeNull();
  });

  it("splits a closed subpath's last segment", () => {
    const p = path({ closed: true, nodes: [corner(0, 0), corner(10, 0), corner(10, 10)] });
    const r = insertNode(p, 0, 2, 0.5);
    expect(r.ref).toEqual({ sub: 0, i: 3 });
    expect(r.path.subpaths[0].nodes[3].p).toEqual({ x: 5, y: 5 });
    expect(r.path.subpaths[0].closed).toBe(true);
    const same = insertNode(p, 9, 0, 0.5);
    expect(same.path).toBe(p);
  });
});

describe("deletePathNodes", () => {
  it("removes nodes, subpaths and finally the whole path", () => {
    const p = path({ closed: false, nodes: [corner(0, 0), corner(5, 0), corner(10, 0)] });
    const one = deletePathNodes(p, [{ sub: 0, i: 1 }])!;
    expect(one.subpaths[0].nodes.map((n) => n.p.x)).toEqual([0, 10]);
    expect(
      deletePathNodes(p, [
        { sub: 0, i: 0 },
        { sub: 0, i: 1 },
      ]),
    ).toBeNull();
    expect(deletePathNodes(p, [{ sub: 0, i: 9 }])).toBe(p);

    const two = path(
      { closed: false, nodes: [corner(0, 0), corner(10, 0)] },
      { closed: false, nodes: [corner(0, 5), corner(10, 5), corner(20, 5)] },
    );
    const gone = deletePathNodes(two, [{ sub: 0, i: 0 }])!;
    expect(gone.subpaths).toHaveLength(1);
    expect(gone.subpaths[0].nodes).toHaveLength(3);
  });
});

describe("setNodeType", () => {
  const bent = (type: "corner" | "smooth" | "symmetric") =>
    path({
      closed: false,
      nodes: [
        corner(-10, 0),
        { p: { x: 0, y: 0 }, in: { x: -4, y: 0 }, out: { x: 0, y: 2 }, type },
        corner(10, 0),
      ],
    });

  it("aligns the handles for smooth and equalises them for symmetric", () => {
    const smooth = setNodeType(bent("corner"), [{ sub: 0, i: 1 }], "smooth");
    const s = smooth.subpaths[0].nodes[1];
    expect(s.type).toBe("smooth");
    expect(s.in).toEqual({ x: -4, y: 0 });
    expect(s.out!.x).toBeCloseTo(2, 9);
    expect(s.out!.y).toBeCloseTo(0, 9);

    const sym = setNodeType(bent("corner"), [{ sub: 0, i: 1 }], "symmetric");
    const y = sym.subpaths[0].nodes[1];
    expect(y.in!.x).toBeCloseTo(-3, 9);
    expect(y.out!.x).toBeCloseTo(3, 9);
  });

  it("only changes the type when a node has fewer than two handles", () => {
    const p = path({ closed: false, nodes: [corner(0, 0), corner(10, 0)] });
    const out = setNodeType(p, [{ sub: 0, i: 0 }], "smooth");
    expect(out.subpaths[0].nodes[0].type).toBe("smooth");
    expect(out.subpaths[0].nodes[0].in).toBeNull();
    expect(setNodeType(out, [{ sub: 0, i: 0 }], "smooth")).toBe(out);
    expect(setNodeType(p, [{ sub: 0, i: 0 }], "corner")).toBe(p);
  });
});

describe("appendNode", () => {
  it("adds a node to the end of an open subpath", () => {
    const p = path({ closed: false, nodes: [corner(0, 0), corner(10, 0)] });
    const out = appendNode(p, 0, corner(20, 0));
    expect(out.subpaths[0].nodes.map((n) => n.p.x)).toEqual([0, 10, 20]);
    expect(out.subpaths[0].nodes[0]).toBe(p.subpaths[0].nodes[0]);
  });

  it("refuses a closed subpath and an unknown index", () => {
    const closed = path({ closed: true, nodes: [corner(0, 0), corner(10, 0)] });
    expect(appendNode(closed, 0, corner(20, 0))).toBe(closed);
    const p = path({ closed: false, nodes: [corner(0, 0), corner(10, 0)] });
    expect(appendNode(p, 9, corner(20, 0))).toBe(p);
  });
});

describe("reverseSubpath", () => {
  it("reverses the order and swaps the handles", () => {
    const p = path({
      closed: false,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: { x: 0, y: 10 }, type: "smooth" },
        { p: { x: 10, y: 0 }, in: { x: 10, y: 10 }, out: null, type: "smooth" },
      ],
    });
    const out = reverseSubpath(p, 0);
    const nodes = out.subpaths[0].nodes;
    expect(nodes.map((n) => n.p.x)).toEqual([10, 0]);
    expect(nodes[0].out).toEqual({ x: 10, y: 10 });
    expect(nodes[0].in).toBeNull();
    expect(nodes[1].in).toEqual({ x: 0, y: 10 });
    expect(nodes[1].out).toBeNull();
  });

  it("draws the same shape, and is its own inverse", () => {
    const p = path(curved());
    const once = reverseSubpath(p, 0);
    const twice = reverseSubpath(once, 0);
    expect(twice.subpaths[0]).toEqual(p.subpaths[0]);
    const before = flattenSubpath(p.subpaths[0]);
    const after = flattenSubpath(once.subpaths[0]).reverse();
    expect(after).toHaveLength(before.length);
    after.forEach((q, i) => {
      expect(q.x).toBeCloseTo(before[i].x, 9);
      expect(q.y).toBeCloseTo(before[i].y, 9);
    });
  });

  it("leaves a one-node subpath and an unknown index alone", () => {
    const one = path({ closed: false, nodes: [corner(0, 0)] });
    expect(reverseSubpath(one, 0)).toBe(one);
    const p = path(curved());
    expect(reverseSubpath(p, 9)).toBe(p);
  });
});

describe("closeSubpath", () => {
  it("closes an open subpath without repeating its first node", () => {
    const p = path({ closed: false, nodes: [corner(0, 0), corner(10, 0), corner(10, 10)] });
    const out = closeSubpath(p, 0);
    expect(out.subpaths[0].closed).toBe(true);
    expect(out.subpaths[0].nodes).toHaveLength(3);
    expect(closeSubpath(out, 0)).toBe(out);
    const short = path({ closed: false, nodes: [corner(0, 0)] });
    expect(closeSubpath(short, 0)).toBe(short);
    expect(closeSubpath(p, 9)).toBe(p);
  });
});
