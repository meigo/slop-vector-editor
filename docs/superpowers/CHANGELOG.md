# Changelog (append-only; later entries supersede earlier ones)

## 2026-09-16 — Milestone 1: scaffold, model, render, files

- Project scaffold copied from slop-animator's toolchain (Svelte 5 runes, TS strict, Vite 8,
  Tailwind 4 with the SLOP-TIMELINE-UI palette, Vitest, ESLint/Prettier, husky, wrangler).
- Immutable document model; pure undo session with gesture support; `app` store with `$state.raw`.
- Own XML reader (runs in node for tests), SVG path-data reader/writer with arcs and quadratics,
  CSS colors, transform lists, serializer and importer. Own files round-trip exactly (6-decimal
  rounding); Inkscape/Figma/Illustrator-shaped fixtures import with a dropped-feature report.
- The importer rejects non-finite numbers and invalid/oversized artboards, falling back to
  `width`/`height`, then 300×150, and reporting "invalid artboard size"; a transform list
  containing any unknown function is ignored as a whole (identity), not applied partially.
- Canvas renders through the exporter's attribute functions; pan (drag/wheel), zoom
  (ctrl-wheel, Safari gesture events, two-finger pinch), fit on load/replace.
- File menu: New (presets), Open, Save, Save As, Document settings; in-app confirm; notices;
  keyboard shortcuts; IndexedDB autosave (SVG text) with restore. Autosave is skipped for the
  rest of the session (one notice only) when IndexedDB is unavailable.
- Plan: `docs/superpowers/plans/2026-09-16-m1-scaffold-model-files.md`.
- Browser-verified (desktop Chrome): fitted artboard on load; Inkscape/Figma/Illustrator
  fixtures render with correct dropped-feature notices (hidden layer not drawn); mouse drag
  pan; wheel pan; ctrl+wheel zoom (×e, preventDefault true); ⌘0 fit, ⌘1 100%; menu → Document
  settings → 400×297 + background → dirty dot + undo enabled; ⌘Z/⇧⌘Z; open-while-dirty shows
  in-app confirm, Cancel keeps doc; invalid file → error notice, doc unchanged;
  serialize→open→serialize byte-identical; New 512×512 clean + fitted; autosave restores dirty
  doc (name + dot) and clean doc after reload; no console errors on load.
- Owed: real OS file picker / save-in-place / download fallback (automation can't drive OS
  dialogs); resize-without-refit; Safari trackpad gesture events; touch pinch/pan; iPad.

## 2026-09-16 — final review fixes

- F1: `ParseResult` gained `native` (true only when the root `<svg>` has `data-sv-version`).
  `openText` keeps the File System Access handle only when the file is native and nothing was
  dropped, so ⌘S on a foreign file goes through the save picker/download fallback instead of
  overwriting the original; the info notice says so when a handle is discarded.
- F2: `autosave.ts` exports `flushAutosave()`, which performs the pending debounced write
  immediately (same error reporting) instead of waiting out the 3 s timer. `App.svelte` calls it
  on `document` `visibilitychange` (hidden) and `window` `pagehide` while autosave is enabled, so
  closing the tab or switching apps no longer drops the last few seconds of edits.
- F3: `parse.ts` exports `MAX_COORD = 1e9`; `num`/`numbers` reject values beyond it like
  non-finite ones. `transform.ts` and `pathdata.ts` each keep a local copy of the same bound (to
  avoid an import cycle with `parse.ts`) so an overflowing composed transform falls back to
  identity and an overflowing path coordinate stops the path, instead of `fmt` writing "Infinity"
  back out on save.
- F4: `xml.ts`'s `decode` now throws `XmlError` for numeric character references to code points
  XML 1.0 forbids (nulls, most C0 controls, the UTF-16 surrogates, U+FFFE/U+FFFF).
  `serialize.ts`'s `escapeAttr` writes tab/LF/CR as `&#9;`/`&#10;`/`&#13;` and strips any other C0
  control character, so a name or value containing one still round-trips as well-formed XML.
- F5: `autosave.ts`'s `writeAutosave` now resolves on the write transaction's `oncomplete` and
  rejects on `onabort`/`onerror` (`tx.error`), rather than on the `put` request's `onsuccess` —
  the previous version could report success before the write was durable.

## 2026-09-16 — Milestone 2a: select, transform, shapes

- Geometry: `geom/box.ts` (axis-aligned boxes, `boxMap` for a resize transform), `bezier.ts`
  (cubic point/extrema/bounds/flatten), `bounds.ts` (node and selection bounds through the
  matrix), `hit.ts` (hit-testing and marquee select — path outlines and a 64-point sampled
  ellipse polyline, both cached per shape object).
- Edits and the resize model: `doc/tree.ts` (`findTopLevel`, `selectableIds`, `targetLayerId`)
  and `doc/resize.ts`, which bakes a resize into shape geometry (rect/ellipse fields, path node
  positions) instead of the matrix, so stroke width and rect corner radius never scale; a resize
  that would skew or rotate a rect/ellipse converts it to a path first. Move and rotate only ever
  touch the matrix.
- Tools and the gizmo: `tools/` gained `types`, `tool` (`Tool`/`ToolContext`/`ToolEvent`), `frame`
  (rotated selection frame), `gizmo` (resize/rotate handle geometry and hit-testing), `shape-tools`
  (rect/ellipse/line/polygon/hand draw tools, Shift/Alt during drag), `select` (click,
  Shift-click, drag-select, move, resize by corner/edge, rotate with 15° Shift-snap,
  Alt-duplicate), `registry` (`TOOLS`) and `context` (the real `ToolContext`, wired to `app`).
  Tools never import the store — this is what makes them unit-testable against
  `__tests__/fake-context.ts`.
- Pointer routing: `input/route.ts` decides tool vs. pan vs. pinch vs. context-menu vs. ignore
  from pointer type, button, and active pointers/touches — a right-click menu only for mouse
  input, a second finger for pinch, and a touch during an active pen/mouse gesture ignored
  (palm rejection). `Canvas` treats `pointercancel`/`lostpointercapture` like a gesture end. A
  running tool drag commits from its own base document, so the store exposes a gesture-cancel
  hook (`registerGestureCancel`/`cancelActiveGesture`): undo, redo, `replaceDocument`, every
  selection action and `applyGeometry` cancel an active gesture before editing.
- The modifier dock (`input/dock.ts`, `ModifierDock.svelte`): on-screen Shift/Alt for touch —
  press-and-hold behaves like a physical key, a quick tap latches, a long press releases it.
- The properties panel (`state/properties.ts`, `PropertiesPanel.svelte`, `NumberField`,
  `PaintField`): fill/stroke/width/cap/join/opacity and X/Y/W/H/rotation, with mixed-value
  ("blank field") handling across a multi-selection; with nothing selected it edits the defaults
  for new shapes. A drawer (`TopBar` toggle) replaces the docked panel below 900 px width.
- Preferences (`persist/preferences.ts`): style and polygon (sides/star/inner-ratio) defaults for
  new shapes, persisted to `localStorage` and validated field-by-field on load.
- The other-tab warning (`persist/tab-presence.ts`): a `BroadcastChannel` "hello"/"here" exchange
  warns both tabs once that they share one autosave record.
- Plan: `docs/superpowers/plans/2026-09-16-m2a-select-transform-shapes.md`. Spec addendum:
  `docs/superpowers/specs/2026-09-16-m2a-select-transform-shapes-design.md`.
- Browser-verified (desktop Chrome, dev server, at b221e6e): draw rect/ellipse/line/polygon with
  real mouse drags, each new shape selected, tool keys R/E/L/Y/V; select by tap, Shift-tap
  multi-select, drag-select (fully-inside rule, document order), Esc clears; resize by corner and
  by edge; rotate with the knob (handles follow the rotated frame); a rotated rect resized in its
  own frame stays a rect with its matrix unchanged; a non-uniform multi-selection resize turns a
  ~90.16°-rotated rect into a path while an axis-aligned ellipse in the same selection stays an
  ellipse; stroke widths never change on resize; Shift-snapped rotation (135° exactly) and
  Alt-duplicate-drag via the on-screen modifier pad (tap latches, tap again releases), and
  Alt-duplicate via a synthetic pointer event with `altKey` (the physical-key path) — the
  automation tool's drag action cannot deliver modifier keys, so physical Shift/Alt drags were
  not exercised with real input; keyboard: Shift+Arrow nudge as one undo step, ⌘D duplicate
  (selects the copies), Backspace delete, ⌘Z undo, Space held enters the pan state; context bar:
  rect corner radius (12), Convert to path (rounded rect → 8-node path); right-click menu opens on
  the object under the pointer, Convert to path from the menu works; properties panel: fill hex
  (uppercase accepted, stored lowercase), stroke width, W (resize keeps stroke width), mixed
  values (fill "mixed", width blank), "Defaults for new shapes" with nothing selected, defaults
  saved and restored after reload; serialize → parse → serialize of a drawn document is
  byte-identical with nothing dropped; a second tab shows the shared-autosave warning in both
  tabs; narrow layout
  (820 px iframe): docked panel hidden, TopBar toggle opens/closes the drawer; no console errors.
- Known issues found in the browser pass: the right-click menu is not clamped to the viewport
  (opened near the bottom edge, its Delete item was cut off — a previously deferred minor, now
  observed); in the narrow layout the status bar wraps "800 × 600 px" onto two lines (cosmetic).
- Owed: touch, Apple Pencil and iPad (pinch, palm rejection, dock with a held finger); physical
  Shift/Alt held during a real drag; Safari/Firefox; the drawer on a real narrow device.

## 2026-09-16 — final review fixes (M2a)

- F1: resizing keeps the grab offset — a handle pressed off-centre no longer makes the edge jump
  to the pointer on the first move (`handleFramePoint` exported from `tools/gizmo.ts`).
- F2: `NumberField` no longer commits on focus + blur without typing (tabbing through X/Y/W/H/R
  recorded rounding-error nudges as undo steps).
- F3: handles that would act on a zero-size axis are skipped (`activeHandles`): a horizontal or
  vertical line can be dragged by its middle; the overlay draws only the active handles.
- F4: Esc (`clearSelection`) cancels an active drag first.
- F5: the right-click menu is clamped to the viewport (measured size, 4 px margin), and shows
  "Convert to path" / "Flatten transform" only when they apply — the same check as the context
  bar (`selectionActions` in `state/properties.ts`).
- F6: `lastPointerType` is set only for routed pointers (plus right-click), so a rejected palm
  does not change the handle size; the canvas context menu cancels an active drag before changing
  the selection; the path hit-test cache is keyed by `subpaths` (survives move/rotate); the status
  bar's artboard size no longer wraps; the properties panel's fallback paints come from
  `DEFAULT_STYLE`; the test `fakeContext` prunes the selection like the real store.
- Correction to the Milestone 2a entry: the modifier dock's long press acts like holding the key
  and ends "off" when released (a quick tap latches; a quick tap on a latched key releases it).

## 2026-09-16 — Milestone 2b: clipboard and snapping

- Copy/cut/paste: the selection is copied as standalone SVG in our own format (`text/plain` and
  `image/svg+xml`); paste accepts any SVG text through the importer. Repeated pastes of our own
  copy cascade by 10 (centred on the view when the offset copy would be off-screen); external
  SVG is centred on the view. One undo step; the pasted nodes are selected; dropped features are
  listed. Keyboard uses the window clipboard events; the context bar and right-click menu (which
  now also opens on empty canvas, Paste only) use `navigator.clipboard` with the in-app copy as
  fallback.
- Snapping (8 screen px) to the artboard edges/centre and other objects' bounds (visible layers,
  locked included) while moving (Shift-constrained moves snap only their axis), resizing
  (unrotated frames, the moving handle's axes) and drawing (start and current point; not the end
  of a Shift-constrained line). Pink guide lines; Snap toggle in the dock and on `%`; saved in
  preferences (default on).
- An Alt-drag released at its start no longer leaves a hidden duplicate.
- The Alt-drag-back check uses a 1e-9 tolerance: snapping can leave a float residue on fractional
  coordinates.
- Plan: `docs/superpowers/plans/2026-09-16-m2b-clipboard-snapping.md`.
- Browser-verified (desktop Chrome, M2b branch; synthetic ClipboardEvents/PointerEvents;
  `navigator.clipboard` stubbed so the real system clipboard was never read or written and no
  permission prompt appeared): copy event preventDefaults and writes identical SVG text in
  `text/plain` and `image/svg+xml`; three pastes of it cascade +10/+20/+30, each one undo step,
  pasted copy selected; cut event removes the selection in one undo step, pasting it back lands
  at +10; external SVG (circle + `<text>`) pastes centred exactly on the visible canvas with info
  notice "Some content was not imported: `<text>`"; plain-text paste gives error notice "The
  clipboard doesn't contain an SVG drawing." and leaves the document unchanged; copy with focus
  in a properties field is not intercepted; context bar shows "1 selected · Cut · Copy · Paste ·
  Duplicate · Delete · Convert to path · Radius" with a selection, "Paste" + hint without one;
  right-click menu on empty canvas offers Cut/Copy/Paste/Duplicate/Convert to path/Delete with a
  selection, Paste only without one; menu Copy writes the system clipboard once; menu Paste with
  the read refused pastes the in-app copy at +10, and with no in-app copy after a reload shows
  info "Nothing to paste." with the document unchanged; move snapping: right edge snaps onto
  another object's left edge (x exact), guide state `{xs:[200]}` and a 1 px pink (`#ff3ea5`)
  full-height line at the right screen x, removed on release, one undo step; resize
  snapping: east handle snaps to the other object's edge (w exactly 160), guide shown then
  cleared, a 10°-rotated rect does not snap (w 117 = 80 + 37); draw snapping: a rect started 2–3
  units from the artboard corner starts exactly at (0, 0), and at (2, 3) with Snap off; Snap
  toggle: `%` turns it off (button `aria-pressed` false, not highlighted), the setting survives a
  reload, tapping the dock's Snap button turns it back on; Alt-drag (dock Alt latched) of a
  fractional-origin rect out and back near the start leaves no duplicate, no history, not dirty,
  selection kept; no console errors on load.
- Known issue observed (not a regression of this branch): an info notice sits on top of the
  modifier dock (both bottom-right) for its 6 s lifetime.
- Owed: Safari (does it fire `copy`/`cut` with no text selection?), Firefox, the iPad clipboard
  permission prompt and paste button, snapping by touch/Pencil, a real clipboard-read permission
  prompt, real ⌘C/⌘V key presses (automation used synthetic clipboard events), pasting directly
  from Inkscape/Illustrator/Figma.

## 2026-09-17 — Milestone 2c: live polygons and stars

- New `polygon` shape kind (centre, x/y radii, sides, star, inner ratio; rotation in the
  transform). The polygon tool draws it; the context bar edits Sides / Star / Inner for a
  selection made only of polygons (blank / indeterminate when they differ), one undo step each.
- Resizing keeps it a polygon along its own axes (stretching changes the radii; a vertical flip of
  an odd polygon adds a half-turn); an angled resize or Convert to path turns it into a path.
- Saved as `<path … data-sv-polygon>` with `d` built from the written numbers; reopening restores
  the polygon only when the attribute validates and `d` still matches, else it stays a path. Save
  → open → save is byte-identical. Polygons drawn before this milestone stay paths.
- Plan: `docs/superpowers/plans/2026-09-17-m2c-live-polygon.md`.
- Browser-verified (desktop Chrome, M2c branch, separate dev server on port 5198; synthetic
  PointerEvents/ClipboardEvents; `navigator.clipboard` stubbed): the polygon tool draws live
  polygons — a free drag gives a rotated transform with corner 0 toward the pointer, a Shift drag
  gives an upright star with an identity transform; one selected polygon shows Sides and Star in
  the context bar, with Inner appearing only for a star; Sides 8 and Star on are one undo step
  each and don't change the tool defaults, undo restores 8/off then 5/off; polygon + star selected
  shows an indeterminate Star checkbox and blank Inner, setting Sides changes both, and a real
  click on the indeterminate checkbox makes both stars in one undo step; polygon + rect selected
  shows no polygon fields and no Radius, rect alone shows Radius only; stretching with the east
  handle keeps a polygon (rx 55.77, ry 40, identity transform) with the fields intact; dragging
  the bottom handle past the top of a pentagon flips it to a half-turn transform with corner 0
  pointing down, still a polygon; a W change on a rotated polygon resizes along its own frame
  (rotation unchanged, rx changed); Convert to path turns a polygon into a path and the fields
  disappear; copy/paste of a polygon carries `data-sv-polygon` in the clipboard SVG and the pasted
  copy is a polygon; serialize → parse → replace → serialize is byte-identical with nothing
  dropped and kinds kept, and polygons survive autosave + reload; no console errors.
- Owed: touch/Pencil editing of the fields on iPad; Safari/Firefox; opening a saved polygon in
  Inkscape/Illustrator/Figma (should show as a plain path).

## 2026-09-17 — Milestone 2d: UI alignment with slop-animator

- System UI font (IBM Plex Mono and its Google Fonts request removed); 14px body text; tabular
  digits in number and hex fields.
- Raised fields; one on-state (`.ui-on`, unlayered) for tools, dock, presets and the open File
  menu; `.ui-selected` row style ready for the layers panel; keyboard-only focus rings.
- Checkboxes became toggle buttons (`ToggleButton`, `aria-pressed`, with a mixed state): Star (tool
  and selection), Fill/Stroke "On", Document settings Background.
- The ☰ menu is a labelled "File ▾" button; bars have group separators and never wrap (they scroll
  when too narrow); the unsaved state recolours the file name instead of inserting a dot; panel and
  dialog section titles are small uppercase labels.
- Deliberate deviation from SLOP-TIMELINE-UI.md: bar controls are 32px (as in slop-animator), not
  24px.
- Plan: `docs/superpowers/plans/2026-09-17-m2d-ui-alignment.md`.
- Browser-verified (desktop Chrome): body font-family is system-ui, sans-serif with no requests to
  fonts.googleapis.com / fonts.gstatic.com; no checkbox left in the DOM, every toggle carries
  aria-pressed (tools, Snap/Shift/Alt, Properties, Star, Fill/Stroke "On" — named "Fill on"/"Stroke
  on", Document settings Background "On" — named "Background on", New-document presets); a polygon
  + star selection shows Star as `aria-pressed="mixed"` with `.ui-mixed`, a filled + unfilled
  selection shows Fill/Stroke as mixed, and clicking either mixed toggle applies to both in one
  undo step; the active tool button and the selected New-document preset use `.ui-on`; a mouse
  click on Undo leaves no focus outline, Tab to Redo shows a solid 2px accent outline; the file
  name keeps an identical bounding box clean vs dirty and turns accent when dirty (checked before a
  review fix replaced the span's aria-label with visually hidden ", unsaved changes" text, which
  takes no layout space; that fix was not re-checked in the browser); fields have the raised
  background; the File ▾ button carries `aria-haspopup`/`aria-expanded` and `.ui-on` while open,
  menu items unchanged, and the click-away overlay closes it; narrowed to 820px neither bar changes
  height or wraps, the context bar scrolls instead (882 > 820); screenshots taken of the top bar +
  context bar with a mixed polygon selection, Properties, Document settings, and New document; no
  console errors during use or on reload.
- Review fixes: fields show only the focus ring (no accent border) on focus; the "On" toggles are
  named "Fill on" / "Stroke on" / "Background on"; the unsaved state is announced by visually
  hidden text.
- Owed: iPad/Safari look (SF system font), touch sizes on a device, the narrow drawer layout on a
  real narrow window (automation narrowed only the app container).

## 2026-09-17 — Milestone 2e: one icon top bar

- The file bar and the context bar became one icon-only top bar: File ▾ · name | undo redo |
  cut copy paste | duplicate delete | convert-to-path flatten … zoom | properties (narrow).
  Actions that don't apply stay in place, `aria-disabled`, with the reason in the tooltip.
- Every `title` also shows in the status bar on mouse hover (tool hint otherwise).
- Rect radius and polygon Sides / Star / Inner moved to a "Shape" section in Properties; the
  polygon tool's defaults are a "New polygons" section shown with nothing selected or while the
  polygon tool is active.
- Superseded: the M2d entry's context-bar bullets (separators, Star toggle in the context bar,
  40px context bar) — the context bar no longer exists.
- Plan: `docs/superpowers/plans/2026-09-17-m2e-icon-toolbar.md`.
- Browser-verified (desktop Chrome, M2e branch, separate dev server on port 5198; synthetic
  PointerEvents for drawing, real mouse hover; `navigator.clipboard` stubbed): with nothing
  selected, Undo/Redo/Cut/Copy/Duplicate/Delete/Convert/Flatten are `aria-disabled` with their
  reason titles ("Cut — nothing selected", "Convert to path — select a rectangle, ellipse or
  polygon", …), Paste is enabled, and every button has an `aria-label` and a `title`; clicking
  disabled Delete/Convert changes nothing (same document, no history); with a rect selected,
  Cut/Copy/Paste/Duplicate/Delete/Convert are enabled and Flatten is disabled with its reason; a
  real mouse hover on Cut shows "Cut (⌘X)" in the status bar, and moving onto the canvas brings
  back the tool hint; the File menu opens fully and "Document settings…" opens the dialog; copy,
  duplicate, delete, paste (from the stubbed clipboard), cut, undo, redo, convert to path and
  flatten transform (after a nudge) all work; two rects with different radii show Shape → Radius
  blank ("–"), and setting it to 6 changes both in one undo step; a polygon + a star show Shape →
  Sides, Star (`aria-pressed` "mixed") and Inner, and a Star click plus Sides 6 each change both
  in one undo step; with nothing selected, the Polygon defaults section sets Sides 7 + Star on
  `prefs.polygon`, and the next drawn polygon is a 7-point star; narrowed to 768px and 820px the
  header stays one row (scrollWidth = clientWidth), with ~207 CSS px free at 768px between the
  Flatten button and the zoom group — at a real 768px window the Properties toggle and its
  separator also show (~40px), leaving ~167px, of which M3a's four z-order icons need ~150px; no
  context bar element remains; screenshots taken of the disabled state, the File menu, the Shape
  section (radius) and the Shape section (polygon + star); no console errors during use or on
  reload.
- Owed: iPad (no hover — no status-bar hints on touch; iPad Safari shows no `title` tooltips, so
  on touch the icon buttons have no visible labels and disabled reasons are invisible — needs a
  touch label/reason affordance (M5)), Safari/Firefox, a real 768px window.

## 2026-09-17 — Milestone 3a: layers panel and z-order

- A current layer receives new shapes and pastes; selecting an object makes its layer current; a
  hidden or locked current layer refuses with a notice instead of falling back to another layer.
- Layers panel under Properties: layers (top first) with their objects, eye/lock, current-layer
  tint, selected-object rows, rename by double-click/double-tap, drag-to-reorder by grip (layers,
  and objects within/between layers) with a drop line, New layer / Delete layer (confirmation when
  not empty; never the last layer).
- Z-order (per layer): top-bar icons, context-menu items and ⌘] ⌘[ ⇧⌘] ⇧⌘[.
- The SVG writer strips unpaired surrogates and U+FFFE/U+FFFF from attributes (user-typed names).
- Plan: `docs/superpowers/plans/2026-09-17-m3a-layers-panel.md`.
- Browser-verified (desktop Chrome, 800px window with the drawer; the wide ≥900px column was
  checked for rendering only): panel rendering, layer and object rename (Enter commits, Escape
  cancels, empty name restores the default label, undo), hide/lock (selection pruned, rows muted
  with reason titles, exact draw/paste refusals), selecting on the canvas sets the current layer
  and new shapes land there, ⌘[ ⌘] ⇧⌘[ ⇧⌘] and the top-bar buttons (no page navigation; disabled
  reasons), layer and object drag with the drop line, drop onto a locked layer refused, Escape
  cancels a drag without clearing the selection, delete with in-app confirmation (Cancel keeps),
  new layer naming, only-layer delete disabled with reason, Shift/⌘ row toggling, collapse,
  status-bar hints for rows, top bar one row at 768px, no console errors. Row drags were driven
  with synthetic pointer events.
- Owed: iPad (touch drag of rows, double-tap rename, the drawer with both panels), Safari/Firefox,
  real ⌘[ / ⌘] presses in Safari, wheel-scroll during a row drag (drop line does not follow; no
  auto-scroll), a real (non-synthetic) mouse/pen row drag with pointer capture; top-bar width at
  iPad mini portrait (744px) — at 768px the file name is down to ~33px.

## 2026-09-17 — Milestone 3b: groups

- Group (⌘G) and Ungroup (⇧⌘G) in the top bar, the context menu and the keyboard. A group lands
  where its frontmost member was; Ungroup composes the group's transform into its children and
  folds its opacity into them.
- The selection can name a node at any depth: `findNode`/`mapNodes` walk into groups and hand each
  edit the node's parent matrix, so moving, resizing, rotating, styling, z-order, rename, duplicate
  and delete all work inside a group. No edit leaves an empty group behind.
- Double-click enters a group (dashed outline, status-bar hint); a click outside or Escape leaves.
  Hit-testing and marquee select the group's own children while inside it.
- The layers panel nests group rows, and rows can be dragged into and out of a group, keeping their
  place on screen.
- The Opacity field edits a group's own opacity.
- `isAxisAligned` now measures skew against the matrix's own scale.
- Plan: `docs/superpowers/plans/2026-09-17-m3b-groups.md`.
- Browser-verified (desktop Chrome): group across two layers (positions kept, group lands in the
  frontmost member's layer, one undo step), double-click to enter with the dashed frame and
  status-bar hint, nested enter/leave with Escape, a click on empty canvas leaving the group,
  right-click inside a group selecting the child, dragging a child inside a 25°-rotated group
  (45.80 document units for an expected 45.77), ⌘G and ⇧⌘G, the Group/Ungroup buttons and their
  disabled reasons, Ungroup restoring positions exactly and folding 50% opacity into both
  children, panel drags into and out of a group with the drop line, a group dropped into its own
  child refused, z-order inside a group, deleting a group's last child removing the group, undo
  of each, the top bar staying one row down to 730px, and no console errors.
- Copy and cut work on nodes at any depth, baking the parent transform into the copy.
- Owed: iPad (double-tap to enter a group, dragging nested rows), Safari/Firefox, a real
  pointer-capture drag of panel rows, and the layers panel's row measuring on every pointermove
  (unchanged from M3a).

## 2026-09-18 — Milestone 4a: node editing

- The Node tool (N): pick a path (click targets it, showing its outline), click/Shift-click/marquee
  select its nodes, drag nodes and handles by type (Alt breaks a smooth/symmetric handle in two),
  double-click a segment to add a node and double-click a node to cycle its type, arrow nudge
  (1/10px), delete, and an Escape chain (node selection → node target → entered group → object
  selection). Double-clicking a path from the select tool switches straight to the node tool with
  that path targeted.
- Six pure edits in `src/doc/path-edit.ts` — `movePathNodes`, `moveHandle`, `insertNode`,
  `deletePathNodes`, `setNodeType`, `closeSubpath` — none of which may leave a subpath with fewer
  than two nodes or a path with no subpaths.
- Two geometry helpers in `src/geom/bezier.ts`: `splitCubic` (de Casteljau) for adding a node
  mid-curve, and `nearestOnSubpath` for picking the segment under the pointer. Flattening now
  scales with the accumulated matrix scale (segment cap 64 → 256), fixing coarse hit-testing on
  scaled-up curves — a parked M2b/M4 finding.
- The coincident-point tolerance in `src/svg/pathdata.ts` widened from 1e-9 to 1e-6, matching the
  writer's 6-decimal rounding, so a closed subpath a hair off from its start still merges on
  reload — another parked finding this milestone fixes.
- Snapping to path nodes (`collectTargets`'s new `{ nodes: true }` option, spec M2b §1); a Node
  section in Properties (type toggle + X/Y for a single selected node); node items (Delete
  node(s), Corner, Smooth, Symmetric) in the context menu, gated to the node tool with a node
  selection.
- Fix: the select tool's double-tap action now fires on pointer-up for a gesture that stayed a
  click, instead of on pointer-down — a latent bug where a click followed within the double-tap
  window by a drag would enter a group (or, now, switch tools) instead of dragging.
- Plan: `docs/superpowers/plans/2026-09-17-m4a-node-editing.md`.
- Browser-verified (desktop Chrome): convert-free editing of a pasted path — targeting a path,
  dragging a node (handles follow) and a handle, double-click to add a node and to cycle a type,
  marquee plus arrow nudge (1 and 10), deleting a node and then the path's last nodes (the path
  goes, undo restores), the Escape chain, editing a path inside a 30°-rotated group (the node
  tracked the pointer: 45.39 document units for an expected 45.77, with no vertical drift), a
  serialize→parse round trip identical with nothing dropped, node snap targets offered for a
  top-level path and excluded for the edited one, and the context menu's node items.
- Owed: iPad (dragging nodes and handles with a finger, double-tap to add or cycle), Safari/Firefox,
  the pen tool (milestone 4b), and a path inside a group contributes no snap targets —
  `collectTargets` still walks only top-level nodes (a pre-existing limitation, now more visible).

## 2026-09-18 — Milestone 4b: the pen tool

- The Pen tool (P): draws a path node by node. A click places a corner node; a click-drag places a
  node and pulls its handles, `out` following the pointer and `in` mirrored, so the stroke curves on
  both sides of the node; Alt during the drag breaks the mirror, moving only `out` and leaving the
  node a corner. Shift constrains the next node to 45° steps from the previous one; snapping (when
  Snap is on) applies to placed points, including other paths' nodes, the same targets the other
  tools use.
- Clicking the draft's first node closes the path and finishes; Enter or a double-click finishes an
  open one. Backspace removes the last placed node without touching the document. Escape discards
  the whole draft — a new path is never created, and a resumed path is left exactly as it was.
- Resuming an open path: with no draft, a press near either end of an open path continues it instead
  of starting a new one. Starting from the path's first node reverses the subpath first
  (`reverseSubpath`), so drawing always appends; clicking the far end closes the path and finishes.
  A closed path has no ends and can't be resumed.
- **The path being drawn never enters the document.** The pen keeps a draft (nodes, the path's own
  matrix, the layer a new path will land in) and shows it in the overlay; the document is touched
  once, on finish. This is what keeps a one- or two-node-short draft out of the file and gives a
  whole stroke a single undo step. It also means the pen's `cancel()` keeps the draft instead of
  rolling it back, unlike every other tool: a lost press (palm, pointer capture) should not cost a
  half-drawn path, so only Escape, a finish or a tool change ends a stroke.
- A blocked current layer (hidden or locked) refuses the first press of a stroke with the same
  message the other draw tools use; a stroke already running is unaffected by a later layer change,
  since it commits against the document as it is at finish time.
- Two pure edits in `src/doc/path-edit.ts`: `appendNode` (refuses a closed subpath or an unknown
  index) and `reverseSubpath` (swaps each node's handles and order; applying it twice is the
  identity). `mergeCoincident` (`src/geom/shapes.ts`) moved from exact float equality to the same
  1e-6 tolerance as the writer's rounding, so a pen-drawn path that's later converted to a shape
  doesn't fail to merge a coincident corner; `rectPath`'s existing half-side-radius merge is
  unchanged.
- `Tool` gained three optional hooks: `keydown(ctx, "escape" | "enter" | "backspace")` (true if the
  tool consumed the key), `busy()` (a draft or gesture is in progress), and `hover(ctx, e)` (pointer
  movement with no button down). `runEditAction` asks the active tool for `clear`/`commit`/`delete`
  before its own handling; `Canvas.svelte` calls `hover` from the pointer tracking it already had,
  but only when no gesture is running. Only the pen implements any of the three — `hover` is what
  drives the rubber band between clicks.
- Not in the spec, added during review: the double-click that finishes a path also requires the
  second press to land within pointer tolerance of the first, not merely inside the double-click
  timing window. Without that check, placing nodes quickly could end a stroke by accident.
- Plan: `docs/superpowers/plans/2026-09-18-m4b-pen-tool.md`.
- Browser-verified (controller, Chrome, port 5198, fresh 400×300 document): a three-click straight
  path finishing with Enter (3 nodes, one undo step, `prefs.style`, selected); click-drag curves
  with exactly mirrored handles; the dashed rubber band following the pointer between clicks;
  closing by clicking the first node (3 nodes, no repeated node); finishing with Enter and with a
  double-click; Backspace taking a draft from 3 knobs to 2 without touching the document; Escape
  leaving the document at the same reference; Shift holding a point on the previous node's axis; a
  press 2 units from another path's node snapping exactly onto it; both blocked-layer messages
  verbatim with nothing drawn; resuming from the last node (same shape id, one undo step) and from
  the first node (the draft comes back reversed) and closing by clicking the far end; a serialize +
  re-parse round-trip with `dropped: []` and every node count and closed flag unchanged; the Node
  tool editing a pen-drawn path; and no console errors, including after a reload. Alt was verified
  through the on-screen modifier dock (the iPad path), which drives the same `mods.alt`: with Alt
  latched, a click-drag produced a corner node with only `out` set.
- Owed: Alt from a physical keyboard — the desktop automation delivers `altKey: false` on pointer
  events, so the desktop Alt-break is unverified (Alt via the on-screen dock is verified, above).
  The whole iPad pass (touch and Apple Pencil, palm rejection during a stroke), Safari and Firefox,
  and the still-parked items: snap guides are not drawn while a draft exists (the overlay has one
  slot), a path inside a group contributes no snap targets, hit-testing flattens at document scale,
  and `movePathNodes` can still drag a node onto its subpath's first node.

### 2026-09-18 — Milestone 4b review fixes

Nine findings from the whole-branch review, each pinned by a test that fails without its fix
(`src/__tests__/pen-tool.test.ts`, `src/__tests__/node-store.test.ts`; 446 tests in 34 files).

- `finish` resolves the layer against the document it is about to write: the id captured at the
  first press can be a layer the user has since deleted, and `addShape` throws for an unknown one.
  It falls back to `ctx.currentLayerId()` and drops the drawing if neither exists — the throw
  escaped the window keydown handler, and through `registerToolFinish` it also made a tool click
  look dead.
- `Tool` gained `discard(ctx)`: drop the draft, commit nothing, clear the overlay. The store owns
  the hook (`registerToolDiscard`, registered in `tools/context.ts` beside `registerToolFinish`) and
  calls it from `replaceDocument`, `undo` and `redo` — the three paths that throw away the document
  a draft was built on. `cancelActiveGesture()` deliberately still doesn't reach a draft: a draft is
  not a registered gesture.
- The close test now runs against the placed point as well as the raw pointer. The close tolerance
  is 6px for a mouse but `SNAP_PX` is 8, so a press in that band placed a copy of the first node —
  the closed-subpath-repeating-its-first-node shape the M4b constraint forbids, which loses a node
  on reload. A press whose placed point lands on the previous node (within `mergeCoincident`'s 1e-6)
  is now ignored, since it could only make a zero-length segment.
- A resumed draft no longer carries the original nodes into the commit. It records how many nodes it
  copied and whether it reversed them; at commit it re-reads the path, reverses the *current*
  subpath if needed, and appends only this stroke's nodes (`appendNode`, which until now had no
  production caller). An edit made to that subpath while the draft is open survives.
- `runEditAction` returns whether it consumed the action, and `App.svelte` only calls
  `preventDefault()` when it did. Enter was cancelled app-wide, so no focused button — tool strip,
  top bar, layers panel, notices — could be activated from the keyboard.
- The pen passes Shift's implied `axes` into `snapPoint`, as the node and select tools do, so a snap
  target near the locked-out axis can't pull a point off the 45° ray it just drew.
- The draft's outline is flattened at world × zoom scale, like the node overlay, instead of document
  scale: a curve drawn zoomed in no longer looks polygonal while it is being drawn.
- The first knob fills only while a press would close the path (spec §7). The pen carries
  `closeHint` in the `pen` overlay variant; it was unconditionally filled before, so the close
  affordance signalled nothing.
- Backspace stops at the resume boundary: it removes the last node *you placed* and does nothing
  once there is none, instead of eating the resumed path's own nodes.
- Tests the review found missing: the pen drawing into a non-default `currentLayerId`; `resumeAt`
  for a path nested in a group (its world matrix comes through the parent) and for a path whose
  world matrix is singular (skipped, never thrown).
- Correction to this milestone's entry above and to CLAUDE.md invariant 34: `hover` is not "pointer
  movement with no button down". `Canvas.svelte` calls it on every pointer move while no gesture is
  running, which includes a held right-button drag and a pointer the router ignored.
- An undo with nothing to undo keeps the draft. The discard hook above ran before the undo was
  known to be possible, so ⌘Z on an empty history threw away a stroke in progress and changed
  nothing else.
- Browser-verified (controller, Chrome, port 5198) — the four of these that are not unit-testable:
  deleting the draft's layer mid-stroke then pressing Enter (no throw; the path lands in the
  surviving current layer); ⌘Z with a draft open (the draft is discarded, the previous commit is
  undone, a following Enter creates nothing); Enter activating a focused tool-strip button; and
  `closeHint` false away from the start, true on it, with the first knob filled only then. No
  console errors.
- Owed: still the iPad pass, Safari and Firefox, and Alt from a physical keyboard (the desktop
  automation delivers `altKey: false`; Alt through the on-screen dock is verified).

## 2026-09-18 — Milestone 5: iPad polish and deploy

- Palm-before-Pencil routing (`input/route.ts`): a Pencil down over one or more resting fingers now
  takes over the gesture instead of being ignored (`activePointers === activeTouches`, pen only — a
  second pen or a mouse is never overridden), falling through to the ordinary rules so the Hand
  tool and a held Space still pan with a Pencil. A finger arriving mid-stroke was already rejected,
  but only because the counting happened to make `activeTouches` 0; `RouteInput` gains `penActive`,
  and a touch is now ignored outright whenever a pen or mouse gesture is running, stating the palm
  rejection outright instead of leaving it to emerge from the counting. `Canvas.svelte` ends a
  running pan/pinch before starting the Pencil's gesture (a view-only change, nothing to roll back)
  and drops the superseded fingers from its own pointer bookkeeping — without that they kept
  counting toward `activeTouches` and their coordinates froze when the Pencil lifted, so the next
  finger re-anchored a pinch on a stale point and the view jumped (commit 09fac59).
- A small-object handle policy (`tools/gizmo.ts`): an axis whose on-screen span is under
  `3 * (size / 2 + 2)` — three reaches, the smallest span that leaves a reach-wide gap between
  opposite handles — is expanded to that minimum, symmetrically, in `handlePositions`;
  `frameOutline` still asks for the unpadded positions, so the drawn frame keeps showing the true
  geometry. Only a non-zero axis is expanded: a zero-size axis keeps its handles coincident, which
  is what leaves a horizontal or vertical line draggable by its middle. Drawing and hit-testing read
  the same padded positions, so they can't disagree, and the resize maths need no change:
  `handleFramePoint` keeps receiving the unpadded `frame.box`, so `select.ts`'s `grab` is the true
  handle point minus the press point, and that offset is what carries a press on a pushed-out
  handle back to the true corner. Padding the box there would zero the offset instead and snap the
  true corner to the finger.
- The modifier dock and the notices move to `right-63` (the drawer's 240px plus the usual gutter)
  whenever the Properties/Layers drawer is open below the 900px breakpoint, instead of sitting
  under it — at iPad-portrait widths an open drawer used to hide the Shift and Alt latches
  completely, and notices painted on top of the drawer. `ModifierDock.svelte`'s Snap toggle gets the
  same `touch-action: none` as its neighbours, so a touch beginning on it can no longer be claimed
  as a scroll or a double-tap zoom.
- A late fix on top of that: notices and the dock shared the same bottom-right corner, and at
  `bottom-10` a notice's lower edge sat inside the dock's band, over the Shift and Alt latches — a
  parked M5 item the plan had not picked up, caught by the browser pass at 768px. `bottom-10` →
  `bottom-25`, measured against the dock's real geometry (commit ae34e3c).
- Discoverability by touch: a non-mouse pointer-down now sets the status bar hint from the pressed
  control's `title`, through the same `app.hoverHint` channel a mouse hover uses (`lib/hover-hint.ts`,
  `App.svelte`'s `onpointerdown`). iPadOS shows no tooltip for `title` at all, so without this an
  icon-only top bar explained nothing, and an `aria-disabled` button's reason ("Cut — nothing
  selected") was unreachable. A mouse still clears the hint on press, since hover sets it again; the
  hint costs no long-press timer and no new surface.
- Deploy preparation: `public/manifest.webmanifest` (name, icons, `display: standalone`),
  `public/apple-touch-icon.png` (180×180, rendered on the app's `#1e1e22` background since iOS does
  not composite transparency), and `public/_headers` — immutable `Cache-Control` for `/assets/*`
  (Vite fingerprints those filenames) plus a Content-Security-Policy on every path. The CSP's
  `style-src` needs `'unsafe-inline'`: the overlay and `svg/attrs.ts` set `style` attributes on
  every rendered element, which CSP counts as inline styles; scripts need no such exception.
- Considered and deliberately not adopted: `viewport-fit=cover` (spec §1 "Out"). Without it, iOS
  insets the visual viewport itself, so no app chrome can land under the home indicator; adopting it
  would make the page edge-to-edge and *create* the padding problem this milestone has no device to
  verify a fix for.
- Plan: `docs/superpowers/plans/2026-09-18-m5-ipad-polish-deploy.md`. 459 tests in 34 files.
- Browser-verified (controller, desktop Chrome, port 5198, synthetic pointer events — not a
  device): a Pencil superseding a resting finger's in-progress gesture and drawing; a second finger
  arriving mid-stroke changing nothing; both leftover fingers drifting after the Pencil lifted
  moving nothing at all; an 11px-wide rect at 12% zoom drawing its handles outside itself; at a real
  `innerWidth` of 768, the drawer open with the dock computing `right: 220.5px` and its right edge
  clear of the drawer, and a notice stacking above the dock with a gap; a touch press putting
  "Undo (⌘Z)" in the status bar and "Redo — nothing to redo" for a disabled control, a canvas touch
  clearing it, a mouse press still clearing it; and the built app served behind the real `_headers`
  with styled shapes, restored autosave, manifest and icon fetching 200, a creatable blob URL and no
  CSP violations. No console errors.
- Owed: the entire iPad pass on real hardware — Pencil drawing, palm rejection with a real hand,
  pinch and two-finger pan, the dock under a held finger, the drawer at real portrait and landscape
  widths, touch hints on a device, and the installed standalone app. Also Safari and Firefox; Alt
  from a physical keyboard (the automation delivers `altKey: false`, so it is verified only through
  the on-screen dock); and the deploy itself, which the user runs — `npm run deploy` was
  deliberately not run. Also: the save fallback (`URL.createObjectURL` → `a[download]` in
  `persist/file-io.ts`) under the real CSP — that is the path iPad Safari and Firefox take, while
  the CSP was exercised only in desktop Chrome, which uses File System Access instead. And one
  explicit question for the iPad pass: **after a Pencil stroke over a resting hand, does the view
  zoom when the hand moves?** `Canvas.svelte`'s Safari `gesturechange` guard is
  `if (pointers.size > 0) return;`, and the takeover deliberately untracks the resting fingers — so
  once the Pencil lifts, `pointers.size` is 0 while fingers are still on the glass, and iOS
  Safari's `gesturechange` from them could zoom the view. Strictly pre-existing, but the palm-first
  sequence makes it common rather than exotic.

## 2026-09-18 — Milestone 5 review fixes

- The touch hint was erased the instant the finger lifted, so §5 did not work on a device at all.
  `App.svelte`'s pre-existing `onpointerout` cleared `app.hoverHint` whenever `relatedTarget` was
  null; that handler was inert for touch only while `hintFrom` filtered non-mouse pointers out, and
  M5 removed the filter. For a direct pointer (touch, and pen on iPad) the browser fires
  `pointerout` with a null `relatedTarget` immediately after `pointerup` — the pointer has ceased
  to exist — and it bubbles to the `<svelte:window>` listener, so a tap set the hint and cleared it
  a moment later. The clear is now `e.pointerType === "mouse" && !e.relatedTarget`: a mouse leaving
  the window still clears, while a touch or pen hint stands until the next press replaces it, which
  is what spec §5 and invariant 24 say. The consequence is accepted: a hovering Pencil lifted off
  the glass leaves its last hint standing, the same rule as touch. The M5 browser pass missed this
  because synthetic `PointerEvent`s generate no follow-up `pointerout`.
- The Pencil takeover's pointer-forgetting was gated on `gesture`, which left the stale-pinch jump
  reachable: `gesture` can be null while `pointers` is still populated — a finger starts a tool
  drag, the user taps Undo, `cancelActiveGesture()` runs the hook registered in `onpointerdown` and
  sets `gesture = null` while the finger stays tracked. The guard is now
  `pointers.size > 0 && route !== "pinch"`, which states the takeover condition directly (the new
  pointer is not tracked yet at that line, and routing only lets a pointer through with others
  already down via the takeover).
- The root cause of the same jump, fixed alongside it: `onpointermove` returned before its trailing
  `pointers.set` whenever no gesture was running, so a tracked pointer's coordinates froze. The
  write is hoisted above the early return, so a tracked pointer stays current with no gesture at
  all (finger drags → Undo tap → finger drifts → second finger lands → pinch off a stale anchor, no
  Pencil involved). `prev` is still read before the write, so the pinch and pan maths are unchanged.
- Notices covered the docked Properties/Layers column at 900px and up — the sibling of the defect
  the browser pass caught at narrow widths. They are `fixed` to the viewport, while the dock is
  `absolute` inside `<main>` and so already narrowed by the in-flow column. Notices now sit at
  `right-63` at 900px and up always, and below 900px only while the drawer is open. The dock is
  unchanged.
- `Notices.svelte`'s comment had the right value but the wrong arithmetic: status bar 28px + its
  1px border = 29, the dock's `bottom-3` = 12 → the dock's bottom edge at 41px, its 50px height →
  its top edge at 91px, so `bottom-25` (100px) leaves a 9px gap, which is what the browser
  measured. The comment said 96 and 4.
- CLAUDE.md invariant 14 and the M5 entry above described `select.ts`'s `grab` offset backwards —
  both said it is computed from the handle's own (possibly padded) position. It is computed from
  the **unpadded** `frame.box`, and that difference is precisely what carries a press on a
  pushed-out handle back to the true corner; padding the box there would zero the offset and snap
  the corner to the finger. Both are reworded, and the milestone's riskiest maths finally has the
  test it lacked: a 4×4 shape pressed at its pushed-out `se` handle resizes from the true corner
  (`select-tool.test.ts`). It was confirmed to fail when the box is padded in the `grab`
  computation.
- CLAUDE.md invariant 35 spells out the caching trap: nothing may be hand-placed under
  `public/assets/`, because it would land in `dist/assets/` unhashed and the immutable year-long
  `Cache-Control` would pin it in browser caches with no way to bust it. README gained the two
  user-visible M5 changes it was missing (the touch press showing a control's hint, and resize
  handles moving outside a too-small object).
- 460 tests in 34 files. No device verification: nothing here has been on an iPad, and the two new
  owed items are recorded on the milestone entry's `Owed:` line above.

## 2026-09-19 — Milestone 6: selection conveniences

- Select All (⌘A) and Invert Selection (⇧⌘A). ⌘A was unclaimed before this milestone, so it fell
  through to the browser and selected the app's own interface text; text fields keep the browser's
  native ⌘A through `App.svelte`'s existing editable-target guard.
- Select Same Fill Colour, Same Stroke Colour, Same Style and Same Kind, each reading the current
  selection and extending it: Fill and Stroke compare `style.fill`/`style.stroke`, Style compares
  every field of `Style` (both paints, `strokeWidth`, `cap`, `join`, `opacity`), Kind compares
  `node.kind`. Paints compare exactly — `{ color, opacity }` field for field, no tolerance — and
  `null` (no paint) matches only `null`. Several selected shapes union rather than intersect: an
  orange shape and a blue shape selected together find every orange *and* every blue shape, not
  their overlap. A seed always matches itself, so a Select Same command never shrinks the
  selection. A group has no `Style`, so it is skipped by the three paint-based commands as both
  seed and candidate, and a selection of only groups disables them; Same Kind still matches groups.
- All six commands share one reach: `selectableIds(doc, enteredGroupId)` (`src/doc/tree.ts`) —
  visible, unlocked top-level layers, or an entered group's children. That function was already
  specified and tested but had no production caller; `hitTest` and `marqueeSelect` re-implement
  its rule inline instead, which is how the two could drift apart. This milestone's pure matching
  (`src/doc/select-match.ts`: `allIds`, `invertIds`, `sameIds`) calls it directly, so a hidden or
  locked layer is never selected into, a shape inside a group is never matched from outside it, and
  Select All inside a group selects that group's children, matching what entering a group already
  implies elsewhere.
- A **Select** menu in the top bar, beside File: Select All, Invert Selection, then the four Same
  commands. A command that does not apply is shown disabled with a reason (`"Same Fill Colour —
  nothing selected"`, `"— a group has no fill"`), never hidden, per invariant 24 — a hidden entry
  would move the bar. `.menu-item` in `src/app.css` gained `aria-disabled` styling, which it had
  none of before, so a disabled entry now actually looks disabled.
- The same section in the context menu — the **mouse** route, not the iPad one: `Canvas.svelte`
  opens that menu only when `app.lastPointerType === "mouse"` and nothing handles a long-press, so
  on a device the Select menu is the only way to these commands. Select All and Invert Selection
  always (Select All only while something is in reach), the four Same commands only when they apply
  — the
  context menu hides an inapplicable entry instead of disabling it, matching its existing pattern
  for Ungroup, Convert and Flatten.
- A tripwire test (`src/__tests__/select-match.test.ts`) asserts `Style`'s key set directly,
  because `sameStyle` enumerates its fields by hand and TypeScript has no way to flag it falling
  behind a new field.
- Plan: `docs/superpowers/plans/2026-09-19-m6-selection-conveniences.md`. 481 tests in 35 files.
- Browser-verified (controller, desktop Chrome, port 5198): Select All returning top-level ids only
  with a group counted once and a hidden layer excluded; Invert Selection; Same Fill finding an
  orange rect and an orange ellipse across kinds while skipping both the grouped orange rect and
  the hidden layer's shape; Same Kind skipping the grouped rect; every command staying inside an
  entered group; ⌘A and ⇧⌘A with the browser's own select-all suppressed; ⌘A inside a number field
  still selecting that field's text; the Select menu's disabled reasons in both states, a disabled
  entry doing nothing while the menu stays open, and an enabled one running and closing it; the
  context menu's section and Same Fill from it. No console errors.
- A group contributes no matches to the three paint commands and is never returned as one, but a
  selected group is kept — as is any seed out of reach, since the layers panel can select a row at
  any depth while `enteredGroupId` points elsewhere. Without that, a Select Same matching nothing
  cleared the whole selection with no message. Select All is disabled with "— nothing to select"
  when every layer is hidden or locked.
- Owed: the iPad pass owed since M5 now also covers the Select menu's hit targets at portrait
  widths. Not the context menu: it is mouse-only, so there is nothing to check there on a device. Also unchanged
  from before: neither top-bar menu closes on Escape, which belongs with the parked accessibility
  milestone that already owes menu keyboard navigation.
