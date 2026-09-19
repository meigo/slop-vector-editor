# M10c — Per-Character Tweaking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click one character of a title to select it, drag it to move it, and set its rotation,
scale, baseline and skew by hand — overriding the roll for that letter only, and surviving a
re-roll of the rest.

**Architecture:** `src/text/font.ts` gains `charQuads`, which returns each character's advance box
**after** its jitter, in the title's own space. The store caches those quads for the selected title
so the Text tool can hit-test synchronously — the font load is async and a tool's `down` is not.
`app.charSel` is store state like `nodeSel`; the Overlay draws the highlight straight from it, the
way it already draws the selection frame, so the single `app.overlay` slot is not involved.

**Tech Stack:** TypeScript strict, Svelte 5 runes, Vitest (node, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-19-m10-artistic-text-design.md` §6, deferred from M10b.

## Global Constraints

- **The document is immutable** (invariant 1); a no-op edit returns the same reference.
- **Tools never import the store** (invariant 12) — new capabilities go on `ToolContext`.
- **Per-character transforms stay baked into the outlines** (invariant 40).
- **Overrides replace per property** and survive a re-roll (`withOverride`, M10b).
- **Async store actions follow invariant 37's rules**: re-entrancy guard, capture before awaiting,
  re-check after, `cancelActiveGesture()` again before committing, notify rather than fail silently.
- A live drag is bracketed in one document gesture (invariant 41).
- **Build bar: 0 errors, 0 warnings.** Commit trailer:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Each character's quad

**Files:** Modify `src/text/font.ts`; Test `src/__tests__/text-outline.test.ts`

**Produces:** `charQuads(f: LoadedFont, m: TextMeta): Vec[][]` — four corners per character, in the
title's own space, with the jitter applied.

- [ ] **Step 1: Write the failing test.** Using the Anton fixture:
  - one quad per character, four points each;
  - for an unjittered run, quads are ordered left to right and do not overlap horizontally;
  - a quad's height covers the baseline — its top is above `y = 0` and its bottom at or below it
    (glyph space is y-up-negative here: the baseline is 0 and ascenders are negative);
  - with `rotate: 40`, a quad is no longer axis-aligned (its top edge is not horizontal);
  - an override on index 0 moves only that quad.

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement.** Extract the shared part of `outlineText` into a private
  `runLayout(f, m)` returning `{ chars, advances, pen }`, so `outlineText` and `charQuads` cannot
  drift. A character's unjittered box is `x: pen[i] … pen[i] + advances[i] * m.size`, `y:` from
  `-font.ascender / upm * m.size` to `-font.descender / upm * m.size`; map its four corners through
  the same `charMatrix(t, cx)` the outlines use.

- [ ] **Step 4: `npm test && npm run build`. Step 5: Commit** — `feat: per-character quads`.

---

### Task 2: The store — cached quads, selection and the override edits

**Files:** Modify `src/state/appState.svelte.ts`, `src/doc/tree.ts` (nothing), `src/App.svelte`

**Produces:** `app.charSel: number | null`; `app.charQuads: Vec[][]`;
`pickCharacter(at: Vec): void`; `setCharSel(i: number | null): void`;
`setCharOverride(patch: CharOverride): Promise<void>`; `clearCharOverride(): Promise<void>`;
`nudgeCharacter(dx: number, dy: number): Promise<void>`.

- [ ] **Step 1: Add the state.** `charSel` and `charQuads` are store state — **not saved, not
      undoable**, like `nodeSel` (invariant 31). Both are cleared wherever the selection changes:
      add to the existing `setSelection`/`setSession` paths beside `syncPropsOverride`.

- [ ] **Step 2: Keep the quads in sync.** The font load is async, so the quads are computed when the
      selected title changes rather than when a click arrives. Use a module-level `$effect.root` in
      the store — **not** an effect in `TextPanel`, because M8 put that panel behind `{#if expanded}`
      and a collapsed Properties panel would silently stop character picking working:

```ts
$effect.root(() => {
  $effect(() => {
    const t = selectedTitle();
    if (!t?.text) {
      app.charQuads = [];
      return;
    }
    const meta = t.text;
    void loadFont(meta.font)
      .then((f) => {
        // The selection may have moved while the font loaded.
        if (selectedTitle()?.id === t.id) app.charQuads = charQuads(f, meta);
      })
      .catch(() => {
        app.charQuads = [];
      });
  });
});
```

      Verify in the dry run that `$effect.root` works at module scope in a `.svelte.ts` store; if it
      does not, put the effect in `App.svelte` instead, which is always mounted, and say so.

- [ ] **Step 3: `pickCharacter(at)`** maps the document point into the title's own space through the
      inverse of its world matrix (invariant 26 — and do nothing when that matrix is singular), then
      finds the last quad containing it (last, so the topmost drawn character wins) and sets
      `charSel`. A miss clears `charSel`.

- [ ] **Step 4: The override edits.** `setCharOverride` merges into `overrides[charSel]` and
      re-outlines through the existing `reshapeTitle`; `clearCharOverride` deletes that index's
      entry. `nudgeCharacter(dx, dy)` adds to the override's `dx`/`dy` — that is what a canvas drag
      calls. All three go through `reshapeTitle`, so they inherit its guards for free.

- [ ] **Step 5: Escape.** Extend the Escape chain (invariant 31) so it clears `charSel` **before**
      it clears the node selection or the object selection.

- [ ] **Step 6: `npm test && npm run build`. Step 7: Commit** — `feat: character selection state`.

---

### Task 3: The Text tool picks and drags a character

**Files:** Modify `src/tools/text-tool.ts`, `src/tools/tool.ts`, `src/tools/context.ts`,
`src/__tests__/fake-context.ts`; Test `src/__tests__/text-tool.test.ts` (create)

**Produces:** `ToolContext.pickCharacter(at: Vec)` and `ToolContext.nudgeCharacter(dx, dy)`.

- [ ] **Step 1: Write the failing test** with the fake context: a click on a title that is already
      selected calls `pickCharacter` and does **not** place a new title; a click on empty canvas
      with nothing selected still places one; a drag beyond `movedEnough` with a character selected
      calls `nudgeCharacter` with the document delta and never `placeTitle`.

- [ ] **Step 2: Implement.** In `up`, the existing `movedEnough` check already separates click from
      drag. Add: when the selection is a single title **and** the press landed inside it, a click
      picks a character instead of placing a title. A drag that began on the selected character
      nudges it, bracketed by `ctx.beginGesture()`/`ctx.endGesture()` so the whole drag is one undo
      step (invariant 41), and cancels correctly on `pointercancel`.

- [ ] **Step 3: `npm test && npm run build`. Step 4: Commit** — `feat: pick and drag a character`.

---

### Task 4: The highlight and the panel block

**Files:** Modify `src/lib/Overlay.svelte`, `src/lib/TextPanel.svelte`

- [ ] **Step 1: The highlight.** Draw `app.charQuads[app.charSel]` as a closed polygon in the
      overlay's document-space layer, in the accent colour, when the Text tool is active and
      `charSel` is set. Derive it from store state exactly as the selection frame is derived — do
      **not** put it in the single `app.overlay` slot, which marquee, guides and the pen share.

- [ ] **Step 2: The panel block.** When `charSel` is set, the Randomise block is replaced by a
      **Character _n_** block. Its four fields are **absolute values for that character**, not
      amounts: pre-filled from the effective transform (`withOverride(charTransform(...), override)`)
      so they read what is on screen, and writing one sets that property's override. A **Reset**
      button calls `clearCharOverride`. A short line says the rest of the title is unaffected.

      The distinction matters and must be visible in the labels: the Randomise block's numbers are
      **ranges** (`±12°`), this block's are **the value** (`-12°`). Conflating them would make the
      same field mean two different things.

- [ ] **Step 3: `npm test && npm run build`. Step 4: Commit** — `feat: the character block`.

---

### Task 5: The documents

- [ ] Extend invariant 40 with: `charSel`/`charQuads` are store state, not saved and not undoable,
      cleared with the selection; the quads come from the same layout as the outlines so the two
      cannot drift; the panel shows absolute values for a character and ranges for the title.
- [ ] Update the `npm test` count, the README's title bullet, and append a CHANGELOG entry.
- [ ] Commit — `docs: M10c — per-character tweaking`.

## Self-review

**Spec coverage.** §6's "clicking a character selects that character; the sliders then edit only
that character, and dragging it writes dx/dy; Escape returns to the whole run" → Tasks 2-4. §4's
"an override survives a re-roll" already holds from M10b and is unchanged here.

**Placeholders.** Task 2 Step 2 names a fallback if `$effect.root` does not work at module scope,
rather than assuming — that is a genuine unknown to settle in the dry run, and the alternative is
specified.

**Type consistency.** `charQuads` is defined in Task 1 and used in Task 2. `pickCharacter`,
`setCharOverride`, `clearCharOverride`, `nudgeCharacter` are defined in Task 2 and used in Tasks
3-4. `CharOverride` and `withOverride`/`charTransform` are unchanged from M10a/M10b.
