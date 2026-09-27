# M15 Linear Gradients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-stop linear gradients on fill and stroke — saved as real SVG, imported exactly, edited in the Properties panel and with a new on-canvas Gradient tool (G).

**Architecture:** A gradient is a new `Fill` variant (`LinearGradient`) whose two points live in the shape's own space; export writes one `userSpaceOnUse` `<linearGradient>` per gradient paint; import folds every 2-stop pad-spread linear gradient into two points exactly; every geometry bake maps the points through one helper (`mapStyle`); the tool edits the points through pure edits in `doc/paint-edit.ts`.

**Tech Stack:** Svelte 5, TypeScript, Vitest (node env, no DOM), lucide icons.

**Spec:** `docs/superpowers/specs/2026-09-27-m15-linear-gradients-design.md` — read it before every task; section numbers below (§N) refer to it.

## Global Constraints

- `npm run build` must end with **0 errors, 0 warnings**; `npm test` all green; `npm run lint` clean.
- **The document is immutable** (CLAUDE.md invariant 1): an edit that changes nothing returns the SAME reference.
- **Canvas and export share `src/svg/attrs.ts`** (invariant 3).
- **Tools never import the store** (invariant 12); store actions that edit the document call `cancelActiveGesture()` first (invariant 15).
- **The importer never throws on unsupported content**; it reports it via `drop(label)` (invariant 4).
- A document **without** gradients must serialize **byte-identically** to before this milestone.
- Gradient element ids: `sv-grad-<node id>-fill` / `sv-grad-<node id>-stroke`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- One commit per task, on branch `m15-linear-gradients`. Pre-commit runs eslint --fix + prettier; let it.
- Match surrounding comment density and style: JSDoc `/** … */` comments that say *why*, citing the spec (`spec M15 §N`).

## Review Focus

1. **A shape resized, flipped or flattened with a gradient** — the gradient must stay visually attached (points baked through the same matrix); a mirror flip must mirror it. Tests in Task 4.
2. **Foreign files whose gradient is referenced from a group** (`<g fill="url(#g)">`) — each child resolves in its own space/box, not the group's. Test in Task 3.
3. **A multi-selection with mixed paints edited from the panel** — no shape may receive another shape's coordinates; a flat shape in the selection is untouched by a stop edit. Tests in Task 5.
4. **Knob drag on a rotated / grouped shape** — the knob follows the pointer exactly (inverse world matrix). Test in Task 7.
5. **Dragging one knob exactly onto the other** — the paint collapses to the end stop's flat colour instead of writing a gradient the importer would read back differently. Tests in Tasks 1 and 7.

---

### Task 1: Model and export

**Files:**
- Modify: `src/doc/document.ts` (types, helpers, `DEFAULT_STYLE` typing)
- Modify: `src/svg/attrs.ts` (`gradientId`, `gradientDefs`, `styleAttrs(s, id)`)
- Modify: `src/svg/serialize.ts` (`<defs>`)
- Modify: `src/lib/NodeView.svelte` (per-shape `<defs>`)
- Modify: `src/doc/edits.ts` (`styleMatches` uses `sameFill`)
- Modify: `src/doc/select-match.ts` (uses `sameColours`)
- Modify: `src/state/properties.ts` (`StyleSummary.fill/stroke: Field<Fill | null>`, merged with `sameColours`)
- Modify: `src/persist/preferences.ts` (`Prefs.style: FlatStyle`)
- Modify: `src/lib/PaintField.svelte` (accept `Field<Fill | null>`; a gradient shows no row yet — Task 6 adds it)
- Modify: `src/state/appState.svelte.ts` (`setSelectionStyle` with nothing selected writes only flat paints to prefs)
- Test: `src/__tests__/gradient-model.test.ts` (new), `src/__tests__/serialize.test.ts`

**Interfaces:**
- Produces (document.ts):
  ```ts
  export type LinearGradient = { kind: "linear"; from: Vec; to: Vec; start: Paint; end: Paint };
  export type Fill = Paint | LinearGradient;
  export type Style = { fill: Fill | null; stroke: Fill | null; strokeWidth: number; cap: LineCap; join: LineJoin; opacity: number };
  export type FlatStyle = Omit<Style, "fill" | "stroke"> & { fill: Paint | null; stroke: Paint | null };
  export const DEFAULT_STYLE: FlatStyle;
  export function isGradient(f: Fill | null | undefined): f is LinearGradient;
  export function samePaint(a: Paint, b: Paint): boolean;
  export function sameFill(a: Fill | null, b: Fill | null): boolean;
  export function sameColours(a: Fill | null, b: Fill | null): boolean;
  export function flatIfDegenerate(g: LinearGradient): Fill;
  export function mapStyle(s: Style, m: Mat): Style;
  ```
- Produces (attrs.ts): `gradientId(nodeId: string, which: "fill" | "stroke"): string`, `type GradientDef = { id: string; attrs: Attrs; stops: Attrs[] }`, `gradientDefs(s: Shape): GradientDef[]`, `styleAttrs(s: Style, id: string): Attrs`.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b m15-linear-gradients
```

- [ ] **Step 2: Write the failing model tests** — `src/__tests__/gradient-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  flatIfDegenerate,
  isGradient,
  mapStyle,
  sameColours,
  sameFill,
  type LinearGradient,
  type Style,
} from "../doc/document";
import { IDENTITY, translate } from "../geom/mat";
import { deepFreeze } from "./helpers";

const red = { color: "#ff0000", opacity: 1 };
const clear = { color: "#ff0000", opacity: 0 };
const grad = (fx: number, fy: number, tx: number, ty: number): LinearGradient => ({
  kind: "linear",
  from: { x: fx, y: fy },
  to: { x: tx, y: ty },
  start: red,
  end: clear,
});

describe("gradient model (spec M15 §2)", () => {
  it("tells a gradient from a flat paint", () => {
    expect(isGradient(grad(0, 0, 10, 0))).toBe(true);
    expect(isGradient(red)).toBe(false);
    expect(isGradient(null)).toBe(false);
  });

  it("sameFill is exact, sameColours ignores the points", () => {
    expect(sameFill(grad(0, 0, 10, 0), grad(0, 0, 10, 0))).toBe(true);
    expect(sameFill(grad(0, 0, 10, 0), grad(0, 0, 20, 0))).toBe(false);
    expect(sameColours(grad(0, 0, 10, 0), grad(5, 5, 20, 0))).toBe(true);
    expect(sameColours(grad(0, 0, 10, 0), { ...grad(0, 0, 10, 0), end: red })).toBe(false);
    expect(sameFill(red, grad(0, 0, 10, 0))).toBe(false);
    expect(sameColours(red, { ...red })).toBe(true);
    expect(sameFill(null, null)).toBe(true);
    expect(sameFill(null, red)).toBe(false);
  });

  it("collapses a gradient whose points coincide as written to its end stop", () => {
    expect(flatIfDegenerate(grad(1, 1, 1, 1))).toEqual(clear);
    // 1e-7 apart: equal after 6-decimal rounding, so it would reload as flat — collapse now.
    expect(flatIfDegenerate(grad(1, 1, 1 + 1e-7, 1))).toEqual(clear);
    const g = grad(0, 0, 1e-5, 0);
    expect(flatIfDegenerate(g)).toBe(g);
  });

  it("mapStyle keeps the same reference without gradients and maps both points with them", () => {
    const flat: Style = deepFreeze({ ...DEFAULT_STYLE });
    expect(mapStyle(flat, translate(5, 5))).toBe(flat);
    const s: Style = deepFreeze({ ...DEFAULT_STYLE, fill: grad(0, 0, 10, 0), stroke: grad(0, 0, 0, 10) });
    expect(mapStyle(s, IDENTITY)).toBe(s);
    const m = mapStyle(s, [2, 0, 0, 2, 1, 1]);
    expect(m.fill).toEqual({ ...grad(1, 1, 21, 1) });
    expect(m.stroke).toEqual({ ...grad(1, 1, 1, 21) });
  });

  it("mapStyle collapses a gradient a singular matrix squashes flat", () => {
    const s: Style = { ...DEFAULT_STYLE, fill: grad(0, 0, 10, 0) };
    expect(mapStyle(s, [0, 0, 0, 1, 0, 0]).fill).toEqual(clear);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/__tests__/gradient-model.test.ts`
Expected: FAIL — `isGradient` / `mapStyle` … not exported.

- [ ] **Step 4: Implement the model** in `src/doc/document.ts`. Change the `Mat` import to a value import of what is needed (`import { applyMat, isIdentity, type Mat } from "../geom/mat";`), then replace the `Paint`/`Style` definitions and add the helpers right after `Style`:

```ts
export type Paint = { color: string /* #rrggbb, lowercase */; opacity: number };
/** Spec M15 §2: two stops, always at offsets 0 and 1. `from`/`to` are in the shape's OWN space —
 *  the space its geometry lives in, under its `transform` — so move and rotate carry the gradient
 *  for free and every geometry bake must map it (`mapStyle`). */
export type LinearGradient = { kind: "linear"; from: Vec; to: Vec; start: Paint; end: Paint };
export type Fill = Paint | LinearGradient;
export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";

export type Style = {
  fill: Fill | null;
  stroke: Fill | null;
  strokeWidth: number;
  cap: LineCap;
  join: LineJoin;
  opacity: number;
};
/** The defaults for new shapes, and the artboard's world: flat paints only (spec M15 §2). */
export type FlatStyle = Omit<Style, "fill" | "stroke"> & {
  fill: Paint | null;
  stroke: Paint | null;
};

export function isGradient(f: Fill | null | undefined): f is LinearGradient {
  return f !== null && f !== undefined && "kind" in f;
}

export const samePaint = (a: Paint, b: Paint): boolean =>
  a.color === b.color && a.opacity === b.opacity;

const sameVec = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y;

/** Exact: what an edit compares to decide it changed nothing (invariant 1). */
export function sameFill(a: Fill | null, b: Fill | null): boolean {
  if (a === null || b === null) return a === b;
  if (isGradient(a) !== isGradient(b)) return false;
  if (isGradient(a) && isGradient(b)) {
    return (
      sameVec(a.from, b.from) &&
      sameVec(a.to, b.to) &&
      samePaint(a.start, b.start) &&
      samePaint(a.end, b.end)
    );
  }
  return samePaint(a as Paint, b as Paint);
}

/** The colours only (spec M15 §2): what Select Same and the panel's summaries compare. Two
 *  gradients' points are in two different shapes' own spaces, so comparing them means nothing. */
export function sameColours(a: Fill | null, b: Fill | null): boolean {
  if (a === null || b === null) return a === b;
  if (isGradient(a) !== isGradient(b)) return false;
  if (isGradient(a) && isGradient(b)) return samePaint(a.start, b.start) && samePaint(a.end, b.end);
  return samePaint(a as Paint, b as Paint);
}

/** The 6-decimal rounding `svg/fmt.ts` writes with. Inlined rather than imported because nothing
 *  under `doc/` depends on `svg/`. */
const written = (v: number) => Math.round(v * 1e6) / 1e6;

/** SVG paints a gradient whose points coincide as its last stop's colour, so that is what we
 *  store (spec M15 §2). Judged on the WRITTEN numbers: a gradient 1e-7 long would otherwise save
 *  as one and reload as flat. */
export function flatIfDegenerate(g: LinearGradient): Fill {
  return written(g.from.x) === written(g.to.x) && written(g.from.y) === written(g.to.y)
    ? g.end
    : g;
}

function mapFill(f: Fill | null, m: Mat): Fill | null {
  if (!isGradient(f)) return f;
  return flatIfDegenerate({ ...f, from: applyMat(m, f.from), to: applyMat(m, f.to) });
}

/** Spec M15 §5: every site that bakes a matrix into a shape's geometry maps the gradient points
 *  through the same matrix, here. Returns the SAME style when there is nothing to map, so
 *  documents without gradients keep every reference they kept before. */
export function mapStyle(s: Style, m: Mat): Style {
  if ((!isGradient(s.fill) && !isGradient(s.stroke)) || isIdentity(m)) return s;
  return { ...s, fill: mapFill(s.fill, m), stroke: mapFill(s.stroke, m) };
}
```

Change `export const DEFAULT_STYLE: Style = {` to `export const DEFAULT_STYLE: FlatStyle = {`. `Artboard.background` stays `Paint | null`.

- [ ] **Step 5: Run the model tests**

Run: `npx vitest run src/__tests__/gradient-model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing export tests** — append to `src/__tests__/serialize.test.ts` (reuse its existing imports; add `type LinearGradient` and `DEFAULT_STYLE`, `createDoc` if not already imported):

```ts
describe("gradients (spec M15 §3)", () => {
  const g: LinearGradient = {
    kind: "linear",
    from: { x: 10, y: 20 },
    to: { x: 110, y: 20 },
    start: { color: "#ff3366", opacity: 1 },
    end: { color: "#ff3366", opacity: 0 },
  };
  const withGradient = () => {
    const d = createDoc(200, 100);
    return {
      ...d,
      layers: [
        {
          ...d.layers[0],
          children: [
            {
              kind: "rect" as const,
              id: "n12",
              transform: IDENTITY,
              style: { ...DEFAULT_STYLE, fill: g, stroke: { ...g, to: { x: 10, y: 90 } } },
              x: 0,
              y: 0,
              w: 100,
              h: 50,
              rx: 0,
            },
          ],
        },
      ],
    };
  };

  it("writes one userSpaceOnUse gradient per paint in a leading <defs>, and url() references", () => {
    const out = serializeDoc(withGradient());
    expect(out).toContain(
      '<defs>\n    <linearGradient id="sv-grad-n12-fill" gradientUnits="userSpaceOnUse" x1="10" y1="20" x2="110" y2="20">\n      <stop offset="0" stop-color="#ff3366"/>\n      <stop offset="1" stop-color="#ff3366" stop-opacity="0"/>\n    </linearGradient>',
    );
    expect(out).toContain('id="sv-grad-n12-stroke"');
    expect(out).toContain('fill="url(#sv-grad-n12-fill)"');
    expect(out).toContain('stroke="url(#sv-grad-n12-stroke)"');
    expect(out).not.toContain("fill-opacity");
    expect(out.indexOf("<defs>")).toBeLessThan(out.indexOf("data-sv-layer"));
  });

  it("writes no <defs> at all without gradients", () => {
    expect(serializeDoc(createDoc(200, 100))).not.toContain("<defs");
  });
});
```

Import `IDENTITY` from `../geom/mat` if the file does not already. If TypeScript widens `kind` in the literal, annotate the child as `Node`.

- [ ] **Step 7: Run to verify failure**

Run: `npx vitest run src/__tests__/serialize.test.ts`
Expected: the two new tests FAIL (no `<defs>`; `fill` is `undefined`-ish).

- [ ] **Step 8: Implement `attrs.ts`.** Add `isGradient, type Fill, type Paint` to the document import. Replace `styleAttrs` and add the gradient helpers:

```ts
/** Spec M15 §3: one `<linearGradient>` per gradient paint, never shared, named after its node. */
export const gradientId = (nodeId: string, which: "fill" | "stroke") =>
  `sv-grad-${nodeId}-${which}`;

export type GradientDef = { id: string; attrs: Attrs; stops: Attrs[] };

function stopAttrs(offset: "0" | "1", p: Paint): Attrs {
  const a: Attrs = { offset, "stop-color": p.color };
  if (p.opacity !== 1) a["stop-opacity"] = fmt(p.opacity);
  return a;
}

/** The gradient elements a shape's paints need, in fill-then-stroke order. `userSpaceOnUse` is
 *  the element's own coordinate system including its `transform` — exactly where the model keeps
 *  the points — so they are written as stored. */
export function gradientDefs(s: Shape): GradientDef[] {
  const out: GradientDef[] = [];
  for (const which of ["fill", "stroke"] as const) {
    const f = s.style[which];
    if (!isGradient(f)) continue;
    const id = gradientId(s.id, which);
    out.push({
      id,
      attrs: {
        id,
        gradientUnits: "userSpaceOnUse",
        x1: fmt(f.from.x),
        y1: fmt(f.from.y),
        x2: fmt(f.to.x),
        y2: fmt(f.to.y),
      },
      stops: [stopAttrs("0", f.start), stopAttrs("1", f.end)],
    });
  }
  return out;
}

function paintAttrs(which: "fill" | "stroke", f: Fill | null, id: string): Attrs {
  if (f === null) return which === "fill" ? { fill: "none" } : {};
  if (isGradient(f)) return { [which]: `url(#${gradientId(id, which)})` };
  const a: Attrs = { [which]: f.color };
  if (f.opacity !== 1) a[`${which}-opacity`] = fmt(f.opacity);
  return a;
}

/** `id` names the node, so a gradient paint can point at its own `<linearGradient>`. */
export function styleAttrs(s: Style, id: string): Attrs {
  const a: Attrs = { ...paintAttrs("fill", s.fill, id), ...paintAttrs("stroke", s.stroke, id) };
  a["stroke-width"] = fmt(s.strokeWidth);
  if (s.cap !== "butt") a["stroke-linecap"] = s.cap;
  if (s.join !== "miter") a["stroke-linejoin"] = s.join;
  if (s.opacity !== 1) a.opacity = fmt(s.opacity);
  return a;
}
```

In `shapeAttrs`, change `...styleAttrs(s.style),` to `...styleAttrs(s.style, s.id),`.

- [ ] **Step 9: Implement `serialize.ts`.** Import `gradientDefs` and `type Shape` (from `../doc/document`). Add after `node()`:

```ts
function shapesIn(n: Node): Shape[] {
  return n.kind === "group" ? n.children.flatMap(shapesIn) : [n];
}

/** Spec M15 §3: every shape's gradients, in document order, in one leading `<defs>`; nothing at
 *  all when there are none, so a document without gradients serializes exactly as before. */
function defsElement(doc: Doc): string | null {
  const defs = doc.layers.flatMap((l) => l.children.flatMap(shapesIn)).flatMap(gradientDefs);
  if (defs.length === 0) return null;
  const items = defs.map((g) =>
    element(
      "linearGradient",
      g.attrs,
      g.stops.map((s) => element("stop", s, [], 3)),
      2,
    ),
  );
  return element("defs", {}, items, 1);
}
```

In `serializeDoc`, right after `const body: string[] = [];` add:

```ts
  const defs = defsElement(doc);
  if (defs) body.push(defs);
```

and change the background call to `styleAttrs({ … }, "background")` (the background is flat, so the id is never used).

- [ ] **Step 10: Implement `NodeView.svelte`** — replace the `{:else}` branch:

```svelte
{:else}
  {@const s = shapeAttrs(node)}
  {@const defs = gradientDefs(node)}
  <!-- Spec M15 §3: a shape's gradients sit right before it; SVG allows <defs> anywhere, and ids are
       page-unique because node ids are. Built by the same function the exporter uses. -->
  {#if defs.length > 0}
    <defs>
      {#each defs as g (g.id)}
        <linearGradient {...g.attrs}>
          {#each g.stops as st, i (i)}
            <stop {...st} />
          {/each}
        </linearGradient>
      {/each}
    </defs>
  {/if}
  {#if s.tag === "rect"}
```

(keep the rest of the branch) and import `gradientDefs` alongside `shapeAttrs`.

- [ ] **Step 11: Make the rest compile with unchanged behaviour.**
  - `src/doc/edits.ts`: delete its local `samePaint`, import `sameFill` from `./document`, and in `styleMatches` use `sameFill(s[k] as Fill | null, (patch[k] ?? null) as Fill | null)`.
  - `src/doc/select-match.ts`: delete local `samePaint`; import `sameColours` from `./document`; replace every `samePaint(` with `sameColours(`; change the `Paint` import to what remains used.
  - `src/state/properties.ts`: delete local `samePaint`; import `sameColours, type Fill`; `StyleSummary.fill`/`stroke` become `Field<Fill | null>`; `merge(…, sameColours)`.
  - `src/persist/preferences.ts`: `style: FlatStyle` in `Prefs` (import `type FlatStyle`); `sanitizePrefs` already builds flat paints.
  - `src/state/appState.svelte.ts` `setSelectionStyle`: with nothing selected, prefs may hold only flat paints:
    ```ts
    if (app.selection.length === 0) {
      // Spec M15 §2: new shapes are drawn flat; the panel never offers a gradient here, and a
      // gradient patch must not reach the preferences if one ever arrives.
      const { fill, stroke, ...rest } = patch;
      const flat: Partial<FlatStyle> = { ...rest };
      if (fill !== undefined && !isGradient(fill)) flat.fill = fill;
      if (stroke !== undefined && !isGradient(stroke)) flat.stroke = stroke;
      setPrefs({ ...app.prefs, style: { ...app.prefs.style, ...flat } });
      return;
    }
    ```
  - `src/lib/PaintField.svelte`: `field: Field<Fill | null>`; `onchange: (p: Paint | null) => void` stays; `const paint = $derived(field.mixed || isGradient(field.value) ? null : field.value);` (imports `isGradient`, `type Fill`).
  - `src/lib/PropertiesPanel.svelte`: `FILL_FALLBACK`/`STROKE_FALLBACK` keep type `Paint`.
  - Run `npx tsc --noEmit` and `npx svelte-check` and fix any remaining narrowing site the same way (read `.color` only after `!isGradient(…)`).

- [ ] **Step 12: Run everything**

Run: `npm test && npm run build 2>&1 | grep -E "COMPLETED|error" && npm run lint`
Expected: all tests pass (the existing serialize tests prove byte-identity), build `0 ERRORS 0 WARNINGS`, lint clean.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(M15): linear gradient model, export and canvas rendering

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Gradient import — the pure resolver

**Files:**
- Modify: `src/svg/colors.ts` (`url(…)` kind)
- Modify: `src/svg/transform.ts` (`parseTransformOrNull`)
- Create: `src/svg/gradient-import.ts`
- Test: `src/__tests__/gradient-import.test.ts` (new), `src/__tests__/colors-transform.test.ts`

**Interfaces:**
- Consumes: `Fill`, `flatIfDegenerate` (Task 1); `Box` from `geom/box`; `XmlElement` from `svg/xml`.
- Produces:
  ```ts
  // colors.ts
  export type ParsedColor =
    | { kind: "none" }
    | { kind: "color"; color: string; alpha: number }
    | { kind: "url"; id: string; fallback: ParsedColor | null }
    | { kind: "unsupported" };
  // transform.ts
  export function parseTransformOrNull(value: string): Mat | null;
  // gradient-import.ts
  export type RawStop = { offset: number; color: string; opacity: number };
  export type RawLinear = {
    units: "user" | "bbox";
    x1: Len; y1: Len; x2: Len; y2: Len;
    transform: Mat | null; // null = the list could not be read in full
    spread: string;
    stops: RawStop[];
  };
  export type Len = { v: number; pct: boolean };
  export type Resolved = { kind: "linear"; g: RawLinear } | { kind: "drop"; label: string } | { kind: "missing" };
  export type Folded = { kind: "fill"; fill: Fill | null } | { kind: "drop"; label: string };
  export function collectServers(root: XmlElement): Map<string, XmlElement>;
  export function resolveServer(servers: Map<string, XmlElement>, id: string): Resolved;
  export function foldLinear(g: RawLinear, box: Box | null, viewport: { w: number; h: number }, opacity: number): Folded;
  ```
- Drop labels used (exact strings, reused by Task 3): `"radial gradients"`, `"patterns"`, `"gradients with more than two stops"`, `"repeating gradients"`, `"gradients with an invalid transform"`, `"gradients on zero-size shapes"`, `"missing paint references"`.

- [ ] **Step 1: Write the failing colour/transform tests** — append to `src/__tests__/colors-transform.test.ts` (import `parseTransformOrNull`):

```ts
describe("url() paints and strict transforms (spec M15 §4)", () => {
  it("parses url references with and without a fallback", () => {
    expect(parseColor("url(#g1)")).toEqual({ kind: "url", id: "g1", fallback: null });
    expect(parseColor("url('#g1') #ff0000")).toEqual({
      kind: "url",
      id: "g1",
      fallback: { kind: "color", color: "#ff0000", alpha: 1 },
    });
    expect(parseColor('url("#a b") none')).toEqual({
      kind: "url",
      id: "a b",
      fallback: { kind: "none" },
    });
    expect(parseColor("url(other.svg#g)")).toEqual({ kind: "unsupported" });
  });

  it("tells an unreadable transform list from identity", () => {
    expect(parseTransformOrNull("")).toEqual([1, 0, 0, 1, 0, 0]);
    expect(parseTransformOrNull("translate(3 4)")).toEqual([1, 0, 0, 1, 3, 4]);
    expect(parseTransformOrNull("translate(3 4) wobble(2)")).toBeNull();
    expect(parseTransformOrNull("scale(a)")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/colors-transform.test.ts`
Expected: new tests FAIL.

- [ ] **Step 3: Implement.** In `colors.ts`, extend `ParsedColor` as in Interfaces and replace the `url(` line in `parseColor` with:

```ts
  if (v.startsWith("url(")) {
    // Spec M15 §4: a same-document reference, with an optional fallback after it. An external
    // reference (`other.svg#g`) can never resolve here.
    const m = /^url\(\s*(['"]?)#([^'")]+)\1\s*\)\s*(.*)$/.exec(v);
    if (!m) return { kind: "unsupported" };
    const rest = m[3].trim();
    return { kind: "url", id: m[2], fallback: rest === "" ? null : parseColor(rest) };
  }
```

(Read the surrounding function first: use its existing local name for the trimmed value.) In `transform.ts`, rename the body of `parseTransform` into `parseTransformOrNull`, returning `null` wherever it returned `IDENTITY` for an invalid list, and `result` (IDENTITY when empty) otherwise; then:

```ts
/** Shapes: SVG disables an invalid transform list as a whole, which reads as identity. */
export function parseTransform(value: string): Mat {
  return parseTransformOrNull(value) ?? IDENTITY;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/colors-transform.test.ts src/__tests__/parse.test.ts`
Expected: PASS (parse tests prove `parseTransform` is unchanged).

- [ ] **Step 5: Write the failing resolver tests** — `src/__tests__/gradient-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isGradient, type LinearGradient } from "../doc/document";
import { collectServers, foldLinear, resolveServer, type RawLinear } from "../svg/gradient-import";
import { parseXml } from "../svg/xml";

const svg = (defs: string) =>
  parseXml(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${defs}</svg>`);
const resolve = (defs: string, id = "g") => resolveServer(collectServers(svg(defs)), id);
const linear = (defs: string, id = "g"): RawLinear => {
  const r = resolve(defs, id);
  if (r.kind !== "linear") throw new Error(`not linear: ${JSON.stringify(r)}`);
  return r.g;
};
const box = { x: 0, y: 0, w: 200, h: 100 };
const view = { w: 400, h: 300 };
const foldOk = (g: RawLinear, b = box, o = 1): LinearGradient => {
  const f = foldLinear(g, b, view, o);
  if (f.kind !== "fill" || !isGradient(f.fill)) throw new Error(JSON.stringify(f));
  return f.fill;
};
const close = (a: { x: number; y: number }, x: number, y: number) => {
  expect(a.x).toBeCloseTo(x, 9);
  expect(a.y).toBeCloseTo(y, 9);
};
const stops2 = '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/>';

describe("collectServers / resolveServer", () => {
  it("finds gradients anywhere and reads attributes and stops", () => {
    const g = linear(
      `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="1" y1="2" x2="30" y2="4">${stops2}</linearGradient></defs>`,
    );
    expect(g.units).toBe("user");
    expect(g.x1).toEqual({ v: 1, pct: false });
    expect(g.x2).toEqual({ v: 30, pct: false });
    expect(g.stops).toEqual([
      { offset: 0, color: "#ff0000", opacity: 1 },
      { offset: 1, color: "#0000ff", opacity: 0.5 },
    ]);
  });

  it("follows an Inkscape href chain for stops and inherited attributes", () => {
    const g = linear(
      `<defs><linearGradient id="stops">${stops2}</linearGradient>` +
        `<linearGradient id="g" xlink:href="#stops" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0"/></defs>`,
    );
    expect(g.stops).toHaveLength(2);
    expect(g.units).toBe("user");
  });

  it("reads stop colour and opacity from a style attribute", () => {
    const g = linear(
      `<linearGradient id="g"><stop offset="0" style="stop-color:#00ff00;stop-opacity:0.25"/><stop offset="100%" style="stop-color:#000000"/></linearGradient>`,
    );
    expect(g.stops[0]).toEqual({ offset: 0, color: "#00ff00", opacity: 0.25 });
    expect(g.stops[1].offset).toBe(1);
  });

  it("clamps offsets into [0, 1] and never lets one go backwards", () => {
    const g = linear(
      `<linearGradient id="g"><stop offset="0.6"/><stop offset="0.2"/><stop offset="2"/></linearGradient>`,
    );
    expect(g.stops.map((s) => s.offset)).toEqual([0.6, 0.6, 1]);
  });

  it("defaults units to objectBoundingBox and the points to 0% 0% 100% 0%", () => {
    const g = linear(`<linearGradient id="g">${stops2}</linearGradient>`);
    expect(g.units).toBe("bbox");
    expect([g.x1, g.y1, g.x2, g.y2]).toEqual([
      { v: 0, pct: true },
      { v: 0, pct: true },
      { v: 100, pct: true },
      { v: 0, pct: true },
    ]);
  });

  it("reports radial gradients, patterns, missing ids and href cycles", () => {
    expect(resolve(`<radialGradient id="g">${stops2}</radialGradient>`)).toEqual({ kind: "drop", label: "radial gradients" });
    expect(resolve(`<pattern id="g"/>`)).toEqual({ kind: "drop", label: "patterns" });
    expect(resolve(`<linearGradient id="h"/>`)).toEqual({ kind: "missing" });
    expect(resolve(`<rect id="g"/>`)).toEqual({ kind: "missing" });
    const cyc = resolve(
      `<linearGradient id="g" href="#h"/><linearGradient id="h" href="#g"/>`,
    );
    expect(cyc.kind).toBe("linear"); // a cycle stops the walk; the gradient has no stops
    if (cyc.kind === "linear") expect(cyc.g.stops).toEqual([]);
  });
});

describe("foldLinear (spec M15 §4)", () => {
  const user = (attrs: string, stops = stops2) =>
    linear(`<linearGradient id="g" gradientUnits="userSpaceOnUse" ${attrs}>${stops}</linearGradient>`);

  it("keeps userSpaceOnUse points as they stand and carries the stops", () => {
    const f = foldOk(user('x1="10" y1="20" x2="110" y2="20"'));
    close(f.from, 10, 20);
    close(f.to, 110, 20);
    expect(f.start).toEqual({ color: "#ff0000", opacity: 1 });
    expect(f.end).toEqual({ color: "#0000ff", opacity: 0.5 });
  });

  it("maps objectBoundingBox fractions and percentages through the shape's box", () => {
    const f = foldOk(linear(`<linearGradient id="g" x1="0" y1="0.5" x2="100%" y2="50%">${stops2}</linearGradient>`), { x: 10, y: 10, w: 200, h: 100 });
    close(f.from, 10, 60);
    close(f.to, 210, 60);
  });

  it("reads userSpaceOnUse percentages against the viewport", () => {
    const f = foldOk(user('x1="0%" y1="50%" x2="100%" y2="50%"'));
    close(f.from, 0, 150);
    close(f.to, 400, 150);
  });

  it("folds stop offsets into the points", () => {
    const f = foldOk(
      user('x1="0" y1="0" x2="100" y2="0"', '<stop offset="0.2" stop-color="#ff0000"/><stop offset="0.8" stop-color="#0000ff"/>'),
    );
    close(f.from, 20, 0);
    close(f.to, 80, 0);
  });

  it("is exact under a skewing gradientTransform (sampled against the source definition)", () => {
    const src = user('x1="0" y1="0" x2="100" y2="0" gradientTransform="matrix(1 0.5 0.3 2 7 -3)"');
    const f = foldOk(src);
    // Source: s(q) = ((A⁻¹q − p1)·d)/(d·d) with A = [1 .5 .3 2 7 -3], p1 = (0,0), d = (100,0).
    const [a, b, c, d, e, ff] = [1, 0.5, 0.3, 2, 7, -3];
    const det = a * d - b * c;
    const inv = (q: { x: number; y: number }) => {
      const x = q.x - e;
      const y = q.y - ff;
      return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
    };
    const tModel = (q: { x: number; y: number }) => {
      const v = { x: f.to.x - f.from.x, y: f.to.y - f.from.y };
      return ((q.x - f.from.x) * v.x + (q.y - f.from.y) * v.y) / (v.x * v.x + v.y * v.y);
    };
    for (const q of [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: -30, y: 80 }, { x: 120, y: -40 }]) {
      expect(tModel(q)).toBeCloseTo(inv(q).x / 100, 9);
    }
  });

  it("turns 0 stops into none and 1 stop into a flat paint", () => {
    expect(foldLinear(user('x2="10"', ""), box, view, 1)).toEqual({ kind: "fill", fill: null });
    expect(foldLinear(user('x2="10"', '<stop offset="0.3" stop-color="#123456" stop-opacity="0.5"/>'), box, view, 0.5)).toEqual({
      kind: "fill",
      fill: { color: "#123456", opacity: 0.25 },
    });
  });

  it("drops what the model cannot draw exactly", () => {
    const three = '<stop offset="0"/><stop offset="0.5"/><stop offset="1"/>';
    expect(foldLinear(user('x2="10"', three), box, view, 1)).toEqual({ kind: "drop", label: "gradients with more than two stops" });
    const hard = '<stop offset="0.5" stop-color="#ff0000"/><stop offset="0.5" stop-color="#0000ff"/>';
    expect(foldLinear(user('x2="10"', hard), box, view, 1)).toEqual({ kind: "drop", label: "gradients with more than two stops" });
    expect(foldLinear(user('x2="10" spreadMethod="reflect"'), box, view, 1)).toEqual({ kind: "drop", label: "repeating gradients" });
    expect(foldLinear(user('x2="10" gradientTransform="scale(0)"'), box, view, 1)).toEqual({ kind: "drop", label: "gradients with an invalid transform" });
    expect(foldLinear(user('x2="10" gradientTransform="wobble(1)"'), box, view, 1)).toEqual({ kind: "drop", label: "gradients with an invalid transform" });
    const bbox = linear(`<linearGradient id="g">${stops2}</linearGradient>`);
    expect(foldLinear(bbox, { x: 0, y: 0, w: 100, h: 0 }, view, 1)).toEqual({ kind: "drop", label: "gradients on zero-size shapes" });
    expect(foldLinear(bbox, null, view, 1)).toEqual({ kind: "drop", label: "gradients on zero-size shapes" });
  });

  it("multiplies the element's paint opacity into both stops", () => {
    const f = foldOk(user('x1="0" y1="0" x2="10" y2="0"'), box, 0.5);
    expect(f.start.opacity).toBe(0.5);
    expect(f.end.opacity).toBe(0.25);
  });

  it("collapses coincident points to the last stop, as SVG paints them", () => {
    expect(foldLinear(user('x1="5" y1="5" x2="5" y2="5"'), box, view, 1)).toEqual({
      kind: "fill",
      fill: { color: "#0000ff", opacity: 0.5 },
    });
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/__tests__/gradient-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `src/svg/gradient-import.ts`:**

```ts
import { flatIfDegenerate, type Fill } from "../doc/document";
import type { Box } from "../geom/box";
import { applyMat, invert, multiply, type Mat } from "../geom/mat";
import { parseColor } from "./colors";
import { parseTransformOrNull } from "./transform";
import type { XmlElement } from "./xml";

/** Spec M15 §4: foreign paint servers, resolved into our two-point model exactly or not at all. */

export type Len = { v: number; pct: boolean };
export type RawStop = { offset: number; color: string; opacity: number };
export type RawLinear = {
  units: "user" | "bbox";
  x1: Len;
  y1: Len;
  x2: Len;
  y2: Len;
  /** null when the list could not be read in full: the gradient is dropped, never guessed. */
  transform: Mat | null;
  spread: string;
  stops: RawStop[];
};
export type Resolved =
  | { kind: "linear"; g: RawLinear }
  | { kind: "drop"; label: string }
  | { kind: "missing" };
export type Folded = { kind: "fill"; fill: Fill | null } | { kind: "drop"; label: string };

const MAX_CHAIN = 16;
const local = (name: string) => (name.startsWith("svg:") ? name.slice(4) : name);
const SERVERS = new Set(["linearGradient", "radialGradient", "pattern"]);

/** Every paint server with an id, wherever it sits — they may be referenced before they appear.
 *  The first of a duplicated id wins, as in a browser. */
export function collectServers(root: XmlElement): Map<string, XmlElement> {
  const out = new Map<string, XmlElement>();
  const walk = (el: XmlElement) => {
    const id = el.attrs.id;
    if (id !== undefined && SERVERS.has(local(el.name)) && !out.has(id)) out.set(id, el);
    el.children.forEach(walk);
  };
  walk(root);
  return out;
}

function hrefOf(el: XmlElement): string | null {
  const h = el.attrs.href ?? el.attrs["xlink:href"];
  return h !== undefined && h.startsWith("#") ? h.slice(1) : null;
}

/** The element and the gradients it inherits from, nearest first. A cycle or an over-long chain
 *  simply ends the walk. */
function chain(servers: Map<string, XmlElement>, first: XmlElement): XmlElement[] {
  const out = [first];
  let el = first;
  while (out.length < MAX_CHAIN) {
    const id = hrefOf(el);
    const next = id === null ? undefined : servers.get(id);
    if (!next || out.includes(next) || local(next.name) === "pattern") break;
    out.push(next);
    el = next;
  }
  return out;
}

function len(v: string | undefined, fallback: Len): Len {
  if (v === undefined) return fallback;
  const t = v.trim();
  const pct = t.endsWith("%");
  const n = Number(pct ? t.slice(0, -1) : t);
  return Number.isFinite(n) ? { v: n, pct } : fallback;
}

/** A stop's own attribute, overridden by its `style` declaration (Inkscape writes the latter). */
function stopProp(el: XmlElement, key: "stop-color" | "stop-opacity"): string | undefined {
  let v = el.attrs[key];
  for (const decl of (el.attrs.style ?? "").split(";")) {
    const colon = decl.indexOf(":");
    if (colon >= 0 && decl.slice(0, colon).trim().toLowerCase() === key) {
      v = decl.slice(colon + 1).trim();
    }
  }
  return v;
}

function readStops(el: XmlElement): RawStop[] {
  let last = 0;
  return el.children
    .filter((c) => local(c.name) === "stop")
    .map((c) => {
      const o = len(c.attrs.offset, { v: 0, pct: false });
      const raw = o.pct ? o.v / 100 : o.v;
      // SVG: clamp into [0, 1], and never before the previous stop.
      const offset = Math.max(last, Math.min(1, Math.max(0, raw)));
      last = offset;
      const col = parseColor(stopProp(c, "stop-color") ?? "#000000");
      const color = col && col.kind === "color" ? col.color : "#000000";
      const alpha = col && col.kind === "color" ? col.alpha : 1;
      const so = Number(stopProp(c, "stop-opacity") ?? "1");
      const opacity = (Number.isFinite(so) ? Math.min(1, Math.max(0, so)) : 1) * alpha;
      return { offset, color, opacity };
    });
}

export function resolveServer(servers: Map<string, XmlElement>, id: string): Resolved {
  const el = servers.get(id);
  if (!el) return { kind: "missing" };
  const name = local(el.name);
  if (name === "pattern") return { kind: "drop", label: "patterns" };
  if (name === "radialGradient") return { kind: "drop", label: "radial gradients" };
  const all = chain(servers, el);
  const attr = (k: string) => all.find((e) => e.attrs[k] !== undefined)?.attrs[k];
  const withStops = all.find((e) => e.children.some((c) => local(c.name) === "stop"));
  const tr = attr("gradientTransform");
  return {
    kind: "linear",
    g: {
      units: attr("gradientUnits") === "userSpaceOnUse" ? "user" : "bbox",
      x1: len(attr("x1"), { v: 0, pct: true }),
      y1: len(attr("y1"), { v: 0, pct: true }),
      x2: len(attr("x2"), { v: 100, pct: true }),
      y2: len(attr("y2"), { v: 0, pct: true }),
      transform: tr === undefined ? [1, 0, 0, 1, 0, 0] : parseTransformOrNull(tr),
      spread: (attr("spreadMethod") ?? "pad").trim(),
      stops: withStops ? readStops(withStops) : [],
    },
  };
}

/** Spec M15 §4's fold: the source's parameter `s(q)` is affine in own-space `q`, so the stops'
 *  offsets are reached at two points along its gradient `g = A⁻ᵀd/(d·d)` — exact for any
 *  invertible `A`, skew included (which is why `g` is never `A·d`). */
export function foldLinear(
  g: RawLinear,
  box: Box | null,
  viewport: { w: number; h: number },
  opacity: number,
): Folded {
  const stops = g.stops.map((s) => ({ color: s.color, opacity: s.opacity * opacity }));
  if (g.stops.length === 0) return { kind: "fill", fill: null };
  if (g.stops.length === 1) return { kind: "fill", fill: stops[0] };
  if (g.stops.length > 2 || g.stops[1].offset <= g.stops[0].offset) {
    return { kind: "drop", label: "gradients with more than two stops" };
  }
  if (g.spread !== "pad") return { kind: "drop", label: "repeating gradients" };
  if (!g.transform) return { kind: "drop", label: "gradients with an invalid transform" };

  let unit: Mat = [1, 0, 0, 1, 0, 0];
  let num: (l: Len, axis: "x" | "y") => number;
  if (g.units === "bbox") {
    if (!box || box.w <= 0 || box.h <= 0) return { kind: "drop", label: "gradients on zero-size shapes" };
    unit = [box.w, 0, 0, box.h, box.x, box.y];
    num = (l) => (l.pct ? l.v / 100 : l.v);
  } else {
    num = (l, axis) => (l.pct ? (l.v / 100) * (axis === "x" ? viewport.w : viewport.h) : l.v);
  }
  const A = multiply(unit, g.transform);
  const inv = invert(A);
  if (!inv) return { kind: "drop", label: "gradients with an invalid transform" };

  const p1 = { x: num(g.x1, "x"), y: num(g.y1, "y") };
  const p2 = { x: num(g.x2, "x"), y: num(g.y2, "y") };
  const d = { x: p2.x - p1.x, y: p2.y - p1.y };
  const dd = d.x * d.x + d.y * d.y;
  // SVG: coincident points paint the last stop's colour.
  if (dd === 0) return { kind: "fill", fill: stops[1] };
  const [ai, bi, ci, di] = inv;
  const gx = (ai * d.x + bi * d.y) / dd;
  const gy = (ci * d.x + di * d.y) / dd;
  const gg = gx * gx + gy * gy;
  const q0 = applyMat(A, p1);
  const at = (o: number) => ({ x: q0.x + (gx * o) / gg, y: q0.y + (gy * o) / gg });
  return {
    kind: "fill",
    fill: flatIfDegenerate({
      kind: "linear",
      from: at(g.stops[0].offset),
      to: at(g.stops[1].offset),
      start: stops[0],
      end: stops[1],
    }),
  };
}
```

Check `invert`'s return type in `geom/mat.ts` (`Mat | null`) and that `Mat` is a 6-tuple `[a, b, c, d, e, f]` in SVG `matrix()` order (CLAUDE.md: `mat.ts` — SVG `matrix()` order). If `Mat` is a readonly tuple type, construct literals with `as const` or the module's own constructor (e.g. `IDENTITY` for the default transform).

- [ ] **Step 8: Run to verify pass**

Run: `npx vitest run src/__tests__/gradient-import.test.ts src/__tests__/colors-transform.test.ts`
Expected: PASS.

- [ ] **Step 9: Build and commit**

Run: `npm test && npm run build 2>&1 | grep -E "COMPLETED|error" && npm run lint`

```bash
git add -A
git commit -m "feat(M15): resolve and fold foreign linear gradients exactly

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Gradient import — wiring into the parser

**Files:**
- Modify: `src/svg/parse.ts`
- Test: `src/__tests__/parse.test.ts` (append), `src/__tests__/gradient-roundtrip.test.ts` (new)

**Interfaces:**
- Consumes: `collectServers`, `resolveServer`, `foldLinear` (Task 2); `ParsedColor` `url` kind (Task 2); `serializeDoc` with gradients (Task 1); `nodeBounds` from `geom/bounds`.
- Produces: `parseSvg` returns gradient fills/strokes; no signature change.

- [ ] **Step 1: Write the failing tests** — `src/__tests__/gradient-roundtrip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, isGradient, type Doc, type LinearGradient, type Shape } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { parseSvg } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";
import { stripIds } from "./helpers";

const shapesOf = (d: Doc): Shape[] =>
  d.layers.flatMap((l) => l.children).flatMap(function f(n): Shape[] {
    return n.kind === "group" ? n.children.flatMap(f) : [n];
  });
const wrap = (body: string, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="300" ${extra}>${body}</svg>`;
const stops = '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>';

describe("gradient import (spec M15 §4)", () => {
  it("round-trips our own gradients exactly and keeps the file native with nothing dropped", () => {
    const g: LinearGradient = {
      kind: "linear",
      from: { x: 1.5, y: 2.25 },
      to: { x: 90.125, y: -4 },
      start: { color: "#ff3366", opacity: 1 },
      end: { color: "#00ff00", opacity: 0.4 },
    };
    const d0 = createDoc(200, 100);
    const d: Doc = {
      ...d0,
      layers: [
        {
          ...d0.layers[0],
          children: [
            { kind: "ellipse", id: "n5", transform: [0.8, 0.6, -0.6, 0.8, 10, 20], style: { ...DEFAULT_STYLE, fill: g, stroke: g }, cx: 50, cy: 40, rx: 30, ry: 20 },
          ],
        },
      ],
    };
    const r = parseSvg(serializeDoc(d));
    expect(r.dropped).toEqual([]);
    expect(r.native).toBe(true);
    expect(stripIds(r.doc).layers[0].children[0]).toEqual(stripIds(d).layers[0].children[0]);
  });

  it("resolves a group's inherited url per child, in each child's own box", () => {
    const r = parseSvg(
      wrap(`<defs><linearGradient id="g">${stops}</linearGradient></defs>` +
        `<g fill="url(#g)"><rect x="0" y="0" width="100" height="10"/><rect x="200" y="50" width="50" height="10"/></g>`),
    );
    expect(r.dropped).toEqual([]);
    const [a, b] = shapesOf(r.doc);
    expect(isGradient(a.style.fill) && a.style.fill.to.x).toBe(100);
    expect(isGradient(b.style.fill) && b.style.fill.from.x).toBe(200);
    expect(isGradient(b.style.fill) && b.style.fill.to.x).toBe(250);
  });

  it("uses a url's fallback colour when the reference is missing, else none and a report", () => {
    const r1 = parseSvg(wrap(`<rect width="10" height="10" fill="url(#nope) #00ff00"/>`));
    expect(shapesOf(r1.doc)[0].style.fill).toEqual({ color: "#00ff00", opacity: 1 });
    expect(r1.dropped).toEqual([]);
    const r2 = parseSvg(wrap(`<rect width="10" height="10" fill="url(#nope)"/>`));
    expect(shapesOf(r2.doc)[0].style.fill).toBeNull();
    expect(r2.dropped).toContain("missing paint references");
  });

  it("drops radial gradients and patterns by name, leaving no paint", () => {
    const r = parseSvg(
      wrap(`<radialGradient id="r">${stops}</radialGradient><pattern id="p"/>` +
        `<rect width="10" height="10" fill="url(#r)" stroke="url(#p)"/>`),
    );
    const s = shapesOf(r.doc)[0];
    expect(s.style.fill).toBeNull();
    expect(s.style.stroke).toBeNull();
    expect(r.dropped).toEqual(expect.arrayContaining(["radial gradients", "patterns"]));
  });

  it("multiplies fill-opacity into the stops", () => {
    const r = parseSvg(
      wrap(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x2="10">${stops}</linearGradient>` +
        `<rect width="10" height="10" fill="url(#g)" fill-opacity="0.5"/>`),
    );
    const f = shapesOf(r.doc)[0].style.fill;
    expect(isGradient(f) && [f.start.opacity, f.end.opacity]).toEqual([0.5, 0.5]);
  });

  it("gives a line a userSpaceOnUse stroke gradient (a zero-height box is fine in user space)", () => {
    const r = parseSvg(
      wrap(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" x2="100">${stops}</linearGradient>` +
        `<line x1="0" y1="5" x2="100" y2="5" stroke="url(#g)"/>`),
    );
    expect(isGradient(shapesOf(r.doc)[0].style.stroke)).toBe(true);
    expect(r.dropped).toEqual([]);
  });

  it("keeps a gradient on the artboard background out of the model and reports it", () => {
    const r = parseSvg(
      wrap(`<linearGradient id="g">${stops}</linearGradient><rect data-sv-background="" x="0" y="0" width="400" height="300" fill="url(#g)"/>`, 'data-sv-version="1"'),
    );
    expect(r.doc.artboard.background).toBeNull();
    expect(r.dropped).toContain("background gradients");
  });
});
```

(`IDENTITY` import is there for fixtures you may add; remove it if unused so lint stays clean.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/gradient-roundtrip.test.ts`
Expected: FAIL (fills come back `null`, "gradients/patterns" dropped).

- [ ] **Step 3: Implement in `parse.ts`.**
  1. Imports: `isGradient` is not needed; add `type Fill` and `type Shape` from document, `IDENTITY` from `../geom/mat`, `nodeBounds` from `../geom/bounds`, and `collectServers, foldLinear, resolveServer` from `./gradient-import`.
  2. Types near `Inherited`:
     ```ts
     /** Spec M15 §4: a `url(#…)` paint travels through inheritance unresolved, because SVG resolves
      *  it against the element that is painted — each child in its own space and box. */
     type Ref = { ref: string; fallback: Paint | null };
     type InheritedPaint = Paint | Ref | null;
     const isRef = (p: InheritedPaint): p is Ref => p !== null && "ref" in p;
     ```
     and `Inherited.fill`/`stroke` become `InheritedPaint`.
  3. In `parseSvg`, after `const newId = …`: `const servers = collectServers(root);` and
     ```ts
     /** Paints still to resolve, keyed by the style object `style()` built for that shape — every
      *  shape case passes its style through unchanged, so `convert` can find them afterwards. */
     const pending = new WeakMap<Style, { fill?: { ref: Ref; o: number }; stroke?: { ref: Ref; o: number } }>();
     ```
  4. `paint(value, current): InheritedPaint` — replace the `unsupported`/color tail:
     ```ts
     if (c.kind === "url") {
       const fb = c.fallback;
       return { ref: c.id, fallback: fb && fb.kind === "color" ? { color: fb.color, opacity: fb.alpha } : null };
     }
     if (c.kind === "unsupported") {
       drop("gradients/patterns");
       return null;
     }
     return { color: c.color, opacity: c.alpha };
     ```
  5. `style(inh, opacity)`: flat paints as before; a `Ref` becomes `null` in the returned style and is recorded:
     ```ts
     function style(inh: Inherited, opacity: number): Style {
       const flat = (p: InheritedPaint, o: number): Paint | null =>
         p && !isRef(p) ? { color: p.color, opacity: p.opacity * o } : null;
       const st: Style = {
         fill: flat(inh.fill, inh.fillOpacity),
         stroke: flat(inh.stroke, inh.strokeOpacity),
         strokeWidth: inh.strokeWidth,
         cap: inh.cap,
         join: inh.join,
         opacity,
       };
       const refs: { fill?: { ref: Ref; o: number }; stroke?: { ref: Ref; o: number } } = {};
       if (isRef(inh.fill)) refs.fill = { ref: inh.fill, o: inh.fillOpacity };
       if (isRef(inh.stroke)) refs.stroke = { ref: inh.stroke, o: inh.strokeOpacity };
       if (refs.fill || refs.stroke) pending.set(st, refs);
       return st;
     }
     ```
  6. A resolver, and the call in `convert` right after `const node = convertNode(el, inh); if (!node) return null;`:
     ```ts
     function resolveRef(r: { ref: Ref; o: number }, shape: Shape): Fill | null {
       const res = resolveServer(servers, r.ref.ref);
       if (res.kind === "missing") {
         if (r.ref.fallback) return { ...r.ref.fallback, opacity: r.ref.fallback.opacity * r.o };
         drop("missing paint references");
         return null;
       }
       if (res.kind === "drop") {
         drop(res.label);
         return null;
       }
       // The geometric box in the shape's own space: `nodeBounds` applies the node's own transform,
       // so hand it the shape with an identity one.
       const box = nodeBounds({ ...shape, transform: IDENTITY }, IDENTITY);
       const folded = foldLinear(res.g, box, { w, h }, r.o);
       if (folded.kind === "drop") {
         drop(folded.label);
         return null;
       }
       return folded.fill;
     }
     ```
     ```ts
     let resolved = node;
     if (node.kind !== "group") {
       const refs = pending.get(node.style);
       if (refs) {
         resolved = {
           ...node,
           style: {
             ...node.style,
             ...(refs.fill ? { fill: resolveRef(refs.fill, node) } : {}),
             ...(refs.stroke ? { stroke: resolveRef(refs.stroke, node) } : {}),
           },
         };
       }
     }
     ```
     and use `resolved` instead of `node` for the rest of `convert` (the hidden/locked spread). `w`/`h` are the artboard size computed later in `parseSvg`; they are read at call time, after they are assigned — confirm by reading the artboard section (`const w`/`let w`) and move nothing unless TypeScript reports use-before-assign.
  7. The background (own format): `paint(bp.fill, null)` may now be a `Ref`:
     ```ts
     const fill = paint(bp.fill, null);
     if (isRef(fill)) drop("background gradients");
     background = fill && !isRef(fill) ? { color: fill.color, opacity: fill.opacity * opacityValue(bp["fill-opacity"], 1) } : null;
     ```
  8. **Paint servers are not content.** Add `"linearGradient"`, `"radialGradient"`, `"pattern"` to `SILENT`, so one outside `<defs>` is skipped silently rather than reported as an unsupported `<linearGradient>` element; a referenced radial gradient or pattern is still reported, by name, where it is referenced. `isRendering` (parse.ts ~453) reads `SILENT` too, so the root-level walk and its `allGroups` layer detection skip them as well — which matters: a top-level `<linearGradient>` would otherwise stop a file of top-level `<g>`s being read as layers. The test "drops radial gradients and patterns by name" places them outside `<defs>` and expects exactly those two labels, which pins this.
  9. Check whether `"gradients/patterns"` is still reachable: `parseColor` now returns `unsupported` only for external `url(…)`; keep that label for it.
- [ ] **Step 4: Update any existing parse test that asserted `"gradients/patterns"`** for a same-document gradient: search `grep -n "gradients/patterns" src/__tests__/*.ts`. Such a test now expects the gradient kept (or the specific new label). Update its expectation to the new behaviour and keep its intent (e.g. "unsupported paints are reported") by switching it to a radial gradient or pattern.

- [ ] **Step 5: Run**

Run: `npx vitest run src/__tests__/gradient-roundtrip.test.ts src/__tests__/parse.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Build and commit**

Run: `npm run build 2>&1 | grep -E "COMPLETED|error" && npm run lint`

```bash
git add -A
git commit -m "feat(M15): import linear gradients, resolved per painted shape

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Geometry bakes map the gradient

**Files:**
- Modify: `src/doc/resize.ts` (`resizeNode`)
- Modify: `src/doc/edits.ts` (`flattenTransform`)
- Modify: `src/doc/path-ops.ts` (`combine`)
- Modify: `src/doc/boolean-edit.ts` (`booleanShapes`)
- Test: `src/__tests__/gradient-bake.test.ts` (new)

**Interfaces:**
- Consumes: `mapStyle` (Task 1).

- [ ] **Step 1: Write the failing tests** — `src/__tests__/gradient-bake.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { booleanShapes } from "../doc/boolean-edit";
import { createDoc, DEFAULT_STYLE, type Doc, type LinearGradient, type Node, type Shape } from "../doc/document";
import { flattenTransform } from "../doc/edits";
import { combine } from "../doc/path-ops";
import { resizeNodes } from "../doc/resize";
import { findNode } from "../doc/tree";
import { IDENTITY, translate, type Mat } from "../geom/mat";

const g: LinearGradient = {
  kind: "linear",
  from: { x: 0, y: 5 },
  to: { x: 10, y: 5 },
  start: { color: "#ff0000", opacity: 1 },
  end: { color: "#0000ff", opacity: 1 },
};
const rect = (id: string, x: number, t: Mat = IDENTITY): Node => ({
  kind: "rect",
  id,
  transform: t,
  style: { ...DEFAULT_STYLE, fill: g },
  x,
  y: 0,
  w: 10,
  h: 10,
  rx: 0,
});
const path = (id: string, t: Mat): Node => ({
  kind: "path",
  id,
  transform: t,
  style: { ...DEFAULT_STYLE, fill: g },
  subpaths: [{ closed: true, nodes: [0, 10].flatMap((x) => [0, 10].map((y) => ({ p: { x, y: x ? 10 - y : y }, in: null, out: null, type: "corner" as const }))) }],
});
const doc = (children: Node[]): Doc => {
  const d = createDoc(200, 200);
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children }] };
};
const fillOf = (d: Doc, id: string) => (findNode(d, id)!.node as Shape).style.fill as LinearGradient;

describe("bakes map the gradient (spec M15 §5)", () => {
  it("resize scales the points with the geometry", () => {
    const out = resizeNodes(doc([rect("a", 0)]), ["a"], [2, 0, 0, 1, 0, 0]);
    expect(fillOf(out, "a").from).toEqual({ x: 0, y: 5 });
    expect(fillOf(out, "a").to).toEqual({ x: 20, y: 5 });
  });

  it("a horizontal flip mirrors the gradient", () => {
    const out = resizeNodes(doc([rect("a", 0)]), ["a"], [-1, 0, 0, 1, 10, 0]);
    expect(fillOf(out, "a").from.x).toBeCloseTo(10, 9);
    expect(fillOf(out, "a").to.x).toBeCloseTo(0, 9);
  });

  it("flatten bakes the transform into the points", () => {
    const out = flattenTransform(doc([path("p", translate(100, 0))]), ["p"]);
    expect(fillOf(out, "p").from).toEqual({ x: 100, y: 5 });
  });

  it("combine maps the front shape's gradient into the result's space", () => {
    const r = combine(doc([path("p", IDENTITY), path("q", translate(50, 0))]), ["p", "q"]);
    expect(r).not.toBeNull();
    expect(fillOf(r!.doc, r!.id).from).toEqual({ x: 50, y: 5 });
  });

  it("a boolean maps the surviving style's gradient into the result's space", async () => {
    // b is frontmost, at document x 5…15 overlapping a; its gradient's own-space from (0, 5) must
    // come back as (5, 5) in the result's identity space.
    const out = await booleanShapes(doc([rect("a", 0), rect("b", 0, translate(5, 0))]), ["a", "b"], "unite");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(fillOf(out.doc, out.id).from).toEqual({ x: 5, y: 5 });
  });
});
```

Before running, open `src/doc/boolean-edit.ts` and read `BoolOutcome` for the exact field names on success (`doc`, `id` or `ids`) and adjust `out.doc` / `out.id` to match. Remove any unused import (`IDENTITY`, `Mat`) so lint stays clean.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/gradient-bake.test.ts`
Expected: the resize/flip/flatten/combine/boolean assertions FAIL (points unchanged).

- [ ] **Step 3: Implement.**
  - `resize.ts` `resizeNode`, last line:
    ```ts
    const baked = bakeShape(node, L);
    // Spec M15 §5: the gradient lives in the same own space as the geometry just baked.
    const style = mapStyle(baked.style, L);
    return style === baked.style ? baked : { ...baked, style };
    ```
  - `edits.ts` `flattenTransform`: `{ ...withBakedSubpaths(n, transformSubpaths(n.subpaths, n.transform)), style: mapStyle(n.style, n.transform), transform: IDENTITY }`.
  - `path-ops.ts` `combine`: `style: mapStyle(front.path.style, front.path.transform),` — the result has identity transform in the front shape's parent space, and `into` for the front operand is exactly its `transform` there.
  - `boolean-edit.ts`: `style: mapStyle(styleFrom.path.style, multiply(toParent, multiply(styleFrom.found.parent, styleFrom.path.transform))),` (import `multiply` if missing). Read how the file names these (`found.parent`, `path.transform`) and match it.
  - Import `mapStyle` from `./document` in each.

- [ ] **Step 4: Run**

Run: `npx vitest run src/__tests__/gradient-bake.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(M15): resize, flatten, combine and booleans carry the gradient

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Pure paint edits

**Files:**
- Modify: `src/doc/tree.ts` (`shapesWithWorld`)
- Create: `src/doc/paint-edit.ts`
- Test: `src/__tests__/paint-edit.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 model; `mapNodes`, `findNode` (tree.ts); `nodeBounds` (geom/bounds); `applyMat`, `invert`, `multiply` (geom/mat).
- Produces:
  ```ts
  // tree.ts
  export function shapesWithWorld(node: Node, parent: Mat): { shape: Shape; world: Mat }[];
  // paint-edit.ts
  export type PaintSlot = "fill" | "stroke";
  export type StopEnd = "start" | "end";
  export function setPaintKind(doc: Doc, ids: readonly string[], which: PaintSlot, kind: "flat" | "linear"): Doc;
  export function setGradientStop(doc: Doc, ids: readonly string[], which: PaintSlot, stop: StopEnd, paint: Paint): Doc;
  export function setGradientPoints(doc: Doc, id: string, which: PaintSlot, from: Vec, to: Vec): Doc; // own space
  export function drawGradientLine(doc: Doc, ids: readonly string[], which: PaintSlot, from: Vec, to: Vec): Doc; // document space
  ```

- [ ] **Step 1: Write the failing tests** — `src/__tests__/paint-edit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type LinearGradient, type Node, type Shape } from "../doc/document";
import { drawGradientLine, setGradientPoints, setGradientStop, setPaintKind } from "../doc/paint-edit";
import { findNode } from "../doc/tree";
import { IDENTITY, translate, type Mat } from "../geom/mat";
import { deepFreeze } from "./helpers";

const red = { color: "#ff0000", opacity: 1 };
const blue = { color: "#0000ff", opacity: 1 };
const lin = (fx: number, tx: number): LinearGradient => ({
  kind: "linear",
  from: { x: fx, y: 0 },
  to: { x: tx, y: 0 },
  start: red,
  end: blue,
});
const rect = (id: string, x: number, fill: Shape["style"]["fill"], t: Mat = IDENTITY): Node => ({
  kind: "rect",
  id,
  transform: t,
  style: { ...DEFAULT_STYLE, fill },
  x,
  y: 0,
  w: 100,
  h: 50,
  rx: 0,
});
const doc = (children: Node[]): Doc => {
  const d = createDoc(400, 400);
  return deepFreeze({ ...d, layers: [{ ...d.layers[0], id: "L0", children }] });
};
const fill = (d: Doc, id: string) => (findNode(d, id)!.node as Shape).style.fill;

describe("setPaintKind (spec M15 §6)", () => {
  it("Flat→Linear fades the colour across each shape's own box at mid-height", () => {
    const d = doc([rect("a", 0, red), rect("b", 200, blue, translate(0, 100))]);
    const out = setPaintKind(d, ["a", "b"], "fill", "linear");
    expect(fill(out, "a")).toEqual({ kind: "linear", from: { x: 0, y: 25 }, to: { x: 100, y: 25 }, start: red, end: { ...red, opacity: 0 } });
    expect(fill(out, "b")).toEqual({ kind: "linear", from: { x: 200, y: 25 }, to: { x: 300, y: 25 }, start: blue, end: { ...blue, opacity: 0 } });
  });

  it("Linear→Flat keeps the start stop; null and already-matching paints are left alone", () => {
    const d = doc([rect("a", 0, lin(0, 10)), rect("b", 0, null), rect("c", 0, red)]);
    const out = setPaintKind(d, ["a", "b", "c"], "fill", "flat");
    expect(fill(out, "a")).toEqual(red);
    expect(fill(out, "b")).toBeNull();
    expect(findNode(out, "c")!.node).toBe(findNode(d, "c")!.node);
    expect(setPaintKind(d, ["c"], "fill", "flat")).toBe(d);
  });
});

describe("setGradientStop", () => {
  it("replaces one stop on every linear paint and leaves flat ones alone", () => {
    const d = doc([rect("a", 0, lin(0, 10)), rect("b", 0, red)]);
    const green = { color: "#00ff00", opacity: 0.5 };
    const out = setGradientStop(d, ["a", "b"], "fill", "end", green);
    expect(fill(out, "a")).toEqual({ ...lin(0, 10), end: green });
    expect(findNode(out, "b")!.node).toBe(findNode(d, "b")!.node);
    expect(setGradientStop(out, ["a"], "fill", "end", green)).toBe(out);
  });
});

describe("setGradientPoints", () => {
  it("sets the points in own space, and collapses coincident ones to the end stop", () => {
    const d = doc([rect("a", 0, lin(0, 10))]);
    expect(fill(setGradientPoints(d, "a", "fill", { x: 1, y: 2 }, { x: 3, y: 4 }), "a")).toEqual({ ...lin(0, 10), from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });
    expect(fill(setGradientPoints(d, "a", "fill", { x: 5, y: 5 }, { x: 5, y: 5 }), "a")).toEqual(blue);
    expect(setGradientPoints(d, "a", "fill", { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(d);
  });
});

describe("drawGradientLine (spec M15 §7)", () => {
  it("maps one document-space line into every shape's own space, through groups", () => {
    const group: Node = { kind: "group", id: "g", transform: translate(0, 100), opacity: 1, children: [rect("b", 0, red, translate(10, 0))] };
    const d = doc([rect("a", 0, lin(0, 10)), group]);
    const out = drawGradientLine(d, ["a", "g"], "fill", { x: 0, y: 110 }, { x: 50, y: 110 });
    expect(fill(out, "a")).toEqual({ ...lin(0, 10), from: { x: 0, y: 110 }, to: { x: 50, y: 110 } });
    // b's world = translate(0,100)·translate(10,0): own = doc − (10, 100).
    expect(fill(out, "b")).toEqual({ kind: "linear", from: { x: -10, y: 10 }, to: { x: 40, y: 10 }, start: red, end: { ...red, opacity: 0 } });
  });

  it("starts a null paint from the default paint for that slot", () => {
    const d = doc([rect("a", 0, null)]);
    const f = fill(drawGradientLine(d, ["a"], "fill", { x: 0, y: 0 }, { x: 10, y: 0 }), "a") as LinearGradient;
    expect(f.start).toEqual(DEFAULT_STYLE.fill);
    expect(f.end).toEqual({ ...DEFAULT_STYLE.fill!, opacity: 0 });
  });

  it("skips a shape whose world matrix is singular", () => {
    const d = doc([rect("a", 0, red, [0, 0, 0, 1, 0, 0])]);
    expect(drawGradientLine(d, ["a"], "fill", { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(d);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/paint-edit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** In `tree.ts`, after `shapesOf`:

```ts
/** Like `shapesOf`, with each shape's world matrix given the node's `parent` matrix. */
export function shapesWithWorld(node: Node, parent: Mat): { shape: Shape; world: Mat }[] {
  const world = multiply(parent, node.transform);
  if (node.kind !== "group") return [{ shape: node, world }];
  return node.children.flatMap((c) => shapesWithWorld(c, world));
}
```

(import `multiply` from `../geom/mat` if tree.ts does not already). Then `src/doc/paint-edit.ts`:

```ts
import { nodeBounds } from "../geom/bounds";
import { applyMat, IDENTITY, invert, multiply, type Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";
import {
  DEFAULT_STYLE,
  flatIfDegenerate,
  isGradient,
  sameFill,
  type Doc,
  type Fill,
  type LinearGradient,
  type Node,
  type Paint,
  type Shape,
} from "./document";
import { mapNodes } from "./tree";

/** Spec M15 §6–§7: the gradient edits. Each maps shape by shape, so no shape is ever handed
 *  another shape's coordinates. */

export type PaintSlot = "fill" | "stroke";
export type StopEnd = "start" | "end";

function withFill(s: Shape, which: PaintSlot, f: Fill | null): Shape {
  return sameFill(s.style[which], f) ? s : { ...s, style: { ...s.style, [which]: f } };
}

/** Maps every shape under `ids`, groups descended, with each shape's world matrix. */
function mapShapesWorld(
  doc: Doc,
  ids: readonly string[],
  fn: (s: Shape, world: Mat) => Shape,
): Doc {
  const walk = (n: Node, parent: Mat): Node => {
    const world = multiply(parent, n.transform);
    if (n.kind !== "group") return fn(n, world);
    let changed = false;
    const children = n.children.map((c) => {
      const m = walk(c, world);
      if (m !== c) changed = true;
      return m;
    });
    return changed ? { ...n, children } : n;
  };
  return mapNodes(doc, ids, walk);
}

/** A fade from the paint to the same colour at opacity 0: the most common first gradient, and
 *  one that is visibly a gradient (spec M15 ruling 5). */
const fadeOf = (p: Paint, from: Vec, to: Vec): LinearGradient => ({
  kind: "linear",
  from,
  to,
  start: p,
  end: { ...p, opacity: 0 },
});

export function setPaintKind(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  kind: "flat" | "linear",
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    if (f === null) return s;
    if (kind === "flat") return isGradient(f) ? withFill(s, which, f.start) : s;
    if (isGradient(f)) return s;
    const box = nodeBounds({ ...s, transform: IDENTITY }, IDENTITY);
    if (!box || box.w <= 0) return s;
    const y = box.y + box.h / 2;
    return withFill(s, which, fadeOf(f, { x: box.x, y }, { x: box.x + box.w, y }));
  });
}

export function setGradientStop(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  stop: StopEnd,
  paint: Paint,
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    return isGradient(f) ? withFill(s, which, { ...f, [stop]: paint }) : s;
  });
}

/** `from`/`to` in the shape's own space; used by the tool's knob and line drags. */
export function setGradientPoints(
  doc: Doc,
  id: string,
  which: PaintSlot,
  from: Vec,
  to: Vec,
): Doc {
  return mapNodes(doc, [id], (n) => {
    if (n.kind === "group") return n;
    const f = n.style[which];
    return isGradient(f) ? withFill(n, which, flatIfDegenerate({ ...f, from, to })) : n;
  });
}

/** One document-space line mapped into every shape under `ids`, so a line drawn across several
 *  shapes reads as one continuous gradient (spec M15 §7). */
export function drawGradientLine(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  from: Vec,
  to: Vec,
): Doc {
  return mapShapesWorld(doc, ids, (s, world) => {
    const inv = invert(world);
    if (!inv) return s;
    const a = applyMat(inv, from);
    const b = applyMat(inv, to);
    const f = s.style[which];
    const next: LinearGradient = isGradient(f)
      ? { ...f, from: a, to: b }
      : fadeOf(f ?? (DEFAULT_STYLE[which] as Paint), a, b);
    return withFill(s, which, flatIfDegenerate(next));
  });
}
```

Note `mapNodes` calls `fn(node, parent)` where `parent` is the node's parent matrix, so `walk(n, parent)` composes `n.transform` itself — confirm against `tree.ts` line ~165 and keep it that way.

- [ ] **Step 4: Run**

Run: `npx vitest run src/__tests__/paint-edit.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(M15): pure gradient edits — kind, stops, points and drawn lines

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Store state and the Properties panel

**Files:**
- Modify: `src/state/appState.svelte.ts` (state, actions, Escape, clear on selection change)
- Create: `src/lib/PaintRow.svelte`
- Modify: `src/lib/PaintField.svelte`, `src/lib/PropertiesPanel.svelte`
- Test: `src/__tests__/gradient-store.test.ts` (new), `src/__tests__/properties.test.ts`

**Interfaces:**
- Consumes: Task 5 edits.
- Produces (store):
  ```ts
  app.gradientTarget: PaintSlot            // $state, default "fill"
  app.gradientStop: { id: string; stop: StopEnd } | null   // $state.raw
  export function setGradientTarget(which: PaintSlot): void;
  export function setGradientStop(pick: { id: string; stop: StopEnd } | null): void;
  export function setSelectionPaintKind(which: PaintSlot, kind: "flat" | "linear"): void;
  export function setSelectionGradientStop(which: PaintSlot, stop: StopEnd, paint: Paint): void;
  ```

- [ ] **Step 1: Write the failing store tests** — `src/__tests__/gradient-store.test.ts`. Model it on `src/__tests__/node-store.test.ts` (read it first for how it resets the store and builds a document — reuse exactly that setup). Tests:

```ts
// Setup as in node-store.test.ts: replaceDocument(doc with rect "a" (fill red) and rect "b" (fill red)), then setSelection(["a", "b"]).
it("Flat→Linear and a stop edit are single undo steps per shape", () => {
  setSelectionPaintKind("fill", "linear");
  expect(isGradient(styleOf("a").fill)).toBe(true);
  setSelectionGradientStop("fill", "end", { color: "#00ff00", opacity: 1 });
  expect((styleOf("b").fill as LinearGradient).end.color).toBe("#00ff00");
  undo();
  expect((styleOf("b").fill as LinearGradient).end.color).toBe("#ff0000");
  undo();
  expect(isGradient(styleOf("a").fill)).toBe(false);
});

it("a picked stop is cleared by a selection change and by Escape before the selection", () => {
  setGradientStop({ id: "a", stop: "start" });
  setSelection(["a"]);
  expect(app.gradientStop).toBeNull();
  setGradientStop({ id: "a", stop: "end" });
  clearOrLeaveGroup();
  expect(app.gradientStop).toBeNull();
  expect(app.selection).toEqual(["a"]);
  clearOrLeaveGroup();
  expect(app.selection).toEqual([]);
});

it("the target defaults to fill and is kept", () => {
  expect(app.gradientTarget).toBe("fill");
  setGradientTarget("stroke");
  expect(app.gradientTarget).toBe("stroke");
});
```

(`styleOf(id)` = `(findNode(app.doc, id)!.node as Shape).style`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/gradient-store.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement the store.** In `AppState`, beside `charSel`:

```ts
  /** Which paint the Gradient tool edits (spec M15 §6). Not saved, not undoable; kept for the
   *  session. */
  gradientTarget = $state<PaintSlot>("fill");
  /** The stop picked on the canvas, highlighted in the panel (spec M15 §7). Store state like
   *  `nodeSel`: not saved, not undoable, cleared with the selection. */
  gradientStop = $state.raw<{ id: string; stop: StopEnd } | null>(null);
```

Rename `clearCharSel` to `clearSubSelections` and make it clear both (`charSel` and `gradientStop`); update its call in `setSelection`. In `clearOrLeaveGroup`, right after the `charSel` branch:

```ts
  if (app.gradientStop !== null) {
    app.gradientStop = null;
    return;
  }
```

Actions (near `setSelectionStyle`):

```ts
export function setGradientTarget(which: PaintSlot): void {
  app.gradientTarget = which;
}

export function setGradientStop(pick: { id: string; stop: StopEnd } | null): void {
  app.gradientStop = pick;
}

export function setSelectionPaintKind(which: PaintSlot, kind: "flat" | "linear"): void {
  cancelActiveGesture();
  if (app.selection.length === 0) return;
  commitDoc(setPaintKind(app.doc, app.selection, which, kind));
}

export function setSelectionGradientStop(which: PaintSlot, stop: StopEnd, paint: Paint): void {
  cancelActiveGesture();
  if (app.selection.length === 0) return;
  commitDoc(setGradientStop(app.doc, app.selection, which, stop, paint));
}
```

Imports: `setGradientStop as setGradientStopEdit`? — the edit and the action share a name; import the edit as `import { setGradientStop as applyGradientStop, setPaintKind, type PaintSlot, type StopEnd } from "../doc/paint-edit";` and call `applyGradientStop(…)` in the action.

- [ ] **Step 4: Run store tests**

Run: `npx vitest run src/__tests__/gradient-store.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Extract `PaintRow.svelte`** — the swatch + hex + opacity row from `PaintField.svelte` (the `<div class="flex items-center gap-2">…</div>` block, its `hexDraft`/`live` state, `startLive`/`endLive`/`setColor` and the `$effect` cleanup) into a component:

```svelte
<script lang="ts">
  import type { Paint } from "../doc/document";
  import NumberField from "./NumberField.svelte";

  let {
    label,
    paint,
    selected = false,
    onchange,
    onlivestart,
    onliveend,
  }: {
    /** Accessible name prefix, e.g. "Fill" or "Fill start". */
    label: string;
    paint: Paint;
    /** The stop picked on the canvas (spec M15 §7). */
    selected?: boolean;
    onchange: (p: Paint) => void;
    onlivestart?: () => void;
    onliveend?: () => void;
  } = $props();
  // …the moved state and functions, with setColor calling onchange({ color: hex, opacity: paint.opacity })
</script>

<div class={["flex items-center gap-2 rounded", selected && "ui-selected"]}>
  <!-- the moved swatch input, hex input and opacity NumberField, unchanged except that `paint` is
       now a prop, `{label}` in the aria-labels, and the opacity onchange calls
       onchange({ ...paint, opacity: v / 100 }) -->
</div>
```

Move the code verbatim — including its comments (the `--ctl-h` swatch comment and the live-drag `endLive` comment) — and keep invariant 42's bracket closing on `change`, `blur` and destruction.

- [ ] **Step 6: Rewrite `PaintField.svelte`** on top of it. Props gain `kind: Field<"flat" | "linear"> | null` (null = nothing selected → Linear disabled), `stops: { start: Field<Paint>; end: Field<Paint> } | null`, `picked: StopEnd | null`, `onkind: (k: "flat" | "linear") => void`, `onstop: (stop: StopEnd, p: Paint) => void`. Body:

```svelte
<div class="flex flex-col gap-1">
  <div class="flex items-center justify-between">
    <span class="section-title">{label}</span>
    <ToggleButton … unchanged "On" toggle … />
  </div>
  {#if present.mixed || present.value}
    <div class="flex gap-1">
      <ToggleButton
        label="Flat"
        ariaLabel={`${label} flat`}
        value={kind === null ? true : kind.mixed ? "mixed" : kind.value === "flat"}
        onchange={() => onkind("flat")}
      />
      <!-- Spec M15 §6: with nothing selected the panel edits the defaults for new shapes, which
           stay flat — so Linear says why it does nothing instead of disappearing (invariant 24). -->
      <span title={kind === null ? "Linear gradient — select an object first" : "Linear gradient"}>
        <ToggleButton
          label="Linear"
          ariaLabel={`${label} linear gradient`}
          value={kind === null ? false : kind.mixed ? "mixed" : kind.value === "linear"}
          onchange={() => kind !== null && onkind("linear")}
        />
      </span>
    </div>
  {/if}
  {#if paint}
    <PaintRow {label} {paint} onchange={(p) => onchange(p)} {onlivestart} {onliveend} />
  {:else if stops}
    {#each STOPS as stop (stop)}
      {@const f = stops[stop]}
      {#if !f.mixed}
        <div class="flex items-center gap-2">
          <span class="w-9 shrink-0 text-muted">{stop === "start" ? "Start" : "End"}</span>
          <PaintRow
            label={`${label} ${stop}`}
            paint={f.value}
            selected={picked === stop}
            onchange={(p) => onstop(stop, p)}
            {onlivestart}
            {onliveend}
          />
        </div>
      {/if}
    {/each}
  {/if}
</div>
```

with `const STOPS: readonly StopEnd[] = ["start", "end"];` in the script (import `type StopEnd` from `../doc/paint-edit`). If `ToggleButton` cannot express `aria-disabled`, the wrapping `<span title>` above carries the reason (the status-bar hint reads the nearest `title`, invariant 24); a press with nothing selected is a no-op.

- [ ] **Step 7: Summaries for the new props** — in `src/state/properties.ts` add and export:

```ts
export type GradientSummary = {
  kind: Field<"flat" | "linear">;
  stops: { start: Field<Paint>; end: Field<Paint> } | null;
};

/** Spec M15 §6: which kind each non-null paint is, and — when every one is linear — each stop
 *  merged across them. Null when no selected shape has this paint. */
export function summarizeGradient(styles: readonly Style[], which: "fill" | "stroke"): GradientSummary | null {
  const fills = styles.map((s) => s[which]).filter((f): f is Fill => f !== null);
  if (fills.length === 0) return null;
  const kind = merge(fills.map((f) => (isGradient(f) ? "linear" : "flat") as "flat" | "linear"));
  const grads = fills.filter(isGradient);
  const stops =
    grads.length === fills.length
      ? {
          start: merge(grads.map((g) => g.start), samePaint),
          end: merge(grads.map((g) => g.end), samePaint),
        }
      : null;
  return { kind, stops };
}
```

with a unit test in `src/__tests__/properties.test.ts`:

```ts
it("summarizes gradient kind and stops (spec M15 §6)", () => {
  const g = { kind: "linear" as const, from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, start: { color: "#ff0000", opacity: 1 }, end: { color: "#0000ff", opacity: 1 } };
  const s = (fill: Style["fill"]): Style => ({ ...DEFAULT_STYLE, fill });
  expect(summarizeGradient([s(g), s({ ...g, from: { x: 5, y: 5 } })], "fill")).toEqual({
    kind: { mixed: false, value: "linear" },
    stops: { start: { mixed: false, value: g.start }, end: { mixed: false, value: g.end } },
  });
  expect(summarizeGradient([s(g), s(g.start)], "fill")).toEqual({ kind: { mixed: true }, stops: null });
  expect(summarizeGradient([s(null)], "fill")).toBeNull();
});
```

- [ ] **Step 8: Wire `PropertiesPanel.svelte`.** Derive `const fillGrad = $derived(hasSelection ? summarizeGradient(selectionStyles(app.doc, app.selection), "fill") : null);` and the same for stroke. Pass to each `PaintField`: `kind={fillGrad?.kind ?? null}`, `stops={fillGrad?.stops ?? null}`, `picked={app.gradientStop && app.selection.includes(app.gradientStop.id) ? app.gradientStop.stop : null}` — for Stroke only when `app.gradientTarget === "stroke"`, for Fill only when it is `"fill"` — `onkind={(k) => setSelectionPaintKind("fill", k)}`, `onstop={(stop, p) => setSelectionGradientStop("fill", stop, p)}`. When nothing is selected pass `kind={null}` (the defaults are flat).

  The Gradient section (the tool's Fill/Stroke switch) and its `SECTION_IDS` entry arrive with the tool in Task 7, because `"gradient"` joins `ToolId` there.

- [ ] **Step 9: Build and check the panel renders** — `npm run build 2>&1 | grep -E "COMPLETED|error"` (0/0), `npm test`, `npm run lint`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(M15): Flat/Linear and the two stops in the Properties panel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The Gradient tool

**Files:**
- Modify: `src/tools/types.ts` (`ToolId` gains `"gradient"`)
- Modify: `src/tools/tool.ts` (`ToolContext` gains three members)
- Create: `src/tools/gradient-handles.ts`, `src/tools/gradient-tool.ts`
- Modify: `src/tools/registry.ts`, `src/tools/context.ts`, `src/__tests__/fake-context.ts`
- Modify: `src/state/keys.ts` (`g: "gradient"`), `src/lib/ToolStrip.svelte` (Blend icon), `src/lib/Overlay.svelte` (draw handles), `src/lib/PropertiesPanel.svelte` (the Gradient section), `src/persist/preferences.ts` (`SECTION_IDS` gains `"gradient"`)
- Test: `src/__tests__/gradient-tool.test.ts` (new), `src/__tests__/prefs-route-keys.test.ts` (G key)

**Interfaces:**
- Consumes: `setGradientPoints`, `drawGradientLine`, `PaintSlot`, `StopEnd` (Task 5); `shapesWithWorld` (Task 5); store actions (Task 6).
- Produces:
  ```ts
  // gradient-handles.ts
  export type GradientHandle = { id: string; from: Vec; to: Vec; start: Paint; end: Paint; world: Mat };
  export function gradientHandles(doc: Doc, ids: readonly string[], which: PaintSlot): GradientHandle[];
  export type HandlePick = { h: GradientHandle; part: "start" | "end" | "line" } | null;
  export function pickHandle(handles: readonly GradientHandle[], p: Vec, tol: number): HandlePick;
  // tool.ts ToolContext additions
  gradientTarget(): PaintSlot;
  gradientStop(): { id: string; stop: StopEnd } | null;
  setGradientStop(pick: { id: string; stop: StopEnd } | null): void;
  ```

- [ ] **Step 1: Write the failing tests** — `src/__tests__/gradient-tool.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, isGradient, type Doc, type LinearGradient, type Node, type Shape } from "../doc/document";
import { findNode } from "../doc/tree";
import { IDENTITY, rotate, translate, type Mat } from "../geom/mat";
import { gradientHandles, pickHandle } from "../tools/gradient-handles";
import { createGradientTool } from "../tools/gradient-tool";
import { ev, fakeContext } from "./fake-context";

const red = { color: "#ff0000", opacity: 1 };
const blue = { color: "#0000ff", opacity: 1 };
const lin: LinearGradient = { kind: "linear", from: { x: 0, y: 25 }, to: { x: 100, y: 25 }, start: red, end: blue };
const rect = (id: string, x: number, fill: Shape["style"]["fill"], t: Mat = IDENTITY): Node => ({
  kind: "rect", id, transform: t, style: { ...DEFAULT_STYLE, fill }, x, y: 0, w: 100, h: 50, rx: 0,
});
const doc = (children: Node[]): Doc => {
  const d = createDoc(400, 400);
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children }] };
};
const fillOf = (d: Doc, id: string) => (findNode(d, id)!.node as Shape).style.fill;
const drag = (tool: ReturnType<typeof createGradientTool>, ctx: ReturnType<typeof fakeContext>["ctx"], pts: [number, number][], mods = {}) => {
  tool.down(ctx, ev(pts[0][0], pts[0][1], mods));
  for (const [x, y] of pts.slice(1)) tool.move(ctx, ev(x, y, mods));
  const [x, y] = pts[pts.length - 1];
  tool.up(ctx, ev(x, y, mods));
};

describe("gradientHandles / pickHandle", () => {
  it("returns document-space points through the world matrix and picks knobs before the line", () => {
    const hs = gradientHandles(doc([rect("a", 0, lin, translate(10, 10))]), ["a"], "fill");
    expect(hs).toHaveLength(1);
    expect(hs[0].from).toEqual({ x: 10, y: 35 });
    expect(hs[0].to).toEqual({ x: 110, y: 35 });
    expect(pickHandle(hs, { x: 12, y: 36 }, 6)?.part).toBe("start");
    expect(pickHandle(hs, { x: 60, y: 37 }, 6)?.part).toBe("line");
    expect(pickHandle(hs, { x: 60, y: 60 }, 6)).toBeNull();
  });

  it("ignores shapes whose target paint is flat, and reads the stroke when asked", () => {
    const d = doc([rect("a", 0, red), { ...rect("b", 0, red), style: { ...DEFAULT_STYLE, stroke: lin } } as Node]);
    expect(gradientHandles(d, ["a", "b"], "fill")).toEqual([]);
    expect(gradientHandles(d, ["a", "b"], "stroke").map((h) => h.id)).toEqual(["b"]);
  });
});

describe("the Gradient tool (spec M15 §7)", () => {
  it("drags a knob in the shape's own space, as one undo step", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin, rotate(Math.PI / 2))]));
    ctx.setSelection(["a"]);
    // rotate(90°): own (100, 25) is at document (-25, 100).
    const tool = createGradientTool();
    drag(tool, ctx, [[-25, 100], [-25, 130], [-25, 150]]);
    const f = fillOf(ctx.doc(), "a") as LinearGradient;
    expect(f.to.x).toBeCloseTo(150, 9);
    expect(f.to.y).toBeCloseTo(25, 9);
    expect(state.session.history.past.length).toBe(1);
  });

  it("drags the line to move both ends", () => {
    const { ctx } = fakeContext(doc([rect("a", 0, lin)]));
    ctx.setSelection(["a"]);
    drag(createGradientTool(), ctx, [[50, 25], [60, 35]]);
    expect(fillOf(ctx.doc(), "a")).toEqual({ ...lin, from: { x: 10, y: 35 }, to: { x: 110, y: 35 } });
  });

  it("draws a new line across every selected shape", () => {
    const { ctx } = fakeContext(doc([rect("a", 0, red), rect("b", 200, red)]));
    ctx.setSelection(["a", "b"]);
    drag(createGradientTool(), ctx, [[0, 200], [150, 200], [300, 200]]);
    for (const id of ["a", "b"]) {
      expect(fillOf(ctx.doc(), id)).toEqual({ kind: "linear", from: { x: 0, y: 200 }, to: { x: 300, y: 200 }, start: red, end: { ...red, opacity: 0 } });
    }
  });

  it("with nothing selected, selects the shape under the press and draws its line", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, red)]));
    drag(createGradientTool(), ctx, [[10, 10], [60, 10], [90, 10]]);
    expect(state.selection).toEqual(["a"]);
    expect(isGradient(fillOf(ctx.doc(), "a"))).toBe(true);
  });

  it("Shift constrains the dragged direction to 45°", () => {
    const { ctx } = fakeContext(doc([rect("a", 0, red)]));
    ctx.setSelection(["a"]);
    drag(createGradientTool(), ctx, [[0, 0], [100, 10]], { shift: true });
    const f = fillOf(ctx.doc(), "a") as LinearGradient;
    expect(f.to.y).toBeCloseTo(0, 9);
    expect(f.to.x).toBeCloseTo(Math.hypot(100, 10), 9);
  });

  it("a click on a knob picks that stop; a click on empty canvas clears the selection", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    ctx.setSelection(["a"]);
    const tool = createGradientTool();
    tool.down(ctx, ev(100, 25));
    tool.up(ctx, ev(100, 25));
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "end" });
    tool.down(ctx, ev(300, 300));
    tool.up(ctx, ev(300, 300));
    expect(state.selection).toEqual([]);
  });

  it("dropping one knob on the other collapses to the end stop's flat paint", () => {
    const { ctx } = fakeContext(doc([rect("a", 0, lin)]));
    ctx.setSelection(["a"]);
    drag(createGradientTool(), ctx, [[0, 25], [50, 25], [100, 25]]);
    expect(fillOf(ctx.doc(), "a")).toEqual(blue);
  });
});
```

(`Session.history.past` is the undo stack — `src/state/history.ts`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/gradient-tool.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Extend the context.** `types.ts`: add `| "gradient"` to `ToolId`. `tool.ts`: import `type { PaintSlot, StopEnd } from "../doc/paint-edit"` and add to `ToolContext`:

```ts
  /** Which paint the Gradient tool edits (spec M15 §6). */
  gradientTarget(): PaintSlot;
  /** The stop picked on the canvas, or null (spec M15 §7). */
  gradientStop(): { id: string; stop: StopEnd } | null;
  setGradientStop(pick: { id: string; stop: StopEnd } | null): void;
```

`fake-context.ts`: `FakeState` gains `gradientTarget: PaintSlot` (init `"fill"`) and `gradientStop: {…} | null` (init `null`); `setSelection` also sets `state.gradientStop = null` (mirroring the store); the three members read/write them. `context.ts`: `gradientTarget: () => app.gradientTarget, gradientStop: () => app.gradientStop, setGradientStop,` (import `setGradientStop` from the store).

- [ ] **Step 4: Implement `gradient-handles.ts`:**

```ts
import { isGradient, type Doc, type Paint } from "../doc/document";
import type { PaintSlot } from "../doc/paint-edit";
import { findNode, shapesWithWorld } from "../doc/tree";
import { applyMat, type Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";

/** Spec M15 §7: the one function the Overlay draws from and the tool hit-tests against, so the
 *  two can never disagree (the gizmo's rule, invariant 14). Points are in document space. */
export type GradientHandle = { id: string; from: Vec; to: Vec; start: Paint; end: Paint; world: Mat };

export function gradientHandles(doc: Doc, ids: readonly string[], which: PaintSlot): GradientHandle[] {
  const out: GradientHandle[] = [];
  for (const id of ids) {
    const found = findNode(doc, id);
    if (!found) continue;
    for (const { shape, world } of shapesWithWorld(found.node, found.parent)) {
      const f = shape.style[which];
      if (!isGradient(f)) continue;
      out.push({ id: shape.id, from: applyMat(world, f.from), to: applyMat(world, f.to), start: f.start, end: f.end, world });
    }
  }
  return out;
}

export type HandlePick = { h: GradientHandle; part: "start" | "end" | "line" } | null;

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function toSegment(p: Vec, a: Vec, b: Vec): number {
  const v = { x: b.x - a.x, y: b.y - a.y };
  const vv = v.x * v.x + v.y * v.y;
  const t = vv === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / vv));
  return dist(p, { x: a.x + v.x * t, y: a.y + v.y * t });
}

/** Knobs first, across every handle, then lines — a knob sits on its own line, and the first hit
 *  in document order wins, as `hitTest` does. */
export function pickHandle(handles: readonly GradientHandle[], p: Vec, tol: number): HandlePick {
  for (const h of handles) {
    if (dist(h.from, p) <= tol) return { h, part: "start" };
    if (dist(h.to, p) <= tol) return { h, part: "end" };
  }
  for (const h of handles) if (toSegment(p, h.from, h.to) <= tol) return { h, part: "line" };
  return null;
}
```

- [ ] **Step 5: Implement `gradient-tool.ts`:**

```ts
import type { Doc } from "../doc/document";
import { drawGradientLine, setGradientPoints } from "../doc/paint-edit";
import { hitTest } from "../geom/hit";
import { applyMat, invert } from "../geom/mat";
import type { Vec } from "../geom/vec";
import { gradientHandles, pickHandle, type GradientHandle } from "./gradient-handles";
import { SNAP_45 } from "./shape-tools";
import { movedEnough, pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

/** Spec M15 §7: draws and adjusts the target paint's gradient on the selected shapes. */

type Mode =
  | { kind: "pending"; start: ToolEvent; pick: ReturnType<typeof pickHandle> }
  | { kind: "knob"; base: Doc; h: GradientHandle; end: "start" | "end" }
  | { kind: "line"; base: Doc; h: GradientHandle; start: Vec }
  | { kind: "draw"; base: Doc; ids: readonly string[]; start: Vec };

/** Shift: the moving end rotates about `pivot` to the nearest 45°, keeping its distance. */
function constrain(pivot: Vec, p: Vec, on: boolean): Vec {
  if (!on) return p;
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  const r = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / SNAP_45) * SNAP_45;
  return { x: pivot.x + r * Math.cos(a), y: pivot.y + r * Math.sin(a) };
}

function toOwn(h: GradientHandle, p: Vec): Vec | null {
  const inv = invert(h.world);
  return inv ? applyMat(inv, p) : null;
}

function apply(ctx: ToolContext, m: Exclude<Mode, { kind: "pending" }>, e: ToolEvent): void {
  const which = ctx.gradientTarget();
  if (m.kind === "draw") {
    const to = constrain(m.start, e.doc, e.mods.shift);
    ctx.commit(drawGradientLine(m.base, m.ids, which, m.start, to));
    return;
  }
  let from = m.h.from;
  let to = m.h.to;
  if (m.kind === "knob") {
    if (m.end === "start") from = constrain(m.h.to, e.doc, e.mods.shift);
    else to = constrain(m.h.from, e.doc, e.mods.shift);
  } else {
    const dx = e.doc.x - m.start.x;
    const dy = e.doc.y - m.start.y;
    from = { x: from.x + dx, y: from.y + dy };
    to = { x: to.x + dx, y: to.y + dy };
  }
  const a = toOwn(m.h, from);
  const b = toOwn(m.h, to);
  if (!a || !b) return;
  // Commits from the gesture base (invariant 15), so a returning drag restores it exactly.
  ctx.commit(setGradientPoints(m.base, m.h.id, which, a, b));
}

export function createGradientTool(): Tool {
  let mode: Mode | null = null;

  const handles = (ctx: ToolContext) =>
    gradientHandles(ctx.doc(), ctx.selection(), ctx.gradientTarget());

  return {
    id: "gradient",
    hint: "Drag across the selection to draw a gradient · drag a knob or the line to adjust · Shift: 45°",
    cursor: "crosshair",

    down(ctx, e) {
      this.cancel(ctx);
      const tol = pointerTolerance(e.pointerType) / ctx.view().zoom;
      mode = { kind: "pending", start: e, pick: pickHandle(handles(ctx), e.doc, tol) };
    },

    move(ctx, e) {
      if (!mode) return;
      if (mode.kind === "pending") {
        if (!movedEnough(mode.start.screen, e.screen)) return;
        const { pick, start } = mode;
        if (pick) {
          ctx.beginGesture();
          mode =
            pick.part === "line"
              ? { kind: "line", base: ctx.doc(), h: pick.h, start: start.doc }
              : { kind: "knob", base: ctx.doc(), h: pick.h, end: pick.part };
        } else {
          if (ctx.selection().length === 0) {
            const hit = hitTest(ctx.doc(), start.doc, pointerTolerance(start.pointerType) / ctx.view().zoom, ctx.enteredGroupId());
            if (!hit) {
              mode = null;
              return;
            }
            ctx.setSelection([hit.nodeId]);
          }
          ctx.beginGesture();
          mode = { kind: "draw", base: ctx.doc(), ids: ctx.selection(), start: start.doc };
        }
      }
      apply(ctx, mode, e);
    },

    up(ctx, e) {
      const m = mode;
      mode = null;
      if (!m) return;
      if (m.kind === "pending") {
        // A click: a knob picks its stop; anything else selects what is under the press.
        if (m.pick && m.pick.part !== "line") {
          ctx.setGradientStop({ id: m.pick.h.id, stop: m.pick.part });
          return;
        }
        if (m.pick) return;
        const hit = hitTest(ctx.doc(), e.doc, pointerTolerance(e.pointerType) / ctx.view().zoom, ctx.enteredGroupId());
        ctx.setSelection(hit ? [hit.nodeId] : []);
        return;
      }
      apply(ctx, m, e);
      ctx.endGesture();
    },

    cancel(ctx) {
      const m = mode;
      mode = null;
      if (!m || m.kind === "pending") return;
      ctx.commit(m.base);
      ctx.endGesture();
    },
  };
}
```

If `this.cancel` trips the linter (`@typescript-eslint/unbound-method` or similar), hoist `cancel` into a named inner function as `node-tool.ts` does with `cancelMode`.

- [ ] **Step 6: Register it.** `registry.ts`: `gradient: createGradientTool(),` (import). `keys.ts` `TOOL_KEYS`: `g: "gradient",`. `ToolStrip.svelte`: import `Blend` from `@lucide/svelte` and add `{ id: "gradient", label: "Gradient", key: "G", icon: Blend },` after Text. `preferences.ts`: append `"gradient"` to `SECTION_IDS` (if a prefs test enumerates `SECTION_IDS`, update it). `PropertiesPanel.svelte`: add the Gradient section before the Node section (import `setGradientTarget`):

```svelte
      {#if app.toolId === "gradient"}
        <!-- Spec M15 §6: which paint the Gradient tool edits, only while it is the active tool —
             as the Node section appears only for the node tool. -->
        <FieldSection id="gradient" title="Gradient">
          <div class="field-row">
            <span class="text-muted">Edit</span>
            <div class="flex gap-1">
              <ToggleButton label="Fill" value={app.gradientTarget === "fill"} onchange={() => setGradientTarget("fill")} />
              <ToggleButton label="Stroke" value={app.gradientTarget === "stroke"} onchange={() => setGradientTarget("stroke")} />
            </div>
          </div>
        </FieldSection>
      {/if}
```

`.field-row` contributes exactly two grid items (label + field) — invariant 23's parity rule; the `<div class="flex gap-1">` is the one field item.

- [ ] **Step 7: Draw the handles** in `Overlay.svelte`:

```ts
  /** Spec M15 §7: the gradient lines, from the same function the tool hit-tests against. Each knob
   *  is filled with its stop's colour so start and end are told apart at a glance. */
  const gradientView = $derived.by(() => {
    if (app.toolId !== "gradient") return [];
    return gradientHandles(app.doc, app.selection, app.gradientTarget).map((h) => ({
      a: docToScreen(view, h.from),
      b: docToScreen(view, h.to),
      start: h.start.color,
      end: h.end.color,
      picked: app.gradientStop?.id === h.id ? app.gradientStop.stop : null,
    }));
  });
```

and in the markup, after the node view block:

```svelte
  {#each gradientView as g, i (i)}
    <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} style={LINE} stroke-width="1" />
    <circle cx={g.a.x} cy={g.a.y} r={knobSize / 2 + 1} style="stroke: var(--color-accent); fill: {g.start}" stroke-width={g.picked === "start" ? 3 : 1.5} />
    <circle cx={g.b.x} cy={g.b.y} r={knobSize / 2 + 1} style="stroke: var(--color-accent); fill: {g.end}" stroke-width={g.picked === "end" ? 3 : 1.5} />
  {/each}
```

Also draw the selection outlines for the gradient tool: the existing `outlines` derived draws each selected object's frame regardless of tool — confirm by reading it; no change if so.

- [ ] **Step 8: Key test** — in `src/__tests__/prefs-route-keys.test.ts`, next to the existing tool-key assertions, add: `expect(editActionForKey(key("g"))).toEqual({ kind: "tool", tool: "gradient" });` using that file's own key-event helper.

- [ ] **Step 9: Run everything**

Run: `npm test && npm run build 2>&1 | grep -E "COMPLETED|error" && npm run lint`
Expected: all green, 0/0.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(M15): the Gradient tool — draw, drag knobs and the line on the canvas

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Docs

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`

- [ ] **Step 1: README** — in the features list add a Gradients bullet: "Gradients: linear gradients on fill and stroke (two stops, colour + opacity each). Pick Flat/Linear in the Properties panel, or use the Gradient tool (G): drag across the selection to draw one, drag a knob or the line to adjust, Shift for 45°. Linear gradients from other apps' SVGs are kept when they have two stops." Add G to any shortcut table the README has.

- [ ] **Step 2: CLAUDE.md**
  - Architecture map: `doc/paint-edit.ts` (the gradient edits), `svg/gradient-import.ts` (paint-server resolution and the fold), `tools/gradient-tool.ts` + `tools/gradient-handles.ts`, `lib/PaintRow.svelte`; `document.ts` now also has `Fill`, `LinearGradient`, `mapStyle`.
  - New invariant 46: **A gradient lives in its shape's own space, so every geometry bake calls `mapStyle`** — resize, flatten, combine, booleans today; a new bake site must too, exactly as it must use `withBakedSubpaths` (invariant 40). Degenerate gradients collapse to the end stop's flat paint, judged on written values. Stops are always at 0/1; offsets fold into the points. Export writes one `userSpaceOnUse` gradient per paint, id `sv-grad-<node>-<fill|stroke>`, in one leading `<defs>` that is absent without gradients. Import resolves `url()` per painted shape (not per declaring element), and keeps every 2-stop pad-spread linear gradient exactly.
  - Update the test count in Commands (`npm test` line) to the real number from the final run.
  - Current state: M15 done; M14 (warp) still next.
- [ ] **Step 3: CHANGELOG** — append a dated `## 2026-09-27 — M15: linear gradients` entry: what shipped, the rulings list (spec §10), what was browser-verified (fill in after verification), what is owed an iPad pass, and the test count.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(M15): README, CLAUDE.md invariant 46 and changelog

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
