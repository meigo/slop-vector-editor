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
