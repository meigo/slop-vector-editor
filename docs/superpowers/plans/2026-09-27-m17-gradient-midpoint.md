# M17 Gradient Midpoint and Distinct Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-gradient midpoint (panel slider + canvas diamond, saved as a derived middle stop) and gradient knobs whose shape tells their role.

**Architecture:** `mid?: number` on both gradient kinds (absent = 0.5, never stored at 0.5); one pure `midStop` colour mix shared by export and import; a new `"mid"` handle part picked between knobs and lines; a hover cursor slot on `ToolContext` that the Canvas prefers over the tool's static cursor.

**Tech Stack:** Svelte 5, TypeScript, Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-27-m17-gradient-midpoint-design.md`

## Global Constraints

- `mid` strictly inside (0, 1); **absent means 0.5 and 0.5 is never stored** — setting 0.5 deletes the key.
- Nothing reads `g.mid` directly except `withMid`, `midOf` and the writer; everything else uses `midOf(g)`.
- UI edits in whole percents 1–99 (`Math.round(t * 100)`, clamp 1..99, `/ 100`).
- Existing documents and files must serialize **byte-identically** (no midpoint ⇒ exactly the two stops written today).
- Import tolerance: each channel within **±1** of 255, opacity within **0.005**; a `mid` within **1e-6** of 0.5 is stored as absent.
- Import drop label for a non-matching 3-stop and any 4+ stop gradient: `"gradients with more than two stops"` (unchanged).
- Knob shapes: circle = linear start / radial centre; square = linear end / rim A; ring = rim B; diamond = midpoint.
- Cursors: circle, square, line → `move`; ring → `grab`; diamond → `ew-resize`; nothing → the tool's `crosshair`.
- Invariants: edits return the same reference when nothing changes (invariant 1); tools never import the store (12); a live UI drag is one document gesture closed on `change`, `blur` and destroy (42); new controls use `var(--ctl-h)` (23).
- Build bar: `npm run build` 0 errors, 0 warnings; `npm test` green; `npm run lint` clean.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A fade to transparent with a midpoint** (red → transparent) must not grow a dark band — `midStop` is premultiplied. Test in Task 1.
2. **A foreign red-white-blue 3-stop gradient** must still drop, not be misread as a midpoint. Test in Task 2.
3. **A slider drag is one undo step**, and the bracket closes when the drag ends. Store test in Task 3.
4. **Redrawing, dragging a knob or baking a resize keeps the midpoint** (`drawGradientLine`, `setGradientGeometry`, `mapStyle`). Tests in Task 1 and Task 4.
5. **On a tiny gradient the diamond sits under the knobs** — the knob must win, and a click on the diamond must not pick a stop. Test in Task 4.

---

### Task 1: Model — `mid`, `midStop`, `setGradientMid`, carried through every edit

**Files:**
- Modify: `src/doc/document.ts` (types at 18–29, `sameFill` at 70–83, add helpers after `samePaint`)
- Modify: `src/doc/paint-edit.ts` (`toRadial`, `toLinear`, `restored`, `convertOrRestore`, `setGradientGeometry`, `drawGradientLine`, new `setGradientMid`)
- Test: `src/__tests__/gradient-model.test.ts`, `src/__tests__/paint-edit.test.ts`

**Interfaces:**
- Produces (document.ts): `midOf(g: Gradient): number`; `withMid<G extends Gradient>(g: G, mid: number | undefined): G`; `midStop(a: Paint, b: Paint): Paint`; `LinearGradient.mid?: number`; `RadialGradient.mid?: number`.
- Produces (paint-edit.ts): `setGradientMid(doc: Doc, ids: readonly string[], which: PaintSlot, mid: number): Doc`.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/gradient-model.test.ts` (add `midOf`, `midStop`, `withMid`, `mapStyle`, `sameFill`, `sameColours`, `DEFAULT_STYLE` to its imports from `../doc/document` if missing):

```ts
describe("midpoint model (spec M17 §2–§3)", () => {
  const red = { color: "#ff0000", opacity: 1 };
  const blue = { color: "#0000ff", opacity: 1 };
  const g = {
    kind: "linear" as const,
    from: { x: 0, y: 0 },
    to: { x: 10, y: 0 },
    start: red,
    end: blue,
  };

  it("midOf defaults to 0.5; withMid deletes the key at 0.5 and undefined", () => {
    expect(midOf(g)).toBe(0.5);
    expect(midOf(withMid(g, 0.3))).toBe(0.3);
    expect("mid" in withMid({ ...g, mid: 0.3 }, 0.5)).toBe(false);
    expect("mid" in withMid({ ...g, mid: 0.3 }, undefined)).toBe(false);
  });

  it("midStop mixes opaque colours channel by channel", () => {
    expect(midStop(red, blue)).toEqual({ color: "#800080", opacity: 1 });
    expect(midStop({ color: "#000000", opacity: 1 }, { color: "#ffffff", opacity: 1 })).toEqual({
      color: "#808080",
      opacity: 1,
    });
  });

  it("midStop is premultiplied: a fade to transparent keeps its colour (Review Focus 1)", () => {
    expect(midStop(red, { color: "#000000", opacity: 0 })).toEqual({
      color: "#ff0000",
      opacity: 0.5,
    });
    expect(midStop({ color: "#ff0000", opacity: 0.75 }, { color: "#0000ff", opacity: 0.25 })).toEqual(
      { color: "#bf0040", opacity: 0.5 },
    );
  });

  it("midStop falls back to the plain average when both ends are transparent", () => {
    expect(
      midStop({ color: "#ff0000", opacity: 0 }, { color: "#0000ff", opacity: 0 }),
    ).toEqual({ color: "#800080", opacity: 0 });
  });

  it("sameFill compares the midpoint (absent = 0.5); sameColours ignores it", () => {
    expect(sameFill(g, { ...g, mid: 0.3 })).toBe(false);
    expect(sameFill(g, withMid(g, 0.5))).toBe(true);
    expect(sameColours(g, { ...g, mid: 0.3 })).toBe(true);
  });

  it("mapStyle keeps the midpoint through a bake (Review Focus 4)", () => {
    const s = { ...DEFAULT_STYLE, fill: { ...g, mid: 0.3 } };
    const out = mapStyle(s, [2, 0, 0, 2, 5, 5]);
    expect(midOf(out.fill as typeof g)).toBe(0.3);
  });
});
```

Append to `src/__tests__/paint-edit.test.ts` (import `setGradientMid`, `toRadial`, `toLinear`, `drawGradientLine`, `setGradientGeometry`, `setPaintKind`, `convertGradients` from `../doc/paint-edit` and `midOf` from `../doc/document` as needed; reuse the file's existing doc/rect helpers — if it has none that fit, add the local helpers shown):

```ts
describe("midpoint edits (spec M17 §2)", () => {
  const red = { color: "#ff0000", opacity: 1 };
  const blue = { color: "#0000ff", opacity: 1 };
  const lin: LinearGradient = {
    kind: "linear",
    from: { x: 0, y: 5 },
    to: { x: 10, y: 5 },
    start: red,
    end: blue,
  };
  const docWith = (fill: Fill): Doc => {
    const d = createDoc(100, 100);
    const r: Node = {
      kind: "rect",
      id: "a",
      transform: IDENTITY,
      style: { ...DEFAULT_STYLE, fill },
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      rx: 0,
    };
    return { ...d, layers: [{ ...d.layers[0], id: "L0", children: [r] }] };
  };
  const fillA = (d: Doc) => (findNode(d, "a")!.node as Shape).style.fill as Gradient;

  it("setGradientMid sets it, deletes it at 0.5, and returns the same doc for a no-op", () => {
    const d0 = docWith(lin);
    const d1 = setGradientMid(d0, ["a"], "fill", 0.3);
    expect(fillA(d1).mid).toBe(0.3);
    const d2 = setGradientMid(d1, ["a"], "fill", 0.5);
    expect("mid" in fillA(d2)).toBe(false);
    expect(setGradientMid(d0, ["a"], "fill", 0.5)).toBe(d0);
    expect(setGradientMid(d1, ["a"], "fill", 0.3)).toBe(d1);
  });

  it("setGradientMid leaves flat paints alone", () => {
    const d0 = docWith(red);
    expect(setGradientMid(d0, ["a"], "fill", 0.3)).toBe(d0);
  });

  it("toRadial / toLinear carry the midpoint", () => {
    expect(toRadial({ ...lin, mid: 0.3 }).mid).toBe(0.3);
    expect(toLinear(toRadial({ ...lin, mid: 0.3 })).mid).toBe(0.3);
    expect("mid" in toRadial(lin)).toBe(false);
  });

  it("drawGradientLine and setGradientGeometry keep the current midpoint (Review Focus 4)", () => {
    const d0 = docWith({ ...lin, mid: 0.3 });
    const drawn = drawGradientLine(d0, ["a"], "fill", { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(fillA(drawn).mid).toBe(0.3);
    const radial = drawGradientLine(d0, ["a"], "fill", { x: 5, y: 5 }, { x: 9, y: 5 }, "radial");
    expect(fillA(radial).mid).toBe(0.3);
    const moved = setGradientGeometry(d0, "a", "fill", { ...lin, to: { x: 8, y: 5 } });
    expect(fillA(moved).mid).toBe(0.3);
  });

  it("a Type round trip through the memory keeps the CURRENT midpoint", () => {
    const d0 = docWith({ ...lin, mid: 0.3 });
    const remembered = { g: { ...lin, mid: 0.3 } as Gradient, box: { x: 0, y: 0, w: 10, h: 10 } };
    const asRadial = convertGradients(d0, ["a"], "fill", "radial");
    const edited = setGradientMid(asRadial, ["a"], "fill", 0.7);
    const back = convertGradients(edited, ["a"], "fill", "linear", () => remembered);
    expect(midOf(fillA(back))).toBe(0.7);
  });

  it("Flat → gradient restores the remembered midpoint", () => {
    const d0 = docWith(red);
    const remembered = { g: { ...lin, mid: 0.3 } as Gradient, box: { x: 0, y: 0, w: 10, h: 10 } };
    const back = setPaintKind(d0, ["a"], "fill", "linear", () => remembered);
    expect(midOf(fillA(back))).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/gradient-model.test.ts src/__tests__/paint-edit.test.ts`
Expected: FAIL — `midOf`, `midStop`, `withMid`, `setGradientMid` are not exported.

- [ ] **Step 3: Implement in `src/doc/document.ts`**

Add `mid?: number;` as the last field of both `LinearGradient` and `RadialGradient`, with this doc comment on `LinearGradient`'s existing comment block (append a line): ` *  `mid` (spec M17 §2): the offset where the colour is `midStop(start, end)`; absent = 0.5.`

After `samePaint`, add:

```ts
/** Spec M17 §2: every reader goes through this — absent means 0.5. */
export const midOf = (g: Gradient): number => g.mid ?? 0.5;

/** `g` with its midpoint set; 0.5 (or undefined) deletes the key, so "no midpoint" has exactly
 *  one representation and an edit to 50% changes nothing (invariants 1, 39). */
export function withMid<G extends Gradient>(g: G, mid: number | undefined): G {
  const out = { ...g };
  delete out.mid;
  if (mid !== undefined && mid !== 0.5) out.mid = mid;
  return out;
}

const channel = (c: string, i: number) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** Spec M17 §3: the 50/50 mix a midpoint stop carries, shared by export and import. Colour is the
 *  PREMULTIPLIED average, so a fade to transparent stays its colour instead of passing through a
 *  darker band; both transparent falls back to the plain average. */
export function midStop(a: Paint, b: Paint): Paint {
  const w = a.opacity + b.opacity;
  const ch = (i: number) =>
    Math.round(
      w === 0
        ? (channel(a.color, i) + channel(b.color, i)) / 2
        : (channel(a.color, i) * a.opacity + channel(b.color, i) * b.opacity) / w,
    );
  return { color: `#${hex2(ch(0))}${hex2(ch(1))}${hex2(ch(2))}`, opacity: w / 2 };
}
```

In `sameFill`, change the gradient return to:

```ts
    return (
      pointsMatch &&
      samePaint(a.start, b.start) &&
      samePaint(a.end, b.end) &&
      midOf(a) === midOf(b)
    );
```

Leave `sameColours` unchanged, and add one line to its doc comment: ` *  The midpoint is ignored too (spec M17 §2): it is how the colours are spread, not which.`

`mapFill` spreads `...f`, so `mid` already survives bakes — no change there.

- [ ] **Step 4: Implement in `src/doc/paint-edit.ts`**

Add `withMid` to the import from `./document`.

`toRadial` — wrap its returned literal: `return withMid({ kind: "radial", …existing fields… }, g.mid);`
`toLinear` — `: withMid({ kind: "linear", from: g.center, to: g.a, start: g.start, end: g.end }, g.mid);`

`restored` — add a `mid` parameter after `end`, defaulting to the remembered one, and apply it:

```ts
function restored(
  r: RememberedGradient,
  box: Box | null,
  start: Paint,
  end: Paint = r.g.end,
  mid: number | undefined = r.g.mid,
): Fill {
  …unchanged axis/map…
  return r.g.kind === "linear"
    ? flatIfDegenerate(withMid({ ...r.g, from: map(r.g.from), to: map(r.g.to), start, end }, mid))
    : flatIfDegenerate(
        withMid(
          { ...r.g, center: map(r.g.center), a: map(r.g.a), b: map(r.g.b), start, end },
          mid,
        ),
      );
}
```

Extend its doc comment: `… and, likewise, the CURRENT midpoint (spec M17 §2: it is a stop property).`

`convertOrRestore` — `restored(r, box, f.start, f.end, f.mid)`.

`setGradientGeometry` — `return withFill(n, which, flatIfDegenerate(withMid({ ...next, start: f.start, end: f.end }, f.mid)));` and add "and midpoint" to its doc comment after "CURRENT stops".

`drawGradientLine` — after `const end = …`, add `const mid = isGradient(f) ? f.mid : undefined;`, and change the final line to `return withFill(s, which, flatIfDegenerate(withMid(next, mid)));`. Doc comment: "keeps its stops and midpoint".

Add after `setGradientStop`:

```ts
/** Spec M17 §2: sets every selected gradient's midpoint on `which`; 0.5 deletes the key. Flat
 *  paints are untouched, and an unchanged gradient keeps its reference (`withFill`/`sameFill`). */
export function setGradientMid(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  mid: number,
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    return isGradient(f) ? withFill(s, which, withMid(f, mid)) : s;
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/gradient-model.test.ts src/__tests__/paint-edit.test.ts`
Expected: PASS. Then `npm test` — all green (no other test should change).

- [ ] **Step 6: Commit**

```bash
git add src/doc/document.ts src/doc/paint-edit.ts src/__tests__/gradient-model.test.ts src/__tests__/paint-edit.test.ts
git commit -m "feat(M17): gradient midpoint model — midOf, withMid, midStop, setGradientMid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: File format — write the middle stop, read it back

**Files:**
- Modify: `src/svg/attrs.ts:46-80` (`stopAttrs`, `gradientDefs`)
- Modify: `src/svg/gradient-import.ts` (`foldLinear` 212–262, `foldRadial` 267–322, new `outerStops`)
- Test: `src/__tests__/gradient-roundtrip.test.ts`, `src/__tests__/gradient-import.test.ts`

**Interfaces:**
- Consumes: `midStop`, `withMid`, `midOf` from Task 1.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/gradient-import.test.ts` (it already has `svg`, `linear`, `foldOk`, `box`, `view`; add a radial helper if the file has none — `const radial = (defs: string, id = "g"): RawRadial => { const r = resolve(defs, id); if (r.kind !== "radial") throw new Error(JSON.stringify(r)); return r.g; };` — and import `foldRadial` already imported):

```ts
describe("midpoint import (spec M17 §4)", () => {
  const three = (mid: string, midColour: string, midOpacity = "1", o0 = "0", o1 = "1") =>
    `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">` +
    `<stop offset="${o0}" stop-color="#ff0000"/>` +
    `<stop offset="${mid}" stop-color="${midColour}" stop-opacity="${midOpacity}"/>` +
    `<stop offset="${o1}" stop-color="#0000ff"/></linearGradient>`;

  it("reads a middle stop that is the mix of the outer two as a midpoint", () => {
    const f = foldOk(linear(three("0.3", "#800080")));
    expect(f.mid).toBeCloseTo(0.3, 12);
    expect(f.start.color).toBe("#ff0000");
    expect(f.end.color).toBe("#0000ff");
  });

  it("accepts ±1 per channel and 0.004 opacity; refuses ±2 and 0.01", () => {
    expect(foldOk(linear(three("0.3", "#7f0081"))).mid).toBeCloseTo(0.3, 12);
    expect(foldOk(linear(three("0.3", "#800080", "0.996"))).mid).toBeCloseTo(0.3, 12);
    expect(foldLinear(linear(three("0.3", "#820080")), box, view, 1)).toEqual({
      kind: "drop",
      label: "gradients with more than two stops",
    });
    expect(foldLinear(linear(three("0.3", "#800080", "0.99")), box, view, 1).kind).toBe("drop");
  });

  it("still drops a real three-colour gradient (Review Focus 2)", () => {
    expect(foldLinear(linear(three("0.5", "#ffffff")), box, view, 1)).toEqual({
      kind: "drop",
      label: "gradients with more than two stops",
    });
  });

  it("folds foreign outer offsets: mid is relative to them", () => {
    const f = foldOk(linear(three("0.4", "#800080", "1", "0.2", "0.8")));
    expect(f.from.x).toBeCloseTo(20, 9);
    expect(f.to.x).toBeCloseTo(80, 9);
    expect(f.mid).toBeCloseTo(1 / 3, 12);
  });

  it("stores a midpoint at 0.5 as absent, and drops a middle stop on an outer offset", () => {
    expect("mid" in foldOk(linear(three("0.5", "#800080")))).toBe(false);
    expect(foldLinear(linear(three("0", "#800080")), box, view, 1).kind).toBe("drop");
    expect(foldLinear(linear(three("1", "#800080")), box, view, 1).kind).toBe("drop");
  });

  it("reads a radial midpoint relative to its last stop", () => {
    const defs =
      `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="40">` +
      `<stop offset="0" stop-color="#ff0000"/><stop offset="0.2" stop-color="#800080"/>` +
      `<stop offset="0.8" stop-color="#0000ff"/></radialGradient>`;
    const f = foldRadial(radial(defs), box, view, 1);
    if (f.kind !== "fill" || !isRadial(f.fill)) throw new Error(JSON.stringify(f));
    expect(f.fill.mid).toBeCloseTo(0.25, 12);
    expect(f.fill.a.x).toBeCloseTo(50 + 40 * 0.8, 9);
  });

  it("still refuses four stops", () => {
    const defs =
      `<linearGradient id="g"><stop offset="0" stop-color="#ff0000"/>` +
      `<stop offset="0.3" stop-color="#800080"/><stop offset="0.6" stop-color="#800080"/>` +
      `<stop offset="1" stop-color="#0000ff"/></linearGradient>`;
    expect(foldLinear(linear(defs), box, view, 1).kind).toBe("drop");
  });
});
```

Append to `src/__tests__/gradient-roundtrip.test.ts` (reuse its `shapesOf`; build the doc the same way the first test in the file does):

```ts
describe("midpoint round trip (spec M17 §3–§4)", () => {
  const withFill = (fill: LinearGradient | RadialGradient): Doc => {
    const d0 = createDoc(200, 100);
    return {
      ...d0,
      layers: [
        {
          ...d0.layers[0],
          children: [
            {
              kind: "rect",
              id: "n1",
              transform: [1, 0, 0, 1, 0, 0],
              style: { ...DEFAULT_STYLE, fill },
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
  const lin: LinearGradient = {
    kind: "linear",
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    start: { color: "#ff0000", opacity: 1 },
    end: { color: "#000000", opacity: 0 },
  };
  const rad: RadialGradient = {
    kind: "radial",
    center: { x: 50, y: 25 },
    a: { x: 90, y: 25 },
    b: { x: 50, y: 40 },
    start: { color: "#ff0000", opacity: 1 },
    end: { color: "#0000ff", opacity: 1 },
  };

  it("writes three stops only when there is a midpoint", () => {
    expect(serializeDoc(withFill(lin)).match(/<stop /g)).toHaveLength(2);
    const text = serializeDoc(withFill({ ...lin, mid: 0.3 }));
    expect(text.match(/<stop /g)).toHaveLength(3);
    expect(text).toContain('offset="0.3" stop-color="#ff0000" stop-opacity="0.5"');
  });

  it("round-trips the midpoint for both kinds, native, nothing dropped", () => {
    for (const g of [{ ...lin, mid: 0.3 }, { ...rad, mid: 0.72 }]) {
      const r = parseSvg(serializeDoc(withFill(g)));
      expect(r.dropped).toEqual([]);
      expect(r.native).toBe(true);
      const f = shapesOf(r.doc)[0].style.fill;
      if (!isGradient(f)) throw new Error("gradient expected");
      expect(f.mid).toBe(g.mid);
      expect(serializeDoc(r.doc)).toBe(serializeDoc(withFill(g)));
    }
  });

  it("round-trips a radial ellipse with a midpoint under gradientTransform", () => {
    const g = { ...rad, b: { x: 60, y: 45 }, mid: 0.2 };
    const text = serializeDoc(withFill(g));
    expect(text).toContain("gradientTransform");
    const f = shapesOf(parseSvg(text).doc)[0].style.fill;
    if (!isRadial(f)) throw new Error("radial expected");
    expect(f.mid).toBe(0.2);
  });
});
```

(If `parseSvg`'s result field names differ from `dropped`/`native`/`doc`, use the ones the file's first test uses.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/gradient-import.test.ts src/__tests__/gradient-roundtrip.test.ts`
Expected: FAIL — three stops are dropped; the writer emits two stops.

- [ ] **Step 3: Implement export in `src/svg/attrs.ts`**

Import `midStop` from `../doc/document`. Change `stopAttrs`'s `offset` parameter type from `"0" | "1"` to `string`. In `gradientDefs`, replace the `stops` line:

```ts
    // Spec M17 §3: a midpoint is a third stop carrying the 50/50 mix; none, and the output is
    // exactly the two stops written before M17.
    const stops =
      f.mid === undefined
        ? [stopAttrs("0", f.start), stopAttrs("1", f.end)]
        : [
            stopAttrs("0", f.start),
            stopAttrs(fmt(f.mid), midStop(f.start, f.end)),
            stopAttrs("1", f.end),
          ];
```

- [ ] **Step 4: Implement import in `src/svg/gradient-import.ts`**

Import `midStop`, `withMid` from `../doc/document` (and `Paint` type). Above `foldLinear`, add:

```ts
type Outer = { o0: number; o1: number; start: Paint; end: Paint; mid: number | undefined };

const hexChannel = (c: string, i: number) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);

/** Spec M17 §4: within rounding of the mix our own writer (and other editors) put there. */
function isMidStop(p: Paint, want: Paint): boolean {
  return (
    Math.abs(p.opacity - want.opacity) <= 0.005 &&
    [0, 1, 2].every((i) => Math.abs(hexChannel(p.color, i) - hexChannel(want.color, i)) <= 1)
  );
}

/** The two stops the model keeps, with their offsets — plus a midpoint when a third, middle stop
 *  is exactly their mix (spec M17 §4). Anything else is more than the model can hold. */
function outerStops(raw: readonly RawStop[], stops: readonly Paint[]): Outer | { drop: string } {
  const more = { drop: "gradients with more than two stops" };
  if (raw.length === 2) {
    if (raw[1].offset <= raw[0].offset) return more;
    return { o0: raw[0].offset, o1: raw[1].offset, start: stops[0], end: stops[1], mid: undefined };
  }
  if (raw.length !== 3) return more;
  const [o0, om, o1] = raw.map((s) => s.offset);
  if (!(o0 < om && om < o1)) return more;
  if (!isMidStop(stops[1], midStop(stops[0], stops[2]))) return more;
  const t = (om - o0) / (o1 - o0);
  return { o0, o1, start: stops[0], end: stops[2], mid: Math.abs(t - 0.5) < 1e-6 ? undefined : t };
}
```

In `foldLinear`, replace the `if (g.stops.length > 2 || …)` block with:

```ts
  const outer = outerStops(g.stops, stops);
  if ("drop" in outer) return { kind: "drop", label: outer.drop };
```

and further down: `if (dd === 0) return { kind: "fill", fill: outer.end };`, and the fill:

```ts
  const fill = flatIfDegenerate(
    withMid(
      {
        kind: "linear",
        from: at(outer.o0),
        to: at(outer.o1),
        start: outer.start,
        end: outer.end,
      },
      outer.mid,
    ),
  );
```

In `foldRadial`, the same replacement of the `> 2` block; then `if (outer.o0 > 0) return { kind: "drop", label: "radial gradients with an inner stop" };` (replacing the `g.stops[0].offset > 0` line); `if (r === 0) return { kind: "fill", fill: outer.end };`; `const o1 = outer.o1;`; and wrap the radial literal in `withMid(…, outer.mid)` with `start: outer.start, end: outer.end`. Since `o0` is 0 there, `(om − o0)/(o1 − o0)` is `om / o1`, as the spec says.

Update both functions' doc comments with one line: `Spec M17 §4: a third, middle stop equal to the outer two's mix is read as a midpoint.`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/gradient-import.test.ts src/__tests__/gradient-roundtrip.test.ts`
Expected: PASS. Then `npm test` — all green.

- [ ] **Step 6: Commit**

```bash
git add src/svg/attrs.ts src/svg/gradient-import.ts src/__tests__/gradient-import.test.ts src/__tests__/gradient-roundtrip.test.ts
git commit -m "feat(M17): save a midpoint as a derived middle stop and read it back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The panel — Midpoint row and store action

**Files:**
- Modify: `src/state/properties.ts:70-102` (`GradientSummary`, `summarizeGradient`)
- Modify: `src/state/appState.svelte.ts` (import `setGradientMid as applyGradientMid`; add `setSelectionGradientMid` after `setSelectionGradientStop` at ~763)
- Create: `src/lib/MidpointRow.svelte`
- Modify: `src/lib/PaintField.svelte` (new props `mid`, `onmid`; the row between Start and End)
- Modify: `src/lib/PropertiesPanel.svelte:182-210` (pass `mid`/`onmid` to both PaintFields)
- Test: `src/__tests__/properties.test.ts`, `src/__tests__/gradient-store.test.ts`

**Interfaces:**
- Consumes: `setGradientMid`, `midOf` (Task 1).
- Produces: `GradientSummary.mid: Field<number> | null`; `setSelectionGradientMid(which: PaintSlot, mid: number): void`.

Placement note: the Start/End rows live in `PaintField` (the Fill and Stroke blocks), so the Midpoint row goes there, between them — one per paint. `PaintField` is a flex column, not the `.field-grid`, so the row mirrors the Start/End rows (a `w-9` label + controls), not a `.field-row`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/properties.test.ts`, the existing `summarizeGradient` expectations compare whole objects with `toEqual`; add `mid` to each: `mid: { mixed: false, value: 0.5 }` wherever `stops` is non-null, `mid: null` wherever `stops` is `null`. Then append inside `describe("summarizeGradient", …)`:

```ts
  it("merges the midpoint (spec M17 §5)", () => {
    const g = {
      kind: "linear" as const,
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      start: { color: "#ff0000", opacity: 1 },
      end: { color: "#0000ff", opacity: 1 },
    };
    const s = (fill: Style["fill"]): Style => ({ ...DEFAULT_STYLE, fill });
    expect(summarizeGradient([s({ ...g, mid: 0.3 }), s({ ...g, mid: 0.3 })], "fill")?.mid).toEqual({
      mixed: false,
      value: 0.3,
    });
    expect(summarizeGradient([s({ ...g, mid: 0.3 }), s(g)], "fill")?.mid).toEqual({ mixed: true });
    expect(summarizeGradient([s(g), s(g.start)], "fill")?.mid).toBeNull();
  });
```

Append to `src/__tests__/gradient-store.test.ts` (add `setSelectionGradientMid`, `beginDocGesture`, `endDocGesture` to its store import; `makeDoc`, `styleOf`, `replaceDocument`, `setSelection`, `setSelectionPaintKind`, `undo` already exist there):

```ts
describe("setSelectionGradientMid (spec M17 §5)", () => {
  beforeEach(() => {
    replaceDocument(makeDoc(), null, "t.svg");
    setSelection(["a"]);
    setSelectionPaintKind("fill", "linear");
  });

  it("sets the midpoint on the selection and deletes it at 50%", () => {
    setSelectionGradientMid("fill", 0.3);
    expect((styleOf("a").fill as { mid?: number }).mid).toBe(0.3);
    setSelectionGradientMid("fill", 0.5);
    expect("mid" in (styleOf("a").fill as object)).toBe(false);
  });

  it("a live slider drag inside a doc gesture is one undo step (Review Focus 3)", () => {
    beginDocGesture();
    for (const m of [0.4, 0.35, 0.3, 0.25]) setSelectionGradientMid("fill", m);
    endDocGesture();
    expect((styleOf("a").fill as { mid?: number }).mid).toBe(0.25);
    undo();
    expect("mid" in (styleOf("a").fill as object)).toBe(false);
  });
});
```

(Use the same `replaceDocument` call shape the file's existing `beforeEach` blocks use, if it differs.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/properties.test.ts src/__tests__/gradient-store.test.ts`
Expected: FAIL — `mid` missing from the summary; `setSelectionGradientMid` not exported.

- [ ] **Step 3: Implement `properties.ts`**

Import `midOf` from `../doc/document`. Type:

```ts
export type GradientSummary = {
  kind: Field<"flat" | "linear" | "radial">;
  stops: { start: Field<Paint>; end: Field<Paint> } | null;
  /** Spec M17 §5: null exactly when `stops` is. */
  mid: Field<number> | null;
};
```

In `summarizeGradient`, after `stops`: `const mid = stops ? merge(grads.map(midOf)) : null;` and `return { kind, stops, mid };`.

- [ ] **Step 4: Implement the store action**

In `appState.svelte.ts`, add `setGradientMid as applyGradientMid,` to the `../doc/paint-edit` import, and after `setSelectionGradientStop`:

```ts
/** Spec M17 §5: the Midpoint row. Its slider brackets a drag in `beginDocGesture`/`endDocGesture`
 *  (invariant 42), so the per-`input` commits here collapse into one undo step. */
export function setSelectionGradientMid(which: PaintSlot, mid: number): void {
  cancelActiveGesture();
  if (app.selection.length === 0) return;
  commitDoc(applyGradientMid(app.doc, app.selection, which, mid));
}
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `npx vitest run src/__tests__/properties.test.ts src/__tests__/gradient-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Create `src/lib/MidpointRow.svelte`**

```svelte
<script lang="ts">
  import type { Field } from "../state/properties";
  import NumberField from "./NumberField.svelte";

  let {
    label,
    mid,
    onmid,
    onlivestart,
    onliveend,
  }: {
    /** Accessible name prefix, e.g. "Fill". */
    label: string;
    mid: Field<number>;
    onmid: (mid: number) => void;
    /** Brackets a slider drag so the whole drag is one undo step (invariant 42). The caller owns
     *  the document gesture; this component never touches the store. */
    onlivestart?: () => void;
    onliveend?: () => void;
  } = $props();

  const pct = $derived(mid.mixed ? null : Math.round(mid.value * 100));
  let live = $state(false);

  function startLive() {
    if (live) return;
    live = true;
    onlivestart?.();
  }

  /** Every way a drag can end: `change`, `blur` (no `change` fires when nothing moved) and
   *  destruction (clearing the selection removes this row mid-drag). */
  function endLive() {
    if (!live) return;
    live = false;
    onliveend?.();
  }

  $effect(() => () => endLive());
</script>

<!-- Spec M17 §5: where the two colours mix 50/50. The slider is the app's first range input:
     `touch-action: none` so iPadOS reads a drag on it as a drag, not a scroll (invariant 6), and
     `--ctl-h` high like every other control (invariant 23). -->
<div class="flex items-center gap-2" title="Midpoint — where the two colours mix 50/50">
  <span class="w-9 shrink-0 text-muted">Mid</span>
  <input
    type="range"
    min="1"
    max="99"
    step="1"
    class="min-w-0 flex-1 cursor-pointer"
    style="height: var(--ctl-h); touch-action: none"
    aria-label="{label} midpoint"
    value={pct ?? 50}
    oninput={(e) => {
      startLive();
      onmid(Number(e.currentTarget.value) / 100);
    }}
    onchange={endLive}
    onblur={endLive}
  />
  <!-- `NumberField`'s root is `display: contents`; this wrapper is the flex item it sizes
       against, as in PaintRow. -->
  <div class="w-16 shrink-0">
    <NumberField
      label=""
      value={pct}
      min={1}
      max={99}
      suffix="%"
      onchange={(v) => onmid(Math.round(v) / 100)}
    />
  </div>
</div>
```

- [ ] **Step 7: Wire it into `PaintField.svelte`**

Import `MidpointRow`. Add props (after `onstop` in both the destructure and the type):

```ts
    /** Spec M17 §5: null when not every paint is a gradient (then there are no stop rows either). */
    mid?: Field<number> | null;
    onmid?: (mid: number) => void;
```

with `mid = null` and `onmid` in the destructure. Replace the `{#each STOPS …}` block so the Midpoint row renders between Start and End:

```svelte
  {:else if stops}
    {#each STOPS as stop (stop)}
      {@const f = stops[stop]}
      {#if stop === "end" && mid && onmid}
        <MidpointRow {label} {mid} {onmid} {onlivestart} {onliveend} />
      {/if}
      {#if !f.mixed}
        …existing Start/End row markup unchanged…
      {/if}
    {/each}
  {/if}
```

- [ ] **Step 8: Wire it into `PropertiesPanel.svelte`**

Import `setSelectionGradientMid`. On the Fill `PaintField` add `mid={fillGrad?.mid ?? null}` and `onmid={(m) => setSelectionGradientMid("fill", m)}`; on the Stroke one, the same with `strokeGrad` and `"stroke"`.

- [ ] **Step 9: Verify build, lint, tests**

Run: `npm run build && npm run lint && npm test`
Expected: 0 errors, 0 warnings; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/state/properties.ts src/state/appState.svelte.ts src/lib/MidpointRow.svelte src/lib/PaintField.svelte src/lib/PropertiesPanel.svelte src/__tests__/properties.test.ts src/__tests__/gradient-store.test.ts
git commit -m "feat(M17): Midpoint slider and field in the paint's gradient rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The midpoint diamond — handle, pick, drag

**Files:**
- Modify: `src/tools/gradient-handles.ts` (`GradientHandle`, `gradientHandles`, `HandlePart`, `pickHandle`)
- Modify: `src/tools/gradient-tool.ts` (`Mode`, `stopFor`, `apply`, `move`, `up`)
- Test: `src/__tests__/gradient-tool.test.ts`

**Interfaces:**
- Consumes: `setGradientMid`, `midOf` (Task 1).
- Produces: `GradientHandle.mid: Vec` (document space) on both variants; `HandlePart` gains `"mid"`. Task 5 draws from `h.mid`.

Behaviour change to note: a press at the middle of a gradient line now grabs the diamond instead of the line. Existing tests that press a line at its exact middle must move the press point off the diamond (e.g. to 25% along the line) — keep their intent (a line drag), do not delete them. In particular `pickHandle(hs, { x: 60, y: 37 }, 6)` in the first `gradientHandles / pickHandle` test becomes `{ x: 35, y: 37 }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/gradient-tool.test.ts` (it has `red`, `blue`, `lin`, `rect`, `doc`, `fillOf`, `drag`; add `setGradientMid` import from `../doc/paint-edit` if needed):

```ts
describe("midpoint diamond (spec M17 §6)", () => {
  it("sits at mid along the line (linear) or centre→A (radial), in document space", () => {
    const d = doc([rect("a", 0, { ...lin, mid: 0.3 }, translate(10, 10))]);
    const [h] = gradientHandles(d, ["a"], "fill");
    expect(h.mid.x).toBeCloseTo(40, 9);
    expect(h.mid.y).toBeCloseTo(35, 9);
    const rad: RadialGradient = {
      kind: "radial",
      center: { x: 50, y: 25 },
      a: { x: 90, y: 25 },
      b: { x: 50, y: 45 },
      start: red,
      end: blue,
    };
    const [r] = gradientHandles(doc([rect("b", 0, rad)]), ["b"], "fill");
    expect(r.mid).toEqual({ x: 70, y: 25 });
  });

  it("picks knob, then diamond, then line", () => {
    const hs = gradientHandles(doc([rect("a", 0, lin)]), ["a"], "fill");
    expect(pickHandle(hs, { x: 51, y: 26 }, 6)?.part).toBe("mid");
    expect(pickHandle(hs, { x: 20, y: 26 }, 6)?.part).toBe("line");
    expect(pickHandle(hs, { x: 2, y: 25 }, 6)?.part).toBe("start");
  });

  it("on a tiny gradient the knobs win over the diamond (Review Focus 5)", () => {
    const tiny: LinearGradient = { ...lin, from: { x: 50, y: 25 }, to: { x: 54, y: 25 } };
    const hs = gradientHandles(doc([rect("a", 0, tiny)]), ["a"], "fill");
    expect(pickHandle(hs, { x: 52, y: 25 }, 6)?.part).toBe("start");
  });

  it("dragging the diamond sets a whole-percent midpoint, clamped to 1–99, one undo step", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    state.selection = ["a"];
    const tool = createGradientTool();
    drag(tool, ctx, [
      [50, 25],
      [40, 30],
      [30.4, 40],
    ]);
    expect((fillOf(ctx.doc(), "a") as LinearGradient).mid).toBe(0.3);
    drag(tool, ctx, [
      [30, 25],
      [-500, 25],
    ]);
    expect((fillOf(ctx.doc(), "a") as LinearGradient).mid).toBe(0.01);
    drag(tool, ctx, [
      [1.5, 25],
      [900, 25],
    ]);
    // The press at x=1.5 is on the start knob, not the diamond: it moves the start instead.
    expect((fillOf(ctx.doc(), "a") as LinearGradient).from.x).toBe(900);
  });

  it("a cancelled diamond drag restores the document; a click on it picks no stop", () => {
    const d0 = doc([rect("a", 0, lin)]);
    const { ctx, state } = fakeContext(d0);
    state.selection = ["a"];
    const tool = createGradientTool();
    tool.down(ctx, ev(50, 25));
    tool.move(ctx, ev(30, 25));
    tool.cancel(ctx);
    expect(ctx.doc()).toBe(d0);
    tool.down(ctx, ev(50, 25));
    tool.up(ctx, ev(50, 25));
    expect(ctx.gradientStop()).toBeNull();
    expect(state.selection).toEqual(["a"]);
  });

  it("a diamond drag does not forget the Type-row memory (the geometry did not change)", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    state.selection = ["a"];
    drag(createGradientTool(), ctx, [
      [50, 25],
      [30, 25],
    ]);
    expect(state.forgotten).toEqual([]);
  });

  it("a knob drag keeps the midpoint (Review Focus 4)", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, { ...lin, mid: 0.3 })]));
    state.selection = ["a"];
    drag(createGradientTool(), ctx, [
      [100, 25],
      [80, 25],
    ]);
    expect((fillOf(ctx.doc(), "a") as LinearGradient).mid).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/gradient-tool.test.ts`
Expected: FAIL — `h.mid` undefined; no `"mid"` part.

- [ ] **Step 3: Implement `gradient-handles.ts`**

Import `midOf` from `../doc/document`. Add `mid: Vec;` to both `GradientHandle` variants, with a comment on the first: `/** Spec M17 §6: the midpoint diamond, in document space — affine maps keep ratios along a line, so document-space `t` equals own-space `t`. */`

In `gradientHandles`, compute it from the already-mapped points:

```ts
const lerp = (p: Vec, q: Vec, t: number): Vec => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
```

(module level), and in the linear push: `const from = applyMat(world, f.from); const to = applyMat(world, f.to);` then `from, to, mid: lerp(from, to, midOf(f))`; in the radial push: `const center = applyMat(world, f.center); const a = applyMat(world, f.a);` then `center, a, b: applyMat(world, f.b), mid: lerp(center, a, midOf(f))`.

`export type HandlePart = "start" | "end" | "line" | "center" | "rimA" | "rimB" | "mid";`

In `pickHandle`, between the knob pass and the line pass:

```ts
  // Spec M17 §6: diamonds after every knob (a short gradient's diamond sits under its knobs, and
  // the knob must win — the panel is the route then) and before every line.
  for (let i = handles.length - 1; i >= 0; i--) {
    if (dist(handles[i].mid, p) <= tol) return { h: handles[i], part: "mid" };
  }
```

and add to its doc comment: `Diamonds (spec M17 §6) are a pass of their own between the two.`

- [ ] **Step 4: Implement `gradient-tool.ts`**

Import `setGradientMid` from `../doc/paint-edit`. Add to `Mode`: `| { kind: "mid"; base: Doc; h: GradientHandle }`.

`stopFor`'s parameter type becomes `Exclude<HandlePart, "line" | "mid">`.

At the top of `apply`, after the `draw` branch:

```ts
  if (m.kind === "mid") {
    // Spec M17 §6: project onto from→to (centre→A for a radial), whole percents, 1–99.
    const [p0, p1] = m.h.kind === "linear" ? [m.h.from, m.h.to] : [m.h.center, m.h.a];
    const d = sub(p1, p0);
    const dd = dot(d, d);
    if (dd === 0) return false;
    const t = dot(sub(e.doc, p0), d) / dd;
    const mid = Math.min(99, Math.max(1, Math.round(t * 100))) / 100;
    ctx.commit(setGradientMid(m.base, [m.h.id], which, mid));
    return true;
  }
```

In `move`'s pending branch, choose the mode:

```ts
          mode =
            pick.part === "mid"
              ? { kind: "mid", base: ctx.doc(), h: pick.h }
              : pick.part === "line" || pick.part === "center"
                ? { kind: "line", base: ctx.doc(), h: pick.h, start: start.doc }
                : { kind: "knob", base: ctx.doc(), h: pick.h, part: pick.part };
```

In `up`'s click branch: `if (m.pick && m.pick.part !== "line" && m.pick.part !== "mid") { …setGradientStop… }` (the following `if (m.pick) return;` already covers a diamond click).

In `up`'s commit branch, don't forget on a diamond drag — the geometry the memory guards did not change, and a kind switch keeps the current midpoint anyway:

```ts
      if (committed && m.kind !== "mid") {
        ctx.forgetGradients(m.kind === "draw" ? m.ids : [m.h.id], ctx.gradientTarget());
      }
```

(Update the comment above it: "…and never for a midpoint drag (spec M17 §6), which changes no geometry.")

Update the tool's `hint`: `"Drag across the selection to draw a gradient · drag a knob, the midpoint diamond or a line to adjust · Shift: 45°"`.

- [ ] **Step 5: Fix the existing tests that pressed a line at its middle**

Run: `npx vitest run src/__tests__/gradient-tool.test.ts`. For each failure where a press at a line's exact middle now yields `"mid"`, move the press to 25% along the line (see the note at the top of this task). Do not change expected results otherwise.

- [ ] **Step 6: Run everything**

Run: `npm test && npm run build`
Expected: all pass; 0 errors, 0 warnings. (The Overlay does not read `h.mid` yet — fine.)

- [ ] **Step 7: Commit**

```bash
git add src/tools/gradient-handles.ts src/tools/gradient-tool.ts src/__tests__/gradient-tool.test.ts
git commit -m "feat(M17): midpoint diamond — picked between knobs and lines, dragged along the line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Knob shapes and hover cursors

**Files:**
- Modify: `src/tools/tool.ts` (`ToolContext.setHoverCursor`)
- Modify: `src/tools/context.ts` (wire it)
- Modify: `src/__tests__/fake-context.ts` (record it)
- Modify: `src/state/appState.svelte.ts` (`hoverCursor` state, `setHoverCursor`, cleared in `setTool`)
- Modify: `src/lib/Canvas.svelte:72-78` (prefer `app.hoverCursor`)
- Modify: `src/tools/gradient-tool.ts` (`hover`, clear on `down`)
- Modify: `src/lib/Overlay.svelte:87-130, 210-262` (shapes, diamond)
- Test: `src/__tests__/gradient-tool.test.ts`, `src/__tests__/gradient-store.test.ts`

**Interfaces:**
- Consumes: `GradientHandle.mid`, `HandlePart` incl. `"mid"` (Task 4); `midStop` (Task 1).
- Produces: `ToolContext.setHoverCursor(c: string | null): void`; `app.hoverCursor: string | null`; exported `setHoverCursor(c: string | null): void` in the store; `FakeState.hoverCursor: string | null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/gradient-tool.test.ts`:

```ts
describe("hover cursors (spec M17 §6)", () => {
  const rad: RadialGradient = {
    kind: "radial",
    center: { x: 50, y: 25 },
    a: { x: 90, y: 25 },
    b: { x: 50, y: 45 },
    start: red,
    end: blue,
  };
  it("names each part's cursor and clears over nothing", () => {
    // "b"'s transform puts its radial's knobs at x 250–290 in document space.
    const { ctx, state } = fakeContext(
      doc([rect("a", 0, lin), rect("b", 0, rad, translate(200, 0))]),
    );
    state.selection = ["a"];
    const tool = createGradientTool();
    const at = (x: number, y: number) => {
      tool.hover!(ctx, ev(x, y));
      return state.hoverCursor;
    };
    expect(at(0, 25)).toBe("move");
    expect(at(100, 25)).toBe("move");
    expect(at(50, 25)).toBe("ew-resize");
    expect(at(20, 25)).toBe("move");
    expect(at(300, 300)).toBeNull();
    state.selection = ["b"];
    expect(at(250, 25)).toBe("move");
    expect(at(290, 25)).toBe("move");
    expect(at(250, 45)).toBe("grab");
  });

  it("a press clears the hover cursor", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    state.selection = ["a"];
    const tool = createGradientTool();
    tool.hover!(ctx, ev(50, 25));
    tool.down(ctx, ev(300, 300));
    expect(state.hoverCursor).toBeNull();
  });
});
```

Append to `src/__tests__/gradient-store.test.ts` (import `setHoverCursor`, `setTool`):

```ts
it("a tool change clears the hover cursor (spec M17 §6)", () => {
  setTool("gradient");
  setHoverCursor("grab");
  setTool("select");
  expect(app.hoverCursor).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/gradient-tool.test.ts src/__tests__/gradient-store.test.ts`
Expected: FAIL — no `hover` on the tool, no `hoverCursor`.

- [ ] **Step 3: Add the context slot**

`tool.ts`, at the end of `ToolContext`:

```ts
  /** A cursor for what is under a hovering pointer (spec M17 §6), shown in place of the tool's
   *  static `cursor`; null restores it. Desktop only in practice — touch has no hover. */
  setHoverCursor(c: string | null): void;
```

`appState.svelte.ts`: in `AppState`, beside `gradientStop`: `hoverCursor = $state<string | null>(null);`. Export:

```ts
export function setHoverCursor(c: string | null): void {
  if (app.hoverCursor !== c) app.hoverCursor = c;
}
```

and in `setTool`, after `app.overlay = null;`: `app.hoverCursor = null;`.

`context.ts`: import `setHoverCursor` and add `setHoverCursor,` to `storeContext` beside `forgetGradients`.

`fake-context.ts`: add `hoverCursor: string | null;` to `FakeState` (with a one-line comment), `hoverCursor: null,` to the initial state, and to `ctx`:

```ts
    setHoverCursor: (c) => {
      state.hoverCursor = c;
    },
```

`Canvas.svelte`, the `cursor` derived's last branch: `: (app.hoverCursor ?? TOOLS[app.toolId].cursor),`.

- [ ] **Step 4: The tool's hover**

In `gradient-tool.ts`, module level:

```ts
/** Spec M17 §6: what a press here would do. CSS has no rotate cursor, so rim B (rotate and scale)
 *  gets `grab`. */
const CURSORS: Record<HandlePart, string> = {
  start: "move",
  end: "move",
  center: "move",
  rimA: "move",
  line: "move",
  rimB: "grab",
  mid: "ew-resize",
};
```

In the tool object, add:

```ts
    hover(ctx, e) {
      const tol = pointerTolerance(e.pointerType) / ctx.view().zoom;
      const pick = pickHandle(handles(ctx), e.doc, tol);
      ctx.setHoverCursor(pick ? CURSORS[pick.part] : null);
    },
```

and as the first line of `down`: `ctx.setHoverCursor(null);` (the canvas does not call `hover` during a gesture, so a stale cursor would otherwise outlive the knob it named).

- [ ] **Step 5: Run the unit tests**

Run: `npx vitest run src/__tests__/gradient-tool.test.ts src/__tests__/gradient-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Draw the shapes in `Overlay.svelte`**

Import `midStop` from `../doc/document`. In `gradientView`, add to the linear return `mid: docToScreen(view, h.mid), midColor: midStop(h.start, h.end).color,` and to the radial return the same two fields.

Replace the gradient drawing block (`{#each gradientView as g, i (i)}` … `{/each}`) with the following. `r` is the knob radius used today; the order (end → start; B → A → centre) is unchanged, so the tie's winner stays on top; the diamond goes after the lines and before the knobs.

```svelte
  {#each gradientView as g, i (i)}
    {@const r = knobSize / 2 + 1}
    {@const w = (on: boolean) => (on ? 3 : 1.5)}
    {@const dm = r * 0.85}
    {#if g.kind === "linear"}
      <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} style={LINE} stroke-width="1" />
    {:else}
      <line x1={g.center.x} y1={g.center.y} x2={g.a.x} y2={g.a.y} style={LINE} stroke-width="1" />
      <line x1={g.center.x} y1={g.center.y} x2={g.b.x} y2={g.b.y} style={LINE} stroke-width="1" />
      <polygon points={points(g.rim)} style={LINE} stroke-width="1" stroke-dasharray="4 3" />
    {/if}
    <!-- Spec M17 §6: the midpoint diamond, filled with the 50/50 mix it stands for. Below the
         knobs, as `pickHandle` ranks it below them. -->
    <polygon
      points={points([
        { x: g.mid.x, y: g.mid.y - dm },
        { x: g.mid.x + dm, y: g.mid.y },
        { x: g.mid.x, y: g.mid.y + dm },
        { x: g.mid.x - dm, y: g.mid.y },
      ])}
      style="stroke: var(--color-accent); fill: {g.midColor}"
      stroke-width="1.5"
    />
    {#if g.kind === "linear"}
      <!-- Drawn end, then start (review finding 2): `pickHandle`'s tie order is start, end, so
           drawing in reverse puts the tie's winner, start, on top. Spec M17 §6: end is a square,
           start a circle. -->
      <rect
        x={g.b.x - r}
        y={g.b.y - r}
        width={r * 2}
        height={r * 2}
        style="stroke: var(--color-accent); fill: {g.end}"
        stroke-width={w(g.picked === "end")}
      />
      <circle
        cx={g.a.x}
        cy={g.a.y}
        {r}
        style="stroke: var(--color-accent); fill: {g.start}"
        stroke-width={w(g.picked === "start")}
      />
    {:else}
      <!-- Drawn B, then A, then centre (review finding 2): `pickHandle`'s tie order is centre, A,
           B. Spec M17 §6: B (rotate/scale) is a ring in the end colour over the accent, A
           (stretch) a square, the centre a circle. -->
      <circle
        cx={g.b.x}
        cy={g.b.y}
        {r}
        style="stroke: var(--color-accent); fill: none"
        stroke-width={w(g.picked === "end") + 2.5}
      />
      <circle
        cx={g.b.x}
        cy={g.b.y}
        {r}
        style="stroke: {g.end}; fill: none"
        stroke-width="2"
      />
      <rect
        x={g.a.x - r}
        y={g.a.y - r}
        width={r * 2}
        height={r * 2}
        style="stroke: var(--color-accent); fill: {g.end}"
        stroke-width={w(g.picked === "end")}
      />
      <circle
        cx={g.center.x}
        cy={g.center.y}
        {r}
        style="stroke: var(--color-accent); fill: {g.start}"
        stroke-width={w(g.picked === "start")}
      />
    {/if}
  {/each}
```

Update the `gradientView` doc comment: `Each knob is filled with its stop's colour so start and end are told apart at a glance, and shaped by its role (spec M17 §6) so the rims and the centre are too.`

- [ ] **Step 7: Build, lint, test**

Run: `npm run build && npm run lint && npm test`
Expected: 0 errors, 0 warnings; all pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools/tool.ts src/tools/context.ts src/__tests__/fake-context.ts src/state/appState.svelte.ts src/lib/Canvas.svelte src/tools/gradient-tool.ts src/lib/Overlay.svelte src/__tests__/gradient-tool.test.ts src/__tests__/gradient-store.test.ts
git commit -m "feat(M17): gradient knobs shaped by role, and per-part hover cursors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs

**Files:**
- Modify: `README.md` (the Gradients bullet ~89–95; the "Unplanned" line ~126 stays — "more gradient stops" is still unplanned)
- Modify: `CLAUDE.md` (architecture map, invariant 46, Current state, test counts under Commands)
- Modify: `docs/superpowers/CHANGELOG.md` (new M17 entry, appended)

- [ ] **Step 1: README**

In the Gradients bullet: after the knob description, add: "Knobs are shaped by what they do — a circle for the start or centre, a square for the end or the stretching rim, a ring for the rim that rotates and scales. A small diamond on the line is the **midpoint**, where the two colours mix 50/50: drag it, or use the Midpoint slider under the gradient's Start row, to push the blend toward one end. Three-stop gradients from other apps whose middle stop is that mix are read as a midpoint." Keep the bullet's existing sentences.

- [ ] **Step 2: CLAUDE.md**

- Architecture map: in `src/doc/` add `midOf`/`withMid`/`midStop` to `document.ts`'s list and `setGradientMid` to `paint-edit.ts`'s; in `src/lib/` add `MidpointRow.svelte` (slider + `%` field, the app's first range input) beside `PaintRow.svelte`.
- Invariant 46: append a paragraph: "**A midpoint is `mid?: number` (spec M17), absent at 0.5 and never stored there** — `withMid` deletes the key, as turning `hidden` off does (invariant 39); read it only through `midOf`. It is written as a third stop at `offset=mid` carrying `midStop(start, end)`, the **premultiplied** 50/50 mix (so a fade to transparent has no dark band), and read back from any 3-stop gradient whose middle stop matches that mix within ±1/255 per channel and 0.005 opacity — anything else with three or more stops still drops. It is a stop property, not geometry: bakes leave it alone, conversions and redraws keep it, a kind restore keeps the CURRENT one, and a diamond drag does not call `forgetGradients`."
- Current state: M17 done (midpoint + distinct handles); M14 still next.
- Commands: update the test count to the new `npm test` totals.

- [ ] **Step 3: CHANGELOG**

Append a dated `2026-09-27 — M17 gradient midpoint and distinct handles` entry: what shipped (midpoint model/file/import, Midpoint row, diamond, knob shapes, cursors), rulings (spec §8, plus: a diamond drag does not forget the Type-row memory; a press at a line's middle now grabs the diamond), and verification: what was checked in the browser, and owed: iPad pass for the slider's touch drag and the diamond's reach.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/CHANGELOG.md
git commit -m "docs(M17): README, CLAUDE.md invariant 46 and changelog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
