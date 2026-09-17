# slop-vector-editor — milestone 3b design: groups

Date: 2026-09-17. Status: approved in brainstorming (double-click enters a group; the layers panel
nests group children and can drag in and out; Ungroup bakes the group's transform and opacity into
its children). Follows M3a (`2026-09-17-m3a-layers-panel-design.md`).

## 1. Scope

Groups already exist in the model: the importer reads `<g>` into a `Group` node, and hit-testing,
bounds, styling and serialising already walk into them. What is missing is everything that lets a
user make, edit and take apart a group.

In:
- Group (⌘G) and Ungroup (⇧⌘G), in the top bar and the context menu;
- a selection that can name a node at any depth, and every edit working on such a node;
- entering a group on the canvas (double-click) and leaving it (Escape);
- nested rows in the layers panel, including dragging into and out of a group;
- the Opacity field editing group opacity;
- three parked findings that touch the code this milestone rewrites (§9).

Out:
- new group-only properties (blend modes, clip, mask, isolation);
- reordering a group's children by z-order keys — that already works, because z-order acts within
  each node's own parent (§4.4);
- a per-document id index for lookups, and caching of snap targets (both stay parked, §9);
- keyboard navigation of the panel tree.

## 2. Selection at any depth

Today a selection is a list of top-level ids, and two helpers in `src/doc/tree.ts` carry the whole
editing stack: `findTopLevel` (read a node) and `mapTopLevel` (edit nodes by id). Generalising
exactly these two to any depth is what makes everything else work.

### 2.1 `src/doc/tree.ts`

```ts
export type Found = {
  layer: Layer;
  layerIndex: number;
  /** Child indices from the layer down to the node; its last entry is the node's own index. */
  path: readonly number[];
  node: Node;
  /** The accumulated matrix of the node's ancestors, excluding the node's own transform. */
  parent: Mat;
  /** The group holding the node, or null when it sits directly in the layer. */
  parentGroup: Group | null;
};

export function findNode(doc: Doc, id: string): Found | null;
export function mapNodes(doc: Doc, ids: readonly string[], fn: (n: Node, parent: Mat) => Node): Doc;
```

- `findNode` searches depth-first, layer by layer, and returns the first match. Ids are unique in a
  document, so the first match is the only one.
- `mapNodes` walks into groups, applies `fn` to every node whose id is in `ids`, and returns the
  same document reference when nothing changed. A node that is itself replaced is not descended
  into, so an id list holding both a group and its child touches the child only through the
  group's own replacement.
- `findTopLevel` and `mapTopLevel` are removed. Every caller moves to the new pair. `mapShapes` and
  `shapesOf` are unchanged.
- **`selectableIds(doc, enteredGroupId)`** returns the ids a canvas gesture may select in the
  current context:
  - with `enteredGroupId` null, the top-level ids of visible, unlocked layers (as today);
  - inside a group, that group's direct children — and nothing else.
- **`pruneSelection(doc, ids)`** keeps every id that still exists at any depth on a visible,
  unlocked layer, so a selection made inside a group survives an unrelated edit. It stays
  order-preserving, de-duplicating and same-reference on a no-op. It is deliberately looser than
  `selectableIds`: pruning must not depend on where the user is.
- **`ancestorIds(doc, id): string[]`** gives the ids from the outermost group down to the node's own
  parent group (empty at the layer level). Escape (§3.3), the panel (§5) and hit-testing (§3.1) use
  it.

### 2.2 Transforms

A node's own `transform` lives in its parent's space. An edit expressed in document space (a move, a
rotation, a resize map) must be converted before it is applied to a nested node:

```ts
/** `W`, a document-space map, expressed in the space of a child under `parent`. */
export function inParent(parent: Mat, W: Mat): Mat | null {
  const inv = invert(parent);
  return inv ? multiply(inv, multiply(W, parent)) : null;
}
```

`inParent` lives in `src/geom/mat.ts`. When the parent matrix is singular (a group scaled to
nothing by an imported file), the conversion returns null and the edit **skips that node**, leaving
it untouched rather than throwing or corrupting it.

At the top level `parent` is the identity, so `inParent` returns `W` unchanged and every existing
test keeps its expected values.

Moving a node from one parent to another is a different sum, and gets its own helper beside it:

```ts
/** The transform a node needs to keep its place on screen when it moves from `from` to `to`.
 *  Its own world matrix is `from ∘ t`, and it must stay that under `to`. */
export function reparent(from: Mat, to: Mat, t: Mat): Mat | null {
  const inv = invert(to);
  return inv ? multiply(inv, multiply(from, t)) : null;
}
```

## 3. Entering a group on the canvas

### 3.1 Store and context

- `app.enteredGroupId: string | null` — new `$state`. It is **not saved and not part of undo**, like
  `currentLayerId`.
- `setSession` re-resolves it: when the id no longer names a group in the document, it becomes null.
- `replaceDocument` sets it to null.
- `ToolContext` gains `enteredGroupId(): string | null` and `setEnteredGroup(id: string | null): void`.
  Tools still never import the store.
- `hitTest(doc, p, tol, enteredGroupId)` returns `{ layerId, nodeId }` where `nodeId` is:
  - inside a group: the **direct child** of that group under the pointer;
  - otherwise, or when nothing inside the group is under the pointer: the top-level ancestor, as
    today.
- `marqueeSelect(doc, box, enteredGroupId)` collects, in the same way, either the group's direct
  children or top-level nodes.

### 3.2 The select tool

- `ToolEvent` gains `time: number` (the pointer event's `timeStamp`), so the tool can see a double
  tap. `src/lib/double-tap.ts` moves to `src/input/double-tap.ts` — it is now shared by the panel
  and a tool, and `src/lib/` may not be imported from `src/tools/`.
- **Double-click or double-tap** (`isDoubleTap` on the hit id, the existing 350 ms window):
  - on a group: enter it, and select the child under the pointer;
  - on a group that is a child of the entered group: enter that one (nesting works to any depth);
  - on anything else: no change beyond the ordinary click.
- **A click outside the entered group** — the top-level hit is neither the entered group nor a
  descendant of it — leaves the group (`setEnteredGroup(null)`) and then selects normally, in the
  same gesture.
- A drag that starts on a child inside the entered group moves that child, converted through
  `inParent`. Resize and rotate work the same way, through the same conversion.
- The tool's hint is unchanged. The status bar shows the context instead (§3.4).

### 3.3 Leaving

Escape, in `runEditAction`'s `clear` case:
- inside a group: leave one level — the new entered group is the parent group of the one being
  left (via `ancestorIds`), or null at the top — and the group just left becomes the selection;
- otherwise: clear the selection, as today.

Entering is also dropped when the entered group stops existing (§3.1), for example after Ungroup or
undo.

### 3.4 Showing it

- **Overlay:** while a group is entered, `Overlay.svelte` draws its selection frame as a 1px dashed
  rectangle in `--color-line`, under the selection handles. It is drawn from `app.enteredGroupId`,
  not from the transient tool overlay.
- **Status bar:** the left slot becomes `app.hoverHint ?? enteredHint ?? TOOLS[app.toolId].hint`,
  where `enteredHint` is `Inside “{label}” — Escape to leave` and `{label}` is the group's
  `rowLabel`.

## 4. Group and Ungroup

New pure module `src/doc/group.ts`. Both edits return the same document reference when nothing
changes.

### 4.1 `groupNodes(doc, ids): { doc: Doc; id: string | null }`

1. Resolve `ids` to nodes (`findNode`), dropping ids that don't exist and any node that is a
   **descendant of another selected node** — grouping a group together with its own child means
   grouping the group.
2. With no node left, return `{ doc, id: null }`.
3. The **target parent** is the parent of the frontmost node (the last one in document order), and
   the group is inserted at that node's index, counted after the moved nodes are taken out. So a
   group lands where its frontmost member was, and keeps its z-order.
4. The children keep their place on screen. A node moving from parent matrix `P_old` into the
   target's matrix `P_new` gets `reparent(P_old, P_new, T)` (§2.2). The new group's own transform is
   the identity, so `P_new` is the target parent's matrix. If any conversion returns null (a
   singular matrix), the whole operation is a no-op and returns `{ doc, id: null }`.
5. The children are ordered by document order (bottom to top, layer by layer), so overlaps look the
   same afterwards.
6. The new group is `{ kind: "group", id: idFor(doc.nextId), transform: IDENTITY, opacity: 1,
   children }`, and `nextId` is bumped.
7. Groups that lose all their children this way are removed, up the chain (§4.3).

### 4.2 `ungroupNodes(doc, ids): { doc: Doc; ids: string[] }`

For every selected **group**, in place:
- each child's transform becomes `multiply(group.transform, child.transform)`;
- the group's opacity is folded into each child: a shape's `style.opacity` and a child group's
  `opacity` are multiplied by it, rounded to 6 decimals (the writer's precision) so a round trip is
  stable;
- the children replace the group at its index, keeping their order;
- selected nodes that are not groups are left alone.

The returned `ids` are the selection afterwards: the freed children, plus the untouched non-group
nodes, in document order. With no group selected, the document is returned unchanged.

### 4.3 Empty groups

The importer drops empty groups (the M2 round-trip constraint), so no edit may leave one:
`deleteNodes` — now recursive — removes any group left with no children, repeatedly, up to the
layer. A layer may of course be empty.

### 4.4 What already works, and must keep working

`deleteNodes`, `duplicateNodes` (a copy is inserted right after its original, inside the same
parent, with fresh ids throughout), `setStyle`, `setRectRadius`, `setPolygon`, `convertToPath`,
`flattenTransform`, `renameNode` and the four z-order edits all move to `mapNodes` and act inside
each node's own parent. Z-order within a group therefore needs no new code: `bringForward` on a
child moves it among its siblings.

`insertNodes` (paste) is unchanged: pasting always goes into the current layer, even when a group is
entered. This is deliberate — pasting into the layer is predictable, and the pasted nodes can be
dragged into the group in the panel.

## 5. The layers panel

`LayersPanel.svelte` gains nesting. Everything from M3a §5 stays as it is unless named here.

- **Rows.** A group row renders like a layer row within the tree: a grip, a chevron, its label from
  `rowLabel`, and no eye or lock (those stay a layer-only feature, per the M3a decision). Its
  children are indented one more level: 20px per depth, as today for a layer's children.
- **Expansion** reuses the existing `collapsed` record, keyed by the group's id, expanded by
  default.
- **Selection.** Tapping a group row selects the group. Tapping a child selects the child, exactly
  like a top-level object, and sets the entered group to that child's parent group so the canvas
  agrees with the panel.
- **Rename** works on group rows too (`renameNodeById` already takes any node id).
- **Dragging.** `dropTarget` is extended so a parent is a layer **or** a group:

  ```ts
  export type Drop =
    | { kind: "layer"; index: number; line: number }
    | { kind: "node"; parentId: string; index: number; line: number };
  ```

  - Hovering a **group row** drops into that group, at the top of its children — the same rule a
    layer row already follows.
  - Hovering a **child row** drops as a sibling of that child, above or below by its midpoint.
  - A drop is refused (null) when the target layer is hidden or locked, when nothing would change,
    or when the target group **is, or is inside, a node being dragged**.
- **The moved nodes keep their position on screen**, through the same `reparent` composition as
  §4.1. A move whose conversion fails (a singular parent matrix) is refused, and the document is
  returned unchanged.
- `moveNodes(doc, ids, parentId, index)` in `src/doc/layers.ts` takes a layer or group id, and
  `moveNodesTo(ids, parentId, index)` in the store follows. Both keep the M3a guarantees: document
  order is preserved, the index counts after removal, it is clamped, blocked layers are refused,
  and the moved nodes become the selection.

## 6. Controls

- **Top bar**, in the object group, after Duplicate and Delete and before the z-order group:
  | Control | Icon | Title | Disabled when |
  | --- | --- | --- | --- |
  | Group | `Group` | `Group (⌘G)` | nothing selected → `Group — nothing selected` |
  | Ungroup | `Split` | `Ungroup (⇧⌘G)` | no group selected → `Ungroup — select a group` |

  lucide has no "ungroup" icon; `Split` is the closest and is already used nowhere else.
- **Context menu:** `Group ⌘G` and `Ungroup ⇧⌘G`, in the selection section next to Duplicate.
  Ungroup appears only when the selection holds a group.
- **Keys** (`editActionForKey`, the modifier branch): `g` → `{ kind: "group" }`, and with Shift
  `{ kind: "ungroup" }`. These go by `key`, not `code`, because Shift does not change the letter.
- **`selectionActions`** gains `canGroup` (any node selected) and `canUngroup` (any selected node is
  a group), so the bar and the menu ask one helper.

## 7. Properties

- **Opacity** edits group opacity (the parked M3-carry-forward item). `summarizeStyle` and the
  Opacity field currently read shape styles through `shapesOf`. A selected group's own `opacity`
  now takes part:
  - the summary treats a group as one value — its `opacity` — alongside each selected shape's
    `style.opacity`, and shows blank when they differ;
  - setting it writes `opacity` on selected groups and `style.opacity` on selected shapes, in one
    undo step. A group's children are not touched, so the group's own opacity stays meaningful.
- **Geometry** (X/Y/W/H) already works through `selectionBounds` and `frameResizeMap`, which are
  document-space; with `findNode` and the `inParent` conversion they apply unchanged to a nested
  node.
- The Shape section (rect radius, polygon fields) applies to nested shapes the same way.

## 8. File format

No change. Groups already round-trip as `<g>` with `opacity`, `transform` and `data-sv-name`. A
group made in the app writes `<g>` with no attributes beyond its children, which is exactly what the
importer reads back.

## 9. Parked findings folded in

These sit in the carry-forward memory against M3b and touch the code this milestone rewrites:
- **`pruneSelection` inside groups** — settled by §2.1.
- **Group opacity in the Opacity field** — §7.
- **`isAxisAligned` uses an absolute epsilon** (`1e-9`), which misclassifies an imported matrix
  whose entries are huge: a shear of 1e-6 in a matrix scaled by 1e9 reads as axis-aligned, and a
  resize then bakes a wrong shape. It becomes relative: compare `|m[1]|` and `|m[2]|` against
  `eps * max(1, |m[0]|, |m[3]|)`. Nested groups make skewed parents much easier to hit.
- **Missing resize tests** — a mirrored ellipse and path, a rotated child inside a group, and a
  singular matrix (which must leave the node untouched).

Still parked, and explicitly out of scope: a per-document id index for `findNode`, caching in
`collectTargets`, and the layers panel measuring every row on each pointermove.

## 10. Testing

- **Unit (Vitest, node):**
  - `findNode`: top level, nested two deep, the accumulated parent matrix, `parentGroup`, path, and
    a missing id.
  - `mapNodes`: edits a nested node, same reference on a no-op, and a group in the id list is
    replaced without descending into it.
  - `inParent`: identity parent, a translated parent, a rotated parent, and a singular parent.
  - `reparent`: a node keeps its world matrix when it moves between two rotated parents, and a
    singular target returns null.
  - `selectableIds` and `pruneSelection`: at the root and inside a group, a child on a locked layer,
    and a stale id.
  - `groupNodes`: two nodes in one layer; nodes from two layers and from inside a group; position
    kept under a rotated target parent; a group plus its own child; a single node; nothing
    selected; the resulting z-order; `nextId`; an empty group removed behind it.
  - `ungroupNodes`: transforms composed; opacity folded into shapes and into a child group;
    ordering and index kept; a non-group in the selection; nothing selected.
  - `deleteNodes`: a nested node, and an emptied group removed up the chain.
  - `duplicateNodes`, `translateNodes`, `rotateNodes`, `resizeNodes`, `setStyle`, z-order: each on a
    nested node, with the parent's transform respected.
  - `hitTest` and `marqueeSelect`: with and without an entered group.
  - `dropTarget`: into a group, out of a group, onto a group's own descendant (refused), and a
    blocked layer.
  - `summarizeStyle`: a group and a shape with different opacity reads as mixed.
  - `isAxisAligned`: a large-magnitude matrix with a small shear.
  - Resize: the three cases from §9.
- **Build:** 0 errors, 0 warnings. Lint and format clean.
- **Browser (controller, port 5198, screenshots of each state):** make a group from a
  multi-selection; double-click to enter and Escape to leave, including a nested group; the dashed
  frame and the status-bar text; moving, resizing and rotating a child inside a rotated group;
  panel nesting, with a drag into and out of a group; group rename; Ungroup restoring positions and
  appearance; Opacity on a group; ⌘G and ⇧⌘G; the disabled reasons; z-order inside a group; delete
  of a group's last child removing the group; undo of each; no console errors.
