# slop-vector-editor — project guide for Claude

A browser-based vector graphics editor (Inkscape / Affinity Designer family, deliberately
simple). iPad (touch + Apple Pencil) and desktop are equal first-class targets. Svelte 5 +
TypeScript + Vite + Tailwind 4 + Vitest. The document IS a plain SVG file.

Design: `docs/superpowers/specs/2026-09-16-slop-vector-editor-design.md`. Plans:
`docs/superpowers/plans/`. Dated history: `docs/superpowers/CHANGELOG.md` (append-only; later
entries supersede earlier ones — mark superseded entries).

## Commands

- `npm run dev` — Vite dev server. `npm run dev:lan` — HTTPS on the LAN for iPad testing.
- `npm run build` — `svelte-check && tsc --noEmit && vite build`. Bar: **0 errors, 0 warnings.** The
  build now emits two chunks — the app's own and `paper-core`'s — and the app's own must stay near
  69 KB gzipped; a rise means something outside `src/geom/boolean.ts` pulled paper in at load time.
- `npm test` — Vitest, node env, no DOM — 495 tests in 37 files. Only pure logic is unit-tested.
- `npm run lint` / `npm run format`. Pre-commit (husky + lint-staged) runs eslint --fix + prettier.
- `npm run deploy` — build, then `wrangler deploy` (assets-only Worker, no `main`).

## Workflow

brainstorming → spec → writing-plans → subagent-driven-development → finishing-a-development-branch.
Branch off `main`, one commit per task, merge only when the user says so. Commit trailer:
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Keep README.md current with
every user-visible change.

## Architecture map

- `src/doc/` — `document.ts` (types, `createDoc`), `edits.ts` (pure `(doc, args) => doc`, incl.
  `insertNodes` for paste), `tree.ts` (`findNode`, `mapNodes`, `selectableIds`, `ancestorIds` —
  node lookup and editing at any depth, with parent matrices), `group.ts` (group/ungroup),
  `layers.ts` (layer, naming and z-order edits; moves nodes between layers and groups;
  current-layer helpers), `path-edit.ts` (pure node edits: move, handles, insert, delete, retype,
  close, `appendNode`, `reverseSubpath`), `resize.ts` (bakes a resize into shape geometry; see
  gotcha below), `select-match.ts` (pure reach and matching for the selection commands: `allIds`,
  `invertIds`, `sameIds`), `boolean-edit.ts` (`booleanShapes`, `booleanRefusal` — unite/subtract/
  intersect/exclude on the current selection, in document space).
- `src/geom/` — `vec.ts`, `mat.ts` (SVG `matrix()` order), `shapes.ts` (`rectPath`, `polygonSubpath`,
  and the other shape-to-path constructors), `box.ts` (`Box`, `boxFromPoints`, `unionBox`,
  `boxMap`), `bezier.ts` (cubic point/bounds/flatten helpers, `splitCubic`, `nearestOnSubpath`),
  `bounds.ts` (node/selection bounds through the matrix), `hit.ts` (hit-testing and marquee
  select; caches flattened outlines keyed per subpath array and scale bucket), `snap.ts` (snap
  targets from the artboard and object bounds, plus path node points via `collectTargets`'s
  `nodes` option, `snapValue`/`snapBox`/`snapPoint`), `boolean.ts` (`booleanOf` — the only module
  that imports paper, loaded on first use; converts subpaths to and from Paper's path model).
- `src/svg/` — `xml.ts` (own XML reader), `pathdata.ts`, `arc.ts`, `colors.ts`, `transform.ts`,
  `attrs.ts` (model → attributes, shared by canvas and export; also writes polygons as paths via
  `polygonD`), `serialize.ts`, `parse.ts` (reads polygons back via `parsePolygonAttr`).
- `src/tools/` — `types.ts` (`ToolId`, `Mods`), `tool.ts` (`Tool`, `ToolContext`, `ToolEvent`),
  `frame.ts` (rotated selection frame), `gizmo.ts` (resize/rotate handle geometry), `shape-tools.ts`
  (rect/ellipse/line/polygon/hand draw tools), `select.ts` (the select tool: click, drag-select,
  move, resize, rotate), `node-tool.ts` (the node tool: pick a path, select/drag nodes and
  handles, insert/delete, retype, close), `pen.ts` (the pen tool: draws a path node by node,
  keeping its own draft; resumes an open path from either end), `registry.ts` (`TOOLS`, one
  instance per id), `context.ts` (`storeContext`, the real `ToolContext` wired to `app`; tests use
  `__tests__/fake-context.ts`).
- `src/input/` — `route.ts` (`routePointerDown`: tool vs. pan vs. pinch vs. menu vs. ignore, from
  pointer type/button/active pointers), `dock.ts` (on-screen Shift/Alt latch state machine),
  `double-tap.ts` (pure double-tap/double-click detection).
- `src/state/` — `session.ts` (doc + undo + gesture + saved marker, pure), `history.ts`,
  `viewport.ts`, `keys.ts`, `commands.ts`, `properties.ts` (style/geometry summaries for the
  properties panel, incl. mixed-value handling), `clipboard.ts` (pure copy text and paste
  planning: cascade, centring, errors), `appState.svelte.ts` (the `app` store + actions).
- `src/persist/` — `file-io.ts` (File System Access / fallback), `project-io.ts`
  (new/open/save/restore), `autosave.ts` (IndexedDB, SVG text, 3 s debounce), `preferences.ts`
  (localStorage defaults for new shapes: style + polygon prefs + snap), `tab-presence.ts`
  (`BroadcastChannel` "another tab is open" warning), `system-clipboard.ts` (never-throwing
  `navigator.clipboard` wrapper).
- `src/lib/` — `Canvas`, `NodeView`, `Overlay` (marquee/handles/gizmo/guides drawing), `TopBar`,
  `StatusBar`, `ToolStrip`, `IconButton` (top-bar icon action with reason tooltips), `hover-hint.ts`
  (the status bar shows the hovered element's `title`), `ContextMenu`, `ModifierDock`, `Sidebar`
  (the Properties + Layers column), `PropertiesPanel`, `LayersPanel`, `layer-drop.ts` (pure
  helper), `NumberField`, `PaintField`, `ToggleButton` (with `toggle.ts`, the pure state helper),
  `Modal`, dialogs, `Notices`.

## Invariants and gotchas

1. **The document is immutable.** Edits return new objects; an edit that changes nothing returns
   the SAME reference. Undo stores references; the dirty flag is `doc !== savedDoc`. Mutating a
   doc in place silently corrupts undo and the dirty flag.
2. **The store is `app`, held in `$state.raw` fields** (`session`, `view`, `notices`). Replace,
   never mutate. Deep `$state` would proxy the doc and break reference equality.
3. **Canvas and export share `src/svg/attrs.ts`.** Never style a shape on the canvas any other way,
   or the screen and the saved file drift.
4. **The importer never throws on unsupported content**; it reports it in `dropped`. It can throw
   `XmlError` (malformed XML), `SvgError` (non-SVG root) or, for a pathologically deep file,
   `RangeError` (recursion) — callers (`openText`, `restoreAutosave`) catch every error, not just
   the named ones. `openText` parses fully before replacing the document.
5. **No native dialogs.** Use `askConfirm` (in-app). Native `confirm` blocks the page and browser
   automation.
6. **Drag surfaces need `touch-action: none`** and must treat `pointercancel` like `pointerup`
   (iPad palm rejection). Canvas has both.
7. **Wheel listeners must be non-passive** (added in an `$effect`), or preventDefault is ignored
   and the page zooms instead of the canvas.
8. **The importer rejects non-finite numbers and invalid/oversized artboards**, falling back to
   `width`/`height`, then 300×150, and reporting "invalid artboard size". A transform list
   containing any unknown function is ignored as a whole (identity), not applied partially. Any
   coordinate, length or composed transform entry with `|v| > MAX_COORD` (1e9, `parse.ts`) is
   rejected the same way non-finite values are — `fmt`'s 6-decimal rounding overflows to
   `Infinity` well before that.
9. **Autosave is skipped for the rest of the session when IndexedDB is unavailable**, with a
   single notice — it does not retry on every edit.
10. **A file is only kept as the Save-in-place target when it round-trips losslessly**: `openText`
    keeps the File System Access handle only when `ParseResult.native` is true (the root `<svg>`
    has `data-sv-version`, i.e. our own export) and nothing was dropped. Otherwise the document
    opens with no handle — the first Save goes through the save picker or the download fallback —
    so a later ⌘S can never silently overwrite an Inkscape/Figma/Illustrator original with our
    lossy re-export.
11. **Resize bakes scale into geometry** (spec M2a §1). Move and rotate only touch the matrix.
    Never "simplify" resize into a matrix multiply: strokes would scale.
12. **Tools never import the store.** They use `ToolContext` (`tools/context.ts` for the app,
    `__tests__/fake-context.ts` for tests). This is what makes them unit-testable.
13. **Every session change goes through `setSession`,** which prunes the selection. Don't assign
    `app.session` directly anywhere else.
14. **Handles on a too-small object move outside it.** Reach is 6/10 px from the handle centre
    (mouse/touch), and corners take priority. An axis whose on-screen span is under
    `3 * (size / 2 + 2)` — three reaches, the smallest span that leaves a reach-wide gap between
    opposite handles — is expanded to that minimum, symmetrically, in `handlePositions`
    (`tools/gizmo.ts`); `frameOutline` asks for the unpadded positions, so the drawn frame still
    shows the true geometry while only the handles move out. Only a non-zero axis is expanded: a
    zero-size axis keeps its handles coincident, which is what leaves a horizontal/vertical line
    draggable by its middle (`activeHandles`). Drawing and hit-testing read the same padded
    positions, so they can't disagree. The resize maths are unaffected, and must stay that way:
    `handleFramePoint` keeps receiving the **unpadded** `frame.box` in `select.ts`, so `grab` is
    the true handle point minus the press point — and that offset is exactly what carries a press
    on a pushed-out handle back to the true corner. Padding the box there would zero the offset and
    snap the true corner to the finger, a jump of up to 15px on a tiny object.
15. **A running tool drag commits from its own base document**, so the store has a gesture-cancel
    hook: `Canvas` registers `registerGestureCancel` while a tool gesture runs; undo, redo,
    `replaceDocument`, every selection action (delete/duplicate/nudge/convert/flatten/rect
    radius/style) and `applyGeometry` call `cancelActiveGesture()` first. New document-editing
    store actions must do the same, or an edit made while a drag is in flight can be clobbered
    when the drag commits.
16. **Pointer routing (`input/route.ts`) uses `activeTouches`**: only a second finger starts a
    pinch; a touch while a pen/mouse gesture is already running is ignored — `penActive` states
    this palm rejection outright, rather than leaving it to emerge from the counting. A Pencil
    down over one or more resting fingers takes over from them — pen only, never a second pen or
    a mouse (`i.activePointers === i.activeTouches`) — falling through to the ordinary rules
    rather than returning `"tool"` directly, so the Hand tool and a held Space still pan with a
    Pencil. `Canvas.svelte` ends any running pan/pinch gesture first (nothing to roll back) and
    drops the superseded pointers from its own bookkeeping, so they don't keep counting toward
    `activeTouches` or re-anchor a pinch on a stale coordinate once the Pencil lifts. The
    right-click menu opens only for mouse input. A plain tap on a member of a multi-selection
    narrows the selection to it; a new pointer-down cancels an active drag.
17. **Ellipse hit-testing (`geom/hit.ts`) measures outline distance against a sampled 64-point
    polyline** (nearest point), not along the radius.
18. **`rectPath` merges coincident nodes**: a corner radius equal to half a side no longer yields
    duplicate nodes.
19. **Keyboard copy/cut/paste use the window `copy`/`cut`/`paste` events** (App.svelte), never
    `navigator.clipboard`: the events need no permission and can set `image/svg+xml`. Only the
    top bar and menu buttons read `navigator.clipboard`, and they fall back to the in-app copy
    (`clip` in the store). Text fields and dialogs keep the browser's own behaviour. `App.svelte`
    also listens for `beforecopy`/`beforecut`/`beforepaste` on `window` and calls
    `preventDefault()` — these exist so WebKit (Safari, iPad) enables the clipboard commands with
    no text selection; don't remove them.
20. **Snapping is per gesture.** Tools collect targets at pointer-down (`collectTargets`,
    excluding what moves) and put guides in the overlay; they must clear the overlay on up/cancel.
    Resize snaps only unrotated frames; rotation and marquee never snap. The threshold is
    `SNAP_PX / zoom`.
21. **Polygons are live shapes saved as paths** (spec M2c). A polygon is written as
    `<path d … data-sv-polygon="sides star inner cx cy rx ry">`, with `d` built from the numbers
    _as written_ (`polygonD`). The importer restores a polygon only when the attribute validates
    and the regenerated `d` matches the file's outline within 2e-6; otherwise it stays a path. Never build a
    polygon's `d` from unrounded numbers, or reopened files silently lose their polygons.
22. **Polygon resize flips:** the corner set is left-right symmetric, so a horizontal flip needs
    nothing. A vertical flip of an odd polygon composes an exact half-turn
    (`[−1, 0, 0, −1, 2cx, 2cy]`) into the transform, never `rotateAbout(π)`, which leaves float
    noise in files.
23. **UI follows `../SLOP-TIMELINE-UI.md` and slop-animator** (spec M2d).
    - The on-state is `.ui-on`, and a row selection is `.ui-selected`. Both are unlayered in
      `app.css`, so no utility can hide them.
    - Write each element's classes as one expression (`class={["btn", on && "ui-on"]}`), never a
      `class:` colour directive over a coloured base.
    - Toggles are `ToggleButton`s (`aria-pressed`, with a `"mixed"` state), never checkboxes.
    - Fields are raised.
    - A state change must not move the layout. For example, unsaved changes recolour the file
      name.
    - Bar controls are 32px high. This is a deliberate difference from the guide's 24px, shared
      with slop-animator, because it suits touch.
24. **Every `title` is also a status-bar hint** (spec M2e, amended M5 §5). On mouse hover, the
    status bar shows the nearest `title`; on touch and pen, which have no hover, it shows the
    title of whatever was just pressed (`onpointerdown`, `hintFrom` in `lib/hover-hint.ts`) — the
    hint stays until another press replaces it, and a mouse still clears it on press since hover
    will set it again. This is the only way an icon-only control's label, or a disabled control's
    reason, is readable on iPadOS, which shows no tooltip for `title` at all. Write titles as
    short action descriptions with the shortcut, e.g. "Cut (⌘X)". Top-bar actions that don't apply
    use `aria-disabled` with a reason title, e.g. "Cut — nothing selected" (a press doesn't
    activate it, so the reason is exactly what a touch press reveals). They never use `disabled`
    and are never hidden: a disabled button shows no tooltip, and a hidden one moves the bar. The
    top bar must never scroll or wrap, because that would clip the File menu. Only the file name
    shrinks. The file name's `title` (full name when truncated) is the one non-action title and
    also shows in the status bar.
25. **New objects go into the current layer** (`app.currentLayerId`, spec M3a). It is store state
    (not saved or undoable), re-resolved in `setSession`, set from the last selected object in
    `setSelection`, and reset by `replaceDocument`. Tools read it through
    `ToolContext.currentLayerId()`, and paste receives it as a parameter. A hidden or locked
    current layer refuses with `blockMessage`, never silently falls back. Z-order shortcuts match
    `KeyboardEvent.code` (`BracketLeft`/`BracketRight`), because Shift changes `key`. The Layers
    panel also handles Escape in the window capture phase during a row drag, so the app's Escape
    ("clear selection") doesn't also run.
26. **A node's transform is in its parent's space.** `findNode` hands you the parent matrix and
    `mapNodes` passes it to the edit. A document-space map must go through `inParent` (and a node
    changing parent through `reparent`); both return null for a singular matrix, and the edit then
    leaves that node alone. A node whose parent doesn't change keeps its exact transform — never
    re-derive it, or saved files fill with float noise.
27. **No edit may leave an empty group:** the importer drops them, so `deleteNodes` and `moveNodes`
    remove a group they empty.
28. **Entering a group is `app.enteredGroupId`** (not saved, not undoable). It decides what
    `hitTest`, `marqueeSelect` and `selectableIds` may select; Escape leaves one level before it
    clears the selection. A click on empty canvas also leaves the group — the select tool does
    that in its pointer-up handler, so a marquee drag starting on empty space still selects the
    group's own children.
29. **Node coordinates are in the path's own space.** The node tool maps the pointer through the
    inverse of the path's world matrix, and does nothing when that matrix is singular.
30. **No edit may leave a subpath with fewer than two nodes, a path with no subpaths, or a closed
    subpath whose last node repeats its first.** A path a store edit would leave with no subpaths
    is deleted outright instead; the importer drops or merges the other two shapes on reload. The
    structural edits enforce this; the one gap is `movePathNodes`, which will happily drag a node
    onto its subpath's first node — the reload then merges them and the path loses a node.
31. **`app.nodeTarget`/`app.nodeSel` are store state** (not saved, not undoable), re-resolved in
    `setSession`. Escape walks node selection → node target (back to the select tool) → entered
    group → object selection.
32. **The select tool's double-tap action fires on pointer-up, for a gesture that stayed a
    click.** Acting on pointer-down made a click followed by a quick drag change context instead
    of dragging. The node tool's own double-tap actions — inserting a node, cycling a node's
    type — deliberately fire on pointer-down instead: there's no context to hand off, so nothing
    is lost by not waiting for the up.
33. **The pen's draft never enters the document** (`tools/pen.ts`, spec M4b §2). It lives in the
    tool and the overlay until the path is finished, which is what keeps a one-node path — the
    importer drops it — out of the file and makes a whole stroke one undo step. This is why the
    pen's `cancel()` keeps the draft instead of rolling it back: a `pointercancel` only stops the
    handles being pulled, and only Escape, a finish or a tool change ends a stroke.
34. **A tool may take Escape, Enter and Backspace through `Tool.keydown` while `busy()`.**
    `runEditAction` (`state/commands.ts`) asks the active tool before its own clear/commit/delete
    handling; only the pen implements `keydown`/`busy` today. `hover` is every pointer move
    `Canvas.svelte` sees while no gesture is running — usually a plain hover, but also a held
    right-button drag or a pointer the router ignored. The canvas already tracked movement for the
    cursor readout and now calls `hover` from the same place, which is what drives the pen's rubber
    band between clicks. A tool with a draft also gets `discard(ctx)`, which the store calls from
    `replaceDocument`, `undo` and `redo` (registered like `registerToolFinish`, in
    `tools/context.ts`): a draft is built on a document those three throw away.
35. **Deploy assets live in `public/`.** `manifest.webmanifest` (name, icons, standalone display),
    `apple-touch-icon.png` (180×180, opaque — iOS does not composite transparency, so it's
    rendered on the app's `#1e1e22` background) and `_headers` (immutable caching for
    `/assets/*`, plus the CSP). Never hand-place a file under `public/assets/`: it lands in
    `dist/assets/` unhashed, and the immutable year-long `Cache-Control` then pins it in every
    browser cache with no way to bust it — that rule is safe only because everything Vite emits
    there is content-hashed. Regenerate the icon from `favicon.svg` when the mark changes; the
    favicon's own fill is theme-dependent and will not rasterise white. The CSP's `style-src`
    needs `'unsafe-inline'` — canvas and export (`svg/attrs.ts`) and the overlay set `style`
    attributes on every rendered element, which CSP counts as inline styles; scripts need no such
    exception.
36. **The selection commands' reach is `selectableIds(doc, enteredGroupId)`** (`src/doc/tree.ts`,
    spec M6 §4), reused as-is from `src/doc/select-match.ts`. That function had no production
    caller before this milestone — `hitTest` and `marqueeSelect` re-implement its rule inline —
    and this milestone exists in part to give it callers again, so the three must not drift back
    apart. Paints (`{ color, opacity }`) compare exactly, with no tolerance; `null` matches only
    `null`. Several selected shapes union rather than intersect, and a seed always matches itself,
    so Select Same never shrinks the selection. A group has no `Style`, so it contributes no
    matches to the three paint-based commands and is never returned as one, and still matches on
    kind. But a selected group is **kept**, as is any seed out of reach — the layers panel selects
    a row at any depth while `enteredGroupId` points at that row's parent, so the selection can
    legitimately hold ids `selectableIds` would not offer. Without keeping them, a Select Same that
    matched nothing would silently clear the whole selection.
37. **Paper is loaded on first use, and only `src/geom/boolean.ts` may import it** (spec M7 §2).
    The specifier is `paper/dist/paper-core`, with **no file extension** — that is the exact name
    the package's own type declarations use, and the extension-ful path resolves to no types — and
    it must never be the package's default entry (`paper`), which is the full PaperScript build and
    expects a DOM. `booleanOf` maps every operand into **document space** through its shape's world
    matrix before handing it to Paper, and maps the result back into the **frontmost input's parent
    space**, which is where the combined shape is stored (an identity transform, as the pen commits
    a new path). An operation that leaves no area — `booleanOf` returning `[]` — must leave the
    document at the same reference rather than write a path the importer would drop; `booleanRefusal`
    (`src/doc/boolean-edit.ts`) is the one predicate both the menus and `booleanShapes` read, so they
    can't disagree about what's allowed.

## Current state

Milestone 7 (boolean operations) — see CHANGELOG. What comes next is unplanned: the post-v1 list
(project design §10) still holds text, gradients, a freehand tool, PNG export, grid and smart
guides, multiple artboards, masks, align and distribute, a light theme and image paste. The
accessibility group and the performance group (both parked below) remain the two obvious
milestones.

## Roadmap

M4 was split into 4a (node editing) and 4b (the pen tool), as M3 was split into 3a/3b. M5 (iPad
polish + deploy), M6 (selection conveniences) and M7 (boolean operations) are complete — see
CHANGELOG.

M2 constraint: the importer drops zero-size rects/ellipses, empty groups and node-less paths, so
tools and edits must never create them (or add an own-format bypass) — otherwise saved files do
not round-trip.

M4b constraint: a closed subpath whose last node coincides with its first is merged on reload (one
node fewer) — the pen and node tools must not create that shape (`movePathNodes` can drop a node
onto the first one), or the writer must emit an explicit closing segment.

M3b (parked, spec §9): a per-document id index for `findNode` lookups during drags — nesting makes
it more relevant, since `dropTarget` runs `findNode` + `ancestorIds` + `moveNodes` on every
pointermove.

Parked, not tied to a milestone: a path inside a group contributes no snap targets, because
`collectTargets` walks only top-level nodes; snap guides are not drawn while a pen draft exists
(the overlay has one slot); hit-testing flattens at document scale rather than viewport zoom;
`movePathNodes` can still drag a node onto its subpath's first node.

Parked as a group, for a milestone of its own (spec M5 §1 "Out"): accessibility and keyboard work
— Space not activating a focused button, the Modal focus trap, File-menu keyboard navigation,
`aria-current`/`aria-selected` on layer rows, the PaintField opacity label, `.ui-mixed`'s
contrast; and performance — the id index for `findNode`, layer-row measurement caching,
`collectTargets` recomputing every bounds per pointer-down, `nearestOnSubpath`'s cost.

## Verification debt

Canvas/touch/Pencil behavior is not unit-testable. Record in CHANGELOG what was checked in the
browser and what still needs an iPad pass.
