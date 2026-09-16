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
- `npm test` — Vitest, node env, no DOM — 101 tests in 10 files. Only pure logic is unit-tested.
- `npm run lint` / `npm run format`. Pre-commit (husky + lint-staged) runs eslint --fix + prettier.
- `npm run deploy` — build, then `wrangler deploy` (assets-only Worker, no `main`).

## Workflow

brainstorming → spec → writing-plans → subagent-driven-development → finishing-a-development-branch.
Branch off `main`, one commit per task, merge only when the user says so. Commit trailer:
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Keep README.md current with
every user-visible change.

## Architecture map

- `src/doc/` — `document.ts` (types, `createDoc`), `edits.ts` (pure `(doc, args) => doc`).
- `src/geom/` — `vec.ts`, `mat.ts` (SVG `matrix()` order), `shapes.ts` (`rectPath`).
- `src/svg/` — `xml.ts` (own XML reader), `pathdata.ts`, `arc.ts`, `colors.ts`, `transform.ts`,
  `attrs.ts` (model → attributes, shared by canvas and export), `serialize.ts`, `parse.ts`.
- `src/state/` — `session.ts` (doc + undo + gesture + saved marker, pure), `history.ts`,
  `viewport.ts`, `keys.ts`, `commands.ts`, `appState.svelte.ts` (the `app` store + actions).
- `src/persist/` — `file-io.ts` (File System Access / fallback), `project-io.ts`
  (new/open/save/restore), `autosave.ts` (IndexedDB, SVG text, 3 s debounce).
- `src/lib/` — `Canvas`, `NodeView`, `TopBar`, `StatusBar`, `Modal`, dialogs, `Notices`.

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

## Current state

Milestone 1 (scaffold, model, render, files) — see CHANGELOG. In M1 every canvas drag pans; there
are no editing tools yet.

## Roadmap

M2 select/transform + shapes, M3 layers/groups, M4 pen + node editing, M5 iPad polish + deploy
(spec §9). Post-v1 list in spec §10.

M2 constraint: the importer drops zero-size rects/ellipses, empty groups and node-less paths, so
tools and edits must never create them (or add an own-format bypass) — otherwise saved files do
not round-trip.

M2: two tabs share one autosave record (last write wins) — add a Web Lock or BroadcastChannel
warning.

M4 constraint: a closed subpath whose last node coincides with its first is merged on reload (one
node fewer) — the pen/node tools must not create that shape, or the writer must emit an explicit
closing segment.

M5: manifest.webmanifest, apple-touch-icon, public/_headers (immutable asset caching + CSP).

## Verification debt

Canvas/touch/Pencil behavior is not unit-testable. Record in CHANGELOG what was checked in the
browser and what still needs an iPad pass.
