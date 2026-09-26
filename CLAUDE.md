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
  build emits **three** chunks — the app's own, `paper-core`'s and `opentype`'s. The check is not a
  size bar on the app chunk (it grows with every feature) but that the two libraries stay in chunks
  of their own: paper in `dist/assets/paper-core-*.js` (~72 KB gzipped) and opentype in
  `dist/assets/opentype-*.js` (~68 KB gzipped). Either appearing in the app chunk means something
  outside `src/geom/paper.ts` or `src/text/font.ts` imported it statically. The four bundled
  fonts are content-hashed `.ttf` assets beside them.
- `npm test` — Vitest, node env, no DOM — 758 tests in 56 files. Only pure logic is unit-tested.
- `npm run lint` / `npm run format`. Pre-commit (husky + lint-staged) runs eslint --fix + prettier.
- `npm run deploy` — build, then `wrangler deploy` (assets-only Worker, no `main`).

## Workflow

brainstorming → spec → writing-plans → subagent-driven-development → finishing-a-development-branch.
Branch off `main`, one commit per task, merge only when the user says so. Commit trailer:
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Keep README.md current with
every user-visible change.

## Architecture map

- `src/doc/` — `document.ts` (types, `createDoc`), `edits.ts` (pure `(doc, args) => doc`, incl.
  `insertNodes` for paste), `tree.ts` (`findNode`, `mapNodes`, `ancestorIds` — node lookup and
  editing at any depth, with parent matrices — plus THE reach rule: `enteredReach`,
  `topLevelReach`, `reachableNodes`, `selectableIds`, `blocked`), `group.ts` (group/ungroup),
  `layers.ts` (layer, naming and z-order edits; moves nodes between layers and groups;
  current-layer helpers), `path-edit.ts` (pure node edits: move, handles, insert, delete, retype,
  close, `appendNode`, `reverseSubpath`), `resize.ts` (bakes a resize into shape geometry; see
  gotcha below), `select-match.ts` (pure reach and matching for the selection commands: `allIds`,
  `invertIds`, `sameIds`), `boolean-edit.ts` (`booleanShapes`, `booleanRefusal` — unite/subtract/
  intersect/exclude on the current selection, in document space), `path-ops.ts` (`pathOpRefusal`,
  `subdivideSelection`, `reverseSelection`, `breakApart`, `combine` — Subdivide/Reverse
  direction/Break apart/Combine on the current selection), `simplify-edit.ts` (`simplifyShapes` —
  the async Simplify action, modelled on `booleanSelection`'s shape), `subset.ts`
  (`filterToSelection` — the document reduced to a selection, for exporting a region that contains
  only the selected objects).
- `src/geom/` — `vec.ts`, `mat.ts` (SVG `matrix()` order), `shapes.ts` (`rectPath`, `polygonSubpath`,
  and the other shape-to-path constructors), `box.ts` (`Box`, `boxFromPoints`, `unionBox`,
  `boxMap`), `bezier.ts` (cubic point/bounds/flatten helpers, `splitCubic`, `nearestOnSubpath`),
  `bounds.ts` (node/selection bounds through the matrix), `hit.ts` (hit-testing and marquee
  select; caches flattened outlines keyed per subpath array and scale bucket), `snap.ts` (snap
  targets from the artboard and object bounds, plus path node points via `collectTargets`'s
  `nodes` option, `snapValue`/`snapBox`/`snapPoint`), `paper.ts` (the only module that imports
  paper, loaded on first use; the loader and the two-way conversion between subpaths and Paper's
  path model), `boolean.ts` (`booleanOf`, a caller of `paper.ts`) and `simplify.ts` (`simplifyOf`,
  the other caller — Paper's `simplify(tolerance)` through the same conversion).
- `src/svg/` — `xml.ts` (own XML reader), `pathdata.ts`, `arc.ts`, `colors.ts`, `transform.ts`,
  `attrs.ts` (model → attributes, shared by canvas and export; also writes polygons as paths via
  `polygonD`), `serialize.ts` (`serializeDoc` takes an optional second argument overriding the
  root's `width`/`height`/`viewBox`, for PNG export's region; absent, output is byte-identical to
  today), `parse.ts` (reads polygons back via `parsePolygonAttr`).
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
  planning: cascade, centring, errors), `export-plan.ts` (`ExportRegion`, `exportBox`,
  `exportSize`, `exportRefusal`, `sizeLabel`, `pngFileName`, `MAX_SIDE`, `MAX_PIXELS` — the pure
  half of PNG export), `appState.svelte.ts` (the `app` store + actions, incl. `exportPng` and
  `copyPng`).
- `src/text/` — `font.ts` (the **only** importer of `opentype.js`, and only dynamically: font
  registry, `loadFont`, `registerFontFile`, `outlineText`, the unshaped-script and no-glyph
  guards), `layout.ts` (pure: pen positions, kerning, letter-spacing, alignment), `attrs.ts` (pure:
  the `data-sv-text-*` format), `opentype.d.ts` (hand-written types — see the invariant),
  `fonts/` (four SIL OFL faces + their `OFL.txt`, imported through Vite `?url`).
- `src/persist/` — `file-io.ts` (File System Access / fallback), `project-io.ts`
  (new/open/save/restore), `autosave.ts` (IndexedDB, SVG text, 3 s debounce), `preferences.ts`
  (localStorage: style + polygon defaults for new shapes, snap, the dock's expanded state, the
  sidebar's split ratio and the Layers panel's collapse),
  `tab-presence.ts`
  (`BroadcastChannel` "another tab is open" warning), `system-clipboard.ts` (never-throwing
  `navigator.clipboard` wrapper), `png.ts` (`rasterise`, `writeClipboardPng` — the impure half of
  PNG export; needs a DOM, so it is browser-verified rather than unit-tested), `share.ts`
  (`isAppleTouch`, `saveToFilesAvailable`, `canShareFile`, `classifyShareError` — Save to Files
  detection and the share sheet itself), `deliver.ts` (`deliverFile`, the shared/dismissed/ready/
  downloaded decision table between a built file and the share sheet, with `share`/`canShare`/
  `download` injectable exactly as `system-clipboard.ts` injects its `ClipboardLike`).
- `src/lib/` — `Canvas`, `NodeView`, `Overlay` (marquee/handles/gizmo/guides drawing), `TopBar`,
  `StatusBar`, `ToolStrip`, `IconButton` (top-bar icon action with reason tooltips), `hover-hint.ts`
  (the status bar shows the hovered element's `title`), `ContextMenu`, `ModifierDock`, `Sidebar`
  (the Layers + Properties column, Layers on top: the split ratio, the divider drag and which panel is open), `PropertiesPanel`, `LayersPanel`, `layer-drop.ts` (pure
  helper), `layer-trash.ts` (pure: what the header trash deletes), `reveal.ts` (pure: the nearest-edge scroll that keeps the selected layer row in view), `PanelHeader` (a panel's raised, collapsible header bar), `split.ts` (pure: the ratio
  clamp, the drag maths and the Properties open/override rule), `NumberField`, `PaintField`, `ToggleButton` (with `toggle.ts`, the pure state helper),
  `Modal`, dialogs (incl. `ShareReadyDialog`, which offers a fresh tap at Save to Files when
  `deliverFile` didn't attempt a direct share, or the attempt needs a fresh tap), `Notices`.

## Invariants and gotchas

1. **The document is immutable.** Edits return new objects; an edit that changes nothing returns
   the SAME reference. Undo stores references; the dirty flag is `doc !== savedDoc`. Mutating a
   doc in place silently corrupts undo and the dirty flag.
2. **The store is `app`, held in `$state.raw` fields** (`session`, `view`, `notices`). Replace,
   never mutate. Deep `$state` would proxy the doc and break reference equality.
3. **Canvas and export share `src/svg/attrs.ts`.** Never style a shape on the canvas any other way,
   or the screen and the saved file drift.
4. **The importer never throws on unsupported content**; it reports it in `dropped`. It **keeps**
   hidden and locked content rather than dropping it (M9): `display:none`, `style="display:none"`
   and `visibility="hidden"` all become `hidden: true`, and a hidden group keeps its children. It can throw
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
      name. **The sidebar's Properties panel is the one exception** (spec M8 §5): it collapses when
      nothing is selected and opens when something is. The rule exists so a passive state — a dirty
      flag, a hover, a mode — does not shuffle controls under a finger; it is not meant to make a
      panel whose entire content is the selection hold half a column while it has nothing to say.
      Clicking its header overrides that, and the override is dropped wherever `app.selection` is
      assigned, the moment the selection's emptiness flips — never from an effect. The comparison is
      deferred to a microtask and only the first "was empty" of a tick counts, so one user action is
      judged by its net effect: Unite and Ungroup both delete every selected id and select the
      result on the next statement, and per-assignment that reads as a flip to empty and back.
      **That is why Properties sits BELOW Layers** (2026-09-26): above it, every flip moved the
      whole layer list — a row clicked with nothing selected jumped from 188px to 592px, away from
      the pointer. Below it, the exception moves only Layers' bottom edge, never a row, and the
      Layers list scrolls the last selected row back into view nearest-edge (`reveal.ts`) so the
      shrinking list cannot hide it. `splitRatio` is still **Properties'** share, so stored splits
      survived the swap; only `ratioFromDrag`'s sign flipped (dragging down shrinks Properties).
    - **The root font-size stays at the browser's 16px.** Tailwind's whole scale is in `rem`, which
      resolves against `html`, so setting a root size silently rescales every size in the app:
      `font-size: 14px` on `html` made `text-xs` 10.5px, `h-8` controls 28px, the 240px sidebar
      210px and this bar 38.5px, while absolute values like `text-[11px]` and 1px borders stayed
      put — so the UI was smaller than its own class names in the rem parts only. Body text is
      14px, set on `body`. No sibling slop app sets a root size.
    - **Bar controls are `--ctl-h` high: 32px for touch, 24px on a mouse-only machine** (M10e §2).
      32px is the deliberate difference from the guide's 24px, shared with slop-animator, and it is
      right wherever a finger can reach the screen; on a machine with no touch input it is only
      wasted room, and the properties panel stacks ~21 controls. The media query is
      **`any-pointer: coarse`, never `pointer: coarse`**: an iPad with a Magic Keyboard reports the
      trackpad as the _primary_ pointer while the screen is still right there, so keying off the
      primary pointer would shrink the targets on the one device the 32px rule exists for.
      `.field` and `.btn` follow it; `.icon-btn` deliberately does not — it is the top bar's square
      icon target, where the density buys nothing. A new control uses `var(--ctl-h)`, never `h-8`.
    - **A `<textarea>` needs a definite height in a grid.** With `height: auto` it contributes a
      ~10px row while rendering 43px, so it overlaps its neighbours on both sides. `textarea.field`
      states `height` and `min-height` in `--ctl-h` units instead.
    - **`prefs.dockExpanded` is `boolean | null`, and `null` means undecided, not collapsed.** The
      modifier dock hides its Shift and Alt latches until someone decides otherwise; Snap is always
      shown, because it is a setting and this is the only place its state appears. While the pref is
      `null` the first `touch` or `pen` pointer expands the dock once and writes `true`. A boolean is
      a decision — by the chevron or by that first touch — and nothing overrides it, so an explicit
      collapse survives every later touch. Keep the three states distinct in `sanitizePrefs`.
    - **The sidebar's divider is 12px**, a deliberate deviation from the 32px bar-control rule: a
      divider is approached by sliding onto it rather than by tapping it, and 12px is 1.5× the grip
      slop-paint ships for the same job. It is rendered only when both panels are open — with one
      collapsed there is nothing to distribute. **Its clamp counts whole panels, not bodies**
      (`MIN_PANEL_PX`, header + body): flex distributes whole `<section>`s, so clamping the ratio
      against the bodies alone silently left the losing panel 40px short of its minimum. The pixel
      minimum is `clampRatio`'s alone: `sanitizePrefs` only checks that `splitRatio` is a fraction,
      because a tall column legitimately clamps below 0.1 and a range hard-coded in the sanitizer
      would reject — not clamp — the value the divider had just produced.
    - **A panel header's rule is `border-panel`, not `border-line`.** Below an open panel it simply
      continues the body; between two collapsed headers it is what keeps them apart. `border-line`
      (#2e2e35) against `bg-raised` (#2d2d33) is the non-boundary M8 exists to remove, and two
      stacked headers is the default state.
    - **The Layers header keeps its New layer and Delete layer buttons while collapsed**, because
      they are the only route to those commands — no menu, no shortcut. Both open the panel as a
      side effect, so the result is visible.
    - **The Layers trash deletes the selection first** (`trashAction`, `lib/layer-trash.ts`): with
      anything selected it is ⌫ (no confirm, one undo step), and only with nothing selected does it
      delete the current layer. Selecting an object makes its layer current and highlights that
      row, so a layer-only trash read as "delete this path" and took the whole layer. Clicking a
      layer's name therefore clears the object selection (`deselectAll`) before making it current —
      otherwise a leftover selection elsewhere would be what the trash deletes.
    - **The properties panel's sections collapse** (`FieldSection`, M10e §1), and which ones are
      closed is `prefs.closedSections` — the **closed** ids, so a section added later appears open
      with no migration and the common case is an empty array. `SECTION_IDS` is the whole
      vocabulary and `sanitizePrefs` drops anything else, so a renamed section cannot leave a
      permanently closed ghost. `randomise` is the one closed by default. `FieldSection` renders
      **no wrapper element** — the heading is the grid's divider row and the rows are the caller's,
      both landing directly in the one `.field-grid`. The Character block is deliberately not
      collapsible: it exists only while a character is picked. A section heading is a `<button>`,
      so nothing that was inside it may be a button too — the randomiser's seed moved out of the
      heading row for that reason.
    - **The sidebar's width is `prefs.sidebarPx`, dragged from a grip on its left border**
      (`lib/panel-layout.ts`, M10e §3), deliberately the same shape every sibling slop app ships:
      a pure `clampSidebarWidth` of `[MIN, half the viewport]` where the **minimum wins** over the
      ceiling, and a `resizedSidebarWidth` that recomputes from the pointer-down snapshot rather
      than accumulating deltas, so a dropped move cannot make the width drift. The grip is an 8px
      absolutely-positioned strip over the border, costing the panel no content width, with
      `touch-none` — without it iPadOS reads the drag as a scroll and cancels the pointer stream.
      Travel **left** widens, because the panel is docked right. An out-of-range stored width is
      **clamped, never rejected**; the ceiling needs a viewport, so `sanitizePrefs` enforces only
      the floor and the real clamp runs on mount and on every window resize. One pref write per
      drag, on release. The grip is a real `<button>`, so Tab reaches it and Arrow/Shift-Arrow step
      it by 8/24px — the only keyboard route to a width.
    - **The panel pairs rows two-up once it is 320px wide** (M10e §4), through a **container
      query** on the Properties `<section>`, never a media query: the sidebar is dragged to any
      width independently of the window, so the viewport cannot answer the question. Note the
      container measures the section's content box, so the _sidebar_ pref must read 321 — the
      column's 1px left border is outside it. Auto-placement does the pairing: a `.field-row`
      contributes exactly **two** grid items and everything else spans the full width, so after any
      full-width row the next pair starts in column 1 again. **That parity is load-bearing** — a
      row contributing an odd number of items would slide every following label a column away from
      the field it names. This is why the empty `<span></span>` cells the Cap and Join selects once
      carried had to go when the unit column did.
    - **The properties panel is ONE grid, `label | field | unit`** (`.field-grid` in `app.css`,
      borrowed from slop-video-compositor's Inspector). Every labelled row is a `.field-row`, which
      is `display: contents`, so its three cells join that one grid and every input in the panel
      shares one left and right edge — across the Text, Stroke, Shape, Node and Geometry sections
      alike. **A unit (`%`, `°`, `×`) goes INSIDE its field**, absolutely positioned and
      `pointer-events-none`, not in a third column: a unit column ends every numeric row short of
      the panel's right edge while a full-width control runs all the way to it, and the two right
      edges read as a step. Anything that is not a labelled row — a heading, a paint row, the align buttons, the
      textarea — is `.field-full` (`col-span-2`). **A section must not be its own `.field-grid`:** a
      nested grid sizes its label column independently, which is the raggedness this replaced. A
      section is a `<div class="contents">` whose heading carries the divider (`.field-divider`,
      `col-span-3` + `border-t`). `minmax(0, 1fr)` on the field column is what lets a field shrink
      instead of overflowing onto its neighbour — the earlier `grid-cols-2` gave 104px cells to
      fields needing 125px and painted "Scale" over a "°".
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
    shrinks. **Width-dependent hiding is the one exception** (added M7): a control may be absent
    below a breakpoint when the same command stays reachable at every width through a menu — the
    four icon groups are hidden in a cascade, each carried by a menu at every width: clipboard
    below 870px (**Edit** menu), Convert/Flatten below 950px (**Object**), the booleans below
    1110px (**Path**), and arrange below 1270px (**Object**). They drop least-essential first as
    the bar narrows, so Cut/Copy/Paste survive longest and Undo/Redo never hide at all. The
    **Object** menu carries arrange (added M10e §8; before that menu existed,
    arrange's only other routes were ⌘]/⌘[ and the right-click menu, which `route.ts` opens for
    **mouse input only**, so on a touch device the icons were the single route and could not
    legally be hidden). **Those breakpoints are measured, not chosen**: the bar needs 1048px with
    1259px with everything shown and 739px with all four groups hidden, and a breakpoint below what the bar
    needs silently reintroduces the overflow the exception exists to prevent — an earlier 900px was
    148px short of what it needed. **The bar now fits at every width down to 739px**, iPad portrait
    (768px) included; verified at each boundary. The
    bar is then stable at any given width, which is what the rule protects. Hiding a control
    because of _state_ — a selection, a mode, a document — is still forbidden. The file name's
    `title` (full name when truncated) is the one non-action title and also shows in the status
    bar.
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
    there is content-hashed. Regenerate the icon from `favicon.svg` when the mark changes — the mark
    in `#ccff66` at 156px, 12px in from each edge of the 180px `#1e1e22` tile (`sharp`, present as a
    dependency of wrangler, rasterises it). `#ccff66` is this app's hue of the family blue `#667fff`;
    each slop app's favicon colour is listed in `../SLOP-FAVICON-COLOURS.md`. The CSP's `style-src`
    needs `'unsafe-inline'` — canvas and export (`svg/attrs.ts`) and the overlay set `style`
    attributes on every rendered element, which CSP counts as inline styles; scripts need no such
    exception.
36. **The selection commands' reach is `selectableIds(doc, enteredGroupId)`** (`src/doc/tree.ts`,
    spec M6 §4), reused as-is from `src/doc/select-match.ts`. `hitTest` and `marqueeSelect` used to
    re-implement its rule inline; since M9 all three build on the same two pieces in `tree.ts` —
    `enteredReach` (the entered group's children, or **null** when that group is gone, is not a
    group, or is hidden or locked) and `topLevelReach`. A new reach clause goes there and nowhere
    else. **`hitTest` still differs on purpose**: it searches two tiers, the entered group's
    children and then the top level, which is what lets a click on a sibling outside the group
    select it and a click on empty canvas leave the group (invariant 28). `selectableIds` and
    `marqueeSelect` stop at the first tier. `enteredReach` returning null — not an empty list — is
    what makes every caller fall through to the top level when the group the user is inside gets
    hidden, instead of the canvas going dead. Paints (`{ color, opacity }`) compare exactly, with no tolerance; `null` matches only
    `null`. Several selected shapes union rather than intersect, and a seed always matches itself,
    so Select Same never shrinks the selection. A group has no `Style`, so it contributes no
    matches to the three paint-based commands and is never returned as one, and still matches on
    kind. But a selected group is **kept**, as is any seed out of reach — the layers panel selects
    a row at any depth while `enteredGroupId` points at that row's parent, so the selection can
    legitimately hold ids `selectableIds` would not offer. Without keeping them, a Select Same that
    matched nothing would silently clear the whole selection.
37. **Paper is loaded on first use, and only `src/geom/paper.ts` may import it** (spec M7 §2,
    M11 §6). That module holds the loader and the two-way conversion; `src/geom/boolean.ts`
    (`booleanOf`) and `src/geom/simplify.ts` (`simplifyOf`) are its callers, and neither imports
    paper itself. The specifier is `paper/dist/paper-core`, with **no file extension** — that is
    the exact name the package's own type declarations use, and the extension-ful path resolves
    to no types — and it must never be the package's default entry (`paper`), which is the full
    PaperScript build and expects a DOM. `booleanOf` maps every operand into **document space**
    through its shape's world matrix before handing it to Paper, and maps the result back into the
    **frontmost input's parent space**, which is where the combined shape is stored (an identity
    transform, as the pen commits a new path). An operation that leaves no area — `booleanOf`
    returning `[]` — must leave the document at the same reference rather than write a path the
    importer would drop; `booleanRefusal` (`src/doc/boolean-edit.ts`) is the one predicate both the
    menus and `booleanShapes` read, so they can't disagree about what's allowed (it de-duplicates
    the ids: one shape named twice is one shape, and combining it with itself would delete it).
    **The load can fail** — it is a network fetch — so the loader caches the _promise_ and clears
    it on rejection, and `booleanSelection` catches, leaves the document alone and raises an
    **error** notice telling the user to try again. Because the action is async even when paper is
    cached, it also refuses to run twice at once, and hands the result the selection only if the
    user hasn't moved it meanwhile.

38. **A latched Shift is not a held Shift.** `Mods` carries `shiftLatched` beside `shift`, and
    `Canvas.svelte` sets it when the dock's latch is the only reason Shift is on. A held key means
    the user is mid-gesture, so a click that hits nothing must **not** clear the selection — that is
    the Illustrator/Figma convention, and a miss should not wipe their work. A latch is a mode set
    earlier and left on, and on a device with no keyboard it cannot be released by letting go, so
    the same click **must** clear: otherwise, with Shift latched, the selection can never be cleared
    at all (Escape is a keyboard, and the dock exists for devices that have none). Only
    `select.ts`'s clear-on-empty branch looks at `shiftLatched`; everything else reads `mods.shift`
    and treats the two alike, including the additive marquee. `Select ▸ Deselect`, and the same
    entry in the context menu, are the route that always works.

39. **`hidden` and `locked` on a node are optional, and absent means normal** (spec M9 §3).
    `Layer` carries `visible`/`locked` as plain booleans; a node carries a flag only in its `true`
    state, because a document can hold thousands of nodes, 136 places in this repo build a node
    literal, and — the reason that matters — "not hidden" then has exactly one representation, so
    an edit that changes nothing returns the same reference (invariant 1). **Turning a flag off
    deletes the key**, so a node hidden and shown again is structurally identical to one that never
    was and still saves byte-identically. Nothing reads the fields directly: use `isHidden` /
    `isLocked` from `src/doc/document.ts`. They are ordinary document data — saved, and undoable.
    A hidden or locked node **cannot be selected at all** (Illustrator's behaviour, and what a
    locked layer already does here), which is why its row's own eye and lock stay live while the
    row is blocked: that row is the only way back.

40. **A title is a path that remembers it was text** (spec M10 §3). `PathShape.text` is optional
    metadata; absent means an ordinary path, which is why the 23 places that test `kind === "path"`
    needed no changes and M11's warp will need none either. It is **not** a new node kind, and it is
    not like a polygon: a polygon regenerates its `d` from seven numbers and validates on import by
    regenerating, while a title **stores its outlines** and the file's `d` is authoritative, because
    regenerating needs a font that may be missing.
    - **Any bake of geometry into a path drops `text`.** Re-typing re-derives the outlines from the
      font, so a reshape, resize or flatten left in place would be silently thrown away on the next
      keystroke. `path-edit.ts` funnels every structural edit through `withSubpaths`; `resize.ts`
      and `flattenTransform` go through `withBakedSubpaths` in `document.ts`. Both of the latter
      were missed first time round: a resize snapped back and a flattened title jumped to the
      origin. A new bake site must use one of those two funnels.
    - **Only `src/text/font.ts` may import `opentype.js`, and only through `await import(...)`**, so
      the parser stays a ~68 KB gzipped lazy chunk. Its ESM export is a **default object**:
      `(await import("opentype.js")).default`, then `.parse(buf)` — `import * as ot` has no `parse`.
      The package ships **no types**, and `@types/opentype.js` is for 1.x and describes a different
      API (it declares `names.fontFamily`, which is `undefined` in 2.0 — the name lives under a
      platform, `names.windows.fontFamily.en`), so `src/text/opentype.d.ts` declares by hand only
      what we call.
    - **Outlines are quadratic**; `svg/pathdata.ts`'s `parsePathData` already converts them to our
      cubics exactly, so the glyph pipeline needs no geometry code of its own.
    - **WOFF2 cannot be read** — the parser throws, needing a brotli decompressor — so `.woff2` is
      refused by name before parsing. It is the format people most often have.
    - **Available ≠ fetched.** A bundled font is always available even before its first fetch; only
      a font added from a file, in a later session, is unavailable. Asking "is it loaded" made every
      title in a reopened file read-only.
    - Scripts needing shaping or RTL (`unshapedScript`) and strings the font has no glyphs for
      (`noGlyphsFor`) are **refused with a notice**, never drawn wrongly.
    - **The randomiser is integer-only** (`src/text/random.ts`). The index goes _into_ a hash rather
      than being consumed in order, so inserting a letter at the front cannot reshuffle the ones
      after it; each property has its own salt, so rotation and scale are independent rather than
      one stream read twice; and everything is `Math.imul`/`>>> 0`, so a title looks identical on
      every machine. A title that re-rolled itself because it was opened elsewhere would be a data
      bug. A negative roll times an amount of zero is `-0`, which `===` calls `0` but `Object.is`
      does not, so the amounts are normalised with `+ 0`.
    - The jitter is baked **about the centre of each character's own advance box, on the baseline**;
      about the origin, distant letters would swing out of the line. An identity transform is
      skipped rather than applied, so an unjittered title's outlines stay byte-identical.
    - **`charSel` and `charQuads` are store state** — not saved, not undoable, cleared whenever the
      selection changes, like `nodeSel` (invariant 31). Escape lets the character go **before** the
      node selection or the object selection. The quads come from the same `runLayout` the outlines
      do, so a character's hit box and its glyph can never drift apart; if they did, clicking a
      letter would select a different one. They are cached by an `$effect.root` **in the store**,
      not an effect in `TextPanel`, because M8 put that panel behind `{#if expanded}` and a
      collapsed Properties panel would have silently stopped character picking working. The Overlay
      draws the highlight from that state directly, never through the single `app.overlay` slot
      that the marquee, the snap guides and the pen draft already share.
    - **`NumberField` never goes in a fixed-width cell.** It is a label, an input and a suffix that
      together need 108-133px; in a `grid-cols-2` cell of the 240px sidebar (104px) every field
      overflowed onto its neighbour and painted over that label. Superseded 2026-09-20 by the panel
      grid in invariant 23: the field column is `minmax(0, 1fr)`, so a field shrinks instead of
      overflowing, and the `flex flex-wrap` rows this note once prescribed are gone.
    - **`data-sv-text-opts` is 8 **or** 9 fields.** M10d appended `lineHeight`; `parseTextOpts`
      accepts either and defaults the missing one to 1.2, because demanding nine would have turned
      every title saved before it into a plain path with its text lost. Any future field must be
      appended and optional for the same reason.
    - **Block alignment falls out of the per-line rule** and needs no arithmetic of its own: with
      `left` every line starts at 0, with `center` every line is centred on 0, with `right` every
      line ends at 0 — so the block is aligned because each line is. `layoutRun` is unchanged from
      the single-line days.
    - **Character indices are indices into the raw string, newlines included.** `runLayout` skips
      the newlines (they have no glyph) but never renumbers what follows, which is what keeps
      M10c's per-character overrides pointing at the characters they were made for.
    - **Alignment is not a position — it is which edge stays put when the title changes.** The
      click point is the anchor and the outlines are re-derived from it, so left grows rightwards,
      right grows leftwards and centre grows both ways. Its buttons use flush-line icons
      (`TextAlignStart/Center/End`), never arrows: an arrow says "move this way", and pressing
      "right" makes the text extend _leftwards_ from a pinned right edge, so arrows read as
      inverted. The titles say what is pinned, not "Align left".
    - **The panel shows ranges for the title and absolute values for a character.** `±12°` and
      `−12°` are different quantities, so they never share a field.
    - **The seed is an id, not a length.** `parseTextOpts` measures sizes and amounts against
      `MAX_TEXT_NUM` but checks the seed as a 32-bit integer: measuring it as a coordinate rejected
      every seed above 1e9, and a re-rolled title then came back from a reload as an ordinary path
      with its text lost for good.

41. **The title field is live, and a typing burst is one undo step** (M10e §5). `oninput` calls
    `typeTitleText` (quiet), `blur` calls `setTitleText` (reporting) and `TextPanel` brackets the
    burst in `beginDocGesture`/`endDocGesture`, exactly as `PaintField` does for a picker drag
    (invariant 41). Three things this needs, each of which was a bug first:
    - **Quiet.** A live keystroke is a state the user is passing _through_ — an empty field on the
      way to retyping, a half-typed word with no glyph in this font. `reshapeTitle` takes a `quiet`
      flag that suppresses the notices and `refuseUnshaped`'s; without it, typing raised an error
      notice per keystroke.
    - **No snap-back until the commit.** The field is only put back from the document on `blur`.
      Doing it per keystroke yanked the caret back mid-word on every refused intermediate.
    - **`await` must actually wait.** `reshapeTitle` returns immediately when a run is already in
      flight — it only queues the patch — so the blur's `await` resolved while keystrokes were
      still draining and `endDocGesture` closed the bracket early, leaving the last commits outside
      it as undo steps of their own. `reshapeTitleDraining` now keeps the in-flight drain in
      `titleWork` and hands it back to a caller that only queued, so awaiting it awaits the settle.
    - **Cmd+Z inside the focused field is the browser's own text undo**, not the app's: it removes
      one typed chunk and fires `input`, which this handler then commits as an ordinary edit. That
      is standard text-field behaviour and is deliberately not fought. It also makes the app's undo
      granularity untestable without blurring first — three "one character back" results during
      development were this, not a broken bracket.

42. **A live UI drag belongs in a document gesture.** `PaintField`'s colour swatch updates the
    artwork on `input` — the live event, where `change` fires only once the picker closes — and
    brackets the drag in `beginDocGesture`/`endDocGesture`, so a drag across the picker is **one**
    undo step rather than one per colour. The bracket must close on every way a drag can end:
    `change`, `blur` (dismissing the picker without altering the colour fires no `change`) and
    component destruction via an `$effect` cleanup, because clearing the selection removes the
    field mid-drag. A gesture left open silently stops recording undo history for everything after
    it — the M8 stranded-drag failure in a new place. `PaintField` stays presentational: the caller
    owns the gesture and passes `onlivestart`/`onliveend`. `setSelectionStyle`'s
    `cancelActiveGesture()` is unrelated — it cancels a running _tool_ drag and never touches
    `session.gestureBase`.

43. **A title's layer row is labelled by its own text** (`rowLabel`, M10e §6), not "Path". A title
    is a path carrying metadata (invariant 40), so it fell through to the path case and every
    title in the panel read "Path". One line only, whitespace collapsed, cut at 24 characters:
    `rowLabel` also feeds tooltips, `aria-label`s and the node tool's refusal notice, none of which
    truncate the way the row does in CSS, and a title can be a paragraph. A whitespace-only title
    falls back to "Title". An explicit `name` still wins, as for every other kind.

44. **A title survives a UNIFORM resize and only a uniform one** (`resize.ts`, M10e §7). Glyph
    outlines scale linearly with size, so outlines scaled by `k` are exactly what the font gives at
    `size * k` — which is what lets the baked subpaths and the metadata stay in agreement, so the
    next keystroke re-derives the same shape instead of snapping back. `scaleTextMeta` scales only
    the **lengths**: `size`, `letterSpacing`, `amounts.offset` and each override's `dx`/`dy`.
    `lineHeight` is already a multiple of the size, and `rotate`/`scale`/`skew` (with `r`/`s`/`k`)
    are degrees and ratios — scaling those would rotate and skew the characters as the title is
    resized. A **flip** is not uniform for this purpose: it mirrors the outlines, and re-outlining
    at `|k|` comes back un-mirrored.
    - **The non-uniform case is the common one, not the exotic one.** `dragHandle` constrains the
      proportions only while **Shift** is held, so a plain corner drag stretches and costs the
      title its text; W and H in the geometry fields are non-uniform by construction and always do.
      Both warn — `droppedTitle` is the shared predicate, and it compares the documents **before
      and after** rather than re-deriving the rule from the matrix, because a second copy of "is
      this uniform, in the node's own space, through its parent" is one that can drift from
      `bakeShape`, and this is quiet data loss where a drift would go unnoticed.
    - The select tool warns **once per drag**, on pointer-up, not per pointermove.

45. **Safari opens a share sheet or writes the clipboard only during a recent tap.** `navigator.share`
    and `navigator.clipboard.write` must be **called** inside the activation — not merely handed a
    promise that settles later. `copyPng` (M12) and `deliverFile`'s `tryDirect` (M13) both encode
    this: build nothing before the call that you can build after it, and where a build is
    unavoidable — a PNG render — do not attempt the direct path at all, but go straight to a dialog
    whose button supplies a fresh tap.

## Current state

Milestone 13 (Save to Files on iPad: Save, Save As and Export PNG route through the share sheet
on an Apple touch device, so the user picks a destination instead of every save landing in
Downloads as a renumbered copy — still a new file each time, never a true overwrite) — see
CHANGELOG. Verification is outstanding: the whole feature needs an iPad and none of it is
confirmed yet, including whether `image/svg+xml` is shareable at all on iPadOS. **M14 — envelope
warp** (`docs/superpowers/specs/2026-09-20-m14-envelope-warp-design.md`) is specced and is next.
Beyond that the post-v1 list (project design §10) still holds gradients, a freehand tool, grid and
smart guides, masks, align and distribute, and image paste. **A light theme is no longer planned**
(2026-09-19), and **multiple artboards are no longer planned** (2026-09-20) — the design doc still
lists both, as a dated document that later decisions supersede rather than rewrite. **Text is
done** (M10a-M10d), so it has left the list, and so has **PNG export** (M12) and **Save to Files**
(M13). The accessibility group and the performance group (both parked below) remain the two
obvious milestones after M14.

## Roadmap

M4 was split into 4a (node editing) and 4b (the pen tool), as M3 was split into 3a/3b. M5 (iPad
polish + deploy), M6 (selection conveniences), M7 (boolean operations), M8 (the sidebar split), M9
(per-object visibility and lock), M10a-M10e (titles, the randomiser, panel density and the
resizable sidebar), M11 (path operations), M12 (PNG export) and M13 (Save to Files on iPad) are
complete — see CHANGELOG. **M14 — envelope warp**
(`docs/superpowers/specs/2026-09-20-m14-envelope-warp-design.md`) is specced and is the next step.

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
