# slop-vector-editor — milestone 10 design: artistic text

Date: 2026-09-19. Status: approved in brainstorming, after a spike (§2). Follows M9
(`2026-09-19-m9-object-visibility-design.md`). Implements the "text" item from the project design's
post-v1 list (§10), narrowed to titles.

Text is the one thing the importer still refuses outright: `<text>` falls to the `default:` branch of
`convert` and is reported in `dropped` as `<text>`. This milestone gives the app titles of its own,
and deliberately does **not** try to import other people's text (§9).

## 1. What this is for

Artistic titles — a short run of large type whose characters are individually rotated, scaled,
nudged and skewed, usually at random, to stop a title looking typeset. Not body copy. The request
was "characters transforms can be randomized", and everything here serves that.

## 2. What the spike established

Run before this spec was written, against `opentype.js` 2.0.0 and Anton (OFL):

- **It parses fonts in Node.** `opentype.parse(arrayBuffer)` works in Vitest, so the whole glyph
  pipeline is unit-testable like any other pure module. This was the milestone's main risk.
- **The ESM export is a default object, not a namespace.** `import ot from "opentype.js"`, then
  `ot.parse(...)`. `package.json` declares no `exports` field; `module` points at
  `dist/opentype.mjs`. `import * as ot` yields `{ default, "module.exports" }` and no `parse`.
- **Outlines come back as quadratics** (`M L Q`), and our model stores cubics — but
  `src/svg/pathdata.ts` already converts exactly, at line 192:
  `cubicTo(lerp(cur, q, 2 / 3), lerp(p, q, 2 / 3), p)`. So the glyph-to-model step is
  `font.getPath(…).toPathData(3)` handed to the existing `parsePathData()`. **No new geometry code.**
- **Cost, measured the way M7 measured Paper:** opentype becomes its own lazy chunk at **236.72 KB
  raw / 67.69 KB gzipped**, and the app's own chunk grows from 74.14 to **74.28 KB gzipped** — 0.14 KB,
  the loader. Getting that number took two builds: the first emitted no chunk at all because Rollup
  shook out a dynamic import behind an exported-but-never-called function, the same trap M7 recorded.
- **WOFF2 is refused.** The parser throws `WOFF2 require an external decompressor library`. WOFF and
  TTF/OTF parse. This is a user-facing constraint, not a footnote — `.woff2` is the format most
  people have to hand (§5).
- **Two shape gotchas.** The family name is at `font.names.windows.fontFamily.en`; plain
  `font.names.fontFamily` is `undefined` for Anton, so the lookup must be tolerant. Kerning comes
  from the legacy `kern` table — `getKerningValue` returned `-44` for A→V — so GPOS-only fonts will
  silently have no kerning.

## 3. The model: a path that remembers it was text

`PathShape` gains one optional field:

```ts
export type TextMeta = {
  text: string;
  /** The font's stored identity, matched against the registry by id then family name. */
  font: string;
  size: number;
  letterSpacing: number;
  align: "left" | "center" | "right";
  seed: number;
  amounts: { rotate: number; scale: number; offset: number; skew: number };
  /** Sparse, keyed by character index. */
  overrides: Record<number, CharOverride>;
};

export type PathShape = ShapeBase & {
  kind: "path";
  subpaths: Subpath[];
  /** Present when this path was generated from text and can still be re-typed (spec M10 §3). */
  text?: TextMeta;
};
```

**Not a new `kind: "text"`, and the reason is measurable:** 23 places in `src/` test
`kind === "path"` — hit-testing, bounds, booleans, node editing, convert-to-path, snapping, the
properties panel. A new kind would mean auditing every one of them and would leave M11's warp with a
special case. A path that carries optional metadata inherits all of it for free, and it follows the
pattern M9 established for `hidden?`/`locked?`: absent means ordinary, so nothing that ignores the
field behaves differently.

This is a deliberate asymmetry with polygons (invariant 21), which *are* their own kind. A polygon
stores no geometry — its `d` is regenerated from seven numbers on every read, and validated on
import by regenerating and comparing. Text cannot do that, because regenerating needs the font, and
the font may be absent. **So a title stores its outlines like any other path**, and the metadata is
what makes it re-typeable, not what makes it drawable.

**Per-character transforms are baked into the outlines**, never carried as matrices — the same rule
resize follows (invariant 11). That is what lets booleans, the node tool and M11's warp treat a
title as ordinary artwork.

**Editing the string re-derives the geometry from scratch**, so any hand-editing of the outlines
would be silently destroyed. Rather than let that happen, **editing a title's nodes drops its
`text`**: `path-edit.ts`'s structural edits clear the field, and from then on it is an ordinary
path. This is Illustrator's rule — outline the text, then you may reshape it — and it is one line in
each edit rather than a warning the user has to read.

## 4. Layout and the randomiser

Both pure, both unit-tested, neither aware of the store.

**`src/text/layout.ts`** — given glyph advances, kerning pairs, `size`, `letterSpacing` and `align`,
returns a pen position per character and the run's total width. The baseline is `y = 0`; `align`
shifts the whole run by `0`, `-width / 2` or `-width`.

**`src/text/random.ts`** — `charTransform(seed, index, amounts) → { rotate, scale, dx, dy, skew }`.
A seeded integer hash of `(seed, index)` feeds a small PRNG, so **each index is independent**:
adding a letter at the front must not reshuffle the ones after it, which a sequential PRNG would do.
All arithmetic is integer with `>>> 0`, so the result is identical on every machine — a title must
not re-roll itself because it was opened elsewhere.

Each character's transform is applied **about the centre of its own advance box at the baseline**,
`(penX + advance / 2, 0)`. Rotating about the origin would swing distant letters out of the line.

`overrides[i]` is layered on top of the random values, replacing per property, so a hand-tweaked
letter survives a re-roll of the rest. **Editing the string drops overrides at indices beyond the
new length** — simple and predictable, rather than guessing which letter moved.

## 5. Fonts

**Four bundled faces**, all SIL OFL 1.1: Anton, Bebas Neue, Archivo Black, Playfair Display. They
are imported through Vite (`import url from "…/anton.ttf?url"`), **not** hand-placed in `public/` —
that keeps them content-hashed in `dist/assets/` and inheriting the immutable caching, and avoids
the trap invariant 35 exists for. Each is fetched on first use, not at load.

**The OFL requires its licence to travel with the font**, so each ships with its `OFL.txt` in the
repo and is credited in the README. This is a licensing obligation, not a courtesy.

**Bring your own font** through an *Add a font…* button in the font list, which opens the ordinary
file picker. Brainstorming described dropping a file on the canvas; the picker is the deviation and
the reason is that the app has **no drag-and-drop handling anywhere today**, and a picker works
identically on iPad, where dropping a file is awkward. Drag-and-drop can be added later without
changing anything else.

- Accepted: `.ttf`, `.otf`, `.woff`.
- **`.woff2` is refused with a reason** — `Fonts in .woff2 can't be read here — use .ttf, .otf or
  .woff`. The spike proved the parser throws on it, and it is the format people most often have.
- An added font lives for the session only. It is not written into the document.

**A missing font is not an error.** A title whose font is not registered keeps its outlines and
everything that acts on geometry keeps working — move, warp, recolour, boolean, export. Only the
controls that would re-derive geometry are disabled, with the reason
`Change the text — the font "Anton" isn't loaded` (invariant 24's disabled-with-a-reason rule).

## 6. Where the commands live

**A Text tool** in the tool strip, shortcut **T**. Clicking the canvas places a title at that point
with the text `Title`, selects it, and focuses the string field.

**A Text section in the Properties panel**, shown when the selection is a single path with `text`:

```
Text       [ SLOP                    ]
Font       [ Anton              ▾ ] [ Add a font… ]
Size  [ 96 ]   Spacing [ 0 ]   Align [ ⇤ ⇔ ⇥ ]

RANDOMISE                    Seed 418  [ ↻ ]
Rotation  ───●────  ±12°
Scale     ──●─────  ±8%
Baseline  ─●──────  ±4px
Skew      ●───────  0°
```

Typing happens in the panel, not on the canvas. That was chosen in brainstorming to sidestep the
iPad keyboard covering the artwork, and it reuses the panel machinery rather than inventing a caret,
a hidden input and a selection model.

**Per-character overrides:** with the Text tool active, clicking a character in a selected title
selects that character; the four sliders then edit **only** that character, and dragging it on
canvas writes `dx`/`dy`. Escape, or clicking elsewhere in the title, returns to editing the whole
run. The selected character is drawn with the same `.ui-selected` treatment rows use.

## 7. The round-trip

Written by `src/svg/attrs.ts` onto the `<path>` it already writes:

| Attribute | Contents |
| --- | --- |
| `data-sv-text` | the string, escaped by the existing `escapeAttr` (which already handles `&`, `<`, `"`, tabs and newlines) |
| `data-sv-font` | the font's stored identity |
| `data-sv-text-opts` | `size spacing align seed rotate scale offset skew` — space-separated, the shape `data-sv-polygon` already uses |
| `data-sv-text-chars` | overrides: `;`-separated characters, `,`-separated properties, e.g. `3:r=-12,s=1.2;7:dx=4`. Omitted when empty. Keys are `r`, `s`, `dx`, `dy`, `k`. |

On import, a `<path>` carrying a valid `data-sv-text` becomes a path with `text` set, **and its `d`
is used as-is**. The outlines in the file are authoritative; nothing is regenerated. This is the
second deliberate difference from polygons, which validate by regenerating and comparing within
2e-6: text cannot, because the font may be missing, and the stored outlines are what every other
renderer draws anyway. Any attribute that fails to validate leaves an ordinary path — the artwork is
never lost, only its editability.

## 8. Testing

- **Unit (Vitest, node — the spike proved opentype parses here):**
  - `charTransform`: determinism for a given `(seed, index)`; independence, so inserting a character
    at the front leaves later indices untouched; amounts of zero giving an identity transform;
    overrides replacing per property and surviving a re-roll.
  - layout: advances and kerning summed correctly; `letterSpacing`; each of the three alignments;
    the empty string.
  - glyph pipeline, against a checked-in Anton fixture: `S` outlines to a non-empty subpath; `O`
    yields **two** contours, so its counter renders as a hole under nonzero fill; quadratics arrive
    as cubics through `parsePathData`.
  - attributes: format and parse round-trip for `data-sv-text-opts` and `data-sv-text-chars`,
    including rejection of malformed input, an out-of-range index, and a string containing `"` and
    `&`.
  - a title with a missing font keeps its subpaths and reports the font as unavailable.
- **Build:** 0 errors, 0 warnings. **Three** chunks now — the app's own, paper's and opentype's —
  and the app's own must stay within about a kilobyte of 74.3 KB gzipped.
- **Browser (controller, port 5195, screenshots):** placing a title; typing changing it live;
  switching font; each alignment; each slider and the re-roll; selecting one character and
  overriding it, then re-rolling and seeing the override survive; adding a `.ttf` through the
  picker; a `.woff2` refused with its reason; save, reload and the title still editable; the same
  file opened with the font unregistered keeping its artwork with the string field disabled and its
  reason; node-editing a title turning it into a plain path; no console errors.

## 9. Out

- **Importing other tools' `<text>`.** It stays in `dropped`. Converting foreign text would mean
  matching fonts we do not have and shaping we cannot do, and would produce artwork that silently
  differs from the original.
- ~~**Multi-line**~~ — **superseded 2026-09-19 (M10d).** Excluded here as "not serving titles",
  which stopped being true the moment the panel carried an alignment control: alignment describes
  how lines relate to each other, so with one line its effect was invisible. Multi-line is in.
- **Text on a path, vertical text.** Each is its own feature; neither serves titles.
- **Complex scripts.** opentype.js gives outlines and legacy kerning, not HarfBuzz shaping. Arabic,
  Devanagari, Thai and similar need joining and reordering we cannot do, and would render as
  detached glyphs. The tool detects characters in those ranges and **refuses with a notice** rather
  than drawing something wrong. Latin, Greek and Cyrillic are supported.
- **Variable-font axes**, font embedding in the saved SVG, and drag-and-drop font loading (§5).

## 10. Delivery: two milestones, not one

This is the largest milestone attempted here — bigger than M7 — and it decomposes cleanly along a
line that leaves working software on both sides:

- **M10a — titles.** The dependency and its lazy chunk, the font registry with four bundled faces
  and the picker, layout, the glyph pipeline, the model change, the round-trip, the Text tool and
  the panel's string/font/size/spacing/align controls. `seed`, `amounts` and `overrides` are in the
  model and the attributes from the start, always at their identity values, so M10b adds no
  format change and no migration. Ships usable titles.
- **M10b — the randomiser.** The pure `charTransform`, the four sliders, the seed and re-roll, and
  per-character selection with its overrides. Ships the feature that was actually asked for.

Splitting is an execution decision, not a change to the design above: everything in §1–§9 is still
being built, in that order. It is recorded here because the alternative — one milestone with a new
dependency, a new file format, a new tool and a new interaction model in a single review — is how
the expensive mistakes happen.

## 11. Owed

The iPad pass owed since M5 now also covers the Text tool's character selection, which is a small
tap target on a large glyph, and the font picker. Performance is unmeasured: a long string at a
large size produces a path with hundreds of subpaths, and `nearestOnSubpath` and the flattening
cache have not been tried against that.
