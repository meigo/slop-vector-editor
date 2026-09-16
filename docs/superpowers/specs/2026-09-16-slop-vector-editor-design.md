# slop-vector-editor — v1 design

Date: 2026-09-16. Status: approved in brainstorming (sections 1–2 explicitly; sections 3–6 taken as
the proposed defaults, "modify later if it feels so").

A simple browser-based vector graphics editor in the Inkscape / Affinity Designer family. Part of
the slop app family: same stack, tooling, deploy and visual language as slop-animator and
slop-audio-editor.

## 1. Goals, non-goals, constraints

**Goals (v1):**

- Shapes: rectangle (with corner radius), ellipse, line, polygon / star.
- Select + transform: select, multi-select, marquee, move, resize, rotate, nudge; z-order;
  duplicate; delete; copy/paste.
- Pen tool + node editing: bezier pen, direct node/handle editing, add/delete/convert nodes,
  break/join paths.
- Layers + groups: layer panel (visibility, lock, rename, reorder), group/ungroup, enter group.
- Style: solid fill and stroke (color + opacity, or none), stroke width, cap, join; object opacity.
- Files: the document IS an SVG file. Open / save / save-as, autosave, undo/redo.
- **iPad (touch + Apple Pencil) and desktop (mouse + keyboard) are equal first-class targets.**
  Every action is reachable on both without a physical keyboard or a right mouse button.

**Non-goals for v1 (roadmap, §8):** text, gradients/patterns, boolean operations, freehand
pencil/brush → vector, multiple artboards, PNG/PDF export, grid and smart guides, masks/clipping,
symbols, filters/effects, collaboration.

**Constraints:**

- 100% client-side, static hosting. No server, no uploads.
- "Simple" editor: performance target is ~a few thousand nodes at interactive rates, not tens of
  thousands of objects.
- `npm run build` bar: 0 errors, 0 warnings.

## 2. Tech stack and project setup

Copied from the sibling apps (slop-animator is the reference):

- Svelte 5 with runes enforced (`compilerOptions.runes: true`), TypeScript strict
  (`noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly`), Vite,
  Tailwind 4 (CSS-first `@theme` in `src/app.css`), `@lucide/svelte` icons, IBM Plex Mono.
- Vitest, node environment, no DOM — pure logic only; `.worktrees/**` excluded from the run.
- ESLint (typescript-eslint, eslint-plugin-svelte, better-tailwindcss conflict rules) + Prettier
  (svelte + tailwind plugins); husky + lint-staged pre-commit.
- Scripts: `dev`, `dev:lan` (`HTTPS=1 vite --host`, basic-ssl for iPad), `build`
  (`svelte-check && tsc --noEmit && vite build`), `test`, `test:watch`, `lint`, `check`, `format`,
  `deploy` (`npm run build && wrangler deploy`).
- Deploy: Cloudflare Workers **assets-only** (`wrangler.jsonc`, no `main`), name
  `slop-vector-editor`.
- `index.html` PWA-ish meta (manifest, apple-touch-icon, no `viewport-fit=cover`, no user scaling)
  as in slop-animator.
- Colors: the dark blue chrome tokens from `../SLOP-TIMELINE-UI.md` (`--ground`, `--panel`,
  `--raised`, `--line`, `--text`, `--muted`, `--accent`, `--danger`, `--warn`, `--ok`,
  `--disabled`). Dark only in v1.
- Repo docs: `CLAUDE.md` (handoff index + gotchas), `README.md` (user-facing), `docs/superpowers/`
  (specs, plans, CHANGELOG).

## 3. Architecture

**Approach A (chosen):** own plain-data document model, rendered as live SVG by Svelte, with a
separate overlay SVG for handles/gizmos. The same model→SVG mapping drives both on-screen
rendering and file save, so display and export cannot drift.

Rejected: **Paper.js as model** (mutable scene graph fights `$state` + snapshot undo; canvas
render differs from SVG output; largely unmaintained — may still be used later purely as a
geometry library for booleans). **Canvas2D/WebGL renderer** (re-implements what SVG gives for
free; render/export drift; far more work).

### Source layout

```
src/
  doc/        document.ts (types, constants), ids.ts, tree.ts (find/walk/parent/insert/remove),
              edits.ts (pure (doc,args)=>doc operations — the main test surface), style.ts
  geom/       mat.ts (affine 2x3), bezier.ts (eval, split, bounds, nearest point),
              path.ts (subpath ops: add/delete/convert node, break, join, shapes→path),
              bounds.ts, hit.ts (hit-testing in doc space with screen-px tolerance),
              snap.ts, shapes.ts (polygon/star/line node generation)
  svg/        serialize.ts (Doc → SVG string), parse.ts (SVG string → Doc + dropped-feature
              report), arc.ts (SVG arc → cubic), pathdata.ts (d-string read/write)
  tools/      tool.ts (interface), select.ts, node.ts, pen.ts, shape.ts, hand.ts,
              gizmo.ts (transform-handle math)
  input/      pointer.ts (normalise pointer events → doc coords, pointer type, cancel),
              gestures.ts (two-finger pan/pinch, pencil-seen finger policy), keys.ts
  state/      appState.svelte.ts (single $state store + actions), history.ts (undo/redo),
              viewport.ts (pan/zoom math)
  persist/    file-io.ts (open/save/save-as), autosave.ts (IndexedDB), preferences.ts
  lib/        Svelte components (§5)
```

Each unit is pure where possible; only `lib/`, `input/`, `persist/` and the store touch the DOM
or browser APIs.

## 4. Document model and file format (approved section 1)

```ts
type Doc = { version: 1; artboard: { w: number; h: number; background: Paint | null };
             layers: Layer[]; nextId: number };
type Layer = { id: string; name: string; visible: boolean; locked: boolean; children: Node[] };
type Node  = Group | Shape;
type Group = { kind: 'group'; id: string; name?: string; transform: Mat; opacity: number;
               children: Node[] };
type Shape = RectShape | EllipseShape | PathShape;
type ShapeBase = { id: string; name?: string; transform: Mat; style: Style };
type RectShape    = ShapeBase & { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number };
type EllipseShape = ShapeBase & { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number };
type PathShape    = ShapeBase & { kind: 'path'; subpaths: Subpath[] };
type Subpath  = { nodes: PathNode[]; closed: boolean };
type PathNode = { p: Vec; in: Vec | null; out: Vec | null;   // handles, absolute, null = none
                  type: 'corner' | 'smooth' | 'symmetric' };
type Paint = { color: string /* #rrggbb */; opacity: number };
type Style = { fill: Paint | null; stroke: Paint | null; strokeWidth: number;
               cap: 'butt' | 'round' | 'square'; join: 'miter' | 'round' | 'bevel';
               opacity: number };
type Mat = [a: number, b: number, c: number, d: number, e: number, f: number]; // SVG matrix()
```

- Line, polygon and star are **created as paths** (tools generate nodes). Rect/ellipse stay
  parametric until "Convert to path".
> **SUPERSEDED 2026-09-16 (resize part):** resize bakes scale into geometry — see
> `2026-09-16-m2a-select-transform-shapes-design.md` §1.

- Transforms live on each node. Move/scale/rotate only change `transform`; geometry is not
  rewritten unless the user runs **Flatten transform** (v1: paths only, a context-bar action that
  bakes the matrix into the node coordinates and resets `transform` to identity; stroke width is
  left unchanged).
- The document is plain JSON-serialisable data with no class instances, so undo is a
  `structuredClone` snapshot and the store can hold it directly in `$state`.
- **Save:** `<svg xmlns viewBox="0 0 w h" width height data-sv-version="1">`, optional background
  `<rect>` marked `data-sv-background`, each layer as `<g data-sv-layer data-sv-name
  data-sv-locked [display="none"]>`, groups as `<g transform>`, shapes as `<rect>`, `<ellipse>`,
  `<path>` with `transform="matrix(…)"` and presentation attributes. Path node types go in
  `data-sv-nodes` (compact one-char-per-node string). Object names in `data-sv-name`.
- **Open:** own files round-trip losslessly (tested). Third-party SVG is best-effort: `path`,
  `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `g`, `svg` (nested → group),
  `transform` lists, presentation attributes and inline `style` properties for fill/stroke/width/
  cap/join/opacity, named/hex/rgb colors. Arcs convert to cubics; quadratics elevate to cubics;
  node types are inferred (collinear handles → smooth). Top-level `<g>`s become layers when the
  file has no `data-sv-layer` markers and contains only groups; otherwise everything goes into one
  layer. Anything else (text, `use`/`defs`, gradients, filters, CSS classes, clip/mask) is
  skipped and listed in a non-blocking notice. `viewBox` (or width/height) becomes the artboard.
- **Autosave:** document to IndexedDB on a ~3 s debounce; restored on load. Preferences
  (tool options, snap on/off, panel sizes) in localStorage.

## 5. Interaction (approved section 2)

### Tools

| Tool | Key | Behavior |
|---|---|---|
| Select | V | tap/click selects; Shift toggles; drag on empty → marquee; double-tap a group → enter it; Esc / tap outside → exit |
| Node | A | on selected path(s): tap/marquee nodes, drag nodes/handles, double-tap segment → add node, Delete → remove; context bar: corner / smooth / symmetric, break, join. Rect/ellipse offers "Convert to path" |
| Pen | P | tap = corner node, drag = smooth node; tap first node closes; Enter / Esc / Done finishes open path; starting on an open path's end node continues it |
| Rect / Ellipse / Line / Polygon-Star | R / E / L / Y | drag to create; polygon sides, star points and inner ratio in the context bar |
| Hand | H, or hold Space | pan |

New shapes take the **current style** (last used fill/stroke), shown in the properties panel when
nothing is selected.

### Transform gizmo

8 resize handles + a dedicated rotate knob. Single rotated object → gizmo in its local frame;
multi-selection → axis-aligned union box. Body drag moves. Arrow keys nudge 1 px (Shift: 10 px).
Shift constrains (proportional resize, 15° rotation, 0/45/90° moves); Alt resizes from center /
duplicates on move.

### Input parity

- **Modifier dock:** floating Shift / Alt / Snap toggles; hold with a finger while using the
  Pencil, or tap to latch. Physical keys feed the same state.
- **Context bar:** delete, duplicate, group/ungroup, z-order, node actions, convert to path.
  Right-click on desktop opens the same actions as a menu.
- **Navigation:** two-finger pan + pinch zoom (touch); wheel pan, Ctrl/⌘+wheel or trackpad pinch
  zoom, Space-drag (desktop); zoom-to-fit and 100% buttons.
- **Pencil policy:** once a Pencil (`pointerType === 'pen'`) has been seen on the canvas, a
  single finger only pans; before that, fingers act as the pointer.
- **Hit tolerance** in screen pixels: 6 px mouse, 14 px touch/pen; handles drawn larger on touch.
- Every drag surface has `touch-action: none`; `pointercancel` ends a gesture the same way as
  `pointerup`.

### Snapping (v1)

When Snap is on: artboard edges and center; other objects' bounding-box edges and centers; path
nodes (Pen / Node tools). Threshold 8 screen px. Snapped target shown as a small marker.

### Undo

One undo step per completed gesture (`beginGesture` / `amend` / `endGesture`), none for a
no-op drag. History cap 100 snapshots. Selection is not part of undo history but is pruned of
ids that no longer exist after undo/redo.

## 6. UI layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ Top bar: ☰ file menu · file name● · undo redo · zoom − % + fit        │
│ Context bar: actions for current tool / selection                     │
├────┬───────────────────────────────────────────────────┬──────────────┤
│Tool│                                                   │ Properties   │
│strip│         pasteboard + artboard (SVG)              │ (fill/stroke,│
│ V A │         + overlay SVG (gizmos, nodes, marquee)   │  X Y W H R)  │
│ P R │                              ┌──────────┐        ├──────────────┤
│ E L │                              │ Shift Alt│        │ Layers       │
│ Y H │                              │  Snap    │ dock   │ (tree)       │
├────┴───────────────────────────────────────────────────┴──────────────┤
│ Status: tool hint · cursor x,y · selection summary                    │
└───────────────────────────────────────────────────────────────────────┘
```

- **Properties panel:** fill and stroke (toggle none, native color input + hex field + opacity),
  stroke width/cap/join, object opacity; numeric X / Y / W / H / rotation of the selection
  (editing a field is one undo step). Mixed values across a multi-selection show as blank.
- **Layers panel:** tree of layers → groups → shapes; eye / lock toggles; double-tap to rename
  (inputs stay in panels, not on the canvas — slop-animator iOS keyboard gotcha); drag to reorder
  (pointer-based, `touch-action: none`); add / delete layer; tapping a row selects the object;
  a current layer receives new shapes.
- On narrow screens (portrait iPad), the right panel collapses to a toggleable drawer.
- **File menu:** New (artboard size dialog, presets + custom), Open, Save, Save As, Document
  settings (artboard size, background). Save uses the File System Access API where available
  (save in place, Chromium desktop); elsewhere (iPad Safari) Save downloads the `.svg` and Open
  uses a file input. The file name shows a dirty dot until saved.
- **Clipboard:** copy/cut/paste/duplicate within the app (pasted objects offset by 10 px);
  copy also writes the selection as SVG text to the system clipboard when permitted. Pasting
  external SVG text goes through the parser (best-effort).

## 7. Error handling

- Open: parse failure → notice, current document untouched (parse fully before replacing). Parser
  never throws on unknown content; it records it in the dropped-features report.
- Save: File System Access cancellation is silent; write failure → notice, document stays dirty.
- Autosave/IndexedDB unavailable (private mode) → one notice, editing continues.
- Model invariants enforced in `edits.ts`: unique ids, no empty groups after ungroup/delete
  (removed), at least one layer, path subpaths with ≥ 1 node (a closed subpath needs ≥ 2).
- Locked/hidden layers: their objects are not hit-testable or selectable.

## 8. Testing and verification

- Vitest unit tests for `doc/`, `geom/`, `svg/`, `tools/` logic (tool handlers are driven with
  synthetic normalised pointer events against a doc, asserting the resulting doc/selection).
- **SVG round-trip tests:** model → SVG → model is identity for every shape/style/transform/layer
  combination; fixture third-party SVGs (Inkscape, Illustrator, Figma exports) parse with the
  expected dropped-feature report.
- Canvas / touch / Pencil behavior is not node-testable: verified in desktop Chrome via browser
  automation, and on iPad by the user. Unverified surfaces are flagged, not claimed.

## 9. Delivery milestones

The implementation plan is split into milestones, each shippable and verified:

1. **Scaffold + model + render + files:** project setup, doc model, SVG serialize/parse,
   render doc on canvas with pan/zoom, open/save/autosave, undo infra.
2. **Select + transform + shapes:** select tool, gizmo, rect/ellipse/line/polygon-star tools,
   properties panel, context bar, modifier dock, clipboard, snapping.
3. **Layers + groups:** layers panel, group/ungroup, enter group, z-order.
4. **Pen + node editing.**
5. **Polish + deploy:** iPad pass, README/CLAUDE.md, Cloudflare deploy.

## 10. Roadmap (post-v1)

Text; gradients; boolean operations (possibly Paper.js as a geometry-only helper); freehand
pencil/brush → simplified bezier with pressure; PNG export; grid + smart guides; multiple
artboards; masks/clipping; align & distribute panel; light theme; system-clipboard image paste.
