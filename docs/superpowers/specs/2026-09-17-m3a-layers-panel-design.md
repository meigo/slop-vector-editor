# slop-vector-editor — milestone 3a design: layers panel and z-order

Date: 2026-09-17. Status: approved in brainstorming.
- Layers contain objects. Every object gets a row inside its layer, but not a layer of its own.
- The M3 milestone is split into 3a (layers panel and z-order) and 3b (groups).
- Eye and lock toggles exist on layers only.
- Z-order icons go in the top bar (M2e).

This spec extends the v1 spec (§5, §6 "Layers panel") and the M2e design. Where they disagree, this
file wins for 3a onward.

## 1. Scope

In:
- a current layer that receives new shapes and pastes
- layer edits: add, delete, rename, show/hide, lock/unlock, reorder
- renaming objects
- moving objects within a layer and between layers
- z-order: forward, backward, to front, to back
- the Layers panel
- the carried-over name sanitising in the SVG writer

Out:
- groups: group/ungroup, entering a group, group opacity, rows inside groups (all 3b)
- eye and lock toggles on individual objects
- multi-layer selection rules beyond those below
- keyboard navigation inside the panel
- thumbnails

## 2. Current layer

- **State.** `app.currentLayerId: string` is a new `$state` on the store. It is not saved and not
  part of undo.
- **Pure helpers (`src/doc/layers.ts`).**
  - `resolveLayerId(doc, id: string | null): string` returns `id` if a layer with that id exists,
    otherwise the top-most layer's id. A document always has at least one layer.
  - `layerBlock(doc, id): { name: string; reason: "hidden" | "locked" } | null` returns `null`
    when the layer is visible and unlocked.
- **When it changes.**
  - Load, new document and `replaceDocument` set it to the top-most layer.
  - Every session change runs through `setSession` (gotcha #13), which re-resolves it. This covers
    the current layer being deleted, and undo/redo removing it.
  - A non-empty selection makes the layer of the **last** selected id current (inside
    `setSelection`). Tools reach this through `ctx.setSelection`.
  - Tapping a layer row sets it (§5).
- **Drawing.**
  - `ToolContext` gains `currentLayerId(): string`.
  - `createDragTool.down` uses `ctx.currentLayerId()` instead of `targetLayerId`.
  - If `layerBlock` is non-null, nothing is drawn and the tool notifies
    `“{name}” is hidden — show it to draw.` or `“{name}” is locked — unlock it to draw.`
    (info kind).
- **Paste.**
  - `planPaste(doc, text, clip, view, layerId)` takes the target layer as a parameter.
  - A blocked layer returns `{ error: "“{name}” is hidden — show it to paste." }` or
    `{ error: "“{name}” is locked — unlock it to paste." }`. This replaces the old `NO_LAYER`
    message and constant; its test is updated accordingly.
  - The store passes `app.currentLayerId`.
- **Removed:** `targetLayerId` in `doc/tree.ts` and its tests, once nothing uses it.
- **Unchanged:** duplicate and Alt-duplicate still place copies in the source layer, next to the
  originals.

## 3. Pure edits (`src/doc/layers.ts`)

Every edit returns the **same** `doc` when nothing changes. None creates an empty-name layer, and
no edit ever leaves the document with zero layers.

- `addLayer(doc, aboveId: string | null): { doc: Doc; id: string }`
  - Inserts a new empty, visible, unlocked layer directly above `aboveId`, or on top when it is
    `null` or unknown.
  - The new layer's name is `Layer N`, where N is one more than the highest N among existing names
    that match `/^Layer (\d+)$/`, or 1 when none match.
  - The new layer's id comes from `idFor(doc.nextId)`, and `nextId` is incremented.
- `deleteLayer(doc, id): Doc` removes the layer and its objects. It returns the same doc when the
  id is unknown or the layer is the only one.
- `renameLayer(doc, id, name): Doc`
  - trims `name` and caps it at 100 characters;
  - an empty result, the same name, or an unknown id returns the same doc.
- `setLayerVisible(doc, id, visible: boolean): Doc` and `setLayerLocked(doc, id, locked: boolean): Doc`.
- `moveLayer(doc, id, toIndex: number): Doc`
  - `toIndex` is the layer's index in the resulting array (0 = bottom), clamped to range.
- `moveNodes(doc, ids, layerId, index: number): Doc`
  - Removes the listed top-level nodes, keeping their document order (bottom → top), and inserts
    them together into `layerId` at `index`.
  - `index` counts the target layer's children after the removal (0 = bottom) and is clamped.
  - An unknown layer, no matching ids, or an unchanged result returns the same doc.
- `renameNode(doc, id, name: string): Doc`
  - applies to top-level nodes, trimmed and capped at 100 characters;
  - an empty result removes `name`, so the row shows its default label.
- Z-order, applied per layer and never across layers. Z-order edits only change order.
  - `bringForward(doc, ids)`: each selected node moves one step up, past the next unselected
    sibling above it. Nodes are processed from the top down, so a contiguous block moves together.
  - `sendBackward(doc, ids)`: the mirror of `bringForward`.
  - `bringToFront(doc, ids)`: the selected nodes move to the top of their layer, keeping their
    relative order.
  - `sendToBack(doc, ids)`: the mirror of `bringToFront`.
- **Row label** (`rowLabel(node): string`): `node.name` if set, otherwise by kind:
  - rect → "Rectangle"
  - ellipse → "Ellipse"
  - polygon → "Star" when `star`, else "Polygon"
  - path → "Path"
  - group → "Group"

## 4. Store actions (`src/state/appState.svelte.ts`)

- Every action that edits the document calls `cancelActiveGesture()` first and commits exactly one
  undo step.
- **Layer actions:**
  - `addLayerAboveCurrent()`: the new layer becomes current.
  - `deleteCurrentLayer()`: asks for confirmation first when the layer has objects, using
    `askConfirm("Delete layer “{name}” and its {n} object(s)?", "Delete")`, with "object" or
    "objects" as appropriate.
  - `renameLayerById(id, name)`
  - `toggleLayerVisible(id)`
  - `toggleLayerLocked(id)`
  - `moveLayerTo(id, index)`
- **Object actions:**
  - `moveNodesTo(ids, layerId, index)`: the moved nodes become the selection.
  - `renameNodeById(id, name)`
- **Z-order:** `bringSelectionForward()`, `sendSelectionBackward()`, `bringSelectionToFront()`,
  `sendSelectionToBack()`.
- **Selection:** `setCurrentLayer(id)` does not touch the selection. `selectFromPanel(id, additive)`
  replaces the selection, or toggles `id` in it when `additive` is true.
- **Unchanged:** hidden and locked layers are already removed from the selection by `setSession`.

## 5. Layers panel (`src/lib/LayersPanel.svelte`)

### 5.1 Placement

- The right sidebar becomes a column with Properties on top and Layers below.
  - Properties is `flex-1 min-h-0` and scrolls.
  - Layers has a fixed share, `h-[45%] min-h-40`, with its own scroll.
- The narrow-screen drawer contains the same column.
- There is a 1px `line` border between the two parts.

### 5.2 Header

- A header strip holds the `.section-title` "Layers" plus two `IconButton`s on the right:
  - **New layer** (`Plus`, title "New layer").
  - **Delete layer** (`Trash2`, title "Delete layer “{name}”"). While disabled, its title is
    "Delete layer — it is the only layer".
- This follows guide §4: the create command sits next to the thing it creates.

### 5.3 Rows

- **Order.** Layers are listed top-most first. Inside an expanded layer, its objects are listed
  top-most first and indented.
- **Row height.** Every row is 32px.
- **Layer row**, from left to right:
  1. a grip (`GripVertical`)
  2. an expand chevron (`ChevronRight` or `ChevronDown`)
  3. the name
  4. an eye button: `Eye` when visible, `EyeOff` when hidden; label and title "Hide “{name}”" or
     "Show “{name}”"
  5. a lock button: `LockOpen` or `Lock`; label and title "Lock “{name}”" or "Unlock “{name}”"
- **Expand state.** Expanded or collapsed is per layer, local to the component (not saved), and
  expanded by default.
- **Object row:** grip, then the label (§3 `rowLabel`), indented 20px.
- **Current layer.** Its row has `.ui-selected-tint`.
- **Selected objects.** Their rows have `.ui-selected` (edge plus tint). The two row styles never
  appear on the same row.
- **Rows in a hidden or locked layer.**
  - They are `text-muted`. A tap does not select them.
  - Their title says "Layer “{name}” is hidden" or "Layer “{name}” is locked".
  - The layer row itself stays fully interactive.

### 5.4 Tapping

- **Layer row** (outside its buttons): `setCurrentLayer`.
- **Object row:** `selectFromPanel(id, additive)`, where `additive` is `shiftKey || metaKey || ctrlKey`.
- **Eye and lock buttons** don't change the selection or the current layer.

### 5.5 Rename

- **Starting.** A double-click, or a double tap, on a name opens an inline `.field` input with the
  name selected.
- **Double tap** is decided by a pure helper `isDoubleTap(prev, next)` in
  `src/lib/double-tap.ts`, where `prev` and `next` are `{ id, time }`: same id and at most 350ms
  apart. It works through `pointerup`, since iPad Safari does not reliably fire `dblclick`.
- **Ending.** Enter or blur commits through `renameLayerById` or `renameNodeById`. Escape
  cancels.
- **Keys.** While the input has focus, app keyboard shortcuts are ignored (existing `isEditable`).

### 5.6 Drag to reorder

- **Starting.** Only the grip starts a drag. It has `touch-action: none`, so touch scrolling of the
  list still works everywhere else. The grip captures the pointer.
- **Drop position.** A pure helper `dropTarget(rows, y, drag)` in `src/lib/layer-drop.ts` computes
  it from row rectangles:
  - **Dragging a layer:** the result is `{ kind: "layer", index }`. The index is in layer-array
    terms (0 = bottom), derived from the row the pointer is over (upper or lower half).
  - **Dragging an object:** the result is `{ kind: "node", layerId, index }`.
    - Over an object row: the drop goes above or below that object, by half.
    - Over a layer row: the drop goes to the top of that layer.
    - Its index is in the target layer's children after removal (0 = bottom).
  - Returns `null` when the drop would change nothing.
- **Line.** A 2px accent line (`bg-accent`, absolutely positioned inside the list) shows the drop
  position.
- **Finishing.** `pointerup` applies `moveLayerTo` or `moveNodesTo`. `pointercancel` or Escape
  cancels, and nothing changes.
- **What moves.** Dragging a selected object row moves the whole selection. Dragging an unselected
  row moves only that object and selects it.
- **Blocked layers.** Objects can't be dropped into a hidden or locked layer; `dropTarget` returns
  `null` for them. The layer rows themselves can always be reordered.

## 6. Z-order controls and SVG name sanitising

- **Top bar** (after the object group, with a `.bar-sep`), all `IconButton`s:

  | Button | Icon | Title |
  | --- | --- | --- |
  | Bring to front | `BringToFront` | "Bring to front (⇧⌘])" |
  | Bring forward | `ArrowUp` | "Bring forward (⌘])" |
  | Send backward | `ArrowDown` | "Send backward (⌘[)" |
  | Send to back | `SendToBack` | "Send to back (⇧⌘[)" |

  - Titles use the existing `mod` and `shiftMod`.
  - While disabled (nothing selected), a button's title is "{Action} — nothing selected".
  - The plan checks that the icons exist; if one is missing, it picks the closest lucide icon and
    reports it.
- **Keyboard.**
  - `KeyLike` gains `code?: string`.
  - `editActionForKey` maps ⌘/Ctrl + `BracketRight` to forward and ⌘/Ctrl + `BracketLeft` to
    backward, or to front/back with Shift. It uses `code`, because Shift turns `]` into `}` on some
    layouts.
  - These become `EditAction { kind: "zorder"; op: "forward" | "backward" | "front" | "back" }`,
    and `runEditAction` handles them.
  - App's keydown already calls `preventDefault` for edit actions. The browser pass must confirm
    that Chrome doesn't navigate on ⌘[ / ⌘].
- **Context menu.** The selection part gets Bring to front, Bring forward, Send backward and Send to
  back, with their shortcut labels.
- **Width.** The M2e check applies again: at 768px the top bar must stay one row.
- **Name sanitising (carried over).** `escapeAttr` in `svg/serialize.ts` also strips lone
  surrogates, U+FFFE and U+FFFF, which XML doesn't allow and which user-typed names can now
  contain.

## 7. File format

Unchanged. Layer names (`data-sv-name`) and object names are already saved. The current layer and
the panel's expand state are not saved.

## 8. Testing

- **Unit:**
  - every `layers.ts` edit, including a no-op test that returns the same reference for each, and
    the single-layer delete refusal;
  - z-order with contiguous and split selections, selections across two layers, and nodes already
    at an end;
  - `resolveLayerId` and `layerBlock`;
  - `rowLabel`;
  - `dropTarget`: layer and node drags, upper/lower halves, over a layer row, no-op positions, and
    blocked target layers;
  - `isDoubleTap`;
  - `editActionForKey` for the bracket codes, with and without Shift and mod;
  - `planPaste` with a target layer, including the hidden and locked errors;
  - the shape tools refusing a blocked current layer (fake context);
  - `escapeAttr` stripping the forbidden code points.
- **Build:** 0 errors, 0 warnings. Lint and format clean.
- **Browser (controller, separate port, screenshots of each state):**
  - the panel with two layers, expanded and collapsed;
  - add, rename (double-click) and delete a layer, including the confirmation for a non-empty
    layer;
  - hide and lock a layer: its rows turn muted, its objects drop out of the selection, and
    drawing or pasting on it shows the notice;
  - the current layer follows the selection, and new shapes land in it;
  - drag a layer and an object between layers, with the drop line visible;
  - the z-order buttons, menu items and ⌘] ⌘[ ⇧⌘] ⇧⌘[, with no browser navigation;
  - rows are selected with Shift/⌘;
  - undo restores each edit;
  - the top bar fits at 768px;
  - no console errors.
