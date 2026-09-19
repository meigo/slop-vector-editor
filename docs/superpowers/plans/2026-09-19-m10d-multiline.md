# M10d — Multi-Line Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Press Return in a title and get a second line. Line height is adjustable, and the
alignment buttons finally do the job their name and icons promise.

**Why now:** alignment describes how lines relate to each other. With one line there are no other
lines, so the control could only pin an edge to the anchor — real, but invisible until you edit,
which is why it read as pointless. M10's spec §9 pushed multi-line out as "not serving titles";
that call does not survive a panel carrying a control whose effect needs it.

**Architecture:** Alignment needs no new maths. Applying the existing per-line rule to every line
produces correct block alignment on its own: with `left` every line starts at 0, with `center` every
line is centred on 0, with `right` every line ends at 0 — so the block is aligned because each line
is. `runLayout` in `src/text/font.ts` becomes line-aware and hands `outlineText` and `charQuads` a
flat list of placed characters; neither needs to know about lines.

**Spec:** `docs/superpowers/specs/2026-09-19-m10-artistic-text-design.md`, whose §9 exclusion of
multi-line this milestone reverses. Everything else in that spec stands.

## Global Constraints

- **The format must stay backward compatible.** `data-sv-text-opts` has 8 fields today and
  `parseTextOpts` demands exactly 8. Adding `lineHeight` makes 9, and a strict check would turn
  **every title already saved** into a plain path with its text lost. Accept **8 or 9**, defaulting
  the missing line height. This is the same silent loss the seed ceiling caused in M10b.
- **Character indices stay indices into the raw string**, newlines included, so M10c's overrides
  keep pointing at the characters they were made for.
- **The document is immutable** (invariant 1); per-character transforms stay baked (invariant 40).
- **Build bar: 0 errors, 0 warnings.** Commit trailer:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: The format accepts a line height, old files included

**Files:** Modify `src/doc/document.ts`, `src/text/attrs.ts`; Test `src/__tests__/text-pure.test.ts`

**Produces:** `TextMeta.lineHeight: number` (a multiple of the size); `DEFAULT_LINE_HEIGHT = 1.2`.

- [ ] **Step 1: Write the failing test.**
  - a 9-field string round-trips with its line height;
  - **an 8-field string still parses**, with `lineHeight` defaulting to 1.2 — the regression guard;
  - 7 fields and 10 fields are both refused;
  - a non-finite or non-positive line height is refused.

- [ ] **Step 2: Run it and watch it fail. Step 3: Implement.** `formatTextOpts` always writes 9.
      `parseTextOpts` accepts `p.length === 8 || p.length === 9` and reads the 9th when present.
      Guard `lineHeight > 0` alongside the existing `size > 0` check.

- [ ] **Step 4: `npm test && npm run build`. Step 5: Commit** — `feat: a line height in the title format`.

---

### Task 2: Layout across lines

**Files:** Modify `src/text/layout.ts`, `src/text/font.ts`; Test `src/__tests__/text-pure.test.ts`,
`src/__tests__/text-outline.test.ts`

**Produces:** `splitLines(text: string): { text: string; start: number }[]` in `layout.ts` — each
line with the index its first character has in the whole string.

- [ ] **Step 1: Write the failing tests.**
  - `splitLines("AB\nCD")` gives `[{text:"AB",start:0},{text:"CD",start:3}]` — note `start` skips
    the newline, so indices stay true to the raw string;
  - a trailing newline yields a final empty line; `"\n"` alone gives two empty lines;
  - `splitLines("AB")` is one line, unchanged behaviour.
  - In the outline suite, against the Anton fixture: `"A\nB"` produces glyphs on two baselines, the
    second lower by `lineHeight * size`; its bounding box is taller than `"AB"`'s and narrower;
    with `align: "center"` two lines of different lengths are each centred about x = 0 (their
    bounding-box centres agree within 1e-6); `charQuads` returns one quad per **glyph**, not per
    character, so `"A\nB"` gives 2.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement.** `runLayout` splits the text, lays each line out with the existing
      `layoutRun` (unchanged — the per-line rule is what makes the block align), and offsets line
      `n`'s baseline by `n * lineHeight * size`. It returns a flat array of
      `{ char, index, penX, penY, advance }`, **skipping the newlines themselves** — they have no
      glyph — while leaving the indices of everything else untouched.

      `outlineText` and `charQuads` then iterate that array and never mention lines. `charQuads`'
      box runs from `penY + top` to `penY + bottom`, and `charMatrix`'s anchor becomes
      `{ x: penX + advance/2, y: penY }` rather than a bare x — **check `charMatrix` and
      `centreOf`, which currently take only `cx` and assume the baseline is y = 0.**

- [ ] **Step 4: `npm test && npm run build`. Step 5: Commit** — `feat: lay a title out across lines`.

---

### Task 3: Typing a line break, and the control

**Files:** Modify `src/lib/TextPanel.svelte`

- [ ] **Step 1: The field becomes a `<textarea>`** with `rows={2}` and `class="field"`, keeping the
      existing commit-on-change and the snap-back on refusal. **Enter must insert a newline, not
      commit** — so do not intercept it; the change still commits on blur, as the input did.
      Keep `aria-label="Title text"`, which the browser checks rely on.

- [ ] **Step 2: A Line height field** beside Size and Spacing, in the same `flex flex-wrap` row
      (never a fixed-width cell — invariant 40's note). Shown as a multiple, `min` 0.5, `max` 4,
      step is whatever `NumberField` gives. Gated on `ready` like its neighbours.

- [ ] **Step 3: `npm test && npm run build`. Step 4: Commit** — `feat: type a line break in a title`.

---

### Task 4: The documents

- [ ] Extend invariant 40: the format accepts 8 or 9 opts fields and why; block alignment falls out
      of the per-line rule; indices stay indices into the raw string so overrides survive.
- [ ] Update the spec's §9 to record that multi-line is no longer excluded, dated, in the
      changelog-style the repo uses for superseded decisions.
- [ ] Update the `npm test` count, the README's title bullet, and append a CHANGELOG entry.
- [ ] Commit — `docs: M10d — multi-line titles`.

## Self-review

**Spec coverage.** This reverses one exclusion in §9 and leaves the rest (text on a path, vertical
text, complex scripts) untouched. §4's randomiser and §6's per-character work carry over because
indices are unchanged — that is the constraint that keeps M10c working.

**Placeholders.** None. Task 2 Step 3 names the two functions that will break on a non-zero
baseline rather than leaving them to be discovered.

**Type consistency.** `lineHeight` is added to `TextMeta` in Task 1 and read in Tasks 2-3.
`splitLines` is defined in Task 2 and used only there.
