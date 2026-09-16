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
