# Milestone 4a — Node Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node tool that edits an existing path — move nodes and handles, add and delete nodes, change node types, close a subpath — with the nodes drawn on the canvas, snapping, and Properties.

**Architecture:**
- **Pure path edits** live in `src/doc/path-edit.ts` and take and return a `PathShape`; they never produce a path the importer would drop.
- **Two geometry helpers** carry the hard maths: `splitCubic` (insert a node without moving the outline) and `nearestOnSubpath` (what the pointer is over).
- **What is being edited** is store state (`app.nodeTarget`, `app.nodeSel`), reached by tools through `ToolContext` — the same shape as M3a's current layer and M3b's entered group.
- **The tool** works in the path's own space, mapping the pointer through the inverse of the path's world matrix, so a path inside a transformed group edits correctly.

**Tech Stack:** Svelte 5.55 (runes), TypeScript strict, Vite 8, Tailwind 4, Vitest 4 (node env), `@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-09-17-m4a-node-editing-design.md` (binding). It builds on the M3a and M3b specs and on CLAUDE.md.

## Global Constraints

- **Checks:** `npm run build` ends with **0 errors, 0 warnings**; `npm run lint` silent; `npm test` passes; `npm run format:check` clean. Run `npx prettier --write` on touched files before committing.
- **Tests:** Vitest has no DOM. Only pure logic is unit-tested; UI is gated by the build, a dev-server compile check on port 5199 (never the user's `:5173`), and the controller's browser pass.
- **The document is immutable**; every edit returns the **same reference** when nothing changes.
- **Nothing may create a path the importer drops:** a subpath needs at least two nodes, a path needs at least one subpath, and a closed subpath must never repeat its first node as its last (the writer emits `Z`, and the importer merges a coincident last node away).
- **Transforms:** node coordinates are in the path's own space. The tool converts the pointer with the inverse of the path's world matrix (`findNode`'s `parent` composed with the node's own transform) and does nothing when that matrix is singular.
- **Store actions** that change the document call `cancelActiveGesture()` first and commit exactly one undo step; every session change goes through `setSession`. `setNodeTarget`/`setNodeSel` change no document and commit nothing.
- **Tools never import the store** (`ToolContext` only) and never import from `src/lib/`.
- **UI:** theme tokens only; one class expression per element; state never moves layout; every `title` reads as an action, because it is also the status-bar hint.
- **Existing tests keep their expected values** unless a step says otherwise.
- **Dry run:** the controller applied Tasks 1–6 to `main` in a throwaway worktree before execution — 383 tests, build 0/0, lint and format clean, and node editing checked in a browser (nodes and handles drawn, the Node section live). The code and tests below are the verified versions; where a step names an import or an existing expectation, that is what the dry run actually needed.
- **Commit trailer**, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. One commit per task.
- **Git:** branch `m4a-node-editing` off `main` (the controller creates it).

## File map

```
src/geom/bezier.ts          + splitCubic, nearestOnSubpath; flattenCubic/flattenSubpath take a scale
src/geom/hit.ts             flatten caches key on the scale bucket; path hit-testing passes the world scale
src/svg/pathdata.ts         the coincident-point tolerance matches the writer's rounding
src/doc/path-edit.ts        + NodeRef and the six pure edits
src/state/appState.svelte.ts + nodeTarget/nodeSel state and actions; Escape chain; Delete/nudge routing
src/tools/types.ts          ToolId gains "node"
src/tools/tool.ts, context.ts, __tests__/fake-context.ts   + nodeTarget/setNodeTarget/nodeSel/setNodeSel
src/tools/node-tool.ts      + the tool
src/tools/registry.ts       + the instance
src/tools/select.ts         double-click a path → the node tool
src/state/keys.ts           n → node tool
src/lib/ToolStrip.svelte    + the button
src/lib/Overlay.svelte      + nodes, handles and the path outline
src/geom/snap.ts            collectTargets takes { nodes }
src/lib/PropertiesPanel.svelte, ContextMenu.svelte   + the Node section and items
CLAUDE.md, README.md, docs/superpowers/CHANGELOG.md
```

---

### Task 1: Geometry for splitting and picking

**Files:**
- Modify: `src/geom/bezier.ts`, `src/geom/hit.ts`, `src/svg/pathdata.ts`
- Test: `src/__tests__/box-bezier.test.ts` (extended), `src/__tests__/parse.test.ts` (extended)

**Interfaces:**
- Produces:
  - `splitCubic(c: Cubic, t: number): [Cubic, Cubic]`
  - `type NearestOnPath = { seg: number; t: number; point: Vec; dist: number }`
  - `nearestOnSubpath(sp: Subpath, p: Vec): NearestOnPath | null`
  - `flattenCubic(c, out, scale?)` and `flattenSubpath(sp, scale?)` — `scale` defaults to 1, so every existing caller is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/box-bezier.test.ts`:

```ts
describe("splitting and picking curves", () => {
  const c: Cubic = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
  ];

  it("splits a cubic into two that draw the same curve", () => {
    const [a, b] = splitCubic(c, 0.5);
    expect(a[3]).toEqual(b[0]);
    expect(a[0]).toEqual(c[0]);
    expect(b[3]).toEqual(c[3]);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const whole = cubicPoint(c, u / 2);
      const half = cubicPoint(a, u);
      expect(half.x).toBeCloseTo(whole.x, 9);
      expect(half.y).toBeCloseTo(whole.y, 9);
    }
    const [s, e] = splitCubic(c, 0);
    expect(s[0]).toEqual(c[0]);
    expect(e[3]).toEqual(c[3]);
  });

  it("finds the nearest point on a subpath", () => {
    const line: Subpath = {
      closed: false,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 10, y: 0 }, in: null, out: null, type: "corner" },
      ],
    };
    const near = nearestOnSubpath(line, { x: 5, y: 3 })!;
    expect(near.seg).toBe(0);
    expect(near.t).toBeCloseTo(0.5, 6);
    expect(near.point.x).toBeCloseTo(5, 6);
    expect(near.dist).toBeCloseTo(3, 6);

    const curve: Subpath = {
      closed: false,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: { x: 0, y: 10 }, type: "smooth" },
        { p: { x: 10, y: 0 }, in: { x: 10, y: 10 }, out: null, type: "smooth" },
      ],
    };
    const onCurve = nearestOnSubpath(curve, { x: 5, y: 20 })!;
    expect(onCurve.t).toBeCloseTo(0.5, 3);
    expect(onCurve.point.y).toBeGreaterThan(6);

    // A closed subpath's last segment runs from the last node back to the first.
    const tri: Subpath = {
      closed: true,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 10, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 10, y: 10 }, in: null, out: null, type: "corner" },
      ],
    };
    expect(nearestOnSubpath(tri, { x: 2, y: 3 })!.seg).toBe(2);
    expect(nearestOnSubpath({ closed: false, nodes: [] }, { x: 0, y: 0 })).toBeNull();
  });

  it("flattens more finely at a larger scale", () => {
    const at1: Vec[] = [];
    const at8: Vec[] = [];
    flattenCubic(c, at1);
    flattenCubic(c, at8, 8);
    expect(at8.length).toBeGreaterThan(at1.length);
    expect(at8[at8.length - 1]).toEqual(at1[at1.length - 1]);
    expect(flattenSubpath({ closed: false, nodes: [] })).toEqual([]);
  });
});
```

Imports for that file: add `nearestOnSubpath` and `splitCubic` to the `../geom/bezier` list, and
`type Subpath` to the `../doc/document` import (`cubicPoint`, `flattenCubic`, `flattenSubpath`,
`type Cubic` and `Vec` are already there).

Append to `src/__tests__/parse.test.ts`:

```ts
describe("closing a path after a save round trip", () => {
  it("merges a last node that rounding left a hair away from the first", () => {
    const d = "M 0 0 L 10 0 L 10 10 L 0.0000004 0.0000003 Z";
    const [sp] = parsePathData(d);
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(3);
    const far = parsePathData("M 0 0 L 10 0 L 10 10 L 0.001 0.001 Z")[0];
    expect(far.nodes).toHaveLength(4);
  });
});
```

`parse.test.ts` already imports `parsePathData`.

One existing expectation changes, deliberately: `it("flattens with 4 to 64 segments")` in
`src/__tests__/box-bezier.test.ts` asserts the old cap. Rename it to "flattens with 4 to 256
segments" and change its two long-curve assertions to `toHaveLength(256)` and `longOut[255]`. The
looser cap is the point of the parked finding — a 3000-unit curve was sampled every ~47 units.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/box-bezier.test.ts src/__tests__/parse.test.ts`
Expected: FAIL — `splitCubic` and `nearestOnSubpath` don't exist, `flattenCubic` takes two arguments, and the 4-node path stays 4 nodes.

- [ ] **Step 3: Implement**

**`src/geom/bezier.ts`** — replace `flattenCubic` and `flattenSubpath`, and add the two helpers:

```ts
/** de Casteljau: `c` split at `t` into the two cubics that together draw the same curve. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const lerp = (a: Vec, b: Vec): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = lerp(c[0], c[1]);
  const b = lerp(c[1], c[2]);
  const d = lerp(c[2], c[3]);
  const e = lerp(a, b);
  const f = lerp(b, d);
  const m = lerp(e, f);
  return [
    [c[0], a, e, m],
    [m, f, d, c[3]],
  ];
}

/** Appends points along `c` (excluding its start) to `out`. `scale` is how many device pixels a
 *  document unit covers, so a curve drawn large is sampled finely (spec M4a §5). */
export function flattenCubic(c: Cubic, out: Vec[], scale = 1): void {
  const len = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
  const n = Math.min(256, Math.max(4, Math.ceil((len * scale) / 4)));
  for (let i = 1; i <= n; i++) out.push(cubicPoint(c, i / n));
}

/** A subpath as a polyline. A closed subpath ends back at its first point. */
export function flattenSubpath(sp: Subpath, scale = 1): Vec[] {
  const n = sp.nodes;
  if (n.length === 0) return [];
  const out: Vec[] = [n[0].p];
  const segment = (a: PathNode, b: PathNode) => {
    const c = segmentCubic(a, b);
    if (c) flattenCubic(c, out, scale);
    else out.push(b.p);
  };
  for (let i = 1; i < n.length; i++) segment(n[i - 1], n[i]);
  if (sp.closed && n.length > 1) segment(n[n.length - 1], n[0]);
  return out;
}

export type NearestOnPath = { seg: number; t: number; point: Vec; dist: number };

/** The point on `sp` nearest to `p`. `seg` is the index of the segment's first node; for a closed
 *  subpath the last segment runs from the last node back to node 0. */
export function nearestOnSubpath(sp: Subpath, p: Vec): NearestOnPath | null {
  const n = sp.nodes;
  if (n.length < 2) return null;
  const segments: { a: PathNode; b: PathNode; seg: number }[] = [];
  for (let i = 1; i < n.length; i++) segments.push({ a: n[i - 1], b: n[i], seg: i - 1 });
  if (sp.closed) segments.push({ a: n[n.length - 1], b: n[0], seg: n.length - 1 });

  let best: NearestOnPath | null = null;
  for (const { a, b, seg } of segments) {
    const c = segmentCubic(a, b);
    const at = (t: number): Vec =>
      c ? cubicPoint(c, t) : { x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t };
    const SAMPLES = 24;
    let coarse = 0;
    let coarseDist = Infinity;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const d = dist(p, at(t));
      if (d < coarseDist) {
        coarseDist = d;
        coarse = t;
      }
    }
    let lo = Math.max(0, coarse - 1 / SAMPLES);
    let hi = Math.min(1, coarse + 1 / SAMPLES);
    for (let k = 0; k < 48; k++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (dist(p, at(m1)) <= dist(p, at(m2))) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    const point = at(t);
    const d = dist(p, point);
    if (!best || d < best.dist) best = { seg, t, point, dist: d };
  }
  return best;
}
```

**`src/geom/hit.ts`** — the flatten cache keys on a scale bucket, and path hit-testing passes the node's world scale:

```ts
/** Flattened subpaths, cached per (immutable) subpath array and per scale bucket, so moving or
 *  rotating a path keeps the cache and zooming only adds one entry per power of two. */
const flatCache = new WeakMap<readonly Subpath[], Map<number, Vec[][]>>();

const bucketOf = (scale: number) =>
  scale > 0 && Number.isFinite(scale) ? 2 ** Math.round(Math.log2(scale)) : 1;

function polylines(s: PathShape, scale: number): Vec[][] {
  const bucket = bucketOf(scale);
  let perScale = flatCache.get(s.subpaths);
  if (!perScale) {
    perScale = new Map();
    flatCache.set(s.subpaths, perScale);
  }
  let polys = perScale.get(bucket);
  if (!polys) {
    polys = s.subpaths.map((sp) => flattenSubpath(sp, bucket));
    perScale.set(bucket, polys);
  }
  return polys;
}
```

`shapeHit` gains a `scale` parameter (default 1) and passes it to `polylines(s, scale)` in its `path` case; `nodeHit` already computes `s` (the node's own scale factor) — pass the **accumulated** scale down: give `nodeHit` a `scale` parameter that starts at 1 in `hitTest`/`marqueeSelect`'s callers and is multiplied by each node's own factor as it descends, and hand that to `shapeHit`. The ellipse and polygon caches are untouched.

**`src/svg/pathdata.ts`** — widen the coincident-point tolerance to match the writer's 6-decimal rounding:

```ts
// The writer rounds to 6 decimals, so two points that were identical before saving can be up to
// ~1e-6 apart in the file; anything tighter leaves a stray node on a closed path (spec M4a §10).
const near = (a: Vec, b: Vec) => Math.abs(a.x - b.x) <= 1e-6 && Math.abs(a.y - b.y) <= 1e-6;
```

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(geom): split cubics, pick the nearest point, flatten by scale

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure path edits

**Files:**
- Create: `src/doc/path-edit.ts`
- Test: `src/__tests__/path-edit.test.ts`

**Interfaces:**
- Consumes: `splitCubic`, `segmentCubic` (Task 1).
- Produces:
  - `type NodeRef = { sub: number; i: number }`
  - `movePathNodes(path, refs, dx, dy): PathShape`
  - `moveHandle(path, ref, which: "in" | "out", to: Vec, breakSymmetry: boolean): PathShape`
  - `insertNode(path, sub: number, seg: number, t: number): { path: PathShape; ref: NodeRef }`
  - `deletePathNodes(path, refs): PathShape | null`
  - `setNodeType(path, refs, type: NodeType): PathShape`
  - `closeSubpath(path, sub: number): PathShape`

- [ ] **Step 1: Write the failing test** — `src/__tests__/path-edit.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, type PathShape, type Subpath } from "../doc/document";
import {
  closeSubpath,
  deletePathNodes,
  insertNode,
  moveHandle,
  movePathNodes,
  setNodeType,
} from "../doc/path-edit";
import { cubicPoint, segmentCubic } from "../geom/bezier";
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
    const twice = movePathNodes(p, [
      { sub: 0, i: 0 },
      { sub: 0, i: 0 },
    ], 1, 0);
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
    expect(deletePathNodes(p, [{ sub: 0, i: 0 }, { sub: 0, i: 1 }])).toBeNull();
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/path-edit.test.ts`
Expected: FAIL — `../doc/path-edit` does not exist.

- [ ] **Step 3: Implement** — `src/doc/path-edit.ts`

```ts
import { segmentCubic, splitCubic } from "../geom/bezier";
import type { Vec } from "../geom/vec";
import type { NodeType, PathNode, PathShape, Subpath } from "./document";

/** Spec (M4a) §3: pure edits of one path's nodes. Every edit returns the same path when nothing
 *  changes, and none may leave a shape the importer would drop. */

export type NodeRef = { sub: number; i: number };

const EPS = 1e-9;
const same = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
const sameHandle = (a: Vec | null, b: Vec | null) => (a === null || b === null ? a === b : same(a, b));
const shift = (v: Vec | null, dx: number, dy: number): Vec | null =>
  v === null ? null : { x: v.x + dx, y: v.y + dy };
const minus = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const length = (v: Vec) => Math.hypot(v.x, v.y);

/** Refs grouped by subpath, so each subpath is walked once. */
function bySubpath(refs: readonly NodeRef[]): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const r of refs) {
    const set = out.get(r.sub);
    if (set) set.add(r.i);
    else out.set(r.sub, new Set([r.i]));
  }
  return out;
}

function withSubpaths(path: PathShape, subpaths: Subpath[], changed: boolean): PathShape {
  return changed ? { ...path, subpaths } : path;
}

export function movePathNodes(
  path: PathShape,
  refs: readonly NodeRef[],
  dx: number,
  dy: number,
): PathShape {
  if (dx === 0 && dy === 0) return path;
  const groups = bySubpath(refs);
  let changed = false;
  const subpaths = path.subpaths.map((sp, si) => {
    const idx = groups.get(si);
    if (!idx) return sp;
    let hit = false;
    const nodes = sp.nodes.map((n, i) => {
      if (!idx.has(i)) return n;
      hit = true;
      return {
        ...n,
        p: { x: n.p.x + dx, y: n.p.y + dy },
        in: shift(n.in, dx, dy),
        out: shift(n.out, dx, dy),
      };
    });
    if (!hit) return sp;
    changed = true;
    return { ...sp, nodes };
  });
  return withSubpaths(path, subpaths, changed);
}

export function moveHandle(
  path: PathShape,
  ref: NodeRef,
  which: "in" | "out",
  to: Vec,
  breakSymmetry: boolean,
): PathShape {
  const sp = path.subpaths[ref.sub];
  const node = sp?.nodes[ref.i];
  if (!sp || !node) return path;

  const dropped = same(to, node.p);
  const moved: Vec | null = dropped ? null : to;
  let next: PathNode =
    which === "in" ? { ...node, in: moved } : { ...node, out: moved };

  if (breakSymmetry) {
    next = { ...next, type: "corner" };
  } else if (moved && node.type !== "corner") {
    const other = which === "in" ? node.out : node.in;
    const d = minus(moved, node.p);
    const l = length(d);
    if (other && l > EPS) {
      const keep = node.type === "symmetric" ? l : length(minus(other, node.p));
      const mirror: Vec = { x: node.p.x - (d.x / l) * keep, y: node.p.y - (d.y / l) * keep };
      next = which === "in" ? { ...next, out: mirror } : { ...next, in: mirror };
    }
  }

  if (
    next.type === node.type &&
    sameHandle(next.in, node.in) &&
    sameHandle(next.out, node.out)
  ) {
    return path;
  }
  const nodes = sp.nodes.slice();
  nodes[ref.i] = next;
  const subpaths = path.subpaths.slice();
  subpaths[ref.sub] = { ...sp, nodes };
  return { ...path, subpaths };
}

/** Splits the segment that starts at node `seg` at `t`, leaving the outline where it was. */
export function insertNode(
  path: PathShape,
  sub: number,
  seg: number,
  t: number,
): { path: PathShape; ref: NodeRef } {
  const sp = path.subpaths[sub];
  const fail = { path, ref: { sub, i: seg } };
  if (!sp) return fail;
  const a = sp.nodes[seg];
  const wraps = sp.closed && seg === sp.nodes.length - 1;
  const b = wraps ? sp.nodes[0] : sp.nodes[seg + 1];
  if (!a || !b || !(t > 0 && t < 1)) return fail;

  const cubic = segmentCubic(a, b);
  let head: PathNode;
  let mid: PathNode;
  let tail: PathNode;
  if (cubic) {
    const [first, second] = splitCubic(cubic, t);
    head = { ...a, out: same(first[1], a.p) ? null : first[1] };
    mid = {
      p: first[3],
      in: same(first[2], first[3]) ? null : first[2],
      out: same(second[1], first[3]) ? null : second[1],
      type: "smooth",
    };
    tail = { ...b, in: same(second[2], b.p) ? null : second[2] };
  } else {
    head = a;
    mid = {
      p: { x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t },
      in: null,
      out: null,
      type: "corner",
    };
    tail = b;
  }

  const nodes = sp.nodes.slice();
  nodes[seg] = head;
  if (wraps) {
    nodes[0] = tail;
    nodes.push(mid);
  } else {
    nodes[seg + 1] = tail;
    nodes.splice(seg + 1, 0, mid);
  }
  const subpaths = path.subpaths.slice();
  subpaths[sub] = { ...sp, nodes };
  return { path: { ...path, subpaths }, ref: { sub, i: wraps ? nodes.length - 1 : seg + 1 } };
}

/** Null when the path would be left with no subpaths — the caller then deletes it outright. */
export function deletePathNodes(path: PathShape, refs: readonly NodeRef[]): PathShape | null {
  const groups = bySubpath(refs);
  let changed = false;
  const subpaths: Subpath[] = [];
  path.subpaths.forEach((sp, si) => {
    const idx = groups.get(si);
    if (!idx) {
      subpaths.push(sp);
      return;
    }
    const nodes = sp.nodes.filter((_, i) => !idx.has(i));
    if (nodes.length === sp.nodes.length) {
      subpaths.push(sp);
      return;
    }
    changed = true;
    // A subpath needs two nodes to draw anything; the importer drops the rest.
    if (nodes.length >= 2) subpaths.push({ ...sp, nodes });
  });
  if (!changed) return path;
  return subpaths.length === 0 ? null : { ...path, subpaths };
}

function retype(node: PathNode, type: NodeType): PathNode {
  if (type === "corner" || !node.in || !node.out) {
    return node.type === type ? node : { ...node, type };
  }
  const inV = minus(node.in, node.p);
  const outV = minus(node.out, node.p);
  const li = length(inV);
  const lo = length(outV);
  if (li < EPS || lo < EPS) return node.type === type ? node : { ...node, type };
  const ux = inV.x / li;
  const uy = inV.y / li;
  const keepIn = type === "symmetric" ? (li + lo) / 2 : li;
  const keepOut = type === "symmetric" ? (li + lo) / 2 : lo;
  const next: PathNode = {
    ...node,
    type,
    in: { x: node.p.x + ux * keepIn, y: node.p.y + uy * keepIn },
    out: { x: node.p.x - ux * keepOut, y: node.p.y - uy * keepOut },
  };
  return node.type === type && sameHandle(next.in, node.in) && sameHandle(next.out, node.out)
    ? node
    : next;
}

export function setNodeType(
  path: PathShape,
  refs: readonly NodeRef[],
  type: NodeType,
): PathShape {
  const groups = bySubpath(refs);
  let changed = false;
  const subpaths = path.subpaths.map((sp, si) => {
    const idx = groups.get(si);
    if (!idx) return sp;
    let hit = false;
    const nodes = sp.nodes.map((n, i) => {
      if (!idx.has(i)) return n;
      const next = retype(n, type);
      if (next !== n) hit = true;
      return next;
    });
    if (!hit) return sp;
    changed = true;
    return { ...sp, nodes };
  });
  return withSubpaths(path, subpaths, changed);
}

/** Closing never repeats the first node as the last: the writer emits `Z` and the importer would
 *  merge such a node away, losing it on reload (CLAUDE.md's M4 constraint). */
export function closeSubpath(path: PathShape, sub: number): PathShape {
  const sp = path.subpaths[sub];
  if (!sp || sp.closed || sp.nodes.length < 2) return path;
  const subpaths = path.subpaths.slice();
  subpaths[sub] = { ...sp, closed: true };
  return { ...path, subpaths };
}
```

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test`, `npm run build`, `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(doc): pure node edits for paths

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Store state, context and the tool's shell

**Files:**
- Modify: `src/state/appState.svelte.ts`, `src/state/commands.ts`, `src/state/keys.ts`, `src/tools/types.ts`, `src/tools/tool.ts`, `src/tools/context.ts`, `src/tools/registry.ts`, `src/__tests__/fake-context.ts`, `src/lib/ToolStrip.svelte`
- Create: `src/tools/node-tool.ts` (picking only; the interactions land in Task 4)
- Test: `src/__tests__/prefs-route-keys.test.ts`, `src/__tests__/node-tool.test.ts` (new)

**Interfaces:**
- Consumes: `path-edit` (Task 2), `findNode`, `rowLabel`.
- Produces:
  - store: `app.nodeTarget`, `app.nodeSel`, `setNodeTarget`, `setNodeSel`, `moveSelectedNodes`, `deleteSelectedNodes`, `setSelectedNodeType`, `closeTargetSubpath`;
  - `ToolContext.nodeTarget()`, `setNodeTarget(id)`, `nodeSel()`, `setNodeSel(refs)`;
  - `ToolId` gains `"node"`; `TOOLS.node`; `n` selects it;
  - `createNodeTool()` — picking a path, the live-shape notice, and Escape's behaviour.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/prefs-route-keys.test.ts`, extend the tool-key case (or add one) so `k("n")` is `{ kind: "tool", tool: "node" }`.

Create `src/__tests__/node-tool.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node, type PathShape } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { createNodeTool } from "../tools/node-tool";
import { DEFAULT_PREFS } from "../persist/preferences";
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/node-tool.test.ts src/__tests__/prefs-route-keys.test.ts`
Expected: FAIL — `../tools/node-tool` does not exist and `n` maps to nothing.

- [ ] **Step 3: Implement**

**`src/tools/types.ts`:** `export type ToolId = "select" | "rect" | "ellipse" | "line" | "polygon" | "node" | "hand";`

**`src/tools/tool.ts`** — in `ToolContext`, after the entered-group pair:

```ts
  /** The path being node-edited (spec M4a §2), or null. */
  nodeTarget(): string | null;
  setNodeTarget(id: string | null): void;
  nodeSel(): readonly NodeRef[];
  setNodeSel(refs: readonly NodeRef[]): void;
```

with `import type { NodeRef } from "../doc/path-edit";`.

**`src/state/appState.svelte.ts`:**
- In `class AppState`, after `enteredGroupId`:

```ts
  /** The path being node-edited and the nodes selected in it (spec M4a §2). Not saved, not undoable. */
  nodeTarget = $state<string | null>(null);
  nodeSel = $state.raw<readonly NodeRef[]>([]);
```

- In `setSession`, after the entered-group re-resolution:

```ts
  if (app.nodeTarget !== null) {
    const target = findNode(s.doc, app.nodeTarget);
    const path = target && target.node.kind === "path" ? target.node : null;
    if (!path || !target.layer.visible || target.layer.locked) {
      app.nodeTarget = null;
      app.nodeSel = [];
    } else {
      const kept = app.nodeSel.filter((r) => (path.subpaths[r.sub]?.nodes.length ?? 0) > r.i);
      if (kept.length !== app.nodeSel.length) app.nodeSel = kept;
    }
  }
```

- In `replaceDocument`, beside the entered-group reset: `app.nodeTarget = null; app.nodeSel = [];`
- New actions at the end of the file:

```ts
export function setNodeTarget(id: string | null): void {
  app.nodeTarget = id;
  app.nodeSel = [];
}

export function setNodeSel(refs: readonly NodeRef[]): void {
  app.nodeSel = refs;
}

/** The path being node-edited, or null when there isn't one. */
function targetPath(): PathShape | null {
  if (app.nodeTarget === null) return null;
  const found = findNode(app.doc, app.nodeTarget);
  return found && found.node.kind === "path" ? found.node : null;
}

export function moveSelectedNodes(dx: number, dy: number): void {
  cancelActiveGesture();
  const path = targetPath();
  if (!path || app.nodeSel.length === 0) return;
  commitDoc(mapNodes(app.doc, [path.id], () => movePathNodes(path, app.nodeSel, dx, dy)));
}

export function deleteSelectedNodes(): void {
  cancelActiveGesture();
  const path = targetPath();
  if (!path || app.nodeSel.length === 0) return;
  const next = deletePathNodes(path, app.nodeSel);
  if (next === path) return;
  if (next === null) {
    commitDoc(deleteNodes(app.doc, [path.id]));
    app.nodeTarget = null;
  } else {
    commitDoc(mapNodes(app.doc, [path.id], () => next));
  }
  app.nodeSel = [];
}

export function setSelectedNodeType(type: NodeType): void {
  cancelActiveGesture();
  const path = targetPath();
  if (!path || app.nodeSel.length === 0) return;
  commitDoc(mapNodes(app.doc, [path.id], () => setNodeType(path, app.nodeSel, type)));
}

export function closeTargetSubpath(sub: number): void {
  cancelActiveGesture();
  const path = targetPath();
  if (!path) return;
  commitDoc(mapNodes(app.doc, [path.id], () => closeSubpath(path, sub)));
}
```

  Imports: `closeSubpath`, `deletePathNodes`, `movePathNodes`, `setNodeType` and `type NodeRef`
  from `../doc/path-edit`; `NodeType` and `PathShape` added to the `../doc/document` type import;
  **`mapNodes` added to the `../doc/tree` import** (that file imports only `ancestorIds`,
  `findNode` and `pruneSelection` today); `deleteNodes` is already imported from `../doc/edits`.

- **Escape** — `clearOrLeaveGroup` gains the two node steps first, keeping its name:

```ts
export function clearOrLeaveGroup(): void {
  cancelActiveGesture();
  if (app.toolId === "node" && app.nodeSel.length > 0) {
    app.nodeSel = [];
    return;
  }
  if (app.toolId === "node" && app.nodeTarget !== null) {
    app.nodeTarget = null;
    setTool("select");
    return;
  }
  // …the existing entered-group and clear-selection body, unchanged…
}
```

- **Delete and nudge** — in `src/state/commands.ts`'s `runEditAction`:

```ts
    case "delete":
      return app.toolId === "node" && app.nodeSel.length > 0
        ? deleteSelectedNodes()
        : deleteSelection();
    case "nudge":
      return app.toolId === "node" && app.nodeSel.length > 0
        ? moveSelectedNodes(a.dx, a.dy)
        : nudgeSelection(a.dx, a.dy);
```

  with `app`, `deleteSelectedNodes` and `moveSelectedNodes` added to its store import.

**`src/tools/context.ts`** — add to the object literal:

```ts
  nodeTarget: () => app.nodeTarget,
  setNodeTarget,
  nodeSel: () => app.nodeSel,
  setNodeSel,
  setTool,
```

and to its `../state/appState.svelte` import, alphabetically: `setNodeSel`, `setNodeTarget`,
`setTool`. Take care not to paste the object members into the import list — both contain
`setEnteredGroup`.

**`src/__tests__/fake-context.ts`:**
- `FakeState` gains `nodeTarget: string | null` (null), `nodeSel: readonly NodeRef[]` (`[]`) and
  `toolId: ToolId` (`"select"`); `ctx` gains `nodeTarget`, `setNodeTarget` (which also clears
  `nodeSel`), `nodeSel`, `setNodeSel` and `setTool`, writing to `state`. Imports: `type NodeRef`
  from `../doc/path-edit` and `type ToolId` from `../tools/types`.
- **`ev`'s `time` now advances by default**, so an ordinary click followed by a drag is never read
  as a double tap:

```ts
/** Synthetic events are a second apart unless a test says otherwise, so an ordinary click followed
 *  by a drag is never mistaken for a double tap. */
let clock = 0;

export function ev(
  x: number,
  y: number,
  mods: Partial<Mods> = {},
  pointerType = "mouse",
  time = (clock += 1000),
): ToolEvent {
  return { doc: { x, y }, screen: { x, y }, pointerType, mods: { ...NO_MODS, ...mods }, time };
}
```

**`src/state/keys.ts`** — `TOOL_KEYS` gains `n: "node",`.

**`src/lib/ToolStrip.svelte`** — add `{ id: "node", label: "Edit nodes", key: "N", icon: Spline }` after the polygon entry, with `Spline` added to the lucide import.

**`src/tools/registry.ts`** — `node: createNodeTool(),` with the import.

**`src/tools/node-tool.ts`** (picking only for now; Task 4 fills in the rest):

```ts
import { rowLabel } from "../doc/layers";
import { findNode } from "../doc/tree";
import { hitTest } from "../geom/hit";
import { pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

/** Spec (M4a) §6. Editing one path's nodes; everything happens in that path's own space. */
export function createNodeTool(): Tool {
  return {
    id: "node",
    hint: "Click a path to edit its nodes",
    cursor: "default",

    down(ctx, e) {
      pickTarget(ctx, e);
    },
    move() {},
    up() {},
    cancel() {},
  };
}

/** Clicking away from the current target: pick a new path, refuse a live shape, or clear. */
function pickTarget(ctx: ToolContext, e: ToolEvent): void {
  const doc = ctx.doc();
  const hit = hitTest(doc, e.doc, pointerTolerance(e.pointerType) / ctx.view().zoom, ctx.enteredGroupId());
  if (!hit) {
    ctx.setNodeTarget(null);
    ctx.setSelection([]);
    return;
  }
  const found = findNode(doc, hit.nodeId);
  const node = found?.node;
  if (!node) return;
  ctx.setSelection([node.id]);
  if (node.kind === "path") {
    ctx.setNodeTarget(node.id);
    return;
  }
  ctx.setNodeTarget(null);
  if (node.kind !== "group") {
    ctx.notify(
      "info",
      `“${rowLabel(node)}” is a live shape — use Convert to path to edit its nodes.`,
    );
  }
}
```

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: node-editing state, the node tool's shell and its key

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The node tool's interactions

**Files:**
- Modify: `src/tools/node-tool.ts`, `src/tools/select.ts`
- Test: `src/__tests__/node-tool.test.ts` (extended)

**Interfaces:**
- Consumes: `path-edit` (Task 2), `nearestOnSubpath` (Task 1), the context members (Task 3), `collectTargets`/`snapPoint`, `isDoubleTap`.
- Produces: the full tool — select, drag, handles, add, cycle, marquee — and the select tool's double-click shortcut.

- [ ] **Step 1: Write the failing tests** — append to `src/__tests__/node-tool.test.ts`

```ts
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
```

Notes: the node starts `smooth`, so one cycle gives `symmetric`; the drag case turns snapping off
because it checks the drag maths, not the snap targets; and "keeps the target when empty space is
clicked" is the behaviour Task 4 introduces — with a target, empty space starts a marquee instead
of clearing the target, which is why Task 3's own picking test only covers the no-target case.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/node-tool.test.ts`
Expected: FAIL — the tool only picks a target.

- [ ] **Step 3: Implement** — replace `src/tools/node-tool.ts` with:

```ts
import type { Doc, PathShape } from "../doc/document";
import { rowLabel } from "../doc/layers";
import { insertNode, moveHandle, movePathNodes, setNodeType, type NodeRef } from "../doc/path-edit";
import { findNode, mapNodes } from "../doc/tree";
import { nearestOnSubpath } from "../geom/bezier";
import { boxFromPoints, type Box } from "../geom/box";
import { hitTest } from "../geom/hit";
import { applyMat, invert, multiply, type Mat } from "../geom/mat";
import { collectTargets, hasGuides, SNAP_PX, snapPoint, type SnapTargets } from "../geom/snap";
import type { Vec } from "../geom/vec";
import { isDoubleTap, type Tap } from "../input/double-tap";
import { movedEnough, pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

/** Spec (M4a) §6. Editing one path's nodes; everything happens in that path's own space. */

type Target = { path: PathShape; world: Mat; inv: Mat; scale: number };

type Pick =
  | { kind: "handle"; ref: NodeRef; which: "in" | "out" }
  | { kind: "node"; ref: NodeRef }
  | { kind: "segment"; ref: NodeRef; seg: number; t: number }
  | null;

type Mode =
  | { kind: "pending"; start: ToolEvent; pick: Pick }
  | {
      kind: "nodes";
      base: Doc;
      start: Vec;
      refs: readonly NodeRef[];
      targets: SnapTargets | null;
    }
  | { kind: "handle"; base: Doc; ref: NodeRef; which: "in" | "out" }
  | { kind: "marquee"; start: Vec; base: readonly NodeRef[] };

const sameRef = (a: NodeRef, b: NodeRef) => a.sub === b.sub && a.i === b.i;
const refKey = (r: NodeRef) => `${r.sub}:${r.i}`;
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function targetOf(ctx: ToolContext): Target | null {
  const id = ctx.nodeTarget();
  if (id === null) return null;
  const found = findNode(ctx.doc(), id);
  if (!found || found.node.kind !== "path") return null;
  const world = multiply(found.parent, found.node.transform);
  const inv = invert(world);
  if (!inv) return null;
  const scale = Math.sqrt(Math.abs(world[0] * world[3] - world[1] * world[2])) || 1;
  return { path: found.node, world, inv, scale };
}

/** What the pointer is over, in the path's own space. Handles of selected nodes win, then nodes,
 *  then segments. */
function pickAt(t: Target, sel: readonly NodeRef[], p: Vec, tol: number): Pick {
  const selected = new Set(sel.map(refKey));
  for (let sub = 0; sub < t.path.subpaths.length; sub++) {
    const nodes = t.path.subpaths[sub].nodes;
    for (let i = 0; i < nodes.length; i++) {
      const ref = { sub, i };
      if (!selected.has(refKey(ref))) continue;
      const n = nodes[i];
      if (n.in && dist(n.in, p) <= tol) return { kind: "handle", ref, which: "in" };
      if (n.out && dist(n.out, p) <= tol) return { kind: "handle", ref, which: "out" };
    }
  }
  for (let sub = 0; sub < t.path.subpaths.length; sub++) {
    const nodes = t.path.subpaths[sub].nodes;
    for (let i = 0; i < nodes.length; i++) {
      if (dist(nodes[i].p, p) <= tol) return { kind: "node", ref: { sub, i } };
    }
  }
  for (let sub = 0; sub < t.path.subpaths.length; sub++) {
    const near = nearestOnSubpath(t.path.subpaths[sub], p);
    if (near && near.dist <= tol) {
      return { kind: "segment", ref: { sub, i: near.seg }, seg: near.seg, t: near.t };
    }
  }
  return null;
}

function replacePath(ctx: ToolContext, base: Doc, path: PathShape, next: PathShape): void {
  if (next === path) return;
  ctx.commit(mapNodes(base, [path.id], () => next));
}

export function createNodeTool(): Tool {
  let mode: Mode | null = null;
  let lastTap: Tap | null = null;

  const cycle = (ctx: ToolContext, t: Target, ref: NodeRef) => {
    const node = t.path.subpaths[ref.sub]?.nodes[ref.i];
    if (!node) return;
    const next =
      node.type === "corner" ? "smooth" : node.type === "smooth" ? "symmetric" : "corner";
    replacePath(ctx, ctx.doc(), t.path, setNodeType(t.path, [ref], next));
  };

  return {
    id: "node",
    hint: "Click a node · drag to move · double-click a segment to add · Shift: add",
    cursor: "default",

    down(ctx, e) {
      mode = null;
      const t = targetOf(ctx);
      if (!t) {
        pickTarget(ctx, e);
        return;
      }
      const p = applyMat(t.inv, e.doc);
      const tol = pointerTolerance(e.pointerType) / (ctx.view().zoom * t.scale);
      const pick = pickAt(t, ctx.nodeSel(), p, tol);

      // A second tap on the same thing adds a node or cycles a type (spec M4a §6).
      const tap = pick === null ? null : { id: `${pick.kind}:${refKey(pick.ref)}`, time: e.time };
      const second = tap !== null && isDoubleTap(lastTap, tap);
      lastTap = second ? null : tap;
      if (second && pick) {
        if (pick.kind === "segment") {
          const r = insertNode(t.path, pick.ref.sub, pick.seg, pick.t);
          replacePath(ctx, ctx.doc(), t.path, r.path);
          ctx.setNodeSel([r.ref]);
          return;
        }
        if (pick.kind === "node") {
          cycle(ctx, t, pick.ref);
          return;
        }
      }

      if (pick === null) {
        // Empty space: either retarget to whatever is under the pointer, or start a marquee.
        const hit = hitTest(
          ctx.doc(),
          e.doc,
          pointerTolerance(e.pointerType) / ctx.view().zoom,
          ctx.enteredGroupId(),
        );
        if (hit && hit.nodeId !== t.path.id) {
          pickTarget(ctx, e);
          return;
        }
        mode = { kind: "marquee", start: p, base: e.mods.shift ? ctx.nodeSel() : [] };
        if (!e.mods.shift) ctx.setNodeSel([]);
        return;
      }

      if (pick.kind === "node") {
        const sel = ctx.nodeSel();
        const already = sel.some((r) => sameRef(r, pick.ref));
        if (e.mods.shift) {
          ctx.setNodeSel(already ? sel.filter((r) => !sameRef(r, pick.ref)) : [...sel, pick.ref]);
        } else if (!already) {
          ctx.setNodeSel([pick.ref]);
        }
      }
      mode = { kind: "pending", start: e, pick };
    },

    move(ctx, e) {
      const t = targetOf(ctx);
      if (!mode || !t) return;
      const p = applyMat(t.inv, e.doc);

      if (mode.kind === "pending") {
        if (!movedEnough(mode.start.screen, e.screen)) return;
        const pick = mode.pick;
        if (pick?.kind === "handle") {
          ctx.beginGesture();
          mode = { kind: "handle", base: ctx.doc(), ref: pick.ref, which: pick.which };
        } else if (pick?.kind === "node") {
          ctx.beginGesture();
          const refs = ctx.nodeSel();
          mode = {
            kind: "nodes",
            base: ctx.doc(),
            start: applyMat(t.inv, mode.start.doc),
            refs: refs.length > 0 ? refs : [pick.ref],
            targets: ctx.snapEnabled()
              ? collectTargets(ctx.doc(), [t.path.id], { nodes: true })
              : null,
          };
        } else {
          return;
        }
      }

      if (mode.kind === "handle") {
        const path = pathOf(mode.base, t.path.id);
        if (path)
          replacePath(ctx, mode.base, path, moveHandle(path, mode.ref, mode.which, p, e.mods.alt));
        return;
      }
      if (mode.kind === "nodes") {
        const path = pathOf(mode.base, t.path.id);
        if (!path) return;
        let to = p;
        if (mode.targets) {
          const world = applyMat(t.world, p);
          const snapped = snapPoint(world, mode.targets, SNAP_PX / ctx.view().zoom);
          ctx.setOverlay(hasGuides(snapped.guides) ? { kind: "guides", ...snapped.guides } : null);
          to = applyMat(t.inv, snapped.p);
        }
        replacePath(
          ctx,
          mode.base,
          path,
          movePathNodes(path, mode.refs, to.x - mode.start.x, to.y - mode.start.y),
        );
        return;
      }
      if (mode.kind === "marquee") {
        const box = boxFromPoints([mode.start, p]);
        if (!box) return;
        ctx.setOverlay({ kind: "marquee", box: worldBox(t, box) });
        ctx.setNodeSel(mergeRefs(mode.base, nodesIn(t.path, box)));
      }
    },

    up(ctx, e) {
      const m = mode;
      mode = null;
      if (!m) return;
      if (m.kind === "pending") return;
      this.move(ctx, e);
      ctx.setOverlay(null);
      if (m.kind !== "marquee") ctx.endGesture();
    },

    cancel(ctx) {
      const m = mode;
      mode = null;
      if (!m) return;
      ctx.setOverlay(null);
      if (m.kind === "nodes" || m.kind === "handle") {
        ctx.commit(m.base);
        ctx.endGesture();
      }
    },
  };
}

function pathOf(base: Doc, id: string): PathShape | null {
  const found = findNode(base, id);
  return found && found.node.kind === "path" ? found.node : null;
}

/** The marquee is drawn in document space, so the path-space box is mapped through the matrix. */
function worldBox(t: Target, b: Box): Box {
  const corners = [
    applyMat(t.world, { x: b.x, y: b.y }),
    applyMat(t.world, { x: b.x + b.w, y: b.y }),
    applyMat(t.world, { x: b.x + b.w, y: b.y + b.h }),
    applyMat(t.world, { x: b.x, y: b.y + b.h }),
  ];
  return boxFromPoints(corners)!;
}

function nodesIn(path: PathShape, box: Box): NodeRef[] {
  const out: NodeRef[] = [];
  path.subpaths.forEach((sp, sub) => {
    sp.nodes.forEach((n, i) => {
      if (n.p.x >= box.x && n.p.x <= box.x + box.w && n.p.y >= box.y && n.p.y <= box.y + box.h) {
        out.push({ sub, i });
      }
    });
  });
  return out;
}

function mergeRefs(base: readonly NodeRef[], found: readonly NodeRef[]): NodeRef[] {
  const seen = new Set(base.map(refKey));
  const out = [...base];
  for (const r of found) {
    if (seen.has(refKey(r))) continue;
    seen.add(refKey(r));
    out.push(r);
  }
  return out;
}

/** Clicking away from the current target: pick a new path, refuse a live shape, or clear. */
function pickTarget(ctx: ToolContext, e: ToolEvent): void {
  const doc = ctx.doc();
  const hit = hitTest(
    doc,
    e.doc,
    pointerTolerance(e.pointerType) / ctx.view().zoom,
    ctx.enteredGroupId(),
  );
  if (!hit) {
    ctx.setNodeTarget(null);
    ctx.setSelection([]);
    return;
  }
  const found = findNode(doc, hit.nodeId);
  const node = found?.node;
  if (!node) return;
  ctx.setSelection([node.id]);
  if (node.kind === "path") {
    ctx.setNodeTarget(node.id);
    return;
  }
  ctx.setNodeTarget(null);
  if (node.kind !== "group") {
    ctx.notify(
      "info",
      `“${rowLabel(node)}” is a live shape — use Convert to path to edit its nodes.`,
    );
  }
}
```

  Two details the dry run needed: `boxFromPoints` returns `Box | null`, so the marquee branch
  guards it; and `pathOf` takes only `(base, id)`.

**`src/tools/select.ts`** — the double-click shortcut, plus a fix the dry run surfaced: the tap
must be recorded when a click **ends**, not when a press begins, or a click followed within 350 ms
by a drag on the same object is read as a double tap (it would enter a group or switch tools
instead of dragging — a latent M3b bug).

In `down`, replace the two lines that build and store the tap with:

```ts
        // A double tap steps inside a group (spec M3b §3.2) or hands a path to the node tool
        // (spec M4a §6). `lastTap` is recorded in `up`, and only for a click that did not drag,
        // so click-then-drag within the double-tap window still drags.
        const second = hitId !== null && isDoubleTap(lastTap, { id: hitId, time: e.time });
        if (second) lastTap = null;
```

In `up`, inside the `m.kind === "pending"` branch, right after the `if (m.handle) return;` line:

```ts
        if (m.hitId !== null) lastTap = { id: m.hitId, time: e.time };
```

Then add the path case before the existing group case:

```ts
        // A double tap on a path hands it to the node tool (spec M4a §6).
        if (second && hitId !== null && findNode(doc, hitId)?.node.kind === "path") {
          ctx.setNodeTarget(hitId);
          ctx.setSelection([hitId]);
          ctx.setTool("node");
          mode = null;
          return;
        }
```

  `ToolContext.setTool` and the fake's `toolId` come from Task 3, so nothing further is needed here.

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test`, `npm run build`, `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(tools): node selection, dragging, handles and adding nodes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Drawing the nodes

**Files:**
- Modify: `src/lib/Overlay.svelte`

**Interfaces:**
- Consumes: `app.nodeTarget`, `app.nodeSel`, `app.toolId`; `findNode`; `docToScreen`; `handleSize`.

- [ ] **Step 1: Implement**

In `src/lib/Overlay.svelte`, add derived values beside the existing ones:

```ts
  const nodeView = $derived.by(() => {
    if (app.toolId !== "node" || app.nodeTarget === null) return null;
    const found = findNode(app.doc, app.nodeTarget);
    if (!found || found.node.kind !== "path") return null;
    const world = multiply(found.parent, found.node.transform);
    const toScreen = (p: Vec) => docToScreen(view, applyMat(world, p));
    const selected = new Set(app.nodeSel.map((r) => `${r.sub}:${r.i}`));
    const knobs: { p: Vec; on: boolean }[] = [];
    const handles: { a: Vec; b: Vec }[] = [];
    found.node.subpaths.forEach((sp, sub) => {
      sp.nodes.forEach((n, i) => {
        const on = selected.has(`${sub}:${i}`);
        knobs.push({ p: toScreen(n.p), on });
        if (!on) return;
        if (n.in) handles.push({ a: toScreen(n.p), b: toScreen(n.in) });
        if (n.out) handles.push({ a: toScreen(n.p), b: toScreen(n.out) });
      });
    });
    return { knobs, handles };
  });
  const knobSize = $derived(handleSize(app.lastPointerType) - 1);
```

and draw them at the end of the overlay's `<g>`, after the selection handles:

```svelte
  {#if nodeView}
    {#each nodeView.handles as h, i (i)}
      <line x1={h.a.x} y1={h.a.y} x2={h.b.x} y2={h.b.y} style={LINE} stroke-width="1" />
      <circle cx={h.b.x} cy={h.b.y} r={knobSize / 2 - 1} style={KNOB} stroke-width="1" />
    {/each}
    {#each nodeView.knobs as k, i (i)}
      <rect
        x={k.p.x - knobSize / 2}
        y={k.p.y - knobSize / 2}
        width={knobSize}
        height={knobSize}
        style={k.on ? SELECTED_KNOB : KNOB}
        stroke-width="1"
      />
    {/each}
  {/if}
```

with `const SELECTED_KNOB = "stroke: var(--color-accent); fill: var(--color-accent)";` beside the
existing `LINE`/`KNOB` constants, and these imports added: `findNode` from `../doc/tree`, and
`applyMat`, `multiply` from `../geom/mat` (`handleSize`, `docToScreen` and `Vec` are already there).

- [ ] **Step 2: Verify**

Run `npm run build` (0 / 0), `npm run lint`, `npm run format:check`, `npm test`, then the dev-server compile check:

```bash
(npx vite --port 5199 --strictPort > "$TMPDIR/sv-5199.log" 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}" http://localhost:5199/ | grep -q 200 && break; perl -e 'select(undef,undef,undef,0.5)'; done
curl -s -o /dev/null -w "Overlay %{http_code}\n" http://localhost:5199/src/lib/Overlay.svelte
pkill -f "vite --port 5199"
```

Expected `200`; localhost needs the sandbox disabled.

- [ ] **Step 3: Commit**

```bash
git add -A src
git commit -m "feat(ui): draw path nodes and handles while node editing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Snapping to nodes, Properties and the context menu

**Files:**
- Modify: `src/geom/snap.ts`, `src/tools/node-tool.ts`, `src/lib/PropertiesPanel.svelte`, `src/lib/ContextMenu.svelte`, `src/state/properties.ts`
- Test: `src/__tests__/snap.test.ts`, `src/__tests__/properties.test.ts` (both extended)

**Interfaces:**
- Produces:
  - `collectTargets(doc, exclude, opts?: { nodes?: boolean })`;
  - `selectedNodeSummary(doc, nodeTarget, nodeSel): { type: NodeType | "mixed"; point: Vec | null } | null` in `src/state/properties.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/snap.test.ts`, inside a new `describe("node snapping", …)`. Its imports
gain `translate` from `../geom/mat` and `deepFreeze` from `./helpers`:

```ts
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
```

Append to `src/__tests__/properties.test.ts`, adding `selectedNodeSummary` to its
`../state/properties` import:

```ts
describe("selected node summary", () => {
  const p = (x: number, y: number, type: "corner" | "smooth" | "symmetric") => ({
    p: { x, y },
    in: null,
    out: null,
    type,
  });
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
            transform: IDENTITY,
            style: DEFAULT_STYLE,
            subpaths: [{ closed: false, nodes: [p(0, 0, "corner"), p(10, 5, "smooth")] }],
          } as Node,
        ],
      },
    ],
  });

  it("reports one node's type and point, and mixed types", () => {
    expect(selectedNodeSummary(d, "p", [{ sub: 0, i: 1 }])).toEqual({
      type: "smooth",
      point: { x: 10, y: 5 },
    });
    expect(
      selectedNodeSummary(d, "p", [
        { sub: 0, i: 0 },
        { sub: 0, i: 1 },
      ]),
    ).toEqual({ type: "mixed", point: null });
    expect(selectedNodeSummary(d, "p", [])).toBeNull();
    expect(selectedNodeSummary(d, "nope", [{ sub: 0, i: 0 }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/snap.test.ts src/__tests__/properties.test.ts`

- [ ] **Step 3: Implement**

**`src/geom/snap.ts`** (`applyMat` joins its `./mat` import):

```ts
export function collectTargets(
  doc: Doc,
  exclude: readonly string[],
  opts: { nodes?: boolean } = {},
): SnapTargets {
```

  and, inside the per-node loop, after the bounds are pushed:

```ts
      // Spec (M4a) §7: node editing also snaps to other paths' node points.
      if (opts.nodes && n.kind === "path") {
        for (const sp of n.subpaths) {
          for (const node of sp.nodes) {
            const q = applyMat(n.transform, node.p);
            xs.push(q.x);
            ys.push(q.y);
          }
        }
      }
```

  with `applyMat` added to the `./mat` import. (Only top-level paths contribute, which is what the existing loop walks.)

**`src/tools/node-tool.ts`** — the node drag asks for node targets: `collectTargets(ctx.doc(), [t.path.id], { nodes: true })`.

**`src/state/properties.ts`:**

```ts
/** Spec (M4a) §9: the Node section's values. */
export function selectedNodeSummary(
  doc: Doc,
  nodeTarget: string | null,
  nodeSel: readonly NodeRef[],
): { type: NodeType | "mixed"; point: Vec | null } | null {
  if (nodeTarget === null || nodeSel.length === 0) return null;
  const found = findNode(doc, nodeTarget);
  if (!found || found.node.kind !== "path") return null;
  const nodes = nodeSel.flatMap((r) => found.node.kind === "path" ? found.node.subpaths[r.sub]?.nodes[r.i] ?? [] : []);
  if (nodes.length === 0) return null;
  const type = nodes.every((n) => n.type === nodes[0].type) ? nodes[0].type : "mixed";
  return { type, point: nodes.length === 1 ? nodes[0].p : null };
}
```

  with `type NodeRef` imported from `../doc/path-edit` and `type NodeType`, `type Vec` as needed.

**`src/lib/PropertiesPanel.svelte`** — above the Geometry section:

```svelte
  {#if nodeSummary}
    <div class="flex flex-col gap-2 border-t border-line pt-3">
      <span class="section-title">Node</span>
      <div class="flex gap-1">
        {#each NODE_TYPES as t (t.type)}
          <ToggleButton
            value={nodeSummary.type === t.type}
            label={t.label}
            onchange={() => setSelectedNodeType(t.type)}
          />
        {/each}
      </div>
      {#if nodeSummary.point}
        {@const pt = nodeSummary.point}
        <div class="flex gap-2">
          <NumberField label="X" value={pt.x} onchange={(v) => moveSelectedNodes(v - pt.x, 0)} />
          <NumberField label="Y" value={pt.y} onchange={(v) => moveSelectedNodes(0, v - pt.y)} />
        </div>
      {/if}
    </div>
  {/if}
```

  with

```ts
  const NODE_TYPES = [
    { type: "corner" as const, label: "Corner" },
    { type: "smooth" as const, label: "Smooth" },
    { type: "symmetric" as const, label: "Symmetric" },
  ];
  const nodeSummary = $derived(selectedNodeSummary(app.doc, app.nodeTarget, app.nodeSel));
```

  `ToggleButton` takes `value` (true / false / "mixed"), `label` and `onchange(next: boolean)`, so
  each type button passes `value={nodeSummary.type === t.type}` and ignores the argument.
  `NumberField` takes `label`, `value`, `onchange` and optional `min`/`max`/`suffix`. The
  `{@const pt = nodeSummary.point}` inside the `{#if}` keeps TypeScript happy in the handlers.
  Imports: `selectedNodeSummary` from `../state/properties`; `moveSelectedNodes` and
  `setSelectedNodeType` from the store.

**`src/lib/ContextMenu.svelte`** — when `app.toolId === "node"` and `app.nodeSel.length > 0`, show a node section above the object items:

```svelte
    {#if app.toolId === "node" && app.nodeSel.length > 0}
      <button class="menu-item" role="menuitem" onclick={() => run(deleteSelectedNodes)}>
        Delete node{app.nodeSel.length > 1 ? "s" : ""} <span class="kbd">⌫</span>
      </button>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => run(() => setSelectedNodeType("corner"))}
      >
        Corner
      </button>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => run(() => setSelectedNodeType("smooth"))}
      >
        Smooth
      </button>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => run(() => setSelectedNodeType("symmetric"))}
      >
        Symmetric
      </button>
      <div class="my-1 h-px bg-line"></div>
    {/if}
```

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`, and the Task 5 dev-server check for `lib/PropertiesPanel.svelte` and `lib/ContextMenu.svelte`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: snap to path nodes, Node properties and menu items

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Controller browser pass (between Task 6 and Task 7)

The controller runs this on `npx vite --port 5198 --strictPort`, with screenshots, and stops the server afterwards.

1. **Target a path:** convert a rect to a path, pick the Node tool (and the N key), click the path — its nodes appear.
2. **Live shape:** clicking a rect shows the notice and targets nothing.
3. **Move:** drag a node; drag with several selected; check the handles travel with the point.
4. **Handles:** drag a handle of a smooth node (the other side follows), a symmetric node (mirrors), a corner node (independent), and with Alt (breaks, becomes a corner).
5. **Add and cycle:** double-click a segment to add a node; double-click a node to cycle corner → smooth → symmetric.
6. **Marquee and nudge:** marquee some nodes, then nudge with the arrows (and Shift for 10).
7. **Delete:** delete one node; delete every node of a path and check the path goes.
8. **Snapping:** drag a node near another path's node and check it snaps with a guide.
9. **Properties:** the Node section's type buttons and X/Y for a single node.
10. **Context menu:** the node items appear only with a node selection.
11. **Inside a group:** enter a group, node-edit a path inside it, and check the pointer tracks the node.
12. **Round trip:** save, reload, and check the path is unchanged — especially a closed one.
13. **Escape:** clears the node selection, then the target and back to the select tool. Undo each edit.
14. No console errors.

Record the results for Task 7, and send any failures through a fix dispatch first.

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/CHANGELOG.md`

- [ ] **Step 1: `CLAUDE.md`**
- **Architecture map:** `src/doc/` gains `path-edit.ts` (pure node edits); `src/geom/bezier.ts`'s entry mentions `splitCubic`/`nearestOnSubpath`; `src/tools/` gains `node-tool.ts`.
- **New gotchas** (next numbers, one idea each):
  - node coordinates are in the path's own space, so the node tool maps the pointer through the inverse of the path's world matrix and does nothing when it is singular;
  - no edit may leave a subpath with fewer than two nodes, a path with no subpaths (the store deletes the whole path instead), or a closed subpath whose last node repeats its first — the importer drops or merges all three;
  - `app.nodeTarget`/`app.nodeSel` are store state (not saved, not undoable), re-resolved in `setSession`, and Escape walks node selection → node target → entered group → object selection.
- **Commands:** the test count from the actual run.
- **Roadmap / current state:** `Milestone 4a (node editing) — see CHANGELOG. Next is milestone 4b: the pen tool.` Keep the M4 constraint paragraph but drop the two items this milestone fixed (the closed-subpath node and the flattening scale), and keep the still-parked ones.
- **Verification debt:** add what the browser pass could not cover (iPad).

- [ ] **Step 2: `README.md`**
- **Status:** add `- Node editing: the Node tool (N) moves nodes and handles, adds and deletes nodes, changes node type and closes a path.`
- **Keyboard table:** add `| Edit nodes | N |`, then `npx prettier --write README.md`.
- **Roadmap:** `Next: the pen tool.`
- **Development:** the real test count.

- [ ] **Step 3: `docs/superpowers/CHANGELOG.md`** — append an entry for milestone 4a: what shipped (the tool, the six pure edits, the two geometry helpers, snapping to nodes, the Node section and menu items), the parked findings it fixed (the coincident-point tolerance and flattening by scale), the plan path, a `Browser-verified:` line the controller fills in, and an `Owed:` line (iPad node dragging and double-tap, Safari/Firefox, the pen tool itself).

- [ ] **Step 4: Verify and commit**

Run `npm test` and `npm run format:check`.

```bash
git add CLAUDE.md README.md docs/superpowers/CHANGELOG.md
git commit -m "docs: milestone 4a node editing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
