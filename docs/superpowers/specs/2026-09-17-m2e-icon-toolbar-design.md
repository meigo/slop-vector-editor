# slop-vector-editor — milestone 2e design: one icon top bar

Date: 2026-09-17. Status: approved in brainstorming (one icon top bar; shape fields in Properties;
tool strip stays on the left). Runs before M3a.

It supersedes these parts of the M2d design (`2026-09-17-m2d-ui-alignment-design.md`):
- the context bar
- where the polygon Star toggle lives
- the File menu's neighbours

Everything else from M2d stands: font, tokens, `.ui-on`, `ToggleButton`, focus rules, section
titles, and the unsaved indicator.

## 1. Scope

In:
- a single icon-only top bar with tooltips
- removal of the context bar
- status-bar hover hints
- a "Shape" section in the Properties panel
- polygon defaults under "Defaults for new shapes"

Out:
- the tool strip (stays on the left)
- the right-click menu (unchanged)
- z-order (M3a adds its icons to this bar)
- keyboard navigation of the bar
- an overflow ("more") menu

## 2. Top bar (`src/lib/TopBar.svelte`)

From left to right, with groups separated by `.bar-sep`:

| Group | Controls | Icon (lucide) | Tooltip |
| --- | --- | --- | --- |
| file | File ▾ menu (unchanged) · file name (unchanged) | — | — |
| history | Undo · Redo | `Undo2` · `Redo2` | "Undo (⌘Z)" · "Redo (⇧⌘Z)" |
| clipboard | Cut · Copy · Paste | `Scissors` · `Copy` · `ClipboardPaste` | "Cut (⌘X)" · "Copy (⌘C)" · "Paste (⌘V)" |
| object | Duplicate · Delete | `CopyPlus` · `Trash2` | "Duplicate (⌘D)" · "Delete (⌫)" |
| shape | Convert to path · Flatten transform | `Spline` · `Stamp` | "Convert to path" · "Flatten transform" |
| (spacer) | | | |
| view | Zoom out · zoom % · Zoom in · Fit | `ZoomOut` · text · `ZoomIn` · `Maximize` | as today |
| panel | Properties (narrow screens only, as today) | `SlidersHorizontal` | "Properties" |

- **Shortcut labels.** Use ⌘ on Mac and Ctrl+ elsewhere (the existing `mod`), ⇧ for Shift and
  ⌫ for Delete.
- **Buttons.** Every button is an `.icon-btn` (32px box, 18px icon) with an `aria-label` equal to
  the action name (e.g. "Cut") and a `title` equal to the tooltip text.
- **Disabled buttons are never hidden** (guide §4). A disabled button's `title` says why:

  | Button | Disabled when | Tooltip while disabled |
  | --- | --- | --- |
  | Undo / Redo | nothing to undo / redo | "Undo — nothing to undo" / "Redo — nothing to redo" (as today) |
  | Cut, Copy, Duplicate, Delete | nothing is selected | "{Action} — nothing selected" |
  | Convert to path | `selectionActions().canConvert` is false | "Convert to path — select a rectangle, ellipse or polygon" |
  | Flatten transform | `canFlatten` is false | "Flatten transform — select a moved or rotated path" |

  Paste is always enabled.
- **Actions.** The buttons call the existing store actions:
  - `cutToSystem`, `copyToSystem`, `pasteFromClipboard` (`void`), `duplicateSelection`,
    `deleteSelection`, `convertSelectionToPath`, `flattenSelection`;
  - undo/redo and zoom go through `runCommand` as today.
- **Width.**
  - The bar never wraps and never scrolls (M2d §5 amendment: a scrolling bar clips the File menu).
  - The file name is the only shrinking item (`min-w-0 truncate`); every group is `shrink-0`.
  - At 768px wide the bar must fit with M3a's four z-order icons added (≈ 4 × 32px + a separator).
  - Check it at 768px and at 820px.

## 3. Context bar removed

- **Deleted:** `src/lib/ContextBar.svelte` and its use in `App.svelte`.
- **Where its content goes:**

  | Content | New home |
  | --- | --- |
  | Selection count | Already in the status bar |
  | Tool hint | Already in the status bar (§4) |
  | Paste with no selection | Top bar |
  | Rect radius, polygon Sides/Star/Inner, polygon tool defaults | Properties (§5) |

- **Store actions unchanged:** `setPolygonPrefs`, `setSelectionPolygon`, `setSelectionRectRadius`.
- **Canvas size:** the canvas area grows by the removed bar's height. Nothing else in the layout
  changes.

## 4. Status-bar hover hints

- **Pure helper `src/lib/hover-hint.ts`:**
  `hintFrom(target: { closest(selector: string): { getAttribute(name: string): string | null } | null } | null, pointerType: string): string | null`.
  - It returns the `title` of the nearest element with a non-empty `title` (via
    `closest("[title]")`).
  - It returns `null` when `pointerType !== "mouse"`, when there is no target, or when the title is
    empty.
  - The minimal structural parameter type lets it be tested without a DOM.
- **App (`App.svelte`):**
  - A window `pointerover` listener sets `app.hoverHint = hintFrom(e.target as Element, e.pointerType)`.
  - A window `pointerout` whose `relatedTarget` is null (the pointer left the window) sets it to
    `null`.
  - A `pointerdown` also clears it, so a pressed button's hint doesn't linger over a drag.
  - `app.hoverHint` is a new `$state` string-or-null on the store. It is not saved and not part of
    undo.
- **Status bar (`StatusBar.svelte`):** the left slot shows `app.hoverHint ?? TOOLS[app.toolId].hint`.
  The slot keeps its `min-w-0 truncate`, so a long hint never moves the right-hand readouts.
- **Tooltips:** the browser's native tooltip still appears too; no custom tooltip component.
- **Touch:** touch and pen never produce a hover hint.

## 5. "Shape" section in Properties (`src/lib/PropertiesPanel.svelte`)

- **With a selection**, after Stroke/Width/Cap/Join/Opacity and before Geometry, show a "Shape"
  section (`.section-title`) when one of these holds:
  - every selected node is a rect: **Radius** (`NumberField`, min 0, blank when the rects differ)
    → `setSelectionRectRadius`;
  - every selected node is a polygon (`summarizePolygons`):
    - **Sides** (3–32, blank when mixed) → `setSelectionPolygon({ sides })`;
    - **Star** (`ToggleButton`, "mixed" when mixed) → `setSelectionPolygon({ star })`;
    - **Inner %** (10–95, shown when any is a star, blank when mixed)
      → `setSelectionPolygon({ innerRatio })`.

  Otherwise there is no Shape section.
- **With nothing selected, or whenever the polygon tool is active** ("Defaults for new shapes"),
  after the style defaults, show a "New polygons" section (`.section-title`) (amended at final
  review: the tool selects each new polygon, which hid the defaults while drawing):
  - **Sides** → `setPolygonPrefs({ sides })`;
  - **Star** → `setPolygonPrefs({ star })`;
  - **Inner %** (shown when `prefs.polygon.star`) → `setPolygonPrefs({ innerRatio })`.
- **Rect radius summary:** move it from `ContextBar.svelte` into a pure helper in
  `state/properties.ts`: `summarizeRects(doc, ids): { radius: number | null } | null`. It returns
  `null` unless every selected node is a rect, and `radius` is `null` when the rects differ.
- **Narrow screens:** the fields live in the Properties drawer, like the other properties.

## 6. Docs

- **CLAUDE.md:**
  - architecture map: `ContextBar` removed; `hover-hint.ts` added;
  - the M2d gotcha's "bar controls are 32px" still applies to the top bar;
  - a new gotcha: any `title` shows in the status bar on mouse hover, so write titles as short
    action descriptions with the shortcut.
- **README:** "Keyboard" is unchanged. The Status list says the toolbar is icon-only with tooltips.
- **CHANGELOG:** a new entry. It marks the M2d entry's context-bar bullets as superseded by M2e
  (the log is append-only: add a "Superseded" line in the new entry, don't edit the old one).

## 7. Testing

- **Unit:**
  - `hintFrom`: a title found on an ancestor; no title; an empty title; touch or pen → null;
    a null target.
  - `summarizeRects`: all rects with the same radius, different radii, a mixed selection, and an
    empty selection.
- **Build:** 0 errors, 0 warnings. Lint and format clean. Existing tests are unchanged; the
  M2c/M2d polygon and toggle tests still pass.
- **Browser (controller, on a separate port, with screenshots of each state below):**
  - the top bar with and without a selection;
  - the open File menu;
  - the Properties panel with rects selected, with polygons selected (including a mixed star
    selection), and with nothing selected;
  - every top-bar button has an `aria-label` and a `title`;
  - disabled buttons carry the reason text;
  - hovering a button shows its title in the status bar, and moving off shows the tool hint again;
  - the Radius, Sides, Star and Inner fields edit the selection with one undo step each;
  - the defaults fields change `prefs.polygon`, and the next drawn polygon uses them;
  - at 768px and at 820px wide the top bar is one row with no overflow;
  - there is no `ContextBar` element left;
  - no console errors.
