# M20 Google Fonts Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Download Google Fonts families on demand (catalogue snapshot + jsDelivr files), cache them, and give titles Weight and Italic.

**Architecture:** a build-time catalogue JSON loaded lazily; pure modules for the catalogue (`google-catalogue.ts`) and for `METADATA.pb`/face choice/downloads (`google-fonts.ts`, injectable fetch); a font cache (`persist/font-cache.ts`, injectable store); `text/font.ts` grows faces (font + weight + italic) and variation-aware layout; store actions and a dialog.

**Tech Stack:** Svelte 5, TypeScript, Vitest (node, no DOM), opentype.js 2.0.

**Spec:** `docs/superpowers/specs/2026-09-28-m20-google-fonts-design.md`

## Global Constraints

- `src/text/font.ts` is the ONLY importer of `opentype.js`, and only via `await import(...)` (invariant 40). Other modules pass `ArrayBuffer`s.
- Draw glyphs through `glyph.getPath(...)` / `font.variation.getTransform(glyph, { wght })` — never `font.getPath(text, …)` or `getAdvanceWidth(text, …)` (opentype.js string shaping throws on many modern fonts).
- `TextMeta.weight?: number` (absent = 400), `TextMeta.italic?: true` (absent = upright); set through helpers that delete the key at default (invariant 39). `data-sv-text-opts`: exactly 9 fields when both default (byte-identical to today), 11 (`… lineHeight weight italic(0|1)`) otherwise; `parseTextOpts` accepts 8, 9 or 11.
- Google font ids: `gf:<fontsource id>`. File URL base: `https://cdn.jsdelivr.net/gh/google/fonts@main/`; folder = `{ "OFL-1.1": "ofl", "Apache-2.0": "apache", "UFL-1.0": "ufl" }[license]` + `/` + id without hyphens.
- CSP `connect-src 'self' https://cdn.jsdelivr.net` (public/_headers) — the only new host. Nothing contacts Google or Fontsource at runtime.
- The font cache uses its OWN IndexedDB database `slop-vector-editor-fonts`; never bump autosave's DB.
- Weight names: 100 Thin, 200 Extra Light, 300 Light, 400 Regular, 500 Medium, 600 Semi Bold, 700 Bold, 800 Extra Bold, 900 Black.
- Invariants: 1, 2, 12, 15, 23 (ToggleButton for Italic, `var(--ctl-h)`), 24 (titles, aria-disabled with reasons), 40, 41 (title reshapes, quiet flags), 42.
- Build bar: `npm run build` 0 errors 0 warnings, still exactly three chunks (app, paper-core, opentype) plus the catalogue as its own lazy chunk; `npx vitest run` green (never plain `vitest`/`npm test` in agents — watch mode hangs); `npm run lint` clean.
- Commit trailer, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. Existing titles and files are untouched: 9-field opts byte-identical at weight 400 / upright; old 8/9-field files still parse. Task 3.
2. Estonian and Latin-extended text (`šžõäöü ő`) outlines in a downloaded family (full files, not subsets). Tasks 2–3.
3. Offline or a failed download never corrupts the document — an error notice, nothing committed. Task 4.
4. Weight changes advances, not just shapes: a bold title is wider, and alignment anchors still hold. Task 3.
5. A family without italic: toggle disabled with a reason; an imported italic request falls back to upright. Tasks 3, 5.

---

### Task 1: Catalogue snapshot and `google-catalogue.ts`

**Files:** Create `scripts/google-fonts-catalogue.mjs`, `src/text/google-fonts.json` (generated), `src/text/google-catalogue.ts`, `src/__tests__/google-catalogue.test.ts`.

**Produces:**
```ts
export type GoogleFamily = { id: string; family: string; category: string; license: "OFL-1.1" | "Apache-2.0" | "UFL-1.0"; weights: number[]; italic: boolean; variable: boolean };
export const GF_PREFIX = "gf:";
export function googleFontId(f: GoogleFamily): string;          // "gf:" + id
export function familyIdOf(fontId: string): string | null;      // "gf:roboto" → "roboto", else null
export function familyDir(f: GoogleFamily): string;             // "ofl/roboto"
export function searchFamilies(all: readonly GoogleFamily[], query: string, category: string | null): GoogleFamily[];
export async function loadCatalogue(): Promise<readonly GoogleFamily[]>;  // dynamic import of the JSON, promise cached, cleared on rejection
export const CATEGORIES: readonly { id: string | null; label: string }[]; // All(null), sans-serif, serif, display, handwriting, monospace
export function weightName(w: number): string;                  // per Global Constraints; unknown → String(w)
```
- Script: fetch `https://api.fontsource.org/v1/fonts`, keep `type === "google"` and the three licences, map to `GoogleFamily` (`italic = styles.includes("italic")`), sort by family, write compact JSON (one line per family is fine). Run it once and commit the output. Document at the top how to refresh (`node scripts/google-fonts-catalogue.mjs`).
- `searchFamilies`: case- and accent-insensitive substring on `family`; category filter exact; empty query returns all (in the JSON's order).
- Tests: folder mapping for OFL/Apache/UFL and hyphenated ids; search (case, accents, category, empty); `weightName`; `familyIdOf`; the committed JSON's shape (every entry has a known licence, non-empty weights, ≥1500 families).
- Commit `feat(M20): Google Fonts catalogue snapshot`.

### Task 2: `google-fonts.ts` (METADATA.pb, face choice, downloads) and `persist/font-cache.ts`

**Files:** Create `src/text/google-fonts.ts`, `src/persist/font-cache.ts`, `src/__tests__/google-fonts.test.ts`, `src/__tests__/font-cache.test.ts`, fixtures `fixtures/metadata/lora.pb`, `fixtures/metadata/ubuntu.pb` (copy the real files — fetch from the jsDelivr URLs above).

**Produces (`google-fonts.ts`):**
```ts
export type FaceEntry = { style: "normal" | "italic"; weight: number; filename: string };
export const GOOGLE_FONTS_BASE = "https://cdn.jsdelivr.net/gh/google/fonts@main/";
export function parseMetadata(pb: string): FaceEntry[];        // the `fonts { … }` blocks; unique by filename
export function isVariableFile(filename: string): boolean;      // contains "["
export function chooseFace(faces: readonly FaceEntry[], weight: number, italic: boolean): FaceEntry | null; // spec §3
export function hasItalic(faces: readonly FaceEntry[]): boolean;
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
export async function fetchMetadata(dir: string, fetcher?: Fetcher): Promise<FaceEntry[]>;
export async function fetchFaceFile(dir: string, filename: string, fetcher?: Fetcher): Promise<ArrayBuffer>; // filename URL-encoded ([ ] ,)
```
Errors are `Error`s with user-readable messages ("Couldn't download Lora — check your connection").

**Produces (`font-cache.ts`):**
```ts
export type CachedFamily = { id: string; family: GoogleFamily; faces: FaceEntry[] };
export interface FontStore { getFamilies(): Promise<CachedFamily[]>; putFamily(f: CachedFamily): Promise<void>; getFace(key: string): Promise<ArrayBuffer | null>; putFace(key: string, buf: ArrayBuffer): Promise<void>; }
export function faceKey(fontId: string, filename: string): string;  // `${fontId}/${filename}`
export function idbFontStore(): FontStore;          // real IndexedDB, DB "slop-vector-editor-fonts", stores "families"/"faces"; never throws on open failure — rejects, callers degrade
export function memoryFontStore(): FontStore;       // for tests
```
- Tests: parse the two fixtures (Lora: variable upright + italic; Ubuntu: 8 static faces); chooseFace: variable any weight, static exact, static nearest (e.g. 600 → Medium 500 or Bold 700 — nearest, ties to heavier), italic on a family without italic → upright; URL building incl. encoding of `Lora[wght].ttf`; fetch errors via a fake fetcher (404 → message, network throw → message); memory store round trip.
- Commit `feat(M20): METADATA.pb parsing, face choice, downloads, font cache`.

### Task 3: Model, format, faces and variable-weight outlining

**Files:** Modify `src/doc/document.ts` (TextMeta), `src/text/attrs.ts` (`TextOpts`, `formatTextOpts`, `parseTextOpts`), `src/svg/attrs.ts` + `src/svg/parse.ts` if they build/read TextOpts fields explicitly, `src/text/font.ts`, tests in `src/__tests__/text-pure.test.ts` / `text-outline.test.ts` / `text-roundtrip.test.ts`; add fixture `fixtures/Lora[wght].ttf` (or a smaller OFL variable font) with its `OFL.txt` beside it.

**Produces (`font.ts`):**
```ts
export type FaceRequest = { font: string; weight?: number; italic?: boolean };
export async function loadFace(req: FaceRequest): Promise<LoadedFont>;  // LoadedFont gains `wght?: { min: number; max: number }` when variable
export function registerGoogleFamily(entry: CachedFamily, loader: (filename: string) => Promise<ArrayBuffer>): void; // adds to the registry, notifies the listener
export function familyWeights(fontId: string): number[];  // Google: catalogue weights; others: [400]
export function familyHasItalic(fontId: string): boolean;
export function familyLicense(fontId: string): string | null;
```
- `loadFont(id)` stays as `loadFace({ font: id })`. Faces cached by key `${font}|${filename or "bundled"}`.
- `fontAvailable(id)` true for registered Google families; `fontChoices()` includes them by family name (no "(added)" suffix).
- `runLayout`/`outlineText`/`charHits` take the meta's weight: when the face is variable, each glyph is `font.variation.getTransform(glyph, { wght: clamp(weight) })`, used for BOTH the advance and the path; kerning stays `getKerningValue(base glyphs)`. Static/bundled faces: unchanged path.
- `TextOpts`/`TextMeta` weight + italic; helpers `withWeight(meta, w)` / `withItalic(meta, on)` that delete keys at default.
- Tests: format 9 fields at defaults (byte-identical to a pre-M20 fixture string), 11 fields otherwise, parse 8/9/11, reject 10 or a bad weight (not an integer 1–1000) → null; outline the variable fixture at 400 vs 700: paths differ and total advance at 700 > 400; `charHits` quads match the outlines at 700; an italic request on a family without italic outlines upright.
- Commit `feat(M20): title weight and italic, variable-font outlining`.

### Task 4: Store, startup restore, CSP

**Files:** Modify `src/state/appState.svelte.ts`, `public/_headers`, maybe `src/App.svelte` (startup call); tests in a new `src/__tests__/google-store.test.ts`.

**Produces (store):**
```ts
export async function restoreGoogleFonts(store?: FontStore): Promise<void>;  // on startup; failures silent (log), never a notice
export async function previewGoogleFamily(f: GoogleFamily): Promise<{ font: LoadedFont } | { error: string }>; // downloads metadata + regular face (cached), does NOT register
export async function addGoogleFamily(f: GoogleFamily): Promise<boolean>;   // registers + persists; switches the selected title (or the default for new titles) to it; notice on failure
export async function setTitleWeight(w: number): Promise<void>;
export async function setTitleItalic(on: boolean): Promise<void>;
```
- `withFont(...)` and the char-quad effect load through `loadFace(meta)` (font + weight + italic).
- Offline/failed download: `withFont`'s error notice ("Couldn't download … — check your connection"), nothing committed (Review Focus 3).
- CSP: `connect-src 'self' https://cdn.jsdelivr.net`.
- Tests (store with `memoryFontStore` + fake fetcher injected via a small `setGoogleFontIo({ store, fetcher })` test hook): add → registered and title switched; weight and italic → one undo step each; failed download → notice, doc unchanged; restore → families available after a "reload" (fresh registry from the same memory store).
- Commit `feat(M20): Google Fonts store actions, cache restore, CSP`.

### Task 5: UI — dialog, add-a-font menu, Weight and Italic

**Files:** Create `src/lib/GoogleFontsDialog.svelte`; modify `src/lib/TextPanel.svelte`.
- "Add a font…" → a small menu (the Object-menu pattern: button + backdrop + `menu-item`s): *From a file…* (the existing hidden input), *From Google Fonts…* (opens the dialog).
- Dialog (`Modal`): search `input.field`, category row of `ToggleButton`s (single-select), a scrolling list (`max-height`, one `menu-item`-style button per family: name + licence badge), a preview area: after a pick, spinner/"Downloading…", then an `<svg>` of the sample outlined via `outlineText` (the family name, then "Tallinn — šž õäöü") and the licence, or the error; **Add** / **Cancel**. Loads the catalogue on open (`loadCatalogue`), with a loading state.
- Text section: Weight `<select class="field">` (options `familyWeights(meta.font)` with `weightName`), Italic `ToggleButton` (`aria-disabled` + reason when `!familyHasItalic`). Both disabled with the existing `missing` reason when the font isn't available.
- Missing Google font: when `familyIdOf(meta.font)` is in the catalogue and not registered, the missing hint gains a **Download <family>** button calling `addGoogleFamily`.
- Controller does the browser check (dialog, add Roboto, Bold, Italic, reload).
- Commit `feat(M20): Google Fonts dialog, Weight and Italic in the Text section`.

### Task 6: Docs

README (a "Fonts" part of the titles bullet: Google Fonts library, Weight/Italic, jsDelivr-only downloads on demand, licences), CLAUDE.md (architecture map: `google-catalogue.ts`, `google-fonts.ts`, `font-cache.ts`, `GoogleFontsDialog`; invariant 40 amended for faces/weight/italic and the 11-field opts; the CSP host in invariant 35), CHANGELOG (M20 entry: rulings, verification, owed).
