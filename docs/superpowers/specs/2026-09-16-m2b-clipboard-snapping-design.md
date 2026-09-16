# slop-vector-editor — milestone 2b design: clipboard and snapping

Date: 2026-09-16. Status: approved in brainstorming (clipboard model, paste placement, snapping
scope and guides, approach and design). Extends the v1 spec (§5 snapping, §6 clipboard) and the
M2a design; where they disagree, this file wins for milestone 2b onward.

## 1. Scope

- Clipboard: copy, cut, paste within the app and with other apps (SVG text).
- Snapping: moving, resizing and drawing snap to the artboard and other objects, with guide lines,
  a Snap toggle, and a saved preference.
- Carried from the M2a review: an Alt-drag that ends where it started leaves nothing behind.

Not in 2b: paste of images/bitmaps, grid, smart spacing/distribution guides, snapping to path
nodes (M4), snapping rotation.

## 2. Clipboard

### 2.1 Formats

- Copy writes the selection as a standalone SVG in our own format (`serializeDoc` of a document
  with the current artboard size, no background, one layer named "Clipboard" holding the selected
  top-level nodes in document order, unchanged coordinates and ids). Written as `text/plain`, and
  additionally as `image/svg+xml` inside a copy/cut event.
- Paste accepts any SVG text (`image/svg+xml` preferred, else `text/plain`), parsed with the
  existing importer.

### 2.2 In-app copy

The store keeps a non-reactive `clip = { text, pastes } | null`, set on every copy/cut
(`pastes = 0`). It is the fallback when the system clipboard can't be read and the key for
recognising "our own last copy".

### 2.3 Pure logic (`src/state/clipboard.ts`)

- `clipboardText(doc, ids): string | null` — null when no selected id exists.
- `planPaste(doc, text, clip, view: Box): PastePlan | PasteError` where
  - `PasteError = { error: string }` for unparseable text ("The clipboard doesn't contain an SVG
    drawing."), nothing to paste ("The clipboard drawing is empty."), or no target layer ("Every
    layer is hidden or locked — there is nowhere to paste.").
  - `PastePlan = { doc: Doc; ids: string[]; dropped: string[]; clip: Clip | null }`.
  - Nodes: every top-level node of every parsed layer, in order, appended to the top of
    `targetLayerId` with fresh ids (via `insertNodes`).
  - Placement:
    - **Own copy** (`clip !== null && text === clip.text`): offset `(10·n, 10·n)` with
      `n = clip.pastes + 1`; if the offset bounds don't intersect `view`, centre them on `view`
      instead. Returned `clip = { text, pastes: n }`.
    - **External**: centre the pasted bounds on `view`'s centre. Returned `clip` = the input clip
      (unchanged).
  - `view` is the visible canvas area in document coordinates.
- `edits.ts`: `insertNodes(doc, layerId, nodes, dx, dy): { doc, ids }` (fresh ids, appended,
  translated when `dx`/`dy` ≠ 0; throws for an unknown layer). `withFreshIds` is reused.

### 2.4 System clipboard (`src/persist/system-clipboard.ts`)

- `writeClipboardText(text): Promise<boolean>` — `navigator.clipboard.writeText`; false if
  unavailable or rejected (never throws).
- `readClipboardText(): Promise<string | null>` — `navigator.clipboard.readText`; null if
  unavailable, rejected or empty (never throws).

### 2.5 Wiring

- `window` `copy` / `cut` / `paste` events (App): ignored while a text field has focus or a
  dialog/confirm is open (the browser's own behaviour applies). Otherwise:
  - copy/cut: if something is selected, set both clipboard formats on `event.clipboardData`,
    `preventDefault()`, update the in-app copy; cut also deletes (one undo step).
  - paste: read `image/svg+xml` then `text/plain`; if there is text, `preventDefault()` and paste.
- Buttons and menu items (touch and mouse): Copy/Cut write through `writeClipboardText` (failure
  is silent — the in-app copy still works); Paste reads `readClipboardText()` and falls back to the
  in-app copy; with neither, an info notice "Nothing to paste."
- Store actions: `copySelection(): string | null`, `cutSelection(): string | null`,
  `pasteText(text: string): void`, `pasteFromClipboard(): Promise<void>`. All call
  `cancelActiveGesture()` first. A paste is one undo step and selects the pasted nodes; dropped
  features show the same info notice as Open.
- UI: the context bar shows Cut / Copy / Paste with a selection and Paste without one (Select
  tool). The right-click menu gains Cut / Copy / Paste and now also opens on empty canvas too,
  offering only Paste when nothing is selected. (amended at final review)
- The store exposes `visibleDocBox(): Box` (the canvas viewport in document coordinates).

## 3. Snapping

### 3.1 Pure logic (`src/geom/snap.ts`)

- `SNAP_PX = 8` (screen px; tools pass `SNAP_PX / zoom` as the threshold).
- `type SnapTargets = { xs: number[]; ys: number[] }` (sorted, duplicates allowed).
- `type Guides = { xs: number[]; ys: number[] }`.
- `collectTargets(doc, exclude: readonly string[]): SnapTargets` — artboard `0, w/2, w` and
  `0, h/2, h`; for every top-level node on a **visible** layer (locked included) not in `exclude`,
  its doc-space bounds' left/centre/right and top/middle/bottom.
- `snapValue(values: readonly number[], targets: readonly number[], threshold): { delta; at } | null`
  — the (value, target) pair with the smallest `|target − value| ≤ threshold`; ties go to the
  earlier value, then the smaller target; `delta = target − value`, `at = target`.
- `snapBox(box, targets, threshold, axes: { x: boolean; y: boolean }): { dx; dy; guides }` — per
  enabled axis, `snapValue([left, centre, right])` (or top/middle/bottom); guides hold the snapped
  `at` values.
- `snapPoint(p, targets, threshold, axes?): { p; guides }` — per axis `snapValue([p.x])`.

### 3.2 Where snapping applies (when Snap is on)

- **Move** (select tool): targets collected at drag start excluding the moving ids (after an
  Alt-duplicate, the originals are *included* as targets). Each move: raw `(dx, dy)` (Shift
  constraint applied first) → moved bounds → `snapBox` with axes: both when unconstrained; only x
  for a horizontal Shift constraint, only y for vertical, none for diagonal.
- **Resize** (select tool): only when the frame angle is 0. The handle point (pointer + grab
  offset) snaps with `snapPoint` on the axes the handle moves.
- **Draw** (rect, ellipse, line, polygon): targets collected at pointer-down (whole document);
  both the start point and the current point snap with `snapPoint`, before Shift/Alt shaping. The
  line tool with Shift (45° snapping) does not snap its end point.
- Rotation and marquee never snap.
- Guides: the tool sets the overlay to `{ kind: "guides", xs, ys }` while snapped (null otherwise)
  and clears it when the gesture ends or is cancelled. `Overlay.svelte` draws each as a 1 px line
  across the whole canvas in `--color-guide` (`#ff3ea5`, a new theme token).

### 3.3 Toggle

- `Prefs.snap: boolean` (default true, sanitised, saved).
- `ToolContext.snapEnabled(): boolean`.
- A **Snap** button in the modifier dock toggles it on tap (no hold semantics); `%` toggles it from
  the keyboard (`EditAction { kind: "toggleSnap" }`).

## 4. Select-tool fix carried from M2a

An Alt-drag whose final translation is (0, 0) restores the original document and selection on
`up` (no duplicate, no history).

## 5. Testing

- Unit: `snapValue`, `snapBox`, `snapPoint`, `collectTargets`; `clipboardText`, `planPaste`
  (own copy cascade, off-screen fallback, external centring, errors, dropped report, fresh ids,
  layer targeting), `insertNodes`; prefs `snap` sanitising; `editActionForKey('%')`; select tool
  snapping (move, constrained move, resize) and Alt-drag-back; shape tools snapping; guides overlay
  set/cleared.
- Browser (controller): ⌘C/⌘X/⌘V within the app and cascade; paste SVG text copied from another
  tab/app; menu/context-bar clipboard buttons; snapping guides during move/resize/draw; Snap toggle
  (dock and `%`); no console errors.
- Owed: iPad clipboard permission behaviour, touch.
