# M16 Radial Gradients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-stop radial gradients (circles and ellipses) on fill and stroke — saved as `<radialGradient>`, imported exactly, chosen in the panel ([Flat | Linear | Radial], and a Type row in the Gradient section) and drawn/adjusted with the Gradient tool.

**Architecture:** `RadialGradient = { kind: "radial"; center; a; b; start; end }` joins `LinearGradient` in a `Gradient` union; it is the unit circle under the affine map with columns `a − center`, `b − center`, so `mapStyle` keeps every bake exact by mapping three points. Export writes a plain `cx cy r` circle or the unit circle under a `gradientTransform`; import folds foreign radials with no focal offset; the edits, store, panel and tool each gain the radial case beside the linear one.

**Tech Stack:** Svelte 5, TypeScript, Vitest (node env, no DOM), lucide icons.

**Spec:** `docs/superpowers/specs/2026-09-27-m16-radial-gradients-design.md` (and M15's `docs/superpowers/specs/2026-09-27-m15-linear-gradients-design.md`, whose rules carry over). Section numbers (§N) below refer to M16's spec.

## Global Constraints

- `npm run build` must end with **0 errors, 0 warnings**; `npm test` all green; `npm run lint` clean.
- **The document is immutable** (CLAUDE.md invariant 1): an edit that changes nothing returns the SAME reference.
- **Canvas and export share `src/svg/attrs.ts`** (invariant 3).
- **Tools never import the store** (invariant 12); store actions that edit the document call `cancelActiveGesture()` first (invariant 15).
- **The importer never throws on unsupported content**; it reports via `drop(label)` (invariant 4); coordinates past `MAX_COORD` (1e9) or non-finite are rejected (invariant 8).
- **Every geometry bake maps the gradient through `mapStyle`** (invariant 46) — radial is covered by extending `mapStyle`, never by touching the bake sites.
- A document **without** gradients must serialize **byte-identically**; a document with only **linear** gradients must serialize byte-identically to M15.
- Gradient element ids stay `sv-grad-<node id>-fill` / `sv-grad-<node id>-stroke`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. One commit per task on branch `m16-radial-gradients`.
- Match surrounding comment density and style (JSDoc that says *why*, citing `spec M16 §N`).
- Write typographic characters literally, never as `\uXXXX` escapes.

## Review Focus

1. **A radial gradient on a shape resized non-uniformly, skewed through a group, or flipped as an odd polygon** — it must stretch/skew exactly (three mapped points), never snap back to a circle. Tests in Task 1.
2. **A Figma/Illustrator elliptical radial (`gradientTransform` with rotate + non-uniform scale, `objectBoundingBox` on a non-square box)** — must import pixel-exactly, not as a circle. Tests in Task 2 (sampled against the source definition).
3. **Switching Type on a mixed selection (some linear, some radial, some flat)** — gradients convert, flats stay untouched, one undo step. Tests in Task 4.
4. **Dragging rim A on a rotated or skewed shape** — the ellipse keeps its on-screen shape (the similarity is computed in document space). Test in Task 5.
5. **A rim knob dragged onto the centre** — collapses to the end colour, flat, instead of writing a singular gradient. Tests in Tasks 1 and 5.

---

### Task 1: Model, export and bakes

**Files:**
- Modify: `src/doc/document.ts`, `src/svg/attrs.ts`, `src/svg/serialize.ts`, `src/lib/NodeView.svelte`
- Modify (narrowing only, to keep compiling): `src/doc/paint-edit.ts`, `src/tools/gradient-handles.ts`, `src/svg/gradient-import.ts`, anything else `tsc` flags
- Test: `src/__tests__/gradient-model.test.ts`, `src/__tests__/serialize.test.ts`, `src/__tests__/gradient-bake.test.ts`

**Interfaces:**
- Produces (document.ts):
  ```ts
  export type RadialGradient = { kind: "radial"; center: Vec; a: Vec; b: Vec; start: Paint; end: Paint };
  export type Gradient = LinearGradient | RadialGradient;
  export type Fill = Paint | Gradient;
  export function isGradient(f: Fill | null | undefined): f is Gradient;
  export function isLinear(f: Fill | null | undefined): f is LinearGradient;
  export function isRadial(f: Fill | null | undefined): f is RadialGradient;
  export function radialMatrix(g: RadialGradient): Mat; // [a−c, b−c, c] in SVG matrix() order
  export function flatIfDegenerate(g: Gradient): Fill;
  ```
- Produces (attrs.ts): `GradientDef = { id: string; tag: "linearGradient" | "radialGradient"; attrs: Attrs; stops: Attrs[] }`.

- [ ] **Step 1: Failing model tests** — append to `src/__tests__/gradient-model.test.ts` (reuse its `red`/`clear`/`grad` fixtures and imports; add `isLinear, isRadial, radialMatrix, type RadialGradient`):

```ts
const rad = (c: [number, number], a: [number, number], b: [number, number]): RadialGradient => ({
  kind: "radial",
  center: { x: c[0], y: c[1] },
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  start: red,
  end: clear,
});

describe("radial gradients in the model (spec M16 §2)", () => {
  it("narrows the two kinds", () => {
    const r = rad([0, 0], [10, 0], [0, 10]);
    expect(isGradient(r)).toBe(true);
    expect(isRadial(r)).toBe(true);
    expect(isLinear(r)).toBe(false);
    expect(isLinear(grad(0, 0, 10, 0))).toBe(true);
    expect(isRadial(red)).toBe(false);
  });

  it("treats a linear and a radial with the same colours as different fills", () => {
    const r = rad([0, 0], [10, 0], [0, 10]);
    expect(sameFill(r, rad([0, 0], [10, 0], [0, 10]))).toBe(true);
    expect(sameFill(r, rad([0, 0], [10, 0], [0, 11]))).toBe(false);
    expect(sameColours(r, rad([5, 5], [9, 5], [5, 9]))).toBe(true);
    expect(sameColours(r, grad(0, 0, 10, 0))).toBe(false);
  });

  it("builds the unit-circle matrix from the three points", () => {
    expect(radialMatrix(rad([50, 40], [80, 40], [50, 50]))).toEqual([30, 0, 0, 10, 50, 40]);
  });

  it("collapses a radial whose matrix is singular as written to its end stop", () => {
    expect(flatIfDegenerate(rad([0, 0], [10, 0], [20, 0]))).toEqual(clear); // rims on one line
    expect(flatIfDegenerate(rad([0, 0], [1e-7, 0], [0, 1e-7]))).toEqual(clear); // rounds to 0
    const r = rad([0, 0], [10, 0], [0, 10]);
    expect(flatIfDegenerate(r)).toBe(r);
  });

  it("mapStyle maps all three radial points, skew included", () => {
    const s: Style = { ...DEFAULT_STYLE, fill: rad([0, 0], [10, 0], [0, 10]) };
    expect(mapStyle(s, [1, 0, 0.5, 1, 0, 0]).fill).toEqual(rad([0, 0], [10, 0], [5, 10]));
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/gradient-model.test.ts` — expect FAIL (exports missing).

- [ ] **Step 3: Implement in `document.ts`.** Add the types after `LinearGradient` and replace the helpers:

```ts
/** Spec M16 §2: the unit circle carried by the affine map whose columns are `a − center` and
 *  `b − center`. Perpendicular and equal is a circle; anything else is an ellipse — and because it
 *  is three points under an affine map, every bake stays exact by mapping the three points. */
export type RadialGradient = {
  kind: "radial";
  center: Vec;
  a: Vec;
  b: Vec;
  start: Paint;
  end: Paint;
};
export type Gradient = LinearGradient | RadialGradient;
export type Fill = Paint | Gradient;

export function isGradient(f: Fill | null | undefined): f is Gradient {
  return f !== null && f !== undefined && "kind" in f;
}
export const isLinear = (f: Fill | null | undefined): f is LinearGradient =>
  isGradient(f) && f.kind === "linear";
export const isRadial = (f: Fill | null | undefined): f is RadialGradient =>
  isGradient(f) && f.kind === "radial";

/** `[a−c, b−c, c]` in SVG `matrix()` order: the unit circle → the end-stop ellipse. */
export function radialMatrix(g: RadialGradient): Mat {
  const { center: c, a, b } = g;
  return [a.x - c.x, a.y - c.y, b.x - c.x, b.y - c.y, c.x, c.y];
}
```

`sameFill`: kinds must match; linear compares `from`/`to`, radial compares `center`/`a`/`b`; both compare stops. `sameColours`: kinds must match (a flat and a gradient never match), then stops. `flatIfDegenerate(g: Gradient)`: linear as today; radial — compute the determinant from the `written()`-rounded coordinates of `a − center` and `b − center`; `=== 0` → `g.end`. `mapFill`: radial maps `center`, `a`, `b` through `applyMat`, then `flatIfDegenerate`. `mapStyle`'s guard stays `isGradient`.

- [ ] **Step 4: Run model tests** — PASS.

- [ ] **Step 5: Failing export tests** — append to `src/__tests__/serialize.test.ts`, beside M15's `gradients (spec M15 §3)` block (reuse its fixture style: a rect `n12` with `style.fill` set):

```ts
describe("radial gradients (spec M16 §3)", () => {
  const withFill = (fill: RadialGradient) => {
    const d = createDoc(200, 100);
    const child: Node = {
      kind: "rect", id: "n12", transform: IDENTITY,
      style: { ...DEFAULT_STYLE, fill }, x: 0, y: 0, w: 100, h: 50, rx: 0,
    };
    return { ...d, layers: [{ ...d.layers[0], children: [child] }] };
  };
  const stopsOf = { start: { color: "#ff3366", opacity: 1 }, end: { color: "#ff3366", opacity: 0 } };

  it("writes a circle plainly as cx cy r", () => {
    const out = serializeDoc(withFill({ kind: "radial", center: { x: 50, y: 40 }, a: { x: 80, y: 40 }, b: { x: 50, y: 70 }, ...stopsOf }));
    expect(out).toContain('<radialGradient id="sv-grad-n12-fill" gradientUnits="userSpaceOnUse" cx="50" cy="40" r="30">');
    expect(out).toContain('fill="url(#sv-grad-n12-fill)"');
  });

  it("writes anything else as the unit circle under a matrix", () => {
    const out = serializeDoc(withFill({ kind: "radial", center: { x: 50, y: 40 }, a: { x: 80, y: 40 }, b: { x: 50, y: 50 }, ...stopsOf }));
    expect(out).toContain('<radialGradient id="sv-grad-n12-fill" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(30 0 0 10 50 40)">');
  });
});
```

- [ ] **Step 6: Run** — FAIL.

- [ ] **Step 7: Implement export.** `attrs.ts`: `GradientDef` gains `tag`; `gradientDefs` pushes `tag: "linearGradient"` with today's attrs for linear, and for radial:

```ts
/** Spec M16 §3: a circle, as written, is `cx cy r`; anything else is the unit circle under its
 *  matrix. `fx`/`fy`/`fr` are never written — they default to the centre and 0. */
function radialAttrs(id: string, g: RadialGradient): Attrs {
  const m = radialMatrix(g).map(fmt);
  const circle = m[1] === "0" && m[2] === "0" && m[0] === m[3] && Number(m[0]) > 0;
  return circle
    ? { id, gradientUnits: "userSpaceOnUse", cx: m[4], cy: m[5], r: m[0] }
    : { id, gradientUnits: "userSpaceOnUse", cx: "0", cy: "0", r: "1", gradientTransform: `matrix(${m.join(" ")})` };
}
```

`paintAttrs`'s `url(#…)` branch already covers both kinds (`isGradient`). `serialize.ts` `defsElement`: `element(g.tag, g.attrs, …)` instead of the literal `"linearGradient"`. `NodeView.svelte`: render `{#if g.tag === "radialGradient"}<radialGradient {...g.attrs}>…stops…</radialGradient>{:else}<linearGradient …>…</linearGradient>{/if}` (Svelte needs a literal element name).

- [ ] **Step 8: Keep everything compiling.** `isGradient` now also admits radials, so every site that reads `.from`/`.to` after `isGradient` must narrow with `isLinear`. Radial behaviour for those sites arrives later — leave radials untouched there for now:
  - `src/doc/paint-edit.ts`: `setGradientPoints`, `drawGradientLine`, `setPaintKind`'s linear branch and `restored()` — use `isLinear` where they need linear geometry; `RememberedGradient.g` becomes `Gradient` and `restored()` maps whichever points the kind has (`center`/`a`/`b` for radial, via the same `map`). Task 3 adds the radial edits.
  - `src/tools/gradient-handles.ts`: skip radial paints (`if (!isLinear(f)) continue;`). Task 5 adds radial handles.
  - `src/svg/gradient-import.ts`: the final bounds check reads points per kind (only linear is produced yet).
  - Run `npx tsc --noEmit` / `npx svelte-check` and narrow any other site the same way.

- [ ] **Step 9: Failing bake tests** — append to `src/__tests__/gradient-bake.test.ts` (its `doc`, `findNode`, `resizeNodes`, `flattenTransform`, `combine`, `booleanShapes` imports are already there; add a radial fixture):

```ts
describe("bakes carry a radial gradient (spec M16 §2)", () => {
  const circle: RadialGradient = {
    kind: "radial", center: { x: 50, y: 25 }, a: { x: 100, y: 25 }, b: { x: 50, y: 75 },
    start: { color: "#ff0000", opacity: 1 }, end: { color: "#0000ff", opacity: 1 },
  };
  const rrect = (id: string, t: Mat = IDENTITY): Node => ({
    kind: "rect", id, transform: t, style: { ...DEFAULT_STYLE, fill: circle }, x: 0, y: 0, w: 100, h: 50, rx: 0,
  });
  const radOf = (d: Doc, id: string) => (findNode(d, id)!.node as Shape).style.fill as RadialGradient;

  it("a non-uniform resize stretches the circle into an ellipse", () => {
    const out = resizeNodes(doc([rrect("a")]), ["a"], [2, 0, 0, 1, 0, 0]);
    expect(radOf(out, "a")).toEqual({ ...circle, center: { x: 100, y: 25 }, a: { x: 200, y: 25 }, b: { x: 100, y: 75 } });
  });

  it("flatten bakes the transform into all three points", () => {
    const p: Node = { kind: "path", id: "p", transform: translate(10, 0), style: { ...DEFAULT_STYLE, fill: circle },
      subpaths: [{ closed: true, nodes: [[0, 0], [100, 0], [100, 50], [0, 50]].map(([x, y]) => ({ p: { x, y }, in: null, out: null, type: "corner" as const })) }] };
    expect(radOf(flattenTransform(doc([p]), ["p"]), "p").center).toEqual({ x: 60, y: 25 });
  });

  it("an odd polygon's vertical flip keeps the rendered ellipse where L puts it", () => {
    const poly: Node = { kind: "polygon", id: "t", transform: IDENTITY, style: { ...DEFAULT_STYLE, fill: circle },
      sides: 3, star: false, innerRatio: 0.5, cx: 50, cy: 25, rx: 40, ry: 20 };
    const L: Mat = [1, 0, 0, -1, 0, 50];
    const out = findNode(resizeNodes(doc([poly]), ["t"], L), "t")!.node as Shape;
    const g = out.style.fill as RadialGradient;
    const rendered = (p: { x: number; y: number }) => applyMat(out.transform, p);
    for (const k of ["center", "a", "b"] as const) {
      const want = applyMat(L, circle[k]);
      expect(rendered(g[k]).x).toBeCloseTo(want.x, 9);
      expect(rendered(g[k]).y).toBeCloseTo(want.y, 9);
    }
  });
});
```

(import `applyMat` from `../geom/mat` and `type RadialGradient`.) Combine and booleans go through `mapStyle` with no radial-specific code; one combine assertion (front shape `translate(50,0)` → `center.x` 100) is enough — add it in the same block.

- [ ] **Step 10: Run the bake tests** — they should PASS once Step 3's `mapFill` handles radials (the bake sites need no change — confirm; if a site bypasses `mapStyle`, fix the site). Then `npm test && npm run build && npm run lint`.

- [ ] **Step 11: Commit** — `feat(M16): radial gradient model, export and bakes`.

---

### Task 2: Import

**Files:**
- Modify: `src/svg/gradient-import.ts`, `src/svg/parse.ts`
- Test: `src/__tests__/gradient-import.test.ts`, `src/__tests__/gradient-roundtrip.test.ts`, `src/__tests__/parse.test.ts` (only tests that expect the retired "radial gradients" label)

**Interfaces:**
- Consumes: Task 1's `RadialGradient`, `flatIfDegenerate`.
- Produces:
  ```ts
  export type RawRadial = {
    units: "user" | "bbox";
    cx: Len; cy: Len; r: Len;
    fx: Len | null; fy: Len | null; fr: Len | null; // null = absent (defaults: cx, cy, 0)
    transform: Mat | null;
    spread: string;
    stops: RawStop[];
  };
  export type Resolved =
    | { kind: "linear"; g: RawLinear }
    | { kind: "radial"; g: RawRadial }
    | { kind: "drop"; label: string }
    | { kind: "missing" };
  export function foldRadial(g: RawRadial, box: Box | null, viewport: { w: number; h: number }, opacity: number): Folded;
  ```
- Drop labels (exact): `"radial gradients with a focal point"`, `"radial gradients with an inner stop"`, plus M15's `"gradients with more than two stops"`, `"repeating gradients"`, `"gradients with an invalid transform"`, `"gradients on zero-size shapes"`, `"invalid gradient coordinates"`. The label `"radial gradients"` is retired.

- [ ] **Step 1: Failing resolver tests** — append to `src/__tests__/gradient-import.test.ts` (reuse its `svg`, `resolve`, `box`, `view`, `close`, `stops2` helpers; add `foldRadial`, `isRadial`, `type RawRadial`, `type RadialGradient`):

```ts
const radial = (defs: string, id = "g"): RawRadial => {
  const r = resolve(defs, id);
  if (r.kind !== "radial") throw new Error(`not radial: ${JSON.stringify(r)}`);
  return r.g;
};
const radOk = (g: RawRadial, b = box, o = 1): RadialGradient => {
  const f = foldRadial(g, b, view, o);
  if (f.kind !== "fill" || !isRadial(f.fill)) throw new Error(JSON.stringify(f));
  return f.fill;
};
const userR = (attrs: string, stops = stops2) =>
  radial(`<radialGradient id="g" gradientUnits="userSpaceOnUse" ${attrs}>${stops}</radialGradient>`);

describe("foldRadial (spec M16 §4)", () => {
  it("keeps a userSpaceOnUse circle as centre and two rim points", () => {
    const f = radOk(userR('cx="50" cy="40" r="30"'));
    close(f.center, 50, 40); close(f.a, 80, 40); close(f.b, 50, 70);
    expect(f.end).toEqual({ color: "#0000ff", opacity: 0.5 });
  });

  it("keeps an ellipse given as the unit circle under a matrix", () => {
    const f = radOk(userR('cx="0" cy="0" r="1" gradientTransform="matrix(30 0 0 10 50 40)"'));
    close(f.center, 50, 40); close(f.a, 80, 40); close(f.b, 50, 50);
  });

  it("maps objectBoundingBox defaults through a non-square box into an ellipse, exactly", () => {
    const f = radOk(radial(`<radialGradient id="g">${stops2}</radialGradient>`), { x: 0, y: 0, w: 200, h: 100 });
    close(f.center, 100, 50); close(f.a, 200, 50); close(f.b, 100, 100);
    // Sampled against the source: s(q) = |((q − box.xy)/(w, h)) − (.5, .5)| / .5.
    const M = [f.a.x - f.center.x, f.a.y - f.center.y, f.b.x - f.center.x, f.b.y - f.center.y];
    const det = M[0] * M[3] - M[1] * M[2];
    const model = (q: { x: number; y: number }) => {
      const x = q.x - f.center.x, y = q.y - f.center.y;
      return Math.hypot((M[3] * x - M[2] * y) / det, (-M[1] * x + M[0] * y) / det);
    };
    for (const q of [{ x: 30, y: 20 }, { x: 170, y: 90 }, { x: 100, y: 5 }]) {
      expect(model(q)).toBeCloseTo(Math.hypot(q.x / 200 - 0.5, q.y / 100 - 0.5) / 0.5, 9);
    }
  });

  it("reads a userSpaceOnUse % radius against the viewport's normalised diagonal", () => {
    const f = radOk(userR('cx="0" cy="0" r="10%"'));
    close(f.a, Math.sqrt((400 * 400 + 300 * 300) / 2) / 10, 0);
  });

  it("folds a last stop below 1 into the rim", () => {
    const f = radOk(userR('cx="50" cy="40" r="30"', '<stop offset="0" stop-color="#ff0000"/><stop offset="0.5" stop-color="#0000ff"/>'));
    close(f.a, 65, 40); close(f.b, 50, 55);
  });

  it("drops what the model cannot draw exactly", () => {
    const d = (attrs: string, stops = stops2) => foldRadial(userR(attrs, stops), box, view, 1);
    expect(d('cx="50" cy="40" r="30" fx="60"')).toEqual({ kind: "drop", label: "radial gradients with a focal point" });
    expect(d('cx="50" cy="40" r="30" fr="5"')).toEqual({ kind: "drop", label: "radial gradients with a focal point" });
    expect(d('cx="50" cy="40" r="30"', '<stop offset="0.2"/><stop offset="1"/>')).toEqual({ kind: "drop", label: "radial gradients with an inner stop" });
    expect(d('cx="50" cy="40" r="30"', '<stop offset="0"/><stop offset="0.5"/><stop offset="1"/>')).toEqual({ kind: "drop", label: "gradients with more than two stops" });
    expect(d('cx="50" cy="40" r="30" spreadMethod="repeat"')).toEqual({ kind: "drop", label: "repeating gradients" });
    expect(d('cx="0" cy="0" r="100" gradientTransform="scale(1e8)"')).toEqual({ kind: "drop", label: "invalid gradient coordinates" });
    expect(d('cx="0" cy="0" r="1" gradientTransform="scale(0)"')).toEqual({ kind: "drop", label: "gradients with an invalid transform" });
  });

  it("an explicit fx/fy equal to the centre is not a focal point", () => {
    expect(isRadial(foldRadial(userR('cx="50" cy="40" r="30" fx="50" fy="40"'), box, view, 1).fill as never)).toBe(true);
  });

  it("paints r = 0 as the last stop, flat", () => {
    expect(foldRadial(userR('cx="50" cy="40" r="0"'), box, view, 1)).toEqual({ kind: "fill", fill: { color: "#0000ff", opacity: 0.5 } });
  });

  it("follows an href from a radial to a linear holding the stops", () => {
    const g = radial(`<linearGradient id="s">${stops2}</linearGradient><radialGradient id="g" href="#s" gradientUnits="userSpaceOnUse" cx="10" cy="10" r="5"/>`);
    expect(g.stops).toHaveLength(2);
    close(radOk(g).a, 15, 10);
  });
});
```

Also change M15's existing test that expects `resolve('<radialGradient …>')` to drop with `"radial gradients"`: it now resolves to `{ kind: "radial", … }` — assert that instead.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement.** `resolveServer`: for `radialGradient`, build `RawRadial` with the same chain `attr()` lookup and the same stops rule:

```ts
      cx: len(attr("cx"), { v: 50, pct: true }),
      cy: len(attr("cy"), { v: 50, pct: true }),
      r: len(attr("r"), { v: 50, pct: true }),
      fx: attr("fx") === undefined ? null : len(attr("fx"), { v: 50, pct: true }),
      fy: attr("fy") === undefined ? null : len(attr("fy"), { v: 50, pct: true }),
      fr: attr("fr") === undefined ? null : len(attr("fr"), { v: 0, pct: false }),
```

`foldRadial` (spec §4), reusing M15's structure:

```ts
/** Spec M16 §4: a radial with no focal offset is the unit circle under `A · [r, 0, 0, r, cx, cy]`
 *  — exact for any invertible `A`. A first stop above 0 would paint a solid disc the model cannot
 *  draw; a last stop below 1 simply shrinks the rim. */
export function foldRadial(g: RawRadial, box: Box | null, viewport: { w: number; h: number }, opacity: number): Folded {
  const stops = g.stops.map((s) => ({ color: s.color, opacity: s.opacity * opacity }));
  if (g.stops.length === 0) return { kind: "fill", fill: null };
  if (g.stops.length === 1) return { kind: "fill", fill: stops[0] };
  if (g.stops.length > 2 || g.stops[1].offset <= g.stops[0].offset) return { kind: "drop", label: "gradients with more than two stops" };
  if (g.stops[0].offset > 0) return { kind: "drop", label: "radial gradients with an inner stop" };
  if (g.spread !== "pad") return { kind: "drop", label: "repeating gradients" };
  if (!g.transform) return { kind: "drop", label: "gradients with an invalid transform" };

  let unit: Mat = IDENTITY;
  let x: (l: Len) => number;
  let y: (l: Len) => number;
  let len: (l: Len) => number;
  if (g.units === "bbox") {
    if (!box || box.w <= 0 || box.h <= 0) return { kind: "drop", label: "gradients on zero-size shapes" };
    unit = [box.w, 0, 0, box.h, box.x, box.y];
    x = y = len = (l) => (l.pct ? l.v / 100 : l.v);
  } else {
    const diag = Math.sqrt((viewport.w ** 2 + viewport.h ** 2) / 2);
    x = (l) => (l.pct ? (l.v / 100) * viewport.w : l.v);
    y = (l) => (l.pct ? (l.v / 100) * viewport.h : l.v);
    len = (l) => (l.pct ? (l.v / 100) * diag : l.v);
  }
  const cx = x(g.cx), cy = y(g.cy), r = len(g.r);
  const fx = g.fx ? x(g.fx) : cx, fy = g.fy ? y(g.fy) : cy, fr = g.fr ? len(g.fr) : 0;
  if (fx !== cx || fy !== cy || fr !== 0) return { kind: "drop", label: "radial gradients with a focal point" };
  if (r < 0) return { kind: "drop", label: "invalid gradient coordinates" };
  if (r === 0) return { kind: "fill", fill: stops[1] };
  const A = multiply(unit, g.transform);
  if (!invert(A)) return { kind: "drop", label: "gradients with an invalid transform" };
  const o1 = g.stops[1].offset;
  const fill = flatIfDegenerate({
    kind: "radial",
    center: applyMat(A, { x: cx, y: cy }),
    a: applyMat(A, { x: cx + r * o1, y: cy }),
    b: applyMat(A, { x: cx, y: cy + r * o1 }),
    start: stops[0],
    end: stops[1],
  });
  // Invariant 8, as in foldLinear.
  …bounds check of center/a/b (non-finite or > MAX_COORD → "invalid gradient coordinates")…
  return { kind: "fill", fill };
}
```

Factor the bounds check into one local helper used by both folds (a `Gradient`'s points by kind). `parse.ts` `resolveRef`: dispatch `res.kind === "radial"` to `foldRadial` with the same box/viewport/opacity.

- [ ] **Step 4: Round-trip tests** — append to `src/__tests__/gradient-roundtrip.test.ts`: a document with one ellipse (`kind: "ellipse"`, transform `[0.8, 0.6, -0.6, 0.8, 10, 20]`) whose fill is a radial **circle** (`center (50,40) a (80,40) b (50,70)`) and whose stroke is a radial **ellipse** (`center (50,40) a (80,43) b (47,52)` — a skewed one); `parseSvg(serializeDoc(d))` has `dropped: []`, `native: true`, and the child equals the original (`stripIds`). Update M15's test "drops radial gradients and patterns by name" — the radial now imports (assert `isRadial` on the fill, and the stroke's pattern still reports "patterns").

- [ ] **Step 5: Run everything** — `npm test && npm run build && npm run lint`.

- [ ] **Step 6: Commit** — `feat(M16): import radial gradients exactly`.

---

### Task 3: Paint edits

**Files:**
- Modify: `src/doc/paint-edit.ts`
- Test: `src/__tests__/paint-edit.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  export type GradientKind = "linear" | "radial";
  export function toRadial(g: Gradient): RadialGradient; // linear: center=from, a=to, b=from+perp(to−from); radial: itself
  export function toLinear(g: Gradient): LinearGradient; // radial: from=center, to=a; linear: itself
  export function setPaintKind(doc, ids, which, kind: "flat" | GradientKind, remembered?): Doc;
  export function convertGradients(doc, ids, which, kind: GradientKind): Doc; // gradients only; flats untouched
  export function setGradientGeometry(doc: Doc, id: string, which: PaintSlot, next: Gradient): Doc; // own space; keeps the CURRENT stops; same kind only
  export function drawGradientLine(doc, ids, which, from: Vec, to: Vec, kind?: GradientKind): Doc; // default "linear"
  // RememberedGradient.g: Gradient
  ```
  `perp(v) = { x: -v.y, y: v.x }`. `setGradientPoints` stays for now (the tool still uses it); Task 5 removes it.

- [ ] **Step 1: Failing tests** — append to `src/__tests__/paint-edit.test.ts` (reuse `red`, `blue`, `lin`, `rect`, `doc`, `fill`):

```ts
const rad0 = (c: [number, number], a: [number, number], b: [number, number]): RadialGradient => ({
  kind: "radial", center: { x: c[0], y: c[1] }, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, start: red, end: blue,
});

describe("radial edits (spec M16 §5–§6)", () => {
  it("Flat→Radial draws a circle centred on the box, radius half its larger side", () => {
    expect(fill(setPaintKind(doc([rect("a", 0, red)]), ["a"], "fill", "radial"), "a")).toEqual({
      kind: "radial", center: { x: 50, y: 25 }, a: { x: 100, y: 25 }, b: { x: 50, y: 75 }, start: red, end: { ...red, opacity: 0 },
    });
  });

  it("converts linear ↔ radial keeping the stops", () => {
    expect(toRadial(lin(0, 10))).toEqual(rad0([0, 0], [10, 0], [0, 10]));
    expect(toLinear(rad0([0, 0], [10, 0], [0, 10]))).toEqual(lin(0, 10));
    const d = doc([rect("a", 0, lin(0, 10)), rect("b", 0, red)]);
    const out = convertGradients(d, ["a", "b"], "fill", "radial");
    expect(fill(out, "a")).toEqual(rad0([0, 0], [10, 0], [0, 10]));
    expect(findNode(out, "b")!.node).toBe(findNode(d, "b")!.node);
    expect(convertGradients(out, ["a"], "fill", "radial")).toBe(out);
  });

  it("Linear→Radial through setPaintKind converts instead of starting over", () => {
    expect(fill(setPaintKind(doc([rect("a", 0, lin(0, 10))]), ["a"], "fill", "radial"), "a")).toEqual(rad0([0, 0], [10, 0], [0, 10]));
  });

  it("setGradientGeometry keeps the current stops and collapses a singular radial", () => {
    const d = doc([rect("a", 0, rad0([0, 0], [10, 0], [0, 10]))]);
    const moved = setGradientGeometry(d, "a", "fill", { ...rad0([5, 5], [15, 5], [5, 15]), start: blue, end: red });
    expect(fill(moved, "a")).toEqual(rad0([5, 5], [15, 5], [5, 15]));
    expect(fill(setGradientGeometry(d, "a", "fill", rad0([0, 0], [0, 0], [0, 10])), "a")).toEqual(blue);
    expect(setGradientGeometry(d, "a", "fill", rad0([0, 0], [10, 0], [0, 10]))).toBe(d);
  });

  it("drawGradientLine with kind radial draws a document-space circle into each shape", () => {
    const group: Node = { kind: "group", id: "g", transform: translate(0, 100), opacity: 1, children: [rect("b", 0, red)] };
    const out = drawGradientLine(doc([rect("a", 0, lin(0, 10)), group]), ["a", "g"], "fill", { x: 0, y: 110 }, { x: 10, y: 110 }, "radial");
    expect(fill(out, "a")).toEqual(rad0([0, 110], [10, 110], [0, 120]));
    expect(fill(out, "b")).toEqual({ kind: "radial", center: { x: 0, y: 10 }, a: { x: 10, y: 10 }, b: { x: 0, y: 20 }, start: red, end: { ...red, opacity: 0 } });
  });

  it("remembers a radial across Flat and restores it, converting when Linear is asked for", () => {
    const r = rad0([50, 25], [100, 25], [50, 75]);
    const d = doc([rect("a", 0, r)]);
    const memory = new Map(gradientsToRemember(d, ["a"], "fill"));
    const flat = setPaintKind(d, ["a"], "fill", "flat");
    const recall = (id: string) => memory.get(id);
    expect(fill(setPaintKind(flat, ["a"], "fill", "radial", recall), "a")).toEqual({ ...r, end: blue });
    expect(fill(setPaintKind(flat, ["a"], "fill", "linear", recall), "a")).toEqual({ kind: "linear", from: r.center, to: r.a, start: red, end: blue });
  });
});
```

(Import `convertGradients, setGradientGeometry, toLinear, toRadial` and `type RadialGradient`.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement.** `setPaintKind`: `"flat"` as today; a gradient already of the requested kind → unchanged; a gradient of the other kind → converted (`toRadial`/`toLinear`); a flat paint → the remembered gradient (restored to the current box, then converted to the requested kind), else the default for that kind (linear: today's fade; radial: circle at box centre with radius `max(w, h) / 2`, unchanged shape when that radius is 0). `convertGradients`: only gradients, via `toRadial`/`toLinear` + `withFill`. `setGradientGeometry`: `mapNodes` on `id`; only if the current paint is a gradient of `next.kind`; stores `flatIfDegenerate({ ...next, start: current.start, end: current.end })`. `drawGradientLine(…, kind = "linear")`: radial → document-space `center = from`, `a = to`, `b = from + perp(to − from)`, each mapped into the shape's own space through the inverse world; an existing gradient keeps its stops (any kind), a flat/null paint gets the fade stops as today. `restored()` maps whichever points the remembered kind has.

- [ ] **Step 4: Run** — PASS; `npm test && npm run build && npm run lint`.

- [ ] **Step 5: Commit** — `feat(M16): radial paint edits — defaults, conversion, geometry, drawing`.

---

### Task 4: Store and panel

**Files:**
- Modify: `src/state/appState.svelte.ts`, `src/state/properties.ts`, `src/lib/PaintField.svelte`, `src/lib/PropertiesPanel.svelte`
- Test: `src/__tests__/gradient-store.test.ts`, `src/__tests__/properties.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  ```ts
  app.gradientType: GradientKind          // $state, default "linear"; not saved, not undoable
  export function setGradientType(kind: GradientKind): void; // sets it; with a selection, converts the target paint's gradients (one undo step)
  export function setSelectionPaintKind(which: PaintSlot, kind: "flat" | GradientKind): void;
  // properties.ts
  GradientSummary.kind: Field<"flat" | "linear" | "radial">
  export function gradientTypeShown(styles: readonly Style[], which: PaintSlot, fallback: GradientKind): Field<GradientKind>;
  ```

- [ ] **Step 1: Failing tests.** `properties.test.ts`:

```ts
it("shows the selection's gradient kind in the Type row, falling back to the draw kind (spec M16 §5)", () => {
  const lin = { kind: "linear" as const, from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, start: { color: "#ff0000", opacity: 1 }, end: { color: "#0000ff", opacity: 1 } };
  const rad = { kind: "radial" as const, center: { x: 0, y: 0 }, a: { x: 1, y: 0 }, b: { x: 0, y: 1 }, start: lin.start, end: lin.end };
  const s = (fill: Style["fill"]): Style => ({ ...DEFAULT_STYLE, fill });
  expect(gradientTypeShown([s(rad), s(lin.start)], "fill", "linear")).toEqual({ mixed: false, value: "radial" });
  expect(gradientTypeShown([s(rad), s(lin)], "fill", "linear")).toEqual({ mixed: true });
  expect(gradientTypeShown([s(lin.start)], "fill", "radial")).toEqual({ mixed: false, value: "radial" });
  expect(summarizeGradient([s(rad)], "fill")?.kind).toEqual({ mixed: false, value: "radial" });
});
```

`gradient-store.test.ts` (reuse its setup — two red rects `a`, `b`, both selected):

```ts
describe("Type switch (spec M16 §5)", () => {
  it("converts the selection's gradients in one undo step and leaves flat paints alone", () => {
    setSelection(["a"]);
    setSelectionPaintKind("fill", "linear");
    setSelection(["a", "b"]);
    const bBefore = styleOf("b").fill;
    setGradientType("radial");
    expect(app.gradientType).toBe("radial");
    expect(isRadial(styleOf("a").fill)).toBe(true);
    expect(styleOf("b").fill).toBe(bBefore);
    undo();
    expect(isLinear(styleOf("a").fill)).toBe(true);
  });

  it("with nothing to convert only sets the kind to draw", () => {
    setSelection([]);
    setGradientType("radial");
    expect(app.gradientType).toBe("radial");
  });

  it("Flat→Radial from the panel", () => {
    setSelection(["a"]);
    setSelectionPaintKind("fill", "radial");
    expect(isRadial(styleOf("a").fill)).toBe(true);
  });
});
```

(reset `app.gradientType` to `"linear"` in `beforeEach` via `setGradientType("linear")` after `replaceDocument`, or directly — whichever the file's style allows.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement the store.** `gradientType = $state<GradientKind>("linear")` beside `gradientTarget`, with a JSDoc like its neighbours. `setGradientType(kind)`: `cancelActiveGesture()`; `app.gradientType = kind`; if the selection is non-empty, `commitDoc(convertGradients(app.doc, app.selection, app.gradientTarget, kind))` (a no-op edit returns the same doc, so no empty undo step). `setSelectionPaintKind(which, kind: "flat" | GradientKind)` — the memory code is unchanged.

- [ ] **Step 4: Summaries.** `summarizeGradient`'s `kind` maps each non-null paint to `"flat" | "linear" | "radial"` (`f.kind` for gradients). `gradientTypeShown`: the gradients among `styles.map(s => s[which])`; none → `{ mixed: false, value: fallback }`; else `merge` of their kinds.

- [ ] **Step 5: Panel.** `PaintField.svelte`: `kind: Field<"flat" | "linear" | "radial"> | null`, `onkind: (k: "flat" | "linear" | "radial") => void`; a third `ToggleButton` **Radial** after Linear, same pattern (disabled with nothing selected; titles "Radial gradient — select an object first" / "Radial gradient"). `PropertiesPanel.svelte`: the Gradient section gets a second `.field-row`, label "Type", with Linear/Radial `ToggleButton`s whose values come from `gradientTypeShown(selectionStyles(app.doc, app.selection), app.gradientTarget, app.gradientType)` (a `$derived`; when nothing is selected pass `[]`), each pressing `setGradientType(...)`. Two items per `.field-row` (invariant 23's parity rule). The row's title: "Kind of gradient the tool draws — converts the selection's gradients".

- [ ] **Step 6: Run** `npm test && npm run build && npm run lint` — 0/0.

- [ ] **Step 7: Commit** — `feat(M16): Radial in the paint fields and a Type row in the Gradient section`.

---

### Task 5: The tool — radial handles, drags and drawing

**Files:**
- Modify: `src/tools/gradient-handles.ts`, `src/tools/gradient-tool.ts`, `src/tools/tool.ts`, `src/tools/context.ts`, `src/__tests__/fake-context.ts`, `src/lib/Overlay.svelte`, `src/doc/paint-edit.ts` (remove `setGradientPoints` once unused)
- Test: `src/__tests__/gradient-tool.test.ts`

**Interfaces:**
- Consumes: Task 3 (`setGradientGeometry`, `drawGradientLine(…, kind)`), Task 4 (`app.gradientType`).
- Produces:
  ```ts
  // tool.ts — ToolContext gains
  gradientType(): GradientKind;
  // gradient-handles.ts
  export type GradientHandle =
    | { kind: "linear"; id: string; from: Vec; to: Vec; start: Paint; end: Paint; world: Mat }
    | { kind: "radial"; id: string; center: Vec; a: Vec; b: Vec; start: Paint; end: Paint; world: Mat };
  export type HandlePart = "start" | "end" | "line" | "center" | "rimA" | "rimB";
  export type HandlePick = { h: GradientHandle; part: HandlePart } | null;
  ```
  Pick order (unchanged principle): knobs of every handle first (frontmost first), then lines. Radial knobs: center, rimA, rimB; radial lines: center→a and center→b (both part `"line"`). A tap maps `center`/`start` → the start stop, `rimA`/`rimB`/`end` → the end stop.

- [ ] **Step 1: Failing tests** — append to `src/__tests__/gradient-tool.test.ts` (reuse `rect`, `doc`, `fillOf`, `drag`, `ev`, `fakeContext`; the fake state gains `gradientType`, set it per test):

```ts
const circleFill: RadialGradient = { kind: "radial", center: { x: 50, y: 25 }, a: { x: 100, y: 25 }, b: { x: 50, y: 75 }, start: red, end: blue };
const radialCtx = (fillValue: Shape["style"]["fill"] = circleFill) => {
  const f = fakeContext(doc([rect("a", 0, fillValue)]));
  f.ctx.setSelection(["a"]);
  f.state.gradientType = "radial";
  return f;
};
const rOf = (ctx: ReturnType<typeof fakeContext>["ctx"]) => fillOf(ctx.doc(), "a") as RadialGradient;
const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

describe("radial handles and drags (spec M16 §6)", () => {
  it("picks the centre, both rims and the lines", () => {
    const hs = gradientHandles(doc([rect("a", 0, circleFill)]), ["a"], "fill");
    expect(pickHandle(hs, { x: 50, y: 25 }, 6)?.part).toBe("center");
    expect(pickHandle(hs, { x: 100, y: 25 }, 6)?.part).toBe("rimA");
    expect(pickHandle(hs, { x: 50, y: 75 }, 6)?.part).toBe("rimB");
    expect(pickHandle(hs, { x: 75, y: 26 }, 6)?.part).toBe("line");
  });

  it("draws a document-space circle with Type = Radial", () => {
    const { ctx } = radialCtx(red);
    drag(createGradientTool(), ctx, [[50, 25], [65, 25], [80, 25]]);
    expect(rOf(ctx)).toEqual({ kind: "radial", center: { x: 50, y: 25 }, a: { x: 80, y: 25 }, b: { x: 50, y: 55 }, start: red, end: { ...red, opacity: 0 } });
  });

  it("dragging the centre moves all three points", () => {
    const { ctx } = radialCtx();
    drag(createGradientTool(), ctx, [[50, 25], [60, 35]]);
    near(rOf(ctx).center, 60, 35); near(rOf(ctx).a, 110, 35); near(rOf(ctx).b, 60, 85);
  });

  it("rim A rotates and scales the whole ellipse about the centre", () => {
    const { ctx } = radialCtx();
    drag(createGradientTool(), ctx, [[100, 25], [70, 60], [50, 75]]);
    near(rOf(ctx).a, 50, 75); near(rOf(ctx).b, 0, 25); // +90°, scale 1
  });

  it("rim A with Shift snaps to 45° and scales B with it", () => {
    const { ctx } = radialCtx();
    drag(createGradientTool(), ctx, [[100, 25], [95, 30]], { shift: true });
    const s = Math.hypot(45, 5) / 50;
    near(rOf(ctx).a, 50 + 50 * s, 25); near(rOf(ctx).b, 50, 25 + 50 * s);
  });

  it("rim B moves alone, or stays perpendicular to A with Shift", () => {
    const free = radialCtx();
    drag(createGradientTool(), free.ctx, [[50, 75], [70, 70]]);
    near(rOf(free.ctx).b, 70, 70); near(rOf(free.ctx).a, 100, 25);
    const snapped = radialCtx();
    drag(createGradientTool(), snapped.ctx, [[50, 75], [70, 70]], { shift: true });
    near(rOf(snapped.ctx).b, 50, 70);
  });

  it("rim A keeps the ellipse's on-screen shape on a skewed shape (computed in document space)", () => {
    const f = fakeContext(doc([rect("a", 0, circleFill, [1, 0, 0.5, 1, 0, 0])]));
    f.ctx.setSelection(["a"]);
    const h = gradientHandles(f.ctx.doc(), ["a"], "fill")[0];
    if (h.kind !== "radial") throw new Error("radial expected");
    const tool = createGradientTool();
    drag(tool, f.ctx, [[h.a.x, h.a.y], [h.center.x, h.center.y + 50]]);
    const after = gradientHandles(f.ctx.doc(), ["a"], "fill")[0];
    if (after.kind !== "radial") throw new Error("radial expected");
    // On screen: A went from c+(50,0) to c+(0,50) — a +90° rotation at scale 1 — so B's on-screen
    // offset rotates by +90° as well.
    const before = { x: h.b.x - h.center.x, y: h.b.y - h.center.y };
    near({ x: after.b.x - after.center.x, y: after.b.y - after.center.y }, -before.y, before.x);
  });

  it("taps pick the start stop on the centre and the end stop on a rim", () => {
    const { ctx } = radialCtx();
    const tool = createGradientTool();
    tool.down(ctx, ev(50, 25)); tool.up(ctx, ev(50, 25));
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "start", which: "fill" });
    tool.down(ctx, ev(50, 75)); tool.up(ctx, ev(50, 75));
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "end", which: "fill" });
  });

  it("a rim dragged onto the centre collapses to the end colour", () => {
    const { ctx } = radialCtx();
    drag(createGradientTool(), ctx, [[100, 25], [70, 25], [50, 25]]);
    expect(fillOf(ctx.doc(), "a")).toEqual(blue);
  });
});
```

(Import `type RadialGradient`. Hit tolerance at zoom 1 is 6 for mouse; `(75, 26)` is 1px off the centre→A line and 25px from any knob.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Context.** `ToolContext.gradientType(): GradientKind` (JSDoc: the kind a drag draws, spec M16 §5); `context.ts`: `gradientType: () => app.gradientType`; `fake-context.ts`: `gradientType: GradientKind` in `FakeState` (default `"linear"`), and the member.

- [ ] **Step 4: Handles.** `gradientHandles` emits a `radial` handle (`center`, `a`, `b` through `world`) for radial paints; `pickHandle` checks, per handle from the end, linear `from`→`"start"`, `to`→`"end"`, radial `center`→`"center"`, `a`→`"rimA"`, `b`→`"rimB"`; then lines from the end (linear: from→to; radial: center→a, center→b).

- [ ] **Step 5: Tool.** Modes: `knob` carries `part`; `line` as today (for radial it translates all three points). Everything is computed in document space on the handle captured at the gesture's start, then mapped into own space with the handle's inverse `world` and committed via `setGradientGeometry(base, id, which, next)` (commit from the base — invariant 15). For radial:

```ts
const sub = (p: Vec, q: Vec) => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p: Vec, q: Vec) => ({ x: p.x + q.x, y: p.y + q.y });
/** Rim A: the similarity about `c` taking the old A to the new one, applied to B as well — the
 *  ellipse turns and grows but keeps its shape (spec M16 §6). */
function similarityB(c: Vec, a0: Vec, a1: Vec, b0: Vec): Vec | null {
  const u = sub(a0, c), v = sub(a1, c);
  const uu = u.x * u.x + u.y * u.y;
  if (uu === 0) return null;
  // v = k·u in complex terms: k = v / u.
  const kr = (v.x * u.x + v.y * u.y) / uu, ki = (v.y * u.x - v.x * u.y) / uu;
  const w = sub(b0, c);
  return add(c, { x: kr * w.x - ki * w.y, y: kr * w.y + ki * w.x });
}
```

rim B with Shift: `u = unit(a − c)`, `n = { x: -u.y, y: u.x }`, `b = c + n · dot(p − c, n)`. rim A with Shift: the M15 `constrain(c, p, true)`. A drawn radial: `drawGradientLine(base, ids, which, start, constrain(start, e.doc, shift), ctx.gradientType())` — linear draws pass `"linear"` as today. Remove `setGradientPoints` from `paint-edit.ts` once the tool no longer calls it (update its M15 tests to `setGradientGeometry`). Update the tool's `hint` to "Drag across the selection to draw a gradient · drag a knob or a line to adjust · Shift: 45°".

- [ ] **Step 6: Overlay.** For a radial handle draw: lines centre→A and centre→B (`LINE`), the dashed end-stop outline — 64 samples of `c + cos t·(a − c) + sin t·(b − c)` in document space → `docToScreen` → a `<polygon>` with `stroke-dasharray="4 3"` and `fill: none` — then the knobs: centre filled with the start colour, A and B with the end colour; the picked one gets the thicker stroke as for linear (`picked` is `"start"` for the centre, `"end"` for both rims).

- [ ] **Step 7: Run** `npm test && npm run build && npm run lint`.

- [ ] **Step 8: Commit** — `feat(M16): the Gradient tool draws and edits radial gradients`.

---

### Task 6: Docs

**Files:** `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`

- [ ] **Step 1: README** — extend the Gradients bullet: radial (circle/ellipse), the Type row, knobs (centre, two rims; Shift behaviours). Update "radial gradients / more stops" in the roadmap to "more gradient stops, focal points". Test count from the real `npm test`.
- [ ] **Step 2: CLAUDE.md** — architecture map mentions `RadialGradient` / `Gradient` / `radialMatrix`, `foldRadial`, the radial handles; invariant 46 gains the radial rules (three points under an affine map; circle written as `cx cy r`, else the unit circle under a matrix; import keeps radials without a focal offset whose first stop is at 0; degenerate = singular as written; linear ↔ radial conversion rule; Type row semantics). Current state: M16 done, M14 still next. Test count.
- [ ] **Step 3: CHANGELOG** — append `## 2026-09-27 — M16: radial gradients`: what shipped, spec §9 rulings, the browser verification record the controller supplies, what is owed an iPad pass, test count.
- [ ] **Step 4: Commit** — `docs(M16): README, CLAUDE.md invariant 46 and changelog`.
