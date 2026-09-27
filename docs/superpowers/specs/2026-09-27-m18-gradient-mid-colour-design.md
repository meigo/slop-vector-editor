# slop-vector-editor — milestone 18 design: a custom midpoint colour

Date: 2026-09-27. Status: approved in chat ("1", then "yes, go ahead and don't ask"). Builds on M17
(`2026-09-27-m17-gradient-midpoint-design.md`), whose rules — `mid` absent at 0.5, the derived
middle stop, `midStop`'s premultiplied mix, the import tolerance, the diamond — carry over unchanged
unless this document says otherwise. M14 (envelope warp) stays next after this.

## 1. What this is for

After M17 the user asked, with a screenshot of a black radial fading out: "is there still a need to
define the mid colour? In this situation I'd like the starting black colour to reach farther out
instead of the mid colour." A midpoint only moves where the 50/50 mix sits — the ramp from the start
colour to the mix is still a straight line, so black begins fading at the centre however far out the
diamond is. Holding a colour and then fading needs a middle stop whose colour the user chooses. SVG
has that natively: a third stop.

**In:** an optional custom colour (colour + opacity) for the middle stop of a linear or radial
gradient; an Auto toggle to go back to the computed mix; a Mid colour row in the panel; the diamond
shows and picks the middle stop; saving it; importing **every** 3-stop gradient whose middle stop
sits strictly between the outer two.

**Out:** four or more stops; adding or removing stops on the canvas; a separate midpoint on each side
of the middle stop; radial gradients with an inner first stop (still dropped).

## 2. The model

```ts
LinearGradient / RadialGradient: { …; mid?: number; midPaint?: Paint }
```

- **`midPaint` absent means Auto:** the middle stop is `midStop(start, end)`, exactly as in M17.
  Present, the middle stop is that paint. Existing documents and files are unchanged.
- `mid` (position) and `midPaint` (colour) are independent: a custom colour at 50% has `midPaint`
  and no `mid` key.
- Readers use **`midPaintOf(g) = g.midPaint ?? midStop(g.start, g.end)`** — the effective middle
  colour. `withMidPaint(g, p | undefined)` sets it, deleting the key for `undefined` (the same
  single-representation rule as `withMid`, invariant 39). Nothing else reads the raw field except
  `sameFill`, the writer, and code that only carries it into `withMidPaint`.
- **Auto follows the ends; a custom colour stays put** when Start or End changes — that is what Auto
  means.
- A stop property, like `start`/`end`/`mid`: bakes leave it alone (`mapFill` spreads); `toRadial`/
  `toLinear`, `drawGradientLine` and `setGradientGeometry` keep it; a kind restore keeps the
  **current** one, a Flat → gradient restore the **remembered** one (M17 §2's rule, extended).
- `sameFill` compares the raw field (absent ≠ present, else `samePaint`), so an edit that changes
  nothing keeps the reference. `sameColours` compares **`midPaintOf`** of both — the effective
  colour is what the user sees, so an Auto gradient and a custom one whose colour equals the mix
  read as the same fill in Select Same and the panel summaries.
- `StopEnd` widens to `"start" | "mid" | "end"` (the name is kept to avoid churn across nine
  files). `setGradientStop(doc, ids, which, "mid", paint)` sets `midPaint` on every selected
  gradient.
- New edit `setGradientMidAuto(doc, ids, which, auto: boolean)`: `true` deletes `midPaint`; `false`
  sets `midPaint = midStop(start, end)` on gradients that have none (so turning Auto off changes
  nothing visible), leaving an existing custom colour alone. Same reference when nothing changes.

## 3. The file format

**Export** (`attrs.ts`): three stops when `mid !== undefined || midPaint !== undefined`; the middle
one is `offset = fmt(midOf(f))`, paint `midPaintOf(f)`. Otherwise two stops, as today — so files
without either stay byte-identical.

**Import** (`gradient-import.ts`, `outerStops`): a 3-stop gradient whose middle offset is strictly
inside the outer two (and does not round to them at 6 decimals — M17's final-review guard) is now
**kept**. If the middle stop matches `midStop` of the outer two within M17's tolerance (±1/255 per
channel, 0.005 opacity) it reads as Auto (`midPaint` absent); otherwise `midPaint` is that stop's
paint. `mid` folds exactly as in M17. A custom colour that happens to equal the mix therefore
reloads as Auto — visually identical, so accepted.

Drop labels: four or more stops now drop as **"gradients with more than three stops"**; the other
labels are unchanged (a two- or three-stop gradient with coincident offsets keeps "gradients with
more than two stops", a radial with an inner first stop keeps its own).

## 4. The Properties panel

In each paint's gradient rows (`PaintField`), between Start and End:

1. **The Midpoint row** (`MidpointRow`): `Mid` | slider | `%` field | **Auto** toggle. The `%`
   field narrows from `w-16` to `w-12` to make room. Auto is a `ToggleButton` — pressed when every
   selected gradient is Auto, unpressed when every one is custom, `"mixed"` otherwise. Pressing it
   when on turns Auto off (seeding the mix); when off or mixed, turns it on (dropping the colours).
   One undo step, through a new store action `setSelectionGradientMidAuto(which, auto)`.
2. **The Mid colour row**: a blank `w-9` label cell and a `PaintRow` showing the **effective** middle
   colour, exactly like the Start/End rows (hidden when the selection's effective colours differ, as
   theirs are). Editing it goes through `onstop("mid", p)` → `setSelectionGradientStop(which, "mid",
   p)`, which stores a custom colour — so editing the swatch of an Auto gradient turns Auto off by
   itself; the Auto toggle is only needed to go back. The swatch drag is one undo step
   (`onlivestart`/`onliveend`, invariant 42). The row is highlighted (`selected`) when the canvas
   picked the middle stop.

`GradientSummary` gains `midAuto: Field<boolean> | null` and `midPaint: Field<Paint> | null`
(effective), both null exactly when `stops` is.

## 5. The canvas

- `GradientHandle` gains `midPaint: Paint` (effective); the diamond is filled with its colour
  (replacing M17's `midStop(start, end)` in the Overlay).
- **A click on the diamond picks the middle stop** (`setGradientStop({ id, stop: "mid", which })`),
  as a click on a knob picks Start or End; the Mid colour row highlights and the diamond draws with
  the picked emphasis (thicker outline). A drag still moves it. Picking never changes Auto.

## 6. Testing

Unit: `midPaintOf`/`withMidPaint`; `sameFill` raw vs `sameColours` effective; `setGradientStop`
with `"mid"`; `setGradientMidAuto` both ways incl. seeding and same-reference no-ops; Auto follows a
Start edit, custom does not; conversions, redraw, geometry and memory restore keep `midPaint`;
export/import round trip of a custom colour for both kinds, with and without `mid`; a foreign
red-white-blue gradient now imports with `midPaint` white; the mix within tolerance still reads as
Auto; four stops drop with the new label; summary fields; the store actions (one undo step each);
the diamond click picks `"mid"` and the handle carries the effective paint.

Browser: the Auto toggle and Mid colour row in both states; editing the Mid swatch turns Auto off;
the diamond's fill and picked emphasis; the user's case — black held out to the diamond then fading.

## 7. Rulings (decided without asking)

1. `StopEnd` keeps its name while gaining `"mid"`.
2. The Mid colour row is always shown (effective colour), not only when custom — editing it is the
   natural way to set a colour, and Auto is the way back.
3. A custom colour equal to the mix reloads as Auto (§3).
4. `sameColours` uses the effective colour (§2).
5. Four or more stops get a new label, "gradients with more than three stops"; the old label stays
   for coincident offsets.
