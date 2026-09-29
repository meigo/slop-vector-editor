# M21 — Brush tool (pressure-sensitive freehand, baked)

Date: 2026-09-29. Status: approved in brainstorming (2026-09-29).

## 0. Summary

A **Brush** tool (shortcut **B**) that paints expressive, pressure-sensitive marks — slop-paint's
Smooth brush, in vector. Each stroke is a variable-width outline from `perfect-freehand`, simplified
to a few cubics by Paper's `simplify`, and committed as an ordinary **filled `path`** — no metadata,
no live re-editing (a later milestone may add that; see §7). It paints with the default **stroke**
colour, as Illustrator, Affinity and Figma do.

The project design (§8, 2026-09-16) listed this as "freehand pencil/brush → simplified bezier with
pressure". This milestone is the brush half; an Inkscape-style constant-width pencil is not planned.

### Rulings (from brainstorming)

1. **Expressive brush, not an editable-centreline pencil.** Pressure-driven width, tapered ends.
2. **Baked now, go-live possible later.** The committed shape is a plain filled path. The tool keeps
   the raw centreline and pressures in memory while drawing (never saved), so a later milestone can
   add `data-sv-brush` metadata without reworking the tool.
3. **Colour: the default stroke paint becomes the fill, with no stroke** (Blob Brush convention).
   Fallback chain when the default stroke is none: the default fill, then opaque black. Opacity is
   the default style's opacity.
4. **Settings:** Size, Pressure, Taper, Stream, Smooth — all five, as slop-paint ships them.
5. **Pipeline: perfect-freehand + Paper `simplify`** (approach A). Fallback when Paper fails to load:
   commit the unsimplified outline (approach C) with a warning notice — ink is never lost.
6. **A tap makes a dot.**
7. **A stroke does not change the selection.**

## 1. Reuse from slop-paint

slop-paint's engines, and what this milestone takes (the same engine lives in slop-animator and
slop-spine):

| slop-paint                | Taken? | Why                                                               |
| ------------------------- | ------ | ----------------------------------------------------------------- |
| `brush.ts` (Smooth)       | Yes    | Already produces a closed outline polygon — vector geometry.      |
| `stroke-smoothing.ts`     | Yes    | Pure: Stream's rope, catch-up, `smoothPath`, `pauseBreaks`.       |
| `calligraphy-brush.ts`    | No     | Hundreds of overlapping hulls, not one outline. A later brush.    |
| `ink-brush.ts`            | No     | Variable-width centreline strokes; SVG strokes have one width.    |
| `stamp-brush.ts`          | No     | Raster tips.                                                      |
| `pressure-curve.ts`       | No     | Not requested (YAGNI).                                            |

Ported code keeps a header naming its source file, so a fix in one app can be carried to the other.

## 2. Input

- `ToolEvent` gains **`pressure: number`** (0–1) and an optional **`samples`** list —
  `{ doc: Vec; screen: Vec; pressure: number; time: number }[]` — built in `Canvas.svelte` from
  `PointerEvent.getCoalescedEvents()` on `pointermove` (falling back to the event itself where the
  browser has no coalesced list). A Pencil samples at up to 240 Hz while `pointermove` fires at
  display rate; without the coalesced events a fast curve becomes straight segments and pressure
  steps. Only the brush reads `samples`; every other tool is unchanged.
- **Pressure counts only from a pen.** A mouse reports a flat 0.5 while pressed and an iPad finger
  reports nothing useful, so for `pointerType !== "pen"` the tool draws at a **constant width**
  (pressure range 1, as slop-paint does). No simulated (velocity-based) pressure.
- Pointer routing (`input/route.ts`) is unchanged: a second finger during a finger stroke starts a
  pinch, which `cancel`s the stroke; a finger during a Pencil stroke is ignored (invariant 16).

## 3. The tool (`src/tools/brush-tool.ts`)

Lifecycle — like the pen, the stroke is a **draft that never enters the document** until pen-up
(invariant 33), which is what makes a stroke one undo step:

- **down:** start the draft; anchor the rope at the press point.
- **move:** each sample (the coalesced list, else the event) passes through **Stream** — the rope,
  in **screen** px, so it feels the same at every zoom — and the accepted points (doc position,
  pressure, time) are appended to the centreline.
- **Preview, per move:** apply **Smooth** (`smoothPath`, corners kept where the pen paused), build
  the outline, and publish it in the overlay.
- **up:** the rope catches up to the pen (as a lift does in slop-paint); the final outline is built
  with `last: true` and handed to `ctx.commitBrushStroke(outline)`. The draft ends; the preview
  moves to the overlay's `pending` list until the store commits it.
- **cancel** (`pointercancel`, a palm, a pinch taking over): **discard** — a brush stroke is one
  gesture, so there is nothing worth keeping, unlike the pen's multi-click draft.
- **Escape** while drawing discards it (`keydown` while `busy()`); **`discard`** (undo, redo,
  replace) drops it.
- **hover:** updates the size cursor (§5).
- **activate:** preloads Paper (`loadPaper()`, errors swallowed — the commit reports them).
- **Tap:** a press with no movement still commits — perfect-freehand gives a round dot (or a
  smaller tapered dot) of the current width. Stippling works.

## 4. Geometry and commit

### 4.1 Pure modules

- `src/brush/smoothing.ts` — port of slop-paint's `stroke-smoothing.ts` (rope, `catchUpPath`,
  `smoothPath`, `pauseBreaks`, constants), with its tests.
- `src/brush/outline.ts` — the **only importer of `perfect-freehand`** (static import; it is ~3 KB,
  pure, MIT). `brushOutline(points, settings, pressureRange, last): Vec[]` — port of
  `strokeOutline`, `widthRange` and `decimationSmoothing` (the thin-stroke hole fix). Size is in
  **document px**. Also `outlineSubpath(outline): Subpath` — the unsimplified, exact form: the
  midpoint-quadratic curve slop-paint fills, elevated to cubics, closed.
- `src/brush/settings.ts` — `BrushPrefs`, defaults, clamps (`clampPress` etc.), and the
  percentage → px mappings for Stream and Smooth (slop-paint's `ropeLength`, `pathSmoothRadius`).

### 4.2 The store action `commitBrushStroke(outline, zoom)`

Reached through `ToolContext.commitBrushStroke(outline)` (the context supplies the zoom at the time
of the stroke), exactly as `placeTitle` is — tools never import the store (invariant 12).

1. **Layer check:** a hidden or locked current layer refuses with `blockMessage(b, "draw")`
   (invariant 25). The tool also checks at pointer-down (via the same predicate, exposed through
   the context) so a refused stroke is refused before it is drawn, not after.
2. **Simplify:** `simplifyOf([outlineSubpath(outline)], tol ** 2)` with `tol` a fixed number of
   **screen px at the stroke's zoom**, divided by the zoom — ~0.5 px, the exact constant measured in
   the plan (as M11 measured `TOL_FRACTION`). The square is Paper's squared-distance tolerance
   (`simplify-edit.ts`). What you drew is what you get at the zoom you drew it at.
3. **Fallback:** if Paper's load rejects, commit `outlineSubpath(outline)` unsimplified and raise
   one **warning-level (`error`) notice** per session: the stroke is kept but heavy.
4. **Validity:** a result with fewer than 2 nodes in total, or zero area, is dropped silently (the
   importer would drop it — the M2 constraint).
5. **Insert** with `addShape(app.doc, layerId, shape)` — identity transform, style per ruling 3 —
   and `commitDoc`. One undo step. The selection is **not** touched (ruling 7).

### 4.3 Ordering and the await

- A stroke **inserts** a new node; it never edits existing ones and never commits from a stale base
  document, so the document moving during the await is harmless — the stroke lands on whatever the
  document is when it resolves (invariant 15 does not apply). The layer check is repeated after the
  await; `cancelActiveGesture()` runs immediately before the commit, as in `placeTitle`.
- **Strokes commit in order:** the store chains each commit on the previous one's promise, so
  strokes drawn while Paper is still downloading land in drawing order.
- The pending preview is removed from the overlay when its commit settles (landed, refused or
  dropped), so a stroke never flickers out between pen-up and commit.
- `replaceDocument` (open/new/restore) during a pending commit: the stroke is dropped (it belonged
  to the previous document). Undo/redo during one: it still lands — it was drawn after.

## 5. Overlay and cursor

A new overlay kind:

```ts
{ kind: "brush"; fill: Paint; live: Vec[] | null; pending: Vec[][]; cursor: { at: Vec; r: number } | null }
```

- `live` and each `pending` outline are drawn as filled polygons in the stroke's **real colour and
  opacity** (`fill`), not the accent — what you see is what lands.
- The **size cursor** is a circle of diameter Size at the hovering pointer (mouse, or a Pencil
  hovering on a supporting iPad), drawn on the overlay's usual contrast halo (a white line
  under the accent ring). Hidden while drawing and when the pointer leaves the canvas.
- The overlay is one slot (as today): while the brush tool is active it owns it.

## 6. Settings UI and prefs

- `prefs.brush: { size: number; pressure: number; taper: boolean; stream: number; smooth: number }`
  — defaults **8 / 3 / true / 0 / 30**; ranges size 0.5–500 (doc px), pressure 1–8 (0.5 steps),
  stream and smooth 0–100 (%). `sanitizePrefs` checks each field alone, falling back to the default
  (the `polygon` precedent).
- **"Brush" `FieldSection`** (new `SECTION_IDS` entry `brush`), shown in Properties **while the
  brush tool is active**, whatever is selected. Rows: Size (`px`), Pressure (`×`), Taper
  (`ToggleButton`), Stream (`%`), Smooth (`%`). Draggable `NumberField`s; each change writes the pref
  (`setBrushPrefs`, as `setPolygonPrefs`).
- **Tool strip:** after Pen, Lucide's `Brush` icon, "Brush (B)". Shortcut **B**.

## 7. Out of scope

Live strokes (`data-sv-brush`), the calligraphy nib, a pressure-curve editor, merging a stroke into
an overlapping same-colour shape (Blob Brush merge), eraser, a constant-width pencil.

## 8. Testing and verification

- **Unit (TDD):** smoothing port (slop-paint's tests carried over); outline (width envelope,
  constant width for pressure range 1, taper, a tap's dot, no hole in a thin stroke,
  `outlineSubpath` closes and is exact at its points); settings clamps and prefs sanitising; the
  tool with `fake-context` (a stroke calls `commitBrushStroke`; cancel/Escape/discard do not; mouse
  gives constant width; a blocked layer refuses at down; samples are consumed); the store action
  (tolerance, fallback on load failure with one notice, ordering, a layer locked during the await,
  the fill fallback chain, selection untouched).
- **Build:** 0 errors, 0 warnings; `perfect-freehand` lands in the app chunk; `paper-core`,
  `opentype` and the catalogue stay in their own chunks.
- **Browser (desktop Chrome, mouse):** strokes, dot, Stream, Smooth, the size cursor, undo, a stroke
  with Paper cold, the Brush section, the shortcut.
- **Owed (recorded in CHANGELOG):** iPad — Pencil pressure, coalesced density, palm rest, a pinch
  cancelling a finger stroke, Pencil hover cursor; Safari.
