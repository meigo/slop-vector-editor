# slop-vector-editor — milestone 2a design: select, transform, shapes

Date: 2026-09-16. Status: approved in brainstorming (split, resize model, hit-testing approach,
sections 1–3). Extends `2026-09-16-slop-vector-editor-design.md` (the v1 spec); where this file
and the v1 spec disagree, this file wins for milestone 2 onward.

## 0. Scope

Milestone 2 of the v1 spec (§9 item 2) is split:

- **2a (this document):** select tool, transform gizmo, rect / ellipse / line / polygon-star tools,
  hand tool, properties panel, context bar, modifier dock (Shift/Alt), right-click menu, pointer
  routing, two-tab autosave warning.
- **2b (later):** clipboard (copy/cut/paste, system SVG clipboard) and snapping (+ Snap toggle in
  the dock).

Not in 2a: groups UI (group/ungroup/enter group/z-order — M3), layers panel (M3), pen/node (M4).

## 1. Resize model (corrects v1 spec §4)

The v1 spec said move/scale/rotate "only change `transform`". A scaling `matrix()` scales the
stroke too, so that is replaced by:

- **Move and rotate** multiply the node's matrix only.
- **Resize bakes the scale into geometry.** For a node with matrix `M` and a doc-space resize map
  `A`, compute the resize in the node's local space, `L = M⁻¹ · A · M`.
  - If `L` is axis-aligned (|b|, |c| ≤ 1e-9): apply `L` to the geometry, keep `M`.
    - rect: `x, y, w, h` mapped; negative size normalised (flip = swap edges); **corner radius
      is kept** (a parameter, like stroke width), clamped to `min(w, h) / 2`.
    - ellipse: centre mapped, `rx·|L.a|`, `ry·|L.d|`.
    - path: every point and handle mapped. A negative determinant (mirror) keeps node order.
  - Otherwise (non-uniform resize of an object rotated relative to the resize frame): rect and
    ellipse are converted to paths first, then `L` is applied to the path points.
  - **Groups:** the same rule is applied to each child with `L_child = C⁻¹ · L · C` (C = child
    matrix); the group's own matrix is kept.
- Stroke widths never change on resize.
- **Flatten transform** (paths only): bake `M` into the points and set `M` to identity.
- **Convert to path** (rect/ellipse): replace with an equivalent path in the same local space,
  same `M`, same style and name.

## 2. Geometry

- `geom/bezier.ts`: cubic point evaluation, exact cubic bounds (derivative roots), flattening
  (`n = clamp(ceil(controlPolygonLength / 4), 4, 64)` segments).
- `geom/bounds.ts`: `Box = {x, y, w, h}`; `nodeBounds(node, m): Box | null` — geometric bounds
  (stroke excluded) of a node drawn under matrix `m` (rect: 4 corners; ellipse: exact extents;
  path: transformed control points → exact cubic bounds; group: union of children). Empty → null.
- `geom/hit.ts`: `hitTest(doc, p, tol): {layerId, nodeId} | null` — top-most top-level node on a
  visible, unlocked layer. The point and tolerance are mapped into each node's local space
  (tolerance scaled by `1/√|det M|`). A shape is hit when
  - its fill is non-null and the point is inside (rect/ellipse formulas; path: flattened,
    all subpaths implicitly closed, nonzero winding), or
  - the distance to its outline is ≤ `tol + (stroke ? strokeWidth/2 : 0)`.
  A group is hit when any descendant is hit. `marqueeSelect(doc, box)`: top-level nodes on
  visible, unlocked layers whose doc-space bounds lie fully inside `box`.
  Flattened polylines are cached in a `WeakMap` keyed by the (immutable) path object.
- `geom/shapes.ts` adds `polygonPath(cx, cy, r, sides, rotation)`, `starPath(cx, cy, r, inner,
  points, rotation)`, `linePath(a, b)`, `ellipsePath(cx, cy, rx, ry)` (4 kappa arcs), and
  `toPath(shape)`.
- `geom/decompose.ts` (or inside `mat.ts`): `rotationOf(m)` = `atan2(b, a)`, `isSkewed(m)`,
  `isAxisAligned(m)`.

## 3. Selection frame and gizmo

- `selectionFrame(doc, ids): {angle, box} | null`. For a single node whose matrix is not skewed,
  `angle = rotationOf(M)`; otherwise `angle = 0`. `box` = bounds of all selected nodes under
  `rotate(-angle)` (i.e. in the frame's rotated coordinates).
- A resize from `box` to `box'` in the frame is the doc-space map
  `A = rotate(angle) · boxMap(box → box') · rotate(-angle)`.
- Handles: 8 resize handles (corners + edge midpoints) and a rotate knob 24 screen px outside the
  top edge midpoint, all positioned in screen space. Handle size 8 px (mouse) / 16 px (touch, pen).
- `dragHandle(handle, startBox, pointInFrame, mods): Box` — corner moves both axes, edge one axis;
  opposite side fixed, or the centre with Alt; Shift keeps the start aspect ratio (corner) / is
  ignored (edge). Crossing the fixed side flips (negative size allowed in the map). The resulting
  |w| and |h| are clamped to ≥ 0.01 doc units unless the start size on that axis is 0 (a
  horizontal line keeps h = 0 and its y scale is treated as 1).
- Rotation: `delta = angle(pointer − centre) − angle(start − centre)`; with Shift the total
  angle (frame angle + delta) snaps to 15°. Centre = box centre in doc space.

## 4. Model edits (pure, in `doc/edits.ts` + `doc/tree.ts`)

- `tree.ts`: `findTopLevel(doc, id)`, `topLevelIds(doc)`, `targetLayerId(doc)` (top-most visible
  unlocked layer, or null), `mapTopLevel(doc, ids, fn)`, `allShapes(node)`.
- `addShape(doc, layerId, shape): {doc, id}` (assigns id, bumps `nextId`),
  `deleteNodes(doc, ids)`, `duplicateNodes(doc, ids, offset): {doc, ids}` (deep copy, new ids,
  inserted directly above each original), `translateNodes(doc, ids, dx, dy)`,
  `rotateNodes(doc, ids, angle, centre)`, `resizeNodes(doc, ids, A)` (§1),
  `setStyle(doc, ids, partial)` (applies to shapes and to all shapes inside groups),
  `setRectRadius(doc, ids, rx)`, `convertToPath(doc, ids)`, `flattenTransform(doc, ids)`.
- All edits return the same reference when nothing changes and never mutate their input.
- **Invariant:** no edit or tool creates a zero-size rect/ellipse, an empty group or a path
  without nodes. Shape tools create nothing for a drag shorter than 2 screen px.

## 5. Input and tools

- `input/pointer.ts`: `ToolEvent = {doc: Vec, screen: Vec, pointerType, button, mods, pointerId}`.
  Only button 0 (or pen/touch) starts a tool gesture; button 2 opens the context menu;
  `lostpointercapture` is handled like `pointercancel`; `setPointerCapture` is guarded.
- `input/route.ts` (pure): decides per pointerdown between `pinch` (second touch), `pan` (Space
  held, middle button, Hand tool, or a finger after a Pencil was seen) and `tool`.
- `tools/tool.ts`: `Tool = {id, down, move, up, cancel, key?, cursor}`; tools get a
  `ToolContext` (doc, view, selection, setSelection, commit, beginGesture, endGesture, mods,
  prefs, notify, setOverlay, tolerance(pointerType)) so tests can drive them with a fake.
- **Select (V)**: tap selects (Shift toggles); tap on empty clears; drag on empty → marquee
  (overlay); drag on a selected or hit node → move (Alt at drag start duplicates, then moves the
  copies); drag on a handle → resize/rotate. One undo step per drag, none for a no-op.
  Keys: arrows nudge 1 (Shift 10) doc units as one undo step each, Delete/Backspace delete,
  Esc clears, ⌘/Ctrl+D duplicates (offset 10, 10).
- **Rect (R), Ellipse (E)**: drag corner to corner; Shift = square/circle; Alt = from centre.
- **Line (L)**: drag start to end; Shift snaps the angle to 45°.
- **Polygon/Star (Y)**: drag from the centre; distance = radius, angle = rotation; Shift keeps
  the first vertex straight up. Sides 3–32 (default 5), star toggle (default off), inner ratio
  0.1–0.95 (default 0.5) from preferences.
- **Hand (H)**, and Space held: pan.
- New shapes use the current default style and land in `targetLayerId`; if that is null, a
  notice explains that every layer is hidden or locked. The new shape becomes the selection; the
  tool stays active.
- Selection = top-level node ids (`$state.raw` in the store), not in undo history. After undo,
  redo, document replace or any edit, ids that are no longer top-level on a visible, unlocked
  layer are dropped.
- Modifiers: `mods = physical keys ∪ dock latches ∪ dock holds`.

## 6. UI

- **Tool strip** (left, vertical): V, R, E, L, Y, H with icons, titles and shortcut keys.
- **Context bar** (below the top bar):
  - selection: Delete, Duplicate, Convert to path (any rect/ellipse selected), Flatten transform
    (any non-identity path selected), rect corner radius (only rects selected);
  - Polygon/Star tool: sides, star toggle, inner ratio;
  - other tools: a one-line hint.
- **Properties panel** (right, 240 px; a toggleable drawer below 900 px viewport width):
  - Fill and stroke: none toggle, native colour input, hex field, opacity (0–100 %).
  - Stroke width, cap, join; object opacity.
  - X, Y (doc-space bounds top-left), W, H (frame box size), R (frame angle, degrees).
    Editing X/Y translates, W/H resizes the frame box keeping its top-left, R rotates about the
    box centre to the given angle. Each committed field edit = one undo step.
  - Mixed values across the selection show as blank.
  - With nothing selected, the style fields edit the default style for new shapes (saved in
    `localStorage` via `persist/preferences.ts`, validated on load).
- **Modifier dock**: floating Shift / Alt buttons at the canvas's bottom-right; press-and-hold
  or tap to latch (latched = accent fill).
- **Right-click menu** (desktop): the context-bar selection actions.
- **Overlay SVG** above the document: selection outlines, gizmo, marquee — constant screen size.
- **Status bar**: tool hint and selection summary.
- **Two-tab warning** (`persist/tab-presence.ts`, `BroadcastChannel`): a second tab of the app
  makes both tabs show a warning notice that autosave is shared.

## 7. Carried constraints from milestone 1

Pointer-capture handling (§5), the no-empty-nodes invariant (§4), the two-tab warning (§6).
Still deferred: closed-subpath coincident node (M4), surrogate stripping in `escapeAttr` (M3),
`rectPath` duplicate nodes (M4), Modal focus trap / menu keys (M5), iPad pass (M5).

## 8. Testing

- Unit tests: bezier, bounds, hit-testing, marquee, shapes generators, decompose, every edit
  (immutability + same-reference no-ops), selection frame, gizmo handle math, route, each tool
  driven through a fake `ToolContext`, preferences validation, tab presence (Node has
  `BroadcastChannel`).
- Browser pass in desktop Chrome (automation): draw each shape, select, marquee, move, resize
  (incl. rotated + flip), rotate with snap, Alt-duplicate, properties edits, context actions,
  undo/redo, save/reopen round-trip of drawn shapes.
- Owed: touch/Pencil/iPad (M5).
