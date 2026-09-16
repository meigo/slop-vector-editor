# Milestone 2a — Select, Transform, Shapes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the M1 viewer into an editor: select/move/resize/rotate objects with a gizmo, draw
rectangles, ellipses, lines and polygons/stars, and edit style and geometry in a properties panel,
with equal mouse and touch/Pencil access.

**Architecture:** Pure geometry (`geom/box`, `bezier`, `bounds`, `hit`, `shapes`), pure edits
(`doc/tree`, `doc/edits`, `doc/resize`), pure gizmo/frame math (`tools/frame`, `tools/gizmo`), and
tools as small state machines that talk to the app only through a `ToolContext` interface, so they
are unit-tested with a fake context. The canvas routes pointers (`input/route`) to the active tool,
and Svelte components render the overlay, tool strip, context bar, modifier dock and properties
panel.

**Tech Stack:** Svelte 5 (runes), TypeScript 5.9 strict, Vite 8, Tailwind 4, Vitest 4 (node env),
`@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-09-16-m2a-select-transform-shapes-design.md` (binding), which
extends `docs/superpowers/specs/2026-09-16-slop-vector-editor-design.md`.

## Global Constraints

- `npm run build` (= `svelte-check && tsc --noEmit && vite build`) must end with **0 errors, 0 warnings**; `npm run lint` silent; `npm test` all passing.
- Vitest runs in node with no DOM: only pure logic is unit-tested. UI tasks are gated by the build and a dev-server compile check; the controller runs the real browser pass.
- tsconfig: `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums, no namespaces, **no constructor parameter properties**).
- The document is immutable: every edit returns a new object and never mutates its input; an edit that changes nothing returns the **same reference**.
- **Resize bakes scale into geometry** (spec §1); move and rotate only change the node matrix; stroke widths never change on resize; rect corner radius is kept (clamped to `min(w, h) / 2`).
- **No tool or edit creates** a zero-size rect/ellipse, an empty group or a path without nodes. Shape tools create nothing for a drag shorter than `MIN_DRAG_PX = 2` screen px.
- Hit tolerance in screen px: 6 for mouse, 14 for touch/pen. Handle size: 8 px mouse, 16 px touch/pen. Rotate knob 24 px outside the top edge. Rotation snap 15°. Minimum resized size 0.01 doc units.
- Selection holds top-level node ids only, is not in undo history, and is pruned to ids on visible, unlocked layers after every document change.
- The store is exported as `app` (never `state`). Tools never import the store; they use `ToolContext`.
- Every drag surface sets `touch-action: none`; `pointercancel` and `lostpointercapture` end a gesture like a cancel; `setPointerCapture` is wrapped in try/catch.
- No native `alert`/`confirm`/`prompt`. UI colors come from the theme tokens (`var(--color-accent)` etc. or the Tailwind token classes), never new hex values in components.
- Numbers from the plan's tests were hand-computed; if a test disagrees with the code, trace the input before changing either, and report it.
- Commit trailer on every commit, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Git: branch `m2a-select-transform` off `main`; one commit per task; merge only when the user says so.

## File map

```
src/geom/box.ts          Box type, boxFromPoints, unionBox, boxContains, boxCenter, boxCorners, boxMap
src/geom/bezier.ts       Cubic, cubicPoint, cubicBounds, segmentCubic, flattenCubic, flattenSubpath
src/geom/mat.ts          + rotationOf, isSkewed, isAxisAligned, rotateAbout
src/geom/bounds.ts       nodeBounds(node, m)
src/geom/shapes.ts       + linePath, polygonPath, starPath, ellipsePath, transformSubpaths, toPath; rectPath merges coincident nodes
src/geom/hit.ts          hitTest, marqueeSelect
src/doc/tree.ts          findTopLevel, selectableIds, targetLayerId, pruneSelection, mapTopLevel, mapShapes, shapesOf
src/doc/edits.ts         + addShape, deleteNodes, duplicateNodes, translateNodes, rotateNodes, setStyle, setRectRadius, convertToPath, flattenTransform
src/doc/resize.ts        resizeNode, resizeNodes
src/tools/types.ts       ToolId, Mods, NO_MODS
src/tools/frame.ts       Frame, selectionFrame, selectionBounds, frameToDoc, docToFrame, frameCenter, frameResizeMap
src/tools/gizmo.ts       handles, handleAt, dragHandle, rotateDelta, normalizeAngle, frameOutline
src/tools/tool.ts        ToolEvent, Overlay, ToolContext, Tool, MIN_DRAG_PX, pointerTolerance, movedEnough
src/tools/shape-tools.ts dragBox, snapLineEnd, lineStyle, create{Rect,Ellipse,Line,Polygon,Hand}Tool
src/tools/select.ts      createSelectTool
src/tools/registry.ts    TOOLS
src/tools/context.ts     storeContext (ToolContext bound to the store)
src/input/route.ts       routePointerDown
src/input/dock.ts        Latch, dockDown, dockUp
src/persist/preferences.ts  Prefs, DEFAULT_PREFS, sanitizePrefs, loadPrefs, savePrefs
src/persist/tab-presence.ts watchOtherTabs
src/state/keys.ts        + EditAction, editActionForKey
src/state/commands.ts    + runEditAction
src/state/properties.ts  Field, summarizeStyles, selectionStyles, selectionGeometry, applyGeometryField
src/state/appState.svelte.ts  + selection, toolId, prefs, dock, spaceHeld, overlay, contextMenu, propertiesOpen, lastPointerType and actions
src/lib/Canvas.svelte    pointer routing to tools, context menu, cursor
src/lib/Overlay.svelte   selection outlines, gizmo, marquee
src/lib/ToolStrip.svelte, ContextBar.svelte, ModifierDock.svelte, ContextMenu.svelte,
        NumberField.svelte, PaintField.svelte, PropertiesPanel.svelte
src/App.svelte, src/lib/TopBar.svelte, src/lib/StatusBar.svelte, src/app.css
src/__tests__/*.test.ts, src/__tests__/fake-context.ts
CLAUDE.md, README.md, docs/superpowers/CHANGELOG.md
```

---

### Task 1: Boxes and bezier math

**Files:**
- Create: `src/geom/box.ts`, `src/geom/bezier.ts`
- Test: `src/__tests__/box-bezier.test.ts`

**Interfaces:**
- Consumes: `Vec`, `dist` (`src/geom/vec.ts`); `Mat` (`src/geom/mat.ts`); `PathNode`, `Subpath` (`src/doc/document.ts`).
- Produces:
  - `type Box = { x: number; y: number; w: number; h: number }`
  - `boxFromPoints(points: readonly Vec[]): Box | null`; `unionBox(a: Box | null, b: Box | null): Box | null`; `boxContains(outer: Box, inner: Box, eps?: number): boolean`; `boxCenter(b: Box): Vec`; `boxCorners(b: Box): [Vec, Vec, Vec, Vec]` (nw, ne, se, sw); `boxMap(from: Box, to: Box): Mat` (`to` may have negative w/h; an axis with `from` size 0 keeps scale 1)
  - `type Cubic = readonly [Vec, Vec, Vec, Vec]`; `cubicPoint(c, t): Vec`; `cubicBounds(c): Box`; `segmentCubic(a: PathNode, b: PathNode): Cubic | null` (null = straight); `flattenCubic(c, out: Vec[]): void` (appends `n = clamp(ceil(controlPolygonLength / 4), 4, 64)` points, excluding the start); `flattenSubpath(sp: Subpath): Vec[]` (closed subpaths end at their first point)

- [ ] **Step 1: Create the branch**

```bash
cd /Users/meigo/Projects/slop/slop-vector-editor
git checkout -b m2a-select-transform
```

- [ ] **Step 2: Write the failing test** — `src/__tests__/box-bezier.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { PathNode } from "../doc/document";
import {
  cubicBounds,
  cubicPoint,
  flattenCubic,
  flattenSubpath,
  segmentCubic,
  type Cubic,
} from "../geom/bezier";
import {
  boxCenter,
  boxContains,
  boxCorners,
  boxFromPoints,
  boxMap,
  unionBox,
} from "../geom/box";
import { applyMat } from "../geom/mat";
import type { Vec } from "../geom/vec";

const corner = (x: number, y: number): PathNode => ({
  p: { x, y },
  in: null,
  out: null,
  type: "corner",
});

describe("box", () => {
  it("builds boxes from points and unions them", () => {
    expect(boxFromPoints([])).toBeNull();
    expect(boxFromPoints([{ x: 3, y: 4 }, { x: -1, y: 10 }])).toEqual({ x: -1, y: 4, w: 4, h: 6 });
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(unionBox(null, a)).toBe(a);
    expect(unionBox(a, null)).toBe(a);
    expect(unionBox(a, { x: 5, y: -5, w: 10, h: 5 })).toEqual({ x: 0, y: -5, w: 15, h: 15 });
  });

  it("tests containment, centre and corners", () => {
    const outer = { x: 0, y: 0, w: 10, h: 10 };
    expect(boxContains(outer, { x: 1, y: 1, w: 9, h: 9 })).toBe(true);
    expect(boxContains(outer, { x: 1, y: 1, w: 10, h: 9 })).toBe(false);
    expect(boxCenter(outer)).toEqual({ x: 5, y: 5 });
    expect(boxCorners(outer)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it("maps one box onto another, including mirrors and zero-size axes", () => {
    const m = boxMap({ x: 10, y: 10, w: 10, h: 20 }, { x: 0, y: 0, w: 20, h: 10 });
    expect(applyMat(m, { x: 10, y: 10 })).toEqual({ x: 0, y: 0 });
    expect(applyMat(m, { x: 20, y: 30 })).toEqual({ x: 20, y: 10 });
    const flip = boxMap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: -10, h: 10 });
    expect(applyMat(flip, { x: 10, y: 0 })).toEqual({ x: -10, y: 0 });
    const flat = boxMap({ x: 0, y: 5, w: 10, h: 0 }, { x: 0, y: 8, w: 20, h: 0 });
    expect(applyMat(flat, { x: 10, y: 5 })).toEqual({ x: 20, y: 8 });
  });
});

describe("bezier", () => {
  const arch: Cubic = [
    { x: 0, y: 0 },
    { x: 0, y: -10 },
    { x: 10, y: -10 },
    { x: 10, y: 0 },
  ];

  it("evaluates points", () => {
    expect(cubicPoint(arch, 0)).toEqual({ x: 0, y: 0 });
    expect(cubicPoint(arch, 1)).toEqual({ x: 10, y: 0 });
    expect(cubicPoint(arch, 0.5)).toEqual({ x: 5, y: -7.5 });
  });

  it("computes exact bounds from derivative roots", () => {
    const b = cubicBounds(arch);
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(-7.5);
    expect(b.w).toBeCloseTo(10);
    expect(b.h).toBeCloseTo(7.5);
  });

  it("returns null for straight segments", () => {
    expect(segmentCubic(corner(0, 0), corner(1, 1))).toBeNull();
    const a = { ...corner(0, 0), out: { x: 0, y: -10 } };
    expect(segmentCubic(a, corner(10, 0))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -10 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("flattens with 4 to 64 segments", () => {
    const shortOut: Vec[] = [];
    flattenCubic(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      shortOut,
    );
    expect(shortOut).toHaveLength(4);
    const longOut: Vec[] = [];
    flattenCubic(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 2000, y: 0 },
        { x: 3000, y: 0 },
      ],
      longOut,
    );
    expect(longOut).toHaveLength(64);
    expect(longOut[63]).toEqual({ x: 3000, y: 0 });
  });

  it("flattens subpaths, closing back to the start", () => {
    const square = flattenSubpath({
      closed: true,
      nodes: [corner(0, 0), corner(10, 0), corner(10, 10), corner(0, 10)],
    });
    expect(square).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]);
    const open = flattenSubpath({ closed: false, nodes: [corner(0, 0), corner(5, 5)] });
    expect(open).toHaveLength(2);
    expect(flattenSubpath({ closed: true, nodes: [] })).toEqual([]);
    const curved = flattenSubpath({
      closed: false,
      nodes: [{ ...corner(0, 0), out: { x: 0, y: -10 } }, { ...corner(10, 0), in: { x: 10, y: -10 } }],
    });
    expect(curved.length).toBeGreaterThan(2);
    expect(curved[curved.length - 1]).toEqual({ x: 10, y: 0 });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/__tests__/box-bezier.test.ts`
Expected: FAIL — cannot resolve `../geom/bezier`.

- [ ] **Step 4: Implement** — `src/geom/box.ts`

```ts
import type { Mat } from "./mat";
import type { Vec } from "./vec";

/** An axis-aligned rectangle. Sizes are non-negative, except a resize target passed to `boxMap`,
 *  whose negative size means "mirrored". */
export type Box = { x: number; y: number; w: number; h: number };

export function boxFromPoints(points: readonly Vec[]): Box | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function boxContains(outer: Box, inner: Box, eps = 1e-9): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

export function boxCenter(b: Box): Vec {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** nw, ne, se, sw */
export function boxCorners(b: Box): [Vec, Vec, Vec, Vec] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
}

/** The affine map taking `from` onto `to`. A negative `to` size mirrors. An axis where `from` has
 *  zero size (e.g. a horizontal line's height) keeps scale 1 and only moves. */
export function boxMap(from: Box, to: Box): Mat {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  return [sx, 0, 0, sy, to.x - sx * from.x, to.y - sy * from.y];
}
```

`src/geom/bezier.ts`:

```ts
import type { PathNode, Subpath } from "../doc/document";
import { boxFromPoints, type Box } from "./box";
import { dist, type Vec } from "./vec";

export type Cubic = readonly [Vec, Vec, Vec, Vec];

export function cubicPoint(c: Cubic, t: number): Vec {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return {
    x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
    y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
  };
}

/** Parameters in (0, 1) where one coordinate of the cubic has a derivative of zero. */
function extremaT(p0: number, p1: number, p2: number, p3: number): number[] {
  const u = p1 - p0;
  const v = p2 - p1;
  const w = p3 - p2;
  const A = u - 2 * v + w;
  const B = 2 * (v - u);
  const C = u;
  const roots: number[] = [];
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) roots.push(-C / B);
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-B + s) / (2 * A), (-B - s) / (2 * A));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

export function cubicBounds(c: Cubic): Box {
  const pts: Vec[] = [c[0], c[3]];
  for (const t of extremaT(c[0].x, c[1].x, c[2].x, c[3].x)) pts.push(cubicPoint(c, t));
  for (const t of extremaT(c[0].y, c[1].y, c[2].y, c[3].y)) pts.push(cubicPoint(c, t));
  return boxFromPoints(pts)!;
}

/** The segment from `a` to `b` as a cubic, or null when it is a straight line. */
export function segmentCubic(a: PathNode, b: PathNode): Cubic | null {
  if (!a.out && !b.in) return null;
  return [a.p, a.out ?? a.p, b.in ?? b.p, b.p];
}

/** Appends points along `c` (excluding its start) to `out`. */
export function flattenCubic(c: Cubic, out: Vec[]): void {
  const len = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
  const n = Math.min(64, Math.max(4, Math.ceil(len / 4)));
  for (let i = 1; i <= n; i++) out.push(cubicPoint(c, i / n));
}

/** A subpath as a polyline. A closed subpath ends back at its first point. */
export function flattenSubpath(sp: Subpath): Vec[] {
  const n = sp.nodes;
  if (n.length === 0) return [];
  const out: Vec[] = [n[0].p];
  const segment = (a: PathNode, b: PathNode) => {
    const c = segmentCubic(a, b);
    if (c) flattenCubic(c, out);
    else out.push(b.p);
  };
  for (let i = 1; i < n.length; i++) segment(n[i - 1], n[i]);
  if (sp.closed && n.length > 1) segment(n[n.length - 1], n[0]);
  return out;
}
```

Note: `cubicPoint(arch, 0.5)` is exactly `{5, -7.5}` in floating point
(0.125·0 + 0.375·0 + 0.375·10 + 0.125·10 = 5).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/box-bezier.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/geom/box.ts src/geom/bezier.ts src/__tests__/box-bezier.test.ts
git commit -m "feat(geom): boxes and cubic bezier bounds/flattening

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Matrix decomposition helpers and node bounds

**Files:**
- Modify: `src/geom/mat.ts` (append)
- Create: `src/geom/bounds.ts`
- Test: `src/__tests__/bounds.test.ts`

**Interfaces:**
- Consumes: `Box`, `boxFromPoints`, `unionBox`; `cubicBounds`, `segmentCubic`; `Node`, `Subpath`, `PathNode`.
- Produces:
  - `mat.ts`: `rotationOf(m: Mat): number` (= `atan2(b, a)`); `isSkewed(m: Mat, eps = 1e-6): boolean` (columns not perpendicular, or a zero column); `isAxisAligned(m: Mat, eps = 1e-9): boolean` (`|b|, |c| ≤ eps`); `rotateAbout(rad: number, c: Vec): Mat`
  - `bounds.ts`: `nodeBounds(node: Node, m: Mat): Box | null` — geometric bounds (no stroke) of `node` drawn under `m` (the node's own transform is applied inside: `m · node.transform`).

- [ ] **Step 1: Write the failing test** — `src/__tests__/bounds.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, type Group, type Node } from "../doc/document";
import { nodeBounds } from "../geom/bounds";
import {
  applyMat,
  IDENTITY,
  isAxisAligned,
  isSkewed,
  multiply,
  rotate,
  rotateAbout,
  rotationOf,
  scale,
  skewX,
  translate,
} from "../geom/mat";

const rect = (x: number, y: number, w: number, h: number): Node => ({
  kind: "rect",
  id: "r",
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x,
  y,
  w,
  h,
  rx: 0,
});

const expectBox = (
  b: { x: number; y: number; w: number; h: number } | null,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  expect(b).not.toBeNull();
  expect(b!.x).toBeCloseTo(x);
  expect(b!.y).toBeCloseTo(y);
  expect(b!.w).toBeCloseTo(w);
  expect(b!.h).toBeCloseTo(h);
};

describe("matrix helpers", () => {
  it("reads rotation and detects skew and axis alignment", () => {
    expect(rotationOf(rotate(0.5))).toBeCloseTo(0.5);
    expect(isSkewed(rotate(0.7))).toBe(false);
    expect(isSkewed(skewX(0.3))).toBe(true);
    expect(isSkewed(multiply(rotate(0.4), scale(2, 3)))).toBe(false);
    expect(isSkewed(multiply(scale(2, 3), rotate(0.4)))).toBe(true);
    expect(isSkewed([0, 0, 0, 1, 0, 0])).toBe(true);
    expect(isAxisAligned(scale(2, 3))).toBe(true);
    expect(isAxisAligned(rotate(0.1))).toBe(false);
  });

  it("rotates about a point", () => {
    const p = applyMat(rotateAbout(Math.PI / 2, { x: 10, y: 0 }), { x: 20, y: 0 });
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(10);
  });
});

describe("nodeBounds", () => {
  it("bounds a rect, including under rotation", () => {
    expectBox(nodeBounds(rect(0, 0, 10, 20), IDENTITY), 0, 0, 10, 20);
    expectBox(nodeBounds(rect(0, 0, 10, 20), rotate(Math.PI / 2)), -20, 0, 20, 10);
  });

  it("bounds an ellipse exactly under rotation", () => {
    const e: Node = {
      kind: "ellipse",
      id: "e",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      cx: 0,
      cy: 0,
      rx: 10,
      ry: 5,
    };
    expectBox(nodeBounds(e, IDENTITY), -10, -5, 20, 10);
    expectBox(nodeBounds(e, rotate(Math.PI / 2)), -5, -10, 10, 20);
  });

  it("bounds a curved path by its extrema, not its handles", () => {
    const p: Node = {
      kind: "path",
      id: "p",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: { x: 0, y: 0 }, in: null, out: { x: 0, y: -10 }, type: "corner" },
            { p: { x: 10, y: 0 }, in: { x: 10, y: -10 }, out: null, type: "corner" },
          ],
        },
      ],
    };
    expectBox(nodeBounds(p, IDENTITY), 0, -7.5, 10, 7.5);
  });

  it("applies the node's own transform and unions group children", () => {
    const g: Group = {
      kind: "group",
      id: "g",
      transform: translate(100, 0),
      opacity: 1,
      children: [
        rect(0, 0, 10, 10),
        {
          kind: "ellipse",
          id: "e",
          transform: IDENTITY,
          style: DEFAULT_STYLE,
          cx: 50,
          cy: 0,
          rx: 5,
          ry: 5,
        },
      ],
    };
    expectBox(nodeBounds(g, IDENTITY), 100, -5, 55, 15);
    expect(nodeBounds({ ...g, children: [] }, IDENTITY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/bounds.test.ts`
Expected: FAIL — `rotationOf` is not exported / cannot resolve `../geom/bounds`.

- [ ] **Step 3: Implement** — append to `src/geom/mat.ts`

```ts
/** The rotation of the matrix's x axis, in radians. */
export function rotationOf(m: Mat): number {
  return Math.atan2(m[1], m[0]);
}

/** True when the matrix maps a rectangle to a non-rectangle (shear, or a collapsed axis). */
export function isSkewed(m: Mat, eps = 1e-6): boolean {
  const la = Math.hypot(m[0], m[1]);
  const lb = Math.hypot(m[2], m[3]);
  if (la === 0 || lb === 0) return true;
  return Math.abs(m[0] * m[2] + m[1] * m[3]) / (la * lb) > eps;
}

/** True when the matrix has no rotation or shear (scale + translate only). */
export function isAxisAligned(m: Mat, eps = 1e-9): boolean {
  return Math.abs(m[1]) <= eps && Math.abs(m[2]) <= eps;
}

export function rotateAbout(rad: number, c: Vec): Mat {
  return multiply(translate(c.x, c.y), multiply(rotate(rad), translate(-c.x, -c.y)));
}
```

`src/geom/bounds.ts`:

```ts
import type { Node, PathNode, Subpath } from "../doc/document";
import { cubicBounds, segmentCubic } from "./bezier";
import { boxFromPoints, unionBox, type Box } from "./box";
import { applyMat, multiply, type Mat } from "./mat";

function mapNode(m: Mat, n: PathNode): PathNode {
  return {
    p: applyMat(m, n.p),
    in: n.in && applyMat(m, n.in),
    out: n.out && applyMat(m, n.out),
    type: n.type,
  };
}

function pathBounds(subpaths: readonly Subpath[], m: Mat): Box | null {
  let box: Box | null = null;
  const segment = (a: PathNode, b: PathNode) => {
    const c = segmentCubic(a, b);
    box = unionBox(box, c ? cubicBounds(c) : boxFromPoints([b.p]));
  };
  for (const sp of subpaths) {
    const n = sp.nodes.map((node) => mapNode(m, node));
    if (n.length === 0) continue;
    box = unionBox(box, boxFromPoints([n[0].p]));
    for (let i = 1; i < n.length; i++) segment(n[i - 1], n[i]);
    if (sp.closed && n.length > 1) segment(n[n.length - 1], n[0]);
  }
  return box;
}

/** Geometric bounds (stroke excluded) of `node` drawn under `m`. */
export function nodeBounds(node: Node, m: Mat): Box | null {
  const t = multiply(m, node.transform);
  switch (node.kind) {
    case "group": {
      let box: Box | null = null;
      for (const c of node.children) box = unionBox(box, nodeBounds(c, t));
      return box;
    }
    case "rect":
      return boxFromPoints(
        [
          { x: node.x, y: node.y },
          { x: node.x + node.w, y: node.y },
          { x: node.x + node.w, y: node.y + node.h },
          { x: node.x, y: node.y + node.h },
        ].map((p) => applyMat(t, p)),
      );
    case "ellipse": {
      const c = applyMat(t, { x: node.cx, y: node.cy });
      const ex = Math.hypot(t[0] * node.rx, t[2] * node.ry);
      const ey = Math.hypot(t[1] * node.rx, t[3] * node.ry);
      return { x: c.x - ex, y: c.y - ey, w: 2 * ex, h: 2 * ey };
    }
    case "path":
      return pathBounds(node.subpaths, t);
  }
}
```

If TypeScript narrows `box` to `null` inside `pathBounds` after the closure assignment (a known
control-flow limitation), declare it as `let box = null as Box | null;`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/bounds.test.ts` then `npm test` and `npx tsc --noEmit`
Expected: PASS (6 tests); full suite green; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/geom/mat.ts src/geom/bounds.ts src/__tests__/bounds.test.ts
git commit -m "feat(geom): matrix decomposition helpers and node bounds

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Shape generators, path transforms and convert-to-path

**Files:**
- Modify: `src/geom/shapes.ts`
- Test: `src/__tests__/shapes.test.ts`

**Interfaces:**
- Consumes: `KAPPA`, `rectPath` (existing in `shapes.ts`); `applyMat`, `Mat`; `PathNode`, `Subpath`, `RectShape`, `EllipseShape`, `PathShape`.
- Produces (all in `src/geom/shapes.ts`):
  - `linePath(a: Vec, b: Vec): Subpath` (open, 2 corner nodes)
  - `polygonPath(c: Vec, r: number, sides: number, rotation: number): Subpath` — closed; node `i` at angle `rotation + i·2π/sides`
  - `starPath(c: Vec, r: number, innerRatio: number, points: number, rotation: number): Subpath` — closed, `2·points` nodes; node `i` at angle `rotation + i·π/points`, radius `r` for even `i`, `r·innerRatio` for odd
  - `ellipsePath(cx, cy, rx, ry): Subpath` — closed, 4 `symmetric` nodes: right, bottom, left, top, handles `KAPPA·r`
  - `transformSubpaths(subpaths: readonly Subpath[], m: Mat): Subpath[]`
  - `toPath(s: RectShape | EllipseShape): PathShape` — same id, name, transform, style; rect corner radius clamped to `min(rx, w/2, h/2)`
  - `rectPath` now merges consecutive coincident nodes (a radius of exactly half a side no longer yields duplicate nodes); a merged node keeps the first node's `in`, the second's `out`, and is `smooth` when both exist.

- [ ] **Step 1: Write the failing test** — `src/__tests__/shapes.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, type EllipseShape, type RectShape } from "../doc/document";
import { translate } from "../geom/mat";
import {
  ellipsePath,
  KAPPA,
  linePath,
  polygonPath,
  rectPath,
  starPath,
  toPath,
  transformSubpaths,
} from "../geom/shapes";

const closeTo = (a: { x: number; y: number }, x: number, y: number) => {
  expect(a.x).toBeCloseTo(x);
  expect(a.y).toBeCloseTo(y);
};

describe("shape generators", () => {
  it("makes a line", () => {
    expect(linePath({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({
      closed: false,
      nodes: [
        { p: { x: 1, y: 2 }, in: null, out: null, type: "corner" },
        { p: { x: 3, y: 4 }, in: null, out: null, type: "corner" },
      ],
    });
  });

  it("makes a polygon starting at the rotation angle", () => {
    const sp = polygonPath({ x: 0, y: 0 }, 10, 4, -Math.PI / 2);
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(4);
    closeTo(sp.nodes[0].p, 0, -10);
    closeTo(sp.nodes[1].p, 10, 0);
    closeTo(sp.nodes[2].p, 0, 10);
    closeTo(sp.nodes[3].p, -10, 0);
  });

  it("makes a star with alternating radii", () => {
    const sp = starPath({ x: 0, y: 0 }, 10, 0.5, 5, -Math.PI / 2);
    expect(sp.nodes).toHaveLength(10);
    closeTo(sp.nodes[0].p, 0, -10);
    const a = -Math.PI / 2 + Math.PI / 5;
    closeTo(sp.nodes[1].p, 5 * Math.cos(a), 5 * Math.sin(a));
  });

  it("makes an ellipse from four symmetric nodes", () => {
    const sp = ellipsePath(0, 0, 10, 5);
    expect(sp.closed).toBe(true);
    expect(sp.nodes.map((n) => n.p)).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 5 },
      { x: -10, y: 0 },
      { x: 0, y: -5 },
    ]);
    expect(sp.nodes[0].out).toEqual({ x: 10, y: 5 * KAPPA });
    expect(sp.nodes[0].in).toEqual({ x: 10, y: -5 * KAPPA });
    expect(sp.nodes.every((n) => n.type === "symmetric")).toBe(true);
  });

  it("merges coincident rect nodes when a radius is half a side", () => {
    expect(rectPath(0, 0, 20, 10, 2, 4).nodes).toHaveLength(8);
    const pill = rectPath(0, 0, 10, 20, 5, 5);
    expect(pill.nodes).toHaveLength(6);
    expect(pill.nodes[0].p).toEqual({ x: 5, y: 0 });
    expect(pill.nodes[0].in).not.toBeNull();
    expect(pill.nodes[0].out).not.toBeNull();
    expect(pill.nodes[0].type).toBe("smooth");
    expect(rectPath(0, 0, 10, 10, 5, 5).nodes).toHaveLength(4);
  });

  it("transforms every point and handle", () => {
    const [sp] = transformSubpaths([ellipsePath(0, 0, 10, 5)], translate(100, 0));
    expect(sp.nodes[0].p).toEqual({ x: 110, y: 0 });
    expect(sp.nodes[0].out).toEqual({ x: 110, y: 5 * KAPPA });
    expect(sp.closed).toBe(true);
  });
});

describe("toPath", () => {
  it("converts a rect, keeping id, name, transform and style", () => {
    const r: RectShape = {
      kind: "rect",
      id: "n7",
      name: "Box",
      transform: translate(5, 5),
      style: DEFAULT_STYLE,
      x: 0,
      y: 0,
      w: 10,
      h: 20,
      rx: 50,
    };
    const p = toPath(r);
    expect(p.kind).toBe("path");
    expect(p.id).toBe("n7");
    expect(p.name).toBe("Box");
    expect(p.transform).toBe(r.transform);
    expect(p.style).toBe(r.style);
    expect(p.subpaths).toHaveLength(1);
    expect(p.subpaths[0].nodes).toHaveLength(6); // radius clamped to 5 → pill
  });

  it("converts an ellipse", () => {
    const e: EllipseShape = {
      kind: "ellipse",
      id: "n8",
      transform: translate(0, 0),
      style: DEFAULT_STYLE,
      cx: 1,
      cy: 2,
      rx: 3,
      ry: 4,
    };
    const p = toPath(e);
    expect(p.subpaths[0].nodes[0].p).toEqual({ x: 4, y: 2 });
    expect("name" in p).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/shapes.test.ts`
Expected: FAIL — `linePath` is not exported.

- [ ] **Step 3: Implement** — edit `src/geom/shapes.ts`

Change the imports at the top to:

```ts
import type { EllipseShape, PathNode, PathShape, RectShape, Subpath } from "../doc/document";
import { applyMat, type Mat } from "./mat";
import type { Vec } from "./vec";
```

Add this helper above `rectPath`:

```ts
/** Merges consecutive nodes at the same point (including last → first of a closed path). */
function mergeCoincident(nodes: PathNode[]): PathNode[] {
  const same = (a: PathNode, b: PathNode) => a.p.x === b.p.x && a.p.y === b.p.y;
  const merge = (a: PathNode, b: PathNode): PathNode => ({
    p: a.p,
    in: a.in,
    out: b.out,
    type: a.in && b.out ? "smooth" : a.type,
  });
  const out: PathNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (last && same(last, n)) out[out.length - 1] = merge(last, n);
    else out.push(n);
  }
  if (out.length > 1 && same(out[out.length - 1], out[0])) {
    out[0] = merge(out[out.length - 1], out[0]);
    out.pop();
  }
  return out;
}
```

In `rectPath`, wrap the rounded case's node array: replace `nodes: [` (the 8-node array in the
second `return`) with `nodes: mergeCoincident([` and its closing `],` with `]),`.

Append:

```ts
export function linePath(a: Vec, b: Vec): Subpath {
  return { closed: false, nodes: [node(a), node(b)] };
}

export function polygonPath(c: Vec, r: number, sides: number, rotation: number): Subpath {
  const nodes: PathNode[] = [];
  for (let i = 0; i < sides; i++) {
    const t = rotation + (i * 2 * Math.PI) / sides;
    nodes.push(node({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }));
  }
  return { closed: true, nodes };
}

export function starPath(
  c: Vec,
  r: number,
  innerRatio: number,
  points: number,
  rotation: number,
): Subpath {
  const nodes: PathNode[] = [];
  for (let i = 0; i < 2 * points; i++) {
    const t = rotation + (i * Math.PI) / points;
    const radius = i % 2 === 0 ? r : r * innerRatio;
    nodes.push(node({ x: c.x + radius * Math.cos(t), y: c.y + radius * Math.sin(t) }));
  }
  return { closed: true, nodes };
}

/** A closed ellipse from four symmetric nodes: right, bottom, left, top (clockwise on screen). */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): Subpath {
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  const sym = (p: Vec, inH: Vec, out: Vec): PathNode => ({ p, in: inH, out, type: "symmetric" });
  return {
    closed: true,
    nodes: [
      sym({ x: cx + rx, y: cy }, { x: cx + rx, y: cy - ky }, { x: cx + rx, y: cy + ky }),
      sym({ x: cx, y: cy + ry }, { x: cx + kx, y: cy + ry }, { x: cx - kx, y: cy + ry }),
      sym({ x: cx - rx, y: cy }, { x: cx - rx, y: cy + ky }, { x: cx - rx, y: cy - ky }),
      sym({ x: cx, y: cy - ry }, { x: cx - kx, y: cy - ry }, { x: cx + kx, y: cy - ry }),
    ],
  };
}

export function transformSubpaths(subpaths: readonly Subpath[], m: Mat): Subpath[] {
  const f = (p: Vec) => applyMat(m, p);
  return subpaths.map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({
      p: f(n.p),
      in: n.in && f(n.in),
      out: n.out && f(n.out),
      type: n.type,
    })),
  }));
}

/** An equivalent path in the same local space, with the same id, name, transform and style. */
export function toPath(s: RectShape | EllipseShape): PathShape {
  let sp: Subpath;
  if (s.kind === "rect") {
    const r = Math.min(s.rx, s.w / 2, s.h / 2);
    sp = rectPath(s.x, s.y, s.w, s.h, r, r);
  } else {
    sp = ellipsePath(s.cx, s.cy, s.rx, s.ry);
  }
  const out: PathShape = {
    kind: "path",
    id: s.id,
    transform: s.transform,
    style: s.style,
    subpaths: [sp],
  };
  if (s.name !== undefined) out.name = s.name;
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/shapes.test.ts` then `npm test` (the existing importer tests
must still pass — `parse.test.ts` has an unequal-radius rect that must still yield 8 nodes) and
`npx tsc --noEmit`.
Expected: PASS (8 tests in shapes.test.ts); full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/geom/shapes.ts src/__tests__/shapes.test.ts
git commit -m "feat(geom): line/polygon/star/ellipse paths, path transforms, convert to path

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Hit-testing and marquee selection

**Files:**
- Create: `src/geom/hit.ts`
- Test: `src/__tests__/hit.test.ts`

**Interfaces:**
- Consumes: `flattenSubpath`; `nodeBounds`; `Box`, `boxContains`; `applyMat`, `invert`, `IDENTITY`; `Doc`, `Node`, `Shape`, `PathShape`.
- Produces:
  - `type Hit = { layerId: string; nodeId: string }`
  - `hitTest(doc: Doc, p: Vec, tol: number): Hit | null` — `p` and `tol` in doc units. Top-most top-level node on a visible, unlocked layer (later layers and later children are on top). A shape is hit when its fill is non-null and `p` is inside, or when the distance to its outline is ≤ `tol + (stroke ? strokeWidth / 2 : 0)`. Paths: all subpaths are implicitly closed for the fill test (nonzero winding). Groups are hit when any descendant is. The point and tolerance are mapped into each node's local space (tolerance divided by `√|det|`); a non-invertible matrix is never hit. Rect corner radius is ignored for hit-testing.
  - `marqueeSelect(doc: Doc, box: Box): string[]` — ids, in document order, of top-level nodes on visible, unlocked layers whose doc-space bounds lie fully inside `box`.

- [ ] **Step 1: Write the failing test** — `src/__tests__/hit.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Layer,
  type Node,
  type Style,
} from "../doc/document";
import { hitTest, marqueeSelect } from "../geom/hit";
import { IDENTITY, rotateAbout, scale, translate, type Mat } from "../geom/mat";

const filled: Style = { ...DEFAULT_STYLE, stroke: null };
const outlineOnly: Style = { ...DEFAULT_STYLE, fill: null, strokeWidth: 4 };

const rect = (id: string, x: number, y: number, style = filled, transform: Mat = IDENTITY): Node => ({
  kind: "rect",
  id,
  transform,
  style,
  x,
  y,
  w: 10,
  h: 10,
  rx: 0,
});

function doc(...layers: Partial<Layer>[]): Doc {
  const base = createDoc(100, 100);
  return {
    ...base,
    layers: layers.map((l, i) => ({
      id: `L${i}`,
      name: `L${i}`,
      visible: true,
      locked: false,
      children: [],
      ...l,
    })),
  };
}

const at = (x: number, y: number) => ({ x, y });

describe("hitTest", () => {
  it("hits a filled rect inside and misses outside the tolerance", () => {
    const d = doc({ children: [rect("a", 0, 0)] });
    expect(hitTest(d, at(5, 5), 1)).toEqual({ layerId: "L0", nodeId: "a" });
    expect(hitTest(d, at(12, 5), 1)).toBeNull();
    expect(hitTest(d, at(10.5, 5), 1)?.nodeId).toBe("a");
  });

  it("hits an unfilled shape only near its outline, widened by the stroke", () => {
    const d = doc({ children: [rect("a", 0, 0, outlineOnly)] });
    expect(hitTest(d, at(5, 5), 1)).toBeNull();
    expect(hitTest(d, at(2.5, 5), 1)?.nodeId).toBe("a"); // 2.5 from edge ≤ 1 + 4/2
    expect(hitTest(d, at(-2.9, 5), 1)?.nodeId).toBe("a");
    expect(hitTest(d, at(-3.1, 5), 1)).toBeNull();
  });

  it("hits ellipses", () => {
    const e: Node = {
      kind: "ellipse",
      id: "e",
      transform: IDENTITY,
      style: filled,
      cx: 50,
      cy: 50,
      rx: 20,
      ry: 10,
    };
    const d = doc({ children: [e] });
    expect(hitTest(d, at(65, 50), 0)?.nodeId).toBe("e");
    expect(hitTest(d, at(50, 62), 0)).toBeNull();
    expect(hitTest(d, at(50, 61), 1.5)?.nodeId).toBe("e");
    const ring = doc({ children: [{ ...e, style: outlineOnly }] });
    expect(hitTest(ring, at(50, 50), 1)).toBeNull();
    expect(hitTest(ring, at(71, 50), 1)?.nodeId).toBe("e");
  });

  it("fills paths with nonzero winding, closing open subpaths implicitly", () => {
    const tri: Node = {
      kind: "path",
      id: "t",
      transform: IDENTITY,
      style: filled,
      subpaths: [
        {
          closed: false,
          nodes: [
            { p: at(0, 0), in: null, out: null, type: "corner" },
            { p: at(20, 0), in: null, out: null, type: "corner" },
            { p: at(0, 20), in: null, out: null, type: "corner" },
          ],
        },
      ],
    };
    const d = doc({ children: [tri] });
    expect(hitTest(d, at(4, 4), 0)?.nodeId).toBe("t");
    expect(hitTest(d, at(15, 15), 0)).toBeNull();
  });

  it("respects node transforms and scales the tolerance", () => {
    const rotated = rect("r", 0, 0, filled, rotateAbout(Math.PI / 4, at(5, 5)));
    const d = doc({ children: [rotated] });
    expect(hitTest(d, at(5, -1.5), 0)?.nodeId).toBe("r"); // top corner now points up to y≈-2.07
    expect(hitTest(d, at(0.2, 0.2), 0)).toBeNull(); // old corner is outside now
    const big = doc({ children: [rect("s", 0, 0, outlineOnly, scale(10))] });
    // Stroke 4 local = 40 doc; tolerance 10 doc = 1 local. Edge at x=0; 49 doc away → miss.
    expect(hitTest(big, at(-49, 50), 10)).toBeNull();
    expect(hitTest(big, at(-29, 50), 10)?.nodeId).toBe("s");
  });

  it("returns the top-level group for a hit on a child", () => {
    const g: Node = {
      kind: "group",
      id: "g",
      transform: translate(50, 0),
      opacity: 1,
      children: [rect("inner", 0, 0)],
    };
    const d = doc({ children: [g] });
    expect(hitTest(d, at(55, 5), 0)?.nodeId).toBe("g");
    expect(hitTest(d, at(5, 5), 0)).toBeNull();
  });

  it("prefers the top-most node and skips hidden or locked layers", () => {
    const d = doc(
      { children: [rect("bottom", 0, 0)] },
      { children: [rect("top", 0, 0)] },
      { children: [rect("hidden", 0, 0)], visible: false },
      { children: [rect("locked", 0, 0)], locked: true },
    );
    expect(hitTest(d, at(5, 5), 0)).toEqual({ layerId: "L1", nodeId: "top" });
    const sameLayer = doc({ children: [rect("first", 0, 0), rect("second", 0, 0)] });
    expect(hitTest(sameLayer, at(5, 5), 0)?.nodeId).toBe("second");
  });

  it("never hits a node with a singular matrix", () => {
    const d = doc({ children: [rect("z", 0, 0, filled, [0, 0, 0, 0, 0, 0])] });
    expect(hitTest(d, at(0, 0), 5)).toBeNull();
  });
});

describe("marqueeSelect", () => {
  it("selects nodes fully inside, in document order, on selectable layers", () => {
    const d = doc(
      { children: [rect("a", 0, 0), rect("b", 20, 0)] },
      { children: [rect("c", 0, 0)], locked: true },
      { children: [rect("d", 5, 5)] },
    );
    expect(marqueeSelect(d, { x: -1, y: -1, w: 32, h: 12 })).toEqual(["a", "b"]);
    expect(marqueeSelect(d, { x: -1, y: -1, w: 17, h: 17 })).toEqual(["a", "d"]);
    expect(marqueeSelect(d, { x: 1, y: -1, w: 50, h: 50 })).toEqual(["b", "d"]);
  });
});
```

Hand-check of the rotated case: a 10×10 square rotated 45° about its centre (5, 5) has its top
corner at (5, 5 − 5√2) ≈ (5, −2.07), so (5, −1.5) is inside; the old corner (0.2, 0.2) is now
outside the diamond (|x−5| + |y−5| = 9.6 > 7.07).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/hit.test.ts`
Expected: FAIL — cannot resolve `../geom/hit`.

- [ ] **Step 3: Implement** — `src/geom/hit.ts`

```ts
import type { Doc, Node, PathShape, Shape } from "../doc/document";
import { flattenSubpath } from "./bezier";
import { nodeBounds } from "./bounds";
import { boxContains, type Box } from "./box";
import { applyMat, IDENTITY, invert } from "./mat";
import type { Vec } from "./vec";

export type Hit = { layerId: string; nodeId: string };

/** Flattened subpaths, cached per (immutable) path object. */
const flatCache = new WeakMap<PathShape, Vec[][]>();

function polylines(s: PathShape): Vec[][] {
  let polys = flatCache.get(s);
  if (!polys) {
    polys = s.subpaths.map(flattenSubpath);
    flatCache.set(s, polys);
  }
  return polys;
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPolylines(p: Vec, polys: Vec[][]): number {
  let best = Infinity;
  for (const poly of polys) {
    if (poly.length === 1) best = Math.min(best, Math.hypot(p.x - poly[0].x, p.y - poly[0].y));
    for (let i = 1; i < poly.length; i++) best = Math.min(best, distToSegment(p, poly[i - 1], poly[i]));
  }
  return best;
}

/** Nonzero winding over all polylines, each implicitly closed. */
function insideNonzero(p: Vec, polys: Vec[][]): boolean {
  let winding = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
      if (a.y <= p.y) {
        if (b.y > p.y && cross > 0) winding++;
      } else if (b.y <= p.y && cross < 0) {
        winding--;
      }
    }
  }
  return winding !== 0;
}

function shapeHit(s: Shape, p: Vec, tol: number): boolean {
  const reach = tol + (s.style.stroke ? s.style.strokeWidth / 2 : 0);
  switch (s.kind) {
    case "rect": {
      const inside = p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
      if (inside && s.style.fill) return true;
      const d = inside
        ? Math.min(p.x - s.x, s.x + s.w - p.x, p.y - s.y, s.y + s.h - p.y)
        : Math.hypot(
            Math.max(s.x - p.x, 0, p.x - (s.x + s.w)),
            Math.max(s.y - p.y, 0, p.y - (s.y + s.h)),
          );
      return d <= reach;
    }
    case "ellipse": {
      const nx = (p.x - s.cx) / s.rx;
      const ny = (p.y - s.cy) / s.ry;
      const q = Math.sqrt(nx * nx + ny * ny);
      if (q <= 1 && s.style.fill) return true;
      // Radial distance to the outline along the ray from the centre (exact for circles).
      const r = Math.hypot(p.x - s.cx, p.y - s.cy);
      const d = q === 0 ? Math.min(s.rx, s.ry) : Math.abs(r - r / q);
      return d <= reach;
    }
    case "path": {
      const polys = polylines(s);
      if (s.style.fill && insideNonzero(p, polys)) return true;
      return distToPolylines(p, polys) <= reach;
    }
  }
}

function nodeHit(n: Node, p: Vec, tol: number): boolean {
  const inv = invert(n.transform);
  if (!inv) return false;
  const m = n.transform;
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const lp = applyMat(inv, p);
  const lt = tol / s;
  if (n.kind === "group") return n.children.some((c) => nodeHit(c, lp, lt));
  return shapeHit(n, lp, lt);
}

export function hitTest(doc: Doc, p: Vec, tol: number): Hit | null {
  for (let li = doc.layers.length - 1; li >= 0; li--) {
    const layer = doc.layers[li];
    if (!layer.visible || layer.locked) continue;
    for (let i = layer.children.length - 1; i >= 0; i--) {
      const n = layer.children[i];
      if (nodeHit(n, p, tol)) return { layerId: layer.id, nodeId: n.id };
    }
  }
  return null;
}

export function marqueeSelect(doc: Doc, box: Box): string[] {
  const out: string[] = [];
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const n of layer.children) {
      const b = nodeBounds(n, IDENTITY);
      if (b && boxContains(box, b)) out.push(n.id);
    }
  }
  return out;
}
```

Hand-check of the scaled case: `scale(10)` with local stroke 4 → local reach = 10/10 + 2 = 3.
Point (−49, 50) → local (−4.9, 5), 4.9 from the edge → miss; (−29, 50) → (−2.9, 5) → hit.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/hit.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`.
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/geom/hit.ts src/__tests__/hit.test.ts
git commit -m "feat(geom): hit-testing with screen tolerance and marquee selection

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Tree helpers and object edits

**Files:**
- Create: `src/doc/tree.ts`
- Modify: `src/doc/edits.ts`
- Test: `src/__tests__/tree-edits.test.ts`

**Interfaces:**
- Consumes: document types, `idFor`; `multiply`, `translate`, `rotateAbout`, `isIdentity`, `IDENTITY`; `toPath`, `transformSubpaths`; `deepFreeze` (tests).
- Produces:
  - `tree.ts`:
    - `type Found = { layer: Layer; layerIndex: number; index: number; node: Node }`
    - `findTopLevel(doc, id): Found | null`
    - `selectableIds(doc): Set<string>` — top-level ids on visible, unlocked layers
    - `targetLayerId(doc): string | null` — the last (top-most) visible, unlocked layer
    - `pruneSelection(doc, ids: readonly string[]): readonly string[]` — keeps selectable ids in order, drops duplicates; returns the same array when nothing is dropped
    - `mapTopLevel(doc, ids: readonly string[], fn: (n: Node) => Node): Doc` — same reference when `fn` changes nothing
    - `mapShapes(node: Node, fn: (s: Shape) => Shape): Node` — recurses into groups; same reference when unchanged
    - `shapesOf(node: Node): Shape[]` — all shapes in document order
  - `edits.ts` (all same-reference when nothing changes, never mutating):
    - `addShape(doc, layerId, shape: Shape): { doc: Doc; id: string }` — the shape's `id` is replaced by `idFor(doc.nextId)`; appended on top of the layer; throws `Error` for an unknown layer
    - `deleteNodes(doc, ids)`
    - `duplicateNodes(doc, ids, dx, dy): { doc: Doc; ids: string[] }` — deep copies with fresh ids (a group's id before its children's), each inserted directly above its original, moved by `translate(dx, dy)`; `ids` = the copies' top-level ids in document order; `{ doc, ids: [] }` when nothing matched
    - `translateNodes(doc, ids, dx, dy)` — `M' = translate(dx, dy) · M`
    - `rotateNodes(doc, ids, angle, centre: Vec)` — `M' = rotateAbout(angle, centre) · M`
    - `setStyle(doc, ids, patch: Partial<Style>)` — applies to top-level shapes and to every shape inside selected groups
    - `setRectRadius(doc, ids, rx)` — rects only; clamped to `[0, min(w, h) / 2]`; non-finite → no change
    - `convertToPath(doc, ids)` — top-level rects/ellipses → `toPath`
    - `flattenTransform(doc, ids)` — top-level paths with a non-identity matrix: points mapped, matrix → `IDENTITY`

- [ ] **Step 1: Write the failing test** — `src/__tests__/tree-edits.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Group,
  type Layer,
  type Node,
  type RectShape,
} from "../doc/document";
import {
  addShape,
  convertToPath,
  deleteNodes,
  duplicateNodes,
  flattenTransform,
  rotateNodes,
  setRectRadius,
  setStyle,
  translateNodes,
} from "../doc/edits";
import {
  findTopLevel,
  mapShapes,
  mapTopLevel,
  pruneSelection,
  selectableIds,
  shapesOf,
  targetLayerId,
} from "../doc/tree";
import { applyMat, IDENTITY, translate } from "../geom/mat";
import { deepFreeze } from "./helpers";

const rect = (id: string, x = 0): RectShape => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x,
  y: 0,
  w: 10,
  h: 20,
  rx: 0,
});

const group = (id: string, children: Node[]): Group => ({
  kind: "group",
  id,
  transform: IDENTITY,
  opacity: 1,
  children,
});

function doc(layers: Partial<Layer>[], nextId = 100): Doc {
  return deepFreeze({
    ...createDoc(100, 100),
    nextId,
    layers: layers.map((l, i) => ({
      id: `L${i}`,
      name: `L${i}`,
      visible: true,
      locked: false,
      children: [],
      ...l,
    })),
  });
}

describe("tree", () => {
  const d = doc([
    { children: [rect("a"), group("g", [rect("inner")])] },
    { children: [rect("b")], locked: true },
    { children: [rect("c")], visible: false },
  ]);

  it("finds top-level nodes only", () => {
    const f = findTopLevel(d, "g");
    expect(f?.layerIndex).toBe(0);
    expect(f?.index).toBe(1);
    expect(f?.node.id).toBe("g");
    expect(findTopLevel(d, "inner")).toBeNull();
  });

  it("lists selectable ids and the target layer", () => {
    expect([...selectableIds(d)]).toEqual(["a", "g"]);
    expect(targetLayerId(d)).toBe("L0");
    expect(targetLayerId(doc([{ locked: true }]))).toBeNull();
    expect(targetLayerId(doc([{}, {}]))).toBe("L1");
  });

  it("prunes selections", () => {
    const sel = ["a", "g"];
    expect(pruneSelection(d, sel)).toBe(sel);
    expect(pruneSelection(d, ["b", "a", "inner", "a", "zz"])).toEqual(["a"]);
  });

  it("maps top-level nodes and shapes with same-reference no-ops", () => {
    expect(mapTopLevel(d, ["a"], (n) => n)).toBe(d);
    const moved = mapTopLevel(d, ["a"], (n) => ({ ...n, transform: translate(1, 0) }));
    expect(moved).not.toBe(d);
    expect(moved.layers[1]).toBe(d.layers[1]);
    const g = findTopLevel(d, "g")!.node;
    expect(mapShapes(g, (s) => s)).toBe(g);
    expect(shapesOf(g).map((s) => s.id)).toEqual(["inner"]);
  });
});

describe("edits", () => {
  it("adds a shape with a fresh id on top of the layer", () => {
    const d = doc([{ children: [rect("a")] }]);
    const r = addShape(d, "L0", rect(""));
    expect(r.id).toBe("n100");
    expect(r.doc.nextId).toBe(101);
    expect(r.doc.layers[0].children.map((n) => n.id)).toEqual(["a", "n100"]);
    expect(() => addShape(d, "nope", rect(""))).toThrow();
  });

  it("deletes nodes", () => {
    const d = doc([{ children: [rect("a"), rect("b")] }]);
    expect(deleteNodes(d, ["zz"])).toBe(d);
    expect(deleteNodes(d, ["a"]).layers[0].children.map((n) => n.id)).toEqual(["b"]);
  });

  it("duplicates above the original with fresh ids and an offset", () => {
    const d = doc([{ children: [rect("a"), group("g", [rect("inner")]), rect("b")] }]);
    const r = duplicateNodes(d, ["g", "a"], 10, 5);
    expect(r.ids).toEqual(["n100", "n101"]);
    expect(r.doc.layers[0].children.map((n) => n.id)).toEqual(["a", "n100", "g", "n101", "b"]);
    const copy = r.doc.layers[0].children[3] as Group;
    expect(copy.children[0].id).toBe("n102");
    expect(copy.transform).toEqual(translate(10, 5));
    expect(r.doc.nextId).toBe(103);
    expect(duplicateNodes(d, ["zz"], 0, 0)).toEqual({ doc: d, ids: [] });
  });

  it("translates and rotates matrices only", () => {
    const d = doc([{ children: [rect("a")] }]);
    expect(translateNodes(d, ["a"], 0, 0)).toBe(d);
    const t = translateNodes(d, ["a"], 3, 4).layers[0].children[0];
    expect(t.transform).toEqual(translate(3, 4));
    expect((t as RectShape).x).toBe(0);
    expect(rotateNodes(d, ["a"], 0, { x: 0, y: 0 })).toBe(d);
    const r = rotateNodes(d, ["a"], Math.PI / 2, { x: 5, y: 10 }).layers[0].children[0];
    const p = applyMat(r.transform, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(15);
    expect(p.y).toBeCloseTo(5);
  });

  it("sets style on shapes and inside groups", () => {
    const d = doc([{ children: [rect("a"), group("g", [rect("inner")])] }]);
    expect(setStyle(d, ["a"], { strokeWidth: DEFAULT_STYLE.strokeWidth })).toBe(d);
    expect(setStyle(d, ["a"], { fill: { ...DEFAULT_STYLE.fill! } })).toBe(d);
    const s = setStyle(d, ["a", "g"], { fill: null, strokeWidth: 3 });
    const [a, g] = s.layers[0].children;
    expect((a as RectShape).style.fill).toBeNull();
    expect((a as RectShape).style.strokeWidth).toBe(3);
    expect(((g as Group).children[0] as RectShape).style.strokeWidth).toBe(3);
    expect((a as RectShape).style.stroke).toEqual(DEFAULT_STYLE.stroke);
  });

  it("sets a clamped rect radius", () => {
    const d = doc([{ children: [rect("a"), group("g", [])] }]);
    expect(setRectRadius(d, ["a"], 0)).toBe(d);
    expect(setRectRadius(d, ["a"], Number.NaN)).toBe(d);
    expect((setRectRadius(d, ["a", "g"], 99).layers[0].children[0] as RectShape).rx).toBe(5);
    expect((setRectRadius(d, ["a"], -3).layers[0].children[0] as RectShape).rx).toBe(0);
  });

  it("converts rects/ellipses to paths and flattens path transforms", () => {
    const d = doc([{ children: [rect("a"), group("g", [rect("inner")])] }]);
    const conv = convertToPath(d, ["a", "g"]);
    expect(conv.layers[0].children[0].kind).toBe("path");
    expect(conv.layers[0].children[1]).toBe(d.layers[0].children[1]);
    expect(flattenTransform(conv, ["a"])).toBe(conv);
    const moved = translateNodes(conv, ["a"], 5, 0);
    const flat = flattenTransform(moved, ["a"]).layers[0].children[0];
    expect(flat.transform).toEqual(IDENTITY);
    if (flat.kind !== "path") throw new Error("expected path");
    expect(flat.subpaths[0].nodes[0].p).toEqual({ x: 5, y: 0 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/tree-edits.test.ts`
Expected: FAIL — cannot resolve `../doc/tree`.

- [ ] **Step 3: Implement** — `src/doc/tree.ts`

```ts
import type { Doc, Layer, Node, Shape } from "./document";

export type Found = { layer: Layer; layerIndex: number; index: number; node: Node };

export function findTopLevel(doc: Doc, id: string): Found | null {
  for (let layerIndex = 0; layerIndex < doc.layers.length; layerIndex++) {
    const layer = doc.layers[layerIndex];
    const index = layer.children.findIndex((n) => n.id === id);
    if (index >= 0) return { layer, layerIndex, index, node: layer.children[index] };
  }
  return null;
}

/** Top-level ids on visible, unlocked layers — the only nodes a user can select. */
export function selectableIds(doc: Doc): Set<string> {
  const out = new Set<string>();
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const n of layer.children) out.add(n.id);
  }
  return out;
}

/** Where new shapes go until the layers panel (M3) adds a real current layer. */
export function targetLayerId(doc: Doc): string | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.visible && !l.locked) return l.id;
  }
  return null;
}

export function pruneSelection(doc: Doc, ids: readonly string[]): readonly string[] {
  const ok = selectableIds(doc);
  const seen = new Set<string>();
  const kept = ids.filter((id) => {
    if (!ok.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return kept.length === ids.length ? ids : kept;
}

export function mapTopLevel(doc: Doc, ids: readonly string[], fn: (n: Node) => Node): Doc {
  const set = new Set(ids);
  let changed = false;
  const layers = doc.layers.map((layer) => {
    let layerChanged = false;
    const children = layer.children.map((n) => {
      if (!set.has(n.id)) return n;
      const m = fn(n);
      if (m !== n) layerChanged = true;
      return m;
    });
    if (!layerChanged) return layer;
    changed = true;
    return { ...layer, children };
  });
  return changed ? { ...doc, layers } : doc;
}

export function mapShapes(node: Node, fn: (s: Shape) => Shape): Node {
  if (node.kind !== "group") return fn(node);
  let changed = false;
  const children = node.children.map((c) => {
    const m = mapShapes(c, fn);
    if (m !== c) changed = true;
    return m;
  });
  return changed ? { ...node, children } : node;
}

export function shapesOf(node: Node): Shape[] {
  if (node.kind !== "group") return [node];
  return node.children.flatMap(shapesOf);
}
```

Edit `src/doc/edits.ts`: replace its import line with

```ts
import {
  idFor,
  isValidArtboardSize,
  type Artboard,
  type Doc,
  type Node,
  type Paint,
  type Shape,
  type Style,
} from "./document";
import { IDENTITY, isIdentity, multiply, rotateAbout, translate } from "../geom/mat";
import { toPath, transformSubpaths } from "../geom/shapes";
import type { Vec } from "../geom/vec";
import { mapShapes, mapTopLevel } from "./tree";
```

and append:

```ts
export function addShape(doc: Doc, layerId: string, shape: Shape): { doc: Doc; id: string } {
  const li = doc.layers.findIndex((l) => l.id === layerId);
  if (li < 0) throw new Error(`No layer ${layerId}`);
  const id = idFor(doc.nextId);
  const layers = doc.layers.slice();
  layers[li] = { ...layers[li], children: [...layers[li].children, { ...shape, id }] };
  return { doc: { ...doc, layers, nextId: doc.nextId + 1 }, id };
}

export function deleteNodes(doc: Doc, ids: readonly string[]): Doc {
  const set = new Set(ids);
  let changed = false;
  const layers = doc.layers.map((l) => {
    const children = l.children.filter((n) => !set.has(n.id));
    if (children.length === l.children.length) return l;
    changed = true;
    return { ...l, children };
  });
  return changed ? { ...doc, layers } : doc;
}

function withFreshIds(node: Node, next: () => string): Node {
  if (node.kind === "group") {
    const id = next();
    return { ...node, id, children: node.children.map((c) => withFreshIds(c, next)) };
  }
  return { ...node, id: next() };
}

export function duplicateNodes(
  doc: Doc,
  ids: readonly string[],
  dx: number,
  dy: number,
): { doc: Doc; ids: string[] } {
  const set = new Set(ids);
  let nextId = doc.nextId;
  const next = () => idFor(nextId++);
  const created: string[] = [];
  const offset = translate(dx, dy);
  const layers = doc.layers.map((l) => {
    if (!l.children.some((n) => set.has(n.id))) return l;
    const children: Node[] = [];
    for (const n of l.children) {
      children.push(n);
      if (!set.has(n.id)) continue;
      const copy = withFreshIds(n, next);
      const moved: Node =
        dx === 0 && dy === 0 ? copy : { ...copy, transform: multiply(offset, copy.transform) };
      children.push(moved);
      created.push(moved.id);
    }
    return { ...l, children };
  });
  if (created.length === 0) return { doc, ids: [] };
  return { doc: { ...doc, layers, nextId }, ids: created };
}

export function translateNodes(doc: Doc, ids: readonly string[], dx: number, dy: number): Doc {
  if (dx === 0 && dy === 0) return doc;
  const t = translate(dx, dy);
  return mapTopLevel(doc, ids, (n) => ({ ...n, transform: multiply(t, n.transform) }));
}

export function rotateNodes(doc: Doc, ids: readonly string[], angle: number, centre: Vec): Doc {
  if (angle === 0) return doc;
  const r = rotateAbout(angle, centre);
  return mapTopLevel(doc, ids, (n) => ({ ...n, transform: multiply(r, n.transform) }));
}

function styleMatches(s: Style, patch: Partial<Style>): boolean {
  return (Object.keys(patch) as (keyof Style)[]).every((k) =>
    k === "fill" || k === "stroke"
      ? samePaint(s[k], (patch[k] ?? null) as Paint | null)
      : s[k] === patch[k],
  );
}

export function setStyle(doc: Doc, ids: readonly string[], patch: Partial<Style>): Doc {
  return mapTopLevel(doc, ids, (n) =>
    mapShapes(n, (s) =>
      styleMatches(s.style, patch) ? s : { ...s, style: { ...s.style, ...patch } },
    ),
  );
}

export function setRectRadius(doc: Doc, ids: readonly string[], rx: number): Doc {
  if (!Number.isFinite(rx)) return doc;
  return mapTopLevel(doc, ids, (n) => {
    if (n.kind !== "rect") return n;
    const r = Math.max(0, Math.min(rx, n.w / 2, n.h / 2));
    return r === n.rx ? n : { ...n, rx: r };
  });
}

export function convertToPath(doc: Doc, ids: readonly string[]): Doc {
  return mapTopLevel(doc, ids, (n) => (n.kind === "rect" || n.kind === "ellipse" ? toPath(n) : n));
}

export function flattenTransform(doc: Doc, ids: readonly string[]): Doc {
  return mapTopLevel(doc, ids, (n) =>
    n.kind === "path" && !isIdentity(n.transform)
      ? { ...n, subpaths: transformSubpaths(n.subpaths, n.transform), transform: IDENTITY }
      : n,
  );
}
```

Hand-checks:
- `rotateNodes` by 90° about (5, 10): the origin (0, 0) → (15, 5).
- `duplicateNodes(d, ["g", "a"], …)`: document order is a, g, so a's copy is n100 and g's copy is n101, with g's inner copy n102.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/tree-edits.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`.
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/doc/tree.ts src/doc/edits.ts src/__tests__/tree-edits.test.ts
git commit -m "feat(doc): tree helpers and add/delete/duplicate/move/rotate/style edits

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Resize that bakes scale into geometry

**Files:**
- Create: `src/doc/resize.ts`
- Test: `src/__tests__/resize.test.ts`

**Interfaces:**
- Consumes: `mapTopLevel`; `applyMat`, `invert`, `isAxisAligned`, `isIdentity`, `multiply`, `Mat`; `toPath`, `transformSubpaths`.
- Produces:
  - `resizeNode(node: Node, A: Mat): Node` — `A` is the resize in the node's parent space. Applies spec §1: `L = M⁻¹·A·M`; axis-aligned `L` is baked into rect/ellipse/path geometry (matrix kept); otherwise rect/ellipse become paths first; groups recurse into children with `L`. Identity `L` (eps 1e-9) → same node. Non-invertible `M` → same node.
  - `resizeNodes(doc, ids, A): Doc` — identity `A` → same doc.

- [ ] **Step 1: Write the failing test** — `src/__tests__/resize.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type EllipseShape,
  type Group,
  type Node,
  type PathShape,
  type RectShape,
} from "../doc/document";
import { resizeNode, resizeNodes } from "../doc/resize";
import { boxMap } from "../geom/box";
import { IDENTITY, multiply, rotate, rotateAbout, scale, translate } from "../geom/mat";
import { linePath } from "../geom/shapes";
import { deepFreeze } from "./helpers";

const style = { ...DEFAULT_STYLE, strokeWidth: 3 };
const rect = (over: Partial<RectShape> = {}): RectShape => ({
  kind: "rect",
  id: "r",
  transform: IDENTITY,
  style,
  x: 0,
  y: 0,
  w: 10,
  h: 20,
  rx: 4,
  ...over,
});

describe("resizeNode", () => {
  it("bakes an axis-aligned scale into a rect, keeping radius and stroke", () => {
    const out = resizeNode(rect(), scale(3, 0.5)) as RectShape;
    expect(out).toMatchObject({ kind: "rect", x: 0, y: 0, w: 30, h: 10, rx: 4 });
    expect(out.transform).toEqual(IDENTITY);
    expect(out.style.strokeWidth).toBe(3);
    const small = resizeNode(rect(), scale(0.5, 0.2)) as RectShape;
    expect(small.rx).toBe(2); // clamped to min(w, h) / 2 = min(5, 4) / 2
  });

  it("normalises a mirrored rect", () => {
    const out = resizeNode(rect({ x: 10 }), boxMap({ x: 10, y: 0, w: 10, h: 20 }, { x: 10, y: 0, w: -10, h: 20 })) as RectShape;
    expect(out).toMatchObject({ x: 0, y: 0, w: 10, h: 20 });
  });

  it("resizes a rotated rect in its own frame without converting it", () => {
    const m = rotateAbout(Math.PI / 6, { x: 5, y: 10 });
    const r = rect({ transform: m });
    // A frame-aligned resize: rotate(θ) · scale · rotate(−θ)
    const A = multiply(rotate(Math.PI / 6), multiply(scale(2, 1), rotate(-Math.PI / 6)));
    const out = resizeNode(r, A);
    expect(out.kind).toBe("rect");
    expect(out.transform).toBe(m);
    expect((out as RectShape).w).toBeCloseTo(20);
    expect((out as RectShape).h).toBeCloseTo(20);
  });

  it("converts a rotated rect to a path for a doc-axis non-uniform resize", () => {
    const r = rect({ transform: rotate(Math.PI / 6) });
    const out = resizeNode(r, scale(2, 1));
    expect(out.kind).toBe("path");
    expect(out.transform).toBe(r.transform);
    expect(out.id).toBe("r");
  });

  it("keeps a uniformly scaled rotated rect a rect", () => {
    const r = rect({ transform: rotate(Math.PI / 6) });
    const out = resizeNode(r, scale(2)) as RectShape;
    expect(out.kind).toBe("rect");
    expect(out.w).toBeCloseTo(20);
    expect(out.h).toBeCloseTo(40);
  });

  it("bakes into ellipses and paths", () => {
    const e: EllipseShape = {
      kind: "ellipse",
      id: "e",
      transform: translate(100, 0),
      style,
      cx: 10,
      cy: 10,
      rx: 5,
      ry: 5,
    };
    // Doc-space scale by 2 about the doc origin: local L = translate(100,0)·scale(2) mapped back.
    const out = resizeNode(e, scale(2)) as EllipseShape;
    expect(out.transform).toBe(e.transform);
    expect(out.rx).toBe(10);
    expect(out.ry).toBe(10);
    expect(out.cx).toBe(120);
    expect(out.cy).toBe(20);
    const p: PathShape = {
      kind: "path",
      id: "p",
      transform: IDENTITY,
      style,
      subpaths: [linePath({ x: 1, y: 2 }, { x: 3, y: 4 })],
    };
    const pout = resizeNode(p, scale(2, 3)) as PathShape;
    expect(pout.subpaths[0].nodes.map((n) => n.p)).toEqual([
      { x: 2, y: 6 },
      { x: 6, y: 12 },
    ]);
  });

  it("recurses into groups, keeping the group matrix", () => {
    const g: Group = {
      kind: "group",
      id: "g",
      transform: translate(10, 0),
      opacity: 1,
      children: [rect()],
    };
    const out = resizeNode(g, scale(2)) as Group;
    expect(out.transform).toBe(g.transform);
    expect(out.children[0]).toMatchObject({ x: 10, y: 0, w: 20, h: 40 });
  });

  it("returns the same node for identity or singular matrices", () => {
    const r = rect();
    expect(resizeNode(r, IDENTITY)).toBe(r);
    const s = rect({ transform: [0, 0, 0, 0, 0, 0] });
    expect(resizeNode(s, scale(2))).toBe(s);
  });
});

describe("resizeNodes", () => {
  it("applies to top-level ids and is a no-op for identity", () => {
    const d: Doc = deepFreeze({
      ...createDoc(10, 10),
      layers: [
        { id: "L", name: "L", visible: true, locked: false, children: [rect() as Node] },
      ],
    });
    expect(resizeNodes(d, ["r"], IDENTITY)).toBe(d);
    const out = resizeNodes(d, ["r"], scale(2));
    expect(out.layers[0].children[0]).toMatchObject({ w: 20, h: 40 });
  });
});
```

Hand-checks:
- **Rotated rect, frame-aligned resize:** `L = M⁻¹·A·M` has linear part `R(−θ)·R(θ)·S·R(−θ)·R(θ) = S`, so the local w doubles (10 → 20) and h stays 20. The rect stays a rect, and the matrix object is unchanged.
- **Uniform scale:** it commutes with rotation, so `L` is a uniform scale.
- **Ellipse:** `M = translate(100, 0)` and `A = scale(2)`, so `L = translate(−100, 0)·scale(2)·translate(100, 0)`. That maps a local x to 2x + 100: cx 10 → 120, cy 10 → 20, and the radii double.
- **Group:** `L` for the group is `translate(−10, 0)·scale(2)·translate(10, 0)`, which maps x to 2x + 10. The child rect (0, 0, 10, 20) becomes (10, 0, 20, 40).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/resize.test.ts`
Expected: FAIL — cannot resolve `../doc/resize`.

- [ ] **Step 3: Implement** — `src/doc/resize.ts`

```ts
import { applyMat, invert, isAxisAligned, isIdentity, multiply, type Mat } from "../geom/mat";
import { toPath, transformSubpaths } from "../geom/shapes";
import type { Doc, Node, Shape } from "./document";
import { mapTopLevel } from "./tree";

/** Spec (M2a) §1: move/rotate touch the matrix; resize is baked into geometry so stroke widths
 *  and corner radii never scale. `L` is the resize expressed in the shape's own space. */
function bakeShape(s: Shape, L: Mat): Shape {
  if (isIdentity(L)) return s;
  if (s.kind !== "path" && !isAxisAligned(L)) return bakeShape(toPath(s), L);
  switch (s.kind) {
    case "rect": {
      const a = applyMat(L, { x: s.x, y: s.y });
      const b = applyMat(L, { x: s.x + s.w, y: s.y + s.h });
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      return {
        ...s,
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w,
        h,
        rx: Math.min(s.rx, w / 2, h / 2),
      };
    }
    case "ellipse": {
      const c = applyMat(L, { x: s.cx, y: s.cy });
      return { ...s, cx: c.x, cy: c.y, rx: s.rx * Math.abs(L[0]), ry: s.ry * Math.abs(L[3]) };
    }
    case "path":
      return { ...s, subpaths: transformSubpaths(s.subpaths, L) };
  }
}

/** Resize `node` by `A`, given in the node's parent space. */
export function resizeNode(node: Node, A: Mat): Node {
  const inv = invert(node.transform);
  if (!inv) return node;
  const L = multiply(inv, multiply(A, node.transform));
  if (isIdentity(L)) return node;
  if (node.kind === "group") {
    let changed = false;
    const children = node.children.map((c) => {
      const r = resizeNode(c, L);
      if (r !== c) changed = true;
      return r;
    });
    return changed ? { ...node, children } : node;
  }
  return bakeShape(node, L);
}

export function resizeNodes(doc: Doc, ids: readonly string[], A: Mat): Doc {
  if (isIdentity(A)) return doc;
  return mapTopLevel(doc, ids, (n) => resizeNode(n, A));
}
```

If the "small" radius check fails: `scale(0.5, 0.2)` turns the 10×20 rect into 5×4, so
rx = min(4, 2.5, 2) = 2.

If the frame-aligned test's `isAxisAligned` check fails by float noise (|b| ≈ 1e-16), that is
within eps 1e-9. If it still fails, report the actual `L`; do not raise the eps above 1e-9
without reporting.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/resize.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`.
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/doc/resize.ts src/__tests__/resize.test.ts
git commit -m "feat(doc): resize bakes scale into geometry, keeping strokes and radii

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Selection frame and gizmo math

**Files:**
- Create: `src/tools/types.ts`, `src/tools/frame.ts`, `src/tools/gizmo.ts`
- Test: `src/__tests__/frame-gizmo.test.ts`

**Interfaces:**
- Consumes: `findTopLevel`; `nodeBounds`; `Box`, `boxCenter`, `boxCorners`, `boxMap`, `unionBox`; `applyMat`, `IDENTITY`, `isSkewed`, `multiply`, `rotate`, `rotationOf`, `Mat`; `docToScreen`, `View`.
- Produces:
  - `types.ts`: `type ToolId = "select" | "rect" | "ellipse" | "line" | "polygon" | "hand"`; `type Mods = { shift: boolean; alt: boolean }`; `NO_MODS: Mods`
  - `frame.ts`: `type Frame = { angle: number; box: Box }` (box in coordinates rotated by `-angle`); `selectionFrame(doc, ids): Frame | null`; `selectionBounds(doc, ids): Box | null` (doc space); `frameToDoc(f, p)`, `docToFrame(f, p)`; `frameCenter(f): Vec` (doc space); `frameResizeMap(angle, from: Box, to: Box): Mat`
  - `gizmo.ts`: `type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"`; `type Handle = ResizeHandle | "rotate"`; `RESIZE_HANDLES`; `ROTATE_OFFSET = 24`; `MIN_SIZE = 0.01`; `ROTATE_SNAP = π/12`; `handleSize(pointerType): number` (8 mouse / 16 otherwise); `handlePositions(f, view): Record<Handle, Vec>` (screen); `frameOutline(f, view): Vec[]` (nw, ne, se, sw, screen); `handleAt(f, view, screen, size): Handle | null` (priority: rotate, corners, edges; hit when within `size/2 + 2` on both axes); `dragHandle(h: ResizeHandle, start: Box, p: Vec /* frame coords */, mods: Mods): Box` (signed result: `x`/`y` are the images of `start.x`/`start.y`, `w`/`h` may be negative = mirrored); `normalizeAngle(a): number` (into (−π, π]); `rotateDelta(centre, start, p, frameAngle, snap): number`

- [ ] **Step 1: Write the failing test** — `src/__tests__/frame-gizmo.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node } from "../doc/document";
import { applyMat, IDENTITY, rotateAbout, skewX, translate, type Mat } from "../geom/mat";
import {
  docToFrame,
  frameCenter,
  frameResizeMap,
  frameToDoc,
  selectionBounds,
  selectionFrame,
} from "../tools/frame";
import {
  dragHandle,
  frameOutline,
  handleAt,
  handlePositions,
  handleSize,
  normalizeAngle,
  rotateDelta,
} from "../tools/gizmo";
import { NO_MODS } from "../tools/types";

const view = { x: 0, y: 0, zoom: 1 };
const rect = (id: string, x: number, y: number, w: number, h: number, t: Mat = IDENTITY): Node => ({
  kind: "rect",
  id,
  transform: t,
  style: DEFAULT_STYLE,
  x,
  y,
  w,
  h,
  rx: 0,
});
const doc = (...children: Node[]): Doc => ({
  ...createDoc(100, 100),
  layers: [{ id: "L", name: "L", visible: true, locked: false, children }],
});
const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x);
  expect(p.y).toBeCloseTo(y);
};

describe("selection frame", () => {
  it("uses a single node's rotation and its local box", () => {
    const d = doc(rect("a", 0, 0, 10, 20, rotateAbout(Math.PI / 6, { x: 0, y: 0 })));
    const f = selectionFrame(d, ["a"])!;
    expect(f.angle).toBeCloseTo(Math.PI / 6);
    expect(f.box.x).toBeCloseTo(0);
    expect(f.box.y).toBeCloseTo(0);
    expect(f.box.w).toBeCloseTo(10);
    expect(f.box.h).toBeCloseTo(20);
    near(frameCenter(f), applyMat(rotateAbout(Math.PI / 6, { x: 0, y: 0 }), { x: 5, y: 10 }).x, applyMat(rotateAbout(Math.PI / 6, { x: 0, y: 0 }), { x: 5, y: 10 }).y);
  });

  it("uses angle 0 for multiple or skewed nodes", () => {
    const d = doc(rect("a", 0, 0, 10, 10), rect("b", 20, 0, 10, 10, translate(0, 5)), rect("s", 0, 0, 10, 10, skewX(0.5)));
    expect(selectionFrame(d, ["a", "b"])).toEqual({ angle: 0, box: { x: 0, y: 0, w: 30, h: 15 } });
    expect(selectionFrame(d, ["s"])!.angle).toBe(0);
    expect(selectionFrame(d, ["zz"])).toBeNull();
    expect(selectionBounds(d, ["a", "b"])).toEqual({ x: 0, y: 0, w: 30, h: 15 });
  });

  it("converts between frame and doc coordinates and builds resize maps", () => {
    const f = { angle: Math.PI / 2, box: { x: 0, y: 0, w: 1, h: 1 } };
    near(frameToDoc(f, { x: 1, y: 0 }), 0, 1);
    near(docToFrame(f, { x: 0, y: 1 }), 1, 0);
    const m = frameResizeMap(0, { x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 20, h: 10 });
    expect(applyMat(m, { x: 10, y: 10 })).toEqual({ x: 20, y: 10 });
    const r = frameResizeMap(Math.PI / 2, { x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 20, h: 10 });
    // Doubling the frame's x axis doubles doc y when the frame is rotated 90°.
    near(applyMat(r, { x: 0, y: 10 }), 0, 20);
  });
});

describe("gizmo handles", () => {
  const f = { angle: 0, box: { x: 0, y: 0, w: 100, h: 50 } };

  it("positions handles and the rotate knob in screen space", () => {
    const h = handlePositions(f, view);
    expect(h.nw).toEqual({ x: 0, y: 0 });
    expect(h.se).toEqual({ x: 100, y: 50 });
    expect(h.n).toEqual({ x: 50, y: 0 });
    near(h.rotate, 50, -24);
    const zoomed = handlePositions(f, { x: 10, y: 20, zoom: 2 });
    expect(zoomed.se).toEqual({ x: 210, y: 120 });
    near(zoomed.rotate, 110, -4);
    const rot = handlePositions({ angle: Math.PI / 2, box: { x: 0, y: -100, w: 50, h: 100 } }, view);
    near(rot.nw, 100, 0);
    near(rot.n, 100, 25);
    near(rot.rotate, 124, 25);
    expect(frameOutline(f, view)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]);
  });

  it("finds the handle under the pointer", () => {
    expect(handleSize("mouse")).toBe(8);
    expect(handleSize("pen")).toBe(16);
    expect(handleAt(f, view, { x: 101, y: 49 }, 8)).toBe("se");
    expect(handleAt(f, view, { x: 50, y: -24 }, 8)).toBe("rotate");
    expect(handleAt(f, view, { x: 56, y: 1 }, 8)).toBe("n");
    expect(handleAt(f, view, { x: 60, y: 25 }, 8)).toBeNull();
    const tiny = { angle: 0, box: { x: 0, y: 0, w: 2, h: 2 } };
    expect(handleAt(tiny, view, { x: 1, y: 0 }, 8)).toBe("nw");
  });
});

describe("dragHandle", () => {
  const start = { x: 0, y: 0, w: 100, h: 50 };

  it("moves a corner with the opposite corner fixed", () => {
    expect(dragHandle("se", start, { x: 150, y: 100 }, NO_MODS)).toEqual({ x: 0, y: 0, w: 150, h: 100 });
    expect(dragHandle("nw", start, { x: 10, y: 20 }, NO_MODS)).toEqual({ x: 10, y: 20, w: 90, h: 30 });
  });

  it("moves an edge on one axis only", () => {
    expect(dragHandle("w", start, { x: -20, y: 30 }, NO_MODS)).toEqual({ x: -20, y: 0, w: 120, h: 50 });
    expect(dragHandle("n", start, { x: 999, y: -30 }, NO_MODS)).toEqual({ x: 0, y: -30, w: 100, h: 80 });
  });

  it("mirrors when dragged past the fixed side", () => {
    expect(dragHandle("se", start, { x: -50, y: 20 }, NO_MODS)).toEqual({ x: 0, y: 0, w: -50, h: 20 });
    expect(dragHandle("w", start, { x: 130, y: 0 }, NO_MODS)).toEqual({ x: 130, y: 0, w: -30, h: 50 });
  });

  it("resizes from the centre with Alt and keeps proportions with Shift", () => {
    expect(dragHandle("se", start, { x: 150, y: 75 }, { shift: false, alt: true })).toEqual({ x: -50, y: -25, w: 200, h: 100 });
    expect(dragHandle("se", start, { x: 200, y: 60 }, { shift: true, alt: false })).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(dragHandle("e", start, { x: 200, y: 60 }, { shift: true, alt: false })).toEqual({ x: 0, y: 0, w: 200, h: 50 });
  });

  it("keeps a zero-size axis and clamps tiny sizes", () => {
    expect(dragHandle("se", { x: 0, y: 10, w: 100, h: 0 }, { x: 150, y: 40 }, NO_MODS)).toEqual({ x: 0, y: 10, w: 150, h: 0 });
    expect(dragHandle("se", start, { x: 0.001, y: -0.001 }, NO_MODS)).toEqual({ x: 0, y: 0, w: 0.01, h: -0.01 });
  });
});

describe("rotation", () => {
  it("normalises angles", () => {
    expect(normalizeAngle((5 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });

  it("measures the drag angle around the centre, optionally snapped to 15°", () => {
    const c = { x: 0, y: 0 };
    expect(rotateDelta(c, { x: 10, y: 0 }, { x: 0, y: 10 }, 0, false)).toBeCloseTo(Math.PI / 2);
    const p = { x: Math.cos(0.5) * 10, y: Math.sin(0.5) * 10 };
    const snapped = rotateDelta(c, { x: 10, y: 0 }, p, 0.1, true);
    expect(0.1 + snapped).toBeCloseTo(Math.PI / 6);
  });
});
```

Hand-checks:
- **Zoomed rotate knob:** at zoom 2 with offset (10, 20), handle `n` lands at (110, 20), and the knob sits 24 px above it at (110, −4).
- **Rotated frame:** `rotate(π/2)` maps (x, y) to (−y, x). So nw (0, −100) → (100, 0), and n (25, −100) → (100, 25). The frame's "up" direction (0, −1) maps to (1, 0), which puts the knob at (124, 25).
- **Tiny box:** `(1, 0)` is within reach of both `nw` (0, 0) and `n` (1, 0). Corners are checked first, so the answer is `nw`.
- **Snapped rotation:** 0.1 + 0.5 = 0.6 rad, which rounds to 2 × 15° = π/6.
- **Clamp:** `se` with p = (0.001, −0.001) gives raw w 0.001 → 0.01 and raw h −0.001 → −0.01.
- **Mirror with the `w` handle:** p.x = 130 gives raw = 100 − 130 = −30, so w = −30 and x = 100 − (−30) = 130.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/frame-gizmo.test.ts`
Expected: FAIL — cannot resolve `../tools/frame`.

- [ ] **Step 3: Implement** — `src/tools/types.ts`

```ts
export type ToolId = "select" | "rect" | "ellipse" | "line" | "polygon" | "hand";

/** Modifier state for tools: physical keys combined with the on-screen modifier dock. */
export type Mods = { shift: boolean; alt: boolean };

export const NO_MODS: Mods = { shift: false, alt: false };
```

`src/tools/frame.ts`:

```ts
import type { Doc, Node } from "../doc/document";
import { findTopLevel } from "../doc/tree";
import { nodeBounds } from "../geom/bounds";
import { boxCenter, boxMap, unionBox, type Box } from "../geom/box";
import {
  applyMat,
  IDENTITY,
  isSkewed,
  multiply,
  rotate,
  rotationOf,
  type Mat,
} from "../geom/mat";
import type { Vec } from "../geom/vec";

/** A rotated box around a selection. `box` is in coordinates rotated by `-angle`. */
export type Frame = { angle: number; box: Box };

/** `rotate`, but exactly the identity for 0 (avoids -0 entries from `sin(-0)`). */
const rot = (a: number): Mat => (a === 0 ? IDENTITY : rotate(a));

function nodesOf(doc: Doc, ids: readonly string[]): Node[] {
  const out: Node[] = [];
  for (const id of ids) {
    const f = findTopLevel(doc, id);
    if (f) out.push(f.node);
  }
  return out;
}

export function selectionFrame(doc: Doc, ids: readonly string[]): Frame | null {
  const nodes = nodesOf(doc, ids);
  if (nodes.length === 0) return null;
  const single = nodes.length === 1 && !isSkewed(nodes[0].transform);
  const angle = single ? rotationOf(nodes[0].transform) : 0;
  const m = rot(-angle);
  let box: Box | null = null;
  for (const n of nodes) box = unionBox(box, nodeBounds(n, m));
  return box ? { angle, box } : null;
}

export function selectionBounds(doc: Doc, ids: readonly string[]): Box | null {
  let box: Box | null = null;
  for (const n of nodesOf(doc, ids)) box = unionBox(box, nodeBounds(n, IDENTITY));
  return box;
}

export function frameToDoc(f: Frame, p: Vec): Vec {
  return applyMat(rot(f.angle), p);
}

export function docToFrame(f: Frame, p: Vec): Vec {
  return applyMat(rot(-f.angle), p);
}

export function frameCenter(f: Frame): Vec {
  return frameToDoc(f, boxCenter(f.box));
}

/** The doc-space map for resizing a frame's box from `from` to `to`. */
export function frameResizeMap(angle: number, from: Box, to: Box): Mat {
  return multiply(rot(angle), multiply(boxMap(from, to), rot(-angle)));
}
```

`rot` returns the exact identity for angle 0: `rotate(-0)` would contain `-0`, and Vitest's
`toEqual` treats `-0` and `0` as different.

`src/tools/gizmo.ts`:

```ts
import type { Box } from "../geom/box";
import type { Vec } from "../geom/vec";
import { docToScreen, type View } from "../state/viewport";
import { frameToDoc, type Frame } from "./frame";
import type { Mods } from "./types";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type Handle = ResizeHandle | "rotate";

export const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const ROTATE_OFFSET = 24;
export const MIN_SIZE = 0.01;
export const ROTATE_SNAP = Math.PI / 12;

export function handleSize(pointerType: string): number {
  return pointerType === "mouse" ? 8 : 16;
}

function framePoint(h: ResizeHandle, b: Box): Vec {
  const x = h.includes("w") ? b.x : h.includes("e") ? b.x + b.w : b.x + b.w / 2;
  const y = h.includes("n") ? b.y : h.includes("s") ? b.y + b.h : b.y + b.h / 2;
  return { x, y };
}

export function handlePositions(f: Frame, view: View): Record<Handle, Vec> {
  const out = {} as Record<Handle, Vec>;
  for (const h of RESIZE_HANDLES) out[h] = docToScreen(view, frameToDoc(f, framePoint(h, f.box)));
  out.rotate = {
    x: out.n.x + ROTATE_OFFSET * Math.sin(f.angle),
    y: out.n.y - ROTATE_OFFSET * Math.cos(f.angle),
  };
  return out;
}

export function frameOutline(f: Frame, view: View): Vec[] {
  const h = handlePositions(f, view);
  return [h.nw, h.ne, h.se, h.sw];
}

const PRIORITY: readonly Handle[] = ["rotate", "nw", "ne", "se", "sw", "n", "e", "s", "w"];

export function handleAt(f: Frame, view: View, screen: Vec, size: number): Handle | null {
  const pos = handlePositions(f, view);
  const reach = size / 2 + 2;
  for (const h of PRIORITY) {
    const p = pos[h];
    if (Math.abs(p.x - screen.x) <= reach && Math.abs(p.y - screen.y) <= reach) return h;
  }
  return null;
}

const sgn = (v: number) => (v < 0 ? -1 : 1);

/** Signed new size along one axis. `dir` is +1 for the far edge, −1 for the near edge. */
function signedSize(s0: number, size: number, dir: -1 | 0 | 1, p: number, alt: boolean): number {
  if (dir === 0 || size === 0) return size;
  const raw = alt ? 2 * (p - (s0 + size / 2)) * dir : (p - (dir === 1 ? s0 : s0 + size)) * dir;
  return Math.abs(raw) < MIN_SIZE ? sgn(raw) * MIN_SIZE : raw;
}

/** Where the near edge (`s0`) ends up for a new signed size `s`. */
function nearEdge(s0: number, size: number, dir: -1 | 0 | 1, s: number, alt: boolean): number {
  if (dir === 0 || size === 0) return s0;
  if (alt) return s0 + size / 2 - s / 2;
  return dir === 1 ? s0 : s0 + size - s;
}

export function dragHandle(h: ResizeHandle, start: Box, p: Vec, mods: Mods): Box {
  const dx: -1 | 0 | 1 = h.includes("e") ? 1 : h.includes("w") ? -1 : 0;
  const dy: -1 | 0 | 1 = h.includes("s") ? 1 : h.includes("n") ? -1 : 0;
  let w = signedSize(start.x, start.w, dx, p.x, mods.alt);
  let hh = signedSize(start.y, start.h, dy, p.y, mods.alt);
  if (mods.shift && dx !== 0 && dy !== 0 && start.w !== 0 && start.h !== 0) {
    const kx = w / start.w;
    const ky = hh / start.h;
    const k = Math.max(Math.abs(kx), Math.abs(ky));
    w = sgn(kx) * k * start.w;
    hh = sgn(ky) * k * start.h;
  }
  return {
    x: nearEdge(start.x, start.w, dx, w, mods.alt),
    y: nearEdge(start.y, start.h, dy, hh, mods.alt),
    w,
    h: hh,
  };
}

export function normalizeAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  else if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

export function rotateDelta(
  centre: Vec,
  start: Vec,
  p: Vec,
  frameAngle: number,
  snap: boolean,
): number {
  let d =
    Math.atan2(p.y - centre.y, p.x - centre.x) - Math.atan2(start.y - centre.y, start.x - centre.x);
  if (snap) d = Math.round((frameAngle + d) / ROTATE_SNAP) * ROTATE_SNAP - frameAngle;
  return normalizeAngle(d);
}
```

Notes:
- **Import cycle:** `gizmo.ts` imports `docToScreen` from `src/state/viewport.ts`, a pure module with no store imports, so there is no cycle.
- **`nw` hand-check:** p = (10, 20) gives raw w = (10 − 100)·−1 = 90 and x = 100 − 90 = 10; raw h = (20 − 50)·−1 = 30 and y = 50 − 30 = 20.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/frame-gizmo.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`.
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/types.ts src/tools/frame.ts src/tools/gizmo.ts src/__tests__/frame-gizmo.test.ts
git commit -m "feat(tools): selection frame and transform gizmo math

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Preferences, pointer routing, edit keys, other-tab warning

**Files:**
- Create: `src/persist/preferences.ts`, `src/input/route.ts`, `src/persist/tab-presence.ts`
- Modify: `src/state/keys.ts` (append)
- Test: `src/__tests__/prefs-route-keys.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_STYLE`, `Style`, `Paint`, `LineCap`, `LineJoin`; `ToolId`.
- Produces:
  - `preferences.ts`: `type PolygonPrefs = { sides: number; star: boolean; innerRatio: number }`; `type Prefs = { style: Style; polygon: PolygonPrefs }`; `DEFAULT_PREFS` (style `DEFAULT_STYLE`, polygon `{ sides: 5, star: false, innerRatio: 0.5 }`); `sanitizePrefs(raw: unknown): Prefs` (validates field by field, falling back per field: paint = null or `{ color: /^#[0-9a-f]{6}$/, opacity 0–1 (else 1) }`; strokeWidth 0–1000; cap/join enums; opacity 0–1; sides integer 3–32; star boolean; innerRatio 0.1–0.95); `type PrefStorage = Pick<Storage, "getItem" | "setItem">`; `loadPrefs(storage?: PrefStorage | null): Prefs`; `savePrefs(p: Prefs, storage?: PrefStorage | null): void` — key `slop-vector-editor:prefs`; neither ever throws.
  - `route.ts`: `type RouteInput = { pointerType: string; button: number; activePointers: number; spaceHeld: boolean; tool: ToolId; pencilSeen: boolean }`; `type Route = "tool" | "pan" | "pinch" | "menu" | "ignore"`; `routePointerDown(i: RouteInput): Route` — in order: touch with another pointer active → pinch; mouse right → menu; mouse middle → pan; other mouse buttons → ignore; any pointer while another is active → ignore; Space held or Hand tool → pan; touch after a Pencil was seen → pan; else tool.
  - `keys.ts`: `type EditAction = { kind: "tool"; tool: ToolId } | { kind: "delete" } | { kind: "duplicate" } | { kind: "clear" } | { kind: "nudge"; dx: number; dy: number }`; `editActionForKey(e: KeyLike): EditAction | null` — ⌘/Ctrl+D duplicate (other ⌘/Ctrl combos → null); Delete/Backspace delete; Escape clear; arrows nudge 1 (Shift 10); unmodified v/r/e/l/y/h select tools.
  - `tab-presence.ts`: `TAB_CHANNEL = "slop-vector-editor"`; `watchOtherTabs(onOther: () => void, channelName = TAB_CHANNEL): () => void` — posts `"hello"`; answers `"hello"` with `"here"`; calls `onOther` once when it sees either; returns a stop function; a no-op when `BroadcastChannel` is unavailable.

- [ ] **Step 1: Write the failing test** — `src/__tests__/prefs-route-keys.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { routePointerDown, type RouteInput } from "../input/route";
import {
  DEFAULT_PREFS,
  loadPrefs,
  sanitizePrefs,
  savePrefs,
  type PrefStorage,
  type Prefs,
} from "../persist/preferences";
import { watchOtherTabs } from "../persist/tab-presence";
import { editActionForKey } from "../state/keys";

function memoryStorage(): PrefStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("preferences", () => {
  const custom: Prefs = {
    style: {
      fill: null,
      stroke: { color: "#ff0000", opacity: 0.5 },
      strokeWidth: 2.5,
      cap: "round",
      join: "bevel",
      opacity: 0.8,
    },
    polygon: { sides: 7, star: true, innerRatio: 0.3 },
  };

  it("falls back to defaults for missing or malformed input", () => {
    expect(sanitizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs("nope")).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs(custom)).toEqual(custom);
  });

  it("validates field by field", () => {
    const p = sanitizePrefs({
      style: {
        fill: { color: "red", opacity: 1 },
        stroke: null,
        strokeWidth: -1,
        cap: "x",
        join: "round",
        opacity: 2,
      },
      polygon: { sides: 2.5, star: "yes", innerRatio: 0.99 },
    });
    expect(p.style).toEqual({
      fill: DEFAULT_PREFS.style.fill,
      stroke: null,
      strokeWidth: DEFAULT_PREFS.style.strokeWidth,
      cap: "butt",
      join: "round",
      opacity: 1,
    });
    expect(p.polygon).toEqual(DEFAULT_PREFS.polygon);
    const q = sanitizePrefs({ style: { fill: { color: "#00ff00", opacity: "x" } } });
    expect(q.style.fill).toEqual({ color: "#00ff00", opacity: 1 });
  });

  it("loads and saves without ever throwing", () => {
    const s = memoryStorage();
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
    savePrefs(custom, s);
    expect(loadPrefs(s)).toEqual(custom);
    s.data.set("slop-vector-editor:prefs", "{not json");
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
    const broken: PrefStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadPrefs(broken)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(custom, broken)).not.toThrow();
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(custom, null)).not.toThrow();
  });
});

describe("routePointerDown", () => {
  const base: RouteInput = {
    pointerType: "mouse",
    button: 0,
    activePointers: 0,
    spaceHeld: false,
    tool: "select",
    pencilSeen: false,
  };
  const r = (over: Partial<RouteInput>) => routePointerDown({ ...base, ...over });

  it("routes mouse buttons", () => {
    expect(r({})).toBe("tool");
    expect(r({ button: 2 })).toBe("menu");
    expect(r({ button: 1 })).toBe("pan");
    expect(r({ button: 3 })).toBe("ignore");
    expect(r({ activePointers: 1 })).toBe("ignore");
  });

  it("pans with Space or the Hand tool", () => {
    expect(r({ spaceHeld: true })).toBe("pan");
    expect(r({ tool: "hand" })).toBe("pan");
    expect(r({ pointerType: "pen", spaceHeld: true })).toBe("pan");
  });

  it("routes touch and pen", () => {
    expect(r({ pointerType: "touch" })).toBe("tool");
    expect(r({ pointerType: "touch", pencilSeen: true })).toBe("pan");
    expect(r({ pointerType: "touch", activePointers: 1 })).toBe("pinch");
    expect(r({ pointerType: "touch", activePointers: 1, pencilSeen: true })).toBe("pinch");
    expect(r({ pointerType: "pen", pencilSeen: true })).toBe("tool");
    expect(r({ pointerType: "pen", activePointers: 1 })).toBe("ignore");
  });
});

describe("editActionForKey", () => {
  const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) =>
    editActionForKey({ key, metaKey: false, ctrlKey: false, shiftKey: false, ...mods });

  it("maps tool keys without modifiers", () => {
    expect(k("v")).toEqual({ kind: "tool", tool: "select" });
    expect(k("R")).toEqual({ kind: "tool", tool: "rect" });
    expect(k("e")).toEqual({ kind: "tool", tool: "ellipse" });
    expect(k("l")).toEqual({ kind: "tool", tool: "line" });
    expect(k("y")).toEqual({ kind: "tool", tool: "polygon" });
    expect(k("h")).toEqual({ kind: "tool", tool: "hand" });
    expect(k("v", { shiftKey: true })).toBeNull();
    expect(k("x")).toBeNull();
  });

  it("maps editing keys", () => {
    expect(k("Delete")).toEqual({ kind: "delete" });
    expect(k("Backspace")).toEqual({ kind: "delete" });
    expect(k("Escape")).toEqual({ kind: "clear" });
    expect(k("d", { metaKey: true })).toEqual({ kind: "duplicate" });
    expect(k("d", { ctrlKey: true })).toEqual({ kind: "duplicate" });
    expect(k("v", { metaKey: true })).toBeNull();
    expect(k("ArrowLeft")).toEqual({ kind: "nudge", dx: -1, dy: 0 });
    expect(k("ArrowDown", { shiftKey: true })).toEqual({ kind: "nudge", dx: 0, dy: 10 });
    expect(k("ArrowUp")).toEqual({ kind: "nudge", dx: 0, dy: -1 });
    expect(k("ArrowRight", { shiftKey: true })).toEqual({ kind: "nudge", dx: 10, dy: 0 });
  });
});

describe("watchOtherTabs", () => {
  afterEach(() => vi.unstubAllGlobals());
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("tells both tabs once when a second tab appears", async () => {
    const name = `test-${Math.random()}`;
    let a = 0;
    let b = 0;
    const stopA = watchOtherTabs(() => a++, name);
    await tick(30);
    expect(a).toBe(0);
    const stopB = watchOtherTabs(() => b++, name);
    await tick(60);
    expect(a).toBe(1);
    expect(b).toBe(1);
    const stopC = watchOtherTabs(() => undefined, name);
    await tick(60);
    expect(a).toBe(1);
    expect(b).toBe(1);
    stopA();
    stopB();
    stopC();
  });

  it("does nothing without BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const stop = watchOtherTabs(() => {
      throw new Error("should not be called");
    });
    expect(() => stop()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/prefs-route-keys.test.ts`
Expected: FAIL — cannot resolve `../input/route`.

- [ ] **Step 3: Implement** — `src/persist/preferences.ts`

```ts
import {
  DEFAULT_STYLE,
  type LineCap,
  type LineJoin,
  type Paint,
  type Style,
} from "../doc/document";

export type PolygonPrefs = { sides: number; star: boolean; innerRatio: number };
export type Prefs = { style: Style; polygon: PolygonPrefs };
export type PrefStorage = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_PREFS: Prefs = {
  style: DEFAULT_STYLE,
  polygon: { sides: 5, star: false, innerRatio: 0.5 },
};

const KEY = "slop-vector-editor:prefs";
const CAPS: readonly string[] = ["butt", "round", "square"];
const JOINS: readonly string[] = ["miter", "round", "bevel"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

function paint(v: unknown, fallback: Paint | null): Paint | null {
  if (v === null) return null;
  if (!isObj(v) || typeof v.color !== "string" || !/^#[0-9a-f]{6}$/.test(v.color)) return fallback;
  return { color: v.color, opacity: num(v.opacity, 0, 1, 1) };
}

/** Preferences come from localStorage, so every field is checked on its own. */
export function sanitizePrefs(raw: unknown): Prefs {
  const r = isObj(raw) ? raw : {};
  const s = isObj(r.style) ? r.style : {};
  const p = isObj(r.polygon) ? r.polygon : {};
  const d = DEFAULT_PREFS;
  return {
    style: {
      fill: "fill" in s ? paint(s.fill, d.style.fill) : d.style.fill,
      stroke: "stroke" in s ? paint(s.stroke, d.style.stroke) : d.style.stroke,
      strokeWidth: num(s.strokeWidth, 0, 1000, d.style.strokeWidth),
      cap: typeof s.cap === "string" && CAPS.includes(s.cap) ? (s.cap as LineCap) : d.style.cap,
      join:
        typeof s.join === "string" && JOINS.includes(s.join) ? (s.join as LineJoin) : d.style.join,
      opacity: num(s.opacity, 0, 1, d.style.opacity),
    },
    polygon: {
      sides: Number.isInteger(p.sides) ? num(p.sides, 3, 32, d.polygon.sides) : d.polygon.sides,
      star: typeof p.star === "boolean" ? p.star : d.polygon.star,
      innerRatio: num(p.innerRatio, 0.1, 0.95, d.polygon.innerRatio),
    },
  };
}

function defaultStorage(): PrefStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPrefs(storage: PrefStorage | null = defaultStorage()): Prefs {
  if (!storage) return DEFAULT_PREFS;
  try {
    const text = storage.getItem(KEY);
    return text ? sanitizePrefs(JSON.parse(text)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs, storage: PrefStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Blocked or full storage: preferences are a convenience, never an error.
  }
}
```

`src/input/route.ts`:

```ts
import type { ToolId } from "../tools/types";

export type RouteInput = {
  pointerType: string;
  button: number;
  /** Pointers already down on the canvas before this one. */
  activePointers: number;
  spaceHeld: boolean;
  tool: ToolId;
  /** A Pencil has touched the canvas this session: fingers then only navigate. */
  pencilSeen: boolean;
};

export type Route = "tool" | "pan" | "pinch" | "menu" | "ignore";

export function routePointerDown(i: RouteInput): Route {
  if (i.pointerType === "touch" && i.activePointers >= 1) return "pinch";
  if (i.pointerType === "mouse") {
    if (i.button === 2) return "menu";
    if (i.button === 1) return "pan";
    if (i.button !== 0) return "ignore";
  }
  if (i.activePointers >= 1) return "ignore";
  if (i.spaceHeld || i.tool === "hand") return "pan";
  if (i.pointerType === "touch" && i.pencilSeen) return "pan";
  return "tool";
}
```

`src/persist/tab-presence.ts`:

```ts
export const TAB_CHANNEL = "slop-vector-editor";

/** Autosave is one shared IndexedDB record, so two open tabs overwrite each other. Each tab says
 *  "hello" on start; any other tab answers "here"; both sides then warn once. */
export function watchOtherTabs(onOther: () => void, channelName = TAB_CHANNEL): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(channelName);
  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    onOther();
  };
  channel.onmessage = (e: MessageEvent) => {
    if (e.data === "hello") {
      channel.postMessage("here");
      warn();
    } else if (e.data === "here") {
      warn();
    }
  };
  channel.postMessage("hello");
  return () => channel.close();
}
```

Append to `src/state/keys.ts`:

```ts
import type { ToolId } from "../tools/types";

export type EditAction =
  | { kind: "tool"; tool: ToolId }
  | { kind: "delete" }
  | { kind: "duplicate" }
  | { kind: "clear" }
  | { kind: "nudge"; dx: number; dy: number };

const TOOL_KEYS: Readonly<Record<string, ToolId>> = {
  v: "select",
  r: "rect",
  e: "ellipse",
  l: "line",
  y: "polygon",
  h: "hand",
};

/** Editing keys. Checked after `commandForKey`, and never while a text field has focus. */
export function editActionForKey(e: KeyLike): EditAction | null {
  const k = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) return k === "d" ? { kind: "duplicate" } : null;
  if (k === "delete" || k === "backspace") return { kind: "delete" };
  if (k === "escape") return { kind: "clear" };
  const step = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case "ArrowLeft":
      return { kind: "nudge", dx: -step, dy: 0 };
    case "ArrowRight":
      return { kind: "nudge", dx: step, dy: 0 };
    case "ArrowUp":
      return { kind: "nudge", dx: 0, dy: -step };
    case "ArrowDown":
      return { kind: "nudge", dx: 0, dy: step };
  }
  const tool = e.shiftKey ? undefined : TOOL_KEYS[k];
  return tool ? { kind: "tool", tool } : null;
}
```

Place the new `import type` at the top of `keys.ts`, with the other imports (the file has none
yet), not in the middle of the file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/prefs-route-keys.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`.
Expected: PASS (10 tests); the full suite also passes. If Node's `BroadcastChannel` does not
deliver between two channels in the same thread (it should, as browsers do), report it rather
than removing the test.

- [ ] **Step 5: Commit**

```bash
git add src/persist/preferences.ts src/input/route.ts src/persist/tab-presence.ts src/state/keys.ts src/__tests__/prefs-route-keys.test.ts
git commit -m "feat: preferences, pointer routing, edit keys and other-tab detection

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Tool interface and the shape tools

**Files:**
- Create: `src/tools/tool.ts`, `src/tools/shape-tools.ts`, `src/__tests__/fake-context.ts`
- Test: `src/__tests__/shape-tools.test.ts`

**Interfaces:**
- Consumes: `Doc`, `Shape`, `Style`; `addShape`; `targetLayerId`; `Box`, `boxFromPoints`; `IDENTITY`; `linePath`, `polygonPath`, `starPath`; `Prefs`, `DEFAULT_PREFS`; `View`; `Mods`, `ToolId`, `NO_MODS`; session functions (`newSession`, `commit`, `beginGesture`, `endGesture`) for the fake.
- Produces:
  - `tool.ts`:
    - `type ToolEvent = { doc: Vec; screen: Vec; pointerType: string; mods: Mods }`
    - `type Overlay = { kind: "marquee"; box: Box } | null` (box in doc space)
    - `interface ToolContext { doc(): Doc; view(): View; selection(): readonly string[]; setSelection(ids: readonly string[]): void; commit(doc: Doc): void; beginGesture(): void; endGesture(): void; prefs(): Prefs; notify(kind: "info" | "error", text: string): void; setOverlay(o: Overlay): void }`
    - `interface Tool { readonly id: ToolId; readonly hint: string; readonly cursor: string; down(ctx, e): void; move(ctx, e): void; up(ctx, e): void; cancel(ctx): void }` — `move` is only called between `down` and `up`/`cancel`.
    - `MIN_DRAG_PX = 2`; `pointerTolerance(pointerType): number` (6 mouse, 14 otherwise); `movedEnough(a: Vec, b: Vec): boolean` (screen distance ≥ `MIN_DRAG_PX`)
  - `shape-tools.ts`: `dragBox(a, b, mods): Box` (Shift = square using the larger side, keeping drag direction; Alt = `a` is the centre); `SNAP_45 = π/4`; `snapLineEnd(a, b): Vec`; `lineStyle(style): Style` (fill null, stroke kept or black); `createRectTool()`, `createEllipseTool()`, `createLineTool()`, `createPolygonTool()`, `createHandTool()` → `Tool`
  - Shape-tool behaviour:
    - **Down:** picks `targetLayerId`. If there is none, it shows the info notice "Every layer is hidden or locked — there is nowhere to draw." and does nothing more.
    - **While dragging:** it rebuilds the shape from the base document on every move, as one gesture. Below `MIN_DRAG_PX`, or while the geometry would be empty, the document stays at the base.
    - **Up:** selects the new shape.
    - **Cancel:** restores the base document.
    - **Undo:** exactly one step per created shape, and none when nothing was created.
  - `fake-context.ts` (tests only): `fakeContext(doc: Doc, prefs?: Prefs): { ctx: ToolContext; state: { session: Session; selection: readonly string[]; overlay: Overlay; notices: string[]; view: View } }`; `ev(x: number, y: number, mods?: Partial<Mods>, pointerType?: string): ToolEvent` (doc = screen, view at zoom 1)

- [ ] **Step 1: Write the test helper** — `src/__tests__/fake-context.ts`

```ts
import type { Doc } from "../doc/document";
import { DEFAULT_PREFS, type Prefs } from "../persist/preferences";
import { beginGesture, commit, endGesture, newSession, type Session } from "../state/session";
import type { View } from "../state/viewport";
import type { Overlay, ToolContext, ToolEvent } from "../tools/tool";
import { NO_MODS, type Mods } from "../tools/types";

export type FakeState = {
  session: Session;
  selection: readonly string[];
  overlay: Overlay;
  notices: string[];
  view: View;
};

/** A ToolContext over a plain session, mirroring the real store's semantics. */
export function fakeContext(doc: Doc, prefs: Prefs = DEFAULT_PREFS): { ctx: ToolContext; state: FakeState } {
  const state: FakeState = {
    session: newSession(doc, true),
    selection: [],
    overlay: null,
    notices: [],
    view: { x: 0, y: 0, zoom: 1 },
  };
  const ctx: ToolContext = {
    doc: () => state.session.doc,
    view: () => state.view,
    selection: () => state.selection,
    setSelection: (ids) => {
      state.selection = [...ids];
    },
    commit: (d) => {
      state.session = commit(state.session, d);
    },
    beginGesture: () => {
      state.session = beginGesture(state.session);
    },
    endGesture: () => {
      state.session = endGesture(state.session);
    },
    prefs: () => prefs,
    notify: (_kind, text) => {
      state.notices.push(text);
    },
    setOverlay: (o) => {
      state.overlay = o;
    },
  };
  return { ctx, state };
}

/** A pointer event at (x, y); the fake view is the identity, so doc = screen. */
export function ev(x: number, y: number, mods: Partial<Mods> = {}, pointerType = "mouse"): ToolEvent {
  return { doc: { x, y }, screen: { x, y }, pointerType, mods: { ...NO_MODS, ...mods } };
}
```

- [ ] **Step 2: Write the failing test** — `src/__tests__/shape-tools.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createDoc, type Doc, type PathShape, type RectShape, type EllipseShape } from "../doc/document";
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

function drag(tool: Tool, ctx: ReturnType<typeof fakeContext>["ctx"], from: [number, number], to: [number, number], mods = {}) {
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
    expect(movedEnough({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(true);
    expect(movedEnough({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  it("builds drag boxes", () => {
    expect(dragBox({ x: 10, y: 10 }, { x: 0, y: 30 }, NO_MODS)).toEqual({ x: 0, y: 10, w: 10, h: 20 });
    expect(dragBox({ x: 10, y: 10 }, { x: 0, y: 30 }, { shift: true, alt: false })).toEqual({ x: -10, y: 10, w: 20, h: 20 });
    expect(dragBox({ x: 10, y: 10 }, { x: 15, y: 12 }, { shift: false, alt: true })).toEqual({ x: 5, y: 8, w: 10, h: 4 });
  });

  it("snaps line ends to 45° and gives lines a stroke", () => {
    const p = snapLineEnd({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.x).toBeCloseTo(Math.hypot(10, 1));
    expect(p.y).toBeCloseTo(0);
    const q = snapLineEnd({ x: 0, y: 0 }, { x: 10, y: 9 });
    expect(q.x).toBeCloseTo(q.y);
    expect(lineStyle({ ...DEFAULT_PREFS.style, stroke: null }).stroke).toEqual({ color: "#000000", opacity: 1 });
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

  it("refuses to draw when every layer is locked or hidden", () => {
    const d = blank();
    const locked: Doc = { ...d, layers: [{ ...d.layers[0], locked: true }] };
    const { ctx, state } = fakeContext(locked);
    drag(createRectTool(), ctx, [0, 0], [10, 10]);
    expect(children(state.session.doc)).toHaveLength(0);
    expect(state.notices).toEqual(["Every layer is hidden or locked — there is nowhere to draw."]);
  });
});

describe("ellipse, line and polygon tools", () => {
  it("draws an ellipse inside the drag box", () => {
    const { ctx, state } = fakeContext(blank());
    drag(createEllipseTool(), ctx, [0, 0], [20, 10]);
    expect(children(state.session.doc)[0] as EllipseShape).toMatchObject({ kind: "ellipse", cx: 10, cy: 5, rx: 10, ry: 5 });
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

  it("draws polygons and stars from the preferences", () => {
    const poly = fakeContext(blank());
    drag(createPolygonTool(), poly.ctx, [50, 50], [60, 50]);
    const p = children(poly.state.session.doc)[0] as PathShape;
    expect(p.subpaths[0].nodes).toHaveLength(5);
    expect(p.subpaths[0].nodes[0].p).toEqual({ x: 60, y: 50 });
    const starPrefs = { ...DEFAULT_PREFS, polygon: { sides: 6, star: true, innerRatio: 0.4 } };
    const star = fakeContext(blank(), starPrefs);
    drag(createPolygonTool(), star.ctx, [50, 50], [60, 50], { shift: true });
    const s = children(star.state.session.doc)[0] as PathShape;
    expect(s.subpaths[0].nodes).toHaveLength(12);
    expect(s.subpaths[0].nodes[0].p.x).toBeCloseTo(50);
    expect(s.subpaths[0].nodes[0].p.y).toBeCloseTo(40);
  });

  it("has a hand tool that never edits", () => {
    const { ctx, state } = fakeContext(blank());
    drag(createHandTool(), ctx, [0, 0], [10, 10]);
    expect(children(state.session.doc)).toHaveLength(0);
    expect(createHandTool().cursor).toBe("grab");
  });
});
```

Hand-checks:
- **Shift + Alt rect:** the drag delta is (30, 10), made square as (30, 30), then mirrored around (10, 10), giving (−20, −20) to (40, 40): x −20, w 60.
- **Polygon:** the centre is (50, 50) and the pointer (60, 50), so r = 10 at angle 0. The first node is at (60, 50) exactly, since cos 0 = 1 and sin 0 = 0.
- **Star with Shift:** the rotation is −π/2, so the first node is at (50, 40) (checked with `toBeCloseTo`).
- **Line with Shift:** (10, 1) snaps to angle 0, so the end is (√101, ~0).

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/__tests__/shape-tools.test.ts`
Expected: FAIL — cannot resolve `../tools/shape-tools`.

- [ ] **Step 4: Implement** — `src/tools/tool.ts`

```ts
import type { Doc } from "../doc/document";
import type { Box } from "../geom/box";
import type { Vec } from "../geom/vec";
import type { Prefs } from "../persist/preferences";
import type { View } from "../state/viewport";
import type { Mods, ToolId } from "./types";

export type ToolEvent = { doc: Vec; screen: Vec; pointerType: string; mods: Mods };

/** Transient drawing that is not part of the document (doc-space coordinates). */
export type Overlay = { kind: "marquee"; box: Box } | null;

/** Everything a tool may read or change. The app binds it to the store; tests use a fake. */
export interface ToolContext {
  doc(): Doc;
  view(): View;
  selection(): readonly string[];
  setSelection(ids: readonly string[]): void;
  commit(doc: Doc): void;
  beginGesture(): void;
  endGesture(): void;
  prefs(): Prefs;
  notify(kind: "info" | "error", text: string): void;
  setOverlay(o: Overlay): void;
}

export interface Tool {
  readonly id: ToolId;
  readonly hint: string;
  readonly cursor: string;
  down(ctx: ToolContext, e: ToolEvent): void;
  /** Only called between `down` and `up`/`cancel`. */
  move(ctx: ToolContext, e: ToolEvent): void;
  up(ctx: ToolContext, e: ToolEvent): void;
  cancel(ctx: ToolContext): void;
}

export const MIN_DRAG_PX = 2;

export function pointerTolerance(pointerType: string): number {
  return pointerType === "mouse" ? 6 : 14;
}

export function movedEnough(a: Vec, b: Vec): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) >= MIN_DRAG_PX;
}
```

`src/tools/shape-tools.ts`:

```ts
import type { Doc, Shape, Style } from "../doc/document";
import { addShape } from "../doc/edits";
import { targetLayerId } from "../doc/tree";
import { boxFromPoints, type Box } from "../geom/box";
import { IDENTITY } from "../geom/mat";
import { linePath, polygonPath, starPath } from "../geom/shapes";
import type { Vec } from "../geom/vec";
import type { Prefs } from "../persist/preferences";
import { movedEnough, type Tool, type ToolContext, type ToolEvent } from "./tool";
import type { Mods, ToolId } from "./types";

export const SNAP_45 = Math.PI / 4;

export function dragBox(a: Vec, b: Vec, mods: Mods): Box {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (mods.shift) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * s;
    dy = (dy < 0 ? -1 : 1) * s;
  }
  const far = { x: a.x + dx, y: a.y + dy };
  const near = mods.alt ? { x: a.x - dx, y: a.y - dy } : a;
  return boxFromPoints([near, far])!;
}

export function snapLineEnd(a: Vec, b: Vec): Vec {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / SNAP_45) * SNAP_45;
  return { x: a.x + len * Math.cos(angle), y: a.y + len * Math.sin(angle) };
}

/** A line is only its stroke: no fill, and a black stroke if the default style has none. */
export function lineStyle(style: Style): Style {
  return { ...style, fill: null, stroke: style.stroke ?? { color: "#000000", opacity: 1 } };
}

type Build = (a: Vec, b: Vec, mods: Mods, prefs: Prefs) => Shape | null;

type Active = { start: ToolEvent; layerId: string; base: Doc; createdId: string | null };

function createDragTool(id: ToolId, hint: string, build: Build): Tool {
  let active: Active | null = null;

  function update(ctx: ToolContext, e: ToolEvent): void {
    if (!active) return;
    const shape = movedEnough(active.start.screen, e.screen)
      ? build(active.start.doc, e.doc, e.mods, ctx.prefs())
      : null;
    if (!shape) {
      ctx.commit(active.base);
      active.createdId = null;
      return;
    }
    const r = addShape(active.base, active.layerId, shape);
    ctx.commit(r.doc);
    active.createdId = r.id;
  }

  return {
    id,
    hint,
    cursor: "crosshair",
    down(ctx, e) {
      const layerId = targetLayerId(ctx.doc());
      if (!layerId) {
        ctx.notify("info", "Every layer is hidden or locked — there is nowhere to draw.");
        return;
      }
      ctx.beginGesture();
      active = { start: e, layerId, base: ctx.doc(), createdId: null };
    },
    move(ctx, e) {
      update(ctx, e);
    },
    up(ctx, e) {
      if (!active) return;
      update(ctx, e);
      if (active.createdId) ctx.setSelection([active.createdId]);
      ctx.endGesture();
      active = null;
    },
    cancel(ctx) {
      if (!active) return;
      ctx.commit(active.base);
      ctx.endGesture();
      active = null;
    },
  };
}

const base = { id: "", transform: IDENTITY } as const;

export function createRectTool(): Tool {
  return createDragTool(
    "rect",
    "Drag to draw a rectangle · Shift: square · Alt: from centre",
    (a, b, mods, prefs) => {
      const box = dragBox(a, b, mods);
      if (box.w === 0 || box.h === 0) return null;
      return { ...base, kind: "rect", style: prefs.style, x: box.x, y: box.y, w: box.w, h: box.h, rx: 0 };
    },
  );
}

export function createEllipseTool(): Tool {
  return createDragTool(
    "ellipse",
    "Drag to draw an ellipse · Shift: circle · Alt: from centre",
    (a, b, mods, prefs) => {
      const box = dragBox(a, b, mods);
      if (box.w === 0 || box.h === 0) return null;
      return {
        ...base,
        kind: "ellipse",
        style: prefs.style,
        cx: box.x + box.w / 2,
        cy: box.y + box.h / 2,
        rx: box.w / 2,
        ry: box.h / 2,
      };
    },
  );
}

export function createLineTool(): Tool {
  return createDragTool("line", "Drag to draw a line · Shift: 45° steps", (a, b, mods, prefs) => {
    const end = mods.shift ? snapLineEnd(a, b) : b;
    if (end.x === a.x && end.y === a.y) return null;
    return { ...base, kind: "path", style: lineStyle(prefs.style), subpaths: [linePath(a, end)] };
  });
}

export function createPolygonTool(): Tool {
  return createDragTool(
    "polygon",
    "Drag from the centre to draw a polygon or star · Shift: upright",
    (a, b, mods, prefs) => {
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      if (r === 0) return null;
      const rotation = mods.shift ? -Math.PI / 2 : Math.atan2(b.y - a.y, b.x - a.x);
      const { sides, star, innerRatio } = prefs.polygon;
      const sp = star
        ? starPath(a, r, innerRatio, sides, rotation)
        : polygonPath(a, r, sides, rotation);
      return { ...base, kind: "path", style: prefs.style, subpaths: [sp] };
    },
  );
}

/** Panning is routed before tools see the pointer; the hand tool only supplies a cursor and hint. */
export function createHandTool(): Tool {
  return {
    id: "hand",
    hint: "Drag to pan · pinch or ⌘/Ctrl + wheel to zoom",
    cursor: "grab",
    down() {},
    move() {},
    up() {},
    cancel() {},
  };
}
```

Notes:
- **`{ ...base, kind: "rect", … }`:** if TypeScript cannot narrow this object literal to `Shape`, annotate the return with `: Shape` or write the fields out. Don't use `as` casts that hide missing fields.
- **Why the hand tool never moves anything:** in the test, `createHandTool` gets `down`/`move`/`up` directly, and it has no edit logic.
- **Unused parameters:** `noUnusedParameters` accepts parameter lists that are omitted entirely (`down() {}`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/shape-tools.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`.
Expected: PASS (13 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tools/tool.ts src/tools/shape-tools.ts src/__tests__/fake-context.ts src/__tests__/shape-tools.test.ts
git commit -m "feat(tools): tool interface and rect/ellipse/line/polygon/hand tools

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Select tool

**Files:**
- Create: `src/tools/select.ts`
- Test: `src/__tests__/select-tool.test.ts`

**Interfaces:**
- Consumes: `duplicateNodes`, `rotateNodes`, `translateNodes`; `resizeNodes`; `boxFromPoints`; `hitTest`, `marqueeSelect`; `selectionFrame`, `docToFrame`, `frameCenter`, `frameResizeMap`, `Frame`; `dragHandle`, `handleAt`, `handleSize`, `rotateDelta`, `Handle`, `ResizeHandle`; `movedEnough`, `pointerTolerance`, `Tool`, `ToolContext`, `ToolEvent`; `SNAP_45`.
- Produces: `createSelectTool(): Tool` (id `select`, cursor `default`). Behaviour, per spec §5:
  - **down:**
    - A handle of the current selection's frame under the pointer → pending handle drag.
    - Otherwise hit-test with `pointerTolerance / zoom`:
      - an unselected hit → selection becomes `[hit]`, or `[...sel, hit]` with Shift;
      - an already-selected hit with Shift → it is removed on `up` if the pointer never moved;
      - no hit → pending marquee.
  - **The first move ≥ `MIN_DRAG_PX`** starts the drag:
    - handle `rotate` → rotate;
    - other handle → resize;
    - hit → move (with Alt, the selection is duplicated in place first and the copies are moved and selected);
    - otherwise → marquee.
    - Move, resize and rotate run as one gesture each.
  - **While dragging:**
    - **move:** `translateNodes(base, ids, dx, dy)`; Shift constrains the direction to 45° steps.
    - **resize:** `resizeNodes(original, ids, frameResizeMap(frame.angle, frame.box, dragHandle(handle, frame.box, docToFrame(frame, p), mods)))`.
    - **rotate:** `rotateNodes(original, ids, rotateDelta(centre, start, p, frame.angle, shift), centre)`.
    - **marquee:** sets the overlay to the doc-space box, and the selection to (Shift ? previous : []) ∪ `marqueeSelect`.
  - **up:**
    - on a pending tap without a handle: toggle-off if flagged; on empty space without Shift, clear the selection;
    - a marquee clears the overlay;
    - move, resize and rotate end their gesture.
  - **cancel:** a drag restores the original doc; every kind restores the selection from before `down`; the overlay is cleared.

- [ ] **Step 1: Write the failing test** — `src/__tests__/select-tool.test.ts`

The rects are 40×40, so the centre (20, 20) is at least 20 px from every gizmo handle. On a
10×10 rect, the corner handles (reach 6 px) cover the whole shape.

```ts
import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Node,
  type RectShape,
} from "../doc/document";
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
  return { ...d, nextId: 10, layers: [{ ...d.layers[0], children: [rect("a", 0), rect("b", 60)] }] };
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
```

Hand-checks:
- **Handle positions.** A single `a` has frame (0, 0, 40, 40). Its handles sit at x/y 0, 20, 40, and the rotate knob is at (20, −24). The multi-selection frame is (0, 0, 100, 40). The points used for taps and marquee starts are at least 7 px from every handle (reach 6). They are also more than 6 px from each shape, so an empty-space start never hits.
- **Resize.** `se` is at (40, 40); dragging it to (50, 60) gives box (0, 0, 50, 60).
- **Rotate.** Around the centre (20, 20), the knob starts at −π/2 and ends at atan2(0.5, 44) ≈ 0.011. Shift snaps the total to 90°, so the origin moves to (40, 0).
- **Shift move.** (10, 2) snaps to angle 0 and projects to (10, 0).
- **Marquee.** (50, −10)–(110, 50) contains `b` (x 60–100) but not `a`.
- **Cancel.** The down on `a` switches the selection to ["a"] immediately, and cancel restores ["b"].

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/select-tool.test.ts`
Expected: FAIL — cannot resolve `../tools/select`.

- [ ] **Step 3: Implement** — `src/tools/select.ts`

```ts
import type { Doc } from "../doc/document";
import { duplicateNodes, rotateNodes, translateNodes } from "../doc/edits";
import { resizeNodes } from "../doc/resize";
import { boxFromPoints } from "../geom/box";
import { hitTest, marqueeSelect } from "../geom/hit";
import type { Vec } from "../geom/vec";
import { docToFrame, frameCenter, frameResizeMap, selectionFrame, type Frame } from "./frame";
import {
  dragHandle,
  handleAt,
  handleSize,
  rotateDelta,
  type Handle,
  type ResizeHandle,
} from "./gizmo";
import { SNAP_45 } from "./shape-tools";
import {
  movedEnough,
  pointerTolerance,
  type Tool,
  type ToolContext,
  type ToolEvent,
} from "./tool";

type Common = { start: ToolEvent; startSelection: readonly string[] };
type Pending = Common & {
  kind: "pending";
  hitId: string | null;
  handle: Handle | null;
  frame: Frame | null;
  toggleOnUp: boolean;
};
type Mode =
  | Pending
  | (Common & { kind: "marquee"; base: readonly string[] })
  | (Common & { kind: "move"; original: Doc; base: Doc; ids: readonly string[] })
  | (Common & {
      kind: "resize";
      original: Doc;
      ids: readonly string[];
      frame: Frame;
      handle: ResizeHandle;
    })
  | (Common & { kind: "rotate"; original: Doc; ids: readonly string[]; frame: Frame; centre: Vec });

function constrain(dx: number, dy: number): [number, number] {
  const angle = Math.round(Math.atan2(dy, dx) / SNAP_45) * SNAP_45;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const along = dx * c + dy * s;
  return [along * c, along * s];
}

function startDrag(ctx: ToolContext, p: Pending): Mode {
  const doc = ctx.doc();
  const ids = ctx.selection();
  const common = { start: p.start, startSelection: p.startSelection };
  if (p.handle && p.frame) {
    ctx.beginGesture();
    if (p.handle === "rotate") {
      return { ...common, kind: "rotate", original: doc, ids, frame: p.frame, centre: frameCenter(p.frame) };
    }
    return { ...common, kind: "resize", original: doc, ids, frame: p.frame, handle: p.handle };
  }
  if (p.hitId) {
    ctx.beginGesture();
    if (p.start.mods.alt) {
      const dup = duplicateNodes(doc, ids, 0, 0);
      ctx.commit(dup.doc);
      ctx.setSelection(dup.ids);
      return { ...common, kind: "move", original: doc, base: dup.doc, ids: dup.ids };
    }
    return { ...common, kind: "move", original: doc, base: doc, ids };
  }
  return { ...common, kind: "marquee", base: p.start.mods.shift ? ids : [] };
}

function drag(ctx: ToolContext, m: Mode, e: ToolEvent): void {
  switch (m.kind) {
    case "pending":
      return;
    case "move": {
      let dx = e.doc.x - m.start.doc.x;
      let dy = e.doc.y - m.start.doc.y;
      if (e.mods.shift) [dx, dy] = constrain(dx, dy);
      ctx.commit(translateNodes(m.base, m.ids, dx, dy));
      return;
    }
    case "resize": {
      const box = dragHandle(m.handle, m.frame.box, docToFrame(m.frame, e.doc), e.mods);
      ctx.commit(resizeNodes(m.original, m.ids, frameResizeMap(m.frame.angle, m.frame.box, box)));
      return;
    }
    case "rotate": {
      const d = rotateDelta(m.centre, m.start.doc, e.doc, m.frame.angle, e.mods.shift);
      ctx.commit(rotateNodes(m.original, m.ids, d, m.centre));
      return;
    }
    case "marquee": {
      const box = boxFromPoints([m.start.doc, e.doc])!;
      ctx.setOverlay({ kind: "marquee", box });
      const inside = marqueeSelect(ctx.doc(), box).filter((id) => !m.base.includes(id));
      ctx.setSelection([...m.base, ...inside]);
      return;
    }
  }
}

export function createSelectTool(): Tool {
  let mode: Mode | null = null;

  return {
    id: "select",
    hint: "Click to select · drag to move · Shift: add · drag empty space to select an area",
    cursor: "default",

    down(ctx, e) {
      const sel = ctx.selection();
      const doc = ctx.doc();
      const view = ctx.view();
      const frame = sel.length > 0 ? selectionFrame(doc, sel) : null;
      const handle = frame ? handleAt(frame, view, e.screen, handleSize(e.pointerType)) : null;
      let hitId: string | null = null;
      let toggleOnUp = false;
      if (!handle) {
        hitId = hitTest(doc, e.doc, pointerTolerance(e.pointerType) / view.zoom)?.nodeId ?? null;
        if (hitId && !sel.includes(hitId)) ctx.setSelection(e.mods.shift ? [...sel, hitId] : [hitId]);
        else if (hitId && e.mods.shift) toggleOnUp = true;
      }
      mode = { kind: "pending", start: e, startSelection: sel, hitId, handle, frame, toggleOnUp };
    },

    move(ctx, e) {
      if (!mode) return;
      if (mode.kind === "pending") {
        if (!movedEnough(mode.start.screen, e.screen)) return;
        mode = startDrag(ctx, mode);
      }
      drag(ctx, mode, e);
    },

    up(ctx, e) {
      const m = mode;
      mode = null;
      if (!m) return;
      if (m.kind === "pending") {
        if (m.handle) return;
        if (m.hitId && m.toggleOnUp) {
          const id = m.hitId;
          ctx.setSelection(ctx.selection().filter((s) => s !== id));
        } else if (!m.hitId && !m.start.mods.shift) {
          ctx.setSelection([]);
        }
        return;
      }
      drag(ctx, m, e);
      if (m.kind === "marquee") ctx.setOverlay(null);
      else ctx.endGesture();
    },

    cancel(ctx) {
      const m = mode;
      mode = null;
      if (!m) return;
      if (m.kind === "move" || m.kind === "resize" || m.kind === "rotate") {
        ctx.commit(m.original);
        ctx.endGesture();
      }
      ctx.setOverlay(null);
      ctx.setSelection(m.startSelection);
    },
  };
}
```

Notes:
- **Import direction:** `select.ts` imports `SNAP_45` from `shape-tools.ts`. That is a one-way dependency; `shape-tools.ts` must not import `select.ts`.
- **Resize with no net change:** `frameResizeMap` gives a near-identity matrix. `resizeNodes` treats it as the identity (eps 1e-9) and returns the same document, so no history step is recorded.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/select-tool.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`.
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/select.ts src/__tests__/select-tool.test.ts
git commit -m "feat(tools): select tool with marquee, move, Alt-duplicate, resize and rotate

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Store integration, tool registry and modifier-dock logic

**Files:**
- Create: `src/input/dock.ts`, `src/tools/registry.ts`, `src/tools/context.ts`
- Modify: `src/state/appState.svelte.ts` (full replacement below), `src/state/commands.ts` (append)
- Test: `src/__tests__/dock.test.ts`

**Interfaces:**
- Consumes: the edits from Task 5; `pruneSelection`; `loadPrefs`, `savePrefs`, `sanitizePrefs`, `Prefs`, `PolygonPrefs`; `Overlay`, `Tool`, `ToolContext`; `Mods`, `ToolId`; all `create*Tool` functions; `EditAction`.
- Produces:
  - `dock.ts`: `type Latch = "off" | "held" | "latched"`; `TAP_MS = 250`; `type DockPress = { before: Latch; at: number }`; `dockDown(current: Latch, now: number): { state: Latch; press: DockPress }` (always `held`); `dockUp(press: DockPress, now: number): Latch` (a tap shorter than `TAP_MS` toggles the latch relative to `before`; a longer hold releases to `off`); `latchOn(l: Latch): boolean`
  - `appState.svelte.ts` adds these store fields:
    - `selection` (raw `readonly string[]`)
    - `toolId` (`ToolId`, default `select`)
    - `prefs` (raw, from `loadPrefs()`)
    - `dock` (raw `{ shift: Latch; alt: Latch }`)
    - `spaceHeld`, `overlay` (raw), `contextMenu` (raw `{x, y} | null`), `propertiesOpen`, `lastPointerType`
  - `appState.svelte.ts` adds these actions:
    - `setSelection(ids)` (pruned), `clearSelection()`, `setTool(id)` (clears the overlay), `setOverlay(o)`
    - `setDock(key, latch)`, `dockMods(): Mods`
    - `setPrefs(p)` (sanitised, saved), `setPolygonPrefs(patch)`
    - `deleteSelection()`, `duplicateSelection()` (offset 10, 10; selects the copies), `nudgeSelection(dx, dy)`
    - `convertSelectionToPath()`, `flattenSelection()`, `setSelectionRectRadius(rx)`
    - `setSelectionStyle(patch)` — with an empty selection it edits `prefs.style` instead
  - `appState.svelte.ts` changes existing behaviour:
    - every session change prunes the selection;
    - `replaceDocument` also clears the selection and the overlay.
  - `registry.ts`: `TOOLS: Readonly<Record<ToolId, Tool>>` (one instance of each tool)
  - `context.ts`: `storeContext: ToolContext` bound to the store
  - `commands.ts`: `runEditAction(a: EditAction): void`

- [ ] **Step 1: Write the failing test** — `src/__tests__/dock.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { dockDown, dockUp, latchOn, TAP_MS } from "../input/dock";

describe("modifier dock", () => {
  it("holds while pressed", () => {
    expect(dockDown("off", 1000)).toEqual({ state: "held", press: { before: "off", at: 1000 } });
    expect(dockDown("latched", 5)).toEqual({ state: "held", press: { before: "latched", at: 5 } });
  });

  it("latches on a tap and unlatches on the next tap", () => {
    expect(dockUp({ before: "off", at: 1000 }, 1000 + TAP_MS - 1)).toBe("latched");
    expect(dockUp({ before: "latched", at: 1000 }, 1100)).toBe("off");
  });

  it("releases after a hold", () => {
    expect(dockUp({ before: "off", at: 1000 }, 1000 + TAP_MS)).toBe("off");
    expect(dockUp({ before: "latched", at: 1000 }, 2000)).toBe("off");
  });

  it("reports whether a latch counts as pressed", () => {
    expect(latchOn("off")).toBe(false);
    expect(latchOn("held")).toBe(true);
    expect(latchOn("latched")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/dock.test.ts`
Expected: FAIL — cannot resolve `../input/dock`.

- [ ] **Step 3: Implement** — `src/input/dock.ts`

```ts
/** On-screen Shift/Alt for touch: press-and-hold works like a key, a quick tap latches. */
export type Latch = "off" | "held" | "latched";
export type DockPress = { before: Latch; at: number };

export const TAP_MS = 250;

export function dockDown(current: Latch, now: number): { state: Latch; press: DockPress } {
  return { state: "held", press: { before: current, at: now } };
}

export function dockUp(press: DockPress, now: number): Latch {
  if (now - press.at < TAP_MS) return press.before === "latched" ? "off" : "latched";
  return "off";
}

export function latchOn(l: Latch): boolean {
  return l !== "off";
}
```

Replace `src/state/appState.svelte.ts` with:

```ts
import { createDoc, type Doc, type Style } from "../doc/document";
import {
  convertToPath,
  deleteNodes,
  duplicateNodes,
  flattenTransform,
  setRectRadius,
  setStyle,
  translateNodes,
} from "../doc/edits";
import { pruneSelection } from "../doc/tree";
import { latchOn, type Latch } from "../input/dock";
import {
  loadPrefs,
  sanitizePrefs,
  savePrefs,
  type PolygonPrefs,
  type Prefs,
} from "../persist/preferences";
import type { Overlay } from "../tools/tool";
import type { Mods, ToolId } from "../tools/types";
import { canRedo, canUndo } from "./history";
import {
  beginGesture,
  commit,
  endGesture,
  isDirty,
  markSaved,
  newSession,
  redoSession,
  undoSession,
  type Session,
} from "./session";
import { fitRect, zoomAt, type View } from "./viewport";

export type Notice = { id: number; kind: "info" | "error"; text: string };
export type DialogKind = "new" | "settings" | null;
export type ConfirmRequest = {
  text: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
};
export type ContextMenuState = { x: number; y: number } | null;
export type DockState = { shift: Latch; alt: Latch };

/** The single app store. Exported as `app`, never `state`, so components that use the `$state`
 *  rune can import it without the `store_rune_conflict` error the sibling apps hit.
 *  Immutable values are `$state.raw`: they are replaced, never mutated, and raw keeps reference
 *  equality intact for the dirty check and for selection pruning. */
class AppState {
  session = $state.raw<Session>(newSession(createDoc(1920, 1080), true));
  fileName = $state("Untitled.svg");
  view = $state.raw<View>({ x: 0, y: 0, zoom: 1 });
  viewportSize = $state.raw({ w: 0, h: 0 });
  /** Bumped to ask the canvas to fit the artboard (on load and on document replace). */
  fitNonce = $state(0);
  notices = $state.raw<Notice[]>([]);
  dialog = $state<DialogKind>(null);
  confirm = $state.raw<ConfirmRequest | null>(null);
  /** Where Save writes without asking. Not reactive: nothing renders from it. */
  fileHandle: FileSystemFileHandle | null = null;

  /** Top-level node ids; not part of undo history. */
  selection = $state.raw<readonly string[]>([]);
  toolId = $state<ToolId>("select");
  prefs = $state.raw<Prefs>(loadPrefs());
  dock = $state.raw<DockState>({ shift: "off", alt: "off" });
  spaceHeld = $state(false);
  overlay = $state.raw<Overlay>(null);
  contextMenu = $state.raw<ContextMenuState>(null);
  /** The properties drawer on narrow screens. */
  propertiesOpen = $state(false);
  /** Last pointer type on the canvas; handle sizes follow it. */
  lastPointerType = $state("mouse");

  get doc(): Doc {
    return this.session.doc;
  }
  get dirty(): boolean {
    return isDirty(this.session);
  }
  get canUndo(): boolean {
    return canUndo(this.session.history);
  }
  get canRedo(): boolean {
    return canRedo(this.session.history);
  }
}

export const app = new AppState();

/** Every session change goes through here, so the selection never names a node that is gone,
 *  hidden or locked. */
function setSession(s: Session): void {
  app.session = s;
  const pruned = pruneSelection(s.doc, app.selection);
  if (pruned !== app.selection) app.selection = pruned;
}

export function commitDoc(next: Doc): void {
  setSession(commit(app.session, next));
}

export function beginDocGesture(): void {
  setSession(beginGesture(app.session));
}

export function endDocGesture(): void {
  setSession(endGesture(app.session));
}

export function undo(): void {
  setSession(undoSession(app.session));
}

export function redo(): void {
  setSession(redoSession(app.session));
}

export function replaceDocument(
  doc: Doc,
  fileName: string,
  handle: FileSystemFileHandle | null,
  saved: boolean,
): void {
  app.selection = [];
  app.overlay = null;
  setSession(newSession(doc, saved));
  app.fileName = fileName;
  app.fileHandle = handle;
  app.fitNonce++;
}

export function markDocSaved(
  doc: Doc,
  fileName: string,
  handle: FileSystemFileHandle | null,
): void {
  setSession(markSaved(app.session, doc));
  app.fileName = fileName;
  app.fileHandle = handle;
}

export function setView(v: View): void {
  app.view = v;
}

export function setViewportSize(w: number, h: number): void {
  if (app.viewportSize.w !== w || app.viewportSize.h !== h) app.viewportSize = { w, h };
}

export function fitArtboard(): void {
  const { w, h } = app.viewportSize;
  if (w <= 0 || h <= 0) return;
  const ab = app.doc.artboard;
  app.view = fitRect({ x: 0, y: 0, w: ab.w, h: ab.h }, w, h);
}

export function zoomBy(factor: number): void {
  const { w, h } = app.viewportSize;
  app.view = zoomAt(app.view, { x: w / 2, y: h / 2 }, factor);
}

export function zoomTo(zoom: number): void {
  zoomBy(zoom / app.view.zoom);
}

let noticeSeq = 0;

export function notify(kind: Notice["kind"], text: string): void {
  const id = ++noticeSeq;
  app.notices = [...app.notices, { id, kind, text }];
  // Errors stay until dismissed; info fades on its own.
  if (kind === "info") setTimeout(() => dismissNotice(id), 6000);
}

export function dismissNotice(id: number): void {
  app.notices = app.notices.filter((n) => n.id !== id);
}

/** In-app replacement for window.confirm (native dialogs block the page and browser automation). */
export function askConfirm(text: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    app.confirm = {
      text,
      confirmLabel,
      resolve: (ok) => {
        app.confirm = null;
        resolve(ok);
      },
    };
  });
}

// ----- selection, tools, preferences -----

export function setSelection(ids: readonly string[]): void {
  app.selection = pruneSelection(app.doc, ids);
}

export function clearSelection(): void {
  if (app.selection.length > 0) app.selection = [];
}

export function setTool(id: ToolId): void {
  if (app.toolId === id) return;
  app.toolId = id;
  app.overlay = null;
}

export function setOverlay(o: Overlay): void {
  app.overlay = o;
}

export function setDock(key: keyof DockState, latch: Latch): void {
  app.dock = { ...app.dock, [key]: latch };
}

export function dockMods(): Mods {
  return { shift: latchOn(app.dock.shift), alt: latchOn(app.dock.alt) };
}

export function setPrefs(p: Prefs): void {
  const clean = sanitizePrefs(p);
  app.prefs = clean;
  savePrefs(clean);
}

export function setPolygonPrefs(patch: Partial<PolygonPrefs>): void {
  setPrefs({ ...app.prefs, polygon: { ...app.prefs.polygon, ...patch } });
}

// ----- selection actions (keyboard, context bar, context menu) -----

export function deleteSelection(): void {
  if (app.selection.length > 0) commitDoc(deleteNodes(app.doc, app.selection));
}

export function duplicateSelection(): void {
  const r = duplicateNodes(app.doc, app.selection, 10, 10);
  if (r.ids.length === 0) return;
  commitDoc(r.doc);
  setSelection(r.ids);
}

export function nudgeSelection(dx: number, dy: number): void {
  if (app.selection.length > 0) commitDoc(translateNodes(app.doc, app.selection, dx, dy));
}

export function convertSelectionToPath(): void {
  commitDoc(convertToPath(app.doc, app.selection));
}

export function flattenSelection(): void {
  commitDoc(flattenTransform(app.doc, app.selection));
}

export function setSelectionRectRadius(rx: number): void {
  commitDoc(setRectRadius(app.doc, app.selection, rx));
}

/** With nothing selected, style edits change the defaults for new shapes instead. */
export function setSelectionStyle(patch: Partial<Style>): void {
  if (app.selection.length === 0) {
    setPrefs({ ...app.prefs, style: { ...app.prefs.style, ...patch } });
    return;
  }
  commitDoc(setStyle(app.doc, app.selection, patch));
}
```

`src/tools/registry.ts`:

```ts
import { createSelectTool } from "./select";
import {
  createEllipseTool,
  createHandTool,
  createLineTool,
  createPolygonTool,
  createRectTool,
} from "./shape-tools";
import type { Tool } from "./tool";
import type { ToolId } from "./types";

/** One instance per tool; tools keep their in-progress gesture state in closures. */
export const TOOLS: Readonly<Record<ToolId, Tool>> = {
  select: createSelectTool(),
  rect: createRectTool(),
  ellipse: createEllipseTool(),
  line: createLineTool(),
  polygon: createPolygonTool(),
  hand: createHandTool(),
};
```

`src/tools/context.ts`:

```ts
import {
  app,
  beginDocGesture,
  commitDoc,
  endDocGesture,
  notify,
  setOverlay,
  setSelection,
} from "../state/appState.svelte";
import type { ToolContext } from "./tool";

/** The real ToolContext: tools reach the store only through this object. */
export const storeContext: ToolContext = {
  doc: () => app.doc,
  view: () => app.view,
  selection: () => app.selection,
  setSelection,
  commit: commitDoc,
  beginGesture: beginDocGesture,
  endGesture: endDocGesture,
  prefs: () => app.prefs,
  notify,
  setOverlay,
};
```

Append to `src/state/commands.ts`, and extend its imports as shown:

```ts
// add to the imports at the top of commands.ts:
import {
  clearSelection,
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  setTool,
} from "./appState.svelte";
import type { EditAction } from "./keys";

export function runEditAction(a: EditAction): void {
  switch (a.kind) {
    case "tool":
      return setTool(a.tool);
    case "delete":
      return deleteSelection();
    case "duplicate":
      return duplicateSelection();
    case "clear":
      return clearSelection();
    case "nudge":
      return nudgeSelection(a.dx, a.dy);
  }
}
```

Merge the new names into the existing `./appState.svelte` and `./keys` import statements, rather
than adding duplicate import lines.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/__tests__/dock.test.ts`, then `npm test`, `npm run build`, `npm run lint`.
Expected:
- dock tests PASS (4 tests), and the full suite passes;
- the build reports 0 errors and 0 warnings;
- lint is silent.

`TOOLS`, `storeContext` and `runEditAction` are not used by any component yet. That is fine: they
are exports, and `noUnusedLocals` does not flag exports.

- [ ] **Step 5: Commit**

```bash
git add src/input/dock.ts src/tools/registry.ts src/tools/context.ts src/state/appState.svelte.ts src/state/commands.ts src/__tests__/dock.test.ts
git commit -m "feat(state): selection, tools, preferences and dock in the store

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Canvas pointer routing and the selection overlay

UI tasks (12–14) have no unit tests: Vitest has no DOM. Their gate is `npm run build` (0 errors,
0 warnings), `npm run lint`, `npm test`, and a dev-server compile check: `curl` the changed
`.svelte` files from `npx vite --port 5199 --strictPort` and confirm HTTP 200 with compiled
output. If a server is already running on 5199, reuse it. The controller runs the real browser
pass.

**Files:**
- Modify: `src/lib/Canvas.svelte` (full replacement below)
- Create: `src/lib/Overlay.svelte`

**Interfaces:**
- Consumes: `routePointerDown`; `hitTest`; `storeContext`; `TOOLS`; `pointerTolerance`, `Tool`, `ToolEvent`; `app`, `dockMods`, `fitArtboard`, `setSelection`, `setView`, `setViewportSize`; `panBy`, `pinch`, `screenToDoc`, `wheelView`, `zoomAt`, `docToScreen`; `selectionFrame`; `frameOutline`, `handlePositions`, `handleSize`, `RESIZE_HANDLES`.
- Produces:
  - **`Canvas.svelte`** (same `oncursor` prop) routes each pointerdown through `routePointerDown`:
    - `tool` → the active tool's `down`/`move`/`up`;
    - `pan` → panning;
    - `pinch` → cancels a running tool gesture, then pinch-zooms;
    - `menu`, `ignore` → nothing.
    - `pointercancel` and `lostpointercapture` cancel a tool gesture.
    - Switching tools mid-gesture cancels the gesture.
    - Right-click with the Select tool selects the node under the pointer (unless it is already selected) and opens `app.contextMenu` when something is selected.
    - The cursor follows the tool, and shows grab/grabbing while panning or holding Space.
    - Pointerdown blurs any focused text field, so keyboard shortcuts work after a click on the canvas.
  - **`Overlay.svelte`** (SVG, drawn in screen coordinates, `pointer-events: none`):
    - a thin accent outline per selected node, following each node's own frame;
    - the gizmo (dashed frame for multi-selection, 8 resize handles, rotate knob and stem) when the Select tool is active;
    - the marquee rectangle from `app.overlay`.

- [ ] **Step 1: Replace `src/lib/Canvas.svelte`**

```svelte
<script lang="ts">
  import { untrack } from "svelte";
  import { hitTest } from "../geom/hit";
  import type { Vec } from "../geom/vec";
  import { routePointerDown } from "../input/route";
  import {
    app,
    dockMods,
    fitArtboard,
    setSelection,
    setView,
    setViewportSize,
  } from "../state/appState.svelte";
  import { panBy, pinch, screenToDoc, wheelView, zoomAt } from "../state/viewport";
  import { storeContext } from "../tools/context";
  import { TOOLS } from "../tools/registry";
  import { pointerTolerance, type Tool, type ToolEvent } from "../tools/tool";
  import NodeView from "./NodeView.svelte";
  import Overlay from "./Overlay.svelte";

  let { oncursor }: { oncursor: (p: Vec | null) => void } = $props();

  type Gesture =
    | { kind: "tool"; pointerId: number; tool: Tool }
    | { kind: "pan"; pointerId: number }
    | { kind: "pinch" };

  let host: HTMLDivElement;
  let width = $state(0);
  let height = $state(0);
  let gesture = $state.raw<Gesture | null>(null);
  /** Once a Pencil has touched the canvas, fingers only navigate (spec §5). */
  let pencilSeen = false;
  /** Active pointers in canvas-local px. A plain Map: nothing renders from it. */
  const pointers = new Map<number, Vec>();

  const ready = $derived(width > 0 && height > 0);
  const view = $derived(app.view);
  const artboard = $derived(app.doc.artboard);
  const cursor = $derived(
    gesture?.kind === "pan"
      ? "grabbing"
      : app.spaceHeld || app.toolId === "hand"
        ? "grab"
        : TOOLS[app.toolId].cursor,
  );

  $effect(() => {
    setViewportSize(width, height);
  });

  // Fit when the canvas first gets a size and whenever a document is replaced.
  $effect(() => {
    void app.fitNonce;
    if (ready) untrack(fitArtboard);
  });

  // Switching tools mid-gesture cancels the running gesture.
  $effect(() => {
    void app.toolId;
    untrack(() => {
      if (gesture?.kind === "tool") {
        gesture.tool.cancel(storeContext);
        gesture = null;
      }
    });
  });

  function local(e: { clientX: number; clientY: number }): Vec {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function toolEvent(e: PointerEvent): ToolEvent {
    const screen = local(e);
    const dock = dockMods();
    return {
      doc: screenToDoc(app.view, screen),
      screen,
      pointerType: e.pointerType,
      mods: { shift: e.shiftKey || dock.shift, alt: e.altKey || dock.alt },
    };
  }

  function onpointerdown(e: PointerEvent) {
    app.contextMenu = null;
    if (e.pointerType === "pen") pencilSeen = true;
    const route = routePointerDown({
      pointerType: e.pointerType,
      button: e.button,
      activePointers: pointers.size,
      spaceHeld: app.spaceHeld,
      tool: app.toolId,
      pencilSeen,
    });
    if (route === "ignore" || route === "menu") return;
    // No native text selection or drag; keep keyboard shortcuts working after a click here.
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    app.lastPointerType = e.pointerType;
    try {
      host.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is no longer active (e.g. a synthetic event); tracking still works.
    }
    pointers.set(e.pointerId, local(e));
    if (route === "pinch") {
      if (gesture?.kind === "tool") gesture.tool.cancel(storeContext);
      gesture = { kind: "pinch" };
      return;
    }
    if (route === "pan") {
      gesture = { kind: "pan", pointerId: e.pointerId };
      return;
    }
    const tool = TOOLS[app.toolId];
    gesture = { kind: "tool", pointerId: e.pointerId, tool };
    tool.down(storeContext, toolEvent(e));
  }

  function onpointermove(e: PointerEvent) {
    const p = local(e);
    oncursor(screenToDoc(app.view, p));
    const prev = pointers.get(e.pointerId);
    if (!prev || !gesture) return;
    if (gesture.kind === "pinch") {
      // Pinch with the first two pointers; any further finger is ignored.
      const [idA, idB] = [...pointers.keys()];
      if (idB !== undefined && (e.pointerId === idA || e.pointerId === idB)) {
        const other = pointers.get(e.pointerId === idA ? idB : idA)!;
        setView(pinch(app.view, prev, other, p, other));
      }
    } else if (gesture.pointerId === e.pointerId) {
      if (gesture.kind === "pan") setView(panBy(app.view, p.x - prev.x, p.y - prev.y));
      else gesture.tool.move(storeContext, toolEvent(e));
    }
    pointers.set(e.pointerId, p);
  }

  function endPointer(e: PointerEvent, cancelled: boolean) {
    if (!pointers.has(e.pointerId)) return;
    const g = gesture;
    if (g && g.kind !== "pinch" && g.pointerId === e.pointerId) {
      if (g.kind === "tool") {
        if (cancelled) g.tool.cancel(storeContext);
        else g.tool.up(storeContext, toolEvent(e));
      }
      gesture = null;
    }
    pointers.delete(e.pointerId);
    if (pointers.size === 0) gesture = null;
  }

  function oncontextmenu(e: MouseEvent) {
    e.preventDefault();
    if (app.toolId !== "select") return;
    const p = screenToDoc(app.view, local(e));
    const hit = hitTest(app.doc, p, pointerTolerance("mouse") / app.view.zoom);
    if (hit && !app.selection.includes(hit.nodeId)) setSelection([hit.nodeId]);
    if (app.selection.length > 0) app.contextMenu = { x: e.clientX, y: e.clientY };
  }

  $effect(() => {
    // Non-passive so preventDefault stops page scroll / browser zoom.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView(wheelView(app.view, e, local(e)));
    };
    // Safari desktop reports trackpad pinch as proprietary gesture events, not ctrl+wheel.
    // On iPad the same events accompany touch pinches, which the pointer path already handles.
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (pointers.size > 0) return;
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      setView(zoomAt(app.view, local(g), g.scale / lastScale));
      lastScale = g.scale;
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("gesturestart", onGestureStart);
    host.addEventListener("gesturechange", onGestureChange);
    return () => {
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("gesturestart", onGestureStart);
      host.removeEventListener("gesturechange", onGestureChange);
    };
  });
</script>

<div
  bind:this={host}
  bind:clientWidth={width}
  bind:clientHeight={height}
  class="relative size-full overflow-hidden bg-ground select-none"
  style="touch-action: none; cursor: {cursor}"
  role="application"
  aria-label="Drawing canvas"
  {onpointerdown}
  {onpointermove}
  onpointerup={(e) => endPointer(e, false)}
  onpointercancel={(e) => endPointer(e, true)}
  onlostpointercapture={(e) => endPointer(e, true)}
  {oncontextmenu}
  onpointerleave={() => {
    if (pointers.size === 0) oncursor(null);
  }}
>
  <svg class="absolute inset-0" {width} {height}>
    <defs>
      <pattern id="sv-checker" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="#ffffff" />
        <rect width="8" height="8" fill="#d4d4d8" />
        <rect x="8" y="8" width="8" height="8" fill="#d4d4d8" />
      </pattern>
    </defs>
    <g transform="matrix({view.zoom} 0 0 {view.zoom} {view.x} {view.y})">
      <rect x="0" y="0" width={artboard.w} height={artboard.h} fill="url(#sv-checker)" />
      {#if artboard.background}
        <rect
          x="0"
          y="0"
          width={artboard.w}
          height={artboard.h}
          fill={artboard.background.color}
          fill-opacity={artboard.background.opacity}
        />
      {/if}
      {#each app.doc.layers as layer (layer.id)}
        {#if layer.visible}
          <g>
            {#each layer.children as node (node.id)}
              <NodeView {node} />
            {/each}
          </g>
        {/if}
      {/each}
      <rect
        x="0"
        y="0"
        width={artboard.w}
        height={artboard.h}
        fill="none"
        stroke="#000000"
        stroke-opacity="0.35"
        vector-effect="non-scaling-stroke"
        pointer-events="none"
      />
    </g>
    <Overlay />
  </svg>
</div>
```

The checkerboard and artboard-outline hex values are artwork-surface colours carried over from M1,
not UI chrome, so they stay.

- [ ] **Step 2: Write `src/lib/Overlay.svelte`**

```svelte
<svelte:options namespace="svg" />

<script lang="ts">
  import type { Vec } from "../geom/vec";
  import { app } from "../state/appState.svelte";
  import { docToScreen } from "../state/viewport";
  import { selectionFrame } from "../tools/frame";
  import { frameOutline, handlePositions, handleSize, RESIZE_HANDLES } from "../tools/gizmo";

  const LINE = "stroke: var(--color-accent); fill: none";
  const KNOB = "stroke: var(--color-accent); fill: var(--color-text)";

  const view = $derived(app.view);
  const outlines = $derived(
    app.selection
      .map((id) => selectionFrame(app.doc, [id]))
      .filter((f) => f !== null)
      .map((f) => frameOutline(f, view)),
  );
  const frame = $derived(
    app.toolId === "select" && app.selection.length > 0
      ? selectionFrame(app.doc, app.selection)
      : null,
  );
  const handles = $derived(frame ? handlePositions(frame, view) : null);
  const size = $derived(handleSize(app.lastPointerType));
  const marquee = $derived(app.overlay?.kind === "marquee" ? app.overlay.box : null);
  const marqueeA = $derived(marquee ? docToScreen(view, { x: marquee.x, y: marquee.y }) : null);
  const marqueeB = $derived(
    marquee ? docToScreen(view, { x: marquee.x + marquee.w, y: marquee.y + marquee.h }) : null,
  );

  const points = (ps: Vec[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");
</script>

<g pointer-events="none">
  {#each outlines as outline, i (i)}
    <polygon points={points(outline)} style={LINE} stroke-width="1" />
  {/each}

  {#if frame && handles}
    {#if app.selection.length > 1}
      <polygon
        points={points(frameOutline(frame, view))}
        style={LINE}
        stroke-width="1"
        stroke-dasharray="4 3"
      />
    {/if}
    <line
      x1={handles.n.x}
      y1={handles.n.y}
      x2={handles.rotate.x}
      y2={handles.rotate.y}
      style={LINE}
      stroke-width="1"
    />
    <circle cx={handles.rotate.x} cy={handles.rotate.y} r={size / 2} style={KNOB} />
    {#each RESIZE_HANDLES as h (h)}
      <rect
        x={handles[h].x - size / 2}
        y={handles[h].y - size / 2}
        width={size}
        height={size}
        style={KNOB}
      />
    {/each}
  {/if}

  {#if marqueeA && marqueeB}
    <rect
      x={Math.min(marqueeA.x, marqueeB.x)}
      y={Math.min(marqueeA.y, marqueeB.y)}
      width={Math.abs(marqueeB.x - marqueeA.x)}
      height={Math.abs(marqueeB.y - marqueeA.y)}
      style="stroke: var(--color-accent); fill: var(--color-accent); fill-opacity: 0.08"
      stroke-dasharray="4 3"
    />
  {/if}
</g>
```

- [ ] **Step 3: Verify**

Run: `npm run build && npm run lint && npm test`
Expected: 0 errors, 0 warnings; lint silent; all tests pass. Then run the dev-server compile check
for `/src/lib/Canvas.svelte` and `/src/lib/Overlay.svelte` (HTTP 200, compiled JS).

Fallbacks:
- If svelte-check does not infer the `f !== null` type predicate in `outlines`, write
  `.filter((f): f is Frame => f !== null)` and import `type Frame` from `../tools/frame`.
- If the a11y check complains about `oncontextmenu` on the `role="application"` div, keep the
  handler and report the exact warning; do not suppress it with an ignore comment.

- [ ] **Step 4: Commit**

```bash
git add src/lib/Canvas.svelte src/lib/Overlay.svelte
git commit -m "feat(ui): route canvas pointers to tools; selection outlines, gizmo and marquee

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Tool strip, context bar, modifier dock, context menu, keyboard and layout

**Files:**
- Create: `src/lib/ToolStrip.svelte`, `src/lib/ContextBar.svelte`, `src/lib/ModifierDock.svelte`, `src/lib/ContextMenu.svelte`, `src/lib/NumberField.svelte`
- Modify: `src/App.svelte`, `src/lib/StatusBar.svelte`, `src/app.css`

**Interfaces:**
- Consumes: store fields and actions from Task 11; `TOOLS`; `findTopLevel`; `isIdentity`; `dockDown`, `dockUp`, `DockPress`; `editActionForKey`, `runEditAction`; `watchOtherTabs`.
- Produces:
  - `NumberField.svelte` props: `{ label: string; value: number | null; min?: number; max?: number; suffix?: string; onchange: (v: number) => void }`
    - `null` shows an empty field with a "–" placeholder (mixed values).
    - A change is committed on blur or Enter, clamped to [min, max]; an empty or invalid entry is dropped.
    - Escape reverts.
  - `ToolStrip.svelte`, `ContextBar.svelte`, `ModifierDock.svelte`, `ContextMenu.svelte`: no props.
  - `App.svelte` layout: TopBar / ContextBar / [ToolStrip | main (Canvas + ModifierDock) | right-panel slot for Task 14] / StatusBar.
  - Keyboard: Space held → `app.spaceHeld`; `commandForKey` first, then `editActionForKey` → `runEditAction`; nothing fires while a dialog, the confirm or the context menu is open, or a text field has focus; window blur releases Space.
  - Other-tab warning: an `error` notice (it stays until dismissed): "This editor is also open in another tab. Both tabs share one autosave — keep editing in one tab only."
  - `StatusBar.svelte` shows the active tool's hint and the selection count.

- [ ] **Step 1: Add component classes to `src/app.css`**

Inside the existing `@layer components { … }` block, add:

```css
  .tool-on {
    @apply bg-accent text-accent-text hover:bg-accent-hover;
  }
  .dock-on {
    @apply border-accent bg-accent text-accent-text;
  }
```

- [ ] **Step 2: Write `src/lib/NumberField.svelte`**

```svelte
<script lang="ts">
  let {
    label,
    value,
    min = -Infinity,
    max = Infinity,
    suffix = "",
    onchange,
  }: {
    label: string;
    value: number | null;
    min?: number;
    max?: number;
    suffix?: string;
    onchange: (v: number) => void;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  const shown = $derived(
    editing ? draft : value === null ? "" : String(Math.round(value * 100) / 100),
  );

  function commit() {
    editing = false;
    const v = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(v)) return;
    onchange(Math.min(max, Math.max(min, v)));
  }
</script>

<label class="flex items-center gap-1 text-xs">
  {#if label}<span class="text-muted">{label}</span>{/if}
  <input
    class="field w-16 tabular-nums"
    type="text"
    inputmode="decimal"
    value={shown}
    placeholder={value === null ? "–" : ""}
    onfocus={(e) => {
      draft = e.currentTarget.value;
      editing = true;
    }}
    oninput={(e) => (draft = e.currentTarget.value)}
    onkeydown={(e) => {
      if (e.key === "Enter") e.currentTarget.blur();
      if (e.key === "Escape") {
        editing = false;
        e.currentTarget.blur();
      }
    }}
    onblur={() => {
      if (editing) commit();
    }}
  />
  {#if suffix}<span class="text-muted">{suffix}</span>{/if}
</label>
```

- [ ] **Step 3: Write `src/lib/ToolStrip.svelte`**

```svelte
<script lang="ts">
  import { Circle, Hand, MousePointer2, Pentagon, Slash, Square } from "@lucide/svelte";
  import { app, setTool } from "../state/appState.svelte";
  import type { ToolId } from "../tools/types";

  const TOOL_BUTTONS: { id: ToolId; label: string; key: string; icon: typeof Square }[] = [
    { id: "select", label: "Select", key: "V", icon: MousePointer2 },
    { id: "rect", label: "Rectangle", key: "R", icon: Square },
    { id: "ellipse", label: "Ellipse", key: "E", icon: Circle },
    { id: "line", label: "Line", key: "L", icon: Slash },
    { id: "polygon", label: "Polygon / star", key: "Y", icon: Pentagon },
    { id: "hand", label: "Hand", key: "H", icon: Hand },
  ];
</script>

<nav
  class="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2"
  aria-label="Tools"
>
  {#each TOOL_BUTTONS as t (t.id)}
    <button
      class="icon-btn"
      class:tool-on={app.toolId === t.id}
      title="{t.label} ({t.key})"
      aria-label={t.label}
      aria-pressed={app.toolId === t.id}
      onclick={() => setTool(t.id)}
    >
      <t.icon size={18} />
    </button>
  {/each}
</nav>
```

If an icon name is not exported by `@lucide/svelte`, look it up under
`node_modules/@lucide/svelte/dist/icons/` and use the closest match. If `typeof Square` is
rejected as the icon type, use `Component<{ size?: number }>` from `svelte`.

- [ ] **Step 4: Write `src/lib/ContextBar.svelte`**

```svelte
<script lang="ts">
  import { Copy, Trash2 } from "@lucide/svelte";
  import type { Node, RectShape } from "../doc/document";
  import { findTopLevel } from "../doc/tree";
  import { isIdentity } from "../geom/mat";
  import {
    app,
    convertSelectionToPath,
    deleteSelection,
    duplicateSelection,
    flattenSelection,
    setPolygonPrefs,
    setSelectionRectRadius,
  } from "../state/appState.svelte";
  import { TOOLS } from "../tools/registry";
  import NumberField from "./NumberField.svelte";

  const nodes = $derived(
    app.selection
      .map((id) => findTopLevel(app.doc, id)?.node)
      .filter((n): n is Node => n !== undefined),
  );
  const canConvert = $derived(nodes.some((n) => n.kind === "rect" || n.kind === "ellipse"));
  const canFlatten = $derived(nodes.some((n) => n.kind === "path" && !isIdentity(n.transform)));
  const rects = $derived(nodes.filter((n): n is RectShape => n.kind === "rect"));
  const onlyRects = $derived(rects.length > 0 && rects.length === nodes.length);
  const radius = $derived(
    onlyRects && rects.every((r) => r.rx === rects[0].rx) ? rects[0].rx : null,
  );
  const poly = $derived(app.prefs.polygon);
</script>

<div
  class="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-panel px-3 text-xs"
>
  {#if app.toolId === "polygon"}
    <NumberField
      label="Sides"
      value={poly.sides}
      min={3}
      max={32}
      onchange={(v) => setPolygonPrefs({ sides: Math.round(v) })}
    />
    <label class="flex items-center gap-1">
      <input
        type="checkbox"
        checked={poly.star}
        onchange={(e) => setPolygonPrefs({ star: e.currentTarget.checked })}
      />
      Star
    </label>
    {#if poly.star}
      <NumberField
        label="Inner"
        value={Math.round(poly.innerRatio * 100)}
        min={10}
        max={95}
        suffix="%"
        onchange={(v) => setPolygonPrefs({ innerRatio: v / 100 })}
      />
    {/if}
  {:else if app.selection.length > 0}
    <span class="text-muted">{app.selection.length} selected</span>
    <button class="btn gap-1" onclick={deleteSelection}><Trash2 size={14} /> Delete</button>
    <button class="btn gap-1" onclick={duplicateSelection}><Copy size={14} /> Duplicate</button>
    {#if canConvert}
      <button class="btn" onclick={convertSelectionToPath}>Convert to path</button>
    {/if}
    {#if canFlatten}
      <button class="btn" onclick={flattenSelection}>Flatten transform</button>
    {/if}
    {#if onlyRects}
      <NumberField label="Radius" value={radius} min={0} onchange={setSelectionRectRadius} />
    {/if}
  {:else}
    <span class="truncate text-muted">{TOOLS[app.toolId].hint}</span>
  {/if}
</div>
```

- [ ] **Step 5: Write `src/lib/ModifierDock.svelte`**

```svelte
<script lang="ts">
  import { dockDown, dockUp, type DockPress } from "../input/dock";
  import { app, setDock, type DockState } from "../state/appState.svelte";

  const KEYS: readonly (keyof DockState)[] = ["shift", "alt"];
  const LABELS: Record<keyof DockState, string> = { shift: "Shift", alt: "Alt" };
  /** In-progress presses; not rendered, so not reactive. */
  const presses: Partial<Record<keyof DockState, DockPress>> = {};

  function down(key: keyof DockState, e: PointerEvent) {
    e.preventDefault();
    try {
      if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience here; the release still arrives on this button.
    }
    const r = dockDown(app.dock[key], performance.now());
    presses[key] = r.press;
    setDock(key, r.state);
  }

  function up(key: keyof DockState) {
    const press = presses[key];
    if (!press) return;
    delete presses[key];
    setDock(key, dockUp(press, performance.now()));
  }
</script>

<div
  class="absolute right-3 bottom-3 z-10 flex gap-1 rounded-lg border border-line bg-panel p-1 shadow-lg"
  role="toolbar"
  aria-label="Modifier keys"
>
  {#each KEYS as key (key)}
    <button
      class="h-10 w-14 rounded border border-line text-xs select-none"
      class:dock-on={app.dock[key] !== "off"}
      style="touch-action: none"
      aria-pressed={app.dock[key] !== "off"}
      title="Hold, or tap to lock, {LABELS[key]}"
      onpointerdown={(e) => down(key, e)}
      onpointerup={() => up(key)}
      onpointercancel={() => up(key)}
      onlostpointercapture={() => up(key)}
    >
      {LABELS[key]}
    </button>
  {/each}
</div>
```

- [ ] **Step 6: Write `src/lib/ContextMenu.svelte`**

```svelte
<script lang="ts">
  import {
    app,
    convertSelectionToPath,
    deleteSelection,
    duplicateSelection,
    flattenSelection,
  } from "../state/appState.svelte";

  function close() {
    app.contextMenu = null;
  }

  function run(action: () => void) {
    close();
    action();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && app.contextMenu) close();
  }}
/>

{#if app.contextMenu}
  <button
    class="fixed inset-0 z-40 cursor-default"
    aria-label="Close menu"
    tabindex="-1"
    onclick={close}
    oncontextmenu={(e) => {
      e.preventDefault();
      close();
    }}
  ></button>
  <div
    class="fixed z-50 w-52 rounded border border-line bg-panel py-1 shadow-lg"
    style="left: {app.contextMenu.x}px; top: {app.contextMenu.y}px"
    role="menu"
  >
    <button class="menu-item" role="menuitem" onclick={() => run(duplicateSelection)}>
      Duplicate <span class="kbd">⌘D</span>
    </button>
    <button class="menu-item" role="menuitem" onclick={() => run(convertSelectionToPath)}>
      Convert to path
    </button>
    <button class="menu-item" role="menuitem" onclick={() => run(flattenSelection)}>
      Flatten transform
    </button>
    <div class="my-1 h-px bg-line"></div>
    <button class="menu-item" role="menuitem" onclick={() => run(deleteSelection)}>
      Delete <span class="kbd">⌫</span>
    </button>
  </div>
{/if}
```

- [ ] **Step 7: Update `src/lib/StatusBar.svelte`**

Replace the static hint `<span>Drag to pan · pinch or ⌘/Ctrl + wheel to zoom</span>` with:

```svelte
  <span class="min-w-0 truncate">{TOOLS[app.toolId].hint}</span>
  {#if app.selection.length > 0}
    <span>{app.selection.length} selected</span>
  {/if}
```

and add `import { TOOLS } from "../tools/registry";` to its script.

- [ ] **Step 8: Update `src/App.svelte`**

Make these changes, keeping everything else (autosave effects, dialogs, notices) as it is.

1. **Imports:** add

```ts
  import ContextBar from "./lib/ContextBar.svelte";
  import ContextMenu from "./lib/ContextMenu.svelte";
  import ModifierDock from "./lib/ModifierDock.svelte";
  import ToolStrip from "./lib/ToolStrip.svelte";
  import { watchOtherTabs } from "./persist/tab-presence";
  import { runCommand, runEditAction } from "./state/commands";
  import { commandForKey, editActionForKey } from "./state/keys";
```

   These replace the existing `runCommand` and `commandForKey` import lines; don't add a second import of either.

2. **Other-tab warning:** extend the existing `onMount` so it also starts the watcher and returns its stop function:

```ts
  onMount(() => {
    void restoreAutosave().then((ok) => (autosaveEnabled = ok));
    return watchOtherTabs(() =>
      notify(
        "error",
        "This editor is also open in another tab. Both tabs share one autosave — keep editing in one tab only.",
      ),
    );
  });
```

3. **Keyboard:** replace `onkeydown` and add `onkeyup` / `onblur`:

```ts
  function onkeydown(e: KeyboardEvent) {
    // Modals and menus own the keyboard (they handle Escape themselves).
    if (app.dialog || app.confirm || app.contextMenu || isEditable(e.target)) return;
    if (e.key === " ") {
      e.preventDefault();
      app.spaceHeld = true;
      return;
    }
    const cmd = commandForKey(e);
    if (cmd) {
      e.preventDefault();
      runCommand(cmd);
      return;
    }
    const action = editActionForKey(e);
    if (action) {
      e.preventDefault();
      runEditAction(action);
    }
  }

  function onkeyup(e: KeyboardEvent) {
    if (e.key === " ") app.spaceHeld = false;
  }
```

   and change the window binding to
   `<svelte:window {onkeydown} {onkeyup} onblur={() => (app.spaceHeld = false)} />`.

4. **Layout:** replace the main layout block with:

```svelte
<div class="flex h-full flex-col">
  <TopBar />
  <ContextBar />
  <div class="flex min-h-0 flex-1">
    <ToolStrip />
    <main class="relative min-w-0 flex-1">
      <Canvas oncursor={(p) => (cursor = p)} />
      <ModifierDock />
    </main>
  </div>
  <StatusBar {cursor} />
</div>

<ContextMenu />
```

- [ ] **Step 9: Verify**

Run: `npm run build && npm run lint && npm test`.
Expected: 0 errors, 0 warnings; lint silent; all tests pass.

Then run the dev-server compile check for these files: `/src/App.svelte`,
`/src/lib/ToolStrip.svelte`, `/src/lib/ContextBar.svelte`, `/src/lib/ModifierDock.svelte`,
`/src/lib/ContextMenu.svelte`, `/src/lib/NumberField.svelte`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/ToolStrip.svelte src/lib/ContextBar.svelte src/lib/ModifierDock.svelte src/lib/ContextMenu.svelte src/lib/NumberField.svelte src/lib/StatusBar.svelte src/App.svelte src/app.css
git commit -m "feat(ui): tool strip, context bar, modifier dock, context menu and edit keys

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Properties panel

**Files:**
- Create: `src/state/properties.ts`, `src/lib/PaintField.svelte`, `src/lib/PropertiesPanel.svelte`
- Modify: `src/state/appState.svelte.ts` (append `applyGeometry`), `src/App.svelte`, `src/lib/TopBar.svelte`
- Test: `src/__tests__/properties.test.ts`

**Interfaces:**
- Consumes: `findTopLevel`, `shapesOf`; `translateNodes`, `rotateNodes`; `resizeNodes`; `selectionBounds`, `selectionFrame`, `frameCenter`, `frameResizeMap`; `normalizeAngle`; `NumberField`; store actions.
- Produces:
  - `properties.ts`:
    - `type Field<T> = { mixed: true } | { mixed: false; value: T }`
    - `type StyleSummary = { fill: Field<Paint | null>; stroke: Field<Paint | null>; strokeWidth: Field<number>; cap: Field<LineCap>; join: Field<LineJoin>; opacity: Field<number> }`
    - `summarizeStyles(styles: readonly Style[]): StyleSummary | null` (paints compared by value)
    - `selectionStyles(doc, ids): Style[]` (shapes inside groups included)
    - `type Geometry = { x; y; w; h; r }` (r in degrees, (−180, 180]); `type GeometryField = keyof Geometry`
    - `selectionGeometry(doc, ids): Geometry | null` (x/y = doc-space bounds top-left; w/h = frame box size; r = frame angle)
    - `applyGeometryField(doc, ids, field, value): Doc` (spec §6: x/y translate; w/h resize the frame box keeping its top-left — no-op for value ≤ 0 or a zero-size axis; r rotates about the frame centre to the angle; non-finite or unchanged (within 1e-9) → same doc)
  - `appState.svelte.ts`: `applyGeometry(field: GeometryField, value: number): void`
  - `PaintField.svelte` props: `{ label: string; field: Field<Paint | null>; fallback: Paint; onchange: (p: Paint | null) => void }`
  - `PropertiesPanel.svelte`: no props. With a selection it edits the selection; with none it edits the default style for new shapes. Geometry is shown only with a selection.
  - Layout: at ≥ 900 px the panel is docked on the right. Below that it is a drawer over the canvas, toggled by a TopBar button that is hidden at ≥ 900 px.

- [ ] **Step 1: Write the failing test** — `src/__tests__/properties.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Node,
  type RectShape,
  type Style,
} from "../doc/document";
import { applyMat, IDENTITY, rotateAbout, type Mat } from "../geom/mat";
import {
  applyGeometryField,
  selectionGeometry,
  selectionStyles,
  summarizeStyles,
} from "../state/properties";
import { deepFreeze } from "./helpers";

const rect = (id: string, x: number, y: number, w: number, h: number, style: Style = DEFAULT_STYLE, t: Mat = IDENTITY): RectShape => ({
  kind: "rect",
  id,
  transform: t,
  style,
  x,
  y,
  w,
  h,
  rx: 0,
});

const doc = (...children: Node[]): Doc =>
  deepFreeze({
    ...createDoc(200, 200),
    layers: [{ id: "L", name: "L", visible: true, locked: false, children }],
  });

const get = (d: Doc, id: string) => d.layers[0].children.find((n) => n.id === id)!;

describe("style summary", () => {
  it("reports shared values and mixed ones", () => {
    expect(summarizeStyles([])).toBeNull();
    const one = summarizeStyles([DEFAULT_STYLE])!;
    expect(one.fill).toEqual({ mixed: false, value: DEFAULT_STYLE.fill });
    expect(one.strokeWidth).toEqual({ mixed: false, value: 1 });
    const other: Style = { ...DEFAULT_STYLE, fill: null, stroke: { ...DEFAULT_STYLE.stroke! } };
    const two = summarizeStyles([DEFAULT_STYLE, other])!;
    expect(two.fill).toEqual({ mixed: true });
    expect(two.stroke).toEqual({ mixed: false, value: DEFAULT_STYLE.stroke });
    expect(two.cap).toEqual({ mixed: false, value: "butt" });
  });

  it("collects styles from shapes inside groups", () => {
    const d = doc(rect("a", 0, 0, 10, 10), {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [rect("b", 0, 0, 1, 1), rect("c", 0, 0, 1, 1)],
    });
    expect(selectionStyles(d, ["a", "g", "zz"])).toHaveLength(3);
  });
});

describe("geometry fields", () => {
  const d = doc(rect("a", 10, 20, 30, 40));

  it("summarises position, size and rotation", () => {
    expect(selectionGeometry(d, ["a"])).toEqual({ x: 10, y: 20, w: 30, h: 40, r: 0 });
    expect(selectionGeometry(d, [])).toBeNull();
    const rotated = doc(rect("r", 0, 0, 10, 20, DEFAULT_STYLE, rotateAbout(Math.PI / 6, { x: 5, y: 10 })));
    const g = selectionGeometry(rotated, ["r"])!;
    expect(g.r).toBeCloseTo(30);
    expect(g.w).toBeCloseTo(10);
    expect(g.h).toBeCloseTo(20);
  });

  it("moves with X and Y", () => {
    const moved = applyGeometryField(d, ["a"], "x", 15);
    expect(applyMat(get(moved, "a").transform, { x: 0, y: 0 })).toEqual({ x: 5, y: 0 });
    expect(selectionGeometry(applyGeometryField(d, ["a"], "y", 0), ["a"])!.y).toBe(0);
    expect(applyGeometryField(d, ["a"], "x", 10)).toBe(d);
  });

  it("resizes with W and H, keeping the top-left", () => {
    expect(get(applyGeometryField(d, ["a"], "w", 60), "a")).toMatchObject({ x: 10, y: 20, w: 60, h: 40 });
    expect(get(applyGeometryField(d, ["a"], "h", 10), "a")).toMatchObject({ x: 10, y: 20, w: 30, h: 10 });
    expect(applyGeometryField(d, ["a"], "h", 0)).toBe(d);
    expect(applyGeometryField(d, ["a"], "h", -5)).toBe(d);
    expect(applyGeometryField(d, ["a"], "w", Number.NaN)).toBe(d);
    expect(applyGeometryField(d, ["a"], "w", 30)).toBe(d);
  });

  it("rotates to an angle about the frame centre", () => {
    const r = applyGeometryField(d, ["a"], "r", 90);
    const corner = applyMat(get(r, "a").transform, { x: 10, y: 20 });
    expect(corner.x).toBeCloseTo(45);
    expect(corner.y).toBeCloseTo(25);
    expect(selectionGeometry(r, ["a"])!.r).toBeCloseTo(90);
    expect(applyGeometryField(d, ["a"], "r", 0)).toBe(d);
    expect(applyGeometryField(d, [], "r", 45)).toBe(d);
  });
});
```

Hand-checks:
- **Rotation about the frame centre.** The centre of (10, 20, 30, 40) is (25, 40). The corner (10, 20) is (−15, −20) from it; rotating that by 90° gives (20, −15), which lands at (45, 25).
- **Width with the top-left kept.** `boxMap((10,20,30,40) → (10,20,60,40))` maps x to 2x − 10. So the left edge 10 stays at 10 and the right edge 40 moves to 70.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/properties.test.ts`
Expected: FAIL — cannot resolve `../state/properties`.

- [ ] **Step 3: Implement** — `src/state/properties.ts`

```ts
import type { Doc, LineCap, LineJoin, Paint, Style } from "../doc/document";
import { rotateNodes, translateNodes } from "../doc/edits";
import { resizeNodes } from "../doc/resize";
import { findTopLevel, shapesOf } from "../doc/tree";
import { frameCenter, frameResizeMap, selectionBounds, selectionFrame } from "../tools/frame";
import { normalizeAngle } from "../tools/gizmo";

export type Field<T> = { mixed: true } | { mixed: false; value: T };

export type StyleSummary = {
  fill: Field<Paint | null>;
  stroke: Field<Paint | null>;
  strokeWidth: Field<number>;
  cap: Field<LineCap>;
  join: Field<LineJoin>;
  opacity: Field<number>;
};

export type Geometry = { x: number; y: number; w: number; h: number; r: number };
export type GeometryField = keyof Geometry;

const EPS = 1e-9;

function samePaint(a: Paint | null, b: Paint | null): boolean {
  if (a === null || b === null) return a === b;
  return a.color === b.color && a.opacity === b.opacity;
}

function merge<T>(values: readonly T[], eq: (a: T, b: T) => boolean = (a, b) => a === b): Field<T> {
  const first = values[0];
  return values.every((v) => eq(v, first)) ? { mixed: false, value: first } : { mixed: true };
}

export function summarizeStyles(styles: readonly Style[]): StyleSummary | null {
  if (styles.length === 0) return null;
  return {
    fill: merge(
      styles.map((s) => s.fill),
      samePaint,
    ),
    stroke: merge(
      styles.map((s) => s.stroke),
      samePaint,
    ),
    strokeWidth: merge(styles.map((s) => s.strokeWidth)),
    cap: merge(styles.map((s) => s.cap)),
    join: merge(styles.map((s) => s.join)),
    opacity: merge(styles.map((s) => s.opacity)),
  };
}

export function selectionStyles(doc: Doc, ids: readonly string[]): Style[] {
  return ids.flatMap((id) => {
    const f = findTopLevel(doc, id);
    return f ? shapesOf(f.node).map((s) => s.style) : [];
  });
}

export function selectionGeometry(doc: Doc, ids: readonly string[]): Geometry | null {
  const b = selectionBounds(doc, ids);
  const f = selectionFrame(doc, ids);
  if (!b || !f) return null;
  return { x: b.x, y: b.y, w: f.box.w, h: f.box.h, r: (normalizeAngle(f.angle) * 180) / Math.PI };
}

export function applyGeometryField(
  doc: Doc,
  ids: readonly string[],
  field: GeometryField,
  value: number,
): Doc {
  if (!Number.isFinite(value)) return doc;
  if (field === "x" || field === "y") {
    const b = selectionBounds(doc, ids);
    if (!b) return doc;
    const d = value - (field === "x" ? b.x : b.y);
    if (Math.abs(d) < EPS) return doc;
    return field === "x" ? translateNodes(doc, ids, d, 0) : translateNodes(doc, ids, 0, d);
  }
  const f = selectionFrame(doc, ids);
  if (!f) return doc;
  if (field === "r") {
    const delta = normalizeAngle((value * Math.PI) / 180 - f.angle);
    if (Math.abs(delta) < EPS) return doc;
    return rotateNodes(doc, ids, delta, frameCenter(f));
  }
  const current = field === "w" ? f.box.w : f.box.h;
  if (value <= 0 || current === 0 || Math.abs(value - current) < EPS) return doc;
  const to = field === "w" ? { ...f.box, w: value } : { ...f.box, h: value };
  return resizeNodes(doc, ids, frameResizeMap(f.angle, f.box, to));
}
```

Append to `src/state/appState.svelte.ts` (and add `import { applyGeometryField, type GeometryField } from "./properties";` to its imports):

```ts
export function applyGeometry(field: GeometryField, value: number): void {
  commitDoc(applyGeometryField(app.doc, app.selection, field, value));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/properties.test.ts`, then `npm test`.
Expected: PASS (6 tests); the full suite passes.

- [ ] **Step 5: Write `src/lib/PaintField.svelte`**

```svelte
<script lang="ts">
  import type { Paint } from "../doc/document";
  import type { Field } from "../state/properties";
  import NumberField from "./NumberField.svelte";

  let {
    label,
    field,
    fallback,
    onchange,
  }: {
    label: string;
    field: Field<Paint | null>;
    fallback: Paint;
    onchange: (p: Paint | null) => void;
  } = $props();

  const paint = $derived(field.mixed ? null : field.value);
  let hexDraft = $state<string | null>(null);

  function setColor(raw: string) {
    const hex = (raw.startsWith("#") ? raw : `#${raw}`).trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) return;
    onchange({ color: hex, opacity: paint?.opacity ?? fallback.opacity });
  }
</script>

<div class="flex flex-col gap-1">
  <div class="flex items-center justify-between">
    <span class="font-semibold">{label}</span>
    <label class="flex items-center gap-1 text-muted">
      <input
        type="checkbox"
        checked={paint !== null}
        onchange={(e) => onchange(e.currentTarget.checked ? (paint ?? fallback) : null)}
      />
      {field.mixed ? "mixed" : paint ? "on" : "none"}
    </label>
  </div>
  {#if paint}
    <div class="flex items-center gap-2">
      <input
        type="color"
        class="h-8 w-10 cursor-pointer rounded border border-line bg-ground"
        value={paint.color}
        aria-label="{label} colour"
        onchange={(e) => setColor(e.currentTarget.value)}
      />
      <input
        class="field w-20 font-mono"
        aria-label="{label} hex"
        value={hexDraft ?? paint.color}
        oninput={(e) => (hexDraft = e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            hexDraft = null;
            e.currentTarget.blur();
          }
        }}
        onblur={() => {
          if (hexDraft !== null) setColor(hexDraft);
          hexDraft = null;
        }}
      />
      <NumberField
        label=""
        value={Math.round(paint.opacity * 100)}
        min={0}
        max={100}
        suffix="%"
        onchange={(v) => onchange({ ...paint, opacity: v / 100 })}
      />
    </div>
  {/if}
</div>
```

- [ ] **Step 6: Write `src/lib/PropertiesPanel.svelte`**

```svelte
<script lang="ts">
  import type { LineCap, LineJoin, Paint } from "../doc/document";
  import { app, applyGeometry, setSelectionStyle } from "../state/appState.svelte";
  import {
    selectionGeometry,
    selectionStyles,
    summarizeStyles,
    type Field,
    type GeometryField,
  } from "../state/properties";
  import NumberField from "./NumberField.svelte";
  import PaintField from "./PaintField.svelte";

  const FILL_FALLBACK: Paint = { color: "#d9d9d9", opacity: 1 };
  const STROKE_FALLBACK: Paint = { color: "#000000", opacity: 1 };
  const GEOMETRY: { field: GeometryField; label: string; min?: number; suffix?: string }[] = [
    { field: "x", label: "X" },
    { field: "y", label: "Y" },
    { field: "w", label: "W", min: 0.01 },
    { field: "h", label: "H", min: 0.01 },
    { field: "r", label: "R", suffix: "°" },
  ];

  const hasSelection = $derived(app.selection.length > 0);
  const summary = $derived(
    summarizeStyles(hasSelection ? selectionStyles(app.doc, app.selection) : [app.prefs.style]),
  );
  const geometry = $derived(hasSelection ? selectionGeometry(app.doc, app.selection) : null);
  const value = <T,>(f: Field<T>): T | null => (f.mixed ? null : f.value);
</script>

<aside
  class="flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-panel p-3 text-xs"
  aria-label="Properties"
>
  <h2 class="font-semibold text-muted">
    {hasSelection ? "Selection" : "Defaults for new shapes"}
  </h2>

  {#if summary}
    <PaintField
      label="Fill"
      field={summary.fill}
      fallback={app.prefs.style.fill ?? FILL_FALLBACK}
      onchange={(p) => setSelectionStyle({ fill: p })}
    />
    <PaintField
      label="Stroke"
      field={summary.stroke}
      fallback={app.prefs.style.stroke ?? STROKE_FALLBACK}
      onchange={(p) => setSelectionStyle({ stroke: p })}
    />
    <div class="flex flex-wrap items-center gap-2">
      <NumberField
        label="Width"
        value={value(summary.strokeWidth)}
        min={0}
        max={1000}
        onchange={(v) => setSelectionStyle({ strokeWidth: v })}
      />
      <label class="flex items-center gap-1">
        <span class="text-muted">Cap</span>
        <select
          class="field"
          value={value(summary.cap) ?? ""}
          onchange={(e) => setSelectionStyle({ cap: e.currentTarget.value as LineCap })}
        >
          <option value="" disabled>mixed</option>
          <option value="butt">butt</option>
          <option value="round">round</option>
          <option value="square">square</option>
        </select>
      </label>
      <label class="flex items-center gap-1">
        <span class="text-muted">Join</span>
        <select
          class="field"
          value={value(summary.join) ?? ""}
          onchange={(e) => setSelectionStyle({ join: e.currentTarget.value as LineJoin })}
        >
          <option value="" disabled>mixed</option>
          <option value="miter">miter</option>
          <option value="round">round</option>
          <option value="bevel">bevel</option>
        </select>
      </label>
    </div>
    <NumberField
      label="Opacity"
      value={summary.opacity.mixed ? null : Math.round(summary.opacity.value * 100)}
      min={0}
      max={100}
      suffix="%"
      onchange={(v) => setSelectionStyle({ opacity: v / 100 })}
    />
  {/if}

  {#if geometry}
    <div class="flex flex-col gap-2 border-t border-line pt-3">
      <span class="font-semibold">Geometry</span>
      <div class="grid grid-cols-2 gap-2">
        {#each GEOMETRY as g (g.field)}
          <NumberField
            label={g.label}
            value={geometry[g.field]}
            min={g.min}
            suffix={g.suffix}
            onchange={(v) => applyGeometry(g.field, v)}
          />
        {/each}
      </div>
    </div>
  {/if}
</aside>
```

Notes:
- **Fallback colours.** `FILL_FALLBACK` and `STROKE_FALLBACK` are the model's default *artwork* colours (the same values as `DEFAULT_STYLE`), not UI chrome. You may import `DEFAULT_STYLE` and use `DEFAULT_STYLE.fill!` / `DEFAULT_STYLE.stroke!` instead.
- **`<T,>` generic in the Svelte script.** If svelte-check rejects it, write a non-generic helper per type: `numValue(f: Field<number>): number | null`, and read `summary.cap.mixed ? "" : summary.cap.value` inline.
- **Optional props.** `min={g.min}` passes `undefined` when the field has no minimum. If svelte-check complains, give `NumberField`'s props `min?: number | undefined` and `suffix?: string | undefined` and keep the defaults.

- [ ] **Step 7: Mount the panel and the drawer toggle**

In `src/App.svelte`, import `PropertiesPanel` and change the middle row to:

```svelte
  <div class="flex min-h-0 flex-1">
    <ToolStrip />
    <main class="relative min-w-0 flex-1">
      <Canvas oncursor={(p) => (cursor = p)} />
      <ModifierDock />
      {#if app.propertiesOpen}
        <div class="absolute inset-y-0 right-0 z-20 flex shadow-xl min-[900px]:hidden">
          <PropertiesPanel />
        </div>
      {/if}
    </main>
    <div class="hidden min-[900px]:flex">
      <PropertiesPanel />
    </div>
  </div>
```

In `src/lib/TopBar.svelte`:
- add `SlidersHorizontal` to the `@lucide/svelte` import;
- insert this button as the first child of the right-hand `ml-auto` group:

```svelte
    <button
      class="icon-btn min-[900px]:hidden"
      aria-label="Properties"
      aria-pressed={app.propertiesOpen}
      title="Properties"
      onclick={() => (app.propertiesOpen = !app.propertiesOpen)}
    >
      <SlidersHorizontal size={18} />
    </button>
```

- [ ] **Step 8: Verify**

Run: `npm run build && npm run lint && npm test`.
Expected: 0 errors, 0 warnings; lint silent; all tests pass.

Then run the dev-server compile check for `/src/App.svelte`, `/src/lib/PropertiesPanel.svelte`,
`/src/lib/PaintField.svelte` and `/src/lib/TopBar.svelte`.

- [ ] **Step 9: Commit**

```bash
git add src/state/properties.ts src/state/appState.svelte.ts src/lib/PaintField.svelte src/lib/PropertiesPanel.svelte src/App.svelte src/lib/TopBar.svelte src/__tests__/properties.test.ts
git commit -m "feat(ui): properties panel for style and geometry, with a drawer on narrow screens

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Docs and final verification

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/CHANGELOG.md`

**Interfaces:**
- Consumes: everything above, and the controller's browser-pass notes (the controller passes their path in the dispatch).
- Produces: up-to-date handoff docs.

- [ ] **Step 1: Measure**

Run: `npm test`, and note the exact test and file counts it prints.

- [ ] **Step 2: Update `CLAUDE.md`**

- **Commands:** update the test count.
- **Architecture map:** add
  - `geom/box.ts`, `bezier.ts`, `bounds.ts`, `hit.ts`
  - `doc/tree.ts`, `doc/resize.ts`
  - `tools/` (`types`, `tool`, `frame`, `gizmo`, `shape-tools`, `select`, `registry`, `context`)
  - `input/route.ts`, `input/dock.ts`
  - `persist/preferences.ts`, `persist/tab-presence.ts`
  - `state/properties.ts`
  - the new `lib/` components
- **Invariants and gotchas:** append these four entries, one line or two each, using the next free numbers.
  - **Resize bakes scale into geometry** (spec M2a §1). Move and rotate only touch the matrix. Never "simplify" resize into a matrix multiply: strokes would scale.
  - **Tools never import the store.** They use `ToolContext` (`tools/context.ts` for the app, `__tests__/fake-context.ts` for tests). This is what makes them unit-testable.
  - **Every session change goes through `setSession`,** which prunes the selection. Don't assign `app.session` directly anywhere else.
  - **Handles on tiny objects cover the whole shape.** Reach is 6/10 px from the handle centre, and corners take priority. Tests use 40×40 shapes for this reason.
- **Current state:** milestone 2a (select/transform/shapes/properties). Milestone 2b is clipboard + snapping.
- **Roadmap:** remove the "two tabs share one autosave" item (done: warning). Keep the M4/M5 items.

- [ ] **Step 3: Update `README.md`**

- **Status / features:**
  - drawing rectangles, ellipses, lines, polygons and stars;
  - selecting (click, Shift, drag-select), moving, resizing (strokes keep their width), rotating (Shift snaps to 15°) and Alt-duplicating;
  - the properties panel (fill, stroke, width, cap, join, opacity, X/Y/W/H/rotation), with defaults for new shapes;
  - convert to path and flatten transform;
  - the on-screen Shift/Alt pad for touch.
- **Keyboard table:** add V R E L Y H (tools), Space (pan), Delete/Backspace, Esc, arrows / Shift+arrows (nudge 1/10), ⌘D (duplicate).
- **Test count:** update it.
- **Roadmap:** next is clipboard and snapping, then layers and groups, then pen and node editing.

- [ ] **Step 4: Append to `docs/superpowers/CHANGELOG.md`**

A dated section, `## 2026-09-16 — Milestone 2a: select, transform, shapes`, with bullets for:
- geometry (bounds, hit-testing, marquee);
- edits and the resize model;
- the tools and the gizmo;
- pointer routing (right-click menu, lost capture, Pencil-finger policy);
- the modifier dock;
- the properties panel with the narrow-screen drawer;
- preferences;
- the other-tab warning.

Add the plan and spec paths, a **Browser-verified** line copied from the controller's notes (claim nothing beyond them), and an **Owed** line: touch/Pencil/iPad; dock behaviour on touch; the drawer on a real narrow device.

- [ ] **Step 5: Final verification**

Run: `npm run build && npm run lint && npm test && npm run format:check`.
Expected: 0 errors, 0 warnings; lint silent; all tests pass; formatting clean (run `npm run format` first if needed, and commit its changes here).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md docs/superpowers/CHANGELOG.md
git commit -m "docs: milestone 2a handoff notes, README and changelog

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Do not merge, push or deploy. Hand over to superpowers:finishing-a-development-branch.

---

## Browser pass (controller, after Task 14, before Task 15)

In desktop Chrome against the dev server, check each item and record the results.

1. **Drawing:** draw one of each shape (rect, ellipse, line, polygon, star). Shift and Alt should behave as specified. Each shape is selected after it is drawn. Undo removes exactly one shape per step.
2. **Selecting:** tap, Shift-tap, drag-select, and Shift+drag-select to add.
3. **Moving:** plain drag; Shift-constrained drag; Alt-duplicate drag.
4. **Resizing:**
   - by a corner, by an edge, and dragged past the opposite side to flip;
   - a rotated rect stays a rect, and its stroke width is unchanged;
   - a multi-selection that includes a rotated rect makes that rect a path.
5. **Rotating** with the knob; Shift snaps to 15°.
6. **Keyboard:** arrow nudges, Delete, ⌘D, Esc; tool keys; Space-drag pans.
7. **Context bar:** Delete, Duplicate, Convert to path, Flatten, rect radius; polygon sides and star options.
8. **Right-click menu:** it opens on the object under the pointer, and each action works.
9. **Properties panel:**
   - fill and stroke: toggle, colour, hex, opacity;
   - stroke width, cap, join, object opacity;
   - X/Y/W/H/R, including mixed values (blank fields);
   - with nothing selected it edits the defaults, and they survive a reload.
10. **Modifier dock:** Shift latched makes a drag draw a square; a long press releases the latch.
11. **Narrow window:** at less than 900 px wide, the properties panel is hidden and the TopBar toggle opens the drawer.
12. **Save and reopen:** drawn shapes survive Save As followed by reopening, with the same geometry and styles.
13. **Two tabs:** a second tab shows the shared-autosave warning in both tabs.
14. **Console:** no errors.
