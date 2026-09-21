# slop-vector-editor — milestone 11 design: path operations

Date: 2026-09-21. Status: approved in brainstorming. Follows M10e (the panel density work, recorded
in `CHANGELOG.md` rather than a spec of its own). Envelope warp was specced first, on 2026-09-20,
and is **deferred to M12** (`2026-09-20-m12-envelope-warp-design.md`) — five small operations ahead
of one large one.

## 1. What this is for

Five operations for the **Path** menu, beside the four booleans M7 put there. They are what you
reach for *after* drawing: a path with too many nodes, two paths that should be one object, a shape
that needs a hole in it, a segment with nothing in the middle to grab.

Every one of them is either a few lines over machinery that already exists, or a call into a Paper
method we are already paying for. Nothing here needs a new algorithm, and nothing here changes the
file format.

## 2. The five, and the two that were cut

| Operation | How | New geometry code |
|---|---|---|
| **Subdivide** | `splitCubic` at `t = 0.5`, per segment | none |
| **Reverse direction** | `reverseSubpath`, which already exists and is tested | none |
| **Break apart** | one path node with N subpaths → N path nodes | none |
| **Combine** | the inverse | none |
| **Simplify** | Paper's `simplify(tolerance)` | none |

**Simplify is in, and that is a correction.** It was first estimated as the large one in this group,
on the assumption that it meant writing Schneider's curve fitter. It does not: `paper.Path` ships
`simplify(tolerance)`, which *is* that algorithm, and M7 already made Paper a lazily-loaded
dependency with a two-way conversion between our subpaths and Paper's model. The remaining cost is
the async plumbing, and that is a copy of `booleanSelection`'s existing shape.

**Outline stroke is out, and that is the same correction in reverse.** Paper has no stroke-to-path:
`expand()` is Rectangle geometry, and there is no `outline`, `strokeBounds` or `offset` on a path.
Outlining a stroke means offsetting the outline by ±`strokeWidth / 2` and resolving the joins, the
caps and the self-intersections — which is **offset path**, the operation this milestone was told to
drop. They are one algorithm wearing two names, so they leave together.

**Both claims were probed, not reasoned**, against the exact build invariant 37 names —
`paper/dist/paper-core`, not the full PaperScript entry:

```
has simplify: function      segments: 41 -> 16     (noisy sine, tolerance 0.8)
smooth: function            reduce: function
expand on Path: undefined
```

So `simplify` is real in the core build and does the work, and the absence of `expand` on `Path`
confirms there is no stroke outlining to be had. `reverseSubpath`'s existing tests are in
`src/__tests__/path-edit.test.ts:233`.

## 3. Combine and Break apart

The pair, and exact inverses of each other — Inkscape's Ctrl+K and Ctrl+Shift+K.

**Break apart** takes each selected path with more than one subpath and replaces it with one path
node per subpath. The fragments keep the original's `style`, `transform`, parent and z-position,
take fresh ids, and inherit its `name` if it had one — several rows sharing a label is honest, since
they did come from one object. The selection becomes the fragments.

**Combine** takes two or more selected shapes and produces a single path node holding all of their
subpaths. A rect, ellipse or polygon is converted with `toPath` first, exactly as `booleanShapes`
converts its operands — refusing an ellipse here while `Unite` accepts one would be arbitrary, and
§8's donut is built from two circles. A group is refused. It follows `booleanOf`'s rule exactly (invariant 37): the result is built in the
**frontmost input's parent space**, carries the frontmost's style, and is inserted at the frontmost's
z-position; every other operand's subpaths are mapped there through its own world matrix, and the
operands are deleted. A node whose world matrix is singular contributes nothing, as in `booleanOf`.

Both drop `text`: a title's outlines stop describing its string the moment they are split up or
mixed with another path's (invariant 40). Break apart's fragments and Combine's result are built as
new nodes without the field rather than by clearing it, so no bake funnel is involved.

Both must leave the document at the **same reference** when they would change nothing — a selection
with no multi-subpath path to break, or fewer than two paths to combine (invariant 1). Both refuse
with a reason rather than acting silently, through one predicate each, in the style of
`booleanRefusal`.

**This is deliberately not "Join endpoints".** Connecting two open ends with a new segment is a
different operation: it needs a node selection to be predictable, because with only an object
selection there is no non-arbitrary answer to *which* ends. It belongs to the node tool and is
listed in §9.

## 4. Reverse direction, and why it is in this milestone

`reverseSubpath` already exists in `path-edit.ts`, is unit-tested, and is reachable only from the
pen. The menu entry reverses **every** subpath of each selected path; a `reversePath` wrapper is the
whole of the new code.

It earns its place now because of something the codebase settles by omission: **there is no
`fill-rule` in this app.** `Style` has no such field and nothing in `src/svg/` ever writes one, so
every shape renders with SVG's default, **nonzero** winding. Under nonzero, a subpath only becomes a
hole if it winds against its container — so Combine on two circles gives a filled blob, and Combine
followed by Reverse on the inner one gives a donut. Without Reverse, Combine cannot make the shape
people reach for it to make.

The alternative is adding `fillRule` to `Style` and writing `fill-rule="evenodd"`, which makes holes
automatic. That is a file format change — importer, exporter, round-trip, properties panel — and it
is out (§9). Note this is not a defect in the existing booleans: Paper returns correctly wound
results, so `Subtract` already produces holes that render correctly under nonzero.

## 5. Subdivide

Splits every segment of every selected path at `t = 0.5`, including the wrap segment of a closed
subpath. Straight segments gain a handle-free midpoint node; curved ones are split with the existing
`splitCubic`.

Three properties make this cheaper than it looks, all of them consequences of de Casteljau at
exactly one half:

- **The geometry is unchanged, exactly.** Not within a tolerance — the two halves draw the curve the
  original drew.
- **Every existing handle halves in length and keeps its direction**, so collinearity is preserved
  and each existing node **keeps its declared `NodeType`**. This is the opposite of the warp's rule
  (M12 §4), which must recompute types because a non-affine map breaks collinearity.
- **The inserted node is `symmetric` by construction**, because splitting at the midpoint leaves its
  two handles equal in length and opposite in direction.

It operates on **paths only**. A rectangle is not silently converted first: `Convert to path` is
already in the Object menu and making it implicit here would destroy liveness without being asked.
A selection holding no path refuses with a reason.

Subdivide is **not preparation for the warp**, despite the two arriving in adjacent milestones. M12
§9 gives the argument in full: that milestone's fit inserts exactly the nodes its tolerance demands,
so nodes added beforehand are carried through at identical accuracy and no gain. Subdivide is for
node editing — putting something in the middle of a long segment to pull on.

## 6. Simplify

`paper.Path.simplify(tolerance)` through the conversion M7 already built, then back into our model.

**The conversion has to move.** `toPaperPath`, `toPaperItem`, `nodeFrom` and `fromPaperItem` are
module-private in `src/geom/boolean.ts`, together with `load()`. Simplify needs all five, and
copying them is the drift risk invariant 37 exists to prevent. They move to **`src/geom/paper.ts`**
— the loader and the two-way conversion, nothing else — leaving `boolean.ts` with `booleanOf` and
gaining `simplify.ts` beside it.

This changes invariant 37 and the build check that enforces it: "only `src/geom/boolean.ts` may
import paper" becomes "only `src/geom/paper.ts`", and CLAUDE.md's chunk-size bar must be reworded to
match, or the next person to read it will treat a correct build as a violation. The rule itself is
unchanged — one module, imported dynamically, on first use.

**Tolerance** is relative to the path's own bounding-box diagonal, not absolute. Paper's default
of 2.5 is meaningful only in its own example's coordinate space; a logo 20 units across and an
artboard-sized traced path cannot share an absolute number.

**The value passed to paper is `(diag × 5e-3)²`, and the square is load-bearing** (amended
2026-09-21, during implementation). Paper's `tolerance` bounds a **squared** distance internally,
so passing `diag × k` yields a deviation proportional to `√diag` — which is not scale-invariant at
all, and defeats the entire reason the tolerance is relative. Measured, on one shape scaled ×1,
×10 and ×100: `diag × 2e-3` left **60 / 81 / 81** segments — the same drawing simplified
differently purely because it was bigger — while `(diag × 2e-3)²` left **81 / 81 / 81**. Squaring
is what makes **our** contribution to that promise true.

**It does not make the promise true in general, and the spec should not pretend otherwise**
(measured during the same task's re-review). Even with the squared formula, paper's own
`PathFitter` still reaches different split decisions at different scales on some inputs — one
fixture went 38 nodes → 24 across ×1 → ×1000, a 37% divergence, which is far too large to be
float noise. The cause is internal absolute epsilons in paper's recursive fitter, below the
tolerance we pass and outside our control. So: squaring removes the scale dependence *we*
introduced, and a residual one belonging to the library remains. The unit test pins one fixture
that is exactly invariant, and its real job is to fail if the square is ever removed — which was
verified by removing it (29/29/29/29 becomes 19/31/31/31).

The fraction is **5e-3**, also measured rather than chosen: squared, `2e-3` removes *nothing* from
a realistically noisy path (81 → 81 segments, 0% deviation), so Simplify would report "nothing to
remove" and look broken. `5e-3` takes 81 → 56 at a maximum deviation of 0.49% of the diagonal, and
`1e-2` takes it to 33 at 0.97% — more aggressive than a destructive command should be by default.

Repeating the command simplifies a little further and then converges, which is the honest
behaviour — no escalating aggressiveness on repeat.

**It drops `text`** through `withBakedSubpaths`, since the outlines stop matching the string
(invariant 40). **It is async**, so it copies `booleanSelection`'s shape exactly:

- the load can fail, so the loader caches the *promise* and clears it on rejection, and the action
  catches, leaves the document alone and raises an **error** notice. The notice says **reload**, not
  "try again": a failed module fetch is cached by the browser's own module map, so clearing our
  promise does not make a retry re-fetch;
- it refuses to run twice at once, because it is async even when Paper is cached;
- it re-checks that the **document** has not changed under the await and abandons the result if it
  has. It does **not** check the selection (amended 2026-09-21; this section first said it did):
  unlike the booleans, Simplify neither deletes nodes nor selects a new one, so a selection the
  user moved during the load is simply their newer intent and the edit still lands where it was
  asked for.

A result subpath left with fewer than two nodes is dropped, and a path left with no subpaths leaves
the document at the same reference rather than being written out for the importer to reject
(invariant 30, and `booleanOf`'s empty-result rule).

The commit reports what it did — **"Simplified — 412 nodes → 96."** A simplify whose effect you
cannot see is otherwise indistinguishable from one that did nothing.

## 7. Where the commands live

All five go in the **Path** menu, which M7 created and which currently holds only the four booleans.
Each follows invariant 24: a `title` that doubles as a status-bar hint, and `aria-disabled` with a
reason instead of `disabled` when it does not apply — "Combine — select two or more paths",
"Break apart — select a path with more than one subpath".

**No new top-bar icons, and no new keyboard shortcuts.** Both are deliberate:

- The bar's four hiding breakpoints are **measured** (invariant 24), and the bar now fits at 739px
  with all four groups hidden. Five more icons invalidates every one of those numbers and the iPad
  portrait result they were measured to reach.
- Every obvious shortcut for these is either taken or browser-claimed, and hunting for safe ones is
  a verification job disproportionate to five menu items. The menu is reachable by touch, which the
  right-click menu is not (`route.ts` opens it for mouse only), so nothing is unreachable without
  them.

## 8. Testing

Pure modules, as ever; the menu wiring is browser work (§10).

**Subdivide** — a subpath gains exactly one node per segment, so an open subpath of `n` nodes
comes back with `2n − 1` and a closed one with `2n`;
sampling both paths at matching parameters gives identical points; a straight segment yields a
handle-free midpoint; existing node types survive unchanged; the inserted node is `symmetric`; the
wrap segment of a closed subpath is subdivided; a selection with no path refuses with a reason.

**Reverse** — a reversed subpath visits its points in the opposite order with `in`/`out` swapped;
reversing twice is the identity and returns an equal path; every subpath of a multi-subpath path is
reversed; node types survive.

**Break apart** — N subpaths become N nodes with the original's style, transform, parent and
z-position and fresh ids; `text` is gone; a single-subpath selection returns the same document
reference; an explicit `name` is inherited.

**Combine** — subpaths from three paths in different parent spaces all land in the frontmost's
space and draw where they drew before; the frontmost's style and z-position win; operands are
deleted; a singular world matrix contributes nothing; fewer than two paths returns the same
reference; `text` is gone.

**Combine + Reverse** — the donut: two concentric circles combined and the inner one reversed wind
oppositely, which is what nonzero needs. Asserted on winding direction, since the app has no
renderer to ask (§4).

**Simplify** — node count drops on a dense path and every sampled point stays within the tolerance
of the original; a path already at minimum node count comes back at the same reference; `text` is gone; the node-count notice reports the real before and after. **The "a result subpath
with fewer than two nodes is dropped" guard is deliberately left untested** (amended 2026-09-21):
`fromPaperItem` already filters those out one layer down, so nothing reaching `simplifyShapes` can
exercise it. It stays as the document layer restating invariant 30 at the boundary that owns it,
rather than leaning on a geometry module to keep the promise. Paper's own `simplify` is not re-tested — the tests cover our conversion and our
guards.

**`geom/paper.ts`** — the extracted conversion keeps `boolean.test.ts` green unchanged, which is the
point of extracting rather than copying. Note `boolean.test.ts`'s first test must stay first in its
file or it silently becomes a tautology; the extraction must not reorder it.

## 9. Out

- **Join endpoints** — connecting two open ends with a new segment. A node-tool operation (§3).
- **Offset path and Outline stroke** — one algorithm, and the large one (§2).
- **`fill-rule` / even-odd fill** — a file format change (§4).
- **Smooth** — the node tool already cycles a node through corner/smooth/symmetric on double-tap
  (invariant 32); a path-level Smooth would either duplicate that or mean something else entirely.
- **Bar icons and shortcuts** for the five (§7).
- **Envelope warp** — M12, already specced.

## 10. Owed

- **Browser verification of all five**, including the disabled-with-a-reason titles on touch, where
  a press is the only way to read them (invariant 24). Record it in the CHANGELOG.
- **The `geom/paper.ts` extraction rewords invariant 37 and CLAUDE.md's build-check paragraph.** If
  the wording is not updated in the same commit, a correct build looks like a violation.
- **Simplify's tolerance is now measured, but only against a synthetic path.** The square and the
  `5e-3` fraction were both settled with numbers (§6), but on a generated noisy sine, not on a real
  traced path or a heavily-noded import. The fraction may still want tuning after the first browser
  pass; the square is not a tuning knob and must not be removed.
- **Paper's failed-load path is still never browser-verified** — parked since M7, and Simplify now
  makes it reachable from a second command. DevTools request-blocking on the paper chunk would
  settle it in two minutes.
