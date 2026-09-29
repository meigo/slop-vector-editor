# M22 — On-canvas text editing

Date: 2026-09-29. Status: approved in brainstorming (2026-09-29).

## 0. Summary

A title can be edited **in place**: double-click it with the Select tool (or click it with the Text
tool) and a caret appears where you clicked. Type, delete, select text by dragging, with Shift and
the arrow keys, ⌘A, and paste over a selection — on desktop with a keyboard and on iPad with the
on-screen keyboard, which the canvas pans away from. The Properties panel's text field stays and
edits the same string.

M10's spec chose panel typing to avoid "a caret, a hidden input and a selection model" and the
iPad keyboard covering the artwork. This milestone builds exactly those.

### Rulings (from brainstorming)

1. **Caret + selection** — not caret-only, and not per-range styling (titles keep one font/size).
2. **Character picking is unified with the text selection.** A selection of exactly one character
   is today's `charSel`: the Character block edits it, and dragging that selected character moves
   it (M10 §6). Any other drag in edit mode selects text.
3. **Entry:** Select tool double-click on a title; Text tool click on a title; placing a new title
   enters editing with its text fully selected.
4. **iPad:** auto-pan so the caret stays above the on-screen keyboard; the view is not restored.
   The panel field stays as the fallback.
5. **Mechanism: a hidden-textarea mirror** (below). Not an own keystroke model, not a live-text
   overlay.
6. **One undo step per edit session**, as the panel field's focus→blur already is.
7. **Overrides follow their characters** when text is inserted or deleted before them — a
   pre-existing bug in panel typing, fixed for both.

## 1. The mechanism: a hidden-textarea mirror

One `<textarea>` lives in `Canvas.svelte` for the app's lifetime, invisible (opacity 0, no pointer
events), **never** `display: none` (a hidden element cannot take focus). While editing it holds the
title's whole string, and **its selection is the caret and the selection**. The browser therefore
provides — natively, including on iPad — the keyboard, autocorrect, dictation, long-press accents,
IME composition, word and line movement (⌥←, ⌘←, Home/End), Shift-extension, clipboard, and the
field's own undo. The app draws the caret and the highlight, maps clicks to indices, and handles
↑/↓ itself (§3).

- **Index spaces.** Title indices are **code points** (`splitLines`, `runLayout`, overrides); the
  textarea's `selectionStart/End` are **UTF-16 units**. Pure helpers convert between them; every
  crossing goes through them, so an emoji or other astral character never splits.
- **Focus on the tap.** iOS raises the keyboard only when `focus()` is called synchronously inside
  the user's gesture. The store therefore calls a focus function **registered by Canvas**
  (`registerTextFocus`, the `registerGestureCancel` pattern) directly from `beginTextEdit`, which
  the tool calls from its pointer handler — never from an `$effect`. The textarea's font size is
  **16px**: iOS zooms the whole page on focusing a field with a smaller font. It is positioned at
  the caret's screen position so the browser has no reason to scroll to it; focus uses
  `{ preventScroll: true }`.
- **Risk recorded for the iPad pass:** whether WebKit accepts a focus made from `pointerup`. If it
  does not, the fallback is to (re)focus from the `click` that follows the same tap.

## 2. State

- `app.textEdit: { id: string; anchor: number; focus: number } | null` — store state, not saved,
  not undoable (like `charSel`, invariant 40). Indices are code points into the raw string,
  newlines included. `anchor === focus` is a caret.
- `app.charSel` is **derived** from it while editing: a one-character selection
  (`|focus − anchor| === 1`) sets `charSel` to `min(anchor, focus)` unless that character is a
  newline; anything else sets it to `null`. Outside edit mode `charSel` behaves as today.
- `app.caretStops` — cached beside `charQuads` by the same `$effect.root`, from a new
  `caretStops(font, meta)` in `src/text/font.ts`: for every index `0…length` a stop
  `{ x, baseline, top, bottom, line }` in the title's own space, from the **un-jittered** layout
  (the caret stays upright and steady on a randomised title). An index at a line's end — the
  newline's own index, or the text's end — sits after the last glyph; an empty line's single stop
  sits at x = 0 (every alignment anchors a zero-width run at 0).
- Entering while stops are not yet loaded (a click on an unselected title whose font is loading):
  the store keeps the click point and resolves the index when the stops arrive.

## 3. Behaviour

**Enter**
- Select tool: a double-click on a title (applied on pointer-up, invariant 32) — where a path
  would go to the node tool, a title goes to text editing instead, and the tool switches to Text.
- Text tool: a click on any title (hit-tested with `hitTest`, as the select tool does) selects it
  and enters editing with the caret at the click. A drag that starts on a title selects text from
  the press point.
- Placing a title (Text tool, click on empty canvas when not editing) enters editing with the whole
  text selected, so typing replaces "Title". This replaces the current focus of the panel field.
- A title whose font is unavailable (invariant 40, "Available ≠ fetched") does not enter editing;
  a notice says why (the panel's existing message).

**While editing**
- Click inside the title: caret at the nearest stop on the nearest line (by baseline distance,
  then x). Shift-click extends. Double-click selects the word (the textarea's word rules via
  a pure helper). Drag selects from the press.
- Press on the **single selected character** and drag: moves it (`setCharOffset`, today's drag).
- ↑/↓ (and with Shift): the stop on the previous/next line nearest to a remembered goal x — kept
  across consecutive vertical moves, reset by any other movement. At the first/last line they go
  to the text's start/end. Everything else is the textarea's.
- Typing: every `input` event calls `typeTitleText` (quiet, live — invariant 41). The session is
  bracketed as one undo step (`beginUiGesture` on enter; the commit + `endDocGesture` on exit, the
  panel field's exact sequence — the bracket helpers move from `TextPanel` into the store so both
  use one implementation). ⌘Z inside the field is the field's own undo (invariant 41).
- The app's own shortcuts do not fire (a focused text field, as today); copy/cut/paste are the
  field's own (invariant 19).

**Leave** — each commits (`setTitleText`, reporting refusals and putting the text back as the panel
does) and closes the bracket:
- Escape (title stays selected, Text tool stays active); a click outside the title (leaves only —
  the next click places); a tool change; the selection changing to anything else; the textarea
  losing focus (the iPad keyboard's dismiss key); undo/redo/replace from the store (they run
  `settle`-style: the session ends before the store acts).

## 4. Overrides follow their characters

`remapOverrides(oldText, newText, overrides)` (pure, `src/text/edit.ts`): the common prefix and
common suffix of the two strings (in code points) bound the one edited span; an override before
the span keeps its index, one inside it is dropped, one after it shifts by the length change.
`reshapeTitle` uses it whenever the text changes — replacing today's "drop keys ≥ length" — so the
panel field is fixed too. `charSel` outside edit mode is remapped the same way (dropped if its
character was edited away).

## 5. Drawing

The Overlay draws, from store state (not the tool's overlay slot — like the character highlight):
- the selection as one accent rectangle per line (from stop x to stop x, top to bottom), at the
  accent colour with low opacity, under a white halo edge (invariant 23 area: contrast halo);
- the caret as a 1.5px accent line from `top` to `bottom` at the focus stop, blinking (CSS
  animation, 1s steps), solid while the caret moved within the last 500 ms;
- a one-character selection additionally keeps today's jittered character quad outline.
All geometry goes through the title's world matrix, so a rotated or flipped title's caret follows it.

## 6. iPad keyboard

- **Auto-pan:** after entering and after each caret move, if the caret's screen rectangle (plus a
  margin) is not inside the visible area — the canvas host's rectangle intersected with
  `visualViewport` — the view pans by the smallest amount that brings it in (pure
  `revealPan(view, caretRect, visible, margin)`). The view is not restored afterwards. In Chrome
  on iPad `visualViewport` under-reports (shared notes), so the pan lands high — harmless.
- **Page scroll reset** on `focusout`, `visualViewport` `resize` and window `scroll` — the
  mitigation every sibling slop app keeps (shared CLAUDE.md, iPad Chrome keyboard shift). The
  remaining Chrome shift after the keyboard closes is unfixable from the page; the workaround is
  Safari or the Home Screen app.

## 7. Out of scope

Styling part of the text; wrapped paragraph text; shaping and RTL; editing a title's text while it
is inside a warp session (Warp settles first, as any store edit does).

## 8. Testing and verification

- **Unit (TDD):** index conversion (astral characters); `remapOverrides` (insert before/inside/
  after, delete, replace, identical strings); `caretStops` against a bundled font (stops per index,
  line ends, empty lines, alignment); nearest-stop hit; ↑/↓ with goal x; `revealPan`; the Text and
  Select tools' entry/exit and drag-selection with the fake context; the store's session (one undo
  step, `charSel` derivation, leave-on-selection-change, pending-point resolution).
- **Browser (desktop Chrome):** enter by double-click and by Text tool; type, Backspace, arrows,
  ↑/↓ across lines, Shift-select, drag-select, ⌘A, paste over a selection; a one-character
  selection shows the Character block and drags; Escape/click-outside commit; one undo step;
  overrides stay on their characters after inserting before them.
- **Owed:** the iPad pass — focus from the tap, the keyboard appearing, auto-pan, dictation and
  long-press accents, the hardware-keyboard iPad, Chrome's keyboard shift; Safari.
