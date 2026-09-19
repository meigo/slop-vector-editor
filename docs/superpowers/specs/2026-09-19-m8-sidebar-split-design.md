# slop-vector-editor — milestone 8 design: the sidebar split

Date: 2026-09-19. Status: approved in brainstorming. Follows M7
(`2026-09-19-m7-boolean-operations-design.md`). It is a UI milestone, not a document one: nothing
here reads or writes the document, and no file format changes.

It answers a report from a screenshot — the Properties and Layers panels share one column, the
boundary between them is hard to see, and the layer list is cramped once a drawing has more than a
few shapes.

## 1. What is actually wrong

Three separate faults, which is why the column reads as broken rather than merely tight:

- **The divider is invisible.** It is `border-t border-line`: `--color-line` is `#2e2e35` against
  `--color-panel`, about one step apart in the palette. A 1px line at that contrast is not a
  boundary.
- **Both sections use `.section-title` for their headings**, so "LAYERS" looks like another heading
  inside one long scroll rather than the start of a different panel.
- **The Properties body is clipped mid-control** by the Layers section with no scrollbar, fade or
  shadow — in the reported screenshot, the top sliver of a button shows under "NEW POLYGONS". The
  cut reads as a rendering fault, not as "there is more here".

And one structural fault behind the crowding: Layers is hard-capped at `h-[45%] min-h-40`.
Properties keeps the other 55% **even when nothing is selected**, which is when it shows the
new-shape defaults — its least urgent content — and when the layer list is most likely what the
user is working in.

## 2. Scope

In:

- a **raised header bar** for each panel, with a collapse chevron (§3);
- a **draggable divider** with a persisted position (§4);
- **Properties collapsing itself when nothing is selected**, with a one-click override (§5);
- the pure split logic and its tests (§6, §8).

Out:

- **Scroll shadows or fades.** A solid raised bar above the cut is what makes content read as
  continuing underneath; a gradient on top of that is decoration.
- **A width grip for the column.** slop-paint has one, and it may be right here later, but the
  report was about vertical crowding. A second drag surface, a second stored value and a new way
  for the 900px drawer to go wrong are not worth buying on speculation.
- **Two columns (layers left, properties right).** Considered and rejected in brainstorming: it is
  the Figma/Sketch/Penpot convention, but two permanent columns take ~480px of a 768px iPad
  portrait window, so both would have to become drawers and the user would be switching anyway.
  This app follows the Illustrator/Affinity/Inkscape camp — one column, stacked, with a real split.
- **Keyboard resize of the divider.** It belongs with the parked accessibility group (CLAUDE.md
  roadmap), not with a drag fix.
- Any change to the `<900px` drawer, to what the panels contain, or to the document.

## 3. The header bars

Each panel gains a header: **40px high** (`h-10`, matching the Layers header that exists today),
`bg-raised`, with the panel's name in `.section-title`, a chevron on the left, and the panel's own
action buttons pushed right.

`bg-raised` (`#2d2d33`) against `--color-panel` is a real step, and the bar is 40px of it rather
than one pixel. This is the fix for all three faults in §1: the two panels stop sharing a type
style, the boundary becomes a band instead of a line, and content scrolling under a solid bar is
the standard reading of "this panel continues".

- The chevron and the title are **one button** carrying `aria-expanded`, so the whole name is the
  target rather than a 24px glyph. Titles are action phrases, per invariant 24: `Hide the
  properties` / `Show the properties`, `Hide the layers` / `Show the layers`.
- A new **`src/lib/PanelHeader.svelte`** renders the bar and takes `{ title, open, ontoggle }` plus
  a snippet for the actions. Each panel renders its own header with its own actions, so
  `LayersPanel.svelte` keeps its New-layer and Delete-layer buttons and the disabled reasons that
  go with them. `Sidebar.svelte` owns only the geometry.
- Inside the Properties body, the existing `<h2 class="section-title">` stays and keeps saying
  `Selection` or `Defaults for new shapes`. The header names the panel; the heading says what the
  panel is currently showing. They are different questions and now have different answers.

## 4. The divider

Between the Properties body and the Layers header sits a **12px strip** with a centred grip,
`cursor-row-resize`, `role="separator"` and `aria-orientation="horizontal"`, and the title
`Drag to resize the panels` — which invariant 24 also makes its status-bar hint.

- **12px is a deliberate deviation** from the 32px bar-control rule (invariant 23). A divider is
  approached by sliding onto it, not by tapping a target, and 12px is 1.5× the 8px grip slop-paint
  already ships for its layer panel's width. It is recorded here so it is not read as an oversight.
- The drag is pointer-based: `setPointerCapture` on pointer-down, `touch-action: none` on the
  strip, and `pointercancel` treated exactly like `pointerup` — invariant 6, and the reason the
  strip can live inside a scrolling drawer without the drag turning into a scroll.
- **The strip exists only while both panels are open.** With one collapsed there is nothing to
  distribute, so the strip is not rendered and the Layers header's own `border-t` is the boundary.
  An inert 12px gap between two bars would be dead space that looks draggable.

**The stored value is `splitRatio`, the fraction of the body given to Properties**, defaulting to
`0.55` — what the current `h-[45%]` split already gives. The body is the column minus the two 40px
headers and the 12px strip.

Clamping, in `clampRatio(ratio, bodyPx, minPx)`:

- each body keeps at least **120px** (`minPx`) — about three layer rows at `h-8`;
- if the body cannot hold two minimums (`bodyPx < 2 * minPx`), the ratio is ignored and the two
  split evenly, because refusing to render is not an option and honouring the ratio would starve
  one side completely;
- a non-finite ratio falls back to the default.

## 5. What is open, and who decided

Three pieces of state. Two persist in `Prefs`; the third deliberately does not.

| State | Where | Meaning |
| --- | --- | --- |
| `splitRatio` | `Prefs`, persisted | Properties' share of the body, `0.1`–`0.9` after sanitizing |
| `layersOpen` | `Prefs`, persisted | a plain user toggle, no automatic behaviour |
| `app.propsOverride` | the store, not saved, not undoable | `boolean \| null` — see below |

**Properties' openness is derived, never stored:** `open = propsOverride ?? hasSelection`.

- With nothing selected it is collapsed and Layers takes the column. Select a shape and it opens.
- Clicking the header sets `propsOverride` to the opposite of whatever is showing. That is how the
  new-shape defaults stay reachable in exactly the state that hides them — one click, and they stay
  open.
- **The override is cleared the moment the selection flips between empty and non-empty**, and only
  then. So "I opened the defaults" holds for as long as nothing is selected, and no stale decision
  survives into a state it was never made for.

This is a different rule from `prefs.dockExpanded`, where a decision is permanent (invariant 23),
and the difference is intentional: the dock's latches do not depend on what is selected, and this
panel's entire content does.

`propsOverride` lives in the store rather than in `Sidebar.svelte` because `App.svelte` mounts a
Sidebar twice — the `<900px` drawer and the inline column — and store state keeps them agreeing.
The clearing happens where the selection is assigned, `setSelection` and `setSession` (invariant
13), not in an effect: those two functions are already the places that re-resolve selection-derived
store state.

**Both panels collapsed is allowed**: two bars and empty space below. It is obviously self-inflicted
and one click to undo, and refusing it would mean a chevron that sometimes does nothing, which is
worse than a silly-looking column.

### The invariant this knowingly breaks

Invariant 23 says a state change must not move the layout. **Auto-collapsing Properties on
deselection moves it, and that is the point of the feature.** The rule exists so that a passive
state — a dirty flag, a hover, a mode — does not shuffle controls under the user's finger; it is
not meant to force a panel whose content is entirely selection-dependent to hold half a column
while it has nothing to say. The exception is written into CLAUDE.md beside the rule, so the next
reader sees a decision rather than an oversight.

## 6. Architecture

- **`src/lib/split.ts`** (new, pure — beside `layer-drop.ts`, which set the precedent for a pure
  helper in `lib/`):
  - `clampRatio(ratio: number, bodyPx: number, minPx: number): number` — §4;
  - `ratioFromDrag(startRatio: number, deltaPx: number, bodyPx: number, minPx: number): number` —
    the pointer delta applied to the ratio the drag started from, then clamped;
  - `propsOpen(override: boolean | null, hasSelection: boolean): boolean` — `override ?? hasSelection`;
  - `clearedOverride(override: boolean | null, wasEmpty: boolean, isEmpty: boolean): boolean | null`
    — `null` when emptiness flipped, otherwise the override unchanged (same value, so the caller can
    skip a write).
- **`src/lib/PanelHeader.svelte`** (new) — §3.
- **`src/lib/Sidebar.svelte`** — the split container: measures the body, holds the drag, renders the
  strip, passes `open`/`ontoggle` down. It gains the only new geometry in the milestone.
- **`src/lib/PropertiesPanel.svelte`** and **`src/lib/LayersPanel.svelte`** — each renders a
  `PanelHeader` and its body; `LayersPanel` loses `h-[45%] min-h-40`, since the Sidebar now decides
  its height. Both bodies get `overscroll-behavior: contain`, so a flick that reaches the end of one
  list does not scroll the other.
- **`src/persist/preferences.ts`** — `splitRatio: number` and `layersOpen: boolean` in `Prefs`,
  `DEFAULT_PREFS` and `sanitizePrefs` (a non-finite or out-of-range ratio falls back to the default;
  a non-boolean `layersOpen` falls back to `true`).
- **`src/state/appState.svelte.ts`** — `propsOverride` plus its toggle action, and the clearing in
  `setSelection`/`setSession` (§5).

## 7. What this does not touch

The `<900px` drawer keeps working unchanged: `App.svelte` renders it under `{#if app.propertiesOpen}`
and hides the inline column below the breakpoint, so at most one Sidebar is ever visible. Both may
be mounted at once on a wide screen, which is why every piece of state in §5 is shared rather than
component-local. The modifier dock, the notices' clearance above it, and the top bar's width budget
are all unaffected — the column's width does not change.

## 8. Testing

- **Unit (Vitest, node):** `clampRatio` in range, clamped at both ends, with a body too short for
  two minimums, and with a non-finite ratio; `ratioFromDrag` up and down, including a delta that
  would exceed either clamp; `propsOpen`'s four-row truth table; `clearedOverride` for each flip and
  each non-flip, returning the same value when nothing flipped. `sanitizePrefs` for `splitRatio`
  (missing, `NaN`, a string, out of range, in range) and `layersOpen` (missing, non-boolean,
  `false`).
- **Build:** 0 errors, 0 warnings; lint and format clean. Two chunks still, and the app's own within
  a few KB.
- **Browser (controller, port 5198, screenshots):** the two header bars visibly separating the
  panels; the divider dragging both ways and stopping at both clamps; the ratio surviving a reload;
  each chevron collapsing and expanding, including both collapsed; the strip absent while one is
  collapsed; Properties collapsed with nothing selected and open after selecting a shape; the
  override opening the defaults and holding until a shape is selected; the layer list taking the
  whole column with nothing selected; the drawer below 900px still opening and holding the same
  split; no console errors.

## 9. Owed

The divider's feel under a finger and a Pencil — 12px is a judgement, not a measurement — joins the
iPad pass owed since M5, together with the header bars' 40px targets. Keyboard resize of the
divider is parked with the accessibility group.
