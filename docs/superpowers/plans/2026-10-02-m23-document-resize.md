# M23 — Document resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document settings gains a Size section with two modes — Crop/extend (a 3×3 anchor, the
art keeps its size) and Scale drawing (uniform, strokes and corner radii scale too) — each one
undo step.

**Architecture:** A new pure module `src/doc/doc-resize.ts` holds both edits and their refusal
checks; Crop/extend only adds a translation to each top-level node, Scale drawing reuses
`resizeNode`'s bake (so titles, polygons and gradients stay live) after scaling stroke widths and
corner radii. The store's `applyArtboard` becomes `applyDocumentSize`; the dialog and a small
`AnchorGrid` component drive it.

**Tech Stack:** Svelte 5 + TypeScript + Vitest (node env, no DOM) + Playwright WebKit smoke check.

**Spec:** `docs/superpowers/specs/2026-10-02-document-resize-design.md`

## Global Constraints

- The document is immutable; an edit that changes nothing returns the SAME reference (invariant 1).
- Resize bakes into geometry through `resizeNode`/`bakeShape`; never a matrix multiply (invariant
  11). Scale drawing is the one place strokes and corner radii scale with a resize.
- A node whose parent doesn't change keeps its exact transform except for the added translation —
  never re-derive it (invariant 26).
- Every store edit calls `cancelActiveGesture()` first (invariant 15).
- Artboard sides must pass `isValidArtboardSize` (`0 < n ≤ MAX_ARTBOARD = 100000`); coordinates must
  stay within `MAX_COORD = 1e9` (`src/svg/parse.ts`).
- UI: on-state `.ui-on`, classes as one expression (`class={["btn", on && "ui-on"]}`), unavailable
  controls use `aria-disabled` with a reason `title`, never `disabled` (invariants 23, 24); new
  controls are `var(--ctl-h)` high, never `h-8`. Every `title` is a short action description.
- No native dialogs (invariant 5).
- Build bar: `npm run build` — 0 errors, 0 warnings. `npm test`, `npm run lint` clean.
- One commit per task, trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
  Work on branch `feat/document-resize` (already exists, holds the spec).

## Spec corrections made by this plan

- **`scaleDetails` is per shape and runs BEFORE the bake** (spec §3 says doc-wide and after).
  `bakeShape` clamps `rx` to the _baked_ half-sides; scaling `rx` afterwards would clamp twice on a
  scale-down (w 10, rx 5, k 0.5: bake gives rx 2.5, then ×0.5 = 1.25 — wrong; scaling first gives
  min(2.5, 2.5) = 2.5). Task 1 updates the spec text.
- `sizeRefusal(w, h)` is added beside `scaleRefusal` so the dialog's Crop/extend validation and
  Scale drawing's share one message source.

## Review Focus

1. **Scale-down of a rounded rectangle** — the radius must be `k·rx`, not clamped twice (Task 2 test).
2. **Hidden and locked content** — a hidden top-level node, a hidden child of a group and a locked
   layer all move/scale with the rest; nothing is left behind (Tasks 1, 2 tests).
3. **Empty or partly typed fields** — clearing W in the dialog must disable Apply with a reason and
   never throw; Scale drawing with an empty W gives `k = NaN` → refused (Task 2 `scaleRefusal`
   test, Task 4 browser check).
4. **Cancel after typing** — Cancel changes nothing, and reopening the dialog shows the document's
   current size, Crop/extend, centre anchor, link off (Task 4 browser check).
5. **A title being edited on the canvas when the dialog applies** — the session must survive or end
   cleanly, never leave the title a plain path (uniform scale keeps `text`; Task 3 store test with
   a title asserts `text` is kept and the selection survives).

---

### Task 1: `extendCanvas`, `sizeRefusal` and the ratio helpers

**Files:**

- Create: `src/doc/doc-resize.ts`
- Create: `src/__tests__/doc-resize.test.ts`
- Modify: `docs/superpowers/specs/2026-10-02-document-resize-design.md` (§3 `scaleDetails` wording)

**Interfaces:**

- Produces:
  - `export type Anchor = 0 | 0.5 | 1;`
  - `export function extendCanvas(doc: Doc, w: number, h: number, ax: Anchor, ay: Anchor): Doc` —
    throws `RangeError` on an invalid size (as `setArtboard` does).
  - `export function sizeRefusal(w: unknown, h: unknown): string | null`
  - `export function linkedSize(v: number, from: number, to: number): number` — whole px, ≥ 1.
  - `export function scaledSide(v: number, from: number, to: number): number` — 2 decimals.
  - `export function round2(v: number): number`

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/doc-resize.test.ts
import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Group,
  type Node,
  type RectShape,
} from "../doc/document";
import { extendCanvas, linkedSize, round2, scaledSide, sizeRefusal } from "../doc/doc-resize";
import { IDENTITY, translate } from "../geom/mat";
import { deepFreeze } from "./helpers";

const rect = (over: Partial<RectShape> = {}): RectShape => ({
  kind: "rect",
  id: "r",
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x: 10,
  y: 20,
  w: 30,
  h: 40,
  rx: 0,
  ...over,
});

/** A 100×50 document whose first layer holds `nodes`; a second, locked and hidden layer holds `back`. */
const docWith = (nodes: Node[], back: Node[] = []): Doc => {
  const d = createDoc(100, 50);
  return deepFreeze({
    ...d,
    nextId: 20,
    layers: [
      { ...d.layers[0], children: nodes },
      { id: "L2", name: "Back", visible: false, locked: true, children: back },
    ],
  });
};

describe("extendCanvas", () => {
  it.each([
    [0, 0, 0, 0],
    [0.5, 0, 50, 0],
    [1, 0, 100, 0],
    [0, 0.5, 0, 25],
    [0.5, 0.5, 50, 25],
    [1, 0.5, 100, 25],
    [0, 1, 0, 50],
    [0.5, 1, 50, 50],
    [1, 1, 100, 50],
  ] as const)("anchor (%s, %s) grows 100×50 → 200×100 moving by (%s, %s)", (ax, ay, dx, dy) => {
    const out = extendCanvas(docWith([rect()]), 200, 100, ax, ay);
    expect(out.artboard).toEqual({ w: 200, h: 100, background: { color: "#ffffff", opacity: 1 } });
    expect(out.layers[0].children[0].transform).toEqual([1, 0, 0, 1, dx, dy]);
  });

  it("a shrink moves the other way (right anchor, 100 → 60 wide: −40)", () => {
    const out = extendCanvas(docWith([rect()]), 60, 50, 1, 0.5);
    expect(out.layers[0].children[0].transform).toEqual([1, 0, 0, 1, -40, 0]);
  });

  it("adds to an existing transform's translation only", () => {
    const t: [number, number, number, number, number, number] = [0, 1, -1, 0, 5, 6];
    const out = extendCanvas(docWith([rect({ transform: t })]), 200, 50, 1, 0);
    expect(out.layers[0].children[0].transform).toEqual([0, 1, -1, 0, 105, 6]);
  });

  it("moves hidden and locked content, and leaves nested transforms alone", () => {
    const child = rect({ id: "c", transform: translate(3, 4), hidden: true });
    const group: Group = { kind: "group", id: "g", transform: IDENTITY, children: [child] };
    const out = extendCanvas(docWith([group], [rect({ id: "b", locked: true })]), 200, 50, 1, 0);
    const g = out.layers[0].children[0] as Group;
    expect(g.transform).toEqual([1, 0, 0, 1, 100, 0]);
    expect(g.children[0]).toBe(child);
    expect(out.layers[1].children[0].transform).toEqual([1, 0, 0, 1, 100, 0]);
  });

  it("keeps the shape itself (geometry, style) untouched — nothing is baked", () => {
    const r = rect({ rx: 4 });
    const out = extendCanvas(docWith([r]), 200, 50, 1, 0);
    expect({ ...out.layers[0].children[0], transform: IDENTITY }).toEqual(r);
  });

  it("returns the same document when nothing changes", () => {
    const d = docWith([rect()]);
    expect(extendCanvas(d, 100, 50, 1, 1)).toBe(d);
  });

  it("with the top-left anchor only the artboard changes; nodes keep their references", () => {
    const d = docWith([rect()]);
    const out = extendCanvas(d, 300, 300, 0, 0);
    expect(out.layers[0].children[0]).toBe(d.layers[0].children[0]);
    expect(out.artboard.w).toBe(300);
  });

  it("throws on an invalid size", () => {
    expect(() => extendCanvas(docWith([]), 0, 50, 0, 0)).toThrow(RangeError);
  });
});

describe("sizeRefusal", () => {
  it("accepts valid sides", () => expect(sizeRefusal(100, 0.5)).toBeNull());
  it("refuses an empty or non-numeric side", () => {
    expect(sizeRefusal(null, 50)).toBe("Enter a width and a height");
    expect(sizeRefusal(100, undefined)).toBe("Enter a width and a height");
  });
  it("refuses a side over the maximum", () =>
    expect(sizeRefusal(100001, 50)).toBe("Too large — at most 100000 px a side"));
  it("refuses a zero or negative side", () =>
    expect(sizeRefusal(0, 50)).toBe("Too small — a side must be more than 0 px"));
});

describe("ratio helpers", () => {
  it("linkedSize keeps the ratio in whole pixels, at least 1", () => {
    expect(linkedSize(200, 100, 50)).toBe(100);
    expect(linkedSize(101, 100, 50)).toBe(51); // 50.5 rounds up
    expect(linkedSize(1, 1000, 1)).toBe(1);
  });
  it("scaledSide keeps the ratio to 2 decimals", () => {
    expect(scaledSide(1000, 1920, 1080)).toBe(562.5);
    expect(scaledSide(100, 3, 1)).toBe(33.33);
  });
  it("round2", () => expect(round2(2 / 3)).toBe(0.67));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/doc-resize.test.ts`
Expected: FAIL — `Failed to resolve import "../doc/doc-resize"`.

- [ ] **Step 3: Implement**

```ts
// src/doc/doc-resize.ts
import { isValidArtboardSize, MAX_ARTBOARD, type Doc, type Node } from "./document";

/** Spec M23 §2: where a crop/extend keeps the drawing — 0 = left/top, 0.5 = centre, 1 = right/bottom. */
export type Anchor = 0 | 0.5 | 1;

export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Crop/extend's Keep ratio (slop-paint's `linkedSize`): the other side in whole pixels. */
export function linkedSize(v: number, from: number, to: number): number {
  return Math.max(1, Math.round((v * to) / from));
}

/** Scale drawing's other side: exact to 2 decimals, as the artboard is set (spec M23 §2). */
export function scaledSide(v: number, from: number, to: number): number {
  return round2((v * to) / from);
}

/** Why a page of `w × h` can't be set, or null. The dialog shows it under the fields. */
export function sizeRefusal(w: unknown, h: unknown): string | null {
  if (typeof w !== "number" || typeof h !== "number" || !Number.isFinite(w) || !Number.isFinite(h))
    return "Enter a width and a height";
  if (w > MAX_ARTBOARD || h > MAX_ARTBOARD) return `Too large — at most ${MAX_ARTBOARD} px a side`;
  if (!isValidArtboardSize(w) || !isValidArtboardSize(h))
    return "Too small — a side must be more than 0 px";
  return null;
}

/** Only the translation changes (invariant 26): nothing is baked, so everything stays live. */
function shift(n: Node, dx: number, dy: number): Node {
  const [a, b, c, d, e, f] = n.transform;
  return { ...n, transform: [a, b, c, d, e + dx, f + dy] };
}

/** Spec M23 §3: the page becomes `w × h` and every top-level node of every layer — hidden and
 *  locked ones too, since this changes the page, not the art — moves so the anchored part of the
 *  drawing keeps its place. Layers have no transform, so top-level nodes are in document space;
 *  nested ones move with their parents. */
export function extendCanvas(doc: Doc, w: number, h: number, ax: Anchor, ay: Anchor): Doc {
  const reason = sizeRefusal(w, h);
  if (reason) throw new RangeError(reason);
  const { w: w0, h: h0 } = doc.artboard;
  if (w === w0 && h === h0) return doc;
  const dx = ax * (w - w0);
  const dy = ay * (h - h0);
  const artboard = { ...doc.artboard, w, h };
  if (dx === 0 && dy === 0) return { ...doc, artboard };
  const layers = doc.layers.map((l) =>
    l.children.length === 0 ? l : { ...l, children: l.children.map((n) => shift(n, dx, dy)) },
  );
  return { ...doc, artboard, layers };
}
```

- [ ] **Step 4: Fix the spec's `scaleDetails` wording**

In `docs/superpowers/specs/2026-10-02-document-resize-design.md` §3, replace the step text that
reads "a new step, `scaleDetails(doc, k)`, separate from `bakeShape`…" and the radius bullet's
"Both are `scaleDetails`'s job, and it runs after the bake, so `rx` is already clamped to the baked
half-sides and `k · rx` stays within the scaled ones." with: `scaleDetails(shape, k)` is applied to
every shape **before** the bake, so the bake's clamp `min(k·rx, k·w/2, k·h/2)` equals
`k · min(rx, w/2, h/2)`; scaling after the bake would clamp twice on a scale-down. Also add
`sizeRefusal` to the §4 file list.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/__tests__/doc-resize.test.ts` — Expected: PASS.
Run: `npm test` — Expected: all pass (1398 + the new ones).

- [ ] **Step 6: Commit**

```bash
git add src/doc/doc-resize.ts src/__tests__/doc-resize.test.ts docs/superpowers/specs/2026-10-02-document-resize-design.md
git commit -m "feat: extendCanvas — crop or extend the page around an anchor (M23)"
```

---

### Task 2: `scaleDrawing`, `scaleDetails` and `scaleRefusal`

**Files:**

- Modify: `src/doc/doc-resize.ts`
- Modify: `src/__tests__/doc-resize.test.ts`

**Interfaces:**

- Consumes: `round2`, `sizeRefusal` (Task 1); `resizeNode(node: Node, A: Mat): Node` from
  `src/doc/resize.ts` (A in the node's parent space); `mapShapes(node, fn)` from `src/doc/tree.ts`;
  `nodeBounds(node, m): Box | null` from `src/geom/bounds.ts`; `MAX_COORD` from `src/svg/parse.ts`.
- Produces:
  - `export function scaleDetails(s: Shape, k: number): Shape` — stroke width × k when stroked,
    a rect's `rx` × k; the same object when neither applies.
  - `export function scaleRefusal(doc: Doc, k: number): string | null`
  - `export function scaleDrawing(doc: Doc, k: number): Doc` — throws `RangeError` with
    `scaleRefusal`'s reason; `k === 1` returns the same doc.

- [ ] **Step 1: Write the failing tests** (append to `src/__tests__/doc-resize.test.ts`; extend the
      imports at the top to the lists below)

```ts
// imports — replace the Task 1 import lines with:
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type EllipseShape,
  type Group,
  type Node,
  type PathShape,
  type PolygonShape,
  type RectShape,
  type TextMeta,
} from "../doc/document";
import {
  extendCanvas,
  linkedSize,
  round2,
  scaleDetails,
  scaledSide,
  scaleDrawing,
  scaleRefusal,
  sizeRefusal,
} from "../doc/doc-resize";
import { IDENTITY, rotate, translate } from "../geom/mat";
import { parseSvg } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";
import { deepFreeze } from "./helpers";
```

```ts
const first = (d: Doc) => d.layers[0].children[0];

const meta: TextMeta = {
  text: "Hi",
  font: "anton",
  size: 40,
  letterSpacing: 2,
  lineHeight: 1.2,
  align: "left",
  seed: 7,
  amounts: { rotate: 0, scale: 0, offset: 3, skew: 0 },
  overrides: {},
};
const title = (): PathShape => ({
  kind: "path",
  id: "t",
  transform: translate(5, 5),
  style: DEFAULT_STYLE,
  text: meta,
  subpaths: [
    {
      closed: true,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 20, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 20, y: 30 }, in: null, out: null, type: "corner" },
      ],
    },
  ],
});
const polygon = (): PolygonShape => ({
  kind: "polygon",
  id: "p",
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  cx: 50,
  cy: 25,
  rx: 10,
  ry: 10,
  sides: 5,
  star: false,
  innerRatio: 0.5,
});

describe("scaleDetails", () => {
  it("multiplies a stroked shape's width and a rect's radius", () => {
    const r = scaleDetails(rect({ rx: 4, style: { ...DEFAULT_STYLE, strokeWidth: 3 } }), 2);
    expect(r.style.strokeWidth).toBe(6);
    expect((r as RectShape).rx).toBe(8);
  });
  it("leaves an unstroked width alone", () => {
    const s = { ...DEFAULT_STYLE, stroke: null, strokeWidth: 3 };
    expect(scaleDetails(rect({ style: s }), 2).style).toBe(s);
  });
  it("returns the same shape when nothing applies", () => {
    const e: EllipseShape = {
      kind: "ellipse",
      id: "e",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, stroke: null },
      cx: 0,
      cy: 0,
      rx: 1,
      ry: 1,
    };
    expect(scaleDetails(e, 2)).toBe(e);
  });
});

describe("scaleDrawing", () => {
  it("scales a rectangle about the origin, with its stroke and radius", () => {
    const out = scaleDrawing(docWith([rect({ rx: 4 })]), 2);
    expect(first(out)).toMatchObject({ kind: "rect", x: 20, y: 40, w: 60, h: 80, rx: 8 });
    expect((first(out) as RectShape).style.strokeWidth).toBe(2);
    expect(out.artboard).toMatchObject({ w: 200, h: 100 });
  });

  it("scales a rounded rectangle DOWN without clamping the radius twice", () => {
    const out = scaleDrawing(docWith([rect({ w: 10, h: 10, rx: 5 })]), 0.5);
    expect(first(out)).toMatchObject({ w: 5, h: 5, rx: 2.5 });
  });

  it("keeps a rotated rectangle a rectangle", () => {
    const out = scaleDrawing(docWith([rect({ transform: rotate(0.3) })]), 3);
    expect(first(out).kind).toBe("rect");
  });

  it("keeps a polygon live", () => {
    const out = scaleDrawing(docWith([polygon()]), 2);
    expect(first(out)).toMatchObject({ kind: "polygon", cx: 100, cy: 50, rx: 20, ry: 20 });
  });

  it("keeps a title's text, its size scaled", () => {
    const t = first(scaleDrawing(docWith([title()]), 2)) as PathShape;
    expect(t.text?.size).toBe(80);
    expect(t.text?.letterSpacing).toBe(4);
    expect(t.text?.amounts.offset).toBe(6);
    expect(t.style.strokeWidth).toBe(2);
  });

  it("maps a linear gradient's points by k", () => {
    const g = {
      kind: "linear" as const,
      from: { x: 10, y: 20 },
      to: { x: 40, y: 20 },
      start: { color: "#ff0000", opacity: 1 },
      end: { color: "#0000ff", opacity: 1 },
    };
    const out = first(scaleDrawing(docWith([rect({ style: { ...DEFAULT_STYLE, fill: g } })]), 2));
    expect((out as RectShape).style.fill).toMatchObject({ from: { x: 20, y: 40 }, to: { x: 80, y: 40 } });
  });

  it("scales hidden and locked content and a group's children", () => {
    const child = rect({ id: "c", hidden: true });
    const group: Group = { kind: "group", id: "g", transform: IDENTITY, children: [child] };
    const out = scaleDrawing(docWith([group], [rect({ id: "b", locked: true })]), 2);
    expect((first(out) as Group).children[0]).toMatchObject({ x: 20, w: 60, hidden: true });
    expect(out.layers[1].children[0]).toMatchObject({ x: 20, w: 60, locked: true });
  });

  it("rounds the artboard to 2 decimals", () => {
    expect(scaleDrawing(docWith([]), 1 / 3).artboard).toMatchObject({ w: 33.33, h: 16.67 });
  });

  it("returns the same document for k = 1", () => {
    const d = docWith([rect()]);
    expect(scaleDrawing(d, 1)).toBe(d);
  });

  it("throws when refused", () => {
    expect(() => scaleDrawing(docWith([]), 0)).toThrow(RangeError);
  });

  it("round-trips: a scaled title and polygon come back from a save as a title and a polygon", () => {
    const out = scaleDrawing(docWith([title(), polygon()]), 2);
    const back = parseSvg(serializeDoc(out)).doc.layers[0].children;
    expect((back[0] as PathShape).text?.size).toBe(80);
    expect(back[1].kind).toBe("polygon");
  });
});

describe("scaleRefusal", () => {
  it("accepts an ordinary scale", () => expect(scaleRefusal(docWith([rect()]), 2)).toBeNull());
  it("refuses a non-positive or non-finite k", () => {
    expect(scaleRefusal(docWith([]), 0)).toBe("Enter a width and a height");
    expect(scaleRefusal(docWith([]), Number.NaN)).toBe("Enter a width and a height");
  });
  it("refuses a page over the maximum", () =>
    expect(scaleRefusal(docWith([]), 1001)).toBe("Too large — at most 100000 px a side"));
  it("refuses a page that rounds to nothing", () =>
    expect(scaleRefusal(docWith([]), 0.00001)).toBe("Too small — a side must be more than 0 px"));
  it("refuses coordinates past MAX_COORD, hidden content included", () => {
    const far = rect({ id: "far", x: 2e8, hidden: true });
    const group: Group = { kind: "group", id: "g", transform: IDENTITY, children: [far] };
    expect(scaleRefusal(docWith([group]), 10)).toBe(
      "Scaling by 10× would put the drawing out of range",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/doc-resize.test.ts`
Expected: FAIL — `scaleDrawing` / `scaleDetails` / `scaleRefusal` not exported.

- [ ] **Step 3: Implement** (add to `src/doc/doc-resize.ts`; merge the imports)

```ts
import { nodeBounds } from "../geom/bounds";
import { IDENTITY, multiply, scale, type Mat } from "../geom/mat";
import { MAX_COORD } from "../svg/parse";
import { isValidArtboardSize, MAX_ARTBOARD, type Doc, type Node, type Shape } from "./document";
import { resizeNode } from "./resize";
import { mapShapes } from "./tree";

/** Spec M23 §3: what a handle resize keeps fixed (invariant 11) but Scale drawing must scale for
 *  the drawing to look the same — the stroke width and a rectangle's corner radius. Applied BEFORE
 *  the bake: `bakeShape` then clamps `min(k·rx, k·w/2, k·h/2)`, which is `k · min(rx, w/2, h/2)`;
 *  after it, a scale-down would be clamped twice. */
export function scaleDetails(s: Shape, k: number): Shape {
  const style = s.style.stroke === null ? s.style : { ...s.style, strokeWidth: s.style.strokeWidth * k };
  if (s.kind === "rect" && s.rx !== 0) return { ...s, style, rx: s.rx * k };
  return style === s.style ? s : { ...s, style };
}

/** The largest |coordinate| a node reaches in document space — hidden descendants included, which
 *  `nodeBounds` skips, because they are scaled too and the file must still load. */
function extent(node: Node, m: Mat): number {
  if (node.kind === "group") {
    const t = multiply(m, node.transform);
    return node.children.reduce((a, c) => Math.max(a, extent(c, t)), 0);
  }
  const b = nodeBounds(node, m);
  return b ? Math.max(Math.abs(b.x), Math.abs(b.y), Math.abs(b.x + b.w), Math.abs(b.y + b.h)) : 0;
}

/** Why Scale drawing by `k` can't be applied, or null. The dialog and the store both read this, so
 *  they cannot disagree (the `booleanRefusal` pattern). */
export function scaleRefusal(doc: Doc, k: number): string | null {
  if (!Number.isFinite(k) || k <= 0) return "Enter a width and a height";
  const size = sizeRefusal(round2(doc.artboard.w * k), round2(doc.artboard.h * k));
  if (size) return size;
  let max = 0;
  for (const l of doc.layers) for (const n of l.children) max = Math.max(max, extent(n, IDENTITY));
  if (max * k > MAX_COORD) return `Scaling by ${round2(k)}× would put the drawing out of range`;
  return null;
}

/** Spec M23 §3: everything scales by `k` about the page's top-left, uniformly, so the handle
 *  resize's bake keeps titles, polygons, rectangles, ellipses and gradients live (invariants 11,
 *  44, 46). Hidden and locked content scales too. */
export function scaleDrawing(doc: Doc, k: number): Doc {
  if (k === 1) return doc;
  const reason = scaleRefusal(doc, k);
  if (reason) throw new RangeError(reason);
  const S = scale(k);
  const layers = doc.layers.map((l) =>
    l.children.length === 0
      ? l
      : { ...l, children: l.children.map((n) => resizeNode(mapShapes(n, (s) => scaleDetails(s, k)), S)) },
  );
  const artboard = { ...doc.artboard, w: round2(doc.artboard.w * k), h: round2(doc.artboard.h * k) };
  return { ...doc, artboard, layers };
}
```

Check while implementing: `MAX_ARTBOARD` and `isValidArtboardSize` stay imported only if still
used (Task 1's `sizeRefusal` uses both). If `src/svg/parse.ts` importing into `src/doc/` creates an
import cycle (`npx madge` is not installed — check with the build: a cycle that breaks shows as
`undefined` at test time), move `MAX_COORD` nowhere; instead re-declare it locally as
`const MAX_COORD = 1e9; // = svg/parse.ts's` exactly as `pathdata.ts` and `transform.ts` already do.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/doc-resize.test.ts` — Expected: PASS.
Run: `npm test` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/doc/doc-resize.ts src/__tests__/doc-resize.test.ts
git commit -m "feat: scaleDrawing — scale the whole drawing, strokes and radii included (M23)"
```

---

### Task 3: Store — `applyDocumentSize`

**Files:**

- Modify: `src/state/appState.svelte.ts:832-841` (`applyArtboard`)
- Modify: `src/__tests__/node-store.test.ts:525-540` (the `applyArtboard` describe)
- Modify: `src/lib/DocumentSettingsDialog.svelte:3,25` (its one call — keeps the build green)

**Interfaces:**

- Consumes: `extendCanvas`, `scaleDrawing`, `scaleRefusal`, `Anchor` (Tasks 1-2); `setArtboard`
  (`src/doc/edits.ts`), `commitDoc`, `cancelActiveGesture`, `notify` (store).
- Produces:
  - `export type DocSize = { mode: "extend"; w: number; h: number; ax: Anchor; ay: Anchor } | { mode: "scale"; k: number };`
  - `export function applyDocumentSize(size: DocSize, background: Paint | null): void` —
    replaces `applyArtboard` (removed; its only caller is the dialog, changed in Task 4).

- [ ] **Step 1: Update the store test** — replace the `describe("applyArtboard", …)` block in
      `src/__tests__/node-store.test.ts` with:

```ts
/** Review M7 (2026-09-30): Document settings committed without settling a running tool, so a
 *  Warp session's next cage drag (committing from its pre-warp base) put the old artboard back. */
describe("applyDocumentSize", () => {
  it("settles a running tool gesture before changing the artboard, as one undo step", async () => {
    const { applyDocumentSize, registerGestureCancel, undo } =
      await import("../state/appState.svelte");
    const order: string[] = [];
    registerGestureCancel(() => order.push("cancel"), "warp");
    applyDocumentSize({ mode: "extend", w: 500, h: 400, ax: 0, ay: 0 }, null);
    order.push(`artboard ${app.doc.artboard.w}`);
    expect(order).toEqual(["cancel", "artboard 500"]);
    expect(app.doc.artboard.background).toBeNull();
    undo();
    expect(app.doc.artboard.w).toBe(100);
  });

  it("scales the drawing in one undo step and keeps the selection and a title's text", async () => {
    const { applyDocumentSize, undo } = await import("../state/appState.svelte");
    const before = app.doc;
    const layer = before.layers[0];
    const t: PathShape = {
      kind: "path",
      id: "t9",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      subpaths: [
        {
          closed: true,
          nodes: [
            { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
            { p: { x: 10, y: 0 }, in: null, out: null, type: "corner" },
            { p: { x: 10, y: 10 }, in: null, out: null, type: "corner" },
          ],
        },
      ],
      text: {
        text: "A",
        font: "anton",
        size: 20,
        letterSpacing: 0,
        lineHeight: 1.2,
        align: "left",
        seed: 1,
        amounts: { rotate: 0, scale: 0, offset: 0, skew: 0 },
        overrides: {},
      },
    };
    commitDoc({ ...before, layers: [{ ...layer, children: [...layer.children, t] }, ...before.layers.slice(1)] });
    setSelection(["t9"]);
    const w0 = app.doc.artboard.w;
    applyDocumentSize({ mode: "scale", k: 2 }, app.doc.artboard.background);
    const scaled = findNode(app.doc, "t9")?.node as PathShape;
    expect(scaled.text?.size).toBe(40);
    expect(app.doc.artboard.w).toBe(w0 * 2);
    expect(app.selection).toEqual(["t9"]);
    undo();
    expect(app.doc.artboard.w).toBe(w0);
  });

  it("refuses an out-of-range scale with an error notice and leaves the document alone", async () => {
    const { applyDocumentSize } = await import("../state/appState.svelte");
    const before = app.doc;
    applyDocumentSize({ mode: "scale", k: 1e6 }, before.artboard.background);
    expect(app.doc).toBe(before);
    expect(app.notices.at(-1)).toMatchObject({ kind: "error" });
  });
});
```

Check `PathShape` and `DEFAULT_STYLE` are already imported at the top of the file (they are:
lines 2-9) and that the file's `beforeEach` resets to a 100-wide document (the old test relied on
it — `expect(app.doc.artboard.w).toBe(100)`). If `app.notices` entries use a different shape than
`{ kind }`, read `Notice` in the store and assert on what it has.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/node-store.test.ts`
Expected: FAIL — `applyDocumentSize is not a function`.

- [ ] **Step 3: Implement** — replace `applyArtboard` in `src/state/appState.svelte.ts`:

```ts
/** Document settings' Apply (spec M23 §3). Settles any running tool first, as every store edit
 *  does (invariant 15, review M7: a Warp session left open folded the artboard change into its
 *  step, and its next cage drag put the old artboard back). One commit, so one undo step: the
 *  background and the size change together. */
export type DocSize =
  | { mode: "extend"; w: number; h: number; ax: Anchor; ay: Anchor }
  | { mode: "scale"; k: number };

export function applyDocumentSize(size: DocSize, background: Paint | null): void {
  cancelActiveGesture();
  if (size.mode === "scale") {
    const reason = scaleRefusal(app.doc, size.k);
    if (reason) {
      notify("error", `Document size — ${reason}.`);
      return;
    }
  }
  const { w, h } = app.doc.artboard;
  const painted = setArtboard(app.doc, { w, h, background });
  commitDoc(
    size.mode === "scale"
      ? scaleDrawing(painted, size.k)
      : extendCanvas(painted, size.w, size.h, size.ax, size.ay),
  );
}
```

Add the imports: `import { extendCanvas, scaleDrawing, scaleRefusal, type Anchor } from "../doc/doc-resize";`
and `Paint` to the existing `../doc/document` type import (check it isn't already there). Remove
`Artboard` from the imports only if nothing else in the file uses it (`grep -n "Artboard" src/state/appState.svelte.ts`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/node-store.test.ts` — Expected: PASS.
Run: `npm test` — Expected: all pass.

In `src/lib/DocumentSettingsDialog.svelte`, switch its import from `applyArtboard` to
`applyDocumentSize` and its call to
`applyDocumentSize({ mode: "extend", w, h, ax: 0, ay: 0 }, background);` — the top-left anchor is
exactly today's behaviour (the drawing stays put), so the dialog works unchanged until Task 4.

- [ ] **Step 5: Verify the build and commit**

Run: `npm run build` — Expected: 0 errors, 0 warnings.

```bash
git add src/state/appState.svelte.ts src/__tests__/node-store.test.ts src/lib/DocumentSettingsDialog.svelte
git commit -m "feat: applyDocumentSize — crop/extend or scale the drawing as one undo step (M23)"
```

---

### Task 4: The dialog — modes, Keep ratio, anchor grid

**Files:**

- Create: `src/lib/AnchorGrid.svelte`
- Modify: `src/lib/DocumentSettingsDialog.svelte` (whole Size block, script)

**Interfaces:**

- Consumes: `applyDocumentSize`, `DocSize` (Task 3); `Anchor`, `linkedSize`, `scaledSide`,
  `sizeRefusal`, `scaleRefusal` (Tasks 1-2).
- Produces: `AnchorGrid` props `{ ax: Anchor; ay: Anchor; onchange: (ax: Anchor, ay: Anchor) => void }`;
  accessible names used by Task 5's smoke check: buttons **"Crop/extend"**, **"Scale drawing"**,
  **"Keep ratio"**, **"Anchor top right"** (and the other eight), inputs labelled **"W"**/**"H"**,
  **"Apply"**.

- [ ] **Step 1: Create `src/lib/AnchorGrid.svelte`**

```svelte
<script lang="ts">
  import type { Anchor } from "../doc/doc-resize";

  /** Spec M23 §2: which part of the drawing keeps its place when the page is cropped or extended. */
  let {
    ax,
    ay,
    onchange,
  }: { ax: Anchor; ay: Anchor; onchange: (ax: Anchor, ay: Anchor) => void } = $props();

  const STEPS: Anchor[] = [0, 0.5, 1];
  const NAMES = [
    ["top left", "top", "top right"],
    ["left", "centre", "right"],
    ["bottom left", "bottom", "bottom right"],
  ];
</script>

<div class="grid w-fit grid-cols-3 gap-1" role="group" aria-label="Anchor">
  {#each STEPS as y, r (y)}
    {#each STEPS as x, c (x)}
      {@const on = x === ax && y === ay}
      <button
        type="button"
        class={["btn h-[var(--ctl-h)] w-[var(--ctl-h)] justify-center p-0", on && "ui-on"]}
        aria-pressed={on}
        aria-label={`Anchor ${NAMES[r][c]}`}
        title={`Anchor ${NAMES[r][c]} — that part of the drawing stays put`}
        onclick={() => onchange(x, y)}
      >
        <span class="block h-2 w-2 rounded-full bg-current"></span>
      </button>
    {/each}
  {/each}
</div>
```

- [ ] **Step 2: Rewrite the dialog's script and Size block**

Script (replace the current `<script>` contents; Name and Background state unchanged):

```ts
  import { Link, Unlink } from "@lucide/svelte";
  import {
    linkedSize,
    scaledSide,
    scaleRefusal,
    sizeRefusal,
    type Anchor,
  } from "../doc/doc-resize";
  import { MAX_ARTBOARD } from "../doc/document";
  import { app, applyDocumentSize, renameDocument, type DocSize } from "../state/appState.svelte";
  import { baseName } from "../state/doc-name";
  import AnchorGrid from "./AnchorGrid.svelte";
  import Modal from "./Modal.svelte";
  import ToggleButton from "./ToggleButton.svelte";

  // The dialog edits a copy; nothing changes until Apply (one undo step).
  const initial = app.doc.artboard;
  let name = $state(baseName(app.fileName));
  let w = $state<number | null>(initial.w);
  let h = $state<number | null>(initial.h);
  let hasBackground = $state(initial.background !== null);
  let color = $state(initial.background?.color ?? "#ffffff");
  // Spec M23 §2: each open starts in Crop/extend, centre anchor, ratio unlinked.
  let mode = $state<"extend" | "scale">("extend");
  let linked = $state(false);
  let ax = $state<Anchor>(0.5);
  let ay = $state<Anchor>(0.5);
  /** Scale drawing's factor comes from the side typed last. */
  let typed = $state<"w" | "h">("w");
  const k = $derived(typed === "w" ? Number(w) / initial.w : Number(h) / initial.h);
  const refusal = $derived(mode === "scale" ? scaleRefusal(app.doc, k) : sizeRefusal(w, h));

  function typedW() {
    typed = "w";
    if (typeof w !== "number" || !Number.isFinite(w)) return;
    if (mode === "scale") h = scaledSide(w, initial.w, initial.h);
    else if (linked) h = linkedSize(w, initial.w, initial.h);
  }
  function typedH() {
    typed = "h";
    if (typeof h !== "number" || !Number.isFinite(h)) return;
    if (mode === "scale") w = scaledSide(h, initial.h, initial.w);
    else if (linked) w = linkedSize(h, initial.h, initial.w);
  }
  function setMode(next: "extend" | "scale") {
    mode = next;
    if (next === "scale") typedW();
  }
  function toggleLink() {
    if (mode === "scale") return;
    linked = !linked;
    if (linked) typedW();
  }

  function close() {
    app.dialog = null;
  }

  function apply() {
    if (refusal !== null) return;
    const background = hasBackground ? { color, opacity: initial.background?.opacity ?? 1 } : null;
    const size: DocSize =
      mode === "scale"
        ? { mode, k }
        : { mode, w: Number(w), h: Number(h), ax, ay };
    renameDocument(name);
    applyDocumentSize(size, background);
    close();
  }
```

Size block (replace the `<div class="flex flex-col gap-1">` that holds "Size"):

```svelte
  <div class="flex flex-col gap-2">
    <span class="section-title">Size</span>
    <div class="flex gap-1 text-xs">
      <button
        type="button"
        class={["btn flex-1", mode === "extend" && "ui-on"]}
        aria-pressed={mode === "extend"}
        title="Crop/extend — change the page around the drawing; the drawing keeps its size"
        onclick={() => setMode("extend")}>Crop/extend</button
      >
      <button
        type="button"
        class={["btn flex-1", mode === "scale" && "ui-on"]}
        aria-pressed={mode === "scale"}
        title="Scale drawing — everything scales with the page, strokes included"
        onclick={() => setMode("scale")}>Scale drawing</button
      >
    </div>
    <div class="flex items-center gap-2 text-xs">
      <label class="flex items-center gap-1">
        W <input
          class="field w-24"
          type="number"
          min="0"
          max={MAX_ARTBOARD}
          bind:value={w}
          oninput={typedW}
        />
      </label>
      <button
        type="button"
        class={["icon-btn", (linked || mode === "scale") && "ui-on"]}
        aria-label="Keep ratio"
        aria-pressed={linked || mode === "scale"}
        aria-disabled={mode === "scale"}
        title={mode === "scale"
          ? "Scale drawing always keeps the ratio"
          : linked
            ? "Keep ratio — typing one side sets the other"
            : "Keep ratio — off; W and H change independently"}
        onclick={toggleLink}
      >
        {#if linked || mode === "scale"}<Link size={16} />{:else}<Unlink size={16} />{/if}
      </button>
      <label class="flex items-center gap-1">
        H <input
          class="field w-24"
          type="number"
          min="0"
          max={MAX_ARTBOARD}
          bind:value={h}
          oninput={typedH}
        />
      </label>
      <span class="text-muted">px</span>
    </div>
    {#if mode === "extend"}
      <AnchorGrid {ax} {ay} onchange={(x, y) => ((ax = x), (ay = y))} />
    {/if}
    {#if refusal}<span class="text-xs text-muted" role="status">{refusal}</span>{/if}
  </div>
```

Apply button: `disabled={refusal !== null}` (it already used `disabled={!valid}` — the Modal's
action button is a dialog action, not a top-bar control, so the existing `disabled` stays, as
today). Remove the now-unused `valid` and the `isValidArtboardSize` import.

If `.icon-btn` is not the right class for a 32 px square in a dialog (check `app.css`), use
`class={["btn h-[var(--ctl-h)] w-[var(--ctl-h)] justify-center p-0", … && "ui-on"]}` as the
AnchorGrid does.

- [ ] **Step 3: Build**

Run: `npm run build` — Expected: 0 errors, 0 warnings. `npm run lint` — clean.

- [ ] **Step 4: Browser check (Chromium, the dev server on a free port such as 5198 — never the
      user's :5173)**

Run `npx vite --port 5198`, open it, draw a rectangle near the top-left, then via the file name
open Document settings and check, with a screenshot each:

1. Opens in Crop/extend, centre anchor pressed, link off, W/H = the page size.
2. Clear W → Apply disabled, "Enter a width and a height" shows; type `100001` → "Too large — at
   most 100000 px a side".
3. Link on, type W = double → H doubles (whole px). Top-right anchor, Apply → the rectangle moves
   right by the added width; the status bar size matches. Undo → back.
4. Reopen → Crop/extend, centre, link off again (Review Focus 4). Type a size, Cancel → nothing
   changed.
5. Scale drawing → link shows pressed; its hint (status bar on press) reads "Scale drawing always
   keeps the ratio"; the anchor grid is gone. W = half → H shows half to 2 decimals. Apply → the
   rectangle is half the size on screen at the same zoom, its stroke half as thick (zoom in to
   compare). Undo → back in one step.
6. Place a title, then Scale drawing ×2 → it is still a title (Properties shows its Text section).

- [ ] **Step 5: Commit**

```bash
git add src/lib/AnchorGrid.svelte src/lib/DocumentSettingsDialog.svelte
git commit -m "feat: Document settings — Crop/extend with an anchor, Scale drawing, Keep ratio (M23)"
```

---

### Task 5: `test:ipad` check and the docs

**Files:**

- Modify: `scripts/ipad-smoke.mjs` (after check 15, the rename)
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`,
  `docs/superpowers/IPAD-CHECKLIST.md`

**Interfaces:**

- Consumes: Task 4's accessible names; the smoke script's helpers `objectBox(i)`, `zoom()`,
  `page`, `check`, `OUT`.

- [ ] **Step 1: Add the check** — after check 15's `check(...)` (the "file name opens Document
      settings and renames" one) in `scripts/ipad-smoke.mjs`:

```js
  // 15b. Document settings resizes (M23). Scale drawing to half: at the same zoom the first object
  //      is half as wide on screen and the page reads 960 × 540. Then Crop/extend back to 1920
  //      wide with the top-right anchor: the drawing moves right by the 960 px added. Undo twice
  //      puts everything back — each Apply is one undo step.
  const dlg = page.getByRole("dialog");
  const footer = () => page.locator("footer").innerText();
  const pct = parseFloat(await zoom()) / 100;
  const b0 = await objectBox(0);
  await page.getByTitle(/rename in Document settings$/).tap();
  await dlg.getByRole("button", { name: "Scale drawing" }).tap();
  await dlg.getByLabel("W", { exact: true }).fill("960");
  await dlg.getByRole("button", { name: "Apply" }).tap();
  await page.waitForTimeout(300);
  const b1 = await objectBox(0);
  const halved = Math.abs(b1.width - b0.width / 2) < 1.5 && (await footer()).includes("960 × 540");
  await page.getByTitle(/rename in Document settings$/).tap();
  await dlg.getByLabel("W", { exact: true }).fill("1920");
  await dlg.getByRole("button", { name: "Anchor top right" }).tap();
  await dlg.getByRole("button", { name: "Apply" }).tap();
  await page.waitForTimeout(300);
  const b2 = await objectBox(0);
  await page.screenshot({ path: `${OUT}/15b-resize.png` });
  const movedRight = Math.abs(b2.x - b1.x - 960 * pct) < 1.5 && Math.abs(b2.width - b1.width) < 0.5;
  const undoBtn = page.getByRole("button", { name: "Undo", exact: true });
  await undoBtn.tap();
  await undoBtn.tap();
  await page.waitForTimeout(300);
  const b3 = await objectBox(0);
  const restored =
    Math.abs(b3.x - b0.x) < 0.5 &&
    Math.abs(b3.width - b0.width) < 0.5 &&
    (await footer()).includes("1920 × 1080");
  check(
    halved && movedRight && restored,
    `Document settings: Scale drawing halves the drawing (${b0.width.toFixed(1)} → ${b1.width.toFixed(1)} px), Crop/extend with the top-right anchor moves it right (${(b2.x - b1.x).toFixed(1)} px), two undos restore it`,
  );
```

If check 16 (Save) relies on the document being unsaved after 15, note the two undos return to the
doc as it was after 15 — the dirty state is the same. Check the zoom label format with `zoom()`
(e.g. "41%") before relying on `parseFloat`.

- [ ] **Step 2: Verify the check fails without the feature, then passes**

Run (outside the sandbox — the dev server needs a local port): `git stash push src/lib/DocumentSettingsDialog.svelte src/lib/AnchorGrid.svelte -q; npm run test:ipad`
— Expected: the new check FAILs (no "Scale drawing" button → timeout or false). Then
`git stash pop -q; npm run test:ipad` — Expected: `all passed`, 25 checks. Read
`test-results/ipad/15b-resize.png`.

Note: stashing the dialog leaves Task 3's store in place; the old dialog has no Scale drawing
button, so the tap times out — that is the expected failure. If Playwright's default timeout makes
the run slow, accept it once.

- [ ] **Step 3: Docs**

- `README.md` line ~32 area (the document-name bullet) — add a bullet: "Document settings resizes
  the page two ways: **Crop/extend** changes the page around the drawing, with a 3×3 anchor for
  where space is added or taken (Keep ratio optional), and **Scale drawing** scales everything
  with it — always in proportion, strokes and rounded corners included — so titles, polygons and
  gradients stay editable."
- `CLAUDE.md`:
  - Architecture map, `src/doc/`: add `doc-resize.ts` (`extendCanvas`, `scaleDrawing`,
    `scaleDetails`, `scaleRefusal`, `sizeRefusal`, `linkedSize`, `scaledSide` — Document settings'
    Crop/extend and Scale drawing, spec M23); `src/lib/`: add `AnchorGrid`.
  - Invariant 11: append "**Scale drawing is the exception** (M23, `doc-resize.ts`): it multiplies
    stroke widths and rect radii by `k` (`scaleDetails`, before the bake) and then bakes through
    `resizeNode`; it is always uniform, so titles keep their text."
  - Commands: `test:ipad` "24 checks" → "25 checks"; add "Document settings' resize" to the real-tap
    list.
  - Current state: a short M23 paragraph at the top (what it does; owed: the iPad pass).
  - Roadmap: M23 complete.
- `docs/superpowers/CHANGELOG.md`: a `## 2026-10-02 — M23: Document resize` entry — what, the
  spec correction (radius before the bake), what was checked in the browser (Task 4 Step 4 list)
  and by `test:ipad`, what is owed.
- `docs/superpowers/IPAD-CHECKLIST.md`: `- [ ] **P2** Document settings (M23): the mode buttons,
  the Keep ratio link and the anchor grid by finger; the numeric keyboard for W/H; Scale drawing
  on a document with a title and a gradient.`

Run `npx prettier --write` on the changed Markdown files.

- [ ] **Step 4: Final verification**

Run: `npm test`, `npm run lint`, `npm run build` — all clean. `npm run test:ipad` — all passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/ipad-smoke.mjs README.md CLAUDE.md docs/superpowers/CHANGELOG.md docs/superpowers/IPAD-CHECKLIST.md
git commit -m "test: test:ipad resizes the document both ways; docs for M23"
```
