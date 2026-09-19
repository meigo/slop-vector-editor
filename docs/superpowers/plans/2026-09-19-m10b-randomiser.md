# M10b — The Randomiser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a title's characters individual rotation, scale, baseline offset and skew, driven by
a seed you can re-roll, so a title stops looking typeset.

**Architecture:** One new pure module, `src/text/random.ts`, turns `(seed, index, amounts)` into a
per-character transform with a seeded integer hash. `outlineText` bakes that transform into each
glyph's outlines about the centre of its own advance box — nothing else changes, because M10a
already carries `seed`, `amounts` and `overrides` through the model and the file format at identity
values. The panel gains four sliders, the seed and a re-roll.

**Tech Stack:** TypeScript strict, Svelte 5 runes, Vitest (node, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-19-m10-artistic-text-design.md` — §4 is this milestone,
and §10 records the M10a/M10b split.

**Ruling recorded here:** the spec's §6 **per-character selection and hand-tweaking** — click a
character, drag it, override that one letter — is deferred to **M10c**. It needs per-character hit
boxes, a new piece of store state, overlay drawing and a drag gesture: roughly the size of this
whole milestone again, and none of it is needed for "characters transforms can be randomized",
which is what was asked for. `overrides` is already in the model, the file format and the layering
below, so M10c adds no format change and no migration.

## Global Constraints

- **The document is immutable** (invariant 1); a no-op edit returns the same reference.
- **Node/Vitest has no DOM.** Pure modules only in tests.
- **TypeScript strict**, `verbatimModuleSyntax`, `erasableSyntaxOnly`. **Build bar: 0 errors, 0 warnings.**
- **Per-character transforms are baked into the outlines**, never carried as matrices
  (invariant 40 — it is what lets booleans, the node tool and M11's warp treat a title as artwork).
- **All randomness is integer arithmetic with `>>> 0`**, so a title looks identical on every
  machine. A title that re-rolled itself because it was opened elsewhere would be a data bug.
- **Only `src/text/font.ts` may import `opentype.js`** (invariant 40).
- Store actions that edit the document call `cancelActiveGesture()` first (invariant 15); a live
  slider drag is bracketed in one document gesture (invariant 41).
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: The pure randomiser

**Files:** Create `src/text/random.ts`; Test `src/__tests__/text-random.test.ts`

**Produces:**
`type CharTransform = { rotate: number; scale: number; dx: number; dy: number; skew: number }`;
`IDENTITY_CHAR: CharTransform`;
`charTransform(seed: number, index: number, a: Amounts): CharTransform`;
`withOverride(t: CharTransform, o: CharOverride | undefined): CharTransform`;
`newSeed(): number`.

- [ ] **Step 1: Write the failing test.** Cover:
  - **determinism**: the same `(seed, index, amounts)` gives exactly equal numbers across calls;
  - **index independence**: `charTransform(s, 5, a)` is unchanged whether or not indices 0-4 were
    asked for first, and differs from `charTransform(s, 6, a)` — this is what stops a letter
    inserted at the front reshuffling every letter after it;
  - **a different seed gives a different result** for the same index;
  - **zero amounts give the identity**: `{ rotate: 0, scale: 1, dx: 0, dy: 0, skew: 0 }`;
  - **range**: over indices 0-199 with `rotate: 12`, every `rotate` is within ±12 and at least one
    exceeds ±9 (so the amount is actually being used, not merely bounded);
  - **the axes are independent**: rotation and scale over 200 indices are not equal sequences —
    one salt per property, not one stream reused;
  - `offset` moves **`dy` only**; `dx` stays 0 (the control is "Baseline", per spec §4 and the
    design approved in brainstorming);
  - `withOverride` replaces **per property** and leaves the rest of the random values alone;
    `withOverride(t, undefined)` returns `t` unchanged;
  - `newSeed()` returns a non-negative 32-bit integer.

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement.**

```ts
/** Per-character jitter for a title (spec M10 §4). Pure, and deliberately integer-only: a title
 *  must look identical on every machine, so nothing here may depend on float formatting or on
 *  `Math.random`. */
import type { Amounts, CharOverride } from "./attrs";

export type CharTransform = { rotate: number; scale: number; dx: number; dy: number; skew: number };

export const IDENTITY_CHAR: CharTransform = { rotate: 0, scale: 1, dx: 0, dy: 0, skew: 0 };

/** A 32-bit mix of (seed, index, salt). Each property gets its own salt, so rotation and scale are
 *  independent rather than the same stream read twice; and because the index goes in rather than
 *  being consumed in order, character 5's jitter never depends on characters 0-4 — inserting a
 *  letter at the front must not reshuffle the rest. */
function hash(seed: number, index: number, salt: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (index + 0x165667b1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ salt, 0xc2b2ae35) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** −1 … +1 from a 32-bit hash. */
const signed = (h: number): number => (h / 0x100000000) * 2 - 1;

export function charTransform(seed: number, index: number, a: Amounts): CharTransform {
  return {
    rotate: signed(hash(seed, index, 1)) * a.rotate,
    scale: 1 + signed(hash(seed, index, 2)) * a.scale,
    dx: 0,
    // "Baseline": the jitter is vertical. `dx` exists for a hand override (M10c), not for the dice.
    dy: signed(hash(seed, index, 3)) * a.offset,
    skew: signed(hash(seed, index, 4)) * a.skew,
  };
}

/** A hand-set value replaces the rolled one for that property only, so a tweaked letter survives a
 *  re-roll of the rest (spec M10 §4). */
export function withOverride(t: CharTransform, o: CharOverride | undefined): CharTransform {
  if (!o) return t;
  return {
    rotate: o.r ?? t.rotate,
    scale: o.s ?? t.scale,
    dx: o.dx ?? t.dx,
    dy: o.dy ?? t.dy,
    skew: o.k ?? t.skew,
  };
}

export function newSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
```

- [ ] **Step 4: Tests pass. Step 5: `npm test && npm run build`. Step 6: Commit** —
      `feat: the pure per-character randomiser`.

---

### Task 2: Bake the transform into the glyphs

**Files:** Modify `src/text/font.ts`; Test `src/__tests__/text-outline.test.ts`

**Consumes:** `charTransform`, `withOverride`, `IDENTITY_CHAR` (Task 1).

- [ ] **Step 1: Write the failing test.** Add to the existing outline suite, using the Anton
      fixture:
  - with all amounts zero, the outlines are **identical** to M10a's (a title with no jitter must
    not move by a float);
  - with `rotate: 30`, the run's bounding box grows taller than the unjittered one;
  - a character's jitter is applied **about its own advance-box centre**: with a large rotation on
    a two-character run, the second glyph stays near its own pen position rather than swinging
    away — assert its bounding-box centre is within a glyph-width of the unjittered centre;
  - an override on index 0 changes the first glyph and leaves the second exactly as it was.

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement** in `outlineText`, per character:

```ts
    const t = withOverride(charTransform(m.seed, i, m.amounts), m.overrides[i]);
    const glyph = parsePathData(font.getPath(chars[i], pen[i], 0, m.size).toPathData(3));
    const sps = isIdentityChar(t) ? glyph : transformSubpaths(glyph, charMatrix(t, anchor));
```

  where `anchor` is `{ x: pen[i] + (advances[i] * m.size) / 2, y: 0 }` — the centre of the
  character's own advance box, on the baseline. Rotating about the origin instead would swing
  distant letters out of the line. `charMatrix` composes, in this order:

```ts
  multiply(
    translate(anchor.x + t.dx, anchor.y + t.dy),
    multiply(
      rotate((t.rotate * Math.PI) / 180),
      multiply(
        skewX((t.skew * Math.PI) / 180),
        multiply(scale(t.scale), translate(-anchor.x, -anchor.y)),
      ),
    ),
  )
```

  Skip the transform entirely when it is the identity, so an unjittered title's outlines are
  byte-identical to M10a's.

- [ ] **Step 4: `npm test && npm run build`. Step 5: Commit** —
      `feat: bake per-character jitter into a title's outlines`.

---

### Task 3: The panel controls

**Files:** Modify `src/lib/TextPanel.svelte`, `src/state/appState.svelte.ts`

**Consumes:** `newSeed` (Task 1); `setTitleOpts` (M10a).

- [ ] **Step 1: Add a slider component or reuse `NumberField`.** Check `src/lib/` first: if there
      is no range input anywhere in the app, use `NumberField` with `min`/`max`/`suffix` rather than
      inventing a slider, and say so in the commit — the spec's sketch shows sliders, but a number
      field is the control this app already has, already styled, already touch-sized, and already
      guards no-op changes (which invariant 1 needs).

- [ ] **Step 2: Add the Randomise block** to `TextPanel.svelte`, below the alignment row:
      Rotation (0-45, `°`), Scale (0-50, `%`), Baseline (0-50, `px`), Skew (0-45, `°`), each
      calling `setTitleOpts({ amounts: { ...meta.amounts, rotate: v } })` and so on. All four are
      gated on `ready` with the missing-font reason, like the rest of the panel.

- [ ] **Step 3: Add the seed row** — the seed shown as read-only text and a **Re-roll** button
      whose title is `Re-roll the randomiser` and which calls a new store action `rerollTitle()`:

```ts
export function rerollTitle(): Promise<void> {
  return setTitleOpts({ seed: newSeed() });
}
```

      Amounts of zero make a re-roll a visible no-op, which is correct and needs no special case:
      `sameMeta` lets the seed change through, and the outlines come back identical.

- [ ] **Step 4: `npm test && npm run build`. Step 5: Commit** — `feat: the randomiser's controls`.

---

### Task 4: The documents

**Files:** Modify `CLAUDE.md`, `README.md`, `docs/superpowers/CHANGELOG.md`

- [ ] **Step 1:** Extend invariant 40 with the randomiser's rules: integer-only hashing so a title
      never re-rolls itself on another machine; the index goes into the hash rather than being
      consumed in order; one salt per property; the transform is baked about the character's own
      advance-box centre; an override replaces per property and survives a re-roll.
- [ ] **Step 2:** Update the `npm test` count and the README's title bullet.
- [ ] **Step 3:** A CHANGELOG entry, including the M10c deferral recorded at the top of this plan.
- [ ] **Step 4: Commit** — `docs: M10b — the randomiser`.

## Self-review

**Spec coverage.** §4's randomiser → Tasks 1-2; its "overrides layered on top, replacing per
property" → `withOverride`, tested, and reachable from the file format even though no UI writes
overrides until M10c. §6's sliders and seed → Task 3; §6's per-character selection → deferred, with
the reasoning recorded above rather than silently dropped.

**Placeholders.** Task 3 Step 1 leaves the control type to be decided against what the repo already
has, with the decision rule and the requirement to record it stated — that is a judgement the
implementer must make with the code in front of them, not a gap.

**Type consistency.** `CharTransform`, `charTransform`, `withOverride`, `IDENTITY_CHAR` and
`newSeed` are defined in Task 1 and used under those names in Tasks 2-3. `Amounts` and
`CharOverride` come from `src/text/attrs.ts`, unchanged since M10a.
