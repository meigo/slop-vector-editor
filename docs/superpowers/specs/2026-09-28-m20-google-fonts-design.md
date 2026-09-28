# slop-vector-editor — milestone 20 design: a Google Fonts library, weights and italic

Date: 2026-09-28. Status: approved in chat (three choices, then "go on and don't ask"). Follows the
font-source spike recorded in the CHANGELOG (2026-09-28). Titles stay outlines-plus-metadata
(invariant 40); this adds where fonts come from and which face of a family is drawn.

## 1. What

- Browse the Google Fonts collection (≈2000 families, all OFL / Apache-2.0 / Ubuntu Font Licence) in
  a search dialog, download a family on demand, and use it for titles — kept in the font menu for
  good and cached so reopened titles stay editable offline.
- **Weight** and **Italic** for a title: a Weight menu listing exactly the family's weights and an
  Italic toggle (disabled with a reason when the family has none). Bundled and file-added fonts
  offer only Regular.

Out: live previews while scrolling the list (a preview is shown only for the family picked);
width/optical-size axes; synthetic (faked) italic or bold; a weight slider; text shaping for complex
scripts; paragraph text and on-canvas editing (later milestones).

## 2. Sources (from the spike)

- **Catalogue**: a build-time snapshot of Fontsource's API (`https://api.fontsource.org/v1/fonts`,
  `type: "google"` only) into `src/text/google-fonts.json`, produced by
  `scripts/google-fonts-catalogue.mjs`: `{ id, family, category, license, weights, italic,
  variable }` per family. Loaded with a dynamic `import()` only when the dialog opens. Nothing
  contacts Fontsource at runtime.
- **Files**: `https://cdn.jsdelivr.net/gh/google/fonts@main/<dir>/<file>`, where `<dir>` is the
  licence folder (`ofl` / `apache` / `ufl`) plus the family id without hyphens (32/32 sampled
  families mapped), and `<file>` comes from that folder's `METADATA.pb` (a small text file listing
  each face's `style`, `weight` and `filename`). Full, unsubsetted TTFs — Fontsource's own files are
  split by script and lack `š`/`ž`/`ő` in "latin".
- **The only runtime third party is jsDelivr**; nothing goes to Google. The CSP's `connect-src`
  gains exactly `https://cdn.jsdelivr.net`. Downloads happen only when the user picks a family (or
  a style of one already added). The README says so.

## 3. Faces

A family has one or more faces. Choosing the face for `(weight, italic)` from `METADATA.pb`:

- Keep the entries whose `style` matches (`italic` or `normal`); if the family has no italic, the
  italic request is not honoured (the toggle is disabled anyway; an imported file asking for it
  falls back to upright rather than failing).
- A **variable** face (its filename contains `[`, e.g. `Lora[wght].ttf`) covers every weight: use
  it, and draw the requested weight through opentype.js's variation API
  (`font.variation.getTransform(glyph, { wght })`), clamped to the axis range.
- Otherwise (**static**, e.g. Ubuntu) use the entry with that exact weight, else the nearest.

Weight changes glyph **advances** as well as outlines, so layout uses each glyph's advance at the
requested weight (the spike: Lora 700 from the variable file matched Fontsource's static 700 file
exactly — advance and bounding box).

## 4. Model and file format

- `TextMeta` gains `weight?: number` (absent = 400) and `italic?: true` (absent = upright) —
  optional, absent-means-default, like `hidden`/`locked` (invariant 39).
- `data-sv-text-opts` stays **9 fields** when both are default (existing files and documents
  serialize byte-identically) and becomes **11** — `… lineHeight weight italic(0|1)` — otherwise.
  `parseTextOpts` accepts 8, 9 or 11 fields (invariant 40's append-only rule).
- A Google family's font id is `gf:<fontsource id>`, e.g. `gf:roboto`. Bundled and file-added ids are
  unchanged.

## 5. Registry and cache

- `src/persist/font-cache.ts`: its **own** IndexedDB database (`slop-vector-editor-fonts`, stores
  `families` and `faces`), so autosave's database is never upgraded. Behind an injectable store
  interface so its logic is unit-testable in node. A family record holds the catalogue entry and the
  parsed `METADATA.pb` faces; a face record holds the TTF bytes, keyed `gf:<id>/<filename>`.
- On startup the store restores the cached families into the registry: they appear in the font
  menu and `fontAvailable("gf:…")` is true. Loading a face uses the cached bytes, else downloads
  (and caches) them; offline with an uncached face → the usual font-load error notice.
- `src/text/font.ts` stays the only importer of opentype.js: the network and cache modules hand it
  `ArrayBuffer`s.

## 6. UI

- **"Add a font…"** becomes a small menu: *From a file…* (unchanged) and *From Google Fonts…*.
- **Google Fonts dialog** (`Modal`): search box, category filter (All, Sans, Serif, Display,
  Handwriting, Mono), a scrolling list of family names with each one's licence. Picking a family
  downloads its regular face and shows a preview line ("Tallinn — šž õäöü", the family's name) drawn
  in it, plus its licence; **Add** registers it (cached for good) and switches the selected title —
  or the default for new titles — to it. A failed download shows its reason in the dialog.
- **Text section**: a **Weight** select listing the family's weights by name ("Thin 100" …
  "Black 900"), and an **Italic** `ToggleButton` — `aria-disabled` with "Italic — <family> has no
  italic" when unavailable (invariant 24). Both commit through the existing title reshape, one undo
  step each.
- A title whose `gf:` font isn't registered (a file from elsewhere) keeps its outlines; the panel's
  "missing font" hint offers **Download <family>** when the id is in the catalogue.

## 7. Licensing

Every family in the snapshot is OFL-1.1, Apache-2.0 or UFL-1.0; the dialog shows each one's licence
and it is stored with the cached family. The snapshot is factual metadata (names, weights, licence
identifiers). Code added is ours (MIT); opentype.js is MIT.

## 8. Testing

Unit: catalogue search/filter and folder mapping; `METADATA.pb` parsing (real samples: Lora,
Ubuntu); face choice (variable, static exact/nearest, italic fallback); `data-sv-text-opts` 11-field
round trip and 8/9-field back-compat, byte-identical 9 fields at defaults; outlining at weight 700
from a variable fixture (a committed OFL font with its licence) differs from 400 and advances widen;
the cache/registry logic over an in-memory store; the store actions (weight/italic one undo step
each). Browser: add a family through the dialog, Bold, Italic, reload and edit from the cache.
