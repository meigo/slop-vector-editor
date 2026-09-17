# Milestone 2c — Live Polygons and Stars — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polygons and stars stay editable after drawing (Sides, Star, Inner ratio), through move/rotate/resize/flip, convert to path, copy/paste, save and reopen.

**Architecture:**
- **Model:** a new `polygon` shape kind (centre, x/y radii, sides, star, inner ratio). Rotation lives in the transform.
- **Geometry:** one generator, `polygonSubpath`, feeds bounds, hit-testing, convert-to-path and the SVG writer.
- **File format:** the writer emits a normal `<path>` plus `data-sv-polygon`, with `d` built from the numbers as written. The importer rebuilds a polygon only when the attribute is valid and the regenerated `d` equals the file's `d`.
- **Resize:** baked into the parameters, with a half-turn for vertical flips of odd polygons.
- **UI:** the context bar edits selected polygons through a new `setPolygon` edit.

**Tech Stack:** Svelte 5 (runes), TypeScript 5.9 strict, Vite 8, Tailwind 4, Vitest 4 (node env), `@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-09-17-m2c-live-polygon-design.md` (binding). It extends the M2a/M2b specs and the v1 spec.

## Global Constraints

- **Checks:**
  - `npm run build` (= `svelte-check && tsc --noEmit && vite build`) must end with **0 errors, 0 warnings**.
  - `npm run lint` is silent; `npm test` all passes; `npm run format:check` is clean.
  - Plan code blocks are not Prettier-formatted: run `npx prettier --write` on touched files before committing.
- **Tests:** Vitest runs in node with no DOM, so only pure logic is unit-tested. UI tasks are gated by the build and a dev-server compile check; the controller runs the real browser pass.
- **tsconfig:** `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums, no namespaces, no constructor parameter properties).
- **Immutability:** the document is immutable; an edit that changes nothing returns the same reference. No edit creates empty groups, zero-size shapes or node-less paths.
- **Tools and store:** tools never import the store; they use `ToolContext`. Every document-editing store action calls `cancelActiveGesture()` first (CLAUDE.md gotcha #15).
- **Polygon ranges:** `sides` is an integer 3–32; `innerRatio` is 0.1–0.95 (constants `MIN_SIDES`, `MAX_SIDES`, `MIN_INNER`, `MAX_INNER` in `doc/document.ts`). Corner 0 points up (angle −π/2).
- **Resize:** baked into geometry; stroke widths never scale (CLAUDE.md gotcha #11).
- **Canvas and export** share `src/svg/attrs.ts` (gotcha #3). The importer never throws on unsupported content (gotcha #4). A polygon attribute that doesn't check out imports as a plain path, with nothing added to `dropped`.
- **Existing tests** keep their expected values. The only exceptions are tests of the removed `polygonPath`/`starPath` helpers and of the old polygon tool output: the plan replaces those explicitly.
- **Hand-computed numbers:** if a test disagrees with the code, trace the input first and report. Tasks 1–5 were dry-run against `main` 460db5d in a throwaway worktree: 269 tests pass (246 + 23), build 0 errors / 0 warnings, lint clean.
- **Commit trailer** on every commit, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Git:** branch `m2c-live-polygon` off `main`; one commit per task; merge only when the user says so.
- **Browser checks** run on a separate dev server port (e.g. 5198), never on the user's `:5173`, whose autosave holds a real document.

## File map

```
src/doc/document.ts          + PolygonShape, Shape union, MIN_SIDES/MAX_SIDES/MIN_INNER/MAX_INNER
src/geom/shapes.ts           + PolygonGeometry, polygonSubpath; toPath accepts polygons; − polygonPath/starPath (Task 4)
src/geom/bounds.ts           polygon bounds
src/geom/hit.ts              polygon hit-testing
src/doc/resize.ts            polygon resize (stretch, flips)
src/svg/attrs.ts             + polygonD, polygonAttr; polygon written as <path data-sv-polygon>
src/svg/parse.ts             + parsePolygonAttr; <path data-sv-polygon> → polygon when intact
src/doc/edits.ts             + PolygonPatch, setPolygon; convertToPath includes polygons
src/state/properties.ts      canConvert includes polygons; + PolygonSummary, summarizePolygons
src/tools/shape-tools.ts     polygon tool creates polygon shapes
src/state/appState.svelte.ts + setSelectionPolygon
src/lib/ContextBar.svelte    Sides / Star / Inner for selected polygons
CLAUDE.md, README.md, docs/superpowers/CHANGELOG.md
```

---

### Task 1: Polygon shape kind: model, geometry, resize, writing

**Files:**
- Modify: `src/doc/document.ts`, `src/geom/shapes.ts`, `src/geom/bounds.ts`, `src/geom/hit.ts`, `src/doc/resize.ts`, `src/svg/attrs.ts`
- Test: `src/__tests__/shapes.test.ts`, `src/__tests__/bounds.test.ts`, `src/__tests__/hit.test.ts`, `src/__tests__/resize.test.ts`, `src/__tests__/serialize.test.ts` (all extended)

Adding `PolygonShape` to the `Shape` union makes every exhaustive `switch` on shape kind fail to compile. That is why the model, geometry, resize and the writer go in one task.

**Interfaces:**
- Produces:
  - `document.ts`:
    - `PolygonShape = ShapeBase & { kind: "polygon"; cx; cy; rx; ry; sides; star: boolean; innerRatio }`
    - `Shape = RectShape | EllipseShape | PolygonShape | PathShape`
    - `MIN_SIDES = 3`, `MAX_SIDES = 32`, `MIN_INNER = 0.1`, `MAX_INNER = 0.95`
  - `shapes.ts`:
    - `type PolygonGeometry = Pick<PolygonShape, "cx" | "cy" | "rx" | "ry" | "sides" | "star" | "innerRatio">`
    - `polygonSubpath(p: PolygonGeometry): Subpath`
    - `toPath(s: RectShape | EllipseShape | PolygonShape): PathShape`
  - `attrs.ts`:
    - `polygonD(p: PolygonGeometry): string` (d from the numbers rounded as `fmt` writes them)
    - `polygonAttr(p: PolygonGeometry): string`
    - `shapeAttrs` for a polygon returns `{ tag: "path", attrs: { d, "data-sv-nodes", "data-sv-polygon", ...transform/name/style } }`
  - `resizeNode`/`resizeNodes` handle polygons (spec §4).

- [ ] **Step 1: Create the branch**

```bash
cd /Users/meigo/Projects/slop/slop-vector-editor
git checkout -b m2c-live-polygon
```

- [ ] **Step 2: Write the failing tests**

`src/__tests__/shapes.test.ts`:
- Add `type PolygonShape` to the `../doc/document` import.
- Add `polygonSubpath` to the `../geom/shapes` import.
- Append:

```ts
describe("polygonSubpath", () => {
  const poly = (over: Partial<PolygonShape> = {}): PolygonShape => ({
    kind: "polygon",
    id: "p",
    transform: translate(0, 0),
    style: DEFAULT_STYLE,
    cx: 0,
    cy: 0,
    rx: 10,
    ry: 10,
    sides: 5,
    star: false,
    innerRatio: 0.5,
    ...over,
  });

  it("puts corner 0 at the top and walks clockwise on screen", () => {
    const sp = polygonSubpath(poly());
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(5);
    expect(sp.nodes.every((n) => n.type === "corner" && !n.in && !n.out)).toBe(true);
    closeTo(sp.nodes[0].p, 0, -10);
    const a = -Math.PI / 2 + (2 * Math.PI) / 5;
    closeTo(sp.nodes[1].p, 10 * Math.cos(a), 10 * Math.sin(a));
  });

  it("interleaves a star's inner corners and uses both radii", () => {
    const sp = polygonSubpath(poly({ rx: 10, ry: 20, sides: 4, star: true, innerRatio: 0.5 }));
    expect(sp.nodes).toHaveLength(8);
    closeTo(sp.nodes[0].p, 0, -20);
    closeTo(sp.nodes[1].p, 5 * Math.SQRT1_2, -10 * Math.SQRT1_2);
    closeTo(sp.nodes[2].p, 10, 0);
    closeTo(sp.nodes[4].p, 0, 20);
    closeTo(sp.nodes[6].p, -10, 0);
  });

  it("converts to a path with the same identity, transform and style", () => {
    const p = poly({ name: "Star", transform: translate(3, 4), star: true, sides: 3 });
    const path = toPath(p);
    expect(path).toMatchObject({ kind: "path", id: "p", name: "Star", style: DEFAULT_STYLE });
    expect(path.transform).toBe(p.transform);
    expect(path.subpaths).toEqual([polygonSubpath(p)]);
  });
});
```

`src/__tests__/bounds.test.ts` — add this test inside the existing top-level `describe` that holds the `nodeBounds` tests. If there is none, append it as its own `describe("polygon bounds", …)`:

```ts
  it("bounds a polygon by its corners", () => {
    const p: Node = {
      kind: "polygon",
      id: "p",
      transform: translate(5, 5),
      style: DEFAULT_STYLE,
      cx: 0,
      cy: 0,
      rx: 10,
      ry: 10,
      sides: 5,
      star: false,
      innerRatio: 0.5,
    };
    const b = nodeBounds(p, IDENTITY)!;
    expect(b.x).toBeCloseTo(5 - 10 * Math.cos(Math.PI / 10));
    expect(b.y).toBeCloseTo(-5);
    expect(b.w).toBeCloseTo(20 * Math.cos(Math.PI / 10));
    expect(b.h).toBeCloseTo(10 + 10 * Math.cos(Math.PI / 5));
  });
```

The pentagon's widest corners are at ±18° from horizontal, so the half-width is 10·cos 18°. The lowest corners are at 54° below horizontal, so the bottom is 10·sin 54° = 10·cos 36°.

`src/__tests__/hit.test.ts` — append:

```ts
describe("polygon hit-testing", () => {
  const star = (style: Style): Node => ({
    kind: "polygon",
    id: "s",
    transform: IDENTITY,
    style,
    cx: 50,
    cy: 50,
    rx: 20,
    ry: 20,
    sides: 4,
    star: true,
    innerRatio: 0.25,
  });

  it("hits a filled polygon inside, not in the notch between points", () => {
    const d = doc({ children: [star(filled)] });
    expect(hitTest(d, { x: 50, y: 50 }, 1)?.nodeId).toBe("s");
    expect(hitTest(d, { x: 50, y: 35 }, 1)?.nodeId).toBe("s");
    // (62, 38) lies between the top and right points, outside the inner corner at (53.5, 46.5)
    expect(hitTest(d, { x: 62, y: 38 }, 1)).toBeNull();
  });

  it("hits an outline-only polygon near its edge only", () => {
    const d = doc({ children: [star(outlineOnly)] });
    expect(hitTest(d, { x: 50, y: 50 }, 1)).toBeNull();
    expect(hitTest(d, { x: 50, y: 31 }, 1)?.nodeId).toBe("s");
  });
});
```

Hand-check:
- The star's points are at (50, 30), (70, 50), (50, 70), (30, 50). The inner corners are at radius 5 on the diagonals: (53.54, 46.46) and so on.
- (50, 35) is on the axis inside the top point: it lies between the point (50, 30) and the centre. Filled → hit.
- (62, 38): the edges near it run from the top point (50, 30) to the inner corner (53.54, 46.46), and from there to the right point (70, 50). The notch is the region beyond those edges. The distance from (62, 38) to the segment (53.54, 46.46)–(70, 50) is about 9, and to the segment (50, 30)–(53.54, 46.46) about 10. Both are well over tolerance 1 (the filled style has no stroke). Miss.
- Outline only (strokeWidth 4, so reach = 1 + 2 = 3): the centre is 5 or more from every edge → miss. (50, 31) is 1 from the top point → hit.

`src/__tests__/resize.test.ts`:
- Add `type PolygonShape` to the document import.
- Add `applyMat` to the `../geom/mat` import.
- Add `polygonSubpath` to the `../geom/shapes` import.
- Append:

```ts
describe("polygon resize", () => {
  const poly = (over: Partial<PolygonShape> = {}): PolygonShape => ({
    kind: "polygon",
    id: "p",
    transform: IDENTITY,
    style,
    cx: 10,
    cy: 10,
    rx: 10,
    ry: 10,
    sides: 5,
    star: false,
    innerRatio: 0.5,
    ...over,
  });
  /** Rendered corners, rounded and sorted, so shapes are compared as point sets. */
  const corners = (s: PolygonShape) =>
    polygonSubpath(s)
      .nodes.map((n) => applyMat(s.transform, n.p))
      .map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`.replace(/-0\.000000/g, "0.000000"))
      .sort();
  const expected = (s: PolygonShape, A: ReturnType<typeof scale>) =>
    polygonSubpath(s)
      .nodes.map((n) => applyMat(A, applyMat(s.transform, n.p)))
      .map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`.replace(/-0\.000000/g, "0.000000"))
      .sort();

  it("scales and stretches into the radii, keeping the stroke", () => {
    const out = resizeNode(poly(), scale(2, 3)) as PolygonShape;
    expect(out).toMatchObject({ kind: "polygon", cx: 20, cy: 30, rx: 20, ry: 30, sides: 5 });
    expect(out.transform).toEqual(IDENTITY);
    expect(out.style.strokeWidth).toBe(3);
  });

  it("needs nothing extra for a horizontal flip", () => {
    const A = scale(-1, 1);
    const out = resizeNode(poly(), A) as PolygonShape;
    expect(out.kind).toBe("polygon");
    expect(out.transform).toEqual(IDENTITY);
    expect(corners(out)).toEqual(expected(poly(), A));
  });

  it("adds a half-turn when flipping an odd polygon vertically", () => {
    const A = scale(1, -2);
    const out = resizeNode(poly(), A) as PolygonShape;
    expect(out).toMatchObject({ cx: 10, cy: -20, rx: 10, ry: 20 });
    expect(out.transform).toEqual([-1, 0, 0, -1, 20, -40]);
    expect(corners(out)).toEqual(expected(poly(), A));
  });

  it("needs no half-turn for an even polygon or star", () => {
    const A = scale(1, -1);
    for (const s of [poly({ sides: 6 }), poly({ sides: 4, star: true })]) {
      const out = resizeNode(s, A) as PolygonShape;
      expect(out.transform).toEqual(IDENTITY);
      expect(corners(out)).toEqual(expected(s, A));
    }
  });

  it("flips a rotated odd star correctly through its own axes", () => {
    const s = poly({ sides: 5, star: true, transform: rotateAbout(0.4, { x: 10, y: 10 }) });
    // A resize along the shape's own axes: in its local space this is scale(1, -1) about (10, 10)
    const A = multiply(s.transform, multiply(translate(10, 10), multiply(scale(1, -1), multiply(translate(-10, -10), rotateAbout(-0.4, { x: 10, y: 10 })))));
    const out = resizeNode(s, A) as PolygonShape;
    expect(out.kind).toBe("polygon");
    expect(corners(out)).toEqual(expected(s, A));
  });

  it("becomes a path when resized at an angle to its axes", () => {
    const out = resizeNode(poly(), multiply(rotate(0.3), multiply(scale(2, 1), rotate(-0.3))));
    expect(out.kind).toBe("path");
  });
});
```

Hand-check:
- `scale(1, −2)` maps the centre (10, 10) to (10, −20); rx stays 10 and ry becomes 20. The half-turn about the new centre is `[−1, 0, 0, −1, 2·10, 2·(−20)]` = `[−1, 0, 0, −1, 20, −40]`.
- The comparison against the expected point set proves the orientation is right.

`src/__tests__/serialize.test.ts` — append:

```ts
describe("polygon attributes", () => {
  it("writes a polygon as a path with its parameters", () => {
    const s: Shape = {
      kind: "polygon",
      id: "p",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      cx: 10,
      cy: 20,
      rx: 5,
      ry: 5,
      sides: 4,
      star: false,
      innerRatio: 0.5,
    };
    expect(shapeAttrs(s)).toEqual({
      tag: "path",
      attrs: {
        d: "M10 15 L15 20 L10 25 L5 20 Z",
        "data-sv-nodes": "cccc",
        "data-sv-polygon": "4 0 0.5 10 20 5 5",
        fill: "#d9d9d9",
        stroke: "#000000",
        "stroke-width": "1",
      },
    });
  });

  it("builds d from the rounded numbers it writes", () => {
    const s: Shape = {
      kind: "polygon",
      id: "p",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      cx: 0.12345678,
      cy: 0,
      rx: 33.3333333,
      ry: 33.3333333,
      sides: 3,
      star: false,
      innerRatio: 0.5,
    };
    const { attrs } = shapeAttrs(s);
    expect(attrs["data-sv-polygon"]).toBe("3 0 0.5 0.123457 0 33.333333 33.333333");
    expect(attrs.d).toBe(
      polygonD({ cx: 0.123457, cy: 0, rx: 33.333333, ry: 33.333333, sides: 3, star: false, innerRatio: 0.5 }),
    );
  });
});
```

Also change that file's attrs import to `import { layerAttrs, polygonD, shapeAttrs, styleAttrs } from "../svg/attrs";`.

The corner coordinates (10, 15), (15, 20), (10, 25), (5, 20) come from centre (10, 20) and radius 5. `fmt` rounds the float noise from cos/sin (≈1e-16) away. The path writer's format is `M{x} {y}`, then `L{x} {y}` for each straight segment, then `Z` for a straight close.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/shapes.test.ts src/__tests__/bounds.test.ts src/__tests__/hit.test.ts src/__tests__/resize.test.ts src/__tests__/serialize.test.ts`
Expected: FAIL — missing exports (`polygonSubpath`, `polygonD`) and the unknown kind.

- [ ] **Step 4: Implement**

`src/doc/document.ts` — after `EllipseShape`, add:

```ts
/** Spec (M2c) §2. Corners sit on the ellipse (rx, ry); rotation lives in `transform`. */
export type PolygonShape = ShapeBase & {
  kind: "polygon";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Integer MIN_SIDES–MAX_SIDES; for a star, the number of points. */
  sides: number;
  star: boolean;
  /** MIN_INNER–MAX_INNER; kept while `star` is off. */
  innerRatio: number;
};
```

Change the union to `export type Shape = RectShape | EllipseShape | PolygonShape | PathShape;` and add after `MAX_ARTBOARD`:

```ts
export const MIN_SIDES = 3;
export const MAX_SIDES = 32;
export const MIN_INNER = 0.1;
export const MAX_INNER = 0.95;
```

`src/geom/shapes.ts`:
- Change the document import to include `PolygonShape`.
- Add after `starPath`:

```ts
export type PolygonGeometry = Pick<
  PolygonShape,
  "cx" | "cy" | "rx" | "ry" | "sides" | "star" | "innerRatio"
>;

/** Spec (M2c) §3: corner 0 points up; a star's inner corners sit halfway between outer ones. */
export function polygonSubpath(p: PolygonGeometry): Subpath {
  const at = (a: number, k: number) =>
    node({ x: p.cx + p.rx * k * Math.cos(a), y: p.cy + p.ry * k * Math.sin(a) });
  const nodes: PathNode[] = [];
  for (let i = 0; i < p.sides; i++) {
    nodes.push(at(-Math.PI / 2 + (i * 2 * Math.PI) / p.sides, 1));
    if (p.star) nodes.push(at(-Math.PI / 2 + ((2 * i + 1) * Math.PI) / p.sides, p.innerRatio));
  }
  return { closed: true, nodes };
}
```

Replace `toPath`'s signature and subpath selection:

```ts
export function toPath(s: RectShape | EllipseShape | PolygonShape): PathShape {
  let sp: Subpath;
  if (s.kind === "rect") {
    const r = Math.min(s.rx, s.w / 2, s.h / 2);
    sp = rectPath(s.x, s.y, s.w, s.h, r, r);
  } else if (s.kind === "ellipse") {
    sp = ellipsePath(s.cx, s.cy, s.rx, s.ry);
  } else {
    sp = polygonSubpath(s);
  }
```

The rest of `toPath` is unchanged.

`src/geom/bounds.ts`:
- Add `import { polygonSubpath } from "./shapes";`.
- Add a case before `case "path":`:

```ts
    case "polygon":
      return boxFromPoints(polygonSubpath(node).nodes.map((n) => applyMat(t, n.p)));
```

`src/geom/hit.ts`:
- Add `PolygonShape` to the document type import.
- Add `import { polygonSubpath } from "./shapes";`.
- After `ellipsePolylines`, add:

```ts
/** Polygon outline, cached per (immutable) polygon object. */
const polygonCache = new WeakMap<PolygonShape, Vec[][]>();

function polygonPolylines(s: PolygonShape): Vec[][] {
  let polys = polygonCache.get(s);
  if (!polys) {
    polys = [flattenSubpath(polygonSubpath(s))];
    polygonCache.set(s, polys);
  }
  return polys;
}
```

In `shapeHit`, add before `case "path":`:

```ts
    case "polygon": {
      const polys = polygonPolylines(s);
      if (s.style.fill && insideNonzero(p, polys)) return true;
      return distToPolylines(p, polys) <= reach;
    }
```

`src/doc/resize.ts`:
- Change the mat import to `import { applyMat, invert, isAxisAligned, isIdentity, multiply, type Mat } from "../geom/mat";` (unchanged if already so).
- Add `PolygonShape` to the document type import.
- Add a case before `case "path":` in `bakeShape`:

```ts
    case "polygon": {
      const c = applyMat(L, { x: s.cx, y: s.cy });
      const out: PolygonShape = {
        ...s,
        cx: c.x,
        cy: c.y,
        rx: s.rx * Math.abs(L[0]),
        ry: s.ry * Math.abs(L[3]),
      };
      // Spec (M2c) §4: the corners are left-right symmetric, so a horizontal flip needs nothing.
      // A vertical flip of an odd polygon must point down: add an exact half-turn about the centre.
      if (L[3] < 0 && s.sides % 2 === 1) {
        const half: Mat = [-1, 0, 0, -1, 2 * c.x, 2 * c.y];
        out.transform = multiply(s.transform, half);
      }
      return out;
    }
```

The existing first line of `bakeShape` (`if (s.kind !== "path" && !isAxisAligned(L)) return bakeShape(toPath(s), L);`) already sends angled resizes through `toPath`, which now accepts polygons.

`src/svg/attrs.ts`:
- Change the imports to:

```ts
import type { Group, Layer, Shape, Style } from "../doc/document";
import { isIdentity, type Mat } from "../geom/mat";
import { polygonSubpath, type PolygonGeometry } from "../geom/shapes";
import { fmt } from "./fmt";
import { nodeTypesAttr, subpathsToD } from "./pathdata";
```

- Add before `shapeAttrs`:

```ts
/** The parameters exactly as written (spec M2c §7.1). */
function asWritten(p: PolygonGeometry): PolygonGeometry {
  const r = (v: number) => Number(fmt(v));
  return {
    cx: r(p.cx),
    cy: r(p.cy),
    rx: r(p.rx),
    ry: r(p.ry),
    sides: p.sides,
    star: p.star,
    innerRatio: r(p.innerRatio),
  };
}

/** `d` of a polygon, built from its written numbers so reopening regenerates it exactly. */
export function polygonD(p: PolygonGeometry): string {
  return subpathsToD([polygonSubpath(asWritten(p))]);
}

export function polygonAttr(p: PolygonGeometry): string {
  return [p.sides, p.star ? 1 : 0, p.innerRatio, p.cx, p.cy, p.rx, p.ry].map(fmt).join(" ");
}
```

- In `shapeAttrs`, add before `case "path":`:

```ts
    case "polygon": {
      const sp = polygonSubpath(asWritten(s));
      return {
        tag: "path",
        attrs: {
          d: subpathsToD([sp]),
          "data-sv-nodes": nodeTypesAttr([sp]),
          "data-sv-polygon": polygonAttr(s),
          ...common,
        },
      };
    }
```

Notes:
- `polygonD(p)` and the `d` written here are the same string, because both build from `asWritten`.
- The import `polygonSubpath` from `../geom/shapes` doesn't create a cycle: `shapes.ts` imports only `mat` and document types.

- [ ] **Step 5: Run the tests to verify they pass**

Run the Step 3 command, then `npm test`, `npm run build`, `npm run lint`, `npm run format:check`.
Expected: all pass; build 0 errors / 0 warnings. `NodeView.svelte` needs no change: polygons come back with `tag: "path"`.

- [ ] **Step 6: Commit**

```bash
git add src/doc/document.ts src/geom/shapes.ts src/geom/bounds.ts src/geom/hit.ts src/doc/resize.ts src/svg/attrs.ts src/__tests__/shapes.test.ts src/__tests__/bounds.test.ts src/__tests__/hit.test.ts src/__tests__/resize.test.ts src/__tests__/serialize.test.ts
git commit -m "feat(doc): polygon shape kind with geometry, resize and SVG writing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Reading polygons back

**Files:**
- Modify: `src/svg/parse.ts`
- Test: `src/__tests__/parse.test.ts` (extended)

**Interfaces:**
- Consumes: `polygonD`, `polygonAttr` (Task 1); `MIN_SIDES`, `MAX_SIDES`, `MIN_INNER`, `MAX_INNER`, `PolygonShape`; `PolygonGeometry`.
- Produces:
  - `parsePolygonAttr(attr: string): PolygonGeometry | null` validates only (spec §7.2, every rule except the `d` comparison).
  - `parseSvg` turns a `<path>` into a polygon when `parsePolygonAttr` succeeds and `polygonD(result) === d`.

- [ ] **Step 1: Write the failing tests** — append to `src/__tests__/parse.test.ts`

Change the imports:
- `import { parsePolygonAttr, parseSvg, SvgError } from "../svg/parse";`
- add `import { polygonD } from "../svg/attrs";`
- add `rotateAbout` to the `../geom/mat` import;
- add `type PolygonShape` to the document import.

Then append:

```ts
describe("live polygons", () => {
  const poly: PolygonShape = {
    kind: "polygon",
    id: "p",
    name: "Badge",
    transform: rotateAbout(0.3, { x: 100, y: 0 }),
    style: { ...DEFAULT_STYLE, strokeWidth: 2 },
    cx: 100.1234567,
    cy: -3,
    rx: 33.3333333,
    ry: 12,
    sides: 7,
    star: true,
    innerRatio: 0.37,
  };
  const withPoly = (): Doc => {
    const d = createDoc(300, 200);
    return { ...d, layers: [{ ...d.layers[0], children: [poly] }] };
  };

  it("round-trips a polygon byte for byte", () => {
    const text = serializeDoc(withPoly());
    const back = parseSvg(text);
    expect(back.dropped).toEqual([]);
    const p = back.doc.layers[0].children[0] as PolygonShape;
    expect(p).toMatchObject({
      kind: "polygon",
      name: "Badge",
      cx: 100.123457,
      cy: -3,
      rx: 33.333333,
      ry: 12,
      sides: 7,
      star: true,
      innerRatio: 0.37,
    });
    expect(serializeDoc(back.doc)).toBe(text);
  });

  it("imports an edited outline as a plain path", () => {
    const text = serializeDoc(withPoly()).replace(/ d="[^"]*"/, ' d="M0 0 L10 0 L10 10 Z"');
    const back = parseSvg(text);
    expect(back.dropped).toEqual([]);
    const p = back.doc.layers[0].children[0] as PathShape;
    expect(p.kind).toBe("path");
    expect(p.subpaths[0].nodes.map((n) => n.p)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("imports a path with an invalid polygon attribute as a path", () => {
    const d = polygonD({ cx: 0, cy: 0, rx: 10, ry: 10, sides: 5, star: false, innerRatio: 0.5 });
    const back = parseSvg(`<svg><path d="${d}" data-sv-polygon="5 0 0.5 0 0 10 -10"/></svg>`);
    expect(back.doc.layers[0].children[0].kind).toBe("path");
    expect(back.dropped).toEqual([]);
  });

  it("validates the polygon attribute", () => {
    expect(parsePolygonAttr(" 5 1 0.5 1 -2 10 20 ")).toEqual({
      sides: 5,
      star: true,
      innerRatio: 0.5,
      cx: 1,
      cy: -2,
      rx: 10,
      ry: 20,
    });
    for (const bad of [
      "",
      "5 0 0.5 0 0 10",
      "5 0 0.5 0 0 10 10 1",
      "2 0 0.5 0 0 10 10",
      "33 0 0.5 0 0 10 10",
      "5.5 0 0.5 0 0 10 10",
      "5 2 0.5 0 0 10 10",
      "5 0 0.05 0 0 10 10",
      "5 0 0.99 0 0 10 10",
      "5 0 0.5 2e9 0 10 10",
      "5 0 0.5 0 0 0 10",
      "5 0 0.5 0 0 10 2e9",
      "5 0 0.5 0 0 10 NaN",
      "5 0 0.5 0 0 10 abc",
    ]) {
      expect(parsePolygonAttr(bad), bad).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/parse.test.ts`
Expected: FAIL — `parsePolygonAttr` is not exported.

- [ ] **Step 3: Implement** — `src/svg/parse.ts`

Imports: add these to the document import: `MAX_INNER`, `MAX_SIDES`, `MIN_INNER`, `MIN_SIDES`. Also add:

```ts
import type { PolygonGeometry } from "../geom/shapes";
import { polygonD } from "./attrs";
```

After `MAX_COORD`'s definition, add:

```ts
/** Spec (M2c) §7.2, every rule except the `d` comparison (which the importer does). */
export function parsePolygonAttr(attr: string): PolygonGeometry | null {
  const parts = attr.trim().split(/\s+/);
  if (parts.length !== 7) return null;
  const v = parts.map(Number);
  if (v.some((x) => !Number.isFinite(x))) return null;
  const [sides, star, innerRatio, cx, cy, rx, ry] = v;
  if (!Number.isInteger(sides) || sides < MIN_SIDES || sides > MAX_SIDES) return null;
  if (star !== 0 && star !== 1) return null;
  if (innerRatio < MIN_INNER || innerRatio > MAX_INNER) return null;
  if (Math.abs(cx) > MAX_COORD || Math.abs(cy) > MAX_COORD) return null;
  if (!(rx > 0 && ry > 0 && rx <= MAX_COORD && ry <= MAX_COORD)) return null;
  return { cx, cy, rx, ry, sides, star: star === 1, innerRatio };
}
```

`"".trim().split(/\s+/)` is `[""]`, whose length is 1, so an empty attribute is rejected by the count check.

In `convert`, replace the `case "path":` block with:

```ts
      case "path": {
        // An intact polygon of ours comes back live; anything else stays a path (spec M2c §7.2).
        const poly =
          a["data-sv-polygon"] !== undefined ? parsePolygonAttr(a["data-sv-polygon"]) : null;
        if (poly && polygonD(poly) === (a.d ?? "")) {
          return {
            kind: "polygon",
            id: newId(),
            name: label,
            transform,
            style: style(i2, opacity),
            ...poly,
          };
        }
        let subpaths = parsePathData(a.d ?? "");
        if (a["data-sv-nodes"] !== undefined)
          subpaths = applyNodeTypes(subpaths, a["data-sv-nodes"]);
        return pathNode(subpaths, newId(), label, transform, style(i2, opacity));
      }
```

Notes:
- **Import cycle:** `attrs.ts` imports only `document`, `mat`, `shapes`, `fmt` and `pathdata`, so importing it from `parse.ts` creates none.
- **Undefined name:** `name: label` may be `undefined`, exactly as the rect case does.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/parse.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run format:check`.
Expected: all pass. The fixture tests (Inkscape/Figma/Illustrator) are unchanged: their paths have no `data-sv-polygon`.

- [ ] **Step 5: Commit**

```bash
git add src/svg/parse.ts src/__tests__/parse.test.ts
git commit -m "feat(svg): read intact polygons back as live shapes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Polygon edits and the selection summary

**Files:**
- Modify: `src/doc/edits.ts`, `src/state/properties.ts`
- Test: `src/__tests__/tree-edits.test.ts`, `src/__tests__/properties.test.ts` (extended)

**Interfaces:**
- Consumes: `PolygonShape`, `MIN_SIDES`, `MAX_SIDES`, `MIN_INNER`, `MAX_INNER`, and `toPath` accepting polygons (Task 1).
- Produces:
  - `edits.ts`:
    - `type PolygonPatch = Partial<Pick<PolygonShape, "sides" | "star" | "innerRatio">>`
    - `setPolygon(doc, ids, patch: PolygonPatch): Doc`
    - `convertToPath` converts polygons too
  - `properties.ts`:
    - `selectionActions().canConvert` is true for polygons
    - `type PolygonSummary = { sides: number | null; star: boolean | "mixed"; innerRatio: number | null; anyStar: boolean }`
    - `summarizePolygons(doc, ids): PolygonSummary | null`

- [ ] **Step 1: Write the failing tests**

`src/__tests__/tree-edits.test.ts`:
- Add `setPolygon` to the edits import.
- Add `type PolygonShape` to the document import.
- Append:

```ts
describe("polygon edits", () => {
  const poly = (id: string, over: Partial<PolygonShape> = {}): PolygonShape => ({
    kind: "polygon",
    id,
    transform: IDENTITY,
    style: DEFAULT_STYLE,
    cx: 0,
    cy: 0,
    rx: 10,
    ry: 10,
    sides: 5,
    star: false,
    innerRatio: 0.5,
    ...over,
  });
  const d = (): Doc =>
    deepFreeze({
      ...createDoc(100, 100),
      layers: [
        {
          id: "L",
          name: "L",
          visible: true,
          locked: false,
          children: [poly("a"), poly("b", { star: true }), rect("r")],
        },
      ],
    });
  const get = (doc: Doc, id: string) => doc.layers[0].children.find((n) => n.id === id)!;

  it("sets sides, star and inner ratio on selected polygons only", () => {
    const doc = d();
    const out = setPolygon(doc, ["a", "b", "r"], { sides: 7.4, star: true, innerRatio: 0.3 });
    expect(get(out, "a")).toMatchObject({ sides: 7, star: true, innerRatio: 0.3 });
    expect(get(out, "b")).toMatchObject({ sides: 7, star: true, innerRatio: 0.3 });
    expect(get(out, "r")).toBe(get(doc, "r"));
  });

  it("clamps and ignores non-finite values", () => {
    const doc = d();
    expect(get(setPolygon(doc, ["a"], { sides: 1 }), "a")).toMatchObject({ sides: 3 });
    expect(get(setPolygon(doc, ["a"], { sides: 99 }), "a")).toMatchObject({ sides: 32 });
    expect(get(setPolygon(doc, ["a"], { innerRatio: 0 }), "a")).toMatchObject({ innerRatio: 0.1 });
    expect(get(setPolygon(doc, ["a"], { innerRatio: 2 }), "a")).toMatchObject({ innerRatio: 0.95 });
    expect(setPolygon(doc, ["a"], { sides: NaN, innerRatio: Infinity })).toBe(doc);
  });

  it("returns the same document when nothing changes", () => {
    const doc = d();
    expect(setPolygon(doc, ["a"], { sides: 5, star: false, innerRatio: 0.5 })).toBe(doc);
    expect(setPolygon(doc, ["r"], { sides: 8 })).toBe(doc);
    expect(setPolygon(doc, ["a"], {})).toBe(doc);
  });

  it("converts polygons to paths", () => {
    const out = convertToPath(d(), ["b"]);
    expect(get(out, "b").kind).toBe("path");
    expect(get(out, "a").kind).toBe("polygon");
  });
});
```

`src/__tests__/properties.test.ts`:
- Add `summarizePolygons` to the properties import.
- Add `type PolygonShape` to the document import.
- Append:

```ts
describe("polygon summary", () => {
  const poly = (id: string, over: Partial<PolygonShape> = {}): PolygonShape => ({
    kind: "polygon",
    id,
    transform: IDENTITY,
    style: DEFAULT_STYLE,
    cx: 50,
    cy: 50,
    rx: 10,
    ry: 10,
    sides: 5,
    star: false,
    innerRatio: 0.5,
    ...over,
  });

  it("summarises polygons, blanking values that differ", () => {
    const d = doc(poly("a"), poly("b", { sides: 6, star: true }), rect("r", 0, 0, 5, 5));
    expect(summarizePolygons(d, [])).toBeNull();
    expect(summarizePolygons(d, ["a", "r"])).toBeNull();
    expect(summarizePolygons(d, ["a"])).toEqual({
      sides: 5,
      star: false,
      innerRatio: 0.5,
      anyStar: false,
    });
    expect(summarizePolygons(d, ["a", "b"])).toEqual({
      sides: null,
      star: "mixed",
      innerRatio: 0.5,
      anyStar: true,
    });
  });

  it("offers Convert to path for polygons", () => {
    const d = doc(poly("a"));
    expect(selectionActions(d, ["a"]).canConvert).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/tree-edits.test.ts src/__tests__/properties.test.ts`
Expected: FAIL — missing `setPolygon` / `summarizePolygons`; polygons are not converted.

- [ ] **Step 3: Implement**

`src/doc/edits.ts`:
- Add `MAX_INNER`, `MAX_SIDES`, `MIN_INNER`, `MIN_SIDES` and `type PolygonShape` to its `./document` import.
- Replace `convertToPath` with:

```ts
export function convertToPath(doc: Doc, ids: readonly string[]): Doc {
  return mapTopLevel(doc, ids, (n) =>
    n.kind === "rect" || n.kind === "ellipse" || n.kind === "polygon" ? toPath(n) : n,
  );
}
```

- Add after `setRectRadius`:

```ts
export type PolygonPatch = Partial<Pick<PolygonShape, "sides" | "star" | "innerRatio">>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Spec (M2c) §5: only selected top-level polygons change; values are rounded/clamped. */
export function setPolygon(doc: Doc, ids: readonly string[], patch: PolygonPatch): Doc {
  const sides =
    patch.sides !== undefined && Number.isFinite(patch.sides)
      ? clamp(Math.round(patch.sides), MIN_SIDES, MAX_SIDES)
      : undefined;
  const innerRatio =
    patch.innerRatio !== undefined && Number.isFinite(patch.innerRatio)
      ? clamp(patch.innerRatio, MIN_INNER, MAX_INNER)
      : undefined;
  const star = patch.star;
  return mapTopLevel(doc, ids, (n) => {
    if (n.kind !== "polygon") return n;
    const next = {
      sides: sides ?? n.sides,
      star: star ?? n.star,
      innerRatio: innerRatio ?? n.innerRatio,
    };
    return next.sides === n.sides && next.star === n.star && next.innerRatio === n.innerRatio
      ? n
      : { ...n, ...next };
  });
}
```

`src/state/properties.ts`:
- Change the document import to `import type { Doc, LineCap, LineJoin, Paint, PolygonShape, Style } from "../doc/document";`.
- In `selectionActions`, change `canConvert` to:

```ts
    canConvert: nodes.some((n) => n.kind === "rect" || n.kind === "ellipse" || n.kind === "polygon"),
```

- Add after `selectionActions`:

```ts
export type PolygonSummary = {
  sides: number | null;
  star: boolean | "mixed";
  innerRatio: number | null;
  anyStar: boolean;
};

/** Context-bar values for a selection made only of polygons (spec M2c §5); null otherwise. */
export function summarizePolygons(doc: Doc, ids: readonly string[]): PolygonSummary | null {
  const nodes = ids.flatMap((id) => findTopLevel(doc, id)?.node ?? []);
  const polys = nodes.filter((n): n is PolygonShape => n.kind === "polygon");
  if (polys.length === 0 || polys.length !== nodes.length) return null;
  const same = <T>(values: T[]): T | null => (values.every((v) => v === values[0]) ? values[0] : null);
  const stars = polys.map((p) => p.star);
  return {
    sides: same(polys.map((p) => p.sides)),
    star: same(stars) ?? "mixed",
    innerRatio: same(polys.map((p) => p.innerRatio)),
    anyStar: stars.some(Boolean),
  };
}
```

`same(stars) ?? "mixed"` is correct because `same` returns `null` only when the values differ; `false` is kept by `??`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/tree-edits.test.ts src/__tests__/properties.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run format:check`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/doc/edits.ts src/state/properties.ts src/__tests__/tree-edits.test.ts src/__tests__/properties.test.ts
git commit -m "feat(doc): edit polygon sides, star and inner ratio; convert polygons to paths

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The polygon tool draws live polygons

**Files:**
- Modify: `src/tools/shape-tools.ts`, `src/geom/shapes.ts` (remove `polygonPath`/`starPath`)
- Test: `src/__tests__/shape-tools.test.ts`, `src/__tests__/shapes.test.ts` (edited)

**Interfaces:**
- Consumes: `PolygonShape`, `polygonSubpath` (Task 1); `rotateAbout`, `applyMat`, `IDENTITY`.
- Produces (spec §6): `createPolygonTool` builds `{ kind: "polygon", cx: a.x, cy: a.y, rx: r, ry: r, sides, star, innerRatio }` with `transform = IDENTITY` under Shift or when `θ === 0`, otherwise `rotateAbout(θ, a)` with `θ = atan2(dy, dx) + π/2`.

- [ ] **Step 1: Replace the old polygon tests**

`src/__tests__/shape-tools.test.ts`:
- Add `type PolygonShape` to the document import.
- Change the mat import to `import { applyMat, IDENTITY } from "../geom/mat";`.
- Add `import { polygonSubpath } from "../geom/shapes";`.
- Replace the whole `it("draws polygons and stars from the preferences", …)` test with:

```ts
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
    const tip = applyMat(p.transform, polygonSubpath(p).nodes[0].p);
    expect(tip.x).toBeCloseTo(60);
    expect(tip.y).toBeCloseTo(50);

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

  it("keeps an upward drag unrotated", () => {
    const { ctx, state } = fakeContext(blank());
    drag(createPolygonTool(), ctx, [50, 50], [50, 40]);
    expect((children(state.session.doc)[0] as PolygonShape).transform).toBe(IDENTITY);
  });
```

Hand-check:
- Dragging right gives θ = 0 + π/2. Corner 0, (50, 40) locally, rotated 90° clockwise on screen about (50, 50), lands at (60, 50).
- Dragging up: `atan2(−10, 0)` is exactly −π/2, so θ = 0 and the transform is `IDENTITY`.
- Snapping: the artboard is 100 × 100, so the targets are 0/50/100 with threshold 8. (50, 50) is already on a target, and 60 and 40 are 10 away, so nothing moves.

`src/__tests__/shapes.test.ts`:
- Remove `polygonPath` and `starPath` from the import.
- Delete the two tests `it("makes a polygon starting at the rotation angle", …)` and `it("makes a star with alternating radii", …)`. The Task 1 `polygonSubpath` tests replace them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/shape-tools.test.ts`
Expected: FAIL — the tool still creates paths.

- [ ] **Step 3: Implement**

`src/tools/shape-tools.ts` — replace `createPolygonTool` with:

```ts
export function createPolygonTool(): Tool {
  return createDragTool(
    "polygon",
    "Drag from the centre to draw a polygon or star · Shift: upright",
    (a, b, mods, prefs) => {
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      if (r === 0) return null;
      // Corner 0 points up; turn it towards the pointer unless Shift keeps it upright.
      const theta = mods.shift ? 0 : Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      const { sides, star, innerRatio } = prefs.polygon;
      return {
        ...base,
        kind: "polygon",
        transform: theta === 0 ? IDENTITY : rotateAbout(theta, a),
        style: prefs.style,
        cx: a.x,
        cy: a.y,
        rx: r,
        ry: r,
        sides,
        star,
        innerRatio,
      };
    },
  );
}
```

Fix the imports in the same file:
- add `rotateAbout` to the `../geom/mat` import;
- remove `polygonPath` and `starPath` from the `../geom/shapes` import.

`src/geom/shapes.ts`: delete `polygonPath` and `starPath`. First confirm nothing else uses them: `grep -rn "polygonPath\|starPath" src` must show only the lines you are removing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/shape-tools.test.ts src/__tests__/shapes.test.ts`, then `npm test`, `npm run build`, `npm run lint`, `npm run format:check`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/shape-tools.ts src/geom/shapes.ts src/__tests__/shape-tools.test.ts src/__tests__/shapes.test.ts
git commit -m "feat(tools): the polygon tool draws live polygons

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Editing selected polygons in the context bar

**Files:**
- Modify: `src/state/appState.svelte.ts`, `src/lib/ContextBar.svelte`

**Interfaces:**
- Consumes: `setPolygon`, `PolygonPatch` (Task 3); `summarizePolygons` (Task 3); `NumberField` (`label`, `value: number | null`, `min`, `max`, `suffix`, `onchange(v)`).
- Produces: store `setSelectionPolygon(patch: PolygonPatch): void`, plus UI. There are no unit tests: the build and the controller's browser pass gate this task.

- [ ] **Step 1: Add the store action** — `src/state/appState.svelte.ts`

Add `setPolygon` and `type PolygonPatch` to the `../doc/edits` import. Add after `setSelectionRectRadius`:

```ts
export function setSelectionPolygon(patch: PolygonPatch): void {
  cancelActiveGesture();
  commitDoc(setPolygon(app.doc, app.selection, patch));
}
```

- [ ] **Step 2: Add the fields** — `src/lib/ContextBar.svelte`

Imports:
- add `setSelectionPolygon` to the store import;
- change the properties import to `import { selectionActions, summarizePolygons } from "../state/properties";`.

Add after `const radius = …`:

```ts
  const polygons = $derived(summarizePolygons(app.doc, app.selection));
```

In the selection branch, right after the `{#if onlyRects} … {/if}` block, add:

```svelte
    {#if polygons}
      <NumberField
        label="Sides"
        value={polygons.sides}
        min={3}
        max={32}
        onchange={(v) => setSelectionPolygon({ sides: Math.round(v) })}
      />
      <label class="flex items-center gap-1">
        <input
          type="checkbox"
          checked={polygons.star === true}
          indeterminate={polygons.star === "mixed"}
          onchange={(e) => setSelectionPolygon({ star: e.currentTarget.checked })}
        />
        Star
      </label>
      {#if polygons.anyStar}
        <NumberField
          label="Inner"
          value={polygons.innerRatio === null ? null : Math.round(polygons.innerRatio * 100)}
          min={10}
          max={95}
          suffix="%"
          onchange={(v) => setSelectionPolygon({ innerRatio: v / 100 })}
        />
      {/if}
    {/if}
```

These fields mirror the polygon tool's own fields in the same file (Sides 3–32, Star, Inner 10–95 %).

Svelte compiles `indeterminate={…}` to a DOM property assignment (`input.indeterminate = …`), checked against this repo's Svelte 5.55, so no action or attachment is needed.

- [ ] **Step 3: Verify**

Run: `npm run build` (0 errors / 0 warnings), `npm run lint`, `npm run format:check`, `npm test`.

Then compile-check on a port that is not the user's 5173:

```bash
(npx vite --port 5199 --strictPort > "$TMPDIR/sv-5199.log" 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}" http://localhost:5199/ | grep -q 200 && break; perl -e 'select(undef,undef,undef,0.5)'; done
curl -s -o /dev/null -w "ContextBar %{http_code}\n" http://localhost:5199/src/lib/ContextBar.svelte
pkill -f "vite --port 5199"
```

Expected: `ContextBar 200`.

- [ ] **Step 4: Commit**

```bash
git add src/state/appState.svelte.ts src/lib/ContextBar.svelte
git commit -m "feat(ui): edit sides, star and inner ratio of selected polygons

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Controller browser pass (between Task 5 and Task 6)

The controller does this itself. Use a separate dev server (`npx vite --port 5198 --strictPort`) in desktop Chrome, and stop it afterwards. Follow the memory's harness tips:
- import the app's `?t=` store module;
- await a tick before checking the DOM;
- use synthetic PointerEvents for modifier keys.

1. Draw a polygon (dragging right) and a star (Shift). Both are `kind: "polygon"`, and the context bar shows Sides / Star (and Inner for the star).
2. Change Sides to 8 and Star on/off: one undo step each. Undo restores the previous values.
3. Select a polygon and a star together: Sides is blank when they differ, the Star checkbox is indeterminate (`input.indeterminate === true`), and Inner shows. Setting Sides changes both.
4. A selection containing a polygon and a rect shows no polygon fields.
5. Stretch with a side handle: the shape stays a polygon with rx ≠ ry, and the fields still work.
6. Drag the bottom handle past the top edge (a vertical flip) of a pentagon: it points down and stays a polygon.
7. Rotate it, then resize along the rotated frame: it stays a polygon. Convert to path from the menu: the fields disappear.
8. Copy/paste a star (synthetic events, stubbed clipboard): the pasted copy is a polygon.
9. Serialize → `replaceDocument(parseSvg(text).doc)`: the polygons are still live and the text is unchanged on a second serialize.
10. No console errors.

Record the results for the Task 6 CHANGELOG entry. Failures go through a fix dispatch first.

---

### Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/CHANGELOG.md`

**Interfaces:** none. The controller passes the browser-pass results in the dispatch.

- [ ] **Step 1: `CLAUDE.md`**
- **Architecture map:**
  - In the `src/geom/` bullet, change `shapes.ts` (`rectPath`, …) to mention `polygonSubpath`.
  - In the `src/svg/` bullet, add that `attrs.ts` also writes polygons (`polygonD`) and `parse.ts` reads them back (`parsePolygonAttr`).
- **New gotchas, appended after the last one:**
  - **Polygons are live shapes saved as paths** (spec M2c). A polygon is written as `<path d … data-sv-polygon="sides star inner cx cy rx ry">`, with `d` built from the numbers *as written* (`polygonD`). The importer restores a polygon only when the attribute validates and the regenerated `d` equals the file's `d`; otherwise it stays a path. Never build a polygon's `d` from unrounded numbers, or reopened files silently lose their polygons.
  - **Polygon resize flips:** the corner set is left-right symmetric, so a horizontal flip needs nothing. A vertical flip of an odd polygon composes an exact half-turn (`[−1, 0, 0, −1, 2cx, 2cy]`) into the transform, never `rotateAbout(π)`, which leaves float noise in files.
- **Current state:** `Milestone 2c (live polygons) — see CHANGELOG. Next is milestone 3: layers and groups.`
- **Commands:** update the test count to the actual `npm test` result.

- [ ] **Step 2: `README.md`**
- Status: change `- Drawing rectangles, ellipses, lines, polygons and stars.` to
  `- Drawing rectangles, ellipses, lines, polygons and stars — polygons and stars stay editable (sides, star, inner ratio).`
- Development: update the unit-test count to the actual `npm test` result.

- [ ] **Step 3: `docs/superpowers/CHANGELOG.md`** — append:

```markdown
## 2026-09-17 — Milestone 2c: live polygons and stars

- New `polygon` shape kind (centre, x/y radii, sides, star, inner ratio; rotation in the
  transform). The polygon tool draws it; the context bar edits Sides / Star / Inner for a
  selection made only of polygons (blank / indeterminate when they differ), one undo step each.
- Resizing keeps it a polygon along its own axes (stretching changes the radii; a vertical flip of
  an odd polygon adds a half-turn); an angled resize or Convert to path turns it into a path.
- Saved as `<path … data-sv-polygon>` with `d` built from the written numbers; reopening restores
  the polygon only when the attribute validates and `d` still matches, else it stays a path. Save
  → open → save is byte-identical. Polygons drawn before this milestone stay paths.
- Plan: `docs/superpowers/plans/2026-09-17-m2c-live-polygon.md`.
- Browser-verified (desktop Chrome): <controller fills in from the browser pass>.
- Owed: touch/Pencil editing of the fields on iPad; Safari/Firefox; opening a saved polygon in
  Inkscape/Illustrator/Figma (it should show as a plain path).
```

Replace the `<controller fills in …>` text with the results the controller provides.

- [ ] **Step 4: Verify**

Run: `npm test` (use its count) and `npm run format:check` (run `npx prettier --write` on the three files if needed).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/superpowers/CHANGELOG.md
git commit -m "docs: milestone 2c live polygons

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
