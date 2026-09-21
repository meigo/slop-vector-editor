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

## 2026-09-19 — Milestone 7: boolean operations

- Unite, Subtract, Intersect and Exclude, on two or more selected shapes. Unite keeps the union of
  every shape, Intersect the area they all share, Exclude the area covered by an odd number of
  them — all three take the **frontmost** selected shape's style. Subtract removes every shape in
  front of the backmost one from it (Illustrator's Minus Front, Figma's Subtract: what's on top
  cuts what's underneath) and keeps the **backmost** shape's style instead — the front shape is the
  knife, none of its area survives, so painting the remainder in its colour would be wrong. Every
  operation commits once: the result replaces its inputs, takes the frontmost input's place, layer,
  group and id, and one undo restores the originals.
- Rect, ellipse and polygon operands convert to paths first, through the existing Convert to path,
  as part of the same commit, so the commands work on the shapes people actually draw. A group or
  an open path can't take part and refuses with its own reason (`Unite — a group can't take part`,
  `Unite — an open path can't take part`, `Unite — select two or more shapes`); `booleanRefusal`
  (`src/doc/boolean-edit.ts`) is the one predicate the Path menu, the icons and the context menu all
  read, so they can't disagree about what applies. An operation that leaves no area — intersecting
  shapes that don't overlap, subtracting a shape that covers everything — does not write an empty
  path (the importer would drop it): the document is left at the same reference and a notice says
  so, e.g. `Intersect left nothing.`
- Each input's subpaths are mapped through its own world matrix into **document space** before the
  operation, so shapes with different transforms combine correctly; the result is mapped back into
  the **frontmost input's parent space** and stored with an identity transform — the same rule the
  pen uses when it commits a new path.
- The geometry runs through Paper.js (`paper/dist/paper-core`, core only, no PaperScript), isolated
  behind `src/geom/boolean.ts` — nothing else imports it. The conversion between our path model and
  Paper's round-trips the **geometry** exactly, both ways, including multi-subpath compound paths.
  Node **types** are not carried across — Paper has no equivalent and is never told — but re-derived
  from the handles that come back (no handles is a corner, mirrored handles are symmetric, anything
  else smooth), so a corner node carrying two handles that don't mirror comes back as smooth. That
  is close to but not the same as the importer's rule, which never says symmetric. Paper runs headless
  (`paper.setup(new paper.Size(1, 1))`), so the conversion and the four operations are unit-tested
  in the ordinary Vitest/Node environment, the same as any other pure module. It is loaded on first
  use, not at startup: bundled at load time it would double the initial download for a feature most
  sessions never touch, so `booleanOf` does a dynamic `import()` and Vite emits it as its own chunk.
  Measured: the app's own chunk went from 69.18 to 71.95 KB gzipped; paper's own chunk is 72.39 KB,
  fetched the first time someone runs an operation. The refusal rules the menus read stay pure and
  synchronous, so no menu ever waits on that download — only the operation itself, and the store
  action, are async.
- A **Path** menu in the top bar, beside Select, holding all four commands — the always-present
  route, reachable by touch at any width. The same four also appear as icons beside Group/Ungroup
  at 900px and up, the Properties drawer's existing breakpoint: the bar already holds 18 icon
  buttons and two menus, and four more icons at every width would force it to wrap or scroll, which
  would clip the File menu (invariant 24). The icons are a one-click shortcut for the desktop case
  that has room; the menu is what keeps every command reachable at every width, so hiding the icons
  below the breakpoint is not the state-dependent hiding invariant 24 forbids. The context menu
  carries the same four commands, hidden (not disabled) when they don't apply, matching M6's
  pattern for Ungroup/Convert/Flatten.
- Two defects the review found before this branch merged: every path handed to Paper was attached
  to Paper's own project and never removed, so it grew by three items per operation and held every
  intermediate path for the life of the page — fixed by creating every Paper item with
  `insert: false`. And the store action committed a result computed before an `await`, so an undo,
  a delete, or a finished drag during Paper's first-download wait would have been silently
  overwritten with a document that never saw it; `booleanSelection` now captures the document
  beforehand and refuses to commit if it moved, with its own notice (e.g. `"Unite — the document
  changed while it loaded; try again."`).
- Seven more the whole-branch review found, all in the same area — the operation is async and it
  fetches from the network, and neither was fully paid for:
  - **A failed load was swallowed.** Nothing caught it: no notice, no status-bar text, four buttons
    that looked enabled and did nothing. The realistic cause is not Paper throwing but the fetch —
    a dropped connection, or a tab from before a deploy asking for its own build's chunk, which the
    Worker no longer serves. `booleanSelection` now catches, leaves the document alone and raises an
    **error** notice (an info would fade): `"Unite — the operation could not run. Check your
    connection, then reload the page."` — a reload, because the browser records a failed module fetch
    and replays it for every later import of the same chunk, so "try again" would not work
  - **The loader is await-safe and retryable.** It caches the promise, not the module — the old
    guard ran before the await, so three overlapping first calls each ran `setup()` and left two
    spare projects behind — and clears it on rejection, so the retry the notice asks for really
    does not itself replay the failure — though the browser's own module map still does, which is
    why the notice asks for a reload.
  - **Two quick clicks** used to make the second report `"the document changed while it loaded"`
    about the first one's commit. One operation runs at a time; a second is ignored.
  - **Clicking another shape during the wait** no longer has its selection stolen: the operation
    still commits (it was asked for), but the result takes the selection only if the selection
    hasn't moved.
  - **One id twice** (`["a", "a"]`) passed the "fewer than two" test, wrote the result to that node
    and then deleted it as one of the other inputs — an empty layer reported as success. Both
    `booleanRefusal` and `booleanShapes` de-duplicate now. Not reachable through the UI, where every
    writer of the selection goes through `pruneSelection`.
  - **A renamed shape kept its name.** The result is the frontmost input in place, so it carries
    that shape's `name` across; a "Logo" rect united with something read as "Path" before, in the
    panel and in the saved file.
  - A comment in `boolean-edit.ts` claimed the operands were sorted front to back. They aren't —
    only the two extremes are picked out, and the array stays in selection order.
- Plan: `docs/superpowers/plans/2026-09-19-m7-boolean-operations.md`. 503 tests in 39 files,
  including spec §7's failure path (the import forced to reject: document unchanged, one error
  notice), the two async-guard cases, and a multi-subpath operand going in as a `CompoundPath`.
- Browser-verified (controller, desktop Chrome, port 5198): paper absent from the resource list
  until the first operation and present immediately after; Subtract giving a two-subpath result in
  the back shape's colour that renders as a genuine hole; undo restoring both inputs as their
  original rects and redo re-applying; the holed result surviving a save and reload with nothing
  dropped; a rect and an ellipse united without converting either first, curves intact; the refusal
  and empty-result notices verbatim; the context menu's boolean section in place and vanishing when
  a group is selected. No console errors.
- Owed: the seven review fixes above are covered by unit tests only — none of them was re-checked in
  the browser, and the failed-load one cannot be without taking the network down. The icons' 900px
  breakpoint was checked through the compiled CSS and the wrapper's classes,
  not by resizing — the window would not resize this session. The iPad pass owed since M5 now also
  covers the Path menu and the icons' absence below 900px. Performance is unmeasured: Paper's
  boolean code is the heaviest geometry in the app, and a path with thousands of nodes has not been
  tried. Nothing here can be device-verified.

## 2026-09-19 — The root font-size, and the sizes that depended on it

- `src/app.css` set `font-size: 14px` on `html, body`. Tailwind's scale is in `rem` and `rem`
  resolves against the root, so **every rem-based size in the app rendered at 87.5%**: `text-xs`
  came out at 10.5px rather than 12, `h-8` controls at 28px rather than 32, the `h-11` top bar at
  38.5px, and the `w-60` sidebar at 210px rather than 240. Values written in absolute units —
  `text-[11px]` section headings, 1px borders and separators — were untouched, so the interface was
  not uniformly smaller; it was smaller only in its rem parts, which is why it read as an undersized
  font next to chrome that had not moved.
- The root now stays at the browser's 16px and body text is 14px, set on `body` alone. Every size
  returns to the number its class names always claimed. This also makes two existing documents true
  again: CLAUDE.md's "bar controls are 32px high" (they were 28) and the M5 spec's reasoning about a
  240px drawer (it was 210).
- No sibling slop app sets a root font-size: slop-animator, slop-audio-editor and
  slop-video-compositor leave it alone, slop-paint's 12px is on one input and slop-vectorizer's is
  on `body`, which does not affect `rem`. This app was the only one of the family rendering small.
- The top bar's fixed width grew with everything else — from about 680px to 776px below 900px,
  against a 768px iPad-portrait window. Its gaps and gutters tighten below that breakpoint
  (`gap-0.5`, `px-1`), which buys back ~58px and brings the requirement to 726px: 42px of room for
  the file name at 768px, 18px at 744px. Nothing is hidden to achieve it — the context menu, the
  only other route to most of these controls, is mouse-only.
- Browser-verified: root 16px and body 14px; `text-xs` 12px, `h-8` 32px, the bar 44px and the
  sidebar 240px; the bar does not overflow; notices still clear the modifier dock by 10px, so the
  M5 tuning survives and its comment's arithmetic is now accurate. No console errors.
- Owed: the 744px and 768px widths were computed from measured element widths, not seen — the
  window would not resize this session. The iPad pass owed since M5 now also covers the tightened
  bar at portrait widths.
- Follow-up, from a side-by-side with slop-animator: its menu triggers and menu items are `text-sm`
  (14px at a 16px root) while ours were `text-xs`, so the labels still read smaller even after the
  root fix. Both now match it. The top bar also carried `text-xs` on the header itself, which held
  the file name at 12px beside 14px menu labels — two sizes in one row, each centred by its own box,
  which is why the bar looked vertically misaligned. The header no longer sets a size: everything in
  it is 14px and the baselines agree to within 0.2px. Shortcut hints in menus stay 12px, because a
  hint should not compete with the command it belongs to.
- The wider labels cost the bar ~15px, so the menu triggers' gutters also tighten below 900px
  (`px-1`, `px-2` above). Measured requirement at narrow widths: 714px, leaving 54px for the file
  name at 768px and 30px at 744px.

## 2026-09-19 — The modifier dock collapses

- The on-canvas dock's **Shift and Alt latches** now hide behind a chevron. They exist for a device
  with no keyboard; on a desktop they are dead weight over the artwork. **Snap stays visible at every
  width** — it is a real setting, not a key substitute, and the dock is the only place its state
  shows, so hiding it would hide the setting.
- The state is a preference, `Prefs.dockExpanded`, and it is **`boolean | null`**. `null` is not a
  third mode: it means nobody has decided yet. While it is `null` the dock renders collapsed, and the
  first `touch` or `pen` pointer the app sees expands it once and writes `true` — a finger or a
  Pencil is the evidence that the latches are wanted. Once the value is a boolean it was a decision,
  by the user's chevron or by that first touch, and nothing overrides it again: an explicit collapse
  survives every later touch. `sanitizePrefs` keeps the three states distinct, so a stored `false`
  does not degrade into "ask again".
- Browser-verified (port 5198): default collapsed (`Snap`, `Show the Shift and Alt keys`, 94px wide);
  the chevron expands to 214px and stores `true`; collapsing stores `false`; a touch after an
  explicit collapse does **not** re-expand; from undecided, a mouse press changes nothing and stores
  nothing, while the first touch expands and stores `true`. Notices still clear the dock by 10px in
  both states. No console errors.
- Owed: the auto-expand has only been driven by synthetic pointer events here. A real first touch on
  a device is part of the iPad pass owed since M5 — and the M5 lesson applies, that a synthetic
  event can pass a check for the wrong reason.

## 2026-09-19 — Milestone 8: the sidebar split

- The Properties and Layers panels each gained a **40px raised header bar** (`bg-raised` on
  `bg-panel`) with a collapse chevron. The old boundary was `border-line` against `bg-panel` — one
  step apart in the palette — and both sections used `.section-title`, so the column read as one
  long scroll whose content was clipped mid-control with nothing to say it continued. A band of a
  different colour is a boundary; content scrolling under a solid bar reads as continuing.
- A **12px divider** between them drags the split, with the ratio persisted as `prefs.splitRatio`
  (default 0.55 — what the old `h-[45%]` gave). It is rendered only while both panels are open, and
  `pointercancel` keeps the position the drag reached, as a lift would.
- **The clamp counts whole panels, not bodies.** Flex distributes whole `<section>`s, headers
  included, so the first version — clamping the ratio against the column minus both headers — left
  the losing panel a 95px body instead of 120. The share the ratio divides is the column minus the
  strip, and the minimum is `MIN_PANEL_PX` (40 + 120). Measured after the fix: both clamps land on
  a 120px body exactly.
- **Properties collapses itself when nothing is selected**, a knowing exception to invariant 23: a
  panel whose entire content is the selection should not hold half the column while it has nothing
  to say. Clicking the header overrides it — that is how the new-shape defaults stay reachable —
  and the override is dropped wherever `app.selection` is assigned, the moment the selection's
  emptiness flips. It lives in the store, not the component, because `App.svelte` mounts the
  sidebar twice (the narrow-width drawer and the inline column) and the two must agree.
- The panels' prop is `expanded`, not `open`: `LayersPanel.svelte` already binds `open` per row for
  its own chevrons, and a same-named prop would be shadowed inside every row block.
- A collapsed panel's action buttons go with it — New layer on a folded-away list would add a layer
  with nothing to show for it.
- Two columns (layers left, properties right — the Figma/Sketch convention) were considered and
  rejected: they cost ~480px of a 768px iPad portrait window, so both would become drawers anyway.
- Spec: `docs/superpowers/specs/2026-09-19-m8-sidebar-split-design.md`.
  Plan: `docs/superpowers/plans/2026-09-19-m8-sidebar-split.md`.
- Browser-verified (port 5197, a document with eight shapes, a group and one layer): the raised
  headers separating the panels; the divider dragging both ways and stopping with a 120px body at
  each clamp; the ratio and the Layers collapse surviving a reload; both chevrons, including both
  panels collapsed; Properties collapsed with nothing selected and open after a click on a shape;
  the header opening the defaults with nothing selected and that choice surviving until a shape was
  selected; a collapse surviving a change from one shape to another (no flip); a collapsed Layers
  header carrying no action buttons; two sidebars mounted at once (drawer + column) agreeing. No
  console errors.
- Owed: the divider's feel under a finger and a Pencil — 12px is a judgement, not a measurement —
  joins the iPad pass owed since M5, with the header bars' 40px targets. The narrow-width drawer
  was exercised by mounting it, not by resizing the window, which this harness will not do.
  Keyboard resize of the divider is parked with the accessibility group.

## 2026-09-19 — Milestone 8 review fixes

A whole-branch review before the merge found six defects that the green suite and the happy-path
browser pass could not:

- **R1: `sanitizePrefs` rejected ratios `clampRatio` legitimately produces.** `num(v, 0.1, 0.9, …)`
  returns the fallback, not a clamp, and the geometry clamp is in pixels — on a column taller than
  ~1700px its low bound drops below 0.1. Dragging the divider to either extreme on a 4K or portrait
  display was therefore thrown away and reset to 0.55 on pointer-up. The sanitizer now only checks
  that the value is a finite fraction; the pixel minimum belongs to `clampRatio`, which is the
  function that knows the column's height.
- **R2: the drag stranded its state when the strip unmounted mid-drag.** The strip lives inside
  `{#if split}`, and Escape, undo or a delete flips the selection's emptiness and removes it. An
  unmounted element releases pointer capture silently and takes its listeners with it, so `drag`
  and `live` were never cleared: the divider became permanently undraggable, and once the strip
  remounted a **bare hover resized the panels** from the stale origin. Fixed with
  `onlostpointercapture`, a `live !== null` guard in `move`, and an `$effect` that ends the drag
  whenever `split` goes false — the unmount case capture events cannot rescue.
- **R3: two paths assigned `app.selection` directly** and so never cleared the override —
  `clearOrLeaveGroup` (which is Escape, the primary deselect) and `replaceDocument`. Both now sync,
  and `replaceDocument` resets `propsOverride` beside the other transient state it already reset.
- **R4: a transient empty selection inside one action cleared an override the user had just set.**
  Unite and Ungroup delete every selected id and select the replacement on the next statement, so
  per assignment that reads as a flip to empty and back, and Properties sprang open again. The sync
  is now deferred to a microtask and keeps only the first "was empty" of a tick, so an action is
  judged by its net effect.
- **R5: collapsing the Layers panel removed the only route to New layer and Delete layer** — they
  have no menu entry and no shortcut, and `layersOpen: false` persists across reload. Hiding a
  collapsed panel's actions was my own fix for a smaller problem and it was worse than the problem:
  invariant 24's exception is about width, not state. The buttons stay, and both open the panel so
  the result is visible.
- **R6: with Properties collapsed — the default state — the two stacked headers reinstated the very
  boundary this milestone removes.** `border-line` (#2e2e35) against `bg-raised` (#2d2d33) is one
  palette step. A panel header's rule is now `border-panel`: below an open panel it continues the
  body, and between two headers it is a real line.
- Nits also fixed: the ratio no longer falls back to an even split on the frame before the
  ResizeObserver measures (the effect takes one synchronous measurement first); `sharePx` is read
  live during a drag rather than frozen at pointer-down; `setPointerCapture` is wrapped in
  `try/catch` like `LayersPanel`'s row drag; the separator carries `aria-valuenow/min/max`; and the
  `grow: number | boolean` prop that duplicated a flex ternary in both panels is now one `flex`
  string computed in `Sidebar`.
- Browser-verified after the fixes (port 5197): the stranded-drag repro — a live drag (0.55 → 0.631)
  interrupted by Escape — leaves no resize on a bare hover and writes nothing; Escape after an
  explicit expand collapses Properties again; Unite no longer springs it open; a collapsed Layers
  header still carries both buttons and New layer opens the panel; the rule between two stacked
  headers is visible. No console errors.
- Owed: the stranded-drag check used **synthetic** pointer events, because the harness has no
  press-and-hold primitive — the M5 lesson applies, so a real press-hold-Escape-release on a device
  is on the iPad list. R1's repro needs a column taller than ~1700px, which was reasoned about and
  unit-tested, not seen.

## 2026-09-19 — A latched Shift no longer makes deselecting impossible

- Reported from use: "when shift is selected, unselecting not working". Reproduced — with the dock's
  Shift **latched**, a click on empty canvas did nothing, so the selection could not be cleared.
- Root cause: `select.ts` cleared the selection on a click that hit nothing only when Shift was off,
  and `Canvas.svelte` built `mods.shift` as `e.shiftKey || dock.shift`, so the tool could not tell a
  **held key** from a **latched button**. The guard is right for the key — Illustrator and Figma
  also keep the selection on a shift-click into empty space, because the user is mid-gesture and a
  miss should not wipe their work — and wrong for a latch, which stays on until tapped again.
  Escape still cleared, but Escape is a keyboard and the dock exists for devices without one: on an
  iPad with Shift latched there was **no way at all** to clear the selection.
- `Mods` now carries `shiftLatched`, set when the latch is the only reason Shift is on, and only
  the clear-on-empty branch reads it. Everything else, including the additive marquee, still reads
  `mods.shift` and treats the two alike. Shift-clicking a selected shape to remove it was never
  broken and is unchanged.
- **`Select ▸ Deselect`** (and the same entry in the context menu) fills the other half of the gap:
  the menu had Select All and Invert Selection but no Deselect, so there was no menu route to an
  empty selection on any device. It is disabled with "Deselect — nothing selected" when there is
  nothing to clear, and carries Esc as its shortcut hint.
- Browser-verified (port 5196): with Shift latched, two shapes added by tapping and then a tap on
  empty canvas clears the selection while the latch stays on; a **held** Shift on empty canvas still
  keeps the selection; Select ▸ Deselect clears and shows its reason when disabled. 521 tests,
  including a latched-Shift case in `select-tool.test.ts` covering add, toggle, marquee and clear.
  No console errors.
- Owed: verified with the extension's synthetic modifier on a mouse. A real Pencil or finger with
  the latch on is part of the iPad pass owed since M5.

## 2026-09-19 — Milestone 9: per-object visibility and lock

- Every shape and group now has its own **eye and lock**, beside the ones layer rows already had.
  A hidden or locked node cannot be clicked, dragged or marquee-selected and is pruned from the
  selection the moment it is hidden — Illustrator's rule, and the one a locked *layer* already
  followed here. Its row's own two buttons stay live while the row is greyed, because that row is
  the only way back.
- **The bigger half: the importer was silently destroying hidden content.** `parse.ts` returned
  null for any element with `display:none`. Measured on a five-element file before the fix:

  | In the file | Before | After |
  | --- | --- | --- |
  | a plain `<rect>` | kept | kept |
  | `display="none"` | **deleted** | kept, hidden |
  | `style="display:none"` | **deleted** | kept, hidden |
  | `visibility="hidden"` | kept, **made visible** | kept, hidden |
  | `<g display="none">…</g>` | **whole subtree deleted** | kept, group hidden, children intact |

  `dropped` reported none of it, so the notice that exists to say what an import lost said nothing.
  Open a file with a hidden layer of guides, save, and that work was gone — the loss invariant 10
  guards against, arriving during the parse instead of at save time.
- A `visibility="visible"` descendant under a hidden parent is something one flag per node cannot
  express, so it is **reported** as `nested visibility override` rather than changed silently.
- The flags are **optional** — `hidden?: true`, `locked?: true`, absent meaning normal — where
  `Layer` carries plain booleans. Three reasons: a document can hold thousands of nodes, 136 places
  in this repo build a node literal, and "not hidden" then has exactly one representation, so a
  no-op edit returns the same reference (invariant 1). Turning a flag off **deletes the key**, so
  hide-then-show saves byte-identically to never having touched it — there is a test for that.
- **The reach rule is no longer written three times.** `selectableIds`, `hitTest` and
  `marqueeSelect` now build on `enteredReach`/`topLevelReach` in `tree.ts`, so this milestone's new
  clause was added once. Invariant 36 is amended to match.
- **What the dry run caught, and it was load-bearing:** the first attempt gave all three functions
  one shared verdict, and two existing tests failed. `hitTest` deliberately searches **two tiers** —
  the entered group's children, then the top level — which is what lets a click on a sibling outside
  a group select it and a click on empty canvas leave the group. A single shared rule broke group
  navigation. `enteredReach` therefore returns **null**, not an empty list, when the group cannot be
  entered, so every caller falls through to the top level rather than the canvas going dead when the
  group you are inside gets hidden.
- One existing test asserted the old behaviour ("skips hidden … content") and was rewritten, since
  that behaviour was the bug.
- Spec: `docs/superpowers/specs/2026-09-19-m9-object-visibility-design.md`.
  Plan: `docs/superpowers/plans/2026-09-19-m9-object-visibility.md`.
- Browser-verified (port 5195): hiding a rect from its row removes it from the canvas, greys the
  row, sets the title `“Rectangle” is hidden` and clears the selection; clicking where it was hits
  nothing; the eye brings it back; locking greys the row and makes the shape unclickable while
  leaving it drawn; hiding a group hides both children and greys all three rows; one undo restores
  each; and after a reload through the SVG autosave a hidden child and a locked sibling inside a
  group both come back with their flags. 539 tests in 43 files. No console errors.
- Owed: two more 20px targets on every layer row, which is the part most likely to be wrong on a
  device — it joins the iPad pass owed since M5.

## 2026-09-19 — A light theme is no longer planned

- Dropped from the README's roadmap and from CLAUDE.md's "what comes next", at the user's request.
  The original design doc (`2026-09-16-slop-vector-editor-design.md` §10) still lists it: that file
  is dated and this changelog's convention is that later entries supersede earlier ones rather than
  the past being rewritten.
- The palette stays dark-only, as `app.css` already states.

## 2026-09-19 — Milestone 10a: titles

- A **Text tool** (T) places a title; you type it in the Properties panel, which now shows the Text
  section **first** — it was last, and in the browser it sat below the fold at exactly the moment
  you want to type. Font, size, letter-spacing and alignment; the string field takes focus when a
  title is placed, which on iPad is the difference between the keyboard appearing and hunting for
  a field.
- **A title is a path that remembers it was text** — `PathShape.text`, optional metadata, not a new
  node kind. The reason is measurable: 23 places in `src/` test `kind === "path"`, and all of them
  work on a title unchanged, as M11's warp will.
- **Four SIL OFL faces** ship (Anton, Bebas Neue, Archivo Black, Righteous), imported through Vite
  so they are content-hashed into `dist/assets/` and inherit the immutable caching rather than
  tripping invariant 35. Their `OFL.txt` files ship beside them and they are credited in the
  README, which the licence requires. `.ttf`, `.otf` and `.woff` can be added from a file.
- **A spike came first**, as M7's did, and three of its findings changed the design: opentype.js
  parses in Node (so the glyph pipeline is unit-testable at all); its outlines are **quadratic** and
  `parsePathData` already converts them exactly, so the pipeline needed **no new geometry code**;
  and it **refuses WOFF2**, which is the format people most often have, so that needed a real
  refusal rather than a stack trace. Measured: opentype is its own **67.69 KB gzipped** chunk.
- Refused rather than drawn wrongly: scripts needing shaping or RTL (Arabic, Hebrew, Devanagari,
  Thai…), and strings the chosen font has no glyphs for.

### What the dry run found, before any review

`opentype.js` ships **no types** and `@types/opentype.js` is for 1.x, describing an API the spike had
already disproved — so the types are hand-written for just what we call. `node:fs` needed
`@types/node`. `path-edit.ts` had **seven** return sites, not the one funnel the plan assumed. ESLint
caught a genuinely misleading character class in the script-detection regex. And the plan's
chunk-size bar was unmeasurable where it was written, because nothing imported the module yet.

Two real bugs it caught in the browser: a **bundled font isn't "loaded" until fetched**, so after a
reload every title came back read-only claiming a font that ships with the app "isn't loaded";
and a refused string stayed in the field while the canvas showed the real title.

### What the review found, and it was load-bearing

- **must-fix: `resize.ts` and `flattenTransform` kept `text`.** Both bake geometry into a path, and
  both spread `...s` straight past the metadata. Resize a title then type one character and it
  snapped back to its old size; flatten it then type and it **jumped to the artboard origin**. I had
  built a funnel in `path-edit.ts` for exactly this hazard and then missed the other two bake sites.
  Both now go through `withBakedSubpaths` in `document.ts`, and each has a regression test.
- **must-fix: the font list was not reactive.** `fontChoices()` reads plain `Map`s, so a `$derived`
  over it computed once — a font you had just added showed as "(not loaded)" until the panel
  happened to remount. `font.ts` stays rune-free (it is unit-tested in node); the store owns the
  counter and notifies it.
- **should-fix, all taken:** M7's four async rules were missing (re-entrancy guard, a second
  `cancelActiveGesture` after the await, re-checking the layer block, and notifying rather than
  failing silently) — the correct implementation was 400 lines up in the same file; the font
  `<select>` desynced on a refused change the way the string field already handled; a no-op edit
  (re-picking the current font, tapping the alignment already on) re-outlined and pushed an undo
  step; Size/Spacing/Align were live with a missing font and produced a notice telling the user to
  reload when nothing had been downloaded; `loadFont` did not share in-flight promises;
  `parseTextOpts` bounded nothing, so `size: 1e300` validated and would overflow the writer; and the
  panel read `meta` after an await that could destroy it.
- Also fixed: the text tool's inlined 4px drag threshold disagreed with the project's own
  `movedEnough` (2px) while claiming to be it; `parseOverrides` accepted `":r=5"` as index 0 because
  `Number("")` is 0; two dead exports went, which invariant 37 records as a real cost here.
- Browser-verified after the fixes (port 5193): placing focuses the field; adding a font from a
  `File` now appears in the list immediately and is selected. The resize-then-type sequence is
  covered by a direct unit test against `resizeNodes` — my browser attempt kept missing the handle,
  and the test exercises the same function the gizmo calls.
- **566 tests in 46 files.** Build 0 errors / 0 warnings, three chunks.
- Owed: the iPad pass now also covers the Text panel and the font picker. Per-character selection
  and the randomiser are **M10b**. Performance on a long string at a large size is unmeasured.

## 2026-09-19 — The colour swatch updates live

- Dragging in the colour picker now repaints the selection as you go, instead of only when the
  picker closes. `<input type="color">` fires `change` on commit and `input` continuously, so the
  swatch listens to `input`.
- **The whole drag is one undo step.** Naively switching to `input` would push an undo entry per
  colour, so ⌘Z would walk back through a hundred near-identical shades. The session already has
  the mechanism tools use for this — `beginGesture` records a base and suppresses history,
  `endGesture` records it once — so the drag is bracketed in `beginDocGesture`/`endDocGesture`.
- The bracket closes on `change`, on `blur` and on the component being destroyed. Dismissing the
  picker without altering the colour fires **no** `change`, and clearing the selection removes the
  field outright; either would otherwise leave the gesture open, which silently stops recording
  undo history for every later edit. That failure mode is the M8 stranded-drag bug in a new place,
  so it was guarded from the start rather than found later.
- `PaintField` stays presentational and never imports the store: it takes `onlivestart`/`onliveend`,
  which `PropertiesPanel` wires to the gesture actions.
- The hex field and opacity still commit on Enter/blur. A half-typed hex should not repaint the
  artwork, and opacity is a typed number with no drag to make live.
- Browser-verified (port 5192): six live colour changes repaint the shape as they arrive, one ⌘Z
  restores the original colour and a second removes the rectangle itself — so the drag left exactly
  one entry; and an abandoned drag (`input` then `blur`, no `change`) still closes its own step,
  proven by a later edit getting its own. No console errors.
- Owed: with a very large selection each live step re-styles every selected shape; unmeasured.

## 2026-09-19 — Milestone 10b: the randomiser

- A title's characters can now be jittered individually: **Rotation, Scale, Baseline and Skew**,
  each with its own amount, driven by a seed with a **Re-roll** button. This is the feature the
  request was actually about — "characters transforms can be randomized".
- `src/text/random.ts` is pure and integer-only. Three properties of the hash matter and each is
  tested: the **index goes into** the hash rather than being consumed in order, so inserting a
  letter at the front cannot reshuffle the ones after it; each property has **its own salt**, so
  rotation and scale are independent rather than one stream read twice; and everything is
  `Math.imul`/`>>> 0`, so a title looks **identical on every machine** — one that re-rolled itself
  because it was opened elsewhere would be a data bug, not a surprise.
- The jitter is baked into the outlines **about each character's own advance-box centre on the
  baseline** (invariant 40 — never carried as a matrix). About the origin, distant letters would
  swing out of the line. An identity transform is skipped rather than applied, so a title with no
  jitter stays byte-identical to M10a's — there is a test for that.
- Overrides layer on top, replacing **per property**, so a hand-tweaked letter survives a re-roll.
  Nothing writes them yet; that is M10c.
- The controls are `NumberField`s, not sliders. The spec sketched sliders, but this app has no range
  input anywhere and `NumberField` is already styled, already 32px for touch, and already guards a
  no-op change — which invariant 1 needs.

### The regression the dry run caught

**`newSeed()` returns a full 32-bit integer, and the M10a review had added a coordinate ceiling of
1e9 to every number in `data-sv-text-opts`.** So a re-rolled title validated fine in memory and then
came back from a reload as an **ordinary path with its text gone for good** — silent, permanent data
loss, on the milestone's headline action. The seed is an id, not a length: it is now checked as a
32-bit integer while sizes and amounts keep the coordinate ceiling. Two regression tests cover it,
one on `parseTextOpts` and one through the real serializer.

Also caught: a negative roll times an amount of zero is `-0`, which `===` calls `0` but `Object.is`
does not — so an "identity" transform passed the skip check and failed a deep comparison. Normalised
with `+ 0`. And a botched edit of mine rendered the whole Randomise block **twice**; the browser pass
found it immediately.

- Browser-verified (port 5191): setting Rotation 22 and Baseline 6 visibly jitters each character;
  Re-roll changes the seed, keeps the amounts and produces a different arrangement (two zoomed
  screenshots, clearly different); one undo restores the previous seed. **582 tests in 47 files.**
- Owed: the reload round-trip after the seed fix is covered by unit tests through the real
  serializer rather than in the browser — the extension stopped delivering clicks and keystrokes to
  the page part-way through the pass, and I stopped rather than keep guessing coordinates.
  Per-character selection and hand-tweaking are **M10c**; `overrides` already round-trips.

## 2026-09-19 — Milestone 10c: per-character tweaking

- Click a character of a title with the Text tool and it is selected and highlighted; drag it to
  move it; set its **rotation, scale, baseline and skew by hand**. Those values override the roll
  **for that letter only** and survive a re-roll of the rest, which was the point of the layering
  M10b built. Escape lets the character go before it clears anything else.
- `charQuads` shares `runLayout` with `outlineText`, so a character's hit box and its glyph cannot
  drift — if they did, clicking a letter would select a different one. There is a test asserting
  they agree.
- `charSel`/`charQuads` are store state like `nodeSel`: not saved, not undoable, cleared with the
  selection. The Overlay draws the highlight from them directly rather than taking the single
  `app.overlay` slot that the marquee, the guides and the pen already share.
- The quads are cached by an **`$effect.root` in the store**, not by an effect in `TextPanel` — M8
  put that panel behind `{#if expanded}`, so with Properties collapsed a panel-owned effect would
  have silently stopped character picking working.
- The panel shows **absolute values** for a character where the Randomise block shows **ranges**.
  `±12°` and `−12°` are different quantities and never share a field.
- **A note on how this was verified.** The Chrome extension stopped delivering pointer and keyboard
  events to the page part-way through the pass — confirmed by a capture-phase `pointerdown`
  listener recording nothing after a reported click, on two tabs. `javascript_tool` still worked,
  so the parts that needed checking were checked directly, and they are the right parts: what was
  unproven here was **reactivity, rendering and geometry**, not event delivery. Verified on port
  5189: `$effect.root` really does run at module scope (5 quads cached for "Title"); `pickCharacter`
  returns index 2 from that quad's centroid and clears on a miss; the highlight polygon renders and
  follows the character; the panel reads "Character 3" with Reset and absolute fields; an override
  of −35° survived both a title-wide amount change and a re-roll (screenshot: one letter steeply
  turned among mildly jittered neighbours); `nudgeCharacter` accumulates into `dx`/`dy`; Reset
  empties the override; Escape clears the character but keeps the title selected; and
  `1:r=22,s=1.4,dy=-9` survived a full reload. No console errors.
  **Not verified:** that a real pointer press on a glyph reaches the tool. That is the layer the
  extension broke, and it is covered by five unit tests driving the real tool through a fake
  context — click places a title, click inside an edited title picks a character, a drag nudges by
  the document delta, and a sub-threshold wobble counts as a click.
- 593 tests in 48 files. Build 0 errors / 0 warnings.

## 2026-09-19 — Dragging a character kept only a fraction of the motion

Found by re-running the browser pass M10c had been merged without — the gap I had flagged as
unverified. A real drag of a character moved it **7.5px when the pointer travelled ~37**. Three
independent faults, each fixed and unit-tested:

- **The offset was an increment.** Every `move` called `nudgeCharacter`, which re-outlines
  asynchronously, and `reshapeTitle`'s re-entrancy guard returned early for any call arriving while
  another was in flight — during a drag, most of them. Each dropped increment was lost for good.
  It is now `setCharOffset`, which is **absolute**: the tool reads the character's offset once when
  the drag begins and every call sends base + total travel, so a dropped call costs nothing.
- **The guard discarded the newest intent.** Dropping is right for "don't run two outlines at
  once" and wrong for "ignore what the user just asked for". `reshapeTitle` now **coalesces**: a
  request arriving mid-run is merged into a queue and applied after, newest wins. The one-at-a-time
  property the guard exists for is unchanged.
- **Nothing applied the final position.** The character landed wherever the last `pointermove`
  happened to be, and browsers coalesce moves — the last one can be well behind the release point.
  `up` now sets the offset from the release point, so where you drop it is where it goes,
  regardless of how the moves were delivered.

**Verification status, stated precisely.** The bug was reproduced with a real drag and measured.
The fixes are unit-tested — including one test asserting that a drag survives every intermediate
call being dropped. The corrected drag fidelity could **not** be re-measured: the Chrome extension's
drag synthesis became unreliable, and an instrumented run showed it delivering
`pointerdown: 0, pointermove: 3, pointerup: 0` — moves with no press and no release, so no drag ever
starts. Identical runs gave different results for that reason. I stopped rather than keep reading
noise as signal. The three fixes are each independently justified and make the outcome depend only
on the release point, which is robust to any pattern of move delivery; but "browser-verified" would
be the wrong words for the final behaviour, so they are not used.

594 tests in 48 files. Build 0 errors / 0 warnings.

## 2026-09-19 — The randomiser's field labels overlapped

- Reported from a screenshot: the Randomise fields rendered as "S°cale" and "Slp0xw" — one field's
  suffix drawn over the next field's label.
- Measured rather than guessed: the `grid grid-cols-2` gave each cell **104px** in the 215px-wide
  panel, while the four fields need **125, 114, 133 and 108**. All four overflowed. `NumberField`'s
  root is `shrink-0 whitespace-nowrap` with no overflow containment, so the excess spilled into the
  next column instead of being clipped or wrapped.
- Fixed by using `flex flex-wrap items-center gap-2` — which the Size/Spacing row and the Geometry
  section already use. Each field now takes its natural width and wraps. The fixed grid was the
  only place in the app that put a `NumberField` in a fixed-width cell; it was mine, from M10b.
- Both blocks had it: the title's Randomise fields and M10c's per-character fields.
- Verified in the browser: every field's `scrollWidth` now equals its rendered width, so nothing
  overflows, in both blocks. No console errors.

## 2026-09-19 — The align buttons said the opposite of what they do

- Reported as "they seem to have flipped sides". Measured: the behaviour is textbook-correct. With
  the anchor at 0, `left` lays the run out at 1…197, `center` at −99…97 and `right` at −199…−4 —
  the named edge is pinned to the anchor and the text grows away from it.
- So pressing **right** moves the text **left**, which is correct and reads as inverted, because the
  icons were arrows (`⇤ ⇔ ⇥`) and an arrow means "move this way". Swapped for Lucide's flush-line
  `TextAlignStart/Center/End`, which every text tool uses and which say "this edge is flush".
- The tooltips now say what the control does rather than naming it: "Left edge stays put as the
  text changes", "Stays centred as the text changes", "Right edge stays put as the text changes".
  The purpose is invisible until you edit a title — dragging is a one-off, but the next keystroke,
  font change or size change re-derives the outlines from the anchor, and alignment is what decides
  which edge holds still while that happens.
- Verified in the browser: three distinct flush-line icons, the active one on, the titles correct.
  No console errors.

## 2026-09-19 — Milestone 10d: multi-line titles

- Press Return in the title field and get a second line. A **Line height** control sits beside Size
  and Spacing, and the alignment buttons finally do the job their name and icons promise.
- **Why this reverses a decision.** M10 §9 excluded multi-line as "not serving titles". That
  stopped being true the moment the panel carried an alignment control: alignment describes how
  lines relate to each other, so with a single line all it could do was pin an edge to the anchor —
  real, but invisible until you edit. The spec's §9 is struck through and dated rather than
  rewritten, per this changelog's convention.
- **Block alignment needed no new arithmetic.** Applying the existing per-line rule to every line
  aligns the block on its own: with `left` every line starts at 0, with `center` every line is
  centred on 0, with `right` every line ends at 0. `layoutRun` is untouched.
- **The format change was the dangerous part.** `data-sv-text-opts` had exactly 8 fields and
  `parseTextOpts` demanded exactly 8; appending `lineHeight` would have turned **every title already
  saved — including the ones pushed an hour ago — into a plain path with its text gone**. It now
  accepts 8 or 9 and defaults the missing line height to 1.2. That is the same silent loss the seed
  ceiling caused in M10b, caught this time before writing the code rather than after.
- **Character indices stay indices into the raw string**, newlines included. `runLayout` skips the
  newlines — they have no glyph — but never renumbers what follows, so M10c's per-character
  overrides keep pointing at the characters they were made for. There is a test for exactly that.
- Caught on re-reading my own code: `centreOf` dropped the `size` multiplier while being made
  line-aware, which would have put the per-character rotation anchor in the wrong place at every
  size but 1.
- Browser-verified (port 5185): `"SLOP\nEDITOR"` renders on two baselines; left, centre and right
  each visibly rearrange the two lines (three zoomed screenshots); a real Return in the field
  inserts a break instead of committing; the text and its 9-field opts survive a reload; and a
  hand-written **8-field** file from before this change still opens as a title with its line height
  defaulted and nothing reported dropped. No console errors.
- 607 tests in 48 files. Build 0 errors / 0 warnings.

## 2026-09-20 — The properties panel is one grid

- Every labelled row in the properties panel — Text, Randomise/Character, Stroke, Shape, New
  polygons, Node, Geometry — now sits in a single `label | field | unit` grid (`.field-grid`,
  `.field-row`, `.field-full`, `.field-divider` in `app.css`), so all the inputs share one left and
  right edge. Previously each section laid itself out with `flex` or its own `grid`, and the fields
  came out ragged from section to section (user screenshot, 2026-09-20).
- `NumberField` is now three grid cells rather than a flex box, and always renders its label and
  suffix spans — an absent one still needs its cell. `TextPanel` renders `display: contents`, so its
  rows join the properties panel's grid rather than forming a second one.
- Sections are `contents` wrappers, not nested grids: a nested grid sizes its own label column and
  reintroduces exactly the raggedness this removes. The section heading carries the divider.
- Supersedes the M10c note that the randomiser fields must live in a `flex flex-wrap` row: that was
  a workaround for fixed `grid-cols-2` cells, and `minmax(0, 1fr)` solves it properly.
- Browser-verified (desktop Chrome, :5196): with a title and a rectangle selected, every labelled
  field in the panel reports the same left (1572) and right (1695) edge across all sections, and the
  panel does not scroll horizontally. Still owed: the iPad pass.
- Invariant 23 extended with the rule. Gates: 0 errors, 0 warnings; 607 tests in 48 files; lint clean.

## 2026-09-20 — The colour swatch is square

- `PaintField`'s colour input is `size-8 shrink-0` (32×32), not `h-8 w-10`. A flex item shrinks
  below its declared width, so in the 240px sidebar the paint row squeezed the swatch to a ~17px
  sliver while its height stayed at 32 — a tall rectangle where a square was intended (user
  screenshot, 2026-09-20). 32px is the app's bar-control size.
- Invariant 40's "`NumberField` never goes in a fixed-width cell / use `flex flex-wrap`" note is
  marked superseded by invariant 23's panel grid: `minmax(0, 1fr)` solves the overflow it described.
- Browser-verified (desktop Chrome, :5195): both swatches measure 32×32.

## 2026-09-20 — Tighter section dividers in the properties panel

- `.field-divider` is `border-t pt-2`, not `mt-1 border-t pt-3`. The grid's own `gap-y-2` already
  puts 8px above the rule, so the old values stacked 24px of dead space above every section
  heading — double what slop-video-compositor's Inspector uses for the same job.
- Measured (desktop Chrome, :5194) after the user observed the panel is taller than the
  compositor's: they share the heading token and the 8px row gap, and the height difference is
  almost entirely the **field height** — `h-8` (32px) here against the compositor's `h-6` (24px).
  That 32px is invariant 23's deliberate touch size and was left alone. The divider was the only
  part not justified by it, and tightening it saves 8px per section — 16px on a selected title,
  32px on a rectangle, against ~1060px of content. The perceived difference is the 32px controls.

## 2026-09-20 — M10e: panel density and a resizable sidebar

The user's report: the properties panel, and the text properties especially, take about 150% of
the available desktop height. Measured before: 1058px of content for a selected title.

- **Collapsible sections** (`lib/FieldSection.svelte`). Text, Randomise, Shape, New polygons, Node
  and Geometry each collapse; `randomise` is closed by default, since a title's text and size are
  why the panel is open and the four jitter amounts are ~160px of a set-once control. State is
  `prefs.closedSections` — the *closed* ids, so a section added later needs no migration.
  `FieldSection` renders no wrapper element, so its heading and rows stay in the panel's one grid.
  The randomiser's seed button moved out of the heading row: a heading is now a button, and a
  button inside a button is invalid HTML.
- **`--ctl-h`: 32px for touch, 24px for a mouse.** The media query is `any-pointer: coarse`, not
  `pointer: coarse`, so an iPad with a trackpad attached keeps the 32px targets that invariant 23
  exists to protect. `.field` and `.btn` follow it; `.icon-btn` deliberately does not.
- **A resizable sidebar** (`lib/panel-layout.ts`, `prefs.sidebarPx`), following the convention the
  five sibling slop apps already share — an 8px grip absolutely positioned over the panel's left
  border, `setPointerCapture`, `pointercancel` treated as `pointerup`, a pure clamp of
  `[200, half the viewport]` with the minimum winning, and one pref write per drag on release.
  Borrowed from slop-video-compositor alone: the grip is a real `<button>`, so Tab reaches it and
  Arrow/Shift-Arrow step it 8/24px. Default 240px, so nothing moves for anyone who never drags it.
- **Fixed while doing it:** the title `<textarea>` rendered one line, not two. `.field`'s fixed
  height applied to it, and the obvious `height: auto` was worse — as a grid item it then
  contributed a ~10px row while rendering 43px, overlapping the heading above and the font row
  below. It now states `height`/`min-height` in `--ctl-h` units.
- **Measured after** (desktop Chrome, :5193, same title): **720px**, down from 1058 — a 32% cut,
  and it now fits the window. Opening Randomise adds 160px. The `closedSections` pref round-trips
  (opening writes `[]`, closing writes `["randomise"]`). The grip drags 240 → 409px and persists.
- **Not done, and why:** pairing short fields two-per-row (Size+Spacing, X+Y, W+H, as Figma does)
  was the other ~200px. At 240px each half-row gets ~104px — the exact width that produced the
  "S°cale" overlap in M10c. It is safe only above ~340px, which the resizable sidebar now makes
  reachable, so it is a candidate for later, gated on width.
- 618 tests in 49 files (11 new, for `panel-layout.ts`). Gates: 0 errors, 0 warnings, lint clean.
- **Still owed: the whole iPad pass**, and it matters more than usual here — `any-pointer: coarse`
  deciding the control size, and the grip's `touch-none` drag, are both untested on a real device.

## 2026-09-20 — Units move inside the fields

- The panel grid is two columns (`label | field`), not three. A unit (`%`, `°`, `×`) is now
  absolutely positioned inside its own field, `pointer-events-none` so a click on it still lands in
  the input, with `pr-6` on the input keeping the digits clear.
- Why: the unit column ended every numeric row short of the panel's right edge while a full-width
  control — a button, a select, the align row — ran all the way to it. The two right edges read as
  a step (user report, 2026-09-20). One right edge now, for fields and buttons alike.
- The two empty `<span></span>` cells the Cap and Join selects carried to hold the unit column open
  are gone with it.
- Browser-verified (desktop Chrome, :5193): every labelled field and every full-width control in
  the panel shares right edge 1716.

## 2026-09-20 — Two fields per line on a wide panel

- The field grid becomes four columns — `label | field | label | field` — once the Properties
  panel is 320px or wider, through a **container query**, not a media query: the sidebar is now
  dragged to any width independently of the window, so only the panel's own width can answer.
  (The container measures the section's content box, so the `sidebarPx` pref must read 321: the
  column's 1px left border sits outside it.)
- No new markup. Grid auto-placement does the pairing, because a `.field-row` contributes exactly
  two items and everything else spans the full width — so parity is preserved and every label
  stays beside its own field. That invariant is now written down; it is what the removal of the
  selects' empty unit cells quietly depended on.
- Threshold measured, not guessed: at 320 each field gets ~88-95px, and a six-digit coordinate plus
  its inset unit needs ~82px at this type size. Verified at 321px with a rectangle selected —
  four columns, every label/field pair sharing a row, **no input clipped**, panel content 512 →
  414px. The default 240px sidebar is unaffected.
- First asked for at 400px, lowered to 320 on the user's request to switch at a narrower width.

## 2026-09-20 — The title field updates the canvas as you type

- `oninput` reshapes the title live; `blur` is the commit. Previously nothing happened until the
  field lost focus, which made typing a title a guessing game.
- The burst is **one undo step**, bracketed in a document gesture like `PaintField`'s picker drag.
- Live reshapes are **quiet**: no notices, and no snapping the field back. Both exist because the
  states a burst passes through — an empty field, a half-typed word the font lacks a glyph for —
  are ordinary, and reporting them per keystroke raised an error notice per keypress and yanked the
  caret back mid-word. The commit on blur is what reports and corrects.
- **The bug this exposed:** `reshapeTitle` returns immediately when a run is in flight, queueing the
  patch — so `await setTitleText(...)` on blur resolved *before* the typing had drained, and
  `endDocGesture` closed the bracket while the last keystrokes were still committing, outside it.
  `reshapeTitleDraining` now keeps the in-flight drain in `titleWork` and returns it to a caller
  that only queued, so awaiting it awaits the settle. This affected `setTitleFont` and `addFontFile`
  too, which awaited the same way.
- Browser-verified (desktop Chrome, :5191): typing shows on canvas per keystroke with the caret
  still in the field; console tracing confirmed all five commits of a five-letter burst ran with
  `gestureBase` set, followed by one close on blur; with focus on `BODY`, one undo took "ZEBRA"
  back to "HELL" in a single step.
- **Noted, not fixed:** Cmd+Z while the field has focus is the browser's *native* text-field undo —
  one typed chunk — which then flows through the live handler as an ordinary edit. That is standard
  behaviour for a text field. It cost three misleading "one character back" readings during
  development before it was identified.

## 2026-09-20 — Titles are named by their text in the Layers panel

- `rowLabel` labels a title with its own text. A title is a path carrying metadata (invariant 40),
  so it fell through to the path case and every title in the layers panel read "Path" (user report).
- One line only, whitespace collapsed, cut at 24 characters with an ellipsis. `rowLabel` also feeds
  tooltips, `aria-label`s and the node tool's refusal notice, and none of those truncate the way the
  row does in CSS. A whitespace-only title falls back to "Title"; an explicit name still wins.
- Browser-verified (desktop Chrome, :5190): a placed title's row reads "Title", and retyping it to
  "Hello World" renamed the row live. 620 tests in 49 files (2 new).

## 2026-09-20 — A title survives a uniform resize, and warns when it cannot

- Resizing a title used to always bake it into an ordinary path, losing editability. It now keeps
  its text through a **uniform** scale: `scaleTextMeta` scales `size`, `letterSpacing`,
  `amounts.offset` and each override's `dx`/`dy`, and nothing else — `lineHeight` is already a
  multiple of the size, and the rotate/scale/skew amounts are degrees and ratios, so scaling them
  would rotate and skew the characters as the title was resized.
- Why it works: glyph outlines scale linearly with size, so outlines scaled by `k` are exactly the
  outlines the font gives at `size * k`. The baked subpaths and the metadata therefore stay in
  agreement, and the next keystroke re-derives the same shape rather than snapping back — which is
  the M10a review failure that made resize drop `text` in the first place.
- A **non-uniform** resize still bakes and drops the text, and now says so. A flip counts as
  non-uniform here: it mirrors the outlines, and re-outlining at `|k|` comes back un-mirrored.
- **The warning matters more than expected.** `dragHandle` constrains proportions only while Shift
  is held, so a plain corner drag is non-uniform and costs the title its text; W and H in the
  geometry fields always do. This corrects a claim made while designing the change — that free
  corner drags are uniform — which was wrong, and had put the wrong advice in the notice text.
- `droppedTitle` compares the documents before and after rather than re-deriving the uniform test
  from the matrix: a second copy of that rule can drift from `bakeShape`, and this is quiet data
  loss where a drift would go unnoticed. The select tool warns once per drag, on pointer-up.
- The existing test asserting "a resize always drops the text" used a uniform scale, so it was
  rewritten to guard the same regression under the new rule — the outlines and the size agree —
  plus a new test for the non-uniform case.
- Browser-verified (desktop Chrome, :5189): a plain corner drag dropped the text and raised the
  notice; the same drag with the dock's Shift latch on kept the title and took `size` 96 → 240.35;
  re-typing afterwards **stayed at 240.35** instead of snapping back to 96. 625 tests in 49 files.

## 2026-09-20 — Tool icons and strip order

- The node tool uses `SplinePointer` and Convert to path uses `Waypoints`. They both used `Spline`,
  so "edit the nodes of this path" and "turn this shape into a path" were the same picture (user
  report). `Spline` is now unused and its import is gone.
- **Edit nodes moves to second in the tool strip, straight after Select.** Both are selection
  tools — one picks objects, the other picks the nodes inside one — and the shape and draw tools
  below are a different job. It previously sat between Text and Hand, at the far end from Select.
- Browser-verified (desktop Chrome, :5188): strip order is Select, Edit nodes, Rectangle, Ellipse,
  Line, Polygon / star, Pen, Text, Hand; both icons render and are distinct.

## 2026-09-20 — The boolean operations use Lucide's matched icon set

- Unite, Subtract, Intersect and Exclude now use `SquaresUnite`, `SquaresSubtract`,
  `SquaresIntersect` and `SquaresExclude` — a family Lucide draws to be read together, two
  overlapping squares with each operation's result filled in.
- They replaced `Combine`, `SquareMinus`, `Blend` and `SquareSlash`, assembled one at a time from
  unrelated icons, so four variants of one idea did not look like a set. Those four imports are
  gone with them.
- Browser-verified (desktop Chrome, :5187): all four render side by side in the top bar and read as
  one family. (The group appears at 900px and up — invariant 24's one width-dependent exception.)

## 2026-09-20 — Layer-aware icons for Bring forward and Send backward

- `LayersArrowUp` and `LayersArrowDown` replace the bare `ArrowUp`/`ArrowDown`. Those two sat
  between `BringToFront` and `SendToBack` as generic arrows that said "up" and "down" rather than
  "up the stack" — the only thing in the group not about stacking.
- The four now read as two pairs, which matches what they do: the outer two move all the way to
  front or back, the inner two move one step. `ArrowUp`/`ArrowDown` are unused and their imports
  are gone.
- Browser-verified (desktop Chrome, :5186): all four render in order and are distinguishable.

## 2026-09-20 — Ungroup gets its own icon

- `Ungroup` replaces `Split`, which read as "split a path" next to the Path menu's boolean
  operations rather than "take this group apart". Lucide ships `group`/`ungroup` as a pair — the
  same shapes bracketed, then released — so the two now read as one another's inverse.
- `Split` is unused and its import is gone.
- Browser-verified (desktop Chrome, :5185): Group and Ungroup render side by side as a pair.

## 2026-09-20 — Dividers between the top bar's edit groups

- Two `bar-sep`s added: **Delete | Group** and **Ungroup | Unite**. That run was eight icons with
  no internal divider — twice the length of any other group in the bar — and mixed three jobs:
  object lifecycle (Duplicate, Delete), grouping (Group, Ungroup) and boolean path operations.
- The Ungroup | Unite separator lives **inside** the `min-[900px]:contents` span, with the
  operations it introduces. Outside it, the bar would show two separators with nothing between them
  at the widths where the booleans are hidden.

### Found while measuring this: the top bar already overflows (NOT fixed)

Invariant 24 says the bar must never scroll or wrap. It does, and has been doing so before this
change. Measured in Chrome at :5184, with `--ctl-h` at its 24px desktop value:

| state | width the bar needs |
|---|---|
| booleans shown (≥900px) | **1134px** (1108px before these two dividers) |
| booleans hidden (<900px) | **977px** |

So the bar is clipped on the right below ~977px, and the 900px breakpoint at which the boolean
icons appear is ~234px too low — between 900 and 1134 they are shown but do not fit. At iPad
portrait (768px) the bar overflows by 209px, which is where the File menu's protection matters
least (it is leftmost) and the zoom and Properties controls are lost instead.

These two dividers add 26px to an existing 208px shortfall; they did not cause it. Fixing it is a
design decision about which controls to drop and at which widths, so it is left for the user.

## 2026-09-20 — An Object menu, so arrange can be hidden by width

- **New Object menu** carrying the four arrange commands with their shortcuts. They had no menu:
  outside the bar icons they existed only on ⌘]/⌘[ and in the right-click menu, and `route.ts:31`
  opens that for `pointerType === "mouse"` only — so on a touch device the four icons were the one
  route, and invariant 24 therefore forbade hiding them at any width. Now it doesn't.
- The menu and the icons render from **one `ARRANGE` list**, so the two cannot drift apart.
- **Breakpoints re-measured and corrected.** The menu costs ~71px, so the old numbers no longer fit:

  | shown | bar needs | appears at |
  |---|---|---|
  | booleans + arrange | 1205px | **1220px** (arrange) |
  | booleans only | 1048px | **1060px** (booleans) |
  | neither | 891px | — |

  The booleans' old 900px breakpoint was 148px below what the bar needed there, so they were shown
  at widths where they overflowed — the exception was silently undoing itself. Verified at each
  boundary (1220, 1219, 1060, 1059): the bar fits in every state.
- **Still not fixed:** below 891px the bar overflows — 123px over at iPad portrait (768px). Closing
  that needs menu homes for Cut/Copy/Paste, Duplicate/Delete and Convert/Flatten, which are all
  bar-only on touch for exactly the same reason arrange was. That is the next step, not this one.
- Browser-verified (desktop Chrome, :5183): the Object menu opens with all four commands, their
  shortcuts, and disabled-with-reason titles when nothing is selected.

## 2026-09-20 — The top bar finally fits, down to 739px

- **New Edit menu** (Undo, Redo, Cut, Copy, Paste) and the **Object menu gains Convert to path and
  Flatten transform**. Both groups were bar-only on touch, for the same reason arrange was: their
  other routes are keyboard shortcuts and the right-click menu, which `route.ts:31` opens for mouse
  input only. With menu homes they may legally be hidden at a width (invariant 24).
- Undo and Redo are in the Edit menu for completeness — an Edit menu without them is a surprise —
  but their icons never hide. They are the most-used controls in the bar.
- **A measured cascade**, dropping the least-essential group first as the bar narrows:

  | shown down to | group | bar needs |
  |---|---|---|
  | 1270px | arrange | 1259px |
  | 1110px | booleans | 1102px |
  | 950px | Convert / Flatten | 945px |
  | 870px | Cut / Copy / Paste | 860px |
  | — | (none of the four) | **739px** |

- **739px is under iPad portrait's 768px, so the bar now fits there** — the overflow first measured
  at 209px is gone. Verified at every boundary (1270/1269, 1110/1109, 950/949, 870/869, 768): the
  bar fits in all nine states.
- The Edit menu costs ~54px, which is why the arrange and boolean breakpoints moved up again
  (1220→1270, 1060→1110). A breakpoint is only correct relative to the bar's current content.
- Browser-verified (desktop Chrome, :5182): both menus open with the right items, shortcuts and
  disabled-with-reason states.

## 2026-09-20 — README: out of early development

- Dropped the "Early development." line from Status. The app opens, edits and saves SVG, has
  titles, booleans, layers and node editing — the label was undersold.
- **Multiple artboards are no longer planned**, and **text has left the roadmap** because it is
  built (M10a-M10d). CLAUDE.md's copy of the same list updated to match, with both decisions dated
  beside the light-theme one.
- Clarified the import note: unsupported content is *other tools'* `<text>` elements, not text in
  general. Beside the Artistic titles bullet, the old wording read as if the Text tool were broken.
  Those elements are genuinely still dropped (`parse.test.ts` asserts `["<text>"]`), so the caveat
  stays — it just says what it means now.
- Test count 607 → 625.

## 2026-09-21 — Milestone 11: path operations

- Five operations in the **Path** menu beside the four booleans: **Subdivide**, **Reverse
  direction**, **Break apart**, **Combine** and **Simplify**. No new top-bar icons and no new
  keyboard shortcuts — the bar's four hiding breakpoints are measured (invariant 24), and five
  more icons would invalidate every one of them.
- **Two cost estimates were wrong, in opposite directions, both settled by probing `paper-core`
  rather than reasoning about it.** Simplify was *not* the large one: paper ships
  `simplify(tolerance)`, which *is* Schneider's curve fitter (`segments: 41 → 16` on a noisy
  sine), so it costs only the async plumbing `booleanSelection` already models. Outline stroke
  *was*: `expand` is undefined on `Path` and there is no `outline` or `offset`, so outlining a
  stroke means offsetting by ±`strokeWidth / 2` with joins, caps and self-intersection cleanup —
  offset path under another name. Both were dropped together.
- **Simplify's tolerance must be squared, and the square is load-bearing.** Paper's `tolerance`
  bounds a *squared* distance, so passing `diag × k` yields deviation proportional to `√diag` —
  not scale-invariant at all. Measured, on one shape at ×1/×10/×100: `diag × 2e-3` left
  **60 / 81 / 81** segments — the same drawing simplified differently purely because it was
  bigger — versus **81 / 81 / 81** with `(diag × 2e-3)²`. The fraction is `5e-3`, also measured:
  squared, `2e-3` removes nothing from a realistically noisy path (81 → 81), while `5e-3` takes
  81 → 56 at 0.49% of the diagonal. **But squaring fixes only our half** — paper's own
  `PathFitter` keeps absolute internal epsilons, and one fixture still goes 38 → 24 nodes across
  ×1 → ×1000. The spec says both halves; so does this entry.
- **The donut has an order: reverse the inner shape *first*, then Combine.** Reverse acts on a
  whole path, so once two rings share one node it flips both and their relative winding is
  unchanged. Caught by the plan's own pre-flight scan, which had the test asserting the
  impossible order. There is no `fill-rule` anywhere in this app — `Style` has no such field, so
  everything renders SVG's default **nonzero** winding — which is why Reverse has to do the work
  that `fill-rule: evenodd` would otherwise do for free.
- **Reverse, Subdivide and Break apart operate on paths only** — a live rect, ellipse or polygon
  needs **Object ▸ Convert to path** first. Deliberate: converting silently would destroy
  liveness (spec §5). Combine is the exception, because a multi-subpath result cannot stay a live
  shape, so it converts its operands itself, exactly as `booleanShapes` already does. The
  browser pass confirmed the refusal reads as a specific instruction rather than "you selected
  nothing": the Path menu's Reverse direction item, with an unconverted ellipse selected, reads
  `Reverse direction — convert the shape to a path first (Object ▸ Convert to path)` — in both
  its accessible title and the status-bar hint. This was itself a fix: the browser pass found the
  refusal reason said only "select a path", which reads as "you selected nothing" rather than
  naming the remedy.
- **`geom/paper.ts` now owns the paper loader and the two-way conversion**, with `boolean.ts` and
  the new `simplify.ts` as its callers — invariant 37 and the build-check paragraph now name it.
  `boolean-edit.ts`'s private `mapSubpath` turned out to be a duplicate of `transformSubpaths`,
  and its `order`/`after` logic is the frontmost-operand rule Combine needed too — both are now
  shared rather than copied a second time.
- Plan: `docs/superpowers/plans/2026-09-21-m11-path-operations.md`. Spec:
  `docs/superpowers/specs/2026-09-21-m11-path-operations-design.md` (amended twice during
  implementation: the squared-tolerance finding above, and the shape-vs-path refusal wording).
- **Browser-verified** (desktop Chrome, :5198): converted two concentric ellipses to paths,
  reversed the inner one, and Combine produced one Layers-panel row rendering as a **donut** — a
  visible hole, not a second solid disc. Break apart on that result gave back two rows in the
  original nested layout. Subdivide took a 4-node circle to 8 (confirmed with the node tool), and
  a separate 64-node circle simplified with a notice reading, character for character,
  `Simplified — 64 nodes → 8.` (em dash and arrow both correct, matching the code's template
  verbatim — this exact string was re-checked in a second pass after an earlier pass could not
  confirm it had appeared on screen and downgraded the claim rather than assume it). With nothing
  selected, all five Path-menu entries render `aria-disabled` with their reasons — confirmed
  verbatim: `Simplify — select a path` and `Combine — select two or more shapes` — and clicking a
  disabled entry does nothing. Console was clean (only Vite's own HMR lines) throughout every
  pass.
- Owed: an iPad pass (the disabled-with-reason titles in particular, since a press is the only
  way to read them there); paper's failed-load path is still never browser-verified, now
  reachable from a second command; Simplify's tolerance is measured against a synthetic noisy
  sine, not a real traced path or a heavily-noded import, so the `5e-3` fraction may still want
  tuning.
- 681 tests in 51 files (56 new, across the new `path-ops.test.ts` and `simplify.test.ts` — the
  latter covers both `doc/simplify-edit.ts` and `geom/simplify.ts` — plus the `geom/paper.ts`
  extraction, which keeps `boolean.test.ts` green unchanged).

### Final whole-branch review — two defects only a cross-task pass could see

Both were invisible to every fixture on the branch, because every fixture had an identity
transform and two-sided handles. Both were consistency-with-the-neighbours problems, which is
exactly what a per-task review has no way to look at.

- **Subdivide wrote handles equal to their own anchor.** `segmentCubic` fills a missing handle with
  the anchor, so on a **one-sided** segment — a handle-free corner beside a curved node, which is
  what the pen makes from a click then a click-drag — the split returned a control point equal to
  the anchor and it was stored unconditionally. `pickAt` gives a selected node's handles priority
  over the node, so the user would drag a phantom handle instead of moving the node, and
  anchor-equal `C` controls went into saved files. `insertNode`, 150 lines up in the same file,
  already guarded exactly this; Subdivide now mirrors it. The guard is exact, not a tolerance:
  `L[1] === a.p` **iff** `a.out` was null.
- **Simplify measured its tolerance in the wrong space.** `nodeBounds(p, IDENTITY)` applies the
  node's own transform, giving the parent-space box, while the geometry handed to paper is the
  path's untransformed subpaths. A path carrying `scale(10)` got a tolerance 10× too large in the
  space it was applied in — 5% of the diagonal instead of 0.5%, an order of magnitude more
  destructive than the fraction §6 spent two amendments measuring, and silent. This was the same
  class of scale dependence §6 exists to remove, reintroduced one line below the comment
  explaining it.
- Also fixed: node selection survived renumbering (Subdivide maps `i → 2i`, Reverse inverts the
  order, and `app.nodeSel` pointed at different nodes afterwards); `pathReason` walked the tree
  five times per recompute, on a path that recomputes every pointermove during a drag.
- **Three spec sentences were wrong rather than the code**, and the spec was amended: `breakApart`
  keeps the original id on its first fragment (it reads as a split, not a delete plus N inserts);
  `simplifySelection` re-checks the document, not the selection, because it neither deletes nodes
  nor selects anything; and the "<2-node result dropped" guard cannot be reached through
  `simplifyOf`, because `fromPaperItem` filters first.
- **Owed, newly:** `combine` restates `booleanShapes`' front-operand pipeline and the two have
  **already drifted** — `combine` guards a singular per-operand matrix, `booleanShapes` does not.
  Spec §3 says Combine follows `booleanOf`'s rule "exactly", which is an argument for one
  implementation; a shared `operandsInFrontSpace(doc, ids)` would remove ~15 duplicated lines and
  the drift with it. Also: two refusal dialects now coexist (`boolean-edit.ts` returns a code
  mapped through `BOOL_REASON`, `path-ops.ts` returns the string), with two reason literals
  verbatim in both files. And the Path menu is now nine items with no overflow handling for a
  short viewport — one for the iPad pass.
- 685 tests in 51 files.

## 2026-09-21 — Milestone 12: PNG export

- **File ▸ Export PNG…** opens a dialog — Region (Artboard or Selection), a scale multiplier with a
  live pixel readout, and a Transparent toggle defaulting off for the artboard and on for a
  selection — and **Edit ▸ Copy as PNG** puts the artboard on the clipboard at 1×. Menu entries
  only, no top-bar icon and no keyboard shortcut, for the reason M11 gave: the bar's four hiding
  breakpoints are measured and it fits at 739px today, and an icon would invalidate all of them.
- **The spike's findings, carried from the design spec into the shipped feature.** The canvas is
  not tainted, because a serialized document holds neither a `<text>` element (titles are stored as
  outlines) nor any external reference. `drawImage` re-rasterises the vector at the destination
  size rather than upscaling a fixed raster — proven crisp at 8× with no blur ramp — so scale needs
  no SVG rewriting: size the canvas and draw. A region is aimed with the root's `viewBox`, not a
  crop of a fixed-size raster, which is what keeps a crop crisp at any scale. And **the size ceiling
  fails silently**: Chrome draws a 16384² canvas but 16385² comes back blank with a null blob,
  throwing nothing — which is why `exportRefusal` is a pre-emptive predicate checked before
  anything is drawn, not a `try`/`catch` around the draw.
- The dialog's Region/Background wiring matches the spec exactly: picking Selection is only
  possible when something is selected — otherwise it is a disabled `<option>` reading "Selection —
  nothing selected", never a hidden control — and picking it auto-flips Transparent on; picking
  Artboard leaves Transparent off. The scale field's readout is live arithmetic
  (`round(region × scale)`), and a refusing scale disables Export rather than hiding it, naming the
  computed size it refused.
- **Browser-verified** (desktop Chrome, :5198): opened the dialog with two shapes drawn — Region
  read Artboard, the readout read the artboard's own 800 × 600 at 1×. Setting Scale to 2 doubled the
  readout to 1600 × 1200, and exporting produced the notice `Exported Untitled.png — 1600 × 1200.`
  Selecting one shape and reopening the dialog enabled the Selection option; picking it flipped
  Transparent on, and exporting that selection produced `Exported Untitled.png — 149 × 100.`,
  matching the shape's own bounds rather than the artboard. With nothing selected, the Selection
  `<option>` is `disabled` in the DOM with the reason as its own label, verbatim `Selection —
  nothing selected`.
  Setting Scale to 500 disabled the Export button and showed the refusal naming the exact computed
  size: `400000 × 300000 is too large; reduce the scale`. Edit ▸ Copy as PNG succeeded on the first
  try, reporting `Copied 800 × 600 to the clipboard.` — the browser did not refuse the clipboard, so
  the fallback error notice ("use Export PNG… instead") was not exercised this session. Console was
  clean throughout: no errors, only Vite's own reconnect debug lines from repeated reloads.
  A second, deliberately provoked native-picker call (while a first was still pending) surfaced the
  browser's own error verbatim as a notice — `Export PNG — Failed to execute 'showSaveFilePicker' on
  'Window': File picker already active.` — caught and shown rather than an uncaught exception, which
  is itself a small confirmation that `exportPng`'s catch-all works on a real, unanticipated error.
- **Not verified: opening the saved file and inspecting its pixels.** Chrome's native Save-file
  picker is a true OS-level dialog outside this session's browser-automation reach — every attempt
  to drive it with a screenshot or a keystroke left the export waiting on a picker nothing could
  resolve. Forcing the `<a download>` fallback (by clearing `window.showSaveFilePicker` for the
  test) let exports complete without a native dialog and is what produced the two notices above, but
  reading the resulting blob back — via `fetch`, `<img>`, or `createImageBitmap` — failed from the
  automation's script-injection context with a bare `Failed to fetch` even immediately after
  creation, while a blob created and fetched within that same call succeeded; the failure is
  specific to reading a blob: URL from a different execution context than the one that made it, not
  a defect in the app. So the pixel-level part of the plan's checks — exact colours, transparent
  pixels, the unselected shape actually absent rather than merely out of frame — rests on the
  spike's own Chrome DevTools measurements above and on `filterToSelection`'s unit coverage, not a
  fresh look at a file from this session. Recorded here rather than folded into the browser-verified
  paragraph above, per the standing rule that an inferred check must never be written up as an
  observed one.
- Owed (spec §11, most pressing first): **Safari and iPad are unverified, and remain the
  milestone's real risk.** Both the tainting rule and the size ceiling are known to differ there —
  iOS caps total area rather than per-side dimensions, historically well below 16384² — and if iOS
  taints an SVG-backed canvas, `toBlob` fails and PNG export does not work on the device this project
  treats as first-class. Check this first in the device pass, not last. `MAX_SIDE`/`MAX_PIXELS` are
  chosen conservatively against that unmeasured limit and may need retuning once it's known. Copy as
  PNG's Safari behaviour (§8) is likewise unconfirmed — this session's one attempt was on desktop
  Chrome, where it simply worked. **A selection export clips strokes** (added 2026-09-21, found by
  the whole-branch review): `selectionBounds` builds on `nodeBounds`, whose contract is "Geometric
  bounds (stroke excluded)", so the outer half of every edge stroke falls outside the `viewBox`.
  Accepted for this milestone on one ground — the PNG then matches exactly the selection frame the
  app already draws, built from the same bounds, so what you see selected is what you get. The
  proper fix needs visual bounds, which in turn needs miter-join overshoot, a number this codebase
  computes nowhere yet. Large exports are still synchronous with no progress indicator.
- Plan: `docs/superpowers/plans/2026-09-21-m12-png-export.md`. Spec:
  `docs/superpowers/specs/2026-09-21-m12-png-export-design.md`.
- 715 tests in 53 files.

## 2026-09-21 — Art outside the artboard is dimmed

- A **translucent scrim** over everything outside the artboard, so out-of-frame artwork reads as
  secondary instead of sitting on the dark ground as though it were on a table. Prompted by a
  screenshot of a circle straddling the frame's edge: both halves drew the same `#d9d9d9`, so the
  object looked half-lit rather than half-out.
- **It closes a real communication gap, not just a cosmetic one.** The artboard is a frame, not a
  container — nothing is clipped on the canvas, and objects live wherever you drag them. But the
  serialized root carries `viewBox="0 0 w h"` and an `<svg>` root hides overflow, so **art outside
  the frame is fully visible while you work and silently absent from the saved file — and now from
  the PNG too** (M12). Nothing on screen said so.
- **Drawn in screen space**, outside the zoom group, as one `<path>` with `fill-rule="evenodd"`:
  a viewport rectangle with the artboard punched out of it. The artboard's on-screen rect is four
  numbers `Canvas.svelte` already has from its `clientWidth`/`clientHeight` bindings. In document
  space the outer rectangle would have had to cover the viewport at `MIN_ZOOM` — a 100 000-unit
  span before any margin — and that magic number would have quietly stopped working the day the
  zoom range widened. `evenodd` makes the hole work whichever way each rectangle is wound, and an
  artboard entirely off-screen or larger than the viewport needs no special case.
- **The ground is `#101013`, so the scrim is invisible over empty canvas** — black at 60% over
  black is black. It appears only where artwork crosses the boundary, which is exactly when it is
  wanted, so a document whose art sits inside the frame looks identical to before.
- `pointer-events="none"`: out-of-frame objects stay fully selectable and draggable. The artboard's
  hairline stays on top; the scrim's hole edge coincides with it, so only the outer half-pixel of a
  1px stroke falls under it.
- **Canvas chrome only.** It lives in `Canvas.svelte` and never reaches `svg/attrs.ts`, the
  serializer or an export, so invariant 3's single-renderer rule is untouched — this adds no new
  way to style a shape, only a fixed overlay above all of them.
- Browser-verified (desktop Chrome, :5198): a circle straddling the left edge shows its outside
  half muted and its inside half true; a rectangle wholly outside goes from `#e4674a` to a muted
  brick while staying visible and clickable; empty canvas is unchanged.
- Owed: `SCRIM_OPACITY` of 0.6 is one constant and one judgement — it has been looked at on a
  desktop display only, and an iPad's screen may want a different number.

