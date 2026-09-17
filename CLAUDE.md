# slop-vector-editor — project guide for Claude

A browser-based vector graphics editor (Inkscape / Affinity Designer family, deliberately
simple). iPad (touch + Apple Pencil) and desktop are equal first-class targets. Svelte 5 +
TypeScript + Vite + Tailwind 4 + Vitest. The document IS a plain SVG file.

Design: `docs/superpowers/specs/2026-09-16-slop-vector-editor-design.md`. Plans:
`docs/superpowers/plans/`. Dated history: `docs/superpowers/CHANGELOG.md` (append-only; later
entries supersede earlier ones — mark superseded entries).

## Commands

- `npm run dev` — Vite dev server. `npm run dev:lan` — HTTPS on the LAN for iPad testing.
- `npm run build` — `svelte-check && tsc --noEmit && vite build`. Bar: **0 errors, 0 warnings.**
- `npm test` — Vitest, node env, no DOM — 302 tests in 29 files. Only pure logic is unit-tested.
- `npm run lint` / `npm run format`. Pre-commit (husky + lint-staged) runs eslint --fix + prettier.
- `npm run deploy` — build, then `wrangler deploy` (assets-only Worker, no `main`).

## Workflow

brainstorming → spec → writing-plans → subagent-driven-development → finishing-a-development-branch.
Branch off `main`, one commit per task, merge only when the user says so. Commit trailer:
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Keep README.md current with
every user-visible change.

## Architecture map

- `src/doc/` — `document.ts` (types, `createDoc`), `edits.ts` (pure `(doc, args) => doc`, incl.
  `insertNodes` for paste), `tree.ts` (`findTopLevel`, `selectableIds`), `layers.ts` (layer,
  naming and z-order edits; current-layer helpers), `resize.ts` (bakes a resize into shape
  geometry; see gotcha below).
- `src/geom/` — `vec.ts`, `mat.ts` (SVG `matrix()` order), `shapes.ts` (`rectPath`, `polygonSubpath`,
  and the other shape-to-path constructors), `box.ts` (`Box`, `boxFromPoints`, `unionBox`,
  `boxMap`), `bezier.ts` (cubic point/bounds/flatten helpers), `bounds.ts` (node/selection bounds
  through the matrix), `hit.ts` (hit-testing and marquee select; caches flattened outlines per
  shape object), `snap.ts` (snap targets from the artboard and object bounds,
  `snapValue`/`snapBox`/`snapPoint`).
- `src/svg/` — `xml.ts` (own XML reader), `pathdata.ts`, `arc.ts`, `colors.ts`, `transform.ts`,
  `attrs.ts` (model → attributes, shared by canvas and export; also writes polygons as paths via
  `polygonD`), `serialize.ts`, `parse.ts` (reads polygons back via `parsePolygonAttr`).
- `src/tools/` — `types.ts` (`ToolId`, `Mods`), `tool.ts` (`Tool`, `ToolContext`, `ToolEvent`),
  `frame.ts` (rotated selection frame), `gizmo.ts` (resize/rotate handle geometry), `shape-tools.ts`
  (rect/ellipse/line/polygon/hand draw tools), `select.ts` (the select tool: click, drag-select,
  move, resize, rotate), `registry.ts` (`TOOLS`, one instance per id), `context.ts`
  (`storeContext`, the real `ToolContext` wired to `app`; tests use `__tests__/fake-context.ts`).
- `src/input/` — `route.ts` (`routePointerDown`: tool vs. pan vs. pinch vs. menu vs. ignore, from
  pointer type/button/active pointers), `dock.ts` (on-screen Shift/Alt latch state machine).
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
  (the Properties + Layers column), `PropertiesPanel`, `LayersPanel`, `double-tap.ts` and
  `layer-drop.ts` (pure helpers), `NumberField`, `PaintField`, `ToggleButton` (with `toggle.ts`,
  the pure state helper), `Modal`, dialogs, `Notices`.

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
14. **Handles on tiny objects cover the whole shape.** Reach is 6/10 px from the handle centre,
    and corners take priority. Tests use 40×40 shapes for this reason. Handles that would act on
    a zero-size axis are not drawn or hit-tested (`activeHandles` in `tools/gizmo.ts`), so a
    horizontal/vertical line can be dragged by its middle. Tiny (non-zero) objects are still
    handle-dominated — a small-object handle policy is an M5 item.
15. **A running tool drag commits from its own base document**, so the store has a gesture-cancel
    hook: `Canvas` registers `registerGestureCancel` while a tool gesture runs; undo, redo,
    `replaceDocument`, every selection action (delete/duplicate/nudge/convert/flatten/rect
    radius/style) and `applyGeometry` call `cancelActiveGesture()` first. New document-editing
    store actions must do the same, or an edit made while a drag is in flight can be clobbered
    when the drag commits.
16. **Pointer routing (`input/route.ts`) uses `activeTouches`**: only a second finger starts a
    pinch; a touch while a pen/mouse gesture is already running is ignored (palm rejection). The
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
24. **Every `title` is also a status-bar hint** (spec M2e). On mouse hover, the status bar shows
    the nearest `title`. Write titles as short action descriptions with the shortcut, e.g.
    "Cut (⌘X)". Top-bar actions that don't apply use `aria-disabled` with a reason title, e.g.
    "Cut — nothing selected". They never use `disabled` and are never hidden: a disabled button
    shows no tooltip, and a hidden one moves the bar. The top bar must never scroll or wrap,
    because that would clip the File menu. Only the file name shrinks. The file name's `title`
    (full name when truncated) is the one non-action title and also shows in the status bar.
25. **New objects go into the current layer** (`app.currentLayerId`, spec M3a). It is store state
    (not saved or undoable), re-resolved in `setSession`, set from the last selected object in
    `setSelection`, and reset by `replaceDocument`. Tools read it through
    `ToolContext.currentLayerId()`, and paste receives it as a parameter. A hidden or locked
    current layer refuses with `blockMessage`, never silently falls back. Z-order shortcuts match
    `KeyboardEvent.code` (`BracketLeft`/`BracketRight`), because Shift changes `key`. The Layers
    panel also handles Escape in the window capture phase during a row drag, so the app's Escape
    ("clear selection") doesn't also run.

## Current state

Milestone 3a (layers panel, z-order) — see CHANGELOG. Next is milestone 3b: groups.

## Roadmap

M3b groups, M4 pen + node editing, M5 iPad polish + deploy (spec §9). Post-v1 list in
spec §10.

M2 constraint: the importer drops zero-size rects/ellipses, empty groups and node-less paths, so
tools and edits must never create them (or add an own-format bypass) — otherwise saved files do
not round-trip.

M4 constraint: a closed subpath whose last node coincides with its first is merged on reload (one
node fewer) — the pen/node tools must not create that shape, or the writer must emit an explicit
closing segment. Snapping to path nodes is M4 (spec M2b §1).

M3b: a per-document id index for `findTopLevel` lookups during drags; the Opacity field should
also edit group opacity.

M5: manifest.webmanifest, apple-touch-icon, public/_headers (immutable asset caching + CSP);
palm-before-Pencil routing (a pen pointer-down should take over from a touch-only pan); a
small-object handle policy; the drawer covers the modifier dock at iPad portrait widths.

## Verification debt

Canvas/touch/Pencil behavior is not unit-testable. Record in CHANGELOG what was checked in the
browser and what still needs an iPad pass.
