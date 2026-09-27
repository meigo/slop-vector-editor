# slop-vector-editor — milestone 17 design: gradient midpoint and distinct handles

Date: 2026-09-27. Status: approved in brainstorming (storage: a `mid` number saved as a derived
middle stop — option A of three; controls: panel slider + canvas diamond; handles: one shape per
role). Builds on M15 (`2026-09-27-m15-linear-gradients-design.md`) and M16
(`2026-09-27-m16-radial-gradients-design.md`), whose rules — own-space points, `mapStyle` at every
bake, one gradient element per paint, "exact or dropped" import, the Gradient tool's gesture model —
carry over unchanged unless this document says otherwise. M14 (envelope warp) stays next after this.

## 1. What this is for

Two requests from one session:

1. "Does SVG support a kind of colour weight to make one colour dominant?" — SVG has no weight or
   midpoint property; the answer agreed on is a **midpoint**: the offset at which the colour is the
   50/50 mix of the two stops, shifting the blend toward one end while both colours still reach
   their edges. Moving the gradient's endpoints already lets one colour fill more of the shape; the
   midpoint is what that cannot do.
2. "All the handles look the same, so it's often hit and miss to select the correct one." The
   problem, confirmed by asking, is **identification, not reach**: the user cannot tell centre from
   rim, rim A (stretch) from rim B (rotate/scale), or start from end when the colours are similar.
   Today every knob is the same circle filled with its stop colour, and a radial's two rim knobs are
   filled with the same end colour.

**In:** a midpoint on linear and radial gradients (fill and stroke); a Midpoint slider + numeric
field in the Gradient section; a draggable midpoint diamond with the Gradient tool; exact save and
reload; import of foreign 3-stop gradients whose middle stop is the mix of the outer two; one knob
shape per role; per-role hover cursors on desktop.

**Out:** free middle-stop colours or any number of stops beyond this (the post-v1 "more gradient
stops" item stays on the list); a curved (CSS colour-hint) falloff; status-bar hints for canvas
knobs; changes to knob size, reach or spacing; snapping the midpoint.

## 2. The model

```ts
export type LinearGradient = { kind: "linear"; from: Vec; to: Vec; start: Paint; end: Paint; mid?: number };
export type RadialGradient = { kind: "radial"; center: Vec; a: Vec; b: Vec; start: Paint; end: Paint; mid?: number };
```

- `mid` is the offset (along the gradient's own parameter, `from`→`to` or `center`→rim) at which
  the colour is `midStop(start, end)` (§3). It is **strictly between 0 and 1**.
- **Absent means 0.5, and 0.5 is never stored.** Setting the midpoint to 50% deletes the key — the
  same single-representation rule as `hidden`/`locked` (invariant 39), so a gradient with no
  midpoint has exactly one shape, an edit to 50% on a gradient without the key returns the same
  reference (invariant 1), and every existing document and file serializes byte-identically.
- A small accessor, `midOf(g) = g.mid ?? 0.5`, is what every reader uses; nothing reads `g.mid`
  directly except the setter and the writer.
- UI edits are in **whole percents, 1–99** (§5, §6). 0 and 100 are excluded because the middle stop
  would share an offset with an outer one, which the importer drops (§4). Imported values keep
  their own precision (still strictly inside (0, 1)).
- `sameFill` compares `midOf` exactly. `sameColours` ignores it — like the points, it is how the
  colours are distributed, not which colours they are; Select Same Fill and the panel's summaries
  keep their current meaning.
- `mapStyle`, `flatIfDegenerate` and every bake are unchanged: the midpoint is an offset along the
  gradient's own parameter, not a point in space, so no matrix touches it.
- `toRadial`/`toLinear` carry `mid` across. The Type-row memory (`app.gradientMemory`) restores
  remembered **geometry** with the **current** stops (invariant 46); `mid` counts as a stop
  property, so a restore keeps the current `mid` alongside the current stops — a Flat → gradient
  restore, where there are no current stops, takes the remembered `mid` with the remembered stops.
  `drawGradientLine` keeps the shape's existing `mid` when it redraws the geometry, exactly as it
  keeps the existing stops. `forgetGradients` is unchanged.
- A new pure edit `setGradientMid(doc, ids, which, mid)` in `paint-edit.ts`: rounds nothing (the
  caller passes whole percents / 100), deletes the key at 0.5, touches only gradient paints in the
  slot, returns the same reference when nothing changes.

## 3. The file format and the mix colour

**`midStop(start: Paint, end: Paint): Paint`** — one pure function, in `document.ts` beside the
other paint helpers, used by export and import alike:

- `opacity = (a₀ + a₁) / 2`
- per colour channel: the **premultiplied** average `(c₀·a₀ + c₁·a₁) / (a₀ + a₁)`, or the plain
  average `(c₀ + c₁) / 2` when `a₀ + a₁ = 0`; rounded to the nearest integer and written as
  lowercase hex.

Premultiplied because a fade to transparency is the common case: red → transparent black with a
plain average puts `#800000` at 50% in the middle — a muddy band the two-stop gradient never had.
Premultiplied keeps it `#ff0000` at 50%, which is what browsers render at the midpoint of the
two-stop fade.

**Export** (`svg/attrs.ts`'s `gradientDefs`): when `mid` is present, the stops are
`offset="0"` (start), `offset="{fmt(mid)}"` (`midStop`), `offset="1"` (end). Without it, the output
is unchanged. The canvas renders through the same function (invariant 3), so the screen shows
exactly what is saved: two straight ramps meeting at the midpoint.

## 4. Import

In `svg/gradient-import.ts`, `foldLinear` and `foldRadial` accept **three** stops when the middle
one matches `midStop` of the outer two (after the inherited-opacity multiply both already apply):
every colour channel within **±1** of 255, opacity within **0.005**. That absorbs rounding in our own
files (the written middle stop is regenerated from the outer two on export, so a reload re-derives
the same bytes) and in other editors'.

- **Linear:** `from`/`to` fold from the outer offsets exactly as today, and
  `mid = (o_m − o₀) / (o₁ − o₀)`.
- **Radial:** the first stop must still be at 0 (the existing "radial gradients with an inner stop"
  rule), the rim folds from `o₁` as today, and `mid = o_m / o₁`.
- A resulting `mid` that is not strictly inside (0, 1) — a middle stop sharing an outer offset —
  drops with the existing label. A `mid` within 1e-6 of 0.5 is stored as absent.
- Any other 3-stop gradient, and every 4+ stop gradient, still drops as "gradients with more than
  two stops". 0 and 1 stop handling is unchanged.

## 5. The Properties panel

A **Midpoint** row in each paint's gradient rows (`PaintField`, the Fill and Stroke blocks), between
its Start and End rows, shown only when every selected paint is Linear or Radial (a flat paint has no
midpoint) — corrected while planning: the Start/End rows live there, not in the tool's Gradient
section:

- A range slider (`<input type="range">`, 1–99, step 1) and a numeric `%` field beside it
  (`NumberField`, min 1, max 99, suffix `%`). It is the app's first range input: it gets the raised
  field look, `var(--ctl-h)` height (invariant 23) and `touch-action: none` so iPadOS reads a drag
  on it as a drag, not a scroll. `PaintField` is a flex column, not the `.field-grid`, so the row
  mirrors the Start/End rows (a short label, then the controls) in a new `MidpointRow.svelte`.
- The slider updates the artwork on `input` and the drag is **one undo step**, bracketed in
  `beginDocGesture`/`endDocGesture`, closed on `change`, `blur` and component destruction — the
  `PaintField` colour-swatch pattern (invariant 42). The numeric field commits on Enter/blur like
  every other `NumberField`.
- Mixed values (selected gradients with different midpoints) show an empty field and the slider at
  50; moving either sets every selected gradient in the slot to the new value.

## 6. The Gradient tool: handles and the midpoint diamond

**Shapes** (all keep the accent outline; knobs keep their stop-colour fill so colour still tells
start from end):

| Knob | Shape | Drag does |
|---|---|---|
| Linear start / radial centre | circle | move this end (a radial's centre moves the whole gradient) |
| Linear end / radial rim A | square | move this end / stretch the ellipse |
| Radial rim B | ring (hollow circle, end-colour stroke over the accent) | rotate and scale |
| Midpoint | small diamond on the line | slide the midpoint |

The square and circle follow the Illustrator/Affinity convention; the ring echoes the select tool's
round rotate knob. The picked-stop emphasis (thicker outline) is unchanged and applies to every
shape. Drawing order stays the reverse of `pickHandle`'s tie order, so the tie's winner is on top;
the diamond is drawn below the knobs and above the line.

**The diamond** sits at `from + mid·(to − from)` for a linear, and `center + mid·(a − center)` on
the centre→A line for a radial. `GradientHandle` gains the diamond's document-space point; drawing
and hit-testing read it from the same `gradientHandles`, so they cannot disagree (invariant 14's
rule).

**Picking:** knobs (across every handle, nearest within a handle, as today) → **diamonds** → lines,
each pass scanning front to back. When a gradient is so short that its diamond overlaps an end knob,
the knob wins; the panel is then the route to the midpoint. New `HandlePart`: `"mid"`.

**Dragging the diamond** projects the pointer onto the from→to (or centre→A) line in document
space, converts to the offset `t`, rounds to a whole percent and clamps to 1–99, and commits as one
undo step through the tool's existing gesture path (cancel rolls back). Unlike a knob drag it does
**not** call `forgetGradients` — corrected while planning: the memory guards geometry, which a
midpoint drag leaves alone, and a kind restore keeps the current midpoint anyway (§2), so forgetting
would only throw away the other kind's remembered shape. No snapping; Shift does nothing.

**Cursors (desktop only):** the tool's `hover` already runs on every pointer move with no gesture;
it now sets a hover cursor through `ToolContext`, and `Canvas.svelte` shows it in place of the
tool's static `cursor` when set (cleared on leaving a knob, a tool change or gesture end). Circle,
square and line → `move`; ring → `grab` (CSS has no rotate cursor); diamond → `ew-resize`; nothing
under the pointer → the tool's `crosshair`. Touch and Pencil have no hover; the shapes are their cue.

## 7. Testing

Unit (Vitest, node):

- `midStop`: opaque ends, mixed opacities, one end fully transparent (premultiplied result), both
  transparent (plain average), rounding.
- Model: `setGradientMid` deletes the key at 0.5 and returns the same reference for a no-op;
  `sameFill`/`sameColours` behaviour; `toRadial`/`toLinear` and the Type-row memory keep `mid`;
  `drawGradientLine` keeps `mid`.
- Export → parse round trip of `mid` for linear and radial, byte-identical output for gradients
  without it.
- Import: foreign offsets (linear `o₀ > 0`, radial `o₁ < 1`) fold to the right `mid`; under a
  `gradientTransform` and `objectBoundingBox`; the tolerance (±1 channel accepted, ±2 dropped;
  opacity 0.004 accepted, 0.01 dropped); a middle stop at an outer offset drops; `mid ≈ 0.5`
  stored as absent.
- `gradientHandles`/`pickHandle`: the diamond's position for both kinds; knob beats diamond beats
  line; frontmost-shape ordering still holds.
- The diamond drag in the tool: projection, rounding, clamping, one undo step, cancel.

Browser (recorded in CHANGELOG): knob shapes on linear and radial at small and large sizes, the
cursors, the slider's live update and single undo step, save/reload in Chrome and Safari; iPad pass
for the slider's touch drag and the diamond's reach (verification debt).

## 8. Rulings (decided without asking)

1. The ring's cursor is `grab`: CSS offers no rotate cursor, and a custom data-URI cursor is not
   worth it for a desktop-only affordance.
2. The midpoint is not snapped and has no reset gesture; typing 50 in the field resets it.
3. `sameColours` ignores `mid` (§2).
4. The radial's diamond lives on the centre→A line only; rim B has no diamond (the midpoint is one
   number for the whole ellipse).
