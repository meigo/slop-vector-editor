# slop-vector-editor — milestone 2c design: live polygons and stars

Date: 2026-09-17. Status: approved in brainstorming (new shape kind; stretching keeps it a
polygon; editing in the context bar; before M3). Extends the v1 spec, M2a and M2b; where they
disagree, this file wins for milestone 2c onward. It supersedes v1 §"Line, polygon and star are
created as paths" for polygons and stars (lines stay paths).

## 1. Scope

- A polygon/star drawn with the polygon tool stays editable: Sides, Star and Inner ratio can be
  changed after creation.
- It can be moved, rotated, resized (including stretched and flipped), converted to a path,
  copied/pasted, snapped to, saved and reopened without losing that.

Not in 2c: detecting regular polygons in older files or foreign SVG (they stay paths), a corner
radius for polygons, a polygon section in the properties panel, changing the tool's defaults from
a selected polygon.

## 2. Model (`src/doc/document.ts`)

```ts
export type PolygonShape = ShapeBase & {
  kind: "polygon";
  cx: number; cy: number;   // centre, local space
  rx: number; ry: number;   // radii of the ellipse the outer corners sit on, > 0
  sides: number;            // integer 3–32 (for a star: number of points)
  star: boolean;
  innerRatio: number;       // 0.1–0.95; kept when star is off
};
export type Shape = RectShape | EllipseShape | PolygonShape | PathShape;
```

The shape has no rotation parameter: rotation lives in `transform`, like every other shape.

## 3. Geometry (`src/geom/shapes.ts`)

- `polygonSubpath(s)`: one closed subpath of corner nodes without handles.
  - Outer corner `i` (0 ≤ i < sides) is at angle `a = −π/2 + i·2π/sides`, point
    `(cx + rx·cos a, cy + ry·sin a)`. Corner 0 points up.
  - For a star, inner corner `i` is at `a = −π/2 + (2i+1)·π/sides` with radii
    `rx·innerRatio`, `ry·innerRatio`, interleaved after outer corner `i`.
- `toPath` accepts a polygon: same id, name, transform and style; `subpaths: [polygonSubpath(s)]`.
  "Convert to path" (`convertToPath`, `selectionActions().canConvert`) includes polygons.
- Bounds (`geom/bounds.ts`): the bounds of the corner points under the matrix (all segments are
  straight).
- Hit-testing (`geom/hit.ts`): as a path built from `polygonSubpath` (fill by nonzero, outline
  distance), cached per shape object like path outlines.
- Everything built on bounds/hit-testing (selection frame, marquee, snap targets, paste
  placement) works unchanged.
- The old `polygonPath`/`starPath` helpers are removed if nothing uses them any more.

## 4. Resize (`src/doc/resize.ts`)

This keeps the M2a rule: resize is baked into geometry and strokes keep their width. `L` is the
resize in the shape's local space.

- **`L` not axis-aligned** (the resize is at an angle to the polygon's own axes): convert to a path
  first, then bake. This is the same rule as rect/ellipse.
- **`L` axis-aligned**, `L = [sx, 0, 0, sy, tx, ty]`:
  - The centre moves to `L(c)`, and the radii become `rx·|sx|` and `ry·|sy|`.
  - `sx < 0` (horizontal flip) changes nothing more: the corner set is left-right symmetric.
  - `sy < 0` (vertical flip) with an **odd** `sides` also composes a half-turn about the new
    centre: `transform' = transform · [−1, 0, 0, −1, 2cx', 2cy']`. Use this exact matrix, not
    `rotateAbout(π)`, which leaves float noise. The half-turn keeps the result pointing down. With
    an even `sides` the corner set is also top-bottom symmetric, so nothing more is needed.
- Sizes stay > 0: the gizmo's `MIN_SIZE` already guarantees a non-zero frame. A radius that would
  come out as 0 (a degenerate `L`) follows the existing singular-matrix handling (`resizeNode`
  returns the node unchanged when the transform can't be inverted).

## 5. Editing (`src/doc/edits.ts`, store, context bar)

- `setPolygon(doc, ids, patch: Partial<{ sides: number; star: boolean; innerRatio: number }>): Doc`
  - Applies to the selected top-level polygons only; other nodes are untouched.
  - `sides` is rounded and clamped to 3–32; `innerRatio` is clamped to 0.1–0.95. Non-finite values
    are ignored.
  - If nothing changes, the same `doc` is returned.
- Store: `setSelectionPolygon(patch)` calls `cancelActiveGesture()` first and commits one undo
  step. It does not change `prefs.polygon`.
- Context bar (select tool, selection non-empty, **every** selected node a polygon), shown where a
  rect's Radius appears:
  - **Sides**: a number field, blank when the selected polygons differ.
  - **Star**: a checkbox, checked when all are stars and indeterminate when mixed. Clicking it sets
    all of them.
  - **Inner %**: shown when at least one selected polygon is a star; blank when they differ.
  - The fields use the same ranges as the tool's fields.
- A pure helper in `state/properties.ts` summarises the selected polygons for the context bar:
  `{ sides: number | null; star: boolean | "mixed"; innerRatio: number | null; anyStar: boolean }`
  or null when the selection is not all polygons.

## 6. Polygon tool (`src/tools/shape-tools.ts`)

- The tool builds `{ kind: "polygon", cx, cy, rx: r, ry: r, sides, star, innerRatio }` from the
  drag and the prefs (`r` = drag length; nothing is created when `r` = 0). It uses the snapped
  start and end points (M2b).
- Rotation: with Shift, `transform = IDENTITY` (upright). Otherwise
  `transform = rotateAbout(θ, c)` with `θ = atan2(dy, dx) + π/2`, so corner 0 points at the
  pointer as before. When `θ` is exactly 0, use `IDENTITY` so no `-0` entries appear.
- The tool's context-bar fields (prefs) are unchanged.

## 7. File format (`src/svg/attrs.ts`, `src/svg/parse.ts`)

### 7.1 Writing

A polygon is written as a `<path>` with the same attributes a path gets (`d`, `data-sv-nodes`,
transform, name, style) plus:

`data-sv-polygon="<sides> <star 0|1> <innerRatio> <cx> <cy> <rx> <ry>"`

Each number is formatted with `fmt`.

`d` is generated from the numbers **as written**: each parameter is passed through
`Number(fmt(v))` before `polygonSubpath`. Reopening the file then regenerates exactly the same
`d` string, so save → open → save is byte-identical. The canvas uses the same attributes (v1 rule:
canvas and export share `attrs.ts`).

### 7.2 Reading

A `<path>` with `data-sv-polygon` becomes a polygon only when all of these hold:

- the attribute has exactly 7 numbers;
- `sides` is an integer in 3–32;
- `star` is 0 or 1;
- `innerRatio` is in 0.1–0.95;
- `cx` and `cy` are finite with `|v| ≤ MAX_COORD`;
- `rx` and `ry` are finite, > 0 and ≤ MAX_COORD;
- the element's `d` attribute equals the `d` regenerated from those numbers, string for string.

Otherwise the element imports as a normal path. Nothing is added to `dropped`, because the path
itself is intact. This is the lossless rule from CLAUDE.md gotcha #10: an outline edited in
another app is never silently replaced.

The polygon keeps the element's transform, name and style exactly as a path would.

## 8. Other integration

- `NodeView`/canvas render through `shapeAttrs` (§7.1), with no other change.
- Clipboard (M2b) and autosave go through the serializer/importer, so they keep polygons.
- `resizeNodes`, `translateNodes`, `rotateNodes`, `setStyle`, `duplicateNodes`, `insertNodes` and
  `flattenTransform` (paths only) need no special case beyond §4.
- Every `switch` on shape kind must handle `"polygon"`; the TypeScript exhaustiveness errors list
  the places.

## 9. Testing

- **Unit tests:**
  - `polygonSubpath` corners (a pentagon and a 4-point star with rx ≠ ry);
  - bounds;
  - hit inside, on the outline and outside;
  - `toPath`;
  - `canConvert`;
  - resize: uniform scale; stretch; horizontal flip (unchanged); vertical flip with odd sides
    (half-turn) and with even sides (no half-turn), checked by comparing the rendered corner
    points before and after against the expected doc-space points; an angled `L` giving a path;
  - `setPolygon`: rounding, clamping, non-polygons untouched, same reference on no change;
  - the context-bar summary helper;
  - polygon tool output with and without Shift, and `θ = 0` giving `IDENTITY`;
  - serialize → parse → serialize byte-identical, including awkward values (e.g. rx 33.3333333);
  - an edited `d`, a malformed attribute and out-of-range values each importing as a path.
- **Browser (controller)**, on a separate dev server port (never the user's :5173):
  - draw a polygon and a star;
  - change Sides, Star and Inner on one and on a mixed selection;
  - stretch with a side handle;
  - flip vertically through the handles;
  - rotate, then resize along the rotated frame;
  - convert to path;
  - copy/paste;
  - undo;
  - save → open (via the serializer) keeps it editable;
  - no console errors.
