# slop-vector-editor — milestone 15 design: linear gradients

Date: 2026-09-27. Status: approved in brainstorming (scope, import, interaction, target switch and
coordinate space were each asked and answered; the rest is recorded in §10 as rulings). Taken ahead
of M14 (envelope warp, `2026-09-20-m14-envelope-warp-design.md`), which stays specced and next.
Implements the first half of "gradients" from the project design's post-v1 list (§10).

## 1. What this is for

Colour that changes across a shape: a fade to transparent, a two-tone button, a lit edge on a
stroke. The request was "at least linear, with start/end colour and transparency, and on-canvas
handles to adjust its position".

**In:** linear gradients with exactly two stops (colour + opacity each), on **fill and stroke**; a
**Gradient tool** (G) that draws and adjusts the gradient line on the canvas; Flat/Linear and the two
stops in the Properties panel; saving as real SVG `<linearGradient>`s; importing every foreign linear
gradient the model can represent **exactly**.

**Out** (§11): radial gradients, more than two stops, reflect/repeat spread, patterns, gradients on
the artboard background, gradients as a default style for new shapes.

## 2. The model

`src/doc/document.ts`:

```ts
export type Paint = { color: string; opacity: number };            // unchanged: a flat paint
export type LinearGradient = {
  kind: "linear";
  from: Vec;       // the start stop's point, in the shape's OWN space (like path nodes)
  to: Vec;         // the end stop's point
  start: Paint;    // colour + opacity at `from` (offset 0)
  end: Paint;      // colour + opacity at `to`   (offset 1)
};
export type Fill = Paint | LinearGradient;
// Style.fill and Style.stroke become `Fill | null`.
export const isGradient = (f: Fill | null): f is LinearGradient =>
  f !== null && "kind" in f;
```

- **Stops sit at 0 and 1, always.** There is no offset field. A foreign gradient whose stops sit at,
  say, 20 % and 80 % is represented by moving `from`/`to` along the line (§4) — identical on screen
  under pad spread. One gradient therefore has exactly one representation, which keeps "an edit that
  changes nothing returns the same reference" (invariant 1) a plain field comparison.
- **The flat `Paint` keeps its shape** (no `kind`), so every existing `{ color, opacity }` literal is
  still a valid `Fill` and the file format for flat paint is untouched.
- **Coordinates are in the shape's own space** — the space its `d`/`x`/`cx` live in, under its
  `transform`. Moving and rotating change only the matrix (invariant 11), so the gradient follows for
  free. Everything that **bakes** geometry must bake the gradient too (§5).
- `Artboard.background` and `prefs.style` stay `Paint`: the background and new shapes are flat.

**Degenerate gradients collapse to flat.** SVG paints a gradient whose two points coincide as a
single colour: the last stop's. Such a gradient is stored as that flat `Paint` instead — at import
(§4) and wherever an edit produces one (§5, §7). "Coincide" means **equal as written** (`fmt` of
each coordinate), because that is what the file holds and what a reload would see; testing the
unrounded numbers would let a gradient 1e-7 long save as one and reload as flat. The helper is
`flatIfDegenerate(g: LinearGradient): Fill` in `document.ts`.

**Two equalities, deliberately.** `sameFill(a, b)` is exact — kind, stops and both points — and is
what edits use to return the same reference. `sameColours(a, b)` compares kind and stops but not the
points; it is what the Properties summaries and Select Same use (§8), because two gradients with the
same colours laid across different shapes look like "the same fill" to a person and to the panel,
and because the points are in each shape's own space and cannot be compared across shapes anyway.

## 3. The file format and the canvas

`src/svg/attrs.ts` owns both, so screen and file cannot drift (invariant 3).

```xml
<svg … data-sv-version="1">
  <defs>
    <linearGradient id="sv-grad-12-fill" gradientUnits="userSpaceOnUse"
                    x1="10" y1="20" x2="110" y2="20">
      <stop offset="0" stop-color="#ff3366"/>
      <stop offset="1" stop-color="#ff3366" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g data-sv-layer="" …>
    <path d="…" fill="url(#sv-grad-12-fill)" stroke="#111111" …/>
  </g>
</svg>
```

- **One `<linearGradient>` per gradient paint, never shared.** Its id is
  `sv-grad-<node id>-<fill|stroke>` — deterministic, unique (node ids are), and needing no reference
  counting or de-duplication. `stop-opacity` is written only when it is not 1, as `fill-opacity` is
  today; a gradient paint writes no `fill-opacity`/`stroke-opacity` of its own — its opacity lives in
  the stops.
- `gradientUnits="userSpaceOnUse"` is SVG's name for the element's own coordinate system *including*
  its `transform` attribute — exactly §2's space, so the numbers are written as stored, through the
  same `fmt` as every coordinate.
- **`gradientDefs(s: Shape): GradientDef[]`** (new, `attrs.ts`) returns the zero, one or two
  gradient elements a shape needs (`{ id, attrs, stops: Attrs[] }`); `styleAttrs` writes the matching
  `url(#…)`. `styleAttrs` therefore needs the node id: its signature becomes
  `styleAttrs(s: Style, id: string)`.
- **`serializeDoc`** writes one `<defs>` as the root's first child (before the background rect),
  holding every shape's gradients in document order, and omits it when there are none — so a
  document without gradients serializes **byte-identically** to today.
- **The canvas** (`NodeView.svelte`) renders a `<defs>` holding a shape's `gradientDefs` immediately
  before the shape, when it has any. SVG allows `<defs>` anywhere, and ids are page-unique because
  node ids are and the canvas is the only live inline copy of the document (PNG export rasterises a
  serialized string in its own image, spec M12).
- Hit-testing is unchanged: `geom/hit.ts` tests `style.fill` for truthiness, and a gradient fill is
  a fill.

## 4. Import

`src/svg/parse.ts`. Rule: **keep a gradient exactly or drop it and say so** (invariant 4's spirit —
never draw something differently without saying). Every 2-stop, pad-spread, non-degenerate linear
gradient is exact under our model, whatever its units, transform or offsets, because a linear
gradient's colour is an affine function of position and stays one under any invertible affine map:

1. **Collect paint servers first.** One pre-pass over the whole tree records every element with an
   `id` whose name is `linearGradient`, `radialGradient` or `pattern` (they live in `<defs>`, which
   the converter skips silently, but may appear anywhere, and may be referenced before they appear).
2. **Resolve `href` / `xlink:href` chains** (Inkscape always writes one: a gradient carrying the
   coordinates points at another carrying the stops). An attribute or the stop list not present on a
   gradient comes from the one it references; a cycle or a chain longer than 16 is dropped.
3. **Paint values keep the reference.** `fill="url(#g)"` (optionally with a fallback colour,
   `url(#g) #f00`) is carried through inheritance **unresolved**, because SVG resolves it against
   the element that is *painted*, not the one that declared it: an inherited `userSpaceOnUse`
   gradient is in each child's own space, and an `objectBoundingBox` one uses each child's own box.
   `colors.ts` gains `{ kind: "url"; id: string; fallback: ParsedColor | null }`.
4. **Resolve per shape**, after its geometry is built, against its own-space bounding box (the
   geometric box, no stroke — `nodeBounds({ ...shape, transform: IDENTITY }, IDENTITY)`, since
   `nodeBounds` applies the node's own transform):
   - **Units.** `userSpaceOnUse` coordinates are own-space as they stand; `%` values in it are
     percentages of the artboard (SVG's viewport). `objectBoundingBox` (SVG's default when
     `gradientUnits` is absent) maps `(u, v)` to `(box.x + u·box.w, box.y + v·box.h)`; a box with zero
     width or height paints nothing in SVG, so that paint becomes `null` and is reported. Missing
     `x1 y1 x2 y2` default to `0% 0% 100% 0%`.
   - **`gradientTransform`**, parsed by `svg/transform.ts`. A list the parser cannot read in full
     drops the gradient (not the shape). `parseTransform` answers IDENTITY for both "identity" and
     "unreadable", so the module gains `parseTransformOrNull(value): Mat | null`, which
     `parseTransform` then wraps (`?? IDENTITY`) with no change for shapes. The
     transform, composed with the unit map, is an affine `A`; `A` singular → dropped.
   - **Folding into two points.** With `p1 p2` the raw points (in gradient space), `d = p2 − p1`
     and stops at offsets `o0 < o1`, the gradient parameter at own-space point `q` is
     `s(q) = ((A⁻¹q − p1)·d) / (d·d)`, which is affine: `s(q) = g·q + c` with `g = A⁻ᵀd / (d·d)`.
     The start colour is reached where `s = o0` and the end colour where `s = o1`, so with
     `q0 = A·p1` (where `s = 0`): `from = q0 + g·o0/(g·g)` and `to = q0 + g·o1/(g·g)`. Then our model's
     `t(q) = ((q − from)·(to − from)) / |to − from|²` equals `(s(q) − o0)/(o1 − o0)` everywhere —
     exact for every invertible `A`, including skew and non-uniform scale. That case needed the
     care: an iso-line's perpendicular is not preserved by such a map, which is why `g` is the
     gradient of `s` (`A⁻ᵀd`), never `A·d`.
   - **Stops.** Read `offset` (number or `%`, clamped to `[0, 1]`, and each clamped up to the
     previous one, as SVG requires), `stop-color` and `stop-opacity` from attributes **or** the
     `style` attribute (Inkscape uses `style`). Missing colour is black, missing opacity 1.
     - **0 stops** → the paint is `null` (SVG: none). **1 stop** → that stop as a flat `Paint`
       (SVG paints it solid). **2 stops** → a gradient. **3 or more** → dropped, "gradients with more
       than two stops". Two stops at the **same offset** are a hard edge, which our model cannot
       draw → dropped, same label.
   - **`spreadMethod`** other than `pad` → dropped, "repeating gradients".
   - **Opacity.** The element's `fill-opacity`/`stroke-opacity` multiply into both stops' opacity,
     as they multiply into a flat paint today.
   - A **degenerate** result collapses to flat per §2.
5. **What cannot be kept.** A reference to a `radialGradient` → "radial gradients"; to a `pattern`
   → "patterns"; to an id that does not exist or is not a paint server → the fallback colour if one
   was given, else `null` and "missing paint references". Each dropped paint becomes `null`, as every
   gradient does today. Anything dropped here, like anything dropped anywhere, clears the
   Save-in-place handle (invariant 10); our own files never drop anything, so they keep it.
6. **Round trip of our own files is exact**: §3 writes `userSpaceOnUse`, offsets `0`/`1`, no
   transform, and 6-decimal numbers that read back as the same numbers.

## 5. Everything that bakes geometry maps the gradient

One helper, `mapStyle(style: Style, m: Mat): Style` in `document.ts`, maps a gradient's two points
through `m` and applies `flatIfDegenerate`; it returns the **same** style object when neither paint
is a gradient, so documents without gradients keep every reference they keep today. Every site that
changes which space a shape's geometry is expressed in calls it, with the matrix it applies to the
geometry:

| site | matrix |
|---|---|
| `resize.ts` `bakeShape` (all four kinds, incl. the polygon flips and a title's uniform resize) | `L` |
| `edits.ts` `flattenTransform` | the node's `transform` |
| `path-ops.ts` `combine` (result has identity transform in the front shape's parent space) | the front shape's `transform` |
| `boolean-edit.ts` `booleanShapes` (same, with the style of `styleFrom`) | `styleFrom`'s `transform` (`toParent · world` of that operand) |

Not bake sites, and checked: move/rotate/nudge (matrix only), convert to path (same space),
break apart (fragments keep the transform), simplify, subdivide, reverse (same space), ungroup and
moves between layers/groups (the transform is re-derived; own space is untouched), paste and
duplicate (copies). **A new bake site must call `mapStyle`**, exactly as it must call
`withBakedSubpaths` for titles (invariant 40); this becomes a CLAUDE.md invariant.

A title's re-outline on a keystroke does not move its gradient: the text grows, the gradient stays
where it was put. That is the expected behaviour of a gradient in own space, and not a bug.

## 6. The Properties panel

**Paint fields** (`PaintField.svelte`). Below the header (label + On), while the paint is on:

- A **[Flat | Linear]** pair of `ToggleButton`s, "mixed" when the selection has both kinds. With
  nothing selected the panel edits `prefs.style`, which must stay flat, so **Linear** is
  `aria-disabled` with the title "Linear gradient — select an object first" (invariant 24: a reason,
  never hidden).
- **Flat:** the existing swatch + hex + opacity row, unchanged.
- **Linear:** two such rows, labelled **Start** and **End**, each its own live-drag bracket
  (invariant 42). A row whose stop differs across the selection is hidden, as the flat row is when
  mixed today. The row of the stop picked on the canvas (§7) carries `.ui-selected`.
- The row is extracted into `PaintRow.svelte` so Flat and both stops share one implementation.

Store actions, each `cancelActiveGesture()` first (invariant 15), each mapping **per shape** so that
no shape is handed another shape's coordinates:

- `setSelectionPaintKind(which, kind)` → `setPaintKind(doc, ids, which, kind)`: Flat→Linear gives
  each shape a horizontal line across its own-space box at mid-height, start = the flat paint, end =
  the same colour at opacity 0 (a fade — the most common first gradient, and visibly a gradient);
  Linear→Flat keeps the start stop. A `null` paint is left alone (the switch shows only while on).
- `setSelectionGradientStop(which, stop, paint)` → `setGradientStop(doc, ids, which, stop, paint)`:
  replaces that stop on every selected shape whose paint is linear; others are left alone.
- The **On** toggle keeps writing a flat paint: it only ever turns a paint on from `null` or from a
  mixed field, where there is no gradient to copy.

**The Gradient section** (new `FieldSection` id `"gradient"`, appended to `SECTION_IDS`) appears
while the Gradient tool is active, as the Node section appears for the node tool. One row: **Edit**
with a [Fill | Stroke] pair. The choice is `app.gradientTarget` — store state, not saved, not
undoable, default `"fill"`, kept for the session.

## 7. The Gradient tool

`src/tools/gradient-tool.ts`, `ToolId` `"gradient"`, key **G**, lucide `Blend` icon in the tool strip
after Text. It edits `ctx.gradientTarget()`'s paint of the **selected shapes** (the shapes under the
selection, groups descended, as `setStyle` reaches them).

**Handles.** A pure `gradientHandles(doc, ids, which)` (`src/tools/gradient-handles.ts`) returns,
for each reached shape whose target paint is linear, `{ id, from, to }` in **document space**
(through the shape's world matrix). The Overlay draws from it and the tool hit-tests against it —
one function, so drawing and hit-testing cannot disagree (the gizmo's rule, invariant 14). Each
line is drawn as a thin line with a knob at each end, the knob **filled with its stop's colour** so
start and end are told apart at a glance; the picked stop's knob gets a ring.

**Gestures**, with `pointerTolerance` screen px converted by the zoom:

| press on | click (moved < `MIN_DRAG_PX`) | drag |
|---|---|---|
| a knob | picks that stop (`app.gradientStop`) | moves that end |
| the line (not a knob) | — | moves both ends together |
| anything else, with a selection | selects the shape under the press, or clears on empty canvas | draws a new line for **every** selected shape |
| anything else, nothing selected | selects the shape under the press | selects the shape under the press, then draws its line |

- **Knob and line drags** edit only that shape. The pointer goes through the inverse of the shape's
  world matrix into its own space; a singular matrix does nothing (invariant 29's rule for nodes).
- **Drawing a new line** maps the press and current points into each shape's own space the same way
  and sets them as `from`/`to`. A flat paint becomes a gradient with start = that paint, end = the
  same colour at opacity 0; a `null` paint starts from `DEFAULT_STYLE`'s paint for that slot; an
  existing gradient keeps its stops. Because the points are one document-space line mapped into each
  shape, a line drawn across several shapes reads as one continuous gradient across them.
- **Shift** constrains the dragged direction to 45° steps (the dragged end rotates about the fixed
  one; for a new line, about the press point).
- Each drag is **one undo step**: `beginGesture` at down, commits computed from the base document
  taken at down (invariant 15), `endGesture` at up/cancel — the node tool's pattern. A result that is
  degenerate collapses to flat (§2); that is only reachable by dragging one knob onto the other.
- Knobs of several shapes may overlap; the first hit in document order wins, as `hitTest` does.
- Hit-testing the canvas for "the shape under the press" uses `hitTest` with the entered group, as
  the select tool does, so reach rules are the usual ones (invariant 36).

**Store state**, both not saved and not undoable: `gradientTarget` (§6) and `gradientStop:
{ id: string; stop: "start" | "end" } | null`, cleared whenever the selection changes (as `nodeSel`
and `charSel` are, invariant 31) and by **Escape**, which lets the stop go before it clears the
selection. `ToolContext` gains `gradientTarget()`, `gradientStop()` and `setGradientStop(…)`; the
tool never imports the store (invariant 12).

## 8. Other features this touches

- **Select Same Fill / Stroke / Style** compare paints with `sameColours` (§2).
- **Summaries** (`state/properties.ts`) merge fills with `sameColours`; the panel reads only the
  kind and the stops from the merged value, and writes through §6's per-shape actions.
- **Clipboard and PNG export** go through `serializeDoc`/`parseSvg`, so gradients copy, paste and
  render with no change of their own. A region export (`filterToSelection`) keeps each shape's own
  `<defs>` entry because §3 derives them from the shapes serialized.
- **Boolean operations and Combine** keep the gradient of the shape whose style survives, mapped per
  §5.
- **Titles** accept a gradient fill like any path.

## 9. Testing

Unit (Vitest, node): the model helpers (`isGradient`, `sameFill`, `sameColours`,
`flatIfDegenerate`, `mapStyle` reference preservation); `attrs`/`serializeDoc` output, including
byte-identity without gradients; import — own-format round trip, `href` chains, both units, `%`,
`gradientTransform` incl. skew (checked by sampling `t(q)` at several points against the source's
definition), offsets folding, 0/1/3 stops, equal offsets, spread, radial/pattern/missing references
with and without fallback, inherited references resolving per child, fill-opacity multiplying in,
degenerate collapse; each §5 bake site; `setPaintKind`, `setGradientStop`, the line edits;
`gradientHandles`; the tool with `fake-context.ts` (knob drag, line drag, new line across two
shapes, Shift constraint, click picks a stop, one gesture per drag); Select Same; summaries.

Browser (Chrome, a separate port — never the user's :5173): draw a gradient, drag each knob and the
line, switch Fill/Stroke, edit both stops, resize and rotate the shape, save and reopen, open an
Inkscape-style file with an `href` chain and a Figma-style one with `gradientTransform`, PNG-export
a gradient. **Owed an iPad pass:** the tool by touch and Pencil (knob reach at 14 px), and Safari's
rendering of `userSpaceOnUse` under a transform.

## 10. Rulings (decided without asking, recorded so they can be challenged)

1. Stops are always at 0 and 1 (§2); offsets fold into the points.
2. Degenerate gradients collapse to the end stop's flat paint, judged on written values (§2).
3. `sameColours` ignores the points for Select Same and summaries (§2).
4. One `<linearGradient>` per paint, never shared (§3).
5. Flat→Linear and a new drawn line default to "same colour, fading to opacity 0" (§6, §7).
6. A drawn line is one document-space line mapped into every selected shape (§7).
7. A click on a knob picks the stop for the panel's highlight; the panel always shows both stops,
   so picking is a pointer, not a mode.
8. Shift constrains to 45°; the gradient line does not snap (snapping is parked, like marquee).
9. The artboard background and new-shape defaults stay flat.

## 11. Out of scope

Radial gradients; more than two stops (the model will then need offsets — ruling 1 is a v1
simplification, and adding an optional `stops` list is the intended extension); reflect/repeat;
patterns; snapping the gradient line; editing a gradient's line numerically in the panel;
gradients on the artboard background.
