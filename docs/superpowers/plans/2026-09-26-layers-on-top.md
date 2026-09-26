# Layers above Properties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Layers panel above Properties in the sidebar, so selecting something no longer moves the layer rows, and keep the selected row visible when Properties opens below it.

**Architecture:** `Sidebar.svelte` renders Layers, divider, Properties in that order. `splitRatio` keeps meaning "Properties' share"; the pure `ratioFromDrag` flips its sign because Properties is now below the divider. A new pure `revealScrollTop` in `src/lib/reveal.ts` computes a nearest-edge scroll, called by an `$effect` in `LayersPanel.svelte` on selection change.

**Tech Stack:** Svelte 5, TypeScript, Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-26-layers-on-top-design.md`

## Global Constraints

- `npm run build`: 0 errors, 0 warnings. `npm run lint` clean. `npm test` all passing.
- `prefs.splitRatio` stays Properties' share; `sanitizePrefs` and `src/persist/preferences.ts` are NOT touched.
- Never call `scrollIntoView` — set `list.scrollTop` directly (it would scroll the drawer/page too).
- Match surrounding comment style: `/** … */` doc comments explaining *why*, British spelling.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- One commit per task. Do not touch CLAUDE.md, README.md or CHANGELOG.md — the controller does docs.

## Review Focus

- A click on an already-visible row must cause no scroll at all (revealScrollTop returns the same value → no assignment). Pinned in Task 2 tests.
- A row in a collapsed layer/group has no element — the effect must no-op, not throw. Handled in Task 2 code (null check).
- Row ids can contain characters CSS selectors dislike — use `CSS.escape` in the query. Task 2 code.
- Drag direction: dragging the divider DOWN must grow Layers (the top panel). Pinned in Task 1 tests.
- An unmeasured list (height 0) must not scroll. Pinned in Task 2 tests.

---

### Task 1: Swap the panel order and flip the drag direction

**Files:**
- Modify: `src/lib/split.ts` (`ratioFromDrag` and its doc comment)
- Modify: `src/lib/Sidebar.svelte` (render order, `aria-valuenow`, top doc comment)
- Test: `src/__tests__/split.test.ts` (the `ratioFromDrag` describe block)

**Interfaces:**
- Produces: `ratioFromDrag(startRatio, deltaPx, bodyPx, minPx): number` — same signature; `deltaPx` is downward pointer travel; result is `clampRatio(startRatio - deltaPx / bodyPx, bodyPx, minPx)`.

- [ ] **Step 1: Update the tests** — replace the `describe("ratioFromDrag", …)` block in `src/__tests__/split.test.ts` with:

```ts
describe("ratioFromDrag", () => {
  // Properties sits BELOW the divider, and the ratio is its share: dragging down shrinks it.
  it("moves the ratio against the pointer's share of the body", () => {
    expect(ratioFromDrag(0.5, 80, 800, 120)).toBeCloseTo(0.4, 10);
    expect(ratioFromDrag(0.5, -80, 800, 120)).toBeCloseTo(0.6, 10);
  });

  it("clamps a drag that would starve either panel", () => {
    expect(ratioFromDrag(0.5, 1000, 800, 120)).toBeCloseTo(0.15, 10);
    expect(ratioFromDrag(0.5, -1000, 800, 120)).toBeCloseTo(0.85, 10);
  });

  it("cannot divide by a body of zero", () => {
    expect(ratioFromDrag(0.55, 40, 0, 120)).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/split.test.ts` — expect the first two cases to FAIL.

- [ ] **Step 3: Implement** in `src/lib/split.ts`:

```ts
/** The ratio a drag lands on. `deltaPx` is the pointer's downward travel since pointer-down.
 *  Properties — whose share the ratio is — sits below the divider, so travel down gives it less. */
export function ratioFromDrag(
  startRatio: number,
  deltaPx: number,
  bodyPx: number,
  minPx: number,
): number {
  if (!Number.isFinite(bodyPx) || bodyPx <= 0) return clampRatio(startRatio, bodyPx, minPx);
  return clampRatio(startRatio - deltaPx / bodyPx, bodyPx, minPx);
}
```

- [ ] **Step 4: Run** the split tests — expect PASS.

- [ ] **Step 5: Swap the order in `src/lib/Sidebar.svelte`.** In the markup, after the width-grip `<button>`, the order becomes `<LayersPanel …/>`, then `{#if split} …divider… {/if}`, then `<PropertiesPanel …/>`. Each component keeps exactly its current props (`flexFor(1 - ratio, showLayers, showProps)` for Layers, `flexFor(ratio, showProps, showLayers)` for Properties). Change the divider's `aria-valuenow={Math.round(ratio * 100)}` to `aria-valuenow={Math.round((1 - ratio) * 100)}` and add a short comment above the divider: the value is the separator's position from the top, which is Layers' share. Extend the top doc comment (`Spec (M8): …`) with one sentence: Layers sits on top (spec 2026-09-26) so that Properties opening and closing with the selection moves only Layers' bottom edge, never its rows.

- [ ] **Step 6: Verify** `npm test` passes and `npm run build` gives 0 errors, 0 warnings; `npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/split.ts src/lib/Sidebar.svelte src/__tests__/split.test.ts
git commit -m "feat: put the Layers panel above Properties

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Keep the selected layer row visible

**Files:**
- Create: `src/lib/reveal.ts`
- Create: `src/__tests__/reveal.test.ts`
- Modify: `src/lib/LayersPanel.svelte` (script: one import, one `$effect`)

**Interfaces:**
- Produces: `revealScrollTop(scrollTop: number, viewHeight: number, rowTop: number, rowBottom: number): number` from `src/lib/reveal.ts`.

- [ ] **Step 1: Write the failing tests** — `src/__tests__/reveal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { revealScrollTop } from "../lib/reveal";

describe("revealScrollTop", () => {
  it("leaves a fully visible row alone", () => {
    expect(revealScrollTop(100, 300, 150, 182)).toBe(100);
  });

  it("leaves a row touching either edge alone", () => {
    expect(revealScrollTop(100, 300, 100, 132)).toBe(100);
    expect(revealScrollTop(100, 300, 368, 400)).toBe(100);
  });

  it("scrolls just far enough to show a row below the view", () => {
    expect(revealScrollTop(0, 300, 290, 322)).toBe(22);
    expect(revealScrollTop(0, 300, 500, 532)).toBe(232);
  });

  it("scrolls just far enough to show a row above the view", () => {
    expect(revealScrollTop(200, 300, 180, 212)).toBe(180);
    expect(revealScrollTop(200, 300, 0, 32)).toBe(0);
  });

  it("aligns the top of a row taller than the view", () => {
    expect(revealScrollTop(0, 20, 100, 132)).toBe(100);
  });

  it("does nothing before the list has a height", () => {
    expect(revealScrollTop(40, 0, 500, 532)).toBe(40);
    expect(revealScrollTop(40, -5, 500, 532)).toBe(40);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/reveal.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/reveal.ts`:

```ts
/** Keeping the selected layer row in view (spec 2026-09-26 §4). Pure: no DOM, so it is testable. */

/** The scrollTop that shows [rowTop, rowBottom] — both in the list's content coordinates — inside
 *  a viewport of `viewHeight` currently scrolled to `scrollTop`, moving as little as possible.
 *  Returns `scrollTop` itself when the row is already fully visible, so a click on a visible row
 *  never scrolls. A row taller than the viewport aligns its top. */
export function revealScrollTop(
  scrollTop: number,
  viewHeight: number,
  rowTop: number,
  rowBottom: number,
): number {
  if (!(viewHeight > 0)) return scrollTop;
  if (rowTop < scrollTop || rowBottom - rowTop > viewHeight) return rowTop;
  if (rowBottom > scrollTop + viewHeight) return rowBottom - viewHeight;
  return scrollTop;
}
```

Note the order: a row above the view, or one taller than the view, aligns its top; only then is "below" handled. Check the "taller" test: `revealScrollTop(0, 20, 100, 132)` → height 32 > 20 → 100. ✓

- [ ] **Step 4: Run** the reveal tests — expect PASS.

- [ ] **Step 5: Wire it into `src/lib/LayersPanel.svelte`.** Add `import { tick } from "svelte";` at the top of the script and `import { revealScrollTop } from "./reveal";` beside the other `./` imports. After the `const selected = $derived(…)` line add:

```ts
  /** Properties sits below this panel and opens when something is selected, shrinking this list
   *  from the bottom — so a row selected low in the list, here or on the canvas, would end up under
   *  its header. Scroll it back into view once the layout has settled, nearest edge only, so a
   *  visible row never moves (spec 2026-09-26 §4). `scrollTop` directly, never `scrollIntoView`,
   *  which would also scroll the drawer and the page. */
  $effect(() => {
    const id = app.selection.at(-1);
    const el = list;
    if (id === undefined || !el) return;
    void tick().then(() => {
      const row = el.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
      if (!row) return;
      const view = el.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const top = r.top - view.top + el.scrollTop;
      const next = revealScrollTop(el.scrollTop, el.clientHeight, top, top + r.height);
      if (next !== el.scrollTop) el.scrollTop = next;
    });
  });
```

`list` is `null` while the panel is collapsed (`{#if expanded}`), so the effect no-ops then; a row inside a collapsed layer or group has no element and is skipped.

- [ ] **Step 6: Verify** `npm test` passes; `npm run build` 0 errors, 0 warnings; `npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reveal.ts src/__tests__/reveal.test.ts src/lib/LayersPanel.svelte
git commit -m "feat: keep the selected layer row in view as Properties opens

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 3 (controller): browser verification and docs

Done by the controller, not a subagent: the browser checks in spec §7 on :5198, then CLAUDE.md (invariant 23, architecture map, test count), README.md's sidebar sentence and a CHANGELOG entry recording the measurements, in one commit.
