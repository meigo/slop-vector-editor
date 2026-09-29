# M22 — On-canvas Text Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit a title's text in place on the canvas — caret, selection, typing, iPad keyboard —
through a hidden-textarea mirror.

**Architecture:** Pure helpers (`src/text/edit.ts`: index conversion, override remapping, caret
hit-testing, vertical movement, word bounds, selection rectangles; `revealPan` in
`src/state/viewport.ts`) and `caretStops` in `src/text/font.ts`; a store edit session
(`app.textEdit`, `beginTextEdit`/`setTextSelection`/`endTextEdit`, a registered focus hook, the
shared typing bracket); the Text and Select tools entering and driving it through `ToolContext`;
one always-mounted hidden `<textarea>` component in `Canvas.svelte`; the caret and highlight drawn
by `Overlay.svelte`.

**Tech Stack:** Svelte 5, TypeScript, Vitest (node env), opentype.js (only via `src/text/font.ts`).

**Spec:** `docs/superpowers/specs/2026-09-29-m22-on-canvas-text-design.md` — read it first.

## Global Constraints

- Branch `m22-text-edit` (already created). One commit per task. Commit trailer, verbatim:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- `npm run build` must end with **0 errors, 0 warnings**; `npm test` green; `npm run lint` clean.
- Tools never import the store (invariant 12). Only `src/text/font.ts` imports opentype.js
  (invariant 40). The document is immutable (invariant 1); session changes go through `commitDoc`.
- Title indices are **code points** into the raw string, newlines included (invariant 40). The
  textarea's offsets are **UTF-16**; convert at every crossing with the Task 1 helpers.
- `app.textEdit` and `app.caretStops` are store state: not saved, not undoable (`$state.raw`
  where they are objects/arrays, replaced never mutated — invariant 2).
- The textarea is focused **synchronously** from the store's `beginTextEdit` through a function
  Canvas registers (`registerTextFocus`) — never from an `$effect` (iOS keyboard rule, spec §1).
  Font size 16px; `focus({ preventScroll: true })`; never `display: none`.
- One undo step per edit session (spec ruling 6), using one shared bracket implementation.
- Typographic characters (— “ ” ·) stay as written; grep for `\u` escapes after writing.
- Tests: `src/__tests__/*.test.ts`; fake tool context `src/__tests__/fake-context.ts`; the bundled
  test font is `fixtures/Anton-Regular.ttf` (see `src/__tests__/text-outline.test.ts` for loading).

## Review Focus

1. **Astral characters (emoji) and combining marks in the text** — the caret and selection must
   never land inside a surrogate pair; typing after an emoji inserts after it. Tests in Task 1 and
   Task 4.
2. **The selection changes while an edit's outline is still in flight** (click another object mid-
   typing) — the session must commit to the title it was editing, close its bracket once, and not
   write the old text into the new selection. Test in Task 3.
3. **Undo pressed (top bar) while editing** — the session ends and commits first, then undo steps
   back over the whole session (one step). Test in Task 3.
4. **Empty lines and a trailing newline** — the caret must be placeable on an empty line and after
   a final newline; ↑/↓ must pass through empty lines. Tests in Task 2 and Task 1.
5. **A rotated / flipped title** — caret, highlight and click-to-index go through the title's world
   matrix. Test in Task 3 (index from a point under a rotated title).

---

### Task 1: Pure editing helpers

**Files:**
- Create: `src/text/edit.ts`
- Modify: `src/state/viewport.ts` (add `revealPan`)
- Test: `src/__tests__/text-edit.test.ts`

**Interfaces — Produces:**
```ts
// src/text/edit.ts
export type CaretStop = { x: number; baseline: number; top: number; bottom: number; line: number };
/** UTF-16 offset → code-point index (an offset inside a surrogate pair rounds DOWN). */
export function toCodePoint(text: string, utf16: number): number;
/** Code-point index → UTF-16 offset. */
export function toUtf16(text: string, cp: number): number;
/** Overrides after an edit: common prefix/suffix (code points) bound the edited span; keys before
 *  it stay, keys inside it are dropped, keys after it shift by the length change. Returns the SAME
 *  object when nothing moves or drops (invariant 1). */
export function remapOverrides<T>(oldText: string, newText: string, o: Record<number, T>): Record<number, T>;
/** The same rule for one index; null when it was inside the edited span. */
export function remapIndex(oldText: string, newText: string, i: number): number | null;
/** Index of the stop nearest `p` (title-local): nearest line by baseline-to-mid distance, then
 *  nearest x on that line. `stops[i]` is the stop for index i. -1 for no stops. */
export function indexAt(stops: readonly CaretStop[], p: { x: number; y: number }): number;
/** ↑ (dir −1) / ↓ (+1) from `index` towards `goalX`; before the first line → 0, past the last →
 *  stops.length − 1. */
export function verticalMove(stops: readonly CaretStop[], index: number, dir: -1 | 1, goalX: number): number;
/** Word bounds around `index` (code points): a run of letters/digits (`\p{L}\p{N}_`), else a run
 *  of whitespace (not newlines), else the single character. */
export function wordAt(text: string, index: number): { start: number; end: number };
/** One rectangle per line covered by [a, b) (order-free), title-local:
 *  { x0, x1, top, bottom }. Empty for a caret. A selection that crosses a line end extends that
 *  line's rectangle to its end stop. */
export function selectionRects(stops: readonly CaretStop[], a: number, b: number): { x0: number; x1: number; top: number; bottom: number }[];
```
```ts
// src/state/viewport.ts
/** The smallest pan that brings `rect` (screen px), grown by `margin`, inside `visible` (screen
 *  px); the same view object when it is already inside. Where it cannot fit, top/left win. */
export function revealPan(view: View, rect: Box, visible: Box, margin: number): View;
```
(`Box` is `src/geom/box.ts`'s `{ x, y, w, h }` — check its exact field names and use them.)

- [ ] **Step 1: Write the failing tests** (`src/__tests__/text-edit.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  indexAt, remapIndex, remapOverrides, selectionRects, toCodePoint, toUtf16, verticalMove, wordAt,
  type CaretStop,
} from "../text/edit";
import { revealPan } from "../state/viewport";

const E = "a😀b"; // 😀 is two UTF-16 units

describe("index conversion", () => {
  it("round-trips across an astral character", () => {
    expect(toUtf16(E, 2)).toBe(3);
    expect(toCodePoint(E, 3)).toBe(2);
    expect(toCodePoint(E, 2)).toBe(1); // inside the pair rounds down
    expect(toUtf16(E, 3)).toBe(4);
  });
});

describe("remapOverrides", () => {
  const o = { 0: "A", 2: "C", 4: "E" };
  it("shifts overrides after an insertion before them", () => {
    expect(remapOverrides("abcde", "abXcde", o)).toEqual({ 0: "A", 3: "C", 5: "E" });
  });
  it("drops an override whose character was deleted, shifts the rest back", () => {
    expect(remapOverrides("abcde", "abde", o)).toEqual({ 0: "A", 3: "E" });
  });
  it("drops overrides inside a replaced span", () => {
    expect(remapOverrides("abcde", "aXYZe", o)).toEqual({ 0: "A", 4: "E" });
  });
  it("returns the same object when nothing changed", () => {
    expect(remapOverrides("abc", "abc", o)).toBe(o);
    expect(remapOverrides("abcde", "abcdeX", o)).toBe(o);
  });
  it("counts code points", () => {
    expect(remapOverrides("a😀b", "Xa😀b", { 2: "B" })).toEqual({ 3: "B" });
  });
  it("remapIndex matches", () => {
    expect(remapIndex("abcde", "abXcde", 2)).toBe(3);
    expect(remapIndex("abcde", "abde", 2)).toBeNull();
  });
});

// Two lines "ab\n" + "" (empty) + "\ncd": text "ab\n\ncd", stops for indices 0..6.
const L = (line: number, x: number): CaretStop => ({ x, baseline: line * 20, top: line * 20 - 15, bottom: line * 20 + 5, line });
const stops = [L(0, 0), L(0, 10), L(0, 20), L(1, 0), L(2, 0), L(2, 10), L(2, 20)];

describe("indexAt / verticalMove", () => {
  it("finds the nearest stop on the nearest line, including an empty line", () => {
    expect(indexAt(stops, { x: 12, y: -3 })).toBe(1);
    expect(indexAt(stops, { x: 50, y: 18 })).toBe(3);
    expect(indexAt(stops, { x: 16, y: 38 })).toBe(6);
  });
  it("moves by goal x through an empty line, and clamps at the ends", () => {
    expect(verticalMove(stops, 2, 1, 20)).toBe(3);
    expect(verticalMove(stops, 3, 1, 20)).toBe(6);
    expect(verticalMove(stops, 1, -1, 10)).toBe(0);
    expect(verticalMove(stops, 5, 1, 10)).toBe(6);
  });
});

describe("wordAt", () => {
  it("selects a word, a whitespace run, or one character", () => {
    expect(wordAt("hello world", 2)).toEqual({ start: 0, end: 5 });
    expect(wordAt("hello  world", 6)).toEqual({ start: 5, end: 7 });
    expect(wordAt("a,b", 1)).toEqual({ start: 1, end: 2 });
  });
});

describe("selectionRects", () => {
  it("one rect per covered line, none for a caret", () => {
    expect(selectionRects(stops, 1, 1)).toEqual([]);
    expect(selectionRects(stops, 1, 5)).toEqual([
      { x0: 10, x1: 20, top: -15, bottom: 5 },
      { x0: 0, x1: 0, top: 5, bottom: 25 },
      { x0: 0, x1: 10, top: 25, bottom: 45 },
    ]);
  });
});

describe("revealPan", () => {
  const view = { x: 0, y: 0, zoom: 1 };
  const visible = { x: 0, y: 0, w: 800, h: 400 };
  it("keeps the same view when the rect is visible", () => {
    expect(revealPan(view, { x: 10, y: 10, w: 2, h: 20 }, visible, 16)).toBe(view);
  });
  it("pans up just enough to lift the rect above the bottom edge", () => {
    expect(revealPan(view, { x: 10, y: 500, w: 2, h: 20 }, visible, 16)).toEqual({ x: 0, y: -136, zoom: 1 });
  });
});
```
(Adjust the `Box` field names in the `revealPan` tests to `src/geom/box.ts`'s actual ones. The
empty-line rectangle in `selectionRects` is zero-width by design — the Overlay gives zero-width
rects a minimum drawn width.)

- [ ] **Step 2: Run — FAIL** (`npx vitest run src/__tests__/text-edit.test.ts`).
- [ ] **Step 3: Implement.** Iterate code points with `[...text]` / `Array.from`. `remapOverrides`:
  `pre` = common prefix length, `suf` = common suffix length capped at `min(oldLen, newLen) − pre`;
  span = `[pre, oldLen − suf)`; delta = `newLen − oldLen`. `indexAt`: group stops by `line`; the
  nearest line is the one whose `(top + bottom) / 2` is nearest `p.y`; within it the nearest `x`
  (ties → the lower index). `verticalMove`: target line = current line + dir; none → 0 or last;
  else nearest x to `goalX` on that line. `selectionRects`: for each line touched, x0 = the stop x
  where the selection starts on that line (or the line's first stop), x1 = where it ends (or the
  line's last stop). `revealPan`: dx/dy so the grown rect sits inside `visible`; return `view`
  itself when both are 0.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Wire `remapOverrides` into the store.** In `reshapeTitle`
  (`src/state/appState.svelte.ts`, the "Overrides never outlive the string" block), when
  `patch.text !== undefined` replace the length filter with
  `meta.overrides = remapOverrides(target.text.text, meta.text, meta.overrides)`, and remap
  `app.charSel` with `remapIndex` (null when dropped). Keep the length filter as-is for patches
  that don't change the text. Add a store test (in a new `src/__tests__/text-edit-store.test.ts`,
  modelled on the existing text store tests — find them with `grep -ln "setTitleText" src/__tests__`)
  that a title with an override on character 2 keeps it on the same character after
  `setTitleText` inserts one character at the front. See it fail first.
- [ ] **Step 6:** `npm test`, `npx tsc --noEmit`, `npm run lint`. **Commit** —
  `feat(M22): pure text-editing helpers; overrides follow their characters`.

---

### Task 2: `caretStops` and the store cache

**Files:**
- Modify: `src/text/font.ts` (add `caretStops`), `src/state/appState.svelte.ts` (`app.caretStops`
  in the existing `charQuads` `$effect.root`)
- Test: `src/__tests__/text-caret.test.ts`

**Interfaces:**
- Consumes: `CaretStop` (Task 1).
- Produces: `export function caretStops(f: LoadedFont, m: TextMeta): CaretStop[]` — length
  `[...m.text].length + 1`; `app.caretStops: CaretStop[]` (`$state.raw`, `[]` when no single title
  is selected).

Rule, per line of `splitLines(m.text)` with `lineNo`: `baseline = lineNo * m.lineHeight * m.size`;
`top = baseline + (−ascender/upm)·size`, `bottom = baseline + (−descender/upm)·size` (as
`charHits` computes them); the stop for the line's k-th character is that glyph's un-jittered
`penX`; the stop for index `line.start + chars.length` (the newline or the text end) is the last
glyph's `penX + advance·size`, or, for an empty line, `0`. Reuse `runLayout`'s `placed` (it skips
empty lines — handle them from `splitLines`).

- [ ] **Step 1: Failing tests** with Anton (`fixtures/Anton-Regular.ttf`, loaded as in
  `text-outline.test.ts`), meta helper copied from there:
```ts
it("has one stop per index plus the end, first at the pen", () => {
  const s = caretStops(f, meta("AB"));
  expect(s).toHaveLength(3);
  expect(s[0].x).toBe(0);
  expect(s[1].x).toBeGreaterThan(0);
  expect(s[2].x).toBeGreaterThan(s[1].x);
  expect(new Set(s.map((q) => q.line))).toEqual(new Set([0]));
});
it("puts an empty line and a trailing newline on their own lines at x 0", () => {
  const s = caretStops(f, meta("A\n\nB\n"));
  expect(s.map((q) => q.line)).toEqual([0, 0, 1, 2, 2, 3]);
  expect(s[2].x).toBe(0);
  expect(s[5].x).toBe(0);
  expect(s[3].baseline).toBeCloseTo(2 * 1.2 * 100);
});
it("follows alignment: a right-aligned line ends at 0", () => {
  const s = caretStops(f, meta("AB", { align: "right" }));
  expect(s[2].x).toBeCloseTo(0);
  expect(s[0].x).toBeLessThan(0);
});
it("ignores the randomiser (stops are un-jittered)", () => {
  const a = caretStops(f, meta("AB"));
  const b = caretStops(f, meta("AB", { amounts: { rotate: 30, scale: 20, offset: 10, skew: 10 } }));
  expect(b).toEqual(a);
});
```
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.**
- [ ] **Step 5:** In the store's `$effect.root` that computes `charQuads`/`charAt`, also set
  `app.caretStops = caretStops(f, meta)` (and `[]` wherever those are cleared), with the same
  generation guard.
- [ ] **Step 6:** `npm test`, `tsc`, lint. **Commit** — `feat(M22): caret stops`.

---

### Task 3: The store's edit session

**Files:**
- Modify: `src/state/appState.svelte.ts`, `src/tools/tool.ts` (`ToolContext`),
  `src/tools/context.ts`, `src/__tests__/fake-context.ts`, `src/lib/TextPanel.svelte` (use the
  shared bracket)
- Test: `src/__tests__/text-edit-store.test.ts` (extend Task 1's file)

**Interfaces — Produces (store):**
```ts
export type TextEdit = { id: string; anchor: number; focus: number };
app.textEdit: TextEdit | null            // $state.raw
/** Canvas registers its textarea focus here (spec §1). */
export function registerTextFocus(fn: (() => void) | null): void;
/** Enter editing `id` (selects it). `at` is a document point (caret there, resolved when stops
 *  arrive if they are not loaded yet), or "all" (select the whole text). Calls the registered
 *  focus function synchronously. Refuses (notice) when the title's font is unavailable. */
export function beginTextEdit(id: string, at: Vec | "all"): void;
/** Set the selection (code points). Derives `app.charSel` (spec §2). */
export function setTextSelection(anchor: number, focus: number): void;
/** Document point → index in the edited title, through its world matrix; null if not editing,
 *  stops not loaded, or the matrix is singular. */
export function textIndexAt(at: Vec): number | null;
/** Leave editing: commit the textarea's text (setTitleText — reporting), close the bracket. */
export function endTextEdit(): Promise<void>;
/** Live keystroke from the textarea: typeTitleText + bracket start (idempotent). */
export function typeTextEdit(text: string): void;
/** The shared typing bracket, used by the panel field and the canvas session (spec §3). */
export function startTitleTyping(): void;
export function endTitleTyping(): void;          // closes now (after an awaited commit)
export function abandonTitleTyping(): void;      // closes once the outline drain settles
```
**ToolContext additions:** `textEdit(): TextEdit | null`, `beginTextEdit(id, at)`,
`setTextSelection(anchor, focus)`, `textIndexAt(at): number | null`, `endTextEdit(): void`
(void-wrapped), `textWordAt(index): { start: number; end: number }` (store-side `wordAt` on the
edited title's text). Fake context: record calls in `state.textEdits`, keep a settable
`state.fakeTextEdit` and `state.fakeIndexAt: (at) => number | null`.

Behaviour:
- `beginTextEdit`: if another session is open, end it first. `cancelActiveGesture()`; select the
  title (`setSelection([id])`); `app.textEdit = { id, anchor, focus }` (for "all": 0..length; for a
  point: `textIndexAt` or, if stops are not loaded, keep the point as `pendingAt` and resolve it in
  the stops effect); call the registered focus function **synchronously**; start the bracket.
  Font unavailable (`fontAvailable(meta.font)` false) → notice (reuse the panel's missing-font
  text) and return without entering.
- `charSel` derivation in `setTextSelection` (spec §2).
- Two ways to leave, one internal `leaveTextEdit()` (sync) under both:
  - **`endTextEdit()`** (async; Escape, blur, click outside, the tool's own exit): awaits
    `setTitleText(current text)` — the reporting commit that puts a refused text back, exactly as
    the panel field's blur — then `leaveTextEdit()`.
  - **Store-driven leaves** (sync, before the store acts): `setSelection` to anything other than
    exactly `[textEdit.id]`, `undo`, `redo`, `replaceDocument`, `setTool` to a tool other than
    `text`. These call `leaveTextEdit()` directly: every keystroke has already been committed live,
    so there is nothing left to write; `leaveTextEdit` clears `textEdit`, closes the bracket with
    `endTitleTyping()` (now — so `undo` that follows removes the whole session as one step) and
    blurs the field through a second registered hook (`registerTextBlur`), guarded so the blur
    handler does not start a second leave. A keystroke outline still in flight at that moment lands
    as its own step — accepted and commented (rare: a keystroke and an undo within one outline).
- `TextPanel.svelte`: replace its local `startTyping/endTyping` and unmount effect with the store's
  `startTitleTyping/endTitleTyping/abandonTitleTyping` (behaviour unchanged).

- [ ] **Step 1: Failing store tests**, including Review Focus 2, 3, 5:
  - enter with "all" selects 0..len and calls the registered focus function synchronously (a spy
    registered with `registerTextFocus`, asserted before any `await`);
  - `typeTextEdit` ×3 then `endTextEdit` → one undo step (undo restores the original text);
  - one-character selection sets `charSel`; a two-character one clears it; a selection of the
    newline character does not set it;
  - selecting another object mid-session ends it (textEdit null) and the typed text is on the
    edited title, not the new selection;
  - `undo()` during a session ends it and removes the whole session in one step;
  - `textIndexAt` under a title rotated 90° returns the index of the character under the point;
  - a title with an unavailable font refuses with a notice.
  Use the fixture-font setup the existing text store tests use (`grep -ln "placeTitle\|setTitleText" src/__tests__`).
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.**
- [ ] **Step 5:** `npm test`, `tsc`, lint, build. **Commit** — `feat(M22): text edit session in the store`.

---

### Task 4: The tools

**Files:**
- Modify: `src/tools/text-tool.ts`, `src/tools/select.ts`
- Test: `src/__tests__/text-tool.test.ts` (extend), `src/__tests__/select-tool.test.ts` (extend)

Consumes the Task 3 `ToolContext` additions, `hitTest` (`src/geom/hit.ts`), `isDoubleTap`
(`src/input/double-tap.ts`), `movedEnough`, `pointerTolerance`.

Text tool:
- **down:** if editing and the press is on the single selected character (`charSel !== null` and
  `textIndexAt` hits inside that character's span — i.e. the pressed index is `charSel` or
  `charSel + 1` and the point lies inside `charQuads` for it; reuse the existing `pickCharacter`
  test through a new `ctx.charAtPoint(at): number | null` if needed) → character drag as today.
  Else if the press hits a title (`hitTest` + `node.kind === "path" && node.text`):
  - not the edited one (or not editing) → `beginTextEdit(id, e.doc)`; remember `pressIndex`;
  - the edited one → index = `textIndexAt`; Shift → `setTextSelection(anchor, index)`; a double
    tap (`isDoubleTap` on the same title) → `wordAt` selection; else caret at index.
  Else (empty canvas): editing → `endTextEdit()` and do nothing else; not editing → remember for
  `up` to place a title (today's behaviour).
- **move:** character drag as today; else, when a text press is active and moved enough,
  `setTextSelection(pressIndex, textIndexAt(e.doc) ?? current)`.
- **up:** place a title only for a press that started on empty canvas while not editing and stayed
  a click (`placeTitle` now enters editing with "all" — Task 5 changes `placeTitle`).
- `cancel`: as today, plus drop the text press.
- `keydown(ctx, "escape")` while editing → `endTextEdit()`, return true. `busy()` → editing.
- hint: `"Click a title to edit it · click empty canvas to place one · Esc finishes"`.

Select tool: where a double tap on a path hands it to the node tool (`secondTap === "path"`), a
path with `text` instead calls `ctx.setTool("text")` then `ctx.beginTextEdit(id, e.doc)`.

- [ ] **Step 1: Failing tests** (fake context): click on a title enters editing with the caret at
  the fake index; Shift-click extends; drag selects from the press index to the moved index; a
  double tap selects the word; press on empty canvas while editing ends editing and places
  nothing; press on empty canvas while not editing places; Escape ends editing; the single
  selected character still drags (setCharOffset called); select-tool double-click on a title enters
  text editing and switches to the Text tool; on a plain path it still goes to the node tool.
  Include Review Focus 1: with text `"a😀b"` and a fake index of 2, the recorded selection is 2
  (code points), never a UTF-16 offset.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.**
- [ ] **Step 5:** full suite, tsc, lint. **Commit** — `feat(M22): Text and Select tools enter and drive editing`.

---

### Task 5: The hidden textarea, placing, auto-pan, page-scroll reset

**Files:**
- Create: `src/lib/TextEditField.svelte`
- Modify: `src/lib/Canvas.svelte` (mount it; register focus), `src/state/appState.svelte.ts`
  (`placeTitle` → `beginTextEdit(r.id, "all")` replacing the panel-focus block),
  `src/App.svelte` or `Canvas.svelte` (page-scroll reset listeners)

Behaviour of `TextEditField.svelte` (always mounted inside the canvas host, absolutely positioned):
- Style: `position: absolute; opacity: 0; pointer-events: none; font-size: 16px; width: 1px;
  height: 1em; padding: 0; border: 0; resize: none; overflow: hidden; white-space: pre;`
  `aria-label="Title text on canvas"`, `autocapitalize="off"` is NOT set (iPad users expect it),
  `spellcheck="false"`. Positioned at the caret's screen point (from `app.caretStops`, the title's
  world matrix and `docToScreen`) so the browser never scrolls to reach it.
- Registers `() => el.focus({ preventScroll: true })` with `registerTextFocus` on mount, `null` on
  destroy. Canvas must call it from `beginTextEdit` synchronously — verify by reading the call
  chain; no `await`/microtask in between.
- Mirror: when `app.textEdit` starts or the edited title's text changes while the field is NOT the
  source of the change, set `el.value` to the title's text; whenever `app.textEdit`'s anchor/focus
  change and differ from the field's, set `el.setSelectionRange(toUtf16(start), toUtf16(end),
  direction)`.
- `input` → `typeTextEdit(el.value)`, then read the field's selection back (`toCodePoint`) into
  `setTextSelection`. `selectionchange` on the document (filtered to this element) and `keyup`/
  `select` → read the selection back likewise.
- `keydown`: ↑/↓ (Shift extends) → `verticalMove` with a goal x kept across consecutive vertical
  moves (reset on any other key or click), `preventDefault`; Escape → `endTextEdit()` and blur;
  ⌘A/Ctrl+A → native (select all in the field). Everything else native.
- **Clicks must not blur the field.** A mousedown on the (non-focusable) canvas host moves focus
  off the textarea, which would end the session on every click inside the title. While
  `app.textEdit` is set, the canvas host's `mousedown` calls `preventDefault()` (pointerdown's
  preventDefault does not stop the focus change; mousedown's does). Registers
  `registerTextBlur(() => el.blur())` beside the focus hook.
- `blur` → `endTextEdit()` (commit with reporting via `setTitleText`, then put the field value
  back, exactly as the panel field's blur does) — unless the session already ended.
- `compositionstart/end`: while composing, do not overwrite `el.value` from the store.
- Auto-pan: after entering and after each selection change, compute the caret's screen rect and the
  visible rect (the canvas host's client rect intersected with `visualViewport`'s
  `offsetLeft/offsetTop/width/height`), and if `revealPan` returns a different view, `setView` it.
  Margin 24px.
- Page-scroll reset (spec §6): on `focusout`, `visualViewport` `resize` and window `scroll`, if
  `window.scrollX/Y` or `document.scrollingElement.scrollTop` is non-zero, reset to 0. Add once,
  app-wide.

- [ ] **Step 1:** Implement; `placeTitle` change; remove the now-dead panel-focus code (its
  comment explains the iPad reason — carry that reason to `beginTextEdit`'s doc comment).
- [ ] **Step 2:** Add a store test: `placeTitle` enters editing with the whole text selected.
- [ ] **Step 3:** `npm run build` (0/0), `npm test`, lint. **Commit** — `feat(M22): hidden text field, placing enters editing, auto-pan`.

---

### Task 6: Drawing the caret and the selection

**Files:**
- Modify: `src/lib/Overlay.svelte`, `src/app.css` (the blink keyframes, if a class is used)

- While `app.textEdit` is set and `app.caretStops` is loaded: selection rects
  (`selectionRects(stops, anchor, focus)`) mapped through the title's world matrix and
  `docToScreen` as polygons — fill the accent at 0.25 opacity, a white 0.9-opacity 1px halo
  outline (invariant 23's contrast rule); zero-width rects drawn at least 4px wide. The caret: a
  line from `top` to `bottom` at the focus stop, accent, 1.5px, over a 3px white halo; blinking
  with a CSS animation (`step-end`, 1s) that restarts on every caret move (key the element by the
  focus index + a move counter) so it is solid while typing.
- Keep the existing single-character quad highlight (it now follows `charSel` derived from the
  selection).
- Geometry through `multiply(parent, node.transform)` exactly as `charOutline` does.
- [ ] **Step 1:** implement. **Step 2:** `npm run build` (0/0), `npm test`. **Commit** — `feat(M22): caret and selection drawing`.

---

### Task 7: Docs

- README: on-canvas editing (how to enter, keys, iPad note).
- CLAUDE.md: architecture map (`src/text/edit.ts`, `caretStops`, `TextEditField.svelte`,
  `app.textEdit`, `app.caretStops`, `revealPan`, the shared typing bracket); invariant 40's
  "Character indices…" bullet gains the UTF-16 ↔ code point rule; a new **invariant 49** (the
  mirror, focus-on-tap through `registerTextFocus`, 16px, one undo per session and its leave
  paths, `charSel` derived from a one-character selection, overrides remapped by `remapOverrides`);
  Current state M22; Roadmap; test count.
- CHANGELOG: M22 entry — shipped, rulings, the overrides fix, browser-checked (from the
  controller's results file), owed (the iPad list in spec §8).
- [ ] `npm run build`, `npm test`, lint. **Commit** — `docs(M22): README, CLAUDE.md and changelog`.

---

### Task 8 (controller): Browser verification

On port 5198 (sandbox disabled), desktop Chrome, the spec §8 browser list. Record results for
Task 7.
