# slop-vector-editor — milestone 4a design: node editing

Date: 2026-09-17. Status: approved in brainstorming (a Node tool plus double-click from select; core
node editing; the standard Bézier pen). Follows M3b (`2026-09-17-m3b-groups-design.md`).

**M4 is split, as M3 was.** This spec is **M4a — node editing**: the Node tool and every edit that
changes an existing path. **M4b — the pen tool** follows immediately and reuses this milestone's
node model, hit-testing and overlay; the approved pen behaviour (click for a corner, drag for a
smooth node, click the first node to close, Alt to break symmetry) is written down in §11 so it is
not lost, but nothing in §11 is built here.

Paths to edit already exist: Convert to path turns any live shape into one, and imported files are
full of them.

## 1. Scope

In:
- a **Node tool** (key `N`, in the tool strip), and double-clicking a path with the select tool;
- selecting nodes: click, Shift-click, marquee;
- **moving** nodes and handles, honouring each node's type;
- **adding** a node on a segment, **deleting** selected nodes;
- **changing** a node's type (corner / smooth / symmetric);
- **closing** an open subpath;
- nudging selected nodes with the arrow keys;
- snapping to path nodes (the M2b item parked for M4);
- a Node section in Properties, and node items in the context menu;
- three parked M4 findings (§10).

Out:
- the pen (M4b);
- joining two open ends, splitting a path, scissors;
- boolean operations, outline stroke, pencil/freehand;
- editing a live rect/ellipse/polygon's nodes without converting it first;
- node alignment and distribution.

## 2. What a node selection is

- **`NodeRef = { sub: number; i: number }`** — a node's subpath and index within it.
- Store state, **not saved and not part of undo**, like `currentLayerId` and `enteredGroupId`:
  - `app.nodeTarget: string | null` — the id of the path being edited;
  - `app.nodeSel: readonly NodeRef[]` — the selected nodes within it.
- `setSession` re-resolves both: when `nodeTarget` no longer names a path on a visible, unlocked
  layer, both become null/empty; refs beyond the path's current node count are dropped. This runs on
  every session change, so undo, redo and Ungroup can't leave a stale reference.
- `replaceDocument` clears both.
- `ToolContext` gains `nodeTarget()`, `setNodeTarget(id)`, `nodeSel()` and `setNodeSel(refs)`. Tools
  still never import the store.
- The document selection (`app.selection`) holds the path itself while it is being node-edited, so
  the Properties panel, z-order and Delete keep working on the whole path when no node is selected.

## 3. Pure path edits — `src/doc/path-edit.ts`

Every function takes and returns a `PathShape` and returns the **same reference** when nothing
changes. None of them may produce a path the importer would drop, so:
- a subpath left with fewer than two nodes is removed;
- a path left with no subpaths returns `null`, and the caller deletes the whole node from the
  document (§4);
- closing a subpath never duplicates its first node — the writer emits `Z`, and a duplicated node
  would be merged away on reload (the M4 constraint in CLAUDE.md).

```ts
export function movePathNodes(path, refs, dx, dy): PathShape;
export function moveHandle(path, ref, which: "in" | "out", to: Vec, breakSymmetry: boolean): PathShape;
export function insertNode(path, sub: number, seg: number, t: number): { path: PathShape; ref: NodeRef };
export function deletePathNodes(path, refs): PathShape | null;
export function setNodeType(path, refs, type: NodeType): PathShape;
export function closeSubpath(path, sub: number): PathShape;
```

- **`movePathNodes`** moves each selected node's point **and both its handles** by the same delta,
  so the shape around it is unchanged. Duplicate refs are ignored.
- **`moveHandle`** places one handle and then repairs the other by the node's type:
  - `corner` — the other handle is untouched;
  - `smooth` — the other handle keeps its length and takes the opposite direction;
  - `symmetric` — the other handle becomes the exact mirror.
  With `breakSymmetry` (Alt), the node's type becomes `corner` and only the dragged handle moves.
  A handle dragged onto its own node point becomes `null` (no handle), which is how a curve is
  turned back into a straight line.
- **`insertNode`** splits the segment at `t` with de Casteljau (§5), so the outline does not move.
  The new node is `smooth` when the segment was a curve and `corner` when it was a straight line,
  and the two neighbouring handles are replaced by the split's results.
- **`deletePathNodes`** removes nodes and drops emptied subpaths. Removing a node does **not**
  re-fit the neighbouring curve — the outline may change, which is what every editor does.
- **`setNodeType`**:
  - `corner` keeps the handles as they are;
  - `smooth` points the out handle opposite the in handle, keeping each length (a node with one
    handle keeps it, and the other stays null);
  - `symmetric` gives both handles the average length along the in-handle's axis.
  A node with no handles is unchanged in shape by any of these; only its type changes, which decides
  how a later handle drag behaves.
- **`closeSubpath`** sets `closed: true` on an open subpath with at least two nodes; already-closed
  or too-short subpaths return the same path.

## 4. Store actions

The four that change the document call `cancelActiveGesture()` first and commit exactly one undo
step; `setNodeTarget` and `setNodeSel` only touch store state, so they do neither
(`src/state/appState.svelte.ts`):

| Action | Behaviour |
| --- | --- |
| `setNodeTarget(id \| null)` | Sets the path being edited; clears `nodeSel`. |
| `setNodeSel(refs)` | Replaces the node selection (no document change, no undo step). |
| `moveSelectedNodes(dx, dy)` | `movePathNodes` on the target. Used by the arrow keys. |
| `deleteSelectedNodes()` | `deletePathNodes`; when it returns null, deletes the path from the document (`deleteNodes`) and clears `nodeTarget`. Clears `nodeSel`. |
| `setSelectedNodeType(type)` | `setNodeType` on the selected refs. |
| `closeTargetSubpath(sub)` | `closeSubpath`. |

The tools commit their own drags through `ToolContext.commit`, as the other tools do.

**Delete** (the existing `EditAction`) routes to `deleteSelectedNodes` when the node tool is active
and `nodeSel` is non-empty; otherwise it deletes the selected objects as today. **Nudge** routes to
`moveSelectedNodes` the same way. This is one branch in `runEditAction`, which reads the store.

**Escape** extends the chain `clearOrLeaveGroup` already owns, and the first match wins:
1. the node tool with a node selection → clear `nodeSel`;
2. the node tool with a target → clear `nodeTarget` and switch back to the select tool;
3. inside a group → leave one level (M3b);
4. otherwise → clear the object selection.

## 5. Geometry — `src/geom/bezier.ts`

```ts
/** de Casteljau: `c` split at `t` into the two cubics that together draw the same curve. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic];

/** The point on `sp` nearest to `p`: which segment, where along it, and how far away. */
export function nearestOnSubpath(sp: Subpath, p: Vec): { seg: number; t: number; point: Vec; dist: number } | null;
```

- `nearestOnSubpath` walks each segment's flattened polyline for the closest sample, then refines
  with a few bisection steps around it. `seg` is the index of the segment's first node; for a closed
  subpath the last segment runs from the last node back to node 0.
- **`flattenCubic` gains a scale** (the parked finding): its segment count is chosen from the curve's
  length **in device pixels**, so hit-testing a path inside a scaled group, or at high zoom, is no
  longer coarse. Existing callers pass 1 and keep their behaviour; `hit.ts` passes the node's world
  scale, and the caches key on it.

## 6. The Node tool — `src/tools/node-tool.ts`

`ToolId` gains `"node"`; `TOOLS` gains one instance; the tool strip gets a `Spline`-style icon
after the shape tools; `n` selects it (`TOOL_KEYS`).

Everything below happens in the path's **own space**: the tool takes the path's world matrix
(`findNode`'s `parent` composed with the node's transform) and maps the pointer through its inverse.
A singular matrix means the tool does nothing.

- **Picking a path.** With no target, a click hit-tests as usual (respecting the entered group) and:
  - a path becomes `nodeTarget`, and the document selection becomes that path;
  - a live rect, ellipse or polygon selects normally and shows the info notice
    `“{label}” is a live shape — use Convert to path to edit its nodes.`;
  - a group selects normally (double-click still enters it).
- **Nodes.** With a target:
  - click a node → it becomes the only selected node;
  - Shift-click → adds or removes it;
  - drag a node → moves every selected node (snapping and Shift-constrain as in §7);
  - **double-click a node** → cycles its type `corner → smooth → symmetric → corner`;
  - **double-click a segment** → inserts a node there (`insertNode`) and selects it;
  - drag a handle → `moveHandle`, with Alt breaking symmetry;
  - drag on empty space → a marquee that selects the nodes inside it (Shift adds).
- **Leaving.** Escape clears the node selection; Escape again clears `nodeTarget` and switches back
  to the select tool. Clicking another path retargets.
- **Hit priority** within `pointerTolerance` of the pointer: handles of selected nodes, then nodes,
  then segments, then everything else.
- The tool's hint: `Click a node · drag to move · double-click a segment to add · Shift: add`.

**Double-click from the select tool** (the approved shortcut): double-clicking a path switches to
the node tool with that path as the target. A double-click on a group still enters the group, so the
two never collide — a path inside a group needs the group entered first, and then a double-click on
the path.

## 7. Snapping

- `collectTargets(doc, exclude, opts?)` gains `{ nodes?: boolean }`. With it, every path's node
  points (in document space) join the candidate lines, so a dragged node lands on other nodes.
- The node tool collects targets at pointer-down, excluding the target path itself, and clears the
  guides on up and cancel — the existing per-gesture rule.
- Shift constrains a node drag to 45° steps from its start, like a shape drag.

## 8. Drawing the nodes — `src/lib/Overlay.svelte`

While `nodeTarget` is set and the node tool is active:
- the path's outline is stroked 1px in `--color-accent`, through the same screen transform the
  canvas uses;
- every node is a 7px square knob (`handleSize` for touch), unselected knobs filled with
  `--color-text` and outlined in the accent, selected knobs filled with the accent;
- for each **selected** node, its handles are drawn as 1px accent lines to 5px round knobs;
- the marquee reuses the existing overlay marquee.

Nothing here is part of the document, and none of it is drawn for other tools.

## 9. Properties and the context menu

- **Properties** gains a "Node" section, shown when the node tool is active and `nodeSel` is not
  empty, above Geometry:
  - **Type** — three `ToggleButton`s (Corner, Smooth, Symmetric), "mixed" when the selected nodes
    differ, writing through `setSelectedNodeType`;
  - **X / Y** — the point of a single selected node, in the path's own space, blank when several are
    selected; editing moves that node (`moveSelectedNodes` with the delta).
- **Context menu**, when the node tool has a node selection: `Delete node(s)` and the three types,
  in their own section above the object items. When it has a target but no node selection, the
  object items stand as they are.

## 10. Parked findings folded in

- **A closed subpath whose last node coincides with its first loses a node on reload** — `closeSubpath`
  never writes that shape, and `insertNode` cannot create it either.
- **The importer's coincident-point tolerance is too tight for its own writer.** `near` in
  `src/svg/pathdata.ts` compares within 1e-9, but the writer rounds coordinates to 6 decimals, so
  two points that were the same before saving can be up to ~1e-6 apart in the file and fail to
  merge — a closed path then gains a stray node on reload. The tolerance becomes 1e-6, matching the
  writer. (The carry-forward note called this "exact float equality"; it is 1e-9, and the fix is the
  same.)
- **Flattening ignores matrix scale** — §5.

Still parked, and out of scope: a polygon corner can reach 2e9 and truncate after Convert to path
plus reload (M2c), and CLAUDE.md gotcha 21's wording overstates the import risk now that the
importer compares outlines within 2e-6.

## 11. Kept for M4b (the pen tool)

Approved in brainstorming, built in the next milestone:
- click places a corner node; click-and-drag places a smooth node whose handles mirror while the
  pointer moves; **Alt** during that drag breaks the symmetry;
- clicking the first node closes the path;
- **Enter** or a double-click finishes an open path; **Escape** discards the path being drawn;
- **Backspace** removes the last placed node;
- the path being drawn lives in the tool and the overlay, never in the document, and is committed as
  **one** undo step when it is finished — so the document never holds a node-less path and autosave
  never sees a half-drawn one;
- it draws into the current layer and refuses a hidden or locked one with the M3a message;
- the finished path is selected and the pen stays active.

## 12. File format

No change. `PathShape` already round-trips, including node types (`data-sv-nodes`, `nodeTypesAttr`).

## 13. Testing

- **Unit (Vitest, node):**
  - `splitCubic`: the two halves join at the split point, and sampling either half matches the
    original curve.
  - `nearestOnSubpath`: a point beside a straight segment, beside a curve, at a node, on a closed
    subpath's last segment, and on an empty subpath.
  - `flattenCubic` with a scale: more samples at a larger scale, unchanged at 1.
  - `movePathNodes`: several nodes and their handles, a duplicate ref, an unknown ref, a no-op.
  - `moveHandle`: each of the three types, Alt breaking symmetry, and a handle dropped on its node
    becoming null.
  - `insertNode`: on a curve (the outline is unchanged at several sample points) and on a line; the
    returned ref; the neighbours' handles.
  - `deletePathNodes`: one node, a whole subpath when it drops below two nodes, and null when the
    path empties.
  - `setNodeType`: each direction, including a node with one handle and a node with none.
  - `closeSubpath`: an open subpath, an already-closed one, and a one-node subpath.
  - `collectTargets` with `{ nodes: true }`.
  - `mergeCoincident`'s tolerance: a point 1e-7 away merges, one 1e-3 away doesn't.
  - Node-tool hit priority and the ref maths, through the fake context.
- **Build:** 0 errors, 0 warnings; lint and format clean.
- **Browser (controller, port 5198, screenshots):** convert a rect to a path and edit it; drag a
  node and a handle of each type; Alt-break; double-click a segment to add a node and a node to
  cycle its type; marquee-select nodes and nudge them; delete a node, and delete every node of a
  path (the path goes); close an open path; snap a node to another node; the Node section in
  Properties; the context-menu items; node-edit a path inside a group; save and reload the result
  unchanged; undo each step; no console errors.
