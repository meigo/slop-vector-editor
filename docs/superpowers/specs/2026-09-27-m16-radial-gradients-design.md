# slop-vector-editor — milestone 16 design: radial gradients

Date: 2026-09-27. Status: approved in brainstorming (shape: circle + ellipse, no focal point; the
tool's kind: a Type switch in the Gradient section). Builds directly on M15
(`2026-09-27-m15-linear-gradients-design.md`), whose rules — own-space points, `mapStyle` at every
bake, one gradient element per paint, "exact or dropped" import, the Gradient tool's gesture model
— all carry over unchanged unless this document says otherwise. M14 (envelope warp) stays next.

## 1. What this is for

A glow, a vignette, a lit sphere, a soft spot of colour: colour that changes outward from a centre.
The request was "introduce circular gradient as well".

**In:** radial gradients with two stops (colour + opacity) on fill and stroke; circles and ellipses
(rotated, stretched, skewed by bakes); drawing and adjusting them with the Gradient tool; Flat /
Linear / Radial in the Properties panel; saving as `<radialGradient>`; importing every foreign
radial gradient the model represents exactly.

**Out:** an off-centre focal point (`fx`/`fy`/`fr`), more than two stops, reflect/repeat, a first
stop at an offset above 0 (§4), gradients on the artboard background.

## 2. The model

```ts
export type RadialGradient = {
  kind: "radial";
  center: Vec;   // own space; the start stop sits here (offset 0)
  a: Vec;        // rim point A — the end stop's circle/ellipse passes through it (offset 1)
  b: Vec;        // rim point B — the other axis
  start: Paint;
  end: Paint;
};
export type Gradient = LinearGradient | RadialGradient;
export type Fill = Paint | Gradient;
```

The gradient is the unit circle carried by the affine map `M` whose columns are `a − center` and
`b − center` and whose translation is `center`: `M = [a.x−c.x, a.y−c.y, b.x−c.x, b.y−c.y, c.x, c.y]`
in SVG `matrix()` order. `a − c` and `b − c` perpendicular and of equal length is a circle; anything
else is an ellipse (a general affine image of a circle — rotated, stretched or skewed). Because the
paint is defined by three points under an affine map, **every bake stays exact** by mapping the
three points (`mapStyle`), including non-uniform resizes, skews and the polygon half-turn.

- `isGradient(f)` now answers either kind; `isLinear(f)` / `isRadial(f)` narrow.
- `sameFill` compares kind, geometry and stops; `sameColours` compares kind and stops — a linear
  and a radial gradient with the same colours are **different fills** (Select Same, summaries).
- **Degenerate collapses to flat**, as in M15: a radial gradient whose `M` is singular *as written*
  (the determinant computed from `fmt`-rounded coordinates is 0 — the rim points coincide with the
  centre, or lie on one line through it) is stored as its end stop's flat paint, which is what SVG
  paints for `r = 0`. `flatIfDegenerate` takes a `Gradient`.

## 3. The file format

`src/svg/attrs.ts` still owns canvas and export alike. `GradientDef` gains `tag: "linearGradient" |
"radialGradient"`.

- **A circle is written plainly** when, as written, `a − c = (r, 0)` and `b − c = (0, r)` with
  `r > 0`: `<radialGradient id="sv-grad-12-fill" gradientUnits="userSpaceOnUse" cx="…" cy="…"
  r="…">`.
- **Anything else** is written as the unit circle under a transform:
  `cx="0" cy="0" r="1" gradientTransform="matrix(m0 m1 m2 m3 m4 m5)"`, each entry through `fmt`.
- `fx`/`fy`/`fr` are never written (they default to the centre and 0).
- Stops, ids (`sv-grad-<node>-<fill|stroke>`), the one leading `<defs>`, and "no `<defs>` without
  gradients" are unchanged. Both forms read back exactly.

## 4. Import

`src/svg/gradient-import.ts` resolves `radialGradient` servers too (the `href` chain rules are
M15's; a radial server's own attributes are `cx cy r fx fy fr`, defaults `50% 50% 50%`, `fx`/`fy`
default to `cx`/`cy`, `fr` to 0). A radial gradient is kept exactly when:

1. **No focal offset:** `fx = cx`, `fy = cy` and `fr = 0` after resolving units. Otherwise dropped,
   "radial gradients with a focal point".
2. **Stops:** 0 → no paint; 1 → that stop flat; more than 2, or two at the same offset → dropped,
   "gradients with more than two stops". **The first stop must be at offset 0** — an inner offset
   paints a solid disc our model cannot draw → dropped, "radial gradients with an inner stop".
   A last stop below 1 folds into the rim: the rim points scale about the centre by that offset.
3. **Spread** `pad` only, else "repeating gradients".
4. **Units and transform:** `objectBoundingBox` maps through the shape's own-space box (a
   non-square box makes an ellipse — exact); `userSpaceOnUse` `%` values resolve against the
   artboard, `r`'s against its normalised diagonal `√((w² + h²) / 2)` as SVG specifies.
   `gradientTransform` composes as in M15; an unreadable list or a singular result →
   "gradients with an invalid transform".
5. **`r = 0`** → the last stop's flat paint (SVG). Coordinates past `MAX_COORD` or non-finite →
   "invalid gradient coordinates", exactly as M15.
6. The fold: with `A` the unit/box map composed with `gradientTransform`, `o1` the last offset,
   `center = A·(cx, cy)`, `a = A·(cx + r·o1, cy)`, `b = A·(cx, cy + r·o1)`.

"radial gradients" as a drop label is retired; radial gradients that fail a rule get the rule's
label.

## 5. The Properties panel

- Paint fields: **[Flat | Linear | Radial]**. With nothing selected, Radial is disabled with the
  reason "Radial gradient — select an object first", exactly as Linear.
- **Flat → Radial** with nothing remembered: a circle centred on the shape's own-space box, radius
  half its larger side (start = the flat paint, end = the same colour at opacity 0, as for linear).
- **Linear ↔ Radial** on an existing gradient converts it and keeps its stops:
  linear → radial: `center = from`, `a = to`, `b = from + perp(to − from)` (a circle);
  radial → linear: `from = center`, `to = a`.
- **The Flat memory** (`app.gradientMemory`) holds either kind; switching back restores the
  remembered gradient (carried to the current box as today) and converts it if the requested kind
  differs.
- **The Gradient section** gains a second row, **Type [Linear | Radial]**, under Edit. It shows the
  kind of the selection's target-paint gradients (mixed when both); when the selection has none, it
  shows `app.gradientType` — the kind a drag will draw (session state, default linear, not saved).
  Pressing a Type sets `app.gradientType` **and** converts the selection's existing gradients of the
  target paint to that kind (one undo step; flat paints are untouched).

## 6. The Gradient tool

- **Drawing** uses `app.gradientType`. Radial: the press is the centre, the release a point on the
  rim; the drawn shape is a circle in document space (`b = c + perp(a − c)`), mapped into each
  selected shape's own space. Shift snaps the rim direction to 45°. An existing gradient of the
  other kind is replaced by the drawn kind, keeping its stops.
- **Radial handles:** a centre knob (filled with the start colour), rim knobs A and B (filled with
  the end colour), thin lines centre→A and centre→B, and a dashed outline of the end-stop ellipse.
  Drawing and hit-testing still come from one function (`gradientHandles`, invariant 14); knobs
  before lines, frontmost shape first.
- **Drags** (computed in document space — what the user sees — then mapped into own space):
  - centre, or either line: moves all three points together;
  - rim A: rotates and scales the whole ellipse about the centre, keeping its shape (the similarity
    about `c` taking A to the pointer, applied to B as well); Shift snaps A's direction to 45°;
  - rim B: moves B alone (stretching/skewing the ellipse); Shift keeps B perpendicular to `A − c`.
  - A rim dragged onto the centre collapses the paint to its end colour (§2).
- **Tap** on the centre picks the start stop; on a rim knob, the end stop.

## 7. Everything else

Clipboard, PNG export, region export, boolean operations, Combine, flatten, resize and flips need
nothing of their own beyond §2's `mapStyle` and §3's export. `sanitizePrefs` still keeps gradients
out of the defaults.

## 8. Testing

Unit: model helpers (kind narrowing, equality, degenerate by written determinant, `mapStyle` of a
radial incl. a skew); export of the circle and matrix forms and their exact round trip; import —
circle, ellipse via `gradientTransform`, `objectBoundingBox` on a non-square box (sampled against
the source definition), `%` radius against the diagonal, focal point / inner stop / `r = 0` /
three stops / reflect / huge coordinates, `href` from a radial to a linear holding the stops; every
bake site with a radial (resize non-uniform, odd-polygon vertical flip, flatten, combine, boolean);
`setPaintKind` radial default and conversions; the memory across kinds; the Type switch
converting; the tool — radial draw, centre drag, rim A similarity, rim B free and Shift
perpendicular, taps picking stops, rim onto centre collapsing.

Browser (Chrome, a separate port): draw a radial, drag each knob, stretch into an ellipse, switch
Type both ways, save and reopen, import a Figma-style elliptical radial and pixel-compare the
browser's rendering of the source against our re-export. **Owed an iPad pass**, as M15.

## 9. Rulings (decided without asking)

1. A circle is written as `cx cy r`, everything else as the unit circle under a matrix (§3).
2. A first stop above offset 0 is dropped rather than approximated (§4).
3. Linear ↔ radial conversion: centre = start point, rim = end point (§5).
4. The Type row mirrors the selection's gradient kind and falls back to the draw kind (§5).
5. Radial drags are computed in document space (§6).
