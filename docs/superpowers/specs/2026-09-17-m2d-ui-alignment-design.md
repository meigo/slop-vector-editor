# slop-vector-editor — milestone 2d design: UI alignment with slop-animator

Date: 2026-09-17. Status: approved in brainstorming. Scope is the look and the controls, not the
layout. The font becomes the system UI font. This milestone runs before M3a.

The rules come from `../SLOP-TIMELINE-UI.md` (the family UI guide), with one deliberate
exception: control height (§4). The reference implementation is `../slop-animator/src/app.css`.

## 1. Scope

In:
- typeface
- field colour
- one on-state idiom
- toggle buttons instead of checkboxes
- selected-row and focus styles
- the labelled File menu
- group separators and no-wrap bars
- the unsaved-changes indicator
- section titles
- tabular digits

Out:
- the layout: tool strip, context bar, right panel and its narrow-screen drawer, status bar and
  modifier dock stay where they are
- features
- sliders (the app has no range inputs yet)
- keyboard navigation in menus (M5 a11y)
- changes to slop-animator

## 2. Typography and tokens (`src/app.css`, `index.html`)

- **Font:**
  - `--font-sans` becomes `system-ui, sans-serif`.
  - `--font-mono` becomes `ui-monospace, SFMono-Regular, Menlo, monospace`. It is used only where a
    fixed-width string helps (hex colour fields).
  - Remove the IBM Plex Mono `<link>`s (and any preconnect) from `index.html`.
- **Sizes:** body text is 14px with line-height 1.4 (`html, body`). Bar and panel text stays
  `text-xs` (12px); section titles are 11px (§5).
- **Digits:** `tabular-nums` on the zoom readout (already), the status bar (already), `NumberField`
  inputs and the hex field.
- **Tokens:** role names and values are unchanged; they already match the guide.
- **Fields are raised** (guide §3):
  - `.field` uses `bg-raised`, not `bg-ground`.
  - The colour swatches in `PaintField` and `DocumentSettingsDialog` also use `bg-raised`.
  - `NumberField` and `<select>`s use `.field` (or the same colours) so every input matches.

## 3. On-state, selection and focus (`src/app.css`)

Add these rules outside any `@layer`, so no Tailwind utility can override them (guide §6: a
`class:` directive layered over a utility colour is decided by emit order):

```css
.ui-on { background-color: var(--color-accent); color: var(--color-accent-text); }
.ui-on:hover { background-color: var(--color-accent-hover); }
.ui-mixed { color: var(--color-accent); }
.ui-selected, .ui-selected-tint {
  --ui-selected-tint: color-mix(in srgb, var(--color-accent) 10%, transparent);
  background-color: var(--ui-selected-tint);
}
.ui-selected { box-shadow: inset 2px 0 0 var(--color-accent); }
:focus:not(:focus-visible) { outline: none; }
:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 1px; }
```

- **Remove** `.tool-on`, `.dock-on` and `.btn-on`. Their users switch to `.ui-on`:
  - the tool strip
  - the modifier dock (Snap, Shift, Alt)
  - the New-document size presets
  - the open File menu button
- **Fields:** `.field` drops both `focus:outline-none` and `focus:border-accent`, so the shared
  ring is the single focus indicator (amended in review: inputs match `:focus-visible` on a mouse
  click too, so border + ring doubled up).
- **`.ui-selected` / `.ui-selected-tint`** have no users in 2d. They are defined now for the M3a
  layers panel. The edge is an inset shadow, so selecting a row never changes its geometry
  (guide §5).
- **`.ui-mixed`** marks a toggle whose selection is mixed: accent text, no fill.

## 4. Toggles are buttons (guide §6)

Every on/off control becomes a `<button>` with `aria-pressed`. There are no checkboxes left in the
app:

| Where | Label | States |
| --- | --- | --- |
| ContextBar, polygon tool | Star | on / off (prefs) |
| ContextBar, selected polygons | Star | on / off / mixed |
| PaintField (Fill, Stroke) | On | on / off (none) / mixed |
| DocumentSettingsDialog | Background | on / off |

- **Pure helper.** Add `toggleView(v: boolean | "mixed")` in `src/lib/toggle.ts`. It returns
  `{ pressed: "true" | "false" | "mixed"; on: boolean; mixed: boolean }`, and the buttons use it for
  `aria-pressed` and for the classes `ui-on` / `ui-mixed`.
- **Clicking:** a click sets `true` when the state is `false` or `"mixed"`, and `false` when it is
  `true`. This is the same rule as the M2c indeterminate checkbox.
- **Markup:** each toggle is written with one complete class expression (guide §6: never layer
  `class:` colour directives over a base that sets a colour).
- **PaintField label.** The text after the paint label ("on" / "none" / "mixed") goes. The toggle
  button reads "On", and its state is carried by fill (on), accent text (mixed) or plain (off).
  Unchanged behaviour: turning a mixed or off paint on uses the current paint or the fallback.
- **App.svelte:** the `isTextField` exclusion list keeps `checkbox` (harmless), so no change is
  needed.

## 5. Bars, panels, menus and the unsaved indicator

- **File menu (`TopBar.svelte`).**
  - The ☰ icon button becomes a text button: "File" plus a small "▾" (10px, 70% opacity), 32px
    high, `px-2`, `text-xs`.
  - It carries `ui-on` while the menu is open, with `aria-haspopup="menu"` and `aria-expanded`.
  - The menu items and their behaviour are unchanged.
- **Control height.** Every control in the top bar and the context bar is 32px high. That covers
  icon buttons, text buttons, fields, number fields and toggles. Icons stay 18px in the top bar and
  the tool strip, and 14px inside labelled buttons.
  - This is a deliberate difference from the guide's 24px: slop-animator also uses 32px, and 32px
    suits touch on iPad. Record it in CLAUDE.md.
  - The floating modifier dock keeps its 40px touch buttons.
- **Group separators.** Separate control groups with a 1px `bg-line` vertical rule, full bar height
  minus 8px. The top bar already has one; use the same element everywhere.
  - Top bar: [File] [file name] … [Properties toggle] | [undo redo] | [zoom out, %, zoom in, fit].
  - Context bar, selection: [count] | [cut copy paste] | [duplicate delete] | [convert / flatten]
    | [shape fields: Radius or Sides/Star/Inner].
  - Context bar, polygon tool: [Sides] | [Star Inner].
- **No wrapping.** Labels and buttons in both bars get `whitespace-nowrap shrink-0`. Both bars get
  `overflow-x-auto`; the context bar already has it.
- **Unsaved indicator (guide §5).** Delete the inline " ●" span after the file name. When the
  document is dirty, the file name itself turns `text-accent` (the guide's §5 colour for unsaved state; the old dot used `warn`), keeps its `title`, and gets
  `aria-label="{name}, unsaved changes"`. The name's box must not change width or position between
  the clean and dirty states.
- **Section titles.** One shared class in `app.css`:
  `.section-title { @apply text-[11px] font-medium uppercase tracking-wide text-muted; }`. It is
  used for:
  - the Properties heading ("Selection" / "Defaults for new shapes")
  - the Fill, Stroke and Geometry labels, including the PaintField label
  - dialog field-group labels, e.g. the Background row in Document settings
  - The `Modal` title stays as it is (14px semibold).

## 6. Testing

- **Unit:** `toggleView` returns the right values for all three states, and the click rule gives
  the right next value (`nextToggle(v)` in the same file).
- **Build:** 0 errors, 0 warnings. Lint and format are clean. Existing tests are unchanged.
- **Browser, run by the controller** on a separate dev server port, never on the user's :5173:
  - screenshots before and after (top bar, context bar with a selection and with the polygon tool,
    Properties, the New and Settings dialogs);
  - the computed font family is a system font, and no request goes to `fonts.googleapis.com`;
  - every former checkbox is a button with `aria-pressed`, including `"mixed"` for a mixed polygon
    selection and for mixed fills;
  - clicking toggles changes the document as before, with one undo step;
  - Tab shows the focus ring and a mouse click does not;
  - the file name's bounding box is identical when clean and when dirty;
  - at 820px wide, neither bar wraps;
  - the fields' computed background is `raised`;
  - no console errors.
