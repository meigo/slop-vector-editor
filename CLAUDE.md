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
  build emits **four** chunks — the app's own (which holds `perfect-freehand` by design: it is small, and the brush needs it on the first stroke), `paper-core`'s, `opentype`'s and the Google Fonts
  catalogue's. The check is not a size bar on the app chunk (it grows with every feature) but that
  the two libraries stay in chunks of their own — paper in `dist/assets/paper-core-*.js` (~72 KB
  gzipped) and opentype in `dist/assets/opentype-*.js` (~68 KB gzipped) — and that the catalogue
  stays lazy, in `dist/assets/google-fonts-*.js` (~25.6 KB gzipped), fetched only when the dialog
  opens. Paper or opentype appearing in the app chunk means something outside `src/geom/paper.ts`
  or `src/text/font.ts` imported it statically; the catalogue appearing there means something
  imported `google-fonts.json` other than `loadCatalogue`'s dynamic `import()`
  (`src/text/google-catalogue.ts`). The four bundled fonts are content-hashed `.ttf` assets beside
  them.
- `npm test` — Vitest, node env, no DOM — 1367 tests in 90 files. Only pure logic is unit-tested.
- `npm run lint` / `npm run format`. Pre-commit (husky + lint-staged) runs eslint --fix + prettier.
- `npm run deploy` — build, then `wrangler deploy` (assets-only Worker, no `main`).

## Workflow

brainstorming → spec → writing-plans → subagent-driven-development → finishing-a-development-branch.
Branch off `main`, one commit per task, merge only when the user says so. Commit trailer:
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Keep README.md current with
every user-visible change.

## Architecture map

- `src/doc/` — `document.ts` (types, incl. `Fill`, `Gradient`, `LinearGradient`, `RadialGradient`,
  `isLinear`/`isRadial`, `radialMatrix`, `mapStyle`, `midOf`/`withMid`/`midStop` — the gradient
  midpoint — and `midPaintOf`/`withMidPaint` — its custom colour; `createDoc`), `paint-edit.ts`
  (`setPaintKind`,
  `GradientKind`, `toRadial`/`toLinear`, `convertGradients`, `setGradientStop`,
  `setGradientGeometry`, `setGradientMid`, `setGradientMidAuto`, `drawGradientLine` — the gradient
  edits behind the panel and the Gradient tool), `edits.ts` (pure `(doc, args) => doc`, incl.
  `insertNodes` for paste),
  `tree.ts` (`findNode`, `mapNodes`, `ancestorIds` — node lookup and
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
  the async Simplify action, modelled on `booleanSelection`'s shape), `align.ts` (`alignNodes`, `distributeNodes` — spec M19: several objects align to their bounds, one to the artboard; distribute = equal gaps for three or more; every command a per-node translation in parent space, so everything stays live), `flip.ts` (`flipNodes` — Flip horizontal/vertical as a mirror composed into each node's transform in parent space, never a bake, so titles and polygons stay live), `subset.ts`
  (`filterToSelection` — the document reduced to a selection, for exporting a region that contains
  only the selected objects), `warp-edit.ts` (`warpNodes`, `warpStyle`, `droppedLive`,
  `warpRefusal` — the Warp tool's bake: gradients follow the warp via `warpStyle`, not `mapStyle`,
  since a warp is not a matrix; invariant 47).
- `src/geom/` — `vec.ts`, `mat.ts` (SVG `matrix()` order), `shapes.ts` (`rectPath`, `polygonSubpath`,
  and the other shape-to-path constructors), `box.ts` (`Box`, `boxFromPoints`, `unionBox`,
  `boxMap`), `bezier.ts` (cubic point/bounds/flatten helpers, `splitCubic`, `nearestOnSubpath`),
  `bounds.ts` (node/selection bounds through the matrix), `hit.ts` (hit-testing and marquee
  select; caches flattened outlines keyed per subpath array and scale bucket), `snap.ts` (snap
  targets from the artboard and object bounds, plus path node points via `collectTargets`'s
  `nodes` option, `snapValue`/`snapBox`/`snapPoint`), `paper.ts` (the only module that imports
  paper, loaded on first use; the loader and the two-way conversion between subpaths and Paper's
  path model), `boolean.ts` (`booleanOf`, a caller of `paper.ts`), `simplify.ts` (`simplifyOf`,
  the other caller — Paper's `simplify(tolerance)` through the same conversion) and `warp.ts`
  (`Cage`, `identityCage`, `isIdentityCage`, `warpTolerance`, `warpPoint`, `cubicThrough4`,
  `edgeCubic`, `warpSubpaths` — the Coons-patch cage, its patch map and the cubic refit that bends
  a subpath through it).
- `src/svg/` — `xml.ts` (own XML reader), `pathdata.ts`, `arc.ts`, `colors.ts`,
  `transform.ts`, `attrs.ts` (model → attributes, shared by canvas and export; also
  writes polygons as paths via `polygonD`, and a shape's gradient
  `<linearGradient>`/`<radialGradient>` elements via `gradientDefs` — a radial circle as
  `cx cy r`, anything else as the unit circle under `gradientTransform`),
  `gradient-import.ts` (paint-server collection, `href`/`xlink:href` chain resolution,
  and `foldLinear`/`foldRadial`'s exact affine fold of any unit/transform/offset into
  our two-point/three-point model), `serialize.ts` (`serializeDoc` takes an optional
  second argument overriding the root's `width`/`height`/`viewBox`, for PNG export's
  region; absent, output is byte-identical to today), `parse.ts` (reads polygons back
  via `parsePolygonAttr`; resolves `url()` paint references per painted shape via
  `gradient-import.ts`).
- `src/tools/` — `types.ts` (`ToolId`, `Mods`), `tool.ts` (`Tool` — incl. the optional `activate`/
  `settle` hooks (invariant 47) — `ToolContext` — incl. `setHoverCursor`, the per-part hover-cursor
  slot — `ToolEvent`, whose `pressure` and coalesced `samples` only the brush reads, and the `brush` overlay kind: the live outline plus the size cursor; strokes handed to the store but not yet landed sit in `app.brushPending`),
  `frame.ts` (rotated selection frame; a mirrored matrix's frame angle is folded into (−90°, 90°] so a flipped object's handles stay upright), `gizmo.ts` (resize/rotate handle geometry), `shape-tools.ts`
  (rect/ellipse/line/polygon/hand draw tools; `constrain45`, the shared 45°-snap helper the
  Gradient and Warp tools call), `select.ts` (the select tool: click, drag-select,
  move, resize, rotate), `node-tool.ts` (the node tool: pick a path, select/drag nodes and
  handles, insert/delete, retype, close), `pen.ts` (the pen tool: draws a path node by node,
  keeping its own draft; resumes an open path from either end), `gradient-tool.ts` (the Gradient
  tool: draws a new gradient line or circle across the selection, in whichever kind
  `ToolContext.gradientType()` names; drags a knob or the line — a radial's centre or a line moves
  the whole gradient, one rim stretches the circle into an ellipse, the other rotates and scales it
  (Shift 45°, or keeps the stretch perpendicular)), `gradient-handles.ts` (pure
  `gradientHandles`/`pickHandle` — handle geometry for both kinds, in document order back to front,
  shared by the tool's hit-testing and the Overlay's drawing), `brush-tool.ts` (the Brush tool: steadies the pointer, keeps its draft, previews it through the `brush` overlay, hands the finished outline to `ToolContext.commitBrushStroke`; invariant 48), `warp-tool.ts` (the Warp tool: seeds
  an identity cage over the selection's world bounds on activation or a selection change, drags a
  corner or handle — a corner carries its two adjacent handles — committing `warpNodes` from a
  lazily-opened gesture `base` on every frame; Enter/Escape/`settle` close it) with `cage-handles.ts`
  (pure `CagePart`, `pickCage`, `moveCagePart`, `handleCorner` — cage hit-testing and edits),
  `registry.ts`
  (`TOOLS`, one instance per id), `context.ts` (`storeContext`, the real `ToolContext` wired to
  `app`, incl. registering the tool's `activate`/`settle` hooks beside `registerToolFinish`/
  `registerToolDiscard`; tests use `__tests__/fake-context.ts`).
- `src/input/` — `route.ts` (`routePointerDown`: tool vs. pan vs. pinch vs. menu vs. ignore, from
  pointer type/button/active pointers), `dock.ts` (on-screen Shift/Alt latch state machine),
  `double-tap.ts` (pure double-tap/double-click detection), `long-press.ts` (`createLongPress`, the touch/Pencil context menu), `finger-pick.ts` (`fingerPicks`, `isFingerTap` — "Fingers select", the dock's
  toggle `prefs.fingerSelect`, off by default, 2026-09-30: once a Pencil has been seen a finger is
  routed to "pan"; with the toggle on, `Canvas.svelte` keeps that pan's start and hands a quick,
  still tap to the Select/Node/Gradient/Text tool as a down+up — the Text tool only when it lands
  on a title or ends an edit, since a finger never creates — restoring the view the tap panned;
  the same pan arms a finger long press; "a Pencil has been seen" is `prefs.pencilSeen`, per device
  and never cleared by the app — it was page-local until 2026-09-30, so after every reload fingers
  were full tools until the Pencil touched again, and the toggle, shown off, did not describe them), `finger-tap.ts` (`createFingerTap`:
  two-finger tap = undo, three = redo — ported from slop-paint's `touch-gestures.ts`, same rules:
  reported on the last lift, no finger past 15 px, the last finger down under 300 ms, 100 ms
  debounce; plus `spoil()`, which `Canvas.svelte` calls when a Pencil or mouse is involved, so a
  resting palm lifted mid-stroke never undoes it. Canvas feeds it every pointer **before**
  routing, because a third finger is routed to "ignore" and never tracked; undo/redo run after
  `endPointer`, once a pinch has cancelled the first finger's tool action).
- `src/state/` — `session.ts` (doc + undo + gesture + saved marker, pure), `history.ts`,
  `viewport.ts` (incl. `revealPan`, the pure smallest pan that brings the caret's rectangle into the visible area, spec M22 §6), `keys.ts`, `commands.ts`, `properties.ts` (style/geometry summaries for the
  properties panel, incl. mixed-value handling), `clipboard.ts` (pure copy text and paste
  planning: cascade, centring, errors), `export-plan.ts` (`ExportRegion`, `exportBox`,
  `exportSize`, `exportRefusal`, `sizeLabel`, `pngFileName`, `MAX_SIDE`, `MAX_PIXELS` — the pure
  half of PNG export), `doc-name.ts` (`svgFileName`, `baseName` — the document name's rules: `app.fileName` is
  always `<name>.svg`; `renameDocument` in the store drops the save-in-place handle on a real
  change, so the next Save asks where to write, and is not an undo step), `appState.svelte.ts` (the
  `app` store + actions, incl. `exportPng` and `copyPng`).
- `src/brush/` — the Brush tool's pure half (spec M21): `smoothing.ts` (a port of slop-paint's
  `stroke-smoothing.ts`: `Steadier`, Stream's rope via `ropeLength`, `pathSmoothRadius`, `smoothPath`,
  `pauseBreaks`), `outline.ts` (`brushOutline` — the steadied points through perfect-freehand to a
  closed outline polygon; `outlineSubpath`, `polygonArea`), `settings.ts` (`BrushPrefs`,
  `DEFAULT_BRUSH`, the clamps, `sanitizeBrush`) and `commit.ts` (`BRUSH_TOL_PX`, `brushTolerance`,
  `brushStyle`). No DOM, no store; the tool and the store's `commitBrushStroke` call it.
- `src/text/` — `font.ts` (the **only** importer of `opentype.js`, and only dynamically: font
  registry, `loadFont`/`loadFace` (a `FaceRequest` — font, weight, italic — spec M20 §3),
  `registerFontFile`, `registerGoogleFamily`, `previewFace`, `familyWeights`/`familyHasItalic`/
  `familyLicense`, `outlineText`, the unshaped-script and no-glyph guards; `pathDataOf`/`num` format
  a glyph's path commands by hand — see invariant 40's NaN note), `caretStops` (spec M22 §2: for every index `0…length` a `CaretStop` `{ x, baseline, top, bottom, line }` in
  the title's own space, from the un-jittered layout), `layout.ts` (pure: pen positions,
  kerning, letter-spacing, alignment), `edit.ts` (spec M22, pure: `TextEdit`, `CaretStop`, `toCodePoint`/`toUtf16`
  — code points vs the textarea's UTF-16 units — `remapIndex`/`remapOverrides`, `indexAt` (nearest
  stop), `verticalMove` (↑/↓ with a goal x), `wordAt`, `selectionRects`; see invariant 49), `attrs.ts` (pure: the `data-sv-text-*` format, 8/9/11 fields
  — see invariant 40), `opentype.d.ts` (hand-written types — see the invariant), `fonts/` (four SIL
  OFL faces + their `OFL.txt`, imported through Vite `?url`), `google-catalogue.ts` (the Google
  Fonts catalogue, spec M20 §2: `GoogleFamily`, `loadCatalogue` — a lazy dynamic `import()` of the
  committed `google-fonts.json` snapshot, fetched only when the dialog opens — `googleFontId`/
  `familyIdOf` (the `gf:` prefix), `familyDir` (licence folder + hyphen-stripped id, for jsDelivr),
  `searchFamilies`/`CATEGORIES` (accent-insensitive ranked search) and `weightName`), `google-fonts.ts`
  (a family's faces, spec M20 §3: `parseMetadata` (METADATA.pb protobuf-text parsing),
  `isVariableFile`/`hasItalic`, `chooseFace` (picks the face for a weight+italic request),
  `fetchMetadata`/`fetchFaceFile` (jsDelivr downloads, an injectable `Fetcher` for tests,
  `FontDownloadError`) — imports no opentype.js; callers hand `font.ts` the raw bytes),
  `preview.ts` (`previewOutline`/`PREVIEW_SAMPLE` — the Google Fonts dialog's sample line, "Tallinn
  — šž õäöü", through the exact same `outlineText` pipeline a title uses).
- `src/persist/` — `file-io.ts` (File System Access / fallback), `project-io.ts`
  (new/open/save/restore, and `importDocument` — File ▸ Import SVG…, 2026-09-30, which runs the
  paste plan with `source: "file"` through the store's `importSvgText`; a file dropped on the
  canvas takes the same route), `autosave.ts` (IndexedDB, SVG text, 3 s debounce), `preferences.ts`
  (localStorage: style + polygon defaults for new shapes — the style is also updated by every style edit on a selection, flat paints only, through the store's `rememberStyle` (2026-09-28) — snap, the dock's expanded state, the
  sidebar's split ratio and the Layers panel's collapse),
  `tab-presence.ts`
  (`BroadcastChannel` "another tab is open" warning), `system-clipboard.ts` (never-throwing
  `navigator.clipboard` wrapper), `png.ts` (`rasterise`, `writeClipboardPng` — the impure half of
  PNG export; needs a DOM, so it is browser-verified rather than unit-tested), `share.ts`
  (`isAppleTouch`, `saveToFilesAvailable`, `canShareFile`, `classifyShareError` — Save to Files
  detection and the share sheet itself), `deliver.ts` (`deliverFile`, the shared/dismissed/ready/
  downloaded decision table between a built file and the share sheet, with `share`/`canShare`/
  `download` injectable exactly as `system-clipboard.ts` injects its `ClipboardLike`), `font-cache.ts`
  (spec M20 §5: the Google Fonts cache's **own** IndexedDB database, `slop-vector-editor-fonts`,
  stores `families` and `faces` — so autosave's database is never upgraded — behind the injectable
  `FontStore` interface; `idbFontStore` is the real wrapper, `memoryFontStore` is what tests use;
  `faceKey` — `<font id>/<filename>` — keys a face's cached bytes; never imports opentype.js).
- `scripts/` — `google-fonts-catalogue.mjs` (spec M20 §2: an offline, hand-run build script —
  never at build time or runtime — that fetches Fontsource's API and writes the committed
  `src/text/google-fonts.json` snapshot `google-catalogue.ts` loads).
- `src/lib/` — `Canvas` (also shows the tool's hover cursor, `app.hoverCursor`, in place of its
  static cursor when set), `NodeView`, `TextEditField` (spec M22: the hidden textarea mirror of the title being edited, always mounted in `Canvas`; invariant 49), `Overlay` (marquee/handles/gizmo/guides drawing, and the text caret and selection rectangles from `app.textEdit`/`app.caretStops`; every mark sits on a contrast halo — white under lines, a dark ring then a white one under knobs — so it reads on artwork of the accent's own hue), `TopBar`,
  `StatusBar`, `ToolStrip`, `IconButton` (top-bar icon action with reason tooltips), `hover-hint.ts`
  (the status bar shows the hovered element's `title`), `ContextMenu`, `ModifierDock`, `Sidebar`
  (the Layers + Properties column, Layers on top: the split ratio, the divider drag and which panel is open), `PropertiesPanel`, `LayersPanel`, `layer-drop.ts` (pure
  helper), `layer-trash.ts` (pure: what the header trash deletes), `reveal.ts` (pure: the nearest-edge scroll that keeps the selected layer row in view), `PanelHeader` (a panel's raised, collapsible header bar), `AlignSection` (spec M19: the Properties panel's Align section, shown with any selection), `split.ts` (pure: the ratio
  clamp, the drag maths and the Properties open/override rule), `NumberField` (typed, or dragged sideways through the pure `scrub.ts` — see invariant 42), `PaintField` (Flat/
  Linear, the Start/End gradient rows), `PaintRow.svelte` (swatch + hex + opacity, shared by the
  flat row and both gradient stops), `MidpointRow.svelte` (the Midpoint slider + `%` field, and the
  Auto toggle for the middle stop's colour, between a gradient's Start and End rows — the app's
  first range input), `icons/` (custom icons Lucide lacks — each is a component wrapping Lucide's exported `Icon` with its own `{ name, size: 24, node }` data, exactly as Lucide's shipped icons are built, so it takes the same props, shares the `LucideIcon` type and renders on the same 24×24 grid with the 2px round stroke; draw new ones in Lucide's language, e.g. `WarpIcon`'s corner handles come from `vector-square`; `GradientIcon`'s halftone dots vary their stroke width per column — the one sanctioned break from the uniform 2px, so it ignores a `strokeWidth` prop), `ToggleButton` (with
  `toggle.ts`, the pure state helper), `Modal`, dialogs (incl. `ShareReadyDialog`, which offers a
  fresh tap at Save to Files when `deliverFile` didn't attempt a direct share, or the attempt needs
  a fresh tap; `GoogleFontsDialog` — spec M20 §6: search box, category filter, a ranked family
  list with each one's licence, a picked family's preview (`preview.ts`) drawn in its downloaded
  regular face, and Add, which registers it and switches the title — closing only once the switch
  itself has committed), `Notices`.

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
   the named ones. `openText` parses fully before replacing the document. **A property the model
   cannot draw is reported, never ignored** (`UNREPRESENTABLE` in `parse.ts`, review H2,
   2026-09-30): `fill-rule: evenodd`, `stroke-dasharray`, markers, `transform-origin` and a CSS
   `transform` in `style`, each only when set to something other than a value that draws the same
   as leaving it out. An ignored one left `dropped` empty, so invariant 10 kept the handle and ⌘S
   wrote it away. A layer's own `transform`/`opacity` becomes a group around its children in our
   own format too (review M11): our export never writes them, but another editor may add them.
   **Import, drop and paste merge the source's layers into the current one, carrying each layer's
   state onto its objects** (`planPaste`, review M12): a hidden layer's objects arrive `hidden`, a
   locked one's `locked`.
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
   single notice — it does not retry on every edit. **It is also off when the stored copy cannot
   be read** (`restoreAutosave` returns false, review M10, 2026-09-30): autosaving the blank
   startup document would overwrite what may be the only copy 3 s later. A reload tries again.
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
    positions, so they can't disagree. **Drawn smaller than they reach** (2026-09-30): `handleSize` is the reach
    basis (unchanged — 16 for touch keeps the 10px grab and the push-outside span), `handleDrawSize`
    how big a knob is drawn (8 mouse, 10 touch). `visibleHandles` drops a side's midpoint when that
    side is shorter on screen than room for four reaches, and `handleAt` then lets that whole edge
    line grab; measured on the drawn positions, so zooming in brings the midpoints back. The resize maths are unaffected, and must stay that way:
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
    **A Pencil pressed while a finger is already down never reaches the page** (iPadOS, Safari and
    Chrome alike; found 2026-09-30 with `?debug`): no pointer event and no raw `touchstart` for it,
    page-wide — so on an iPad the Pencil takeover above never runs (its trigger never arrives; it
    stays for any device that does deliver it), and a finger-first stroke simply does not start. Not fixable from the page and accepted: a resting
    palm does not block drawing, only a finger that lands first. Don't chase it again. The
    right-click menu opens only for mouse input; touch and Pencil get a **long press** instead
    (2026-09-30, `input/long-press.ts`: 500 ms still within 10 px; a move, a lift, a second finger
    or a pinch cancels it). Both routes call the store's `openContextMenu`, so they select alike.
    **It is armed only for Select and Node** (`opensContextMenu`, review H1): armed with any tool,
    half a second of stillness cancelled the stroke or drag before finding no menu, and a careful
    Brush or Pen stroke lost its ink.
    Firing cancels the tool action the press began and swallows the lift's click — any new press
    clears that swallow, so a deliberate tap on a menu item is never the one eaten. A plain tap on
    a member of a multi-selection
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
      The Brush tool counts as content too (M21): its settings live in Properties, so
      `propsHasContent()` in the store (`selection.length > 0 || toolId === "brush"`) is the one rule
      `Sidebar.svelte` and `togglePropsPanel` both read — with the tool active and nothing selected the
      panel opens rather than collapsing over its own settings.
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
    five icon groups are hidden in a cascade, each carried by a menu at every width: clipboard
    below 870px (**Edit** menu), Convert/Flatten below 950px (**Object**), the booleans below
    1110px (**Path**), arrange below 1270px (**Object**), and flip below 1350px (**Object**,
    2026-09-28 — the first to go). They drop least-essential first as
    the bar narrows, so Cut/Copy/Paste survive longest and Undo/Redo never hide at all. The
    **Object** menu carries arrange (added M10e §8; before that menu existed,
    arrange's only other routes were ⌘]/⌘[ and the right-click menu, which `route.ts` opens for
    **mouse input only**, so on a touch device the icons were the single route and could not
    legally be hidden). **Those breakpoints are measured, not chosen**: the bar needs 1344px with
    everything shown, 1259px with flip hidden, 1102px with arrange hidden too, 945px and 860px
    as the booleans and Convert/Flatten go, and 739px with all five groups hidden (re-measured
    2026-09-28 by narrowing the header until it overflows, each group hidden in turn), and a breakpoint below what the bar
    needs silently reintroduces the overflow the exception exists to prevent — an earlier 900px was
    148px short of what it needed. **The bar now fits at every width down to 739px**, iPad portrait
    (768px) included; verified at each boundary. The
    bar is then stable at any given width, which is what the rule protects. Hiding a control
    because of _state_ — a selection, a mode, a document — is still forbidden. The file name is
    a button (2026-09-30): it opens Document settings, where the document is renamed, and its
    `title` gives the full name (when truncated) and says so.
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
    handling; the pen, the Warp tool and the Brush implement `keydown`/`busy` today. `hover` is every pointer move
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
    exception. **`connect-src` also names `https://cdn.jsdelivr.net`** (M20): it is the one runtime
    third party — a Google Fonts family's `METADATA.pb` and its face files are fetched from there,
    never from Google or Fontsource, and downloads happen only when the user picks a family (or a
    style of one already added) in the dialog. The catalogue itself is a committed, build-time
    snapshot (`src/text/google-fonts.json`) fetched from nowhere at runtime, so it needs no host of
    its own.
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
    row is blocked: that row is the only way back. **Renaming stays live too** (2026-09-30): a double-click on a blocked
    row's name renames it — renaming does not touch the drawing (Figma and Illustrator allow it) —
    and its hint says why the row is greyed ("“Logo” is hidden — double-click to rename"; a block
    from a hidden or locked group, which `nodeBlockedTitle` does not name, reads "Inside a hidden or
    locked group"). A single tap still does not select it.

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
    - The jitter is baked **about the centre of each glyph's own outline bounds** (`pivotOf`,
      2026-09-29) — about the origin, distant letters would swing out of the line, and about the
      baseline (M10 to 2026-09-29) a rotated tall letter swung its top into its neighbours and a
      scaled one grew upwards only. A glyph with no outline (a space) falls back to its advance
      box's centre. Outlines, click quads (`charHits`) and the character highlight all go through
      the same `pivotOf` + `charMatrix`, so they cannot disagree. Titles saved before the change
      keep their baked outlines until next re-outlined, when their letters shift once. An identity
      transform is skipped rather than applied, so an unjittered title's outlines stay
      byte-identical.
    - **`charSel` and `charQuads` are store state** — not saved, not undoable, cleared whenever the
      selection changes, like `nodeSel` (invariant 31). Escape lets the character go **before** the
      node selection or the object selection. The quads come from the same `runLayout` the outlines
      do, so a character's hit box and its glyph can never drift apart; if they did, clicking a
      letter would select a different one. They are cached by an `$effect.root` **in the store**,
      not an effect in `TextPanel`, because M8 put that panel behind `{#if expanded}` and a
      collapsed Properties panel would have silently stopped character picking working. Since M22
      **`charSel` is derived while a text session runs** (invariant 49): a one-character text
      selection sets it; outside a session it behaves as here. The Text tool's click no longer
      picks a character (`pickCharacter`/`titleId` left `ToolContext`; `charAtPoint` is what the
      tools ask now). The Overlay
      draws the highlight from that state directly, never through the single `app.overlay` slot
      that the marquee, the snap guides and the pen draft already share.
    - **`NumberField` never goes in a fixed-width cell.** It is a label, an input and a suffix that
      together need 108-133px; in a `grid-cols-2` cell of the 240px sidebar (104px) every field
      overflowed onto its neighbour and painted over that label. Superseded 2026-09-20 by the panel
      grid in invariant 23: the field column is `minmax(0, 1fr)`, so a field shrinks instead of
      overflowing, and the `flex flex-wrap` rows this note once prescribed are gone.
    - **`data-sv-text-opts` is 8, 9 or 11 fields.** M10d appended `lineHeight`; `parseTextOpts`
      accepts 8 or 9 and defaults the missing one to 1.2, because demanding nine would have turned
      every title saved before it into a plain path with its text lost. M20 appends `weight` and
      `italic(0|1)` as a pair, written only when either is off its default (`formatTextOpts` stays 9
      fields at Regular upright, so an unstyled title still serializes byte-identically); a file
      with 10 fields is rejected rather than guessed at. Any future field must be appended and
      optional for the same reason.
    - **A title's face is font + weight + italic, chosen by `chooseFace`** (`src/text/google-fonts.ts`,
      spec M20 §3): `TextMeta.weight` (absent = 400, `DEFAULT_WEIGHT` in `document.ts`) and
      `TextMeta.italic` (absent = upright), both optional and absent-means-default exactly like
      `hidden`/`locked` (invariant 39). **Weights exist only for a Google family** — `familyWeights`
      answers `[400]` for a bundled or file-added font, so its Weight menu offers just Regular, and
      a variable font added from a file (not through the dialog) stays at its one Regular design;
      only a Google-registered face's `entry.family.weights` and `chooseFace` over its parsed
      `METADATA.pb` faces can offer more. `chooseFace` picks: the entries matching the requested
      style, falling back to upright when italic was asked for but the family has none (the toggle
      is disabled in that case; an imported file asking for it must not fail); a **variable** face
      in that pool (filename contains `[`, e.g. `Lora[wght].ttf`) covers every weight and is
      returned outright; otherwise the exact static weight wins, else the nearest (ties to the
      heavier). Switching font snaps weight to the nearest the new family offers and drops italic if
      it has none, in the same patch as the font id (one undo step) — otherwise the file could say
      Bold Italic while the drawing is Regular. A Google family's font id is `gf:<fontsource id>`
      (`GF_PREFIX`/`googleFontId`/`familyIdOf` in `google-catalogue.ts`); bundled and file-added ids
      are unchanged.
    - **Never `font.getPath(text, …)` or opentype.js's `toPathData`.** `outlineText` draws each
      character through `charToGlyph(char).getPath(...)`, never the string form: that runs
      opentype.js's string shaping, which throws on many modern fonts once it sees two or more
      characters (Lora: "lookupType 6, substFormat 2 is not yet supported") — the app always passed
      one character, which happened to be safe, but the glyph route sidesteps that code entirely and
      is what a weighted variable face needs (`variation.getTransform` transforms a glyph, not a
      string). Its own commands are formatted by `pathDataOf`/`num`, a hand port of opentype.js's
      `optimizeCommands` clean-up, never through `toPathData`: `toPathData`'s rounding appends
      `"e+" + places` to the number's string form, and a coordinate whose fractional part is already
      tiny prints in exponent form ("1.2e-7"), so it parses "1.2e-7e+3" to `NaN` and caches it —
      `parsePathData` then drops the rest of that contour, silently losing part of a glyph at some
      pen positions (found on Lora's "l"; the bundled Anton hits it too). This is pre-existing and
      not new in M20; only found because of it.
    - **A variable face is instanced at every weight, 400 included** (`drawnGlyph` in `font.ts`):
      `font.variation.getTransform(glyph, { wght })` overwrites the base glyph's advance as a side
      effect, so after drawing 700 the un-instanced base glyph would lay 400 out with 700's
      advances. Weight changes advances as well as outlines, so layout measures each glyph's advance
      at the drawn weight, not the font's default.
    - **Block alignment falls out of the per-line rule** and needs no arithmetic of its own: with
      `left` every line starts at 0, with `center` every line is centred on 0, with `right` every
      line ends at 0 — so the block is aligned because each line is. `layoutRun` is unchanged from
      the single-line days.
    - **Character indices are indices into the raw string, newlines included.** `runLayout` skips
      the newlines (they have no glyph) but never renumbers what follows, which is what keeps
      M10c's per-character overrides pointing at the characters they were made for. They are
      **code points**, not UTF-16 units (M22): the hidden textarea speaks UTF-16, so every crossing
      goes through `toCodePoint`/`toUtf16` in `src/text/edit.ts`, and an emoji never splits.
      **Overrides follow their characters** (M22): `reshapeTitle` runs `remapOverrides` whenever the
      text changes — the common prefix and suffix bound the one edited span; an override before it
      keeps its index, one inside it is dropped, one after it shifts — replacing the old "drop keys
      past the new length", which left an override on the wrong letter after a panel keystroke
      (a pre-existing bug, fixed for the panel field too). Next to a doubled letter the strings
      alone are ambiguous — deleting either "l" of "Tallinn" gives "Talinn" — so both fields pass
      the caret after the edit (`typeTextEdit`/`typeTitleText`'s `caret`), and `editSpan` does not
      let the common suffix reach past it (review M5, 2026-09-30). In a canvas session `charSel`
      is derived from the field and never remapped (review L2).
    - **Alignment is not a position — it is which edge stays put when the title changes.** The
      click point is the anchor and the outlines are re-derived from it, so left grows rightwards,
      right grows leftwards and centre grows both ways. Its buttons use flush-line icons
      (`TextAlignStart/Center/End`), never arrows: an arrow says "move this way", and pressing
      "right" makes the text extend _leftwards_ from a pinned right edge, so arrows read as
      inverted. The titles say what is pinned, not "Align left".
    - **The panel shows ranges for the title and absolute values for a character.** `±12°` and
      `−12°` are different quantities, so they never share a field.
    - **A title is at most `MAX_TEXT_LENGTH` (2000) characters** (review M4, 2026-09-30):
      `reshapeTitle` refuses longer text — quietly while typing, with a notice on the commit —
      because the importer reads a title back only up to that length, and a longer one saved but
      reopened as a plain path with its text lost.
    - **The seed is an id, not a length.** `parseTextOpts` measures sizes and amounts against
      `MAX_TEXT_NUM` but checks the seed as a 32-bit integer: measuring it as a coordinate rejected
      every seed above 1e9, and a re-rolled title then came back from a reload as an ordinary path
      with its text lost for good.

41. **The title field is live, and a typing burst is one undo step** (M10e §5). `oninput` calls
    `typeTitleText` (quiet), `blur` calls `setTitleText` (reporting) and the burst is
    bracketed by the store's shared typing bracket (`startTitleTyping`/`endTitleTyping`), used by
    both the panel field and the canvas session (invariant 49), in the manner of `PaintField`'s
    picker drag (invariant 42). Three things this needs, each of which was a bug first:
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
    - **One title job at a time, and the queue follows it** (review M8/M9, 2026-09-30):
      `placeTitle` is a drain like `reshapeTitleDraining` (it holds `titleRunning` across its font
      load and sets `titleWork`), so a patch queued meanwhile is applied or dropped when it settles,
      not by some later edit. A job dropped because the **document** moved takes the queue with it
      (`dropTitleQueue`, reported unless quiet): the queued patch was made against the same moved
      document, and applying it after an undo wiped redo. A moved selection alone does not — the
      drain's target check handles that. A face that can't load is quiet while typing too
      (`withFont`'s `quiet`, review M6).
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
    **`NumberField` is draggable** (2026-09-28, ported from slop-animator): a press that travels
    3px sideways becomes a drag (`src/lib/scrub.ts`: 4px per step, Shift 4× finer, snapped to the
    field's `step`, measured from the press so returning restores the value; the grid anchors at
    0 when `min` is not finite). It calls `onchange` live on every step change and brackets the
    drag in its `onlivestart`/`onliveend` props — callers pass `beginUiGesture`/`endDocGesture`,
    and TextPanel passes `finishCharDrag` as the end, because title outlines are async and the
    bracket must wait for them (invariant 41). A mixed value (`null`) is typed only. The input is
    `touch-pan-y`, never `touch-none`: on iPad a vertical finger-scroll of the panel must still
    scroll, and the browser taking the pan cancels the pointer stream, which ends the drag. After
    a drag, the one stray `click` is swallowed so a drag released over a dialog backdrop cannot
    close the dialog.

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
    - **A plain corner drag is uniform** (2026-09-30; before that `dragHandle` kept proportions
      only while Shift was held, so the common gesture stretched a title and cost its text). A
      non-uniform resize now takes an edge handle or a Shift-held corner; W and H in the geometry
      fields are non-uniform by construction and always cost the text.
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

46. **A gradient lives in its shape's own space, so every geometry bake calls `mapStyle`**
    (`document.ts`) — `resize.ts`'s `bakeShape` (all four kinds), `edits.ts`'s
    `flattenTransform`, `path-ops.ts`'s `combine` and `boolean-edit.ts`'s `booleanShapes` today;
    a new bake site must too, exactly as it must use `withBakedSubpaths` for titles (invariant
    40). **The one exception is `warp-edit.ts`'s `warpStyle`** (invariant 47): a warp is not a
    matrix, so it cannot "map the style by the same matrix" — it maps a gradient's own-space
    points through the cage directly, point by point — but it still returns the same style object
    when neither paint is a gradient, exactly as `mapStyle` does. `mapStyle` maps each gradient's own-space points — two for a linear, three (`center`,
    `a`, `b`) for a radial, spec M16 §2 — through the same matrix the branch applies to the
    geometry, so a radial's ellipse (and its rotation and skew) survive any bake exactly, the
    same guarantee M15 gave a linear's angle and length. A title's uniform resize bakes only the
    scale into its outlines (invariant 44), so its gradient is mapped by the scale only, never
    the full resize matrix, or the translation that already went onto `transform` would be
    double-counted. **The polygon branch's vertical flip of an odd polygon** composes an extra
    half-turn into `transform` (invariant 22), because the corner set is only left-right
    symmetric; the style must then be mapped by `multiply(half, L)`, not `L` alone — the
    half-turn is its own inverse, so the node's transform (which now carries it) undoes it again,
    leaving the RENDERED gradient equal to `L` applied to the original. Mapping by `L` alone left
    the rendered gradient turned an extra 180° (a red→blue gradient came back blue→red — caught
    in the M15 final review). It returns the **same** style object when neither paint is a
    gradient, so a document with no gradients keeps every reference it keeps today. **Degenerate
    gradients collapse to the end stop's flat paint** (`flatIfDegenerate`), judged on the points
    **as written** (`fmt`'s rounding), because that is what the file holds and what a reload
    would see — a linear whose `from`/`to` coincide, or a radial whose `a`/`b` (relative to
    `center`) are collinear, i.e. the parallelogram they span has zero area, so the rim has
    collapsed to a line or a point. **Stops are always at 0 and 1** — there is no offset field —
    so a foreign gradient's offsets fold into `from`/`to` (or, for a radial, into the two points
    its rim is measured between) on import, keeping one gradient to one representation.
    `sameFill` compares kind, stops and every point exactly (two for a linear, three for a
    radial) — what an edit uses to return the same reference; `sameColours` drops the points
    (what Select Same and the panel's summaries use, since two gradients with the same colours on
    different shapes read as "the same fill" and the points aren't comparable across shapes
    anyway, and a linear never matches a radial there either). **Export writes one
    `<linearGradient>` or `<radialGradient>` per paint, never shared**, id
    `sv-grad-<node id>-<fill|stroke>`, `gradientUnits="userSpaceOnUse"` — a radial circle
    (`a`/`b` perpendicular and equal, spec M16 ruling 1) as `cx cy r`, anything else (an ellipse,
    or a circle under rotation or skew) as the unit circle under `gradientTransform` — in one `<defs>` that
    `serializeDoc` writes as the root's leading child and omits entirely when the document has no
    gradients — so a gradient-free document still serializes byte-identically. **Import resolves
    `url()` per painted shape, never per declaring element**: a paint reference is carried
    through inheritance unresolved (`colors.ts`'s `{ kind: "url" }`) because an
    `objectBoundingBox` gradient depends on the painted shape's own box and a `userSpaceOnUse`
    one on its own coordinate space, and only then is it folded — exactly, via an affine change
    of variable, for any invertible units/`gradientTransform` composition — into a 2-point linear
    gradient (`foldLinear`) or a 3-point radial one (`foldRadial`), dispatched on the source
    element's own name. Every 2-stop, pad-spread, non-degenerate linear gradient is kept exactly,
    whatever its units, transform or offsets; a radial is kept exactly on the same terms, and two
    more of its own: no focal point (`fx`/`fy` resolve to the centre and `fr` to 0, whether
    written or defaulted — spec M16 §4) and its first stop at offset 0 (a first stop above 0
    would paint a solid disc inside the rim, which the centre-plus-two-rims model can't
    represent). **0 stops → no paint (`null`) and 1 stop → that stop as a flat `Paint`, neither
    reported** — SVG paints them exactly that way too, so nothing was dropped. Four or more stops
    ("gradients with more than three stops"), a middle stop on or rounding onto an outer offset,
    equal-offset stops, non-`pad` spread, a `pattern`, a radial with a focal point ("radial
    gradients with a focal point") or an inner first stop ("radial gradients with an inner
    stop"), coordinates that overflow or exceed `MAX_COORD` ("invalid gradient coordinates" — a
    length is bounded at `len`, and the folded result is bounded again, since a fold can blow a
    bounded input up), an `href` cycle or a chain cut at `MAX_CHAIN` ("broken gradient
    references"), or a missing reference each drop with their own label, same as any other
    unsupported content (invariant 4). **Linear ↔ radial conversion reads centre = start point,
    rim = end point** (`toRadial`/`toLinear`, spec M16 ruling 3): a rectangle's worth of
    information — the radial's second rim — has nowhere to come from, so `toRadial` invents it
    perpendicular to the line, the same length, which is what makes a freshly converted radial a
    circle; converting back drops it, so the round trip is lossy exactly where the shapes are (a
    linear has no second rim to lose). Both are a no-op on a gradient already of the target kind.
    **The Gradient section's Type row mirrors the selection's gradient kind and falls back to
    `app.gradientType`** (the kind a drag draws, spec M16 ruling 4) — mixed when the selection
    holds both kinds, and pressing it converts every target-paint gradient in the selection to
    that kind (`convertGradients`), remembering what each gave up — keyed by shape and slot, in
    `app.gradientMemory` — so switching back restores the geometry, with the CURRENT stops kept
    (not the remembered ones), rather than reconverting through the lossy round trip above; the
    memory covers a kind change exactly as it already covered Flat, so a radial converted to
    linear and back stays the same ellipse rather than coming back a circle. **The memory is
    dropped for the shapes it repainted, groups included, the moment the Gradient tool commits a
    newer gradient there — a finished draw or a knob/line drag, never a cancelled one**
    (`forgetGradients`, fix M16 final review findings 1 and 1-round-2), so a later Type switch
    can't resurrect a gradient staler than what was just drawn; because the memory is keyed by LEAF
    shape id, forgetting a selected GROUP expands through `findNode` + `shapesOf` to every leaf it
    contains, not just the group's own (paint-less) id. It is also pruned in `setSession`, from one
    whole-document walk into a `Set`, for any id no longer in the document, so a shape deleted (or
    undone past its creation, whose id `idFor` can then hand to a new shape) can't leave its memory
    to be inherited.
    **A midpoint is `mid?: number` (spec M17), absent at 0.5 and never stored there** — `withMid`
    deletes the key, as turning `hidden` off does (invariant 39); read it only through `midOf`. It
    is written as a third stop at `offset=mid` carrying `midStop(start, end)`, the **premultiplied**
    50/50 mix (so a fade to transparent has no dark band), and read back from any 3-stop gradient
    whose middle stop matches that mix within ±1/255 per channel and 0.005 opacity — a middle stop
    on or rounding onto an outer offset still drops, and any other middle stop is kept as a custom
    middle colour (M18 below). It is a stop property, not geometry: bakes leave it
    alone, conversions and redraws keep it, a kind restore keeps the CURRENT one, and a diamond
    drag does not call `forgetGradients`.
    **A custom middle colour is `midPaint?: Paint` (spec M18)** — absent is Auto (`midStop`), read
    through `midPaintOf`, set through `withMidPaint` (deletes on `undefined`). Independent of
    `mid`. A stop property like the ends: Auto follows Start/End edits, a custom colour does not;
    conversions, redraws and kind restores keep the current one. `sameFill` compares the raw
    field, `sameColours` the effective colour. Export writes three stops when either `mid` or
    `midPaint` is set; import keeps every 3-stop gradient with its middle strictly inside, reading
    the mix within tolerance as Auto; four or more stops drop as "gradients with more than three
    stops". `StopEnd` includes `"mid"`, so the diamond's click picks the middle stop.

47. **A warp is a non-affine bake**, so it cannot reuse `mapStyle` (spec M14 §0.3, §3). Like every
    other bake site (invariant 46) it goes through `toPath` then `withBakedSubpaths` and leaves
    every node's own `transform` untouched (invariant 26); but the Coons-patch map is not a matrix,
    so `warp-edit.ts`'s `warpNodes` refits each segment's geometry (`geom/warp.ts`'s
    `warpSubpaths`) and maps a gradient's own-space points through `warpStyle`
    **pointwise** (`local —M→ world —S→ world′ —M⁻¹→ local′`) instead of mapping the whole style by
    one shared matrix — the exception invariant 46's bake-site list now names. **Every recompute
    runs against the tool's `base`, never the current document** (invariant 15): each cage drag
    commits `warpNodes(base, ids, cage, box)` afresh, so two drags of one cage compose into the
    cage's own final shape rather than two compounded bakes, and a mid-warp store edit (a fill
    colour, a nudge) lands on top of the warp instead of being lost under the next drag.
    **The gesture bracket opens lazily**, on the first handle drag rather than on activation (plan
    ruling 2), so pressing W and letting go with no drag opens no bracket and costs no undo step;
    it closes on Enter, Escape or `settle`. **`Tool.settle`** (`tool.ts`, new alongside `activate`)
    is what makes this safe: the store calls it from `cancelActiveGesture()` and from
    `setSelection` whenever the pruned selection's CONTENT actually changes, so a warp session
    commits — silently, with no "Warped — …" notice — before any other store edit or selection
    change can touch the document out from under it (plan ruling 1). Only Enter (including a tool
    change, which routes Enter to a busy tool) and a press that selects something else raise the
    notice; the store path via `settle` is quiet everywhere else, because the tool cannot tell a
    colour edit from an undo about to discard the very warp it would be reporting on.
    **A UI-opened bracket uses `beginUiGesture`, never `beginDocGesture`** (the colour picker, the
    Midpoint slider, the title field's typing burst): it runs `cancelActiveGesture()` first, so the
    warp settles into its own undo step BEFORE the UI bracket opens — otherwise the bracket would
    open inside the warp's (a no-op), the first edit's settle would close it, and every later value
    would be its own undo step (invariant 42). Tools keep `ctx.beginGesture` (= `beginDocGesture`).
    **Enter with no warp pending is declined** (`keydown` returns false), so a focused button still
    activates; Escape with an idle cage still leaves the tool. **A hidden descendant is never
    warped** (`warpNode` returns it as is): the cage is fitted to `nodeBounds`, which skips hidden
    children, so one outside the box would otherwise be wildly extrapolated.

48. **A brush stroke is a draft until pen-up, then an ordered async insert** (spec M21). The tool
    keeps the steadied centreline (`Steadier`, in screen px) and draws the perfect-freehand outline
    in the `brush` overlay; nothing enters the document until pen-up, so a stroke is one undo step
    and `cancel` (a palm, a pinch) or Escape simply drops it, as does `discard` (the store's replace,
    undo and redo). A tool switch mid-stroke does **not**: `setTool`'s finish sends Enter, the brush
    declines it, the canvas keeps driving `gesture.tool`, and the stroke lands at pen-up. Each point
    is mapped to document space through the view at the moment it was accepted, so a pan or zoom
    mid-stroke keeps the ink under the pen. The store's `commitBrushStroke` simplifies through Paper
    at `BRUSH_TOL_PX` (0.5) screen px **at the stroke's zoom**, and chains every stroke on the
    previous one so they land in drawing order; its preview moves to `app.brushPending` until it
    lands, so nothing flickers. It inserts and never commits from a stale base, so it does not
    cancel a running **brush** gesture — that is the next stroke — but cancels any other tool's
    (invariant 15). It keys on the tool that owns the running gesture (`registerGestureCancel`'s
    second argument, passed by `Canvas.svelte`), never on `app.toolId`: a key press mid-drag makes
    the two differ, and either mismatch loses work — a select drag left running erases the stroke on
    its next move, and a brush stroke cancelled because V was pressed loses its ink. `replaceDocument` bumps `brushEpoch` and clears the pending list, so a stroke never
    lands in a different document. If Paper fails to load, the exact outline is kept unsimplified
    with one error notice per session — ink is never lost; a stroke that fails to land raises "Brush
    — the stroke could not be added." and never rejects the chain. Pressure is read only from
    `pointerType === "pen"`; a mouse's flat 0.5 and a finger's 0/1 would otherwise make a mouse
    stroke thin. With Taper on, the taper runs over the whole stroke length (perfect-freehand
    `taper: true`, slop-paint's look), but only once the stroke is longer than its own width;
    shorter strokes and taps keep round caps (spec M21 §3) — don't remove that guard
    (`length > o.size` in `outline.ts`), or a tap becomes a sliver. The style is the default **stroke** paint as the fill (then
    the fill, then black), no stroke (the Blob Brush convention).

49. **On-canvas text editing is a hidden-textarea mirror** (spec M22). `TextEditField.svelte` is one
    `<textarea>` in `Canvas`, always mounted, opacity 0, never `display: none` (neither can take
    focus, and iOS raises the keyboard only for a focus made inside the tap). While editing it holds
    the title's string and **its selection is the caret and the selection** — so the keyboard, IME,
    autocorrect, dictation, word/line movement, clipboard and the field's own undo are the
    browser's. The app draws the caret and highlight (Overlay, from `app.textEdit` and
    `app.caretStops`, through the title's world matrix; `selectionRects` makes adjacent line rects
    meet at the midpoint, since a font's ascent + descent can exceed the line pitch), maps clicks to
    indices (`indexAt`) and handles ↑/↓ itself (`verticalMove`, a goal x kept across consecutive
    vertical moves, reset when the caret is anywhere else).
    - **Store state.** `app.textEdit: { id, anchor, focus } | null` (code points; not saved, not
      undoable). `beginTextEdit(id, at | "all")` selects the title, sets the selection, calls the
      registered `registerTextFocus` function **synchronously** (the tap) and opens the typing bracket;
      `endTextEdit` is the committing leave (Escape, a click on empty canvas, a blur outside a canvas
      press): it commits with reporting (`setTitleText`), then leaves; `leaveTextEdit` is the
      store-driven leave (a tool change, `setSelection` to anything but the edited title,
      undo/redo/replace, and `setSession` finding the title pruned from the selection or no longer a
      title — its layer locked or hidden, or it dragged into one) and reports nothing — not even a
      refused text — and clears `textEdit` **before** blurring the field so nothing ends twice. The
      `setSession` leave is deferred to a microtask and re-checked there, because the leave itself
      closes the bracket through `setSession` and `setSession` runs mid-action (`beginDocGesture`,
      `beginTextEdit`'s re-entry). Entering while the stops are not loaded keeps the
      click point (`pendingAt`) and resolves it when they arrive. `app.caretStops` is cached beside
      `charQuads`; `editCaretStops()` returns them only when they belong to the edited title.
      **An emptied field** (fix 2026-09-29): the document refuses an empty title — a path needs an
      outline — so it keeps the old text; `app.editEmpty` hides the title (`NodeView`) and its frame
      (Overlay) and puts the caret at x = 0 until text arrives. Leaving empty **removes the title**
      (the Illustrator/Figma convention), inside the session's bracket so one undo restores it —
      `endTextEdit` skips the reporting commit for an empty field, and `leaveTextEdit(removeEmpty)`
      does the removal, except for undo/redo/replace and the `setSession` leave (`false`), which
      revert, discard or have already lost the title. `setSelection` re-prunes after that leave,
      because the removed title may be among the ids it was asked to select.
    - **`charSel` is derived**: a selection of exactly one character (not a newline) sets it, so the
      Character block edits it and a press on it drags it (`setCharOffset`); anything else sets it
      to null. A character drag inside a session **keeps the session's one undo step** — the
      shared typing bracket (`startTitleTyping`/`endTitleTyping`, moved into the store from
      `TextPanel`, used by the panel field and the canvas alike) is not closed by `endToolGesture`
      while `insideTyping()`.
    - **Entry.** Select tool double-click on a title (on pointer-up, invariant 32) switches to the
      Text tool and edits with the caret at the click; Text tool click on a title edits it (Shift
      extends, double tap selects the word, a drag selects from the press) — a press inside the box
      of the one selected title counts as on it, since `hitTest` answers a grouped title's
      un-entered group; Text tool click on empty canvas places a title — `placeTitle`
      **pre-focuses the field before the font await**, releasing it on every failure path, and
      enters editing with the text fully selected if the Text tool is still active — or, while editing,
      only leaves (the next click places). Placing no longer focuses the panel's field or opens the
      Properties drawer below 900px: the editing is on the canvas. A title whose font is
      unavailable (invariant 40) does not enter editing.
    - **Focus.** The field's font is **16px** (iOS zooms the page on a smaller field), it sits at the
      caret so the browser has nothing to scroll to, and focus uses `{ preventScroll: true }`.
      Canvas's `pointerdown` blur of `document.activeElement` **skips the edit field while
      `app.textEdit` is set** (or every click in the title would end the session), and its
      `preventDefault` suppresses the `mousedown`, so a guard there cannot hold focus: the field's
      `onblur` **takes a blur during or just after a canvas press back** (the `pressing` prop, ~500 ms
      tail) and the press itself decides, through the tool, whether the session goes on. A blur
      outside that window ends the session (the iPad keyboard's dismiss key).
    - **Typing** is live and quiet, invariant 41: `input` → `typeTextEdit` → `typeTitleText`. The
      title's queued patch is replaced **per target**, so a burst on one title cannot drop another
      title's pending patch, and a dropped patch — queued or in flight — raises a notice unless it
      was a quiet keystroke (the burst's own commit reports). The document trails the
      field by an outline; the field is the source from its first `input`.
    - **One undo step per session**, from `beginTextEdit` to the leave. ⌘Z inside the field is the
      field's own text undo (invariant 41). ⌘A selects the text, not every object. ⌘S / ⌘⇧S (Ctrl
      too) are passed through to the app's Save / Save As (`commandForKey` → `runCommand`), since
      the window's shortcut handler skips a focused field and the browser would Save Page.
    - **Auto-pan.** After entering and after each caret change (and as the stops load) the view
      pans by `revealPan(view, caretRect, visible, margin)` — `visible` is the canvas host
      intersected with `visualViewport` — and is not restored. The view is read untracked so a hand
      pan while editing stays until the caret next moves.
    - **The page never scrolls.** `App.svelte` snaps the page scroll to 0 on `focusout`, on
      `visualViewport` `resize` and on window `scroll` — the mitigation every sibling slop app keeps
      (`../CLAUDE.md`). It undoes the real page scroll, **not** Chrome for iPad's leftover shift
      after the keyboard closes, which is unfixable from the page: Safari or the Home Screen app.
    - **Tools stay store-free** (invariant 12): `ToolContext` gained `textEdit`, `beginTextEdit`,
      `setTextSelection`, `textIndexAt`, `textWordAt`, `endTextEdit` and `charAtPoint`; `pickCharacter`
      and `titleId` are gone.

50. **The window keydown handler has one gate for focused fields** (`fieldPassesKey`,
    `state/keys.ts`, review M20/M21, 2026-09-30). A **text** field (text-like `<input>`,
    `<textarea>`, contenteditable) keeps every key except ⌘S, ⇧⌘S and ⌘O, which the app runs —
    otherwise the browser opens Save Page / Open File. A **control** (a slider, colour swatch,
    select, checkbox) keeps only the arrows and Space, which it uses itself; every other shortcut
    runs, so ⌘Z or a tool key is not dead after touching one. A handler that consumes a key calls
    `preventDefault()`, and the window handler skips any event already prevented — which is how the
    sidebar grip's arrows no longer also nudge the selection.

## Current state

**M22** (on-canvas text editing, 2026-09-29): a title is edited where it is. Double-click one with
the Select tool or click it with the Text tool and a caret appears at the click; placing a title
enters editing with its text selected. Type, drag-select, Shift and the arrows, ↑/↓ across lines,
⌘A, paste over a selection; a one-character selection is the Character block's `charSel` and drags.
A whole session is one undo step, and overrides now follow their characters when text is inserted or
deleted before them — a pre-existing panel-typing bug, fixed. iPad: the on-screen keyboard through
the hidden textarea mirror, and the view auto-pans to keep the caret above it (invariant 49). Owed:
the iPad pass (spec §8: focus from the tap, the keyboard, auto-pan, dictation and accents, the
hardware-keyboard iPad, Chrome's keyboard shift, the 500 ms refocus tail re-raising the keyboard
after a quick dismiss), Safari, IME, and emoji in the browser (unit-tested only); paste over a
selection was not browser-checked — see CHANGELOG. Paragraph text and shaping for complex scripts
remain unspecced.

Before that, **M21** (a pressure-sensitive Brush tool, 2026-09-29): press B and draw; with a Pencil the width
follows pressure, with a mouse or finger it is even. Five settings in a Brush section of Properties
(Size, Pressure, Taper, Stream, Smooth — `prefs.brush`), a size ring for the cursor, and each stroke
lands as one filled path in the stroke colour, simplified through Paper (invariant 48). Owed: an
iPad pass (real Pencil pressure, coalesced density at 240 Hz, palm rest, a pinch cancelling a finger
stroke, the Pencil's hover cursor) and Safari; the B key, the cursor's `pointerleave` hiding and
autosave/reload of a stroke were not browser-checked — see CHANGELOG.

Before that, **M20** (a Google Fonts library, weights and italic, 2026-09-28): browse the Google Fonts
collection (≈2000 OFL/Apache-2.0/UFL families) in a search dialog (Add a font… ▸ From Google
Fonts…), pick one to download and preview it, and Add to register it for good and switch the
title — files come from jsDelivr, never Google or Fontsource, and only on that pick; a Weight
select (exactly the family's own weights) and an Italic toggle (`aria-disabled` with a reason when
the family has none) in the Text section; bundled and file-added fonts stay Regular-only. Cached in
its own IndexedDB database so a reopened title stays editable offline. Fixed along the way (found
in the M20 spike, pre-existing, not new): opentype.js's `toPathData` returns `NaN` for a coordinate
whose fractional part is small enough to print in exponent form, silently dropping the rest of a
glyph contour at some pen positions in any font, the bundled Anton included — `outlineText` now
formats path commands itself (`pathDataOf`) rather than calling `toPathData`. See CHANGELOG. Owed:
an iPad/touch pass (the dialog, the add-a-font menu, search typing speed over ~1980 unfiltered
rows), Safari (the IndexedDB font cache, the italic download), the deployed CSP's new
`connect-src` host on Cloudflare, and offline behaviour with an uncached face (unit-tested only).
Text's own next milestones — paragraph text, then on-canvas text editing, then shaping for complex
scripts — are unspecced.

Before that, **M19** (align and distribute, 2026-09-28: an Align section in the Properties panel and the Object
menu — several objects align to their bounds, one to the artboard, distribute = equal gaps for three
or more; outermost selected nodes only, near-zero moves ignored so a repeat press is a no-op; owed
an iPad pass), after smaller 2026-09-28 additions (drag-adjustable number fields, sticky style
defaults, custom Lucide-style icons, flip horizontal/vertical with top-bar buttons below 1350px).
Before that, milestone 18 (custom gradient midpoint colour: `midPaint?: Paint` on both gradient kinds, absent
meaning Auto — the 50/50 mix — read through `midPaintOf` and set through `withMidPaint`/
`setGradientMidAuto`; a Mid colour row and Auto toggle in each paint's gradient rows; the tool's
diamond now shows and picks the middle stop; every valid three-stop gradient imports instead of
dropping), and **M14** (envelope warp: a Warp tool, shortcut W, that bends the whole selection
through one 12-point Coons cage — drag corners and handles, Enter bakes it as one undo step, Escape
cancels, Shift snaps to 45°; polygons, rectangles, ellipses and titles stop being live and a notice
says which; gradients follow the warp pointwise) — see CHANGELOG. M14 was taken after M15-M18
(gradients pulled ahead of it three times over); with it done, **nothing on the roadmap is
currently specced and unbuilt**. Verification is outstanding for M15-M18's iPad/touch/Pencil
behaviour (knob reach — a radial's three knobs sit close together on a small shape; M17's Midpoint
slider touch drag and diamond reach; M18's mixed-selection Auto toggle state, visually), for M14's
(Escape, a mid-warp colour edit, the hover cursor, Shift-45° and undo-then-drag were checked only by
unit tests — including real-store tests — not the browser; iPad/Pencil cage-knob reach and a resting
palm; performance on large selections, reasoned about but not measured; autosave mid-warp; a stale
idle cage on touch or after a keyboard edit), and for Safari's rendering of a gradient under
`gradientTransform` and of the warp cage — see CHANGELOG. Beyond M14, the post-v1 list (project
design §10) now holds more gradient stops and focal points, grid and smart guides,
masks and image paste — **gradients have left the list** (and freehand, M21, and align and distribute, M19) (M15, M16, M17,
M18). **A light theme is no longer planned** (2026-09-19), and
**multiple artboards are no longer planned** (2026-09-20) — the design doc still lists both, as a
dated document that later decisions supersede rather than rewrite. **Text is done** (M10a-M10d), so
it has left the list, and so has **PNG export** (M12) and **Save to Files** (M13). The
accessibility group and the performance group (both parked below) are the two remaining candidate
milestones, and neither is specced yet.

## Roadmap

M4 was split into 4a (node editing) and 4b (the pen tool), as M3 was split into 3a/3b. M5 (iPad
polish + deploy), M6 (selection conveniences), M7 (boolean operations), M8 (the sidebar split), M9
(per-object visibility and lock), M10a-M10e (titles, the randomiser, panel density and the
resizable sidebar), M11 (path operations), M12 (PNG export), M13 (Save to Files on iPad), M15
(linear gradients, taken ahead of M14), M16 (radial gradients), M17 (gradient midpoint and
distinct handles), M18 (custom gradient midpoint colour), **M14 — envelope warp**
(`docs/superpowers/specs/2026-09-20-m14-envelope-warp-design.md`), M19 (align and distribute) and
**M20** (a Google Fonts library, weights and italic,
`docs/superpowers/specs/2026-09-28-m20-google-fonts-design.md`) are complete — see CHANGELOG.
**M21** (a pressure-sensitive Brush tool,
`docs/superpowers/specs/2026-09-29-m21-brush-tool-design.md`) is complete too, and freehand has left
the post-v1 list. **M22** (on-canvas text editing,
`docs/superpowers/specs/2026-09-29-m22-on-canvas-text-design.md`) is complete as well; paragraph text
and shaping for complex scripts remain unspecced. Nothing on the roadmap is currently specced and unbuilt.

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
`aria-current`/`aria-selected` on layer rows, the PaintField opacity label, the Midpoint % field
label, `.ui-mixed`'s contrast; and performance — the id index for `findNode`, layer-row
measurement caching, `collectTargets` recomputing every bounds per pointer-down,
`nearestOnSubpath`'s cost.

## Verification debt

Canvas/touch/Pencil behavior is not unit-testable. Record in CHANGELOG what was checked in the
browser and what still needs an iPad pass. The owed device items are collected, by priority, in
`docs/superpowers/IPAD-CHECKLIST.md` — add a line there whenever a CHANGELOG entry owes one, and
tick or remove lines as the device pass confirms them.
