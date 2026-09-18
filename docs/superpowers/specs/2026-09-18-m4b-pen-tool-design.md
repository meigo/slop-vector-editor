# slop-vector-editor — milestone 4b design: the pen tool

Date: 2026-09-18. Status: approved in brainstorming — the standard Bézier pen (settled with M4a and
recorded in its §11), plus resuming an existing open path by clicking one of its ends. Follows M4a
(`2026-09-17-m4a-node-editing-design.md`), which shipped the node model, the pure path edits and
the node overlay this milestone builds on.

## 1. Scope

In:
- a **Pen tool** (key `P`, in the tool strip) that draws a path node by node;
- click for a corner node, click-and-drag for a smooth node whose handles mirror, **Alt** to break
  that symmetry while dragging;
- **closing** a path by clicking its first node; **finishing** an open one with Enter or a
  double-click; **Escape** discards what is being drawn;
- **Backspace** removes the last placed node;
- **Shift** constrains the next node to 45° from the previous one, and snapping applies to placed
  points when Snap is on;
- **resuming** an existing open path by clicking either end, including closing it by clicking the
  other end;
- two new pure edits (`appendNode`, `reverseSubpath`) and the draft's overlay;
- the two M4b items parked in the carry-forward (§9).

Out:
- joining two different paths, splitting, scissors;
- a freehand or pencil tool, and curvature/"smart" pens;
- editing an existing node while the pen is active (that is the Node tool);
- drawing inside an entered group — a new path goes into the current layer (§4), as paste does.

## 2. How a path is drawn

**The path being drawn never lives in the document.** The tool keeps a **draft** and shows it in the
overlay; the document is touched exactly once, when the path is finished. This is what keeps a
node-less or one-node path — which the importer drops — from ever reaching the document or autosave,
and it gives the whole stroke a single undo step.

```ts
type Draft = {
  /** null while drawing a new path; the id of the path being extended when resuming. */
  pathId: string | null;
  /** The path's own space; identity for a new path, the resumed path's world matrix otherwise. */
  world: Mat;
  inv: Mat;
  /** Nodes in that space, in draw order. */
  nodes: PathNode[];
  closed: boolean;
  /** The layer a new path will go into. */
  layerId: string;
  /** Set while a press is pulling handles out of the node just placed. */
  pulling: { index: number; alt: boolean } | null;
};
```

- **A click** (press and release without moving past the drag threshold) places a **corner** node.
- **A press and drag** places a node and pulls its handles: `out` follows the pointer, `in` mirrors
  it. With **Alt**, only `out` moves and the node becomes a corner, so the next segment leaves
  straight.
- The node placed by the previous click keeps its `out` handle; the new node's `in` handle is the
  mirror of the drag, which is what makes a dragged pen stroke curve on both sides.
- **Shift** constrains the placed point to 45° steps measured from the previous node, before
  snapping. Snapping uses the same targets as the other tools plus path nodes
  (`collectTargets(doc, [], { nodes: true })`), and the guides are cleared when the stroke ends.
- **Backspace** (or Delete) removes the last placed node. Removing the only node leaves an empty
  draft, which is discarded.
- **Escape** discards the draft: a new path is never created, and a resumed path is left exactly as
  it was.

## 3. Finishing

- **Clicking the draft's first node** closes it (`closed: true` — never a repeated node) and
  finishes.
- **Enter** or a **double-click** finishes an open path. The double-click's second press finishes
  rather than placing another node, so the path ends on the node the first click placed.
- Switching tools, or clicking with fewer than two nodes in the draft, finishes the same way.
- **A finished path needs at least two nodes**; anything shorter is discarded.
- On finish the document is committed **once**:
  - a **new** path is created on the draft's layer with `prefs.style` and an identity transform,
    and becomes the selection;
  - a **resumed** path has its subpath replaced, and the path stays selected.
- The pen stays active afterwards, so the next click starts a new path.

## 4. Where a new path goes

The **current layer** (M3a), refusing a hidden or locked one with the same message the other draw
tools use: `“{name}” is hidden — show it to draw.` / `“{name}” is locked — unlock it to draw.` The
check happens on the first press of a stroke; a stroke already in progress is unaffected by a later
layer change, because it is committed against the document as it is at finish time.

## 5. Resuming an existing path

- With no draft, a press within `pointerTolerance` of an **end node of an open path** — its first or
  last node — starts a draft that continues that path instead of starting a new one.
- The draft copies the path's nodes and its world matrix. When the pen resumes from the **first**
  node, the subpath is reversed first (`reverseSubpath`), so drawing always appends. Reversing swaps
  each node's `in` and `out` handles and reverses the order, which leaves the drawn shape identical.
- While resuming, the document still shows the original path and the overlay draws the draft on top.
  The draft always contains every original node, so the two agree except for the part being added.
- **Clicking the other end** closes the path and finishes.
- Escape leaves the original path untouched.
- A closed path has no ends, so it cannot be resumed; clicking one of its nodes starts a new path as
  usual.

## 6. Pure edits — `src/doc/path-edit.ts`

Two additions, in the same style as M4a's six (same reference when nothing changes, never a shape
the importer drops):

```ts
/** Adds `node` to the end of an open subpath. */
export function appendNode(path: PathShape, sub: number, node: PathNode): PathShape;

/** Reverses a subpath's node order, swapping each node's handles, so the drawn shape is unchanged. */
export function reverseSubpath(path: PathShape, sub: number): PathShape;
```

- `appendNode` refuses a closed subpath and an unknown index.
- `reverseSubpath` is its own inverse, and a subpath of fewer than two nodes comes back unchanged.
- The pen builds its draft from plain `PathNode`s and only calls these when committing a resumed
  path, so the draft logic stays in the tool.

## 7. The overlay

`Overlay` gains one variant, in **document** coordinates, so the overlay component stays free of
matrices:

```ts
| {
    kind: "pen";
    /** The draft's flattened outline, one polyline per subpath. */
    outline: Vec[][];
    /** Every placed node. */
    knobs: Vec[];
    /** Handle lines of the node being pulled, or of the last node. */
    handles: { a: Vec; b: Vec }[];
    /** From the last placed node to the pointer, while the pen waits for the next click. */
    rubber: { a: Vec; b: Vec } | null;
  }
```

Drawn like the node tool's overlay: a 1px accent outline, square knobs at the nodes (the first node
drawn filled once the pointer is near enough to close), round handle knobs, and a 1px dashed rubber
band. Nothing here is part of the document.

## 8. Controls

- **Tool strip:** a Pen entry (lucide `PenTool`) before the Node entry; `p` selects it
  (`TOOL_KEYS`), and `P` appears in its tooltip.
- **Status bar:** the tool's hint is
  `Click to place · drag for a curve · click the first node to close · Enter to finish`.
- **Escape** reaches the tool through `keydown` (below): while a draft exists the pen consumes the
  key and discards it; otherwise `clearOrLeaveGroup` behaves as it does today. Escape does **not**
  go through `cancel()`, which now means something different for this tool.
- **Enter** is new: `editActionForKey` maps it to `{ kind: "commit" }`, and `runEditAction` asks the
  active tool to finish. No other tool uses it.
- **Backspace/Delete** while a draft exists removes the last node instead of deleting the selection.

Because three keys now need to reach the active tool, and because the rubber band has to follow a
pointer that is not pressed, `Tool` gains three optional methods:

```ts
/** True when the tool consumed the key; the store then does nothing else. */
keydown?(ctx: ToolContext, key: "escape" | "enter" | "backspace"): boolean;
/** Whether a gesture or draft is in progress — the store asks before routing those keys. */
busy?(): boolean;
/** Pointer movement with no button down. The canvas calls it when no gesture is running. */
hover?(ctx: ToolContext, e: ToolEvent): void;
```

The store's `runEditAction` consults `TOOLS[app.toolId]` for `clear`, `delete` and the new `commit`
before its own handling, passing `storeContext`. Tools that implement none of these behave exactly
as they do now: `Canvas.svelte` already tracks pointer movement for the cursor readout, and calls
`hover` from there only when no gesture is active.

**`cancel()` ends the press, not the drawing.** A `pointercancel` — a palm on the iPad, a lost
capture — stops the handles being pulled and leaves the draft intact; only Escape, a finish or a
tool change ends a stroke. This differs from every other tool, where `cancel` rolls the gesture
back, and it exists because losing a half-drawn path to a stray touch is the worse failure.

## 9. Parked findings folded in

- **The pen must never create a closed subpath whose last node repeats its first** — closing sets
  `closed` and never appends a copy of the first node (§3).
- **`mergeCoincident` in `src/geom/shapes.ts` uses exact float equality.** M4a widened the
  *importer's* tolerance; this one is the shape-to-path converter's, and a pen-drawn path that is
  later converted can hit it. It becomes the same 1e-6 tolerance, and `rectPath`'s existing
  behaviour (a corner radius of exactly half a side merges) must not change.

Still parked, and out of scope: hit-testing flattens at document scale and ignores viewport zoom;
`nearestOnSubpath` costs ~120 cubic evaluations per segment per press; `select.ts` keeps `lastTap`
across a drag; a path inside a group contributes no snap targets; `movePathNodes` can drag a node
onto its subpath's first node.

## 10. File format

No change. A pen-drawn path is an ordinary `PathShape` and round-trips through `subpathsToD` and
`data-sv-nodes` exactly as an imported one does.

## 11. Testing

- **Unit (Vitest, node):**
  - `appendNode`: an open subpath, a closed one (refused), an unknown index, and the same-reference
    rule.
  - `reverseSubpath`: order and handles swapped, applying it twice returns the original, a one-node
    subpath is unchanged, and the flattened outline is identical before and after.
  - `hover` updating the rubber band without a press, and `cancel` leaving the draft intact.
  - The pen tool through the fake context: a two-click line; a click-drag giving mirrored handles;
    Alt breaking them; Shift constraining to 45°; closing by clicking the first node; Enter and
    double-click finishing; Backspace removing the last node; Escape discarding without touching the
    document; a blocked layer refusing with the exact message; a finished path landing on the
    current layer with `prefs.style` and becoming the selection; a draft of one node discarded.
  - Resuming: a press on either end starts a draft (the first-node case reverses), appending
    commits one undo step, clicking the other end closes it, and Escape leaves the path untouched.
  - `mergeCoincident`'s tolerance, and `rectPath` still merging a half-side radius.
  - `editActionForKey` mapping Enter, and `runEditAction` routing Escape / Enter / Backspace to a
    busy tool.
- **Build:** 0 errors, 0 warnings; lint and format clean.
- **Browser (controller, port 5198, screenshots):** draw a straight path and a curved one; Alt-break
  mid-stroke; Shift-constrain; snap a node to another path's node; close by clicking the first node;
  finish with Enter and with a double-click; Backspace; Escape; a hidden layer refusing; resume an
  open path from each end and close it; the new path's style and selection; one undo step per
  stroke; node-edit the result with the Node tool; save and reload it unchanged; the pen on a
  hidden-then-shown layer; no console errors.
