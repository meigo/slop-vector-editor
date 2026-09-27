# M18 Custom Midpoint Colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional custom colour for a gradient's middle stop (Auto = the computed mix), set from the panel or picked on the canvas, saved as the third stop, with every foreign 3-stop gradient now importable.

**Architecture:** `midPaint?: Paint` beside M17's `mid?: number`; readers use `midPaintOf`; `StopEnd` gains `"mid"` so the existing stop-editing path covers it; `setGradientMidAuto` toggles Auto; the importer's `outerStops` keeps any valid 3-stop gradient.

**Tech Stack:** Svelte 5, TypeScript, Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-27-m18-gradient-mid-colour-design.md`

## Global Constraints

- `midPaint` absent = Auto (middle stop = `midStop(start, end)`); `withMidPaint(g, undefined)` deletes the key. Readers use `midPaintOf(g)`; only `withMidPaint`, `sameFill`, the writer and pure carrying (passing `g.midPaint` into `withMidPaint`) touch the raw field.
- `mid` and `midPaint` are independent; M17's `withMid`/`midOf` rules are unchanged.
- Files with neither `mid` nor `midPaint` serialize **byte-identically** (two stops).
- `sameFill` compares the raw field (absent ≠ present, else `samePaint`); `sameColours` compares `midPaintOf`.
- `StopEnd = "start" | "mid" | "end"` (name kept).
- Import: 3 stops with the middle strictly inside and not rounding onto an outer offset → kept; matches `midStop` within ±1/255 per channel and 0.005 opacity → Auto, else `midPaint` = that stop. 4+ stops → drop label **"gradients with more than three stops"**. All other labels unchanged.
- Invariants: same reference for no-op edits (1); tools never import the store (12); drawing and hit-testing share handle geometry (14); a store document edit calls `cancelActiveGesture()` first (15); live UI drags are one document gesture closed on change/blur/destroy (42); controls use `var(--ctl-h)` (23).
- Build bar: `npm run build` 0 errors 0 warnings; `npm test` green; `npm run lint` clean.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The user's case**: black → transparent black radial with a custom black middle stop at 70% must hold solid black to 70% — i.e. export writes `offset="0.7" stop-color="#000000"` at full opacity. Test in Task 2.
2. **Editing Start on an Auto gradient moves its middle; on a custom one it doesn't.** Test in Task 1.
3. **A foreign 3-colour gradient that M17 dropped now imports**, and old tests asserting that drop are updated rather than deleted. Task 2.
4. **Turning Auto off changes nothing visible** (seeded with the mix) and is one undo step. Tasks 1 and 3.
5. **A click on the diamond picks the middle stop and never changes Auto**; a drag still moves it. Task 4.

---

### Task 1: Model — `midPaint`, `midPaintOf`, `withMidPaint`, `"mid"` stop, `setGradientMidAuto`

**Files:**
- Modify: `src/doc/document.ts` (gradient types; helpers after `withMid`; `sameFill`; `sameColours`)
- Modify: `src/doc/paint-edit.ts` (`StopEnd`, a `carry` helper, `toRadial`, `toLinear`, `restored`, `convertOrRestore`, `setGradientGeometry`, `drawGradientLine`, `setGradientStop`, new `setGradientMidAuto`)
- Test: `src/__tests__/gradient-model.test.ts`, `src/__tests__/paint-edit.test.ts`

**Interfaces:**
- Produces (document.ts): `midPaint?: Paint` on both gradient types; `midPaintOf(g: Gradient): Paint`; `withMidPaint<G extends Gradient>(g: G, p: Paint | undefined): G`.
- Produces (paint-edit.ts): `StopEnd = "start" | "mid" | "end"`; `setGradientStop(doc, ids, which, "mid", paint)` sets `midPaint`; `setGradientMidAuto(doc: Doc, ids: readonly string[], which: PaintSlot, auto: boolean): Doc`.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/gradient-model.test.ts` (add `midPaintOf`, `withMidPaint` to the `../doc/document` import):

```ts
describe("custom midpoint colour model (spec M18 §2)", () => {
  const red = { color: "#ff0000", opacity: 1 };
  const blue = { color: "#0000ff", opacity: 1 };
  const black = { color: "#000000", opacity: 1 };
  const g = {
    kind: "linear" as const,
    from: { x: 0, y: 0 },
    to: { x: 10, y: 0 },
    start: red,
    end: blue,
  };

  it("midPaintOf is the mix when absent and the custom paint when present", () => {
    expect(midPaintOf(g)).toEqual({ color: "#800080", opacity: 1 });
    expect(midPaintOf({ ...g, midPaint: black })).toEqual(black);
  });

  it("withMidPaint sets it and deletes the key for undefined", () => {
    expect(withMidPaint(g, black).midPaint).toEqual(black);
    expect("midPaint" in withMidPaint({ ...g, midPaint: black }, undefined)).toBe(false);
  });

  it("sameFill compares the raw field; sameColours the effective colour", () => {
    const mix = { color: "#800080", opacity: 1 };
    expect(sameFill(g, { ...g, midPaint: black })).toBe(false);
    expect(sameFill({ ...g, midPaint: black }, { ...g, midPaint: { ...black } })).toBe(true);
    expect(sameFill(g, { ...g, midPaint: mix })).toBe(false);
    expect(sameColours(g, { ...g, midPaint: mix })).toBe(true);
    expect(sameColours(g, { ...g, midPaint: black })).toBe(false);
  });

  it("mapStyle keeps midPaint through a bake", () => {
    const s = { ...DEFAULT_STYLE, fill: { ...g, midPaint: black } };
    const out = mapStyle(s, [2, 0, 0, 2, 5, 5]);
    expect((out.fill as typeof g & { midPaint?: unknown }).midPaint).toEqual(black);
  });
});
```

Append to `src/__tests__/paint-edit.test.ts` inside a new describe (reuse the `docWith` / `fillA` helpers that the M17 "midpoint edits" describe defines — if they are local to that describe, copy them into the new one; add `setGradientStop`, `setGradientMidAuto`, `midPaintOf` imports as needed):

```ts
describe("custom midpoint colour edits (spec M18 §2)", () => {
  const red = { color: "#ff0000", opacity: 1 };
  const blue = { color: "#0000ff", opacity: 1 };
  const black = { color: "#000000", opacity: 1 };
  const lin: LinearGradient = {
    kind: "linear",
    from: { x: 0, y: 5 },
    to: { x: 10, y: 5 },
    start: red,
    end: blue,
  };

  it("setGradientStop 'mid' stores a custom colour; same doc when unchanged", () => {
    const d0 = docWith(lin);
    const d1 = setGradientStop(d0, ["a"], "fill", "mid", black);
    expect(fillA(d1).midPaint).toEqual(black);
    expect(setGradientStop(d1, ["a"], "fill", "mid", { ...black })).toBe(d1);
  });

  it("Auto follows a Start edit; a custom colour stays put (Review Focus 2)", () => {
    const auto = setGradientStop(docWith(lin), ["a"], "fill", "start", { color: "#ffffff", opacity: 1 });
    expect(midPaintOf(fillA(auto))).toEqual({ color: "#8080ff", opacity: 1 });
    const custom = setGradientStop(
      docWith({ ...lin, midPaint: black }),
      ["a"],
      "fill",
      "start",
      { color: "#ffffff", opacity: 1 },
    );
    expect(midPaintOf(fillA(custom))).toEqual(black);
  });

  it("setGradientMidAuto(false) seeds the mix; (true) drops it; no-ops keep the doc (Review Focus 4)", () => {
    const d0 = docWith(lin);
    const off = setGradientMidAuto(d0, ["a"], "fill", false);
    expect(fillA(off).midPaint).toEqual({ color: "#800080", opacity: 1 });
    expect(setGradientMidAuto(off, ["a"], "fill", false)).toBe(off);
    const custom = docWith({ ...lin, midPaint: black });
    expect(setGradientMidAuto(custom, ["a"], "fill", false)).toBe(custom);
    const on = setGradientMidAuto(custom, ["a"], "fill", true);
    expect("midPaint" in fillA(on)).toBe(false);
    expect(setGradientMidAuto(d0, ["a"], "fill", true)).toBe(d0);
    expect(setGradientMidAuto(docWith(red), ["a"], "fill", false)).toEqual(docWith(red));
  });

  it("conversions, redraw and geometry keep midPaint", () => {
    const g = { ...lin, midPaint: black, mid: 0.7 };
    expect(toRadial(g).midPaint).toEqual(black);
    expect(toLinear(toRadial(g)).midPaint).toEqual(black);
    expect(toLinear(toRadial(g)).mid).toBe(0.7);
    const d0 = docWith(g);
    expect(fillA(drawGradientLine(d0, ["a"], "fill", { x: 0, y: 0 }, { x: 9, y: 9 })).midPaint).toEqual(black);
    expect(fillA(setGradientGeometry(d0, "a", "fill", { ...lin, to: { x: 8, y: 5 } })).midPaint).toEqual(black);
  });

  it("a kind restore keeps the CURRENT midPaint; Flat → gradient restores the remembered one", () => {
    const white = { color: "#ffffff", opacity: 1 };
    const remembered = { g: { ...lin, midPaint: white } as Gradient, box: { x: 0, y: 0, w: 10, h: 10 } };
    const asRadial = convertGradients(docWith(lin), ["a"], "fill", "radial");
    const edited = setGradientStop(asRadial, ["a"], "fill", "mid", black);
    const back = convertGradients(edited, ["a"], "fill", "linear", () => remembered);
    expect(fillA(back).midPaint).toEqual(black);
    const fromFlat = setPaintKind(docWith(red), ["a"], "fill", "linear", () => remembered);
    expect(fillA(fromFlat).midPaint).toEqual(white);
  });
});
```

(The `setGradientMidAuto(docWith(red)…)` line checks flat paints are untouched; compare with `.toBe(d)` on the same doc instance instead if you bind it to a variable — prefer that.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/gradient-model.test.ts src/__tests__/paint-edit.test.ts`
Expected: FAIL — `midPaintOf`, `withMidPaint`, `setGradientMidAuto` not exported; `"mid"` not a `StopEnd`.

- [ ] **Step 3: `src/doc/document.ts`**

Add `midPaint?: Paint;` after `mid?: number;` on both `LinearGradient` and `RadialGradient`; extend the `mid` doc line: `` `midPaint` (spec M18 §2): a custom middle-stop colour; absent = Auto, the mix. ``

After `withMid`, add:

```ts
/** Spec M18 §2: the colour the middle stop actually has — the custom one, or the mix (Auto). */
export const midPaintOf = (g: Gradient): Paint => g.midPaint ?? midStop(g.start, g.end);

/** `g` with a custom middle colour, or Auto again for `undefined` (the key is deleted, as
 *  `withMid` deletes a 50% midpoint — one representation per state, invariants 1 and 39). */
export function withMidPaint<G extends Gradient>(g: G, p: Paint | undefined): G {
  const out = { ...g };
  delete out.midPaint;
  if (p !== undefined) out.midPaint = p;
  return out;
}
```

(`midStop` is declared further down as a `function`, so it is hoisted; if lint complains about use-before-define, move these two below `midStop`.)

In `sameFill`, add to the gradient return: `&& sameMidPaint(a.midPaint, b.midPaint)` with, above `sameFill`:

```ts
const sameMidPaint = (a: Paint | undefined, b: Paint | undefined) =>
  a === undefined || b === undefined ? a === b : samePaint(a, b);
```

In `sameColours`, the gradient return becomes:

```ts
    return (
      samePaint(a.start, b.start) &&
      samePaint(a.end, b.end) &&
      samePaint(midPaintOf(a), midPaintOf(b))
    );
```

and its doc comment gains: `` Spec M18 §2: the middle stop compares by its EFFECTIVE colour (`midPaintOf`) — what the user sees. ``

- [ ] **Step 4: `src/doc/paint-edit.ts`**

`export type StopEnd = "start" | "mid" | "end";` with comment `/** Spec M18 §2: "mid" is the middle stop (its colour is `midPaint`). */`.

Import `withMidPaint`, `midStop` from `./document`. Below `convertKind`, add:

```ts
/** The stop properties that ride along whenever a gradient is rebuilt from its geometry: the
 *  midpoint (M17) and the middle colour (M18). */
type StopProps = { mid?: number; midPaint?: Paint };
const carry = <G extends Gradient>(g: G, src: StopProps): G =>
  withMidPaint(withMid(g, src.mid), src.midPaint);
```

Replace:
- `toRadial`: `return withMid({ …literal… }, g.mid);` → `return carry({ …literal… }, g);`
- `toLinear`: `withMid({ kind: "linear", … }, g.mid)` → `carry({ kind: "linear", … }, g)`
- `restored`: replace the `mid: number | undefined = r.g.mid` parameter with `props: StopProps = r.g`, and both `withMid(…, mid)` calls with `carry(…, props)`. Doc comment: "…and, likewise, the CURRENT midpoint and middle colour (spec M17 §2, M18 §2: stop properties)."
- `convertOrRestore`: `restored(r, box, f.start, f.end, f)`.
- `setGradientGeometry`: `withMid({ ...next, start: f.start, end: f.end }, f.mid)` → `carry({ ...next, start: f.start, end: f.end }, f)`.
- `drawGradientLine`: `const mid = isGradient(f) ? f.mid : undefined;` → `const props: StopProps = isGradient(f) ? f : {};` and `withMid(next, mid)` → `carry(next, props)`.

`setGradientStop`'s body:

```ts
    if (!isGradient(f)) return s;
    // Spec M18 §2: the middle stop's colour lives in `midPaint`.
    return withFill(s, which, stop === "mid" ? withMidPaint(f, paint) : { ...f, [stop]: paint });
```

Add after `setGradientMid`:

```ts
/** Spec M18 §2: Auto on drops every selected gradient's custom middle colour; Auto off gives the
 *  ones without one their current mix, so turning it off changes nothing visible. */
export function setGradientMidAuto(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  auto: boolean,
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    if (!isGradient(f)) return s;
    if (auto) return withFill(s, which, withMidPaint(f, undefined));
    return f.midPaint ? s : withFill(s, which, withMidPaint(f, midStop(f.start, f.end)));
  });
}
```

- [ ] **Step 5: Fix type fallout**

`StopEnd` widened: run `npx tsc --noEmit`. `gradient-tool.ts`'s `stopFor` returns `StopEnd` — still fine. `PaintField.svelte`'s `STOPS: readonly StopEnd[] = ["start", "end"]` is fine. Fix only what breaks; Tasks 3–4 change the UI.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/__tests__/gradient-model.test.ts src/__tests__/paint-edit.test.ts` → PASS; then `npm test && npx tsc --noEmit && npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add src/doc/document.ts src/doc/paint-edit.ts src/__tests__/gradient-model.test.ts src/__tests__/paint-edit.test.ts
git commit -m "feat(M18): custom midpoint colour model — midPaint, midPaintOf, setGradientMidAuto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: File format — write a custom middle stop, import every valid 3-stop gradient

**Files:**
- Modify: `src/svg/attrs.ts` (`gradientDefs`'s `stops`)
- Modify: `src/svg/gradient-import.ts` (`Outer`, `outerStops`, both folds' `withMid` wrap)
- Test: `src/__tests__/gradient-import.test.ts`, `src/__tests__/gradient-roundtrip.test.ts`, plus any existing test whose expectation this changes

**Interfaces:**
- Consumes: `midOf`, `midPaintOf`, `withMid`, `withMidPaint`, `midStop` (document.ts).

Behaviour change: a 3-stop gradient whose middle stop is NOT the mix used to drop ("gradients with more than two stops"); it now imports with `midPaint`. Four or more stops now drop as "gradients with more than three stops". Update every existing test that asserted the old outcome for those inputs (M15/M16/M17 tests in `gradient-import.test.ts`, `gradient-roundtrip.test.ts`, `parse*.test.ts` — grep for `more than two stops`). Keep each test's intent: a test that meant "we can't represent this" should move to a 4-stop input; a test that meant "a real three-colour gradient" should now assert it is kept with the right `midPaint`. Never delete a test to make the suite pass.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/gradient-import.test.ts` (it has `linear`, `foldOk`, `box`, `view`, `radial` helpers from M17; reuse its `three(...)` helper if it is in scope, else copy it):

```ts
describe("custom middle colour import (spec M18 §3)", () => {
  const three = (mid: string, midColour: string, midOpacity = "1") =>
    `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">` +
    `<stop offset="0" stop-color="#ff0000"/>` +
    `<stop offset="${mid}" stop-color="${midColour}" stop-opacity="${midOpacity}"/>` +
    `<stop offset="1" stop-color="#0000ff"/></linearGradient>`;

  it("keeps a real three-colour gradient, with the middle stop as midPaint (Review Focus 3)", () => {
    const f = foldOk(linear(three("0.5", "#ffffff")));
    expect(f.midPaint).toEqual({ color: "#ffffff", opacity: 1 });
    expect("mid" in f).toBe(false);
    const g = foldOk(linear(three("0.3", "#00ff00", "0.4")));
    expect(g.mid).toBeCloseTo(0.3, 12);
    expect(g.midPaint).toEqual({ color: "#00ff00", opacity: 0.4 });
  });

  it("still reads the mix within tolerance as Auto", () => {
    expect("midPaint" in foldOk(linear(three("0.3", "#7f0081")))).toBe(false);
    expect(foldOk(linear(three("0.3", "#820080"))).midPaint).toEqual({
      color: "#820080",
      opacity: 1,
    });
  });

  it("drops four stops with the new label", () => {
    const defs =
      `<linearGradient id="g"><stop offset="0" stop-color="#ff0000"/>` +
      `<stop offset="0.3" stop-color="#ffffff"/><stop offset="0.6" stop-color="#000000"/>` +
      `<stop offset="1" stop-color="#0000ff"/></linearGradient>`;
    expect(foldLinear(linear(defs), box, view, 1)).toEqual({
      kind: "drop",
      label: "gradients with more than three stops",
    });
  });

  it("keeps a radial's custom middle colour", () => {
    const defs =
      `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="40">` +
      `<stop offset="0" stop-color="#000000"/><stop offset="0.7" stop-color="#000000"/>` +
      `<stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient>`;
    const f = foldRadial(radial(defs), box, view, 1);
    if (f.kind !== "fill" || !isRadial(f.fill)) throw new Error(JSON.stringify(f));
    expect(f.fill.mid).toBeCloseTo(0.7, 12);
    expect(f.fill.midPaint).toEqual({ color: "#000000", opacity: 1 });
  });
});
```

Append to `src/__tests__/gradient-roundtrip.test.ts` inside (or beside) the M17 "midpoint round trip" describe, reusing its `withFill`, `lin`, `rad`, `shapesOf`:

```ts
describe("custom middle colour round trip (spec M18 §3)", () => {
  it("the user's case: black held to 70% then fading (Review Focus 1)", () => {
    const g: RadialGradient = {
      ...rad,
      start: { color: "#000000", opacity: 1 },
      end: { color: "#000000", opacity: 0 },
      mid: 0.7,
      midPaint: { color: "#000000", opacity: 1 },
    };
    const text = serializeDoc(withFill(g));
    expect(text).toContain('<stop offset="0.7" stop-color="#000000"/>');
    const f = shapesOf(parseSvg(text).doc)[0].style.fill;
    if (!isRadial(f)) throw new Error("radial expected");
    expect(f.mid).toBe(0.7);
    expect(f.midPaint).toEqual({ color: "#000000", opacity: 1 });
  });

  it("round-trips a custom colour at 50% (no mid key) for both kinds, native, nothing dropped", () => {
    const white = { color: "#ffffff", opacity: 0.5 };
    for (const g of [{ ...lin, midPaint: white }, { ...rad, midPaint: white }]) {
      const text = serializeDoc(withFill(g));
      expect(text).toContain('offset="0.5" stop-color="#ffffff" stop-opacity="0.5"');
      const r = parseSvg(text);
      expect(r.dropped).toEqual([]);
      const f = shapesOf(r.doc)[0].style.fill;
      if (!isGradient(f)) throw new Error("gradient expected");
      expect(f.midPaint).toEqual(white);
      expect("mid" in f).toBe(false);
      expect(serializeDoc(r.doc)).toBe(text);
    }
  });

  it("writes exactly two stops with neither mid nor midPaint", () => {
    expect(serializeDoc(withFill(lin)).match(/<stop /g)).toHaveLength(2);
  });
});
```

(Use whatever field names/`id` the M17 round-trip describe in the file already uses for `parseSvg`'s result.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/__tests__/gradient-import.test.ts src/__tests__/gradient-roundtrip.test.ts` — Expected: FAIL.

- [ ] **Step 3: Export (`src/svg/attrs.ts`)**

Import `midOf`, `midPaintOf` (keep `midStop` only if still used). Replace the `stops` expression:

```ts
    // Spec M17 §3, M18 §3: a midpoint or a custom middle colour is a third stop; neither, and
    // the output is exactly the two stops written before M17.
    const stops =
      f.mid === undefined && f.midPaint === undefined
        ? [stopAttrs("0", f.start), stopAttrs("1", f.end)]
        : [
            stopAttrs("0", f.start),
            stopAttrs(fmt(midOf(f)), midPaintOf(f)),
            stopAttrs("1", f.end),
          ];
```

- [ ] **Step 4: Import (`src/svg/gradient-import.ts`)**

`Outer` gains `midPaint: Paint | undefined` (set `undefined` in the 2-stop return). In `outerStops`:
- `if (raw.length !== 3) return more;` → `if (raw.length > 3) return { drop: "gradients with more than three stops" };` (0/1 stops never reach here; keep a `raw.length !== 3` → `more` guard after it for safety only if the type-checker needs it).
- Replace `if (!isMidStop(stops[1], midStop(stops[0], stops[2]))) return more;` with nothing, and in the final return add `midPaint: isMidStop(stops[1], midStop(stops[0], stops[2])) ? undefined : stops[1],`.
- Update the doc comment: `Spec M18 §3: any third, middle stop is kept — as Auto when it is the mix, else as the custom middle colour.`

In both folds, wrap the existing `withMid(…, outer.mid)` in `withMidPaint(…, outer.midPaint)` (import it). Update both folds' doc-comment M17 line to also say "any other middle stop is kept as `midPaint` (spec M18 §3)".

- [ ] **Step 5: Update the existing tests the behaviour change breaks**

Run `npm test`; for every failure caused by 3-stop inputs now being kept or 4-stop inputs getting the new label, update per the note at the top of this task, and list each changed test with before/after in your report.

- [ ] **Step 6: Run everything** — `npm test && npx tsc --noEmit && npm run lint` all clean.

- [ ] **Step 7: Commit**

```bash
git add src/svg/attrs.ts src/svg/gradient-import.ts src/__tests__/
git commit -m "feat(M18): save a custom middle stop; import every valid three-stop gradient

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The panel — Auto toggle and Mid colour row

**Files:**
- Modify: `src/state/properties.ts` (`GradientSummary`, `summarizeGradient`)
- Modify: `src/state/appState.svelte.ts` (import `setGradientMidAuto as applyGradientMidAuto`; new `setSelectionGradientMidAuto`)
- Modify: `src/lib/MidpointRow.svelte` (Auto toggle; `%` field `w-16` → `w-12`)
- Modify: `src/lib/PaintField.svelte` (props; the Mid colour row)
- Modify: `src/lib/PropertiesPanel.svelte` (wire both PaintFields)
- Test: `src/__tests__/properties.test.ts`, `src/__tests__/gradient-store.test.ts`

**Interfaces:**
- Consumes: `midPaintOf`, `setGradientMidAuto`, `StopEnd` incl. `"mid"` (Task 1).
- Produces: `GradientSummary.midAuto: Field<boolean> | null`, `GradientSummary.midPaint: Field<Paint> | null`; `setSelectionGradientMidAuto(which: PaintSlot, auto: boolean): void`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/properties.test.ts`: existing whole-object `summarizeGradient` `toEqual` expectations gain `midAuto` and `midPaint` — `midAuto: { mixed: false, value: true }` and `midPaint: { mixed: false, value: <midStop of that fixture's start/end> }` where `stops` is non-null (for the red→blue fixture that is `{ color: "#800080", opacity: 1 }`), both `null` where `stops` is `null`. Then append inside `describe("summarizeGradient", …)`:

```ts
  it("merges Auto and the effective middle colour (spec M18 §4)", () => {
    const g = {
      kind: "linear" as const,
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      start: { color: "#ff0000", opacity: 1 },
      end: { color: "#0000ff", opacity: 1 },
    };
    const black = { color: "#000000", opacity: 1 };
    const s = (fill: Style["fill"]): Style => ({ ...DEFAULT_STYLE, fill });
    const both = summarizeGradient([s({ ...g, midPaint: black }), s({ ...g, midPaint: black })], "fill");
    expect(both?.midAuto).toEqual({ mixed: false, value: false });
    expect(both?.midPaint).toEqual({ mixed: false, value: black });
    const mixed = summarizeGradient([s({ ...g, midPaint: black }), s(g)], "fill");
    expect(mixed?.midAuto).toEqual({ mixed: true });
    expect(mixed?.midPaint).toEqual({ mixed: true });
  });
```

Append to `src/__tests__/gradient-store.test.ts` (import `setSelectionGradientMidAuto`; reuse the M17 describe's `beforeEach` shape):

```ts
describe("middle colour actions (spec M18 §4)", () => {
  beforeEach(() => {
    replaceDocument(makeDoc(), "t.svg", null);
    setSelection(["a"]);
    setSelectionPaintKind("fill", "linear");
  });

  it("Auto off seeds the mix in one undo step; Auto on drops it (Review Focus 4)", () => {
    const before = styleOf("a").fill;
    setSelectionGradientMidAuto("fill", false);
    expect((styleOf("a").fill as { midPaint?: unknown }).midPaint).toBeDefined();
    undo();
    expect(styleOf("a").fill).toBe(before);
    setSelectionGradientMidAuto("fill", false);
    setSelectionGradientMidAuto("fill", true);
    expect("midPaint" in (styleOf("a").fill as object)).toBe(false);
  });

  it("editing the mid stop stores a custom colour", () => {
    setSelectionGradientStop("fill", "mid", { color: "#000000", opacity: 1 });
    expect((styleOf("a").fill as { midPaint?: unknown }).midPaint).toEqual({
      color: "#000000",
      opacity: 1,
    });
  });
});
```

(Match `replaceDocument`'s argument order to the file's existing calls.)

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/__tests__/properties.test.ts src/__tests__/gradient-store.test.ts`.

- [ ] **Step 3: `properties.ts`**

```ts
export type GradientSummary = {
  kind: Field<"flat" | "linear" | "radial">;
  stops: { start: Field<Paint>; end: Field<Paint> } | null;
  /** Spec M17 §5: null exactly when `stops` is. */
  mid: Field<number> | null;
  /** Spec M18 §4: whether the middle stop is Auto, and its effective colour; null with `stops`. */
  midAuto: Field<boolean> | null;
  midPaint: Field<Paint> | null;
};
```

In `summarizeGradient` (import `midPaintOf`):

```ts
  const midAuto = stops ? merge(grads.map((g) => g.midPaint === undefined)) : null;
  const midPaint = stops ? merge(grads.map(midPaintOf), samePaint) : null;
  return { kind, stops, mid, midAuto, midPaint };
```

(`g.midPaint === undefined` is a presence check — permitted carrying/inspection of the raw field for the Auto flag itself.)

- [ ] **Step 4: Store action** (`appState.svelte.ts`, after `setSelectionGradientMid`):

```ts
/** Spec M18 §4: the Midpoint row's Auto toggle. Off seeds the current mix, so nothing visibly
 *  changes; on drops the custom colours. One commit, one undo step. */
export function setSelectionGradientMidAuto(which: PaintSlot, auto: boolean): void {
  cancelActiveGesture();
  if (app.selection.length === 0) return;
  commitDoc(applyGradientMidAuto(app.doc, app.selection, which, auto));
}
```

- [ ] **Step 5: Unit tests pass** — rerun Step 2's command.

- [ ] **Step 6: `MidpointRow.svelte`**

Add props `auto: Field<boolean>` and `onauto: (auto: boolean) => void` (import `ToggleButton`). Change the `%` wrapper `w-16` → `w-12`. After it, inside the row:

```svelte
  <!-- Spec M18 §4: Auto = the middle stop is the computed mix. Pressing it on drops any custom
       colour; off seeds the mix, so the artwork doesn't change until a colour is picked. -->
  <ToggleButton
    label="Auto"
    ariaLabel="{label} middle colour automatic"
    title="Middle colour — Auto mixes Start and End; off keeps a colour of its own"
    value={auto.mixed ? "mixed" : auto.value}
    onchange={() => onauto(auto.mixed ? true : !auto.value)}
  />
```

Update the row's `title` to `"Midpoint — where the middle stop sits"`.

- [ ] **Step 7: `PaintField.svelte`**

New props (typed and destructured beside `mid`/`onmid`):

```ts
    /** Spec M18 §4: null exactly when `mid` is. */
    midAuto?: Field<boolean> | null;
    midPaint?: Field<Paint> | null;
    onmidauto?: (auto: boolean) => void;
```

with defaults `null`. `picked` stays `StopEnd | null` (now possibly `"mid"`). Replace the `{#if stop === "end" && mid && onmid}` block with:

```svelte
      {#if stop === "end" && mid && onmid && midAuto && onmidauto}
        <MidpointRow {label} {mid} {onmid} auto={midAuto} onauto={onmidauto} {onlivestart} {onliveend} />
        {#if midPaint && !midPaint.mixed}
          <!-- Spec M18 §4: the middle stop's EFFECTIVE colour, like the Start/End rows. Editing it
               stores a custom colour, which turns Auto off by itself. -->
          <div class="flex items-center gap-2">
            <span class="w-9 shrink-0"></span>
            <PaintRow
              label={`${label} middle`}
              paint={midPaint.value}
              selected={picked === "mid"}
              onchange={(p) => onstop("mid", p)}
              {onlivestart}
              {onliveend}
            />
          </div>
        {/if}
      {/if}
```

- [ ] **Step 8: `PropertiesPanel.svelte`** — on the Fill `PaintField` add `midAuto={fillGrad?.midAuto ?? null}`, `midPaint={fillGrad?.midPaint ?? null}`, `onmidauto={(a) => setSelectionGradientMidAuto("fill", a)}`; the same for Stroke with `strokeGrad` and `"stroke"`. Import `setSelectionGradientMidAuto`.

- [ ] **Step 9: Verify** — `npm run build && npm run lint && npm test`, all clean.

- [ ] **Step 10: Commit**

```bash
git add src/state/properties.ts src/state/appState.svelte.ts src/lib/MidpointRow.svelte src/lib/PaintField.svelte src/lib/PropertiesPanel.svelte src/__tests__/properties.test.ts src/__tests__/gradient-store.test.ts
git commit -m "feat(M18): Auto toggle and Mid colour row in the gradient rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The canvas — diamond shows and picks the middle stop

**Files:**
- Modify: `src/tools/gradient-handles.ts` (`GradientHandle.midPaint`)
- Modify: `src/tools/gradient-tool.ts` (`stopFor`, `up`'s click branch)
- Modify: `src/lib/Overlay.svelte` (diamond fill and picked emphasis)
- Test: `src/__tests__/gradient-tool.test.ts`

**Interfaces:**
- Consumes: `midPaintOf` (Task 1), `StopEnd` incl. `"mid"`.
- Produces: `GradientHandle.midPaint: Paint` (effective) on both variants.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/gradient-tool.test.ts` (uses `red`, `blue`, `lin`, `rect`, `doc`, `fillOf`, `drag`, `ev`, `fakeContext`):

```ts
describe("middle stop on the canvas (spec M18 §5)", () => {
  it("the handle carries the effective middle colour", () => {
    const black = { color: "#000000", opacity: 1 };
    const [auto] = gradientHandles(doc([rect("a", 0, lin)]), ["a"], "fill");
    expect(auto.midPaint).toEqual({ color: "#800080", opacity: 1 });
    const [custom] = gradientHandles(doc([rect("a", 0, { ...lin, midPaint: black })]), ["a"], "fill");
    expect(custom.midPaint).toEqual(black);
  });

  it("a click on the diamond picks the middle stop and leaves Auto alone (Review Focus 5)", () => {
    const d0 = doc([rect("a", 0, lin)]);
    const { ctx, state } = fakeContext(d0);
    state.selection = ["a"];
    const tool = createGradientTool();
    tool.down(ctx, ev(50, 25));
    tool.up(ctx, ev(50, 25));
    expect(ctx.gradientStop()).toEqual({ id: "a", stop: "mid", which: "fill" });
    expect(ctx.doc()).toBe(d0);
  });

  it("a drag on the diamond still moves it rather than picking", () => {
    const { ctx, state } = fakeContext(doc([rect("a", 0, lin)]));
    state.selection = ["a"];
    drag(createGradientTool(), ctx, [
      [50, 25],
      [30, 25],
    ]);
    expect((fillOf(ctx.doc(), "a") as LinearGradient).mid).toBe(0.3);
    expect(ctx.gradientStop()).toBeNull();
  });
});
```

(M17's test "a cancelled diamond drag restores the document; a click on it picks no stop" asserts `gradientStop()` is null after a diamond click — that expectation is now wrong per spec M18 §5; change it to expect `{ id: "a", stop: "mid", which: "fill" }` and keep its cancel half. Report the change.)

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/__tests__/gradient-tool.test.ts`.

- [ ] **Step 3: `gradient-handles.ts`** — import `midPaintOf`; add `midPaint: Paint;` to both variants (comment: `/** Spec M18 §5: the diamond's colour — custom, or the mix. */` on the first); in both pushes add `midPaint: midPaintOf(f),`.

- [ ] **Step 4: `gradient-tool.ts`**

```ts
/** A tap's part maps onto the stop it picks (spec M16 §6, M18 §5): the centre is the start of a
 *  linear drag too, both rims read like a linear drag's end, and the diamond is the middle stop. */
function stopFor(part: Exclude<HandlePart, "line">): StopEnd {
  return part === "mid" ? "mid" : part === "center" || part === "start" ? "start" : "end";
}
```

In `up`'s click branch: `if (m.pick && m.pick.part !== "line" && m.pick.part !== "mid") {` → `if (m.pick && m.pick.part !== "line") {`.

- [ ] **Step 5: `Overlay.svelte`** — in `gradientView`, replace both `midColor: midStop(h.start, h.end).color,` with `midColor: h.midPaint.color,` (drop the now-unused `midStop` import). On the diamond `<polygon>`, change `stroke-width="1.5"` to `stroke-width={w(g.picked === "mid")}`. (`w` and `picked` are already in scope there; if `w` is defined after the diamond in the `{@const}` list, it is still in scope — `{@const}` declarations at the top of the `{#each}` block.)

- [ ] **Step 6: Verify** — `npx vitest run src/__tests__/gradient-tool.test.ts`, then `npm run build && npm run lint && npm test`.

- [ ] **Step 7: Commit**

```bash
git add src/tools/gradient-handles.ts src/tools/gradient-tool.ts src/lib/Overlay.svelte src/__tests__/gradient-tool.test.ts
git commit -m "feat(M18): the diamond shows and picks the middle stop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs

**Files:** `README.md` (Gradients bullet; `npm test` count), `CLAUDE.md` (architecture map: `midPaintOf`/`withMidPaint`, `setGradientMidAuto`, `MidpointRow`'s Auto toggle; invariant 46's M17 paragraph extended for `midPaint`; Current state M18; Commands test count), `docs/superpowers/CHANGELOG.md` (append a dated M18 entry: what shipped, spec §7 rulings plus controller rulings, browser verification and what's owed).

- [ ] **Step 1:** README Gradients bullet: after the midpoint sentence add "Its colour is automatic — the mix of the two ends — until you give it one: edit the Mid colour row (or click the diamond to pick it), and a colour can hold its strength out to the diamond before fading. Auto puts the mix back. Three-colour gradients from other apps now open with their middle colour instead of being dropped." Also correct the import sentence ("two stops, or three where…") to "two or three stops".
- [ ] **Step 2:** CLAUDE.md as listed above; in invariant 46 append: "**A custom middle colour is `midPaint?: Paint` (spec M18)** — absent is Auto (`midStop`), read through `midPaintOf`, set through `withMidPaint` (deletes on `undefined`). Independent of `mid`. A stop property like the ends: Auto follows Start/End edits, a custom colour does not; conversions, redraws and kind restores keep the current one. `sameFill` compares the raw field, `sameColours` the effective colour. Export writes three stops when either `mid` or `midPaint` is set; import keeps every 3-stop gradient with its middle strictly inside, reading the mix within tolerance as Auto; four or more stops drop as \"gradients with more than three stops\". `StopEnd` includes `\"mid\"`, so the diamond's click picks the middle stop."
- [ ] **Step 3:** CHANGELOG entry.
- [ ] **Step 4:** Commit `docs(M18): README, CLAUDE.md invariant 46 and changelog` with the trailer.
