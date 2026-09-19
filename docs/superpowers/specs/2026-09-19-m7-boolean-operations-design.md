# slop-vector-editor — milestone 7 design: boolean operations

Date: 2026-09-19. Status: approved in brainstorming, with one forced deviation recorded in §6.
Follows M6 (`2026-09-19-m6-selection-conveniences-design.md`). Implements the boolean-operations item
from the project design's post-v1 list (§10), which anticipated "possibly Paper.js as a geometry-only
helper" — this milestone takes that option.

## 1. Scope

In:

- **Unite, Subtract, Intersect and Exclude** on the selected shapes (§4);
- **Paper.js as a geometry-only helper**, isolated behind one module (§2);
- conversion between our path model and Paper's, both ways, exact in geometry (§3);
- shapes that are not paths converted first, exactly as the existing Convert to path does (§5);
- a **Path menu** and, where the bar has room, **four icons** (§6);
- the refusals and the empty-result case, with reasons (§7).

Out:

- **Live or non-destructive booleans.** The result replaces its inputs; undo brings them back. No
  stored operand history, no re-editable boolean node.
- **Outlining a stroke**, offset path, and any other geometry operation Paper could also do.
- **Shortcuts.** Four more chords is not worth it; the commands are one click or one menu away.
- Using Paper for anything else. It is not a rendering, hit-testing or import/export library here —
  and it could not be: its SVG import and export need a DOM and throw in the test environment.

## 2. The library

`paper`, imported as `paper/dist/paper-core` — core only, no PaperScript.

Verified in a spike before this spec was written:

- **It runs headless.** `paper.setup(new paper.Size(1, 1))` needs no canvas and no DOM, so the
  boolean code is unit-testable in the project's Node/Vitest environment like any other pure module.
- **Boolean results keep curves as curves.** A circle minus a square comes back with its Bézier
  handles intact, not flattened.
- **Cost, and how it is paid.** Paper is 204 KB minified, **72.4 KB gzipped** — as much again as the
  whole app, which is 69.2 KB gzipped today. Bundling it normally would double the download for
  every user on every visit, for a feature most sessions never touch. So it is **loaded on first
  use**: `booleanOf` does `await import("paper/dist/paper-core")`, Vite emits it as its own chunk,
  and the initial bundle grows only by the boolean code itself — measured at **69.2 → 71.4 KB
  gzipped** in the spike, and **71.9 KB** with the whole milestone and its fixes in, with paper's
  72.4 KB fetched the first time someone runs an operation.
  The refusal rules the menus need (§7) are pure and touch none of this, so no menu ever waits on a
  download to decide whether a command applies.
  The consequence is that `booleanOf`, `booleanShapes` and the store action are **async**. That is
  the whole cost of the split.

Everything Paper touches lives in **`src/geom/boolean.ts`**. No other module imports `paper`; the
rest of the app sees plain `Subpath[]` in and out. If Paper is ever replaced — by a polygon clipper,
or by our own geometry — that is one file.

`paper.setup(new paper.Size(1, 1))` is called once, when the module first loads.

The import specifier is **`paper/dist/paper-core`, with no file extension** — the package's own type
declarations declare that exact module name, and the extension-ful path resolves to no types. The
package's default entry (`paper`) is the *full* build, which carries PaperScript and expects a DOM;
it must not be used.

## 3. Conversion

Our `PathNode` stores `in`/`out` as **absolute coordinates in the shape's own space**; Paper stores
`handleIn`/`handleOut` **relative to the segment point**. The conversion is therefore a subtraction
one way and an addition the other, and the spike confirmed it round-trips exactly — a circle
converted to Paper and back is identical to the original, point for point.

- **Ours → Paper:** one `paper.Segment(point, in − p, out − p)` per node, `null` for a missing
  handle, and the subpath's `closed` flag carried across. A path with several subpaths becomes a
  `paper.CompoundPath`.
- **Paper → ours:** `in = point + handleIn`, `out = point + handleOut`, and a zero handle becomes
  `null`. A `CompoundPath` result becomes several subpaths; a `Path` result becomes one.
- **Node types.** Paper has no equivalent of our `corner`/`smooth`/`symmetric`, and is never told
  the type, so it is **re-derived** from the handles that come back: no handles at all is a
  `corner`; two handles that mirror each other about the point (within 1e-6) is `symmetric`;
  anything else is `smooth`. The geometry round-trips exactly (above), but the type need not: a
  `corner` node carrying two handles that do not mirror — Alt-dragging a handle makes one — comes
  back as `smooth`. This is close to, but not the same as, what the importer does for a path it
  reads from a file: `inferNodeTypes` never emits `symmetric`, needs both handles before it will
  say `smooth`, and tests collinearity at 1e-3 where this tests the mirror at 1e-6.
- **Rounding.** The result is stored as Paper produced it. The writer's existing 6-decimal rounding
  is the only place coordinates are rounded, so a boolean result round-trips through a save and
  reload like any other path.

## 4. The four operations

Every operation works on the selection, in document space (§5), and commits **once**.

| Command | Geometry | The shape whose area survives |
| --- | --- | --- |
| Unite | the union of every selected shape | all of them |
| Subtract | the backmost shape, with every shape in front of it removed | the backmost |
| Intersect | the area common to all | all of them |
| Exclude | the area covered by an odd number of them | all of them |

Subtract follows the convention of Illustrator's Minus Front and Figma's Subtract: **what is on top
cuts what is underneath**.

**The result's style** is the style of the frontmost shape whose area survives. For Unite, Intersect
and Exclude that is simply the frontmost selected shape, which is what was approved in brainstorming
— the result looks like the shape you were looking at. For **Subtract** the front shape contributes
no surviving area at all; it is the knife, not the material. Taking its colour would repaint the
remaining shape in the colour of something that was removed, so Subtract keeps the **backmost**
shape's style. This is a reading of the approved rule, not a departure from it: in every case the
result keeps the style of the frontmost shape that is still there.

**The result's place in the z-order** is the frontmost input's, so the new path sits where the eye
last saw the combined artwork. It goes into the frontmost input's layer and group, with an identity
transform (§5), and becomes the selection.

## 5. What can take part

- **At least two shapes**, all in the current selection.
- **Rect, ellipse and polygon are converted to paths first**, through the existing converter, so
  the commands work on the shapes people actually draw. The conversion is part of the same single
  commit.
- **A group cannot take part.** Combining a group would mean flattening its children into one shape
  and silently destroying the grouping; refuse instead (§7).
- **An open path cannot take part.** Paper closes an open path silently and produces an area the
  user never drew. Refuse it (§7) rather than guess.
- **Transforms.** Each input carries its own matrix, so the subpaths are mapped through each shape's
  **world matrix** into document space before the operation, and the result is stored with an
  identity transform — the same rule the pen uses when it commits a new path (M4b §3).

## 6. Where the commands live

Approved in brainstorming: four icons in the top bar, mirrored in the context menu. **The bar cannot
take four more icons at every width**, and that is a hard constraint, so this milestone delivers
both surfaces:

- **A `Path` menu** beside `Select` in the top bar, holding all four commands. Always present, at
  every width, and reachable by touch. This is the guaranteed route.
- **Four icons** in the icon bar beside Group and Ungroup, shown at **900 px and above** — the same
  breakpoint the Properties drawer already uses. One click for the desktop case that was asked for.

The measurement behind the deviation: the bar already holds 18 icon buttons and two menus, about
774 px of fixed width, which is why the file name is squeezed to roughly 33 px at 768 px (a finding
parked since M3a). Four more icons add about 144 px, and M2e's rule is absolute — the bar must never
wrap or scroll, because a scrolling bar clips the File menu. Hiding the icons below a breakpoint is
not the state-dependent hiding invariant 24 forbids: at any given width the bar is stable, and
nothing becomes unreachable, because the Path menu is always there.

Icons, the closest the project's icon set offers — the tooltips carry the meaning, and every tooltip
is also the status-bar hint: `Combine` (Unite), `SquareMinus` (Subtract), `Blend` (Intersect),
`SquareSlash` (Exclude).

The **context menu** gets the same four commands, hidden when they do not apply, as M6 established.
It is the mouse route; on a device the Path menu is the route.

## 7. When a command does not apply, and when it produces nothing

In the Path menu and on the icons, a command that cannot run is **disabled with a reason**
(invariant 24). In the context menu it is hidden (M6 §5). The reasons:

- fewer than two shapes selected → `Unite — select two or more shapes`;
- any selected node is a group → `Unite — a group can't take part`;
- any selected path is open → `Unite — an open path can't take part`.

**An operation that leaves nothing** — intersecting two shapes that do not overlap, or subtracting a
shape that covers everything — must not create an empty path: the importer drops a path with no
subpaths, so writing one would produce a file that does not round-trip (the M2 constraint). The
document is left unchanged and a notice says so: `Intersect left nothing.`

**An operation that cannot run at all** — Paper throwing, or, far more likely, its download failing
on a dropped connection or a stale tab asking for a chunk a deploy has replaced — is abandoned the
same way, with the document untouched. Its notice is an **error**, not an info: an info fades after
six seconds, and this is a failure with no other visible sign, so it would leave four buttons that
look enabled and do nothing. The wording says what to do:
`Unite — the operation could not run. Check your connection and try again.` The loader caches its
promise and clears it on rejection, so trying again really does re-fetch rather than replay the
failure for the life of the tab.

## 8. Undo and the document

One operation is one commit and one undo step, restoring every input shape. `cancelActiveGesture()`
runs first, as every document-editing store action does (invariant 15). The document stays immutable
throughout; the inputs are removed and the result inserted in a single new document.

## 9. Testing

- **Unit (Vitest, node — Paper runs headless, verified):**
  - conversion: a circle ours → Paper → ours, identical point for point; absolute/relative handles
    both ways; a multi-subpath path becoming a `CompoundPath` and back; node types derived from the
    handles.
  - each of the four operations on a circle and an overlapping square: the expected number of
    subpaths, closed flags, and that curves survive.
  - a hole: a large rectangle minus a small interior one gives two subpaths with **opposite**
    winding, which is what makes SVG's default `nonzero` fill rule draw it as a hole — the app emits
    no `fill-rule`, so this is the mechanism the result depends on.
  - disjoint shapes united give two subpaths; intersecting them leaves nothing and the document is
    unchanged.
  - refusals: fewer than two, a group, an open path.
  - transforms: two shapes with different matrices combine in document space and the result carries
    an identity transform.
  - the result's style and z-position, including Subtract taking the backmost shape's style.
- **Build:** 0 errors, 0 warnings; lint and format clean. Two chunks must come out of the build —
  the app's own and paper's — and the app's own must stay within a few KB of where it was. Record
  both, gzipped.
- **Browser (controller, port 5198, screenshots):** each command from the Path menu and from the
  icons; the icons absent and the menu present at 768 px; the disabled reasons; the context menu's
  entries; a hole rendering as a hole rather than filling solid; a result editable with the Node
  tool; one undo step restoring the inputs; save and reload leaving the result unchanged; no console
  errors.

## 10. Owed

The iPad pass owed since M5 now also covers the Path menu's hit targets and the icons' absence below
900 px. Performance is unmeasured: Paper's boolean code is the heaviest geometry in the app, and a
path with thousands of nodes has not been tried. Nothing here can be device-verified.
