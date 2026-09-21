# slop-vector-editor — milestone 12 design: PNG export

Date: 2026-09-21. Status: approved in brainstorming, after a spike (§2). Follows M11 (path
operations). Implements the "PNG export" item from the project design's post-v1 list (§10).
Envelope warp, specced 2026-09-20, is deferred again and renumbered to M13
(`2026-09-20-m13-envelope-warp-design.md`) — this is a small milestone taken ahead of a large one,
for the second time.

## 1. What this is for

Getting a picture out. The document **is** an SVG and always has been, so saving has never been the
problem; what is missing is the raster everything else wants — a README screenshot, a preview to
paste into a message, an icon at 2×.

Scope is deliberately one format and one direction: **PNG, out**. Raster *import* is a new node
kind and a file format change, and is explicitly not here (§10).

## 2. What the spike established

Run against the real serializer in desktop Chrome before this spec was written, as M7's spike was
run against Paper and M10's against opentype. Every number below is measured, not reasoned.

- **The canvas is not tainted.** `getImageData` succeeds and `toBlob` returns a valid PNG (21 KB
  for a 800×600 test). The two usual blockers genuinely do not apply here, and both were checked
  against real serializer output rather than assumed: a serialized document contains **no `<text>`
  element** (titles are stored as outlines, invariant 40, and the importer drops other tools'
  text) and **no external reference** of any kind.
- **Colour and compositing are exact.** `#ff3355` reads back `[255, 51, 85]`; a 60 %-opacity blue
  over white composites to `[122, 153, 255]`, which is the arithmetic to the digit; a `#111111`
  stroke reads `[17, 17, 17]`.
- **`drawImage` re-rasterises the vector at the destination size.** This was the milestone's main
  risk. The `<img>` reports its intrinsic size (400×300) while the canvas is larger, which normally
  means a blurred upscale — but at **8×** every pixel across a hard edge is fully black or fully
  white with no blur ramp, and the output is identical to rewriting the SVG root's `width`/`height`
  first. **So scale needs no SVG rewriting: size the canvas and draw.**
- **Transparency works.** With `artboard.background` null, corner pixels come back `[0, 0, 0, 0]`.
- **A region is a `viewBox`, not a crop.** `drawImage`'s 9-argument form would sample the intrinsic
  raster and scale it — blurred. Re-aiming the root's `viewBox` at the region renders it crisp at
  any scale. Verified.
- **The size ceiling fails silently, which changes the design.**

  | canvas | drew? | `toBlob` |
  |---|---|---|
  | 4096² | yes | 332 KB |
  | 8192² | yes | 1.27 MB |
  | 16384² | yes | 5.01 MB |
  | **16385²** | **no** | **null** |
  | 32767² | no | null |

  Past the limit Chrome throws **nothing**: it hands back a blank canvas and a null blob. A
  `try`/`catch` would catch nothing and the user would get an empty file. **The guard must be
  explicit and pre-emptive** (§5).

- **Not established: Safari and iPad.** Both the tainting rule and the ceiling differ there — iOS
  caps total *area* rather than per-side dimensions, historically far below 16384². This is the
  milestone's one real unknown and it is recorded in §11 rather than assumed away.

## 3. The pipeline

```
serializeDoc(doc, view)  →  Blob  →  <img>  →  drawImage(0, 0, w·s, h·s)  →  toBlob  →  save
```

Five steps, four of which already exist. The save step follows `writeSvgFile`'s shape — File System
Access picker where available, `<a download>` fallback where not — as a **separate `writePngFile`**
rather than a generalisation of it. A PNG never saves in place, so it needs none of the handle
bookkeeping that keeps a lossy re-export from silently overwriting an Inkscape original
(invariant 10); entangling the two would put that rule at risk for no gain.

**`serializeDoc` gains an optional second argument** overriding the root's `width`, `height` and
`viewBox`:

```ts
export function serializeDoc(doc: Doc, view?: { x: number; y: number; w: number; h: number }): string
```

Absent, behaviour is byte-identical to today, so every existing caller and the round-trip tests are
untouched. This is the whole of the change to a shared module, and it is what keeps **invariant 3**
intact: export still renders through `src/svg/attrs.ts`, and there is no second renderer to drift
from the canvas. Drawing the model onto a canvas with `Path2D` was the considered alternative and
was rejected for exactly that reason — it would have been a third rendering path, maintained in
parallel, disagreeing with the other two the first time anyone touched a style.

## 4. What gets exported

Two regions, chosen in the dialog, defaulting to the artboard.

**Artboard** — `view` is the artboard's own box, so the serialized root is unchanged from a normal
save and the PNG is a picture of the file.

**Selection** — `view` is the selection's bounds in document space. `selectionBounds(doc, ids)`
already exists and lives in `src/tools/frame.ts`, not in `geom/bounds.ts`; `state/properties.ts`
already imports it from there, so the dependency direction is established rather than new. The
document is then filtered:

```ts
export function filterToSelection(doc: Doc, ids: readonly string[]): Doc
```

A node is **kept whole** — with all its children — when it is selected, and **kept pruned** when it
merely has a selected descendant. That second case is what preserves a selected node's ancestor
transforms: a shape inside a translated group draws where it drew, because the group is still there
with only that shape inside it (invariant 26). A layer left with no children is dropped, and so is
an emptied group (invariant 27).

Filtering rather than cropping is what makes an overlapping-but-unselected object transparent
instead of drawn. This is Illustrator's rule and it is the reason "export one icon from a sheet"
works at all.

The Selection entry is refused with a reason when nothing is selected, or when the selection's
bounds are empty (invariant 24's disabled-with-a-reason rule) — never hidden.

**A selection export clips strokes, and that is a stated limitation rather than an oversight**
(added 2026-09-21, found by the whole-branch review). `selectionBounds` builds on `nodeBounds`,
whose own contract is *"Geometric bounds (stroke excluded)"*, so the outer half of every edge
stroke falls outside the `viewBox`: half a pixel per edge at the default `strokeWidth` of 1, but
6px per edge on a 12px-stroked logo. It is accepted for this milestone on one honest ground — the
PNG then matches **exactly** the selection frame the app already draws, which is built from the
same bounds, so what you see selected is what you get. Illustrator uses visual bounds here and we
should too; that is in §11, not here, because correct visual bounds need miter-join overshoot,
which can extend far past half the stroke width and is not a number this codebase computes
anywhere yet.

## 5. Size, scale and the cap

**One control: a scale multiplier**, with a live readout of the pixels it produces. The artboard's
units are pixels at 1×, so scale is the natural unit and the readout means the number is never a
surprise. Exact-pixel entry is a later addition that would change nothing here (§10).

```
width  = round(region.w × scale)
height = round(region.h × scale)
```

**The cap is a pure predicate, checked before anything is drawn:**

```ts
export const MAX_SIDE = 8192;
export const MAX_PIXELS = 16_777_216; // 4096²
export function exportRefusal(box: Box | null, scale: number): string | null
```

It takes the box and the scale rather than the computed pixels, so that one predicate answers every
way an export can fail to be sensible — nothing to export, a scale that is not a positive number,
a scale that rounds the region away to nothing, and the cap itself.

Refusing with a reason naming the computed size — `Export — 24000 × 18000 is too large; reduce the
scale`. Both bounds are **deliberately below what Chrome manages**: the spike proved Chrome reaches
16384 per side, but iOS is stricter, caps area rather than side, and is unverified (§2). A cap that
is too generous fails silently and hands the user an empty file; one that is too strict says so out
loud. The second failure is the better one.

Scale is clamped to a sane range and a non-finite or non-positive value is refused rather than
coerced, matching how the importer treats numbers (invariant 8).

**Non-integer scales soften strokes**, because a 1px stroke at 1.5× lands on a half-pixel. This is
inherent to rasterisation, not a defect, and is stated here so it is not reported as one later.

## 6. Background and transparency

A **transparent** toggle, defaulting off for the artboard and **on** for a selection.

Off, the artboard's own `background` paint is drawn — the PNG matches what the canvas shows. On,
the background is omitted and the PNG carries alpha. The spike confirms a null background yields
fully transparent pixels.

The asymmetry in the defaults is deliberate: exporting the artboard is "give me this document",
where the background belongs; exporting a selection is "give me this object", where it almost never
does.

## 7. Where the commands live

**`File ▸ Export PNG…`**, opening a `Modal` in the shape `DocumentSettingsDialog` already
establishes. The dialog holds the region, the scale with its readout, and the transparency toggle.

**`Edit ▸ Copy as PNG`** (§8) is the second entry this milestone adds. It sits in **Edit** rather
than File because it is a clipboard action and belongs beside Cut/Copy/Paste, while the export is a
file action. Both menus already exist.

**No new top-bar icon**, for the reason M11 gave: the bar's four hiding breakpoints are measured,
it fits at 739px today, and an icon would invalidate all of them. **No new keyboard shortcut** —
every obvious candidate is browser-claimed, and the File menu is reachable by touch where the
right-click menu is not.

Every control follows invariant 24: a `title` that doubles as the status-bar hint, and
`aria-disabled` with a reason rather than `disabled`.

The dialog's last-used scale, region and transparency are **not** remembered in `prefs`. Export is
an occasional, deliberate act, and a remembered 8× that silently refuses on the next document is
worse than retyping a number.

## 8. Copy as PNG

**`Edit ▸ Copy as PNG`**, writing an `image/png` `ClipboardItem`. It reuses the pipeline entirely —
only the final step differs.

Two things make this riskier than the file path, and both are handled rather than hoped about:

- **Safari requires `clipboard.write` to be *called* inside the gesture**, not merely to be handed
  a promise. *Corrected 2026-09-21, after the first implementation got this wrong.* The promise
  form exists precisely so the call can happen before the blob is ready — wrapping an
  already-resolved blob in `Promise.resolve` after an `await` satisfies the letter and defeats the
  substance, because `img.decode()` is a real async boundary and the click's transient activation
  is gone by then. So `writeClipboardPng` takes a **`Promise<Blob>`**, and `copyPng` does its
  refusal check synchronously, starts the rasterisation **without awaiting it**, and hands the
  pending promise straight through. Chrome is forgiving here and would never have surfaced it;
  the iPad pass would have — against a comment claiming the problem was solved.
- **It can reject for reasons we cannot see** — permissions, an unfocused document. It goes through
  the never-throwing wrapper pattern `src/persist/system-clipboard.ts` already uses, and a failure
  raises a notice telling the user to use `Export PNG…` instead, rather than failing silently.

If it proves unreliable on the device pass, it is one menu entry and can be dropped without
touching anything else.

## 9. Testing

The canvas step needs a DOM and Vitest has none, so the split is deliberate: the **pure core is
unit-tested and the rasterisation is browser-verified**.

**Pure, unit-tested**

- `filterToSelection`: a selected node comes back whole with its children; a node with a selected
  descendant comes back pruned to that descendant; **ancestor group transforms survive**; an
  emptied group is dropped (invariant 27); an emptied layer is dropped; an unselected sibling is
  gone; an **equal** document when every node is selected. Equal, not the same reference: this
  is not an edit — the result goes straight to the serializer and never enters the session, so it
  does not owe invariant 1's same-reference guarantee, and change-tracking it would buy nothing.
- `serializeDoc(doc, view)`: writes the given `width`/`height`/`viewBox`; **called without `view`
  it is byte-identical to today** — a tripwire, since every round-trip test depends on it.
- The size arithmetic: `round(region × scale)` at fractional scales, and that a selection's region
  is its bounds rather than the artboard's.
- `exportRefusal`: null under both bounds; a reason naming the size over each bound independently;
  a refusal for a non-finite, zero or negative scale.
- The dialog's readout string, as a pure formatter.

**Browser-verified, recorded in the CHANGELOG**

Artboard export at 1× and 2×; a selection export cropping to bounds with an overlapping object
absent; transparency on and off; the cap's refusal at a deliberately silly scale; Copy as PNG
landing in the clipboard; the saved file opening as a valid PNG of the right dimensions.

**Not re-tested:** the browser's own SVG rasteriser. The spike established it is exact (§2); these
tests cover our region, our filtering and our guards.

## 10. Out

- **Raster import / image paste.** A new node kind, an embed-or-link decision, and importer and
  serializer work — a milestone of its own, and a file format change, which this one deliberately
  avoids.
- **JPEG and WebP.** `toBlob` takes a media type and a quality, so they are nearly free to add —
  which is exactly why they can wait until someone wants one. PNG is the format a vector editor owes
  its user.
- **Exact-pixel size entry**, and remembering the last-used settings (§5, §7).
- **Trimmed-content region** — fitting the PNG to everything drawn, ignoring the artboard. A third
  rule in the dialog, the spec and the tests, for a case the artboard already covers.
- **Multi-scale export** (@1x and @2x in one action), and per-object export presets. Both are asset-
  pipeline features, and this app is not one.

## 11. Owed

- **Safari and iPad are unverified, and this is the milestone's real risk** (§2). Both the tainting
  rule and the size ceiling differ there. If iOS taints an SVG-backed canvas, `toBlob` fails and the
  feature does not work on the one device the project treats as first-class — in which case the
  fallback is the `Path2D` renderer §3 rejects, with its drift cost accepted knowingly. **Check this
  early in the device pass, not last.**
- **`MAX_SIDE` and `MAX_PIXELS` are chosen conservatively against an unmeasured iOS limit.** They
  may be tightened or loosened once the device pass produces a number.
- **Copy as PNG may still not survive contact with Safari** (§8). The gesture-boundary bug is
  fixed, but only Chrome has been exercised; Safari's activation rules are stricter than the spec
  text and only a device will settle it.
- **A selection export should use visual bounds, not geometric ones** (§4). The fix is to expand
  the box by half the largest stroke width among the selected nodes, scaled through each node's
  world matrix — and then to handle miter joins, which can overshoot half the stroke width by an
  arbitrary amount at a sharp angle. Deferred rather than rushed at a merge gate, because an
  approximate expansion that over- or under-shoots is harder to reason about than a documented
  exact rule.
- Large exports are synchronous: a 4096² PNG takes a moment and nothing reports progress. Acceptable
  at these sizes, and worth revisiting only if the cap ever rises.
