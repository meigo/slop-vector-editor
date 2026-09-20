# slop-vector-editor — milestone 11 design: envelope warp

Date: 2026-09-20. Status: approved in brainstorming. Follows M10e (the panel density work, recorded
in `CHANGELOG.md` rather than a spec of its own). Implements a post-v1 item the project design's
§10 list does not name but which the M10 documents have assumed five times over — every one of them
an argument for keeping a title an ordinary path so that "M11's warp" would need no special case.
This is that warp.

## 1. What this is for

Deforming a selection through a cage: bowing a title into a banner, throwing a logo into
perspective, pinching an arch. One cage over the whole selection, one continuous map, applied to
everything selected at once — so two objects side by side stay in register rather than each getting
its own transform.

It is a **one-off action, not a document feature**. Nothing about the cage is saved, and nothing is
re-editable afterwards: the geometry is baked and the cage is gone. That is a deliberate narrowing
of what Illustrator's Envelope Distort does, and it is what keeps this milestone free of any file
format change at all.

The milestone also ships **Path ▸ Subdivide**, which is unrelated to the warp mathematically (§9)
but belongs to the same menu and costs almost nothing.

## 2. The cage

Four corners and four cubic boundary curves — twelve control points, a **Coons patch**.

```ts
type Edge = readonly [Vec, Vec];               // the two handles, in the edge's own direction
export type Cage = {
  corners: readonly [Vec, Vec, Vec, Vec];      // P00 TL, P10 TR, P11 BR, P01 BL
  edges: readonly [Edge, Edge, Edge, Edge];    // Top(u), Right(v), Bottom(u), Left(v)
};
```

`Top` runs P00→P10, `Right` P10→P11, `Bottom` P01→P11, `Left` P00→P01. Storing every edge in
increasing `u`/`v` rather than walking the outline clockwise means no edge needs reversing when it
is evaluated, at the cost of the bottom and right edges being drawn "backwards" — a trade the
drawing code pays once and the maths never does.

A point `q` in document space normalises against the selection's world bounds `B`:

```
u = (q.x − B.x) / B.w        v = (q.y − B.y) / B.h
```

and the patch is

```
S(u,v) =  (1−v)·Top(u)  +  v·Bottom(u)  +  (1−u)·Left(v)  +  u·Right(v)
        − [ (1−u)(1−v)·P00 + u(1−v)·P10 + (1−u)v·P01 + uv·P11 ]
```

**With undragged edges this is exactly the identity on `B`.** Each of the two edge-pair terms
reduces to the bilinear interpolant of the corners, and the subtracted term is that same bilinear —
so `2·bilinear − bilinear = bilinear`, which on corners sitting at the box's own corners returns
`q`. The cage therefore starts as a no-op, and `warpNodes` short-circuits on `isIdentityCage`
before touching any geometry, so pressing **W** and committing without a drag returns the same
document reference (invariant 1).

**`B.w` or `B.h` of zero divides by zero.** A selection with no height — a horizontal line, or
several of them — is refused with a reason rather than clamped, because there is no honest cage to
show for it.

## 3. Applying the map to a node

The map is **not a matrix**, so `inParent` cannot carry it the way `resizeNodes` carries a resize.
Instead each node keeps its own `transform` untouched and its geometry is baked, which is invariant
11's rule and the only thing that keeps stroke widths from being dragged around by the cage.

`mapNodes` hands each node its parent matrix; the node's world matrix is
`multiply(parent, node.transform)`. Geometry then travels

```
local  ──M──▶  world  ──S──▶  world′  ──M⁻¹──▶  local′
```

A **singular** `M` leaves the node alone, matching what `inParent` already returns for the same
case. A **group** recurses, accumulating `M` as it descends — structurally the same walk
`resizeNode` performs, and its children's transforms are likewise untouched (invariant 26).

Everything that is not already a path goes through `toPath` first, exactly as `bakeShape` does for
a non-axis-aligned resize. A path carrying `text` goes through `withBakedSubpaths`, which drops the
metadata — this is a **new bake site**, and invariant 40 requires it use one of the two existing
funnels rather than clearing the field by hand.

## 4. Curves through a non-affine map

A cubic mapped through `S` is not a cubic — under even a straight-edged cage the composition is
degree six — so the geometry is **refitted**, not transformed.

For each segment, sample the world-space curve at `t = 0, ⅓, ⅔, 1`, map all four points through
`S`, and invert the cubic Bernstein basis to recover the curve through them — `cubicThrough4`:

```
P₀ = Q₀
P₁ = (−5Q₀ + 18Q₁ −  9Q₂ + 2Q₃) / 6
P₂ = ( 2Q₀ −  9Q₁ + 18Q₂ − 5Q₃) / 6
P₃ = Q₃
```

Then measure: evaluate both the true warped curve and the fit at `t = ⅙, ½, ⅚` and take the largest
distance. Over tolerance, split the **original** segment at `t = 0.5` with `splitCubic` and recurse,
to a depth cap of 6 — at most 64 pieces per segment. Splitting the original rather than the fit is
what keeps the error from compounding across levels.

```
WARP_TOL = max(1e-4, max(B.w, B.h) × 1e-4)
```

Relative to the cage, with a floor. An absolute tolerance is wrong at both ends: 0.02 document units
is invisible on a 500-unit selection and a full 1% of a 2-unit icon.

**Two exactness results worth having, because they decide how heavy the output is:**

- A **straight segment under a straight-edged cage stays exactly representable.** `u` and `v` are
  linear in the segment's parameter, `S` is bilinear, so the composition is quadratic — degree-
  elevated into a cubic, and cubic interpolation through four points is unique, so the fit recovers
  it with zero error. Subdivision terminates immediately. The common perspective drag adds **no
  nodes at all**.
- An **axis-parallel segment under a straight-edged cage stays straight**, because holding `v`
  constant makes `S` linear in `u`. So a rectangle thrown into perspective comes out as four
  straight lines, not four faint curves.

To get the second result into the file rather than merely into the maths, the fit emits a **straight
segment** — `in`/`out` of `null` — whenever `P₁` and `P₂` land within epsilon of `lerp(P₀, P₃, ⅓)`
and `lerp(P₀, P₃, ⅔)`.

**Node types are recomputed from the handles the fit produced**: collinear and equal length →
`symmetric`, collinear → `smooth`, otherwise `corner`. Carrying the old type across would be a lie —
a non-affine map does not preserve collinearity — and defaulting everything to `corner` would leave
every junction node the subdivision introduced unnecessarily stiff to edit afterwards.

A **closed** subpath's wrap segment runs from its last node back to node 0, so node 0's `in` handle
comes from that segment's fit. Bookkeeping worth a test of its own (§8).

## 5. The tool

A **Warp tool**, shortcut **W**, in the tool strip. `Tool` gains **one** new optional member,
`activate?(ctx)`, beside `keydown`/`busy`/`discard`, called from the store's `setTool` — the
interface has no activation hook today and the cage has nothing to seed itself from without one.

No matching `deactivate` is needed: `registerToolFinish` already sends `keydown(ctx, "enter")` to
any tool whose `busy()` is true when the user picks another one, and `setTool` clears the overlay
straight after. So committing on a tool change costs this milestone nothing.

| Event | Behaviour |
|---|---|
| `activate` | Empty selection → notice, fall back to select. Degenerate bounds (§2) → refuse with a reason. Otherwise capture `base = ctx.doc()`, `ids`, `box`, `cage = identityCage(box)`, and `ctx.beginGesture()`. |
| `down` / `move` | Hit one of the twelve control points and drag it; `ctx.commit(warpNodes(base, ids, cage, box))`. |
| `up` | Ends the handle drag. The cage stays. |
| **Enter** | `endGesture()`, raise the §6 notice, re-seed an identity cage on the new bounds so the selection can be warped again. |
| **Escape** | `commit(base)`, `endGesture()`, drop the cage, back to the select tool. |
| `cancel()` | Ends the handle drag only and **keeps** the cage — a `pointercancel` is a palm, not a decision (invariant 33's reasoning, applied here). |
| `discard(ctx)` | Undo, redo or replace threw `base` away: drop the cage and end the gesture. |
| tool change | `registerToolFinish` routes Enter to the tool because `busy()` is true, so this is the Enter row — no new code. |

`busy()` is true whenever a cage exists, which is what routes Enter and Escape to the tool ahead of
the store's own handling (invariant 34).

**Every recompute runs `warpNodes` against `base`, never against the current document.** This is
invariant 15's rule for tool drags and it is load-bearing twice over here: it stops the fit from
subdividing already-subdivided geometry, and it makes the whole W-session a single undo step rather
than one per handle.

**The preview is the real document**, inside one gesture bracket that spans the entire session —
not an overlay ghost. A half-warped path is a perfectly valid document, so unlike the pen's draft
(invariant 33) there is no importer rule pushing it out; and rendering through the real canvas is
what makes fills, strokes, z-order and group structure all correct in the preview for free.

Because the bracket is long-lived, the tool registers a gesture-cancel hook the way `Canvas` does
for tool drags, so a store action taken mid-session cannot commit against a stale base.

### The cage on screen

A fourth `Overlay` variant, `{ kind: "cage", corners, edges, outline }` — the route the pen's draft
already uses, needing no new store field. Corners draw as filled squares and edge handles as hollow
circles on leader lines, the gizmo's existing visual language. Hit reach, corner priority and the
small-object padding all come from `tools/gizmo.ts`'s existing rules (invariant 14).

**Shift constrains a handle drag to 45°**, which means calling `constrain45` — today a parked debt
with three copies, in `pen.ts`, `node-tool.ts` and `select.ts`. This milestone exports one and has
all four call it, because it is already working in that code and a fourth copy is the wrong way to
leave it.

## 6. What the commit says

Warping destroys liveness, and it cannot not: a polygon's seven numbers (invariant 21), a rect's
live corner radius and a title's `text` (invariant 40) have no meaning after a non-affine map. All
of them warp anyway — refusing would gut the feature, since bowing a title is the single commonest
reason to reach for an envelope at all — and the commit raises **one** notice naming what stopped
being live:

> Warped — 2 polygons and a title are now ordinary paths.

`droppedLive(before, after, ids)` produces the counts by **comparing the two documents**, not by
re-deriving the rule from the cage. This is invariant 44's reasoning transplanted: a second copy of
"what does this operation destroy" is a copy that can drift from the code that destroys it, and
quiet data loss is exactly where a drift would go unnoticed. One notice per commit, never one per
object.

## 7. Where the commands live

- **Warp**: the tool strip, shortcut **W**.
- **Subdivide**: the **Path** menu, beside the four booleans. It is a path operation and that menu
  already exists for path operations.

Both follow invariant 24: a `title` that is also a status-bar hint, and `aria-disabled` with a
reason rather than `disabled` when they do not apply — "Warp — select something with width and
height", "Subdivide — select a path".

## 8. Testing

Pure modules only, as ever — the cage's drag behaviour is canvas work and goes in the verification
debt (§11).

**`geom/warp.ts`**

- An identity cage maps every sampled point to itself, at the corners, on the edges and inside.
- A straight-edged cage fits a straight segment with **zero** error and **zero** subdivision.
- An axis-parallel segment under a straight-edged cage comes back with `in`/`out` of `null`.
- A rectangle in perspective is four straight lines.
- A curved cage: every sampled point of the refitted curve lies within `WARP_TOL` of the true
  warped curve, and the depth cap is respected.
- `cubicThrough4` recovers a known cubic from its own four samples exactly.
- Node types are recomputed: a smooth node whose handles the map breaks comes back `corner`; a
  junction node introduced by subdivision comes back `smooth`.
- A closed subpath's wrap segment is warped, and node 0's `in` comes from it.

**`doc/warp-edit.ts`**

- `isIdentityCage` → the same document **reference** back (invariant 1).
- A node with a singular world matrix is left alone.
- A group's children are warped and every `transform` in the tree is untouched (invariant 26).
- A polygon comes back a path with no `data-sv-polygon`; a rect and an ellipse come back paths.
- A title comes back a path with no `text`, and `droppedLive` reports exactly it.
- `droppedLive` counts polygons, shapes and titles separately and pluralises correctly.
- `warpRefusal` names the zero-width and zero-height cases.
- No warped path is left with fewer than two nodes per subpath (invariant 30) — the fit only ever
  adds nodes, so this is a tripwire rather than a risk.

**`doc/path-edit.ts` (Subdivide)**

- Doubles the node count of an open subpath and adds one per segment of a closed one.
- Geometry is unchanged: sampling both paths at matching parameters gives identical points.
- A straight segment gains a handle-free midpoint node.
- A closed subpath's wrap segment is subdivided too.

## 9. Subdivide, and why it is not warp preparation

`Path ▸ Subdivide` splits every segment of every selected path at `t = 0.5` using the existing
`splitCubic`. It is exact, visually a no-op, and only ever adds nodes, so invariant 30 holds by
construction. It operates on whole selected paths, not on a node selection.

It is worth being explicit that **subdividing before a warp makes the result worse, not better.**
That intuition is correct for editors whose envelope moves the nodes you already have — more nodes,
closer approximation. It is wrong here: §4's fit inserts precisely the nodes the tolerance demands
and refits the curve, so nodes added by hand beforehand are extra baggage carried through at
identical accuracy. Subdivide earns its place for **node editing** — putting a node in the middle of
a long segment so there is something to pull on — and that is the only claim this spec makes for it.

The operation that genuinely pairs with warp is **Simplify**, on the far side: a heavy warp adds
nodes and Simplify sheds them. It is not in this milestone (§10).

## 10. Out

- **A mesh cage.** An N×M grid is a grid of exactly these patches, so nothing here forecloses it;
  it needs row/column add-and-remove UI and point marquee selection, which is a milestone's worth
  of work on its own.
- **A persistent, re-editable envelope.** That is a file format change and a new node kind, and it
  is what §1 deliberately trades away.
- **Snapping the cage.** The overlay has one slot and the cage occupies it — the same parked
  limitation that stops snap guides appearing while a pen draft exists.
- **Deforming stroke width.** A warped shape keeps one uniform stroke. Illustrator behaves the same
  way; it means a thick-stroked object looks subtly wrong at a pinched end, and solving it means
  outlining the stroke first, which is its own feature.
- **Simplify and the freehand pencil.** Both need the same curve fitter — the project design's §10
  specs freehand as "simplified bezier with pressure" — so they form **M12** behind a shared
  `geom/fit.ts`, into which `cubicThrough4` moves when it gains a second caller. It stays in
  `warp.ts` for now; one caller does not justify a module.
- **A node-selection-aware Subdivide**, splitting only segments between selected nodes.

## 11. Owed

- **The whole cage interaction is canvas work and therefore unverifiable by unit test** — handle
  reach, the 45° constraint, the drag on a pushed-out handle of a small selection, Enter/Escape
  routing, and the iPad pass. Record in the CHANGELOG what was checked in the browser.
- **Autosave writes mid-warp state**, because the preview really is in the document. The result is
  always valid SVG, so nothing corrupts, but a crash mid-warp restores a half-warped document
  rather than the original.
- **Performance is reasoned, not measured.** A 500-node title is roughly 14k patch evaluations per
  pointermove, which should sit well inside a frame; a very large multi-selection has not been
  estimated. If it does turn out slow, the fix is a coarse tolerance during the drag and an exact
  re-bake from `base` on commit — deliberately not built now.
- **`constrain45` is consolidated here** (§5), clearing three copies of the parked debt. The 1e-6
  coincidence tolerance, its sibling, is left alone: this milestone does not touch those call sites.
