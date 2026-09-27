# M14 Envelope Warp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Warp tool (W) that bends the selection through a 12-point Coons-patch cage and bakes the result into plain paths, gradients following along.

**Architecture:** Pure maths in `src/geom/warp.ts` (cage, patch map, cubic refit); a pure document edit in `src/doc/warp-edit.ts` (`warpNodes`, `warpStyle`, `droppedLive`, `warpRefusal`); two new optional `Tool` hooks (`activate`, `settle`) wired through the store like `registerToolFinish`; the tool in `src/tools/warp-tool.ts`, drawing its cage through a new `Overlay` variant.

**Tech Stack:** Svelte 5, TypeScript, Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-20-m14-envelope-warp-design.md` — **§0 (amendments, 2026-09-28) overrides the older sections.** Subdivide is NOT part of this milestone.

## Global Constraints

- Document immutability; an edit that changes nothing returns the SAME reference (invariant 1). An identity cage → `warpNodes` returns `doc` itself.
- The warp bakes geometry; every node's `transform` is untouched (invariants 11, 26). A singular world matrix leaves that node alone.
- Rect/ellipse/polygon go through `toPath` (`src/geom/shapes.ts`); a path with `text` goes through `withBakedSubpaths` (`src/doc/document.ts`) — never clear `text` by hand (invariant 40).
- Gradients follow the warp via `warpStyle`: own-space points go `local —M→ world —S→ world′ —M⁻¹→ local′`; results pass through `flatIfDegenerate`; `mid`/`midPaint` ride along; same style object back when neither paint is a gradient.
- No subpath with fewer than two nodes; a closed subpath's last node never repeats its first (invariant 30).
- `WARP_TOL = max(1e-4, max(B.w, B.h) × 1e-4)`; refit depth cap 6.
- Tools never import the store (invariant 12). Every recompute runs against the session `base`, never the current document (invariant 15).
- Overlay marks use the halo snippets (`lineHalo`, `knobHalo`) in `Overlay.svelte`.
- Titles follow invariant 24 (title = status-bar hint, shortcut in parentheses).
- Build bar: `npm run build` 0 errors 0 warnings; `npm test` green; `npm run lint` clean.
- Commit trailer, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Controller rulings already made (binding on the tasks)

1. **A store edit during a warp session commits the warp first** (as a tool change does), through a new `Tool.settle` hook the store calls from `cancelActiveGesture()` and from `setSelection` when the selection changes. Discarding the warp instead would lose work silently.
2. **The gesture bracket opens lazily** — on the first handle drag of a cage, not on activation — and closes on Enter/settle/Escape. Between warps no bracket is open, so ordinary store actions behave as today.
3. **Activation with an empty or degenerate selection stays in the Warp tool** with an info notice (spec §5 said fall back to select). A click on an object in the Warp tool selects it and seeds a cage (the Gradient tool's click-to-select behaviour); a click on empty canvas clears the selection. Spec §5's fallback was written before the Gradient tool established in-tool selection.
4. **Dragging a corner carries its two adjacent edge handles by the same delta** (Illustrator's behaviour); dragging a handle moves it alone. Shift constrains to 45°: a handle about its corner, a corner about where the drag started.
5. **No small-object handle padding** for the cage (spec §5 cited `gizmo.ts`'s padding): reach is `pointerTolerance(pointerType) / zoom`, corners before handles, nearest wins within each group.
6. **`constrain45` consolidation is minimal**: export `constrain45(pivot: Vec, p: Vec): Vec` from `tools/shape-tools.ts`; the Gradient tool's local `constrain` and the Warp tool use it. `pen.ts` and `select.ts` return axes too, a different signature — left alone.

## Review Focus

1. **A perspective drag adds no nodes**: a rectangle under a straight-edged cage comes back as four straight segments (`in`/`out` null), four nodes. Task 1.
2. **Identity is exact**: pressing W and Enter without a drag changes nothing and adds no undo step; `warpNodes` with an identity cage returns the same doc. Tasks 2, 4.
3. **A closed subpath stays well-formed** after a curved warp: no duplicate closing node, node 0's `in` from the wrap segment. Task 1.
4. **A mid-warp store edit (e.g. a fill colour) keeps the warp** and is its own undo step after the warp's. Task 4.
5. **Gradients move with the shape** and a gradient-free document keeps its style references. Task 2.

---

### Task 1: `src/geom/warp.ts` — cage, patch map, refit

**Files:**
- Create: `src/geom/warp.ts`
- Test: `src/__tests__/warp-geom.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Edge = readonly [Vec, Vec];
  export type Cage = {
    corners: readonly [Vec, Vec, Vec, Vec];   // P00 TL, P10 TR, P11 BR, P01 BL
    edges: readonly [Edge, Edge, Edge, Edge]; // Top P00→P10, Right P10→P11, Bottom P01→P11, Left P00→P01
  };
  export function identityCage(box: Box): Cage;
  export function isIdentityCage(cage: Cage, box: Box): boolean;
  export function warpTolerance(box: Box): number;          // max(1e-4, max(w,h)·1e-4)
  export function warpPoint(cage: Cage, box: Box, q: Vec): Vec;
  export function cubicThrough4(q0: Vec, q1: Vec, q2: Vec, q3: Vec): Cubic;
  export function warpSubpaths(subpaths: readonly Subpath[], world: Mat, cage: Cage, box: Box): Subpath[];
  export function edgeCubic(cage: Cage, i: 0 | 1 | 2 | 3): Cubic;  // for drawing and for the patch
  ```
  `warpSubpaths` expects `world` invertible (callers check); it maps local points through `world`, warps, fits in world′ space, and maps the fitted control points back through `invert(world)`.

**Maths (verbatim from spec §2, §4):**
- `u = (q.x − B.x)/B.w`, `v = (q.y − B.y)/B.h`.
- `S(u,v) = (1−v)·Top(u) + v·Bottom(u) + (1−u)·Left(v) + u·Right(v) − [(1−u)(1−v)P00 + u(1−v)P10 + (1−u)v·P01 + uv·P11]`, where `Top(u) = cubicPoint([P00, top[0], top[1], P10], u)` etc.
- `identityCage(B)`: corners at the box corners; each edge's handles at ⅓ and ⅔ along the straight edge in the edge's own direction. `isIdentityCage` compares every coordinate of the cage to `identityCage(box)` with `===`.
- `cubicThrough4`: `P₀=Q₀; P₁=(−5Q₀+18Q₁−9Q₂+2Q₃)/6; P₂=(2Q₀−9Q₁+18Q₂−5Q₃)/6; P₃=Q₃`.
- Per segment (a straight segment — both handles null — is the cubic `[a, a+(b−a)/3, a+2(b−a)/3, b]`): the world cubic `C` = local cubic mapped by `world`. `fit(C, depth)`: `Q_k = S(C(t_k))` for `t = 0, ⅓, ⅔, 1`; `F = cubicThrough4(Q…)`; error = max over `t = ⅙, ½, ⅚` of `|S(C(t)) − F(t)|`; if error > tol and depth < 6 → `splitCubic(C, 0.5)` and recurse both halves at depth+1, concatenating; else `[F]`.
- A fitted piece is emitted **straight** (`out`/`in` null) when `|P₁ − lerp(P₀,P₃,⅓)|` and `|P₂ − lerp(P₀,P₃,⅔)|` are both ≤ `tol × 1e-3`.
- Node types from the output handles: both handles present, `cross(out−p, p−in)` within `1e-6·|out−p|·|p−in|` and `dot(out−p, p−in) > 0` → `symmetric` if lengths equal within `1e-6·max` else `smooth`; otherwise `corner`.
- Assembly: open subpath of n nodes → first node, then each segment's pieces append nodes (the previous node's `out` = piece `P₁`, the new node's `in` = piece `P₂`, `p` = piece `P₃`). Closed subpath: also fit the wrap segment (last → node 0); its final piece's end is node 0, so set node 0's `in` from it and do NOT append a duplicate node. Handles and points map back to local through `invert(world)` (affine, exact).

- [ ] **Step 1: Write the failing tests** — `src/__tests__/warp-geom.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PathNode, Subpath } from "../doc/document";
import { cubicPoint } from "../geom/bezier";
import { IDENTITY, translate } from "../geom/mat";
import {
  cubicThrough4,
  identityCage,
  isIdentityCage,
  warpPoint,
  warpSubpaths,
  warpTolerance,
  type Cage,
} from "../geom/warp";

const box = { x: 0, y: 0, w: 100, h: 50 };
const node = (x: number, y: number, extra: Partial<PathNode> = {}): PathNode => ({
  p: { x, y },
  in: null,
  out: null,
  type: "corner",
  ...extra,
});
const rectSub = (): Subpath => ({
  closed: true,
  nodes: [node(0, 0), node(100, 0), node(100, 50), node(0, 50)],
});
/** A straight-edged perspective cage: the right edge pulled in. */
function perspective(): Cage {
  const c = identityCage(box);
  const P10 = { x: 100, y: 10 };
  const P11 = { x: 100, y: 40 };
  const third = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const [P00, , , P01] = c.corners;
  return {
    corners: [P00, P10, P11, P01],
    edges: [
      [third(P00, P10, 1 / 3), third(P00, P10, 2 / 3)],
      [third(P10, P11, 1 / 3), third(P10, P11, 2 / 3)],
      [third(P01, P11, 1 / 3), third(P01, P11, 2 / 3)],
      c.edges[3],
    ],
  };
}
/** A curved cage: the top edge bowed upwards. */
function bowed(): Cage {
  const c = identityCage(box);
  return { ...c, edges: [[{ x: 33, y: -30 }, { x: 67, y: -30 }], c.edges[1], c.edges[2], c.edges[3]] };
}

describe("warp geometry (spec M14 §2, §4)", () => {
  it("an identity cage maps points to themselves", () => {
    const c = identityCage(box);
    expect(isIdentityCage(c, box)).toBe(true);
    for (const q of [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 37, y: 12 },
      { x: 50, y: 0 },
    ]) {
      const w = warpPoint(c, box, q);
      expect(w.x).toBeCloseTo(q.x, 9);
      expect(w.y).toBeCloseTo(q.y, 9);
    }
  });

  it("cubicThrough4 recovers a cubic from its own samples", () => {
    const c = [
      { x: 0, y: 0 },
      { x: 10, y: 40 },
      { x: 60, y: -20 },
      { x: 90, y: 10 },
    ] as const;
    const f = cubicThrough4(cubicPoint(c, 0), cubicPoint(c, 1 / 3), cubicPoint(c, 2 / 3), cubicPoint(c, 1));
    for (let i = 0; i < 4; i++) {
      expect(f[i].x).toBeCloseTo(c[i].x, 9);
      expect(f[i].y).toBeCloseTo(c[i].y, 9);
    }
  });

  it("a rectangle in perspective stays four straight segments (Review Focus 1)", () => {
    const [sp] = warpSubpaths([rectSub()], IDENTITY, perspective(), box);
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(4);
    for (const n of sp.nodes) {
      expect(n.in).toBeNull();
      expect(n.out).toBeNull();
    }
    expect(sp.nodes[1].p.y).toBeCloseTo(10, 9);
    expect(sp.nodes[2].p.y).toBeCloseTo(40, 9);
  });

  it("a diagonal straight segment under a straight cage fits exactly with no subdivision", () => {
    const sp: Subpath = { closed: false, nodes: [node(0, 0), node(100, 50)] };
    const [out] = warpSubpaths([sp], IDENTITY, perspective(), box);
    expect(out.nodes).toHaveLength(2);
  });

  it("a curved cage: the refit stays within tolerance and respects the depth cap", () => {
    const sp: Subpath = { closed: false, nodes: [node(0, 0), node(100, 0)] };
    const cage = bowed();
    const [out] = warpSubpaths([sp], IDENTITY, cage, box);
    expect(out.nodes.length).toBeGreaterThan(1);
    expect(out.nodes.length).toBeLessThanOrEqual(65);
    const tol = warpTolerance(box);
    // Sample the true warped line and the output path at matching arc positions: every output
    // node lies on the true curve within tolerance.
    for (const n of out.nodes) {
      const truth = warpPoint(cage, box, { x: n.p.x, y: 0 });
      // n.p is a warped point; find its pre-image on y=0 by its u (the top edge maps u monotonically in x here).
      expect(Math.abs(truth.y - n.p.y)).toBeLessThanOrEqual(Math.max(tol, 1e-6) + 1e-9 + Math.abs(truth.x - n.p.x) * 10);
    }
  });

  it("a closed subpath's wrap segment is warped and node 0's in comes from it (Review Focus 3)", () => {
    const [sp] = warpSubpaths([rectSub()], IDENTITY, bowed(), box);
    expect(sp.closed).toBe(true);
    const first = sp.nodes[0];
    const last = sp.nodes[sp.nodes.length - 1];
    expect(last.p.x === first.p.x && last.p.y === first.p.y).toBe(false);
    // The bowed top edge is the segment 0 → 1, so node 0 gains an `out` handle.
    expect(first.out).not.toBeNull();
  });

  it("maps through the world matrix and back", () => {
    const sp: Subpath = { closed: false, nodes: [node(-10, 0), node(90, 0)] };
    const [out] = warpSubpaths([sp], translate(10, 0), identityCage(box), box);
    expect(out.nodes[0].p.x).toBeCloseTo(-10, 9);
    expect(out.nodes[1].p.x).toBeCloseTo(90, 9);
  });

  it("recomputes node types: a junction introduced by subdivision is smooth", () => {
    const sp: Subpath = { closed: false, nodes: [node(0, 0), node(100, 0)] };
    const [out] = warpSubpaths([sp], IDENTITY, bowed(), box);
    const inner = out.nodes.slice(1, -1);
    expect(inner.length).toBeGreaterThan(0);
    for (const n of inner) expect(["smooth", "symmetric"]).toContain(n.type);
  });
});
```

(The curved-cage test's tolerance check is deliberately loose about pre-images; if you find a cleaner exact check — e.g. sampling the original line at the parameters where subdivision placed each node — use it, keeping the assertion "within `warpTolerance`".)

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/__tests__/warp-geom.test.ts` → module not found.
- [ ] **Step 3: Implement `src/geom/warp.ts`** per the Maths block. Reuse `cubicPoint`, `splitCubic`, `type Cubic` from `./bezier`, `applyMat`, `invert`, `type Mat` from `./mat`, `type Box` from `./box`, `type Vec` from `./vec`, `PathNode`/`Subpath`/`NodeType` types from `../doc/document`. Doc-comment each export with the spec section it implements.
- [ ] **Step 4: Run tests** → PASS; then `npm test && npx tsc --noEmit && npm run lint`.
- [ ] **Step 5: Commit** — `feat(M14): warp geometry — Coons cage, patch map, cubic refit` with the trailer.

---

### Task 2: `src/doc/warp-edit.ts` — warpNodes, warpStyle, droppedLive, warpRefusal

**Files:**
- Create: `src/doc/warp-edit.ts`
- Test: `src/__tests__/warp-edit.test.ts`

**Interfaces:**
- Consumes (Task 1): `Cage`, `isIdentityCage`, `warpPoint`, `warpSubpaths`.
- Produces:
  ```ts
  export function warpNodes(doc: Doc, ids: readonly string[], cage: Cage, box: Box): Doc;
  export function warpStyle(style: Style, world: Mat, cage: Cage, box: Box): Style;
  export function droppedLive(before: Doc, after: Doc, ids: readonly string[]): string | null;
  export function warpRefusal(doc: Doc, ids: readonly string[]): string | null;
  ```

**Behaviour:**
- `warpNodes`: `isIdentityCage(cage, box)` → return `doc`. Otherwise `mapNodes(doc, ids, (n, parent) => warpNode(n, parent))` where `warpNode` computes `world = multiply(parent, n.transform)`; singular `world` → return `n`; a group recurses into children with `world` as their parent (children's transforms untouched; return the same group object when no child changed); a rect/ellipse/polygon → `toPath(n)` first; a path → `withBakedSubpaths(p, warpSubpaths(p.subpaths, world, cage, box))` (this drops `text`); the style → `warpStyle(n.style, world, cage, box)`.
- `warpStyle`: same object back if neither `fill` nor `stroke` is a gradient. Otherwise map each gradient's own-space points `p ↦ applyMat(inv, warpPoint(cage, box, applyMat(world, p)))` (`inv = invert(world)`, non-null because the caller checked) — linear `from`/`to`, radial `center`/`a`/`b` — keeping every other field (`start`, `end`, `mid`, `midPaint`) via spread, then `flatIfDegenerate`.
- `droppedLive(before, after, ids)`: walk the selected nodes (groups descended, via `findNode` + the same leaf walk the tree helpers use) in `before`; for each leaf id count: a `polygon` in `before` that is a `path` in `after` → polygons; `rect` → rectangles; `ellipse` → ellipses; a `path` with `text` in `before` whose `after` has no `text` → titles. Build `"Warped — 2 polygons and a title are now ordinary paths."` — counts joined with ", " and a final " and ", singular with "a"/"an" (`a polygon`, `a rectangle`, `an ellipse`, `a title`), plural with the number; `"is now an ordinary path"` when the total is 1, else `"are now ordinary paths"`. Return `null` when nothing counted.
- `warpRefusal`: empty `ids` → `"Warp — select something to warp"`; `selectionBounds(doc, ids)` (from `src/tools/frame.ts` — if importing from `tools/` into `doc/` is disallowed by the codebase's layering, move nothing: compute the union with `nodeBounds` from `src/geom/bounds.ts` over `findNode` results the same way `selectionBounds` does) null, or `w <= 0` or `h <= 0` → `"Warp — select something with width and height"`; else `null`.

- [ ] **Step 1: Write the failing tests** — `src/__tests__/warp-edit.test.ts`, covering (write them in the style of `src/__tests__/gradient-bake.test.ts`, building small docs with `createDoc`):
  1. identity cage → `toBe(doc)` (Review Focus 2).
  2. a rect warped by a non-identity cage becomes a `path` with the same `id`, `transform` and `name`, and a polygon loses its polygon-ness (kind `path`).
  3. a group with a transform: children warped, group and child `transform`s `toBe`-identical to before (invariant 26).
  4. a node with a singular world matrix (transform `[0,0,0,0,5,5]`) is returned as-is (`toBe`).
  5. a title (a path with `text`) comes back without `text`; `droppedLive` returns `"Warped — a title is now an ordinary path."`.
  6. `droppedLive` over two polygons, a rect and a title → `"Warped — 2 polygons, a rectangle and a title are now ordinary paths."`; over plain paths only → `null`.
  7. `warpStyle`: a flat style returns the same object (Review Focus 5); a linear gradient's `from`/`to` move exactly as `warpPoint` moves them (identity world); `mid`/`midPaint` preserved; a radial's three points move; a gradient on a translated node maps through the matrix and back.
  8. `warpRefusal`: empty → the empty message; a single horizontal line (zero height) → the width-and-height message; a rect → `null`.
  9. every subpath of a warped shape has ≥ 2 nodes (tripwire, invariant 30).
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** `src/doc/warp-edit.ts` with doc comments citing spec §0.3, §3, §6.
- [ ] **Step 4: Run** `npx vitest run src/__tests__/warp-edit.test.ts`, then `npm test && npx tsc --noEmit && npm run lint`.
- [ ] **Step 5: Commit** — `feat(M14): warp document edit — warpNodes, gradients follow, droppedLive`.

---

### Task 3: Tool plumbing — `activate`/`settle` hooks, `constrain45`, the cage overlay type

**Files:**
- Modify: `src/tools/tool.ts` (`Tool.activate?`, `Tool.settle?`; `Overlay` gains `{ kind: "cage"; cage: Cage }`)
- Modify: `src/state/appState.svelte.ts` (`registerToolActivate`, `registerToolSettle`; call sites)
- Modify: `src/tools/context.ts` (register both)
- Modify: `src/tools/shape-tools.ts` (export `constrain45`), `src/tools/gradient-tool.ts` (use it)
- Test: `src/__tests__/tool-hooks.test.ts` (new)

**Interfaces:**
- Produces: `Tool.activate?(ctx: ToolContext): void` — called when the tool becomes active. `Tool.settle?(ctx: ToolContext): void` — "something outside the tool is about to edit the document or change the selection: commit whatever session you hold". Store: `registerToolActivate(fn: (() => void) | null)`, `registerToolSettle(fn: (() => void) | null)`. `constrain45(pivot: Vec, p: Vec): Vec` (rotate `p` about `pivot` to the nearest 45°, keeping distance).

**Behaviour:**
- `setTool(id)`: after its existing body (toolId set, overlay and hoverCursor cleared), call `toolActivate?.()` — last, so an activate hook that itself calls `setTool` wins cleanly.
- `cancelActiveGesture()`: after the existing drag-cancel call, call `toolSettle?.()`.
- `setSelection(ids)`: when the pruned selection differs from before (`app.selection !== before`, the existing check), call `toolSettle?.()` **after** assigning the new selection.
- `context.ts`: `registerToolActivate(() => TOOLS[app.toolId].activate?.(storeContext));` and `registerToolSettle(() => TOOLS[app.toolId].settle?.(storeContext));` beside the existing `registerToolFinish`/`registerToolDiscard`, each with a one-line comment citing spec M14 §5 and the plan's ruling 1.
- Doc-comment both new `Tool` members (spec M14 §5, ruling 1/2), in the style of the existing `discard`/`hover` comments.
- `gradient-tool.ts`'s local `constrain(pivot, p, on)` becomes `on ? constrain45(pivot, p) : p` at its call sites (delete the local function); behaviour unchanged — its tests must still pass untouched.

- [ ] **Step 1: Failing tests** — `src/__tests__/tool-hooks.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import {
  cancelActiveGesture,
  registerToolActivate,
  registerToolSettle,
  replaceDocument,
  setSelection,
  setTool,
} from "../state/appState.svelte";
import { constrain45 } from "../tools/shape-tools";

const rect = (id: string): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rx: 0,
});
const doc = (): Doc => {
  const d = createDoc(100, 100);
  return { ...d, layers: [{ ...d.layers[0], children: [rect("a"), rect("b")] }] };
};

describe("tool hooks (spec M14 §5, plan rulings 1–2)", () => {
  afterEach(() => {
    registerToolActivate(null);
    registerToolSettle(null);
    setTool("select");
  });

  it("setTool calls the activate hook after switching", () => {
    let seen = "";
    registerToolActivate(() => (seen = "called"));
    setTool("gradient");
    expect(seen).toBe("called");
  });

  it("cancelActiveGesture and a selection change call the settle hook", () => {
    replaceDocument(doc(), "t.svg", null, true);
    let n = 0;
    registerToolSettle(() => n++);
    cancelActiveGesture();
    expect(n).toBe(1);
    setSelection(["a"]);
    expect(n).toBe(2);
    setSelection(["a"]);
    expect(n).toBe(2);
  });

  it("constrain45 rotates about the pivot to the nearest 45°, keeping distance", () => {
    const p = constrain45({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.x).toBeCloseTo(Math.hypot(10, 1), 9);
    expect(p.y).toBeCloseTo(0, 9);
  });
});
```

(Match `replaceDocument`'s real argument order — check its signature; `replaceDocument` itself calls `cancelActiveGesture`, so register the settle hook AFTER it as written.)

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** per Behaviour. Add the `cage` variant to `Overlay` (import `type Cage` from `../geom/warp`); `Overlay.svelte` doesn't draw it yet (Task 4).
- [ ] **Step 4: Run** the new file, then `npm test && npm run build && npm run lint`.
- [ ] **Step 5: Commit** — `feat(M14): tool activate/settle hooks, shared constrain45`.

---

### Task 4: The Warp tool — cage interaction, drawing, strip button, shortcut

**Files:**
- Create: `src/tools/warp-tool.ts`, `src/tools/cage-handles.ts`
- Modify: `src/tools/types.ts` (`ToolId` gains `"warp"`), `src/tools/registry.ts`, `src/state/keys.ts` (`w: "warp"` in `TOOL_KEYS`), `src/lib/ToolStrip.svelte` (button `{ id: "warp", label: "Warp", key: "W", icon: Grid2x2 }` after Gradient — import `Grid2x2` from `@lucide/svelte`), `src/lib/Overlay.svelte` (draw the cage)
- Test: `src/__tests__/warp-tool.test.ts`, and extend the keys test if one maps `TOOL_KEYS`

**Interfaces:**
- Consumes: Tasks 1–3 (`identityCage`, `isIdentityCage`, `edgeCubic`, `Cage`; `warpNodes`, `droppedLive`, `warpRefusal`; `Tool.activate/settle`; `constrain45`; `Overlay` `cage` variant).
- Produces: `cage-handles.ts`: `export type CagePart = { kind: "corner"; i: 0|1|2|3 } | { kind: "handle"; edge: 0|1|2|3; j: 0|1 }`; `export function pickCage(cage: Cage, p: Vec, tol: number): CagePart | null` (corners first, nearest within tol; then handles, nearest); `export function moveCagePart(cage: Cage, part: CagePart, to: Vec, from: Vec): Cage` (corner: moves the corner and its two adjacent edges' near handles by `to − from`; handle: sets that handle to `to`). Corner adjacency: P00 (0) → Top handle 0, Left handle 0; P10 (1) → Top handle 1, Right handle 0; P11 (2) → Right handle 1, Bottom handle 1; P01 (3) → Bottom handle 0, Left handle 1.

**Tool state (closure):** `session: { ids: readonly string[]; box: Box; cage: Cage; base: Doc | null /* non-null while the bracket is open */ } | null`, and `drag: { part: CagePart; start: Vec; startCage: Cage } | null`.

**Behaviour** (spec §5 as amended by the rulings above):
- `seed(ctx)`: `refusal = warpRefusal(ctx.doc(), ctx.selection())`; refusal → `session = null`, `ctx.setOverlay(null)`, and when the selection is non-empty `ctx.notify("info", refusal)`; else `session = { ids, box: selectionBounds(doc, ids)!, cage: identityCage(box), base: null }` and `ctx.setOverlay({ kind: "cage", cage })`.
- `activate(ctx)`: `seed(ctx)`; with an empty selection also `ctx.notify("info", "Warp — select something to warp")`.
- `down(ctx, e)`: `tol = pointerTolerance(e.pointerType) / ctx.view().zoom`; `ctx.setHoverCursor(null)`. If a session exists and `pickCage(session.cage, e.doc, tol)` hits → if `session.base === null` { `session.base = ctx.doc()`; `ctx.beginGesture()` }; `drag = { part, start: e.doc, startCage: session.cage }`. Otherwise (no hit): `settle(ctx)`; then `hitTest(ctx.doc(), e.doc, tol, ctx.enteredGroupId())` → `ctx.setSelection(hit ? [hit.nodeId] : [])` (this re-enters `settle` through the store hook, which re-seeds — make `settle` re-seed from the current selection so this works without special-casing).
- `move(ctx, e)`: with a drag: `to = e.mods.shift ? constrain45(pivot, e.doc) : e.doc` where pivot is the handle's corner (handle drag) or `drag.start` (corner drag); `session.cage = moveCagePart(drag.startCage, drag.part, to, drag.start)`; `ctx.setOverlay({ kind: "cage", cage: session.cage })`; `ctx.commit(warpNodes(session.base!, session.ids, session.cage, session.box))`.
- `up(ctx, e)`: `move(ctx, e)` then `drag = null` (the cage and bracket stay).
- `cancel(ctx)`: `drag = null` only — keep the cage (a palm, not a decision).
- `settle(ctx)` (Enter, the store hook, a tool change via Enter): if `session?.base` { `before = session.base`; `ctx.endGesture()`; `msg = droppedLive(before, ctx.doc(), session.ids)`; `if (msg) ctx.notify("info", msg)` }; `drag = null`; then `seed(ctx)` (re-seeds an identity cage on the new bounds, or clears when the selection is empty/degenerate).
- `keydown(ctx, key)`: `"enter"` → `settle(ctx)`, return true. `"escape"` → if `session?.base` { `ctx.commit(session.base)`; `ctx.endGesture()` }; `session = null`; `drag = null`; `ctx.setOverlay(null)`; `ctx.setTool("select")`; return true. `"backspace"` → return false.
- `busy()`: `session !== null`.
- `discard(ctx)`: `session = null`; `drag = null`; `ctx.setOverlay(null)` — the store already ended any bracket via `settle` from `cancelActiveGesture` before it calls `discard`.
- `hover(ctx, e)`: `ctx.setHoverCursor(session && pickCage(session.cage, e.doc, tol) ? "move" : null)`.
- `hint`: `"Drag a corner or handle to bend the selection · Enter to apply · Esc to cancel · Shift: 45°"`; `cursor: "crosshair"`.

**Overlay** (`Overlay.svelte`): `const cage = $derived(app.overlay?.kind === "cage" ? app.overlay.cage : null)`. Draw, in screen space (`docToScreen(view, …)`): each of the four edges as a polyline of 32 samples of `edgeCubic(cage, i)` (`lineHalo` then `LINE`); a leader line from each corner to each of its two adjacent handles (`lineHalo` then `LINE`); each handle as a circle `r = knobSize / 2 - 1` (`knobHalo` then `KNOB`); each corner as a square of side `knobSize` (`knobHalo` then `SELECTED_KNOB`). Corners last, so they draw on top (they win picks too).

- [ ] **Step 1: Failing tests** — `src/__tests__/warp-tool.test.ts` using `fakeContext` and `ev` from `./fake-context` (read that file first; the fake's `beginGesture`/`endGesture`/`commit` mirror the store's session, and `state.session.history.past.length` counts undo steps — confirm the field name there). Cover:
  1. `activate` with one rect selected seeds a cage (`state.overlay.kind === "cage"`), no commit, no open gesture.
  2. `activate` with nothing selected → notice, no cage, `busy()` false; with a zero-height line selected → the width-and-height notice.
  3. dragging the BR corner commits a warped document computed from the base (the rect becomes a path whose corner moved); a second drag of another corner still computes from the ORIGINAL base (the result equals `warpNodes(base, ids, cageAfterBothDrags, box)`).
  4. Enter after two drags → exactly ONE new undo step; a notice naming the rectangle; a fresh identity cage on the new bounds (Review Focus 2's counterpart: Enter with no drag → zero undo steps, no notice, same doc reference).
  5. Escape after a drag → the document is `toBe` the base, no undo step, tool set to `"select"`, overlay cleared.
  6. `cancel()` mid-drag keeps the cage (`busy()` true, overlay still a cage).
  7. `settle` after a drag commits exactly as Enter does (the store-edit path, Review Focus 4 at tool level).
  8. `pickCage`: a press on a corner beats a coincident handle; `moveCagePart` on corner 2 moves Right handle 1 and Bottom handle 1 by the same delta and nothing else.
  9. a press away from the cage on another shape selects it (`state.selection` becomes `[thatId]`) — and, since the fake context has no store hook, call `tool.settle(ctx)` yourself if the fake does not re-enter; assert the new cage's box matches the new shape.
  10. `hover` over a corner sets `"move"`; elsewhere `null`.
  And in the keys test (find it: `grep -rl "TOOL_KEYS\|toolForKey\|editActionForKey" src/__tests__`), `w` → `{ kind: "tool", tool: "warp" }`.

Also add a store-level test to `src/__tests__/tool-hooks.test.ts` (Review Focus 4): with the REAL store — import `../tools/context` so the hooks are registered — select a rect, `setTool("warp")`, drive the tool through `TOOLS.warp.down/move/up(storeContext, ev(...))` to drag a corner, then call `setSelectionStyle({ fill: { color: "#00ff00", opacity: 1 } })`: the rect is now a warped path AND green; `undo()` once → still warped, old colour; `undo()` again → the original rect.

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** `cage-handles.ts`, `warp-tool.ts`, register it, `ToolId`, `TOOL_KEYS`, `ToolStrip`, `Overlay`. Doc-comment the tool's behaviour table in the file header (spec §5 + rulings), in the style of `pen.ts`/`gradient-tool.ts`.
- [ ] **Step 4: Run** `npx vitest run src/__tests__/warp-tool.test.ts src/__tests__/tool-hooks.test.ts`, then `npm test && npm run build && npm run lint`. Confirm the build still emits exactly the three chunks (app, `paper-core`, `opentype`).
- [ ] **Step 5: Commit** — `feat(M14): the Warp tool — cage drag, Enter/Escape, W`.

---

### Task 5: Docs

**Files:** `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`.

- [ ] **Step 1: README** — add a **Warp** bullet among the tools: select, press W (or the strip's grid icon), drag the four corners or eight handles to bend everything selected through one cage; Enter applies (one undo step), Esc cancels; Shift snaps a drag to 45°; the result is ordinary paths (polygons, rectangles, ellipses and titles stop being live, and a notice says which); gradients move with the shape; a heavy warp adds nodes that Path ▸ Simplify can shed. Add W to the shortcuts table. Update the `npm test` count.
- [ ] **Step 2: CLAUDE.md** — architecture map: `geom/warp.ts`, `doc/warp-edit.ts`, `tools/warp-tool.ts` + `cage-handles.ts`, the `activate`/`settle` hooks in `tool.ts`/`context.ts`, `constrain45` in `shape-tools.ts`; a new invariant (next number) for the warp: a non-affine bake site — `toPath` + `withBakedSubpaths`, transforms untouched, `warpStyle` instead of `mapStyle` (gradients follow the warp point-wise; invariant 46's rule adapted), every recompute from `base`, the lazy gesture bracket, `settle` committing a session before any store edit or selection change; and in invariant 46's list of bake sites, name `warp-edit.ts`'s `warpStyle` as the non-affine exception. Current state: M14 done; next candidates are the accessibility and performance groups. Roadmap: M14 complete. Commands: test count.
- [ ] **Step 3: CHANGELOG** — append a dated M14 entry (what shipped, spec §0 amendments, the plan's six rulings, browser verification from the controller's check file, what is owed: iPad pass, Safari, performance on large selections, autosave mid-warp).
- [ ] **Step 4: Commit** — `docs(M14): README, CLAUDE.md and changelog`.
