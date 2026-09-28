# slop-vector-editor — milestone 19 design: align and distribute

Date: 2026-09-28. Status: approved in chat (three choices, then "just go on and don't ask").
Implements the post-v1 list's "align & distribute".

## 1. What

- **Align** (6): left, horizontal centre, right, top, vertical centre, bottom. **Two or more**
  selected → aligned to the selection's bounds (the outermost object on that side stays put).
  **One** selected → aligned to the artboard (`0, 0, w, h`).
- **Distribute** (2): equal horizontal / vertical **gaps**, for **three or more** objects: the two
  outermost (smallest left/top edge, largest right/bottom edge) stay put, the rest are placed in
  order of their left/top edge so every gap between neighbours is equal — negative when they
  overlap.
- **Bounds**: each selected node's axis-aligned document-space bounds (`nodeBounds(node,
  parent)`), the ones the selection frame and snapping use. A rotated object aligns by its visible
  extent; a group moves as a unit. A node with no bounds is left out.
- **Every command is a move**: each node gets its own translation, composed into its transform in
  its parent's space (`inParent`, invariant 26) exactly as `translateNodes` does — so titles,
  polygons, gradients and strokes stay live. One undo step; a command that moves nothing returns
  the same document (invariant 1).

## 2. Architecture

- `src/doc/align.ts`: `AlignOp = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"`,
  `alignNodes(doc, ids, op): Doc`, `distributeNodes(doc, ids, axis: "h" | "v"): Doc`, sharing a
  private `moveEach(doc, deltas: Map<string, Vec>)`.
- Store: `alignSelection(op)`, `distributeSelection(axis)` — `cancelActiveGesture()` first
  (invariant 15), no-op on an empty selection.

## 3. UI

- A collapsible **Align** section (`FieldSection`, id `align`, added to `SECTION_IDS`) at the top
  of the Properties panel, shown whenever something is selected: row 1 the six align buttons, row
  2 the two distribute buttons. Titles (status-bar hints, invariant 24) say what happens: "Align
  left edges" with several selected, "Align left to the artboard" with one. Distribute with fewer
  than three selected is `aria-disabled` with "… — select three or more objects".
- The **Object** menu gets the same eight commands as a text group (disabled with reasons alike).
- Lucide icons: `AlignStartVertical`/`AlignCenterVertical`/`AlignEndVertical` (left/centre/right),
  `AlignStartHorizontal`/`AlignCenterHorizontal`/`AlignEndHorizontal` (top/middle/bottom),
  `AlignHorizontalSpaceBetween`/`AlignVerticalSpaceBetween` (distribute) — each checked visually
  against its command (Lucide's flip aliases proved backwards once).
- No keyboard shortcuts.

## 4. Testing

Unit (`align.test.ts`): each align op with several objects and with one (artboard); distribute
with mixed sizes, unsorted selection order, overlap, fewer than three (same doc); a child of a
rotated/translated parent moves in document space; groups keep children's transforms; same
reference when already aligned. Store: one undo step. Browser: the section, both reference
cases, distribute, the icons' meanings.
