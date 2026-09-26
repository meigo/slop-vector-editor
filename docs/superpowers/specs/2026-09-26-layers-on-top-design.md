# slop-vector-editor — Layers above Properties

Date: 2026-09-26. Status: approved in conversation. A follow-up to M8
(`2026-09-19-m8-sidebar-split-design.md`); UI only — nothing here reads or writes the document, and
no file format changes.

## 1. The fault, measured

M8 made Properties collapse when nothing is selected and open when something is (invariant 23's
one exception). Properties sits **above** Layers, so every flip of the selection's emptiness moves
the whole Layers panel.

Measured in desktop Chrome (:5198, 2026-09-26), one layer holding one path, nothing selected:

| Step | "Path" row top (CSS px) |
| --- | --- |
| nothing selected, Properties collapsed | 188 |
| real mouse click on the row → selected, Properties opens above | **592** |
| Escape → nothing selected, Properties collapses | 188 |

The row the user just pressed jumps ~400px away from the pointer, and back again on deselect.
Selecting on the canvas moves the whole list the same way. This is exactly what invariant 23's
"a state change must not move the layout" exists to prevent, triggered by the most common action
in the panel.

## 2. The change

**Layers goes on top, Properties below.** Layers' top edge is then fixed at the top of the column
whatever the selection is; Properties opening only moves Layers' **bottom** edge up, and closing it
moves it back down. No row moves.

The one thing that now moves is the Properties header itself: collapsed, it sits at the bottom of
the column; opened, it rises to the split. That is accepted — it is the panel whose state is
changing, and a disclosure moving as it opens is the expected result of pressing it, unlike a
neighbouring list shifting under the finger.

### Out

- The default split, the clamps, `MIN_PANEL_PX`, the 12px divider, the header bars, the
  auto-collapse rule and `propsOverride` — all unchanged.
- Keyboard resize of the divider — still parked with the accessibility group.
- Regenerating `docs/screenshot.png` — owed (§6).

## 3. `splitRatio` keeps its meaning

`prefs.splitRatio` stays **Properties' share** of what the two panels share. Two options were
weighed:

- **Keep the meaning, flip the drag direction** (chosen). A stored `0.55` still gives Properties
  55%, so every existing user's split survives the swap with no migration, and `sanitizePrefs` and
  its tests are untouched. Only the sign of the drag changes: Properties is now below the divider,
  so dragging **down** shrinks it.
- Redefine it as "the top panel's share". The number would then silently mean the other panel for
  anyone with a stored value, needing a new key or a `1 - r` migration — churn with no benefit.

`ratioFromDrag(startRatio, deltaPx, bodyPx, minPx)` keeps its signature; `deltaPx` stays the
pointer's **downward** travel, and the function now returns `startRatio - deltaPx / bodyPx`
(clamped). The sign lives in the pure, tested function rather than as a negation at the call site
in `Sidebar.svelte`, where nothing tests it.

The divider's `aria-valuenow` is the separator's position from the top, which is now Layers'
share: `Math.round((1 - ratio) * 100)`.

## 4. Keeping the selected row visible

With Layers on top a row no longer moves, but Layers' body **shrinks from the bottom** when
Properties opens. A row in the lower part of the list — pressed there, or selected on the canvas —
would end up hidden under the Properties header. (Today the list moves instead, and the same row can
also end up out of view; the swap makes the problem easy to fix, not new.)

So when the selection changes, the Layers list scrolls the **last selected id's row** into view,
**nearest-edge**, after the DOM has updated:

- A row already fully visible causes **no scroll** — the common case, including every click on a
  visible row. This is what keeps the fix from reintroducing movement.
- A row partly or wholly below the visible area is scrolled up just far enough to show its bottom
  edge; one above, just far enough to show its top edge.
- No row element (its layer or group is collapsed in the panel, or the panel is collapsed): do
  nothing. Expanding collapsed tree nodes to reveal a selection is out of scope.
- The last id is used because that is the object `setSelection` makes current (invariant 25); for
  a marquee selection it is one of the selected rows, which is enough.

The maths is a pure function in a new `src/lib/reveal.ts`:

```ts
/** The scrollTop that shows [rowTop, rowBottom] — both in the list's content coordinates — inside
 *  a viewport of `viewHeight` currently scrolled to `scrollTop`, moving as little as possible.
 *  Returns `scrollTop` itself when the row is already fully visible. A row taller than the
 *  viewport aligns its top. */
export function revealScrollTop(
  scrollTop: number,
  viewHeight: number,
  rowTop: number,
  rowBottom: number,
): number;
```

`LayersPanel.svelte` calls it from an `$effect` that reads `app.selection`, awaits `tick()`, then
converts the row's `getBoundingClientRect()` into content coordinates (`rect.top - list.top +
list.scrollTop`, as `rows()`'s drop-line maths already does) and assigns `list.scrollTop` only when
the result differs. It sets `scrollTop` directly and **never calls `scrollIntoView`**, which also
scrolls every scrollable ancestor — the `<900px` drawer and the page.

## 5. Files

- `src/lib/Sidebar.svelte` — render `LayersPanel`, then the divider, then `PropertiesPanel`;
  `flexFor` arguments unchanged per panel; `aria-valuenow` per §3; the M8 doc comment updated.
- `src/lib/split.ts` — `ratioFromDrag` per §3, its doc comment and `clampRatio`'s ("Properties'
  share") checked still true.
- `src/lib/reveal.ts` (new) — §4.
- `src/lib/LayersPanel.svelte` — the reveal effect.
- `src/__tests__/split.test.ts` — the drag-direction cases flipped.
- `src/__tests__/reveal.test.ts` (new) — §7.
- `CLAUDE.md` — invariant 23's Properties exception gains the ordering rule (Layers on top so that
  the exception moves no row); architecture map's `Sidebar` entry says Layers is on top and lists
  `reveal.ts`; the test count.
- `README.md` — the sidebar sentence names Layers first and says it sits on top.
- `docs/superpowers/CHANGELOG.md` — a dated entry, including the measurement in §1 and what was
  browser-verified.

The `<900px` drawer mounts the same `Sidebar`, so it gets the same order with no change of its own.

## 6. Owed

- `docs/screenshot.png` shows the old order. It needs a real drawing to be representative, so it is
  left for the user to retake; the README's alt text does not describe the panel order and stays
  true.
- The iPad pass: tapping a row with Properties collapsed, by finger and Pencil, and the divider's
  reversed drag under a finger.

## 7. Testing

- **Unit (Vitest, node):**
  - `ratioFromDrag`: downward travel **shrinks** the ratio, upward grows it, both clamps, and a
    zero body still splits evenly.
  - `revealScrollTop`: fully visible → same value; below → bottom-aligned; above → top-aligned;
    exactly at either edge → unchanged; taller than the viewport → top-aligned; a viewport of zero
    or negative height (not laid out yet) → `scrollTop` unchanged.
- **Build:** 0 errors, 0 warnings; still three chunks; lint and format clean.
- **Browser (controller, :5198, screenshots):**
  - Layers header at the top of the column, Properties header at the bottom with nothing selected.
  - Repeat §1's measurement: clicking the row with nothing selected leaves its top **unchanged**
    (±1px), and Escape leaves it unchanged again.
  - With enough rows to scroll, selecting a row in the lower half with Properties collapsed leaves
    it fully visible after Properties opens; selecting a visible row high in the list does not
    scroll.
  - Dragging the divider down grows Layers and shrinks Properties; the ratio survives a reload; a
    stored ratio from before the swap still gives Properties the same share.
  - Both chevrons; the strip absent while one panel is collapsed; the `<900px` drawer in the same
    order; no console errors.
