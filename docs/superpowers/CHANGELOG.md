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
- Owed: iPad (no hover — no status-bar hints on touch; native tooltips need a long-press),
  Safari/Firefox, a real 768px window.
