# M23 — Document resize: crop/extend and scale drawing

2026-10-02. Prompted by slop-paint's Resize… (paint `20cad47`), reported by the slop-paint session.

## 1. Purpose

Document settings today takes a new width and height and changes only the artboard: the drawing
stays where it is, pinned to the top-left. Two jobs are wanted, about equally:

- **Crop/extend** — change the page around the art: add margin, or crop to a new format
  (1920×1080 → 1080×1080), with a 3×3 anchor deciding where space is added or taken. The drawing
  keeps its size.
- **Scale drawing** — scale everything with the page, as resizing an image does (a 300×300 icon
  redone at 1200×1200). Strokes scale too.

Decided with the user:

- Strokes scale in Scale drawing (the drawing looks the same, only bigger or smaller).
- **Scale drawing is always uniform.** A non-uniform scale would turn titles into plain paths with
  their text lost (invariant 44) and rotated rectangles/ellipses into paths; it is not offered.
  Stretching to a new aspect is done with Crop/extend.
- It lives **in Document settings**, not a separate dialog: one place for the page size.

Success: both modes are one undo step; a uniformly scaled document keeps every title, polygon,
rectangle, ellipse and gradient live; a crop/extend bakes nothing; the saved file round-trips.

## 2. The dialog

Document settings' Size row becomes a Size section:

- A segmented toggle, **Crop/extend · Scale drawing** (two `ToggleButton`-style buttons with
  `aria-pressed`, `.ui-on` for the active one). Crop/extend is selected each time the dialog
  opens.
- **W** and **H** fields, with a **Keep ratio** link button (Lucide `Link`/`Unlink`) between them.
  - **Crop/extend:** the link is the user's choice, off each time the dialog opens. While on,
    typing one side sets the other from the document's _current_ ratio (`w0 : h0`), rounded to a
    whole pixel — slop-paint's `linkedSize`. Turning it on brings H in line with W.
  - **Scale drawing:** the link is always on, shown pressed and `aria-disabled` with the title
    "Scale drawing always keeps the ratio". The scale factor is `k = typed side ÷ its current
    value`; the other side shows `old × k` rounded to 2 decimals. The art is scaled by exactly `k`
    (§3), so the page and the art disagree by under 0.005 px. Switching from Crop/extend into
    Scale drawing re-derives H from W the same way.
- A **3×3 anchor** grid of nine 32 px buttons, shown only in Crop/extend, centre selected by default
  (each open). Each is a `<button>` with `aria-pressed` and a title, e.g. "Anchor top left — the
  art's top-left corner stays put". Hidden in Scale drawing, where the art scales from the page's
  top-left (the origin) and an anchor has no meaning.
  - This is a layout change driven by a mode inside a modal, chosen by the user's own tap, not a
    passive state; invariant 23's "a state change must not move the layout" is about the app's
    bars and panels and is not engaged.
- Validation: both sides must pass `isValidArtboardSize`; in Scale drawing, `k` must also pass
  §3's coordinate bound. While invalid, Apply is disabled as today and a one-line reason shows
  under the fields ("Too large — at most 100000 px a side" or "Scaling by 1e4× would put the
  drawing out of range").
- **Apply** stays one undo step: the rename (not an undo step, as now), then one document commit
  carrying the size change and the background.

Untouched: the Name and Background rows. The file-name button still opens this dialog.

## 3. The edits

A new pure module `src/doc/doc-resize.ts`. No DOM, no store.

### `extendCanvas(doc, w, h, ax, ay): Doc`

`ax, ay ∈ {0, 0.5, 1}`. Offset `d = (ax · (w − w0), ay · (h − h0))`. Every **top-level** node of
every layer gets `d` added to its transform's translation (`e += dx, f += dy`) — exact, nothing
re-derived (invariant 26); nested nodes are untouched because they move with their parent. Layers
have no transform, so top-level nodes are in document space. Then the artboard becomes `w × h`.

- **Hidden and locked layers and objects move too.** This is a change to the page, not an edit of
  the art; leaving locked content behind would shift it against everything else.
- Nothing is baked: polygons, titles and gradients stay live. Gradients live in shape space and
  need no mapping. A running tool gesture (a Warp session) is settled first by the store (§3, Store).
- `d = (0, 0)` with an unchanged size returns the **same** doc (invariant 1).
- Art pushed off the page by a crop is kept, not deleted — exactly as if it had been dragged
  there.

### `scaleDrawing(doc, k): Doc`

`k > 0`, finite. Every top-level node of every layer goes through the existing `resizeNode(node,
scale(k))` — about the origin, in document space, which is each top-level node's parent space — so
geometry bakes through `bakeShape` exactly as a handle resize does (invariant 11): rectangles,
ellipses and polygons stay live under any rotation (a uniform scale commutes with it), titles keep
their text through `scaleTextMeta` (invariant 44), gradients follow through `mapStyle` (invariant
46), the odd-polygon flip path is never taken (no flip). Then:

- **Every shape's stroke width is multiplied by `k`**, document-wide, hidden and locked included —
  `scaleDetails(shape, k)` (which runs before the bake, together with the radius) is separate from
  `bakeShape`, so the resize tools' "strokes keep their width" (invariant 11) is unchanged.
  Shapes with `stroke: null` are returned as they are. A title's stroke scales the same way.
- **Every rectangle's corner radius `rx` is multiplied by `k`** in the same pass — `bakeShape`
  keeps radii fixed on resize ("stroke widths and corner radii never scale", spec M2a §1), and the
  drawing would otherwise not look the same. `scaleDetails(shape, k)` is applied to every shape
  **before** the bake, so the bake's clamp `min(k·rx, k·w/2, k·h/2)` equals `k · min(rx, w/2, h/2)`;
  scaling after the bake would clamp twice on a scale-down.
- The artboard becomes `w0·k × h0·k`, then rounded to 2 decimals per side as the dialog shows.
- `k === 1` returns the same doc.
- **Range:** refused (the dialog disables Apply, §2) when `w0·k` or `h0·k` fails
  `isValidArtboardSize`, or when any node's bounds scaled by `k` would exceed `MAX_COORD` (1e9,
  `svg/parse.ts`) — the importer would reject such a file (invariant 8). The check is a pure
  `scaleRefusal(doc, k): string | null` the dialog and the store both read, so they can't disagree
  (the `booleanRefusal` pattern).
- Hidden content scales too (`resizeNode` already visits hidden children of a group; a hidden
  top-level node is included explicitly). Note `warpNode`'s "never warp a hidden descendant" rule
  does not apply here: the scale is about the origin, not fitted to visible bounds, so nothing is
  extrapolated.

### Store

`applyArtboard(artboard)` becomes `applyDocumentSize(size, background)` where `size` is
`{ mode: "extend", w, h, ax, ay } | { mode: "scale", k }`. It calls `cancelActiveGesture()` first
(invariant 15, review M7), builds the next doc with `setArtboard` for the background plus the
mode's edit, and commits once. The selection survives: ids don't change. `enteredGroupId`,
`nodeTarget`, `charSel` etc. are re-resolved by `setSession` as usual. A running text session ends
through the existing `setSession` leave if its title is no longer a title (it remains one, since
the scale is uniform).

Notice after Apply in Scale drawing: none on success. After a refusal reaching the store (should
not happen with the dialog's check): an error notice with `scaleRefusal`'s reason, document
unchanged.

## 4. Files

- `src/doc/doc-resize.ts` — new: `extendCanvas`, `scaleDrawing`, `scaleDetails`, `scaleRefusal`,
  `sizeRefusal`, `linkedSize`, `scaledSide`.
- `src/state/appState.svelte.ts` — `applyArtboard` → `applyDocumentSize`.
- `src/lib/DocumentSettingsDialog.svelte` — the Size section.
- `src/lib/AnchorGrid.svelte` — new, the 3×3 grid (presentational: `value`, `onchange`).
- README, CLAUDE.md (architecture map; invariant 11 gains a note that Scale drawing is the one
  place strokes and corner radii scale with a resize), CHANGELOG, IPAD-CHECKLIST.

## 5. Testing

Unit (`src/__tests__/doc-resize.test.ts`):

- `extendCanvas`: each of the nine anchors' offsets for a grow and a shrink; hidden and locked
  layers and objects move; a nested node's own transform is untouched; no-op returns the same
  reference; a polygon and a title stay live.
- `scaleDrawing`: a rectangle, a rotated rectangle (still a rect), an ellipse, a polygon (still a
  polygon), a title (keeps `text`, size × k), a linear and a radial gradient's points × k, stroke ×
  k on shapes and titles, a rounded rectangle's `rx` × k, `stroke: null` untouched, a group's children, hidden content, `k = 1`
  same reference, artboard × k rounded.
- `scaleRefusal`: too large an artboard, coordinates past `MAX_COORD`, a valid case.
- `linkedSize` / `scaledSide`: the ratio maths and rounding.
- Round trip: `serializeDoc` → `parseSvg` of a scaled document gives back titles and polygons.

`test:ipad`: open Document settings from the file name, choose Scale drawing, type W × 2, Apply —
an object's on-screen width relative to the artboard's is unchanged and the status bar size
doubles; then Crop/extend with the top-left anchor, W + 200 — the object's distance from the
artboard's left edge is unchanged. Each must fail without the behaviour (read its screenshot).

Browser: the anchor's effect at all corners in Chromium; the Keep ratio link in both modes.

Owed on the iPad: the dialog's controls by finger (anchor buttons, the link), the numeric keyboard.

## 6. Out of scope

- A percentage field for Scale drawing (W/H with the ratio locked covers it).
- Non-uniform Scale drawing (decided against, §1).
- A "Scale strokes" toggle (decided: strokes always scale in Scale drawing).
- Fitting the page to the drawing's bounds ("trim to content").
