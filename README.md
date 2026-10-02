# slop-vector-editor

A simple vector graphics editor that runs entirely in your browser — in the spirit of Inkscape
and Affinity Designer, but small. Works with a mouse and keyboard, and on iPad with touch and
Apple Pencil. Nothing is uploaded anywhere; fonts you pick from the Google Fonts library are
downloaded, from jsDelivr rather than Google, and kept for offline use.

Your document is a plain `.svg` file: open it in any browser or design tool.

**[Try it → slop-vector-editor.meigo.workers.dev](https://slop-vector-editor.meigo.workers.dev)**

![The editor with a vectorised drawing open: the tool strip, a canvas holding a sketched portrait and a red circle, a selected vertical title reading “SLOP VECTOR EDITOR” with its text settings — font, size, spacing, line height and alignment — in the properties panel, the layers panel, and the Snap toggle](docs/screenshot.png)

## Status

What works today:

- Open and save SVG files (save in place on Chromium desktop browsers; on iPad, Save, Save As
  and Export PNG offer the share sheet's **Save to Files** so you choose the destination — Save
  and Save As open it directly, Export via a confirmation dialog since rasterising takes a moment
  and the original tap has expired by then; Save and Save As are the same action there, and it's
  still a new file each time, not an overwrite; other browsers download). Other tools' SVGs
  import best-effort — unsupported content (their `<text>`
  elements, gradients with more than three stops or a focal point, filters, CSS classes…) is
  listed when you open the file, and such files
  always open as a copy (Save asks where to write them) so the original is never overwritten with
  a lossy re-export.
- Import an SVG into the open document — File ▸ Import SVG…, or drop `.svg` files on the canvas.
  The drawing goes into the current layer, centred in the view and selected, as one undo step;
  unsupported content is listed, as when opening.
- New document with a name and size presets; artboard size and background (or transparent).
- A document name, set in New document or Document settings (tap the name in the top bar): Save,
  Save to Files and Export PNG all use it, so a drawing keeps one file name across saves.
- Pan and zoom: drag, mouse wheel, trackpad or two-finger pinch.
- Undo/redo and automatic saving to the browser. On a touch screen, tap with two fingers to undo
  and three to redo.
- Context menu: right-click with a mouse, or press and hold with a finger or the Pencil.
- On iPad, once the Pencil has been used a finger only pans and zooms (so a resting finger never
  draws or selects). The pointing-finger button in the modifier dock ("Fingers select") lets a
  quick finger tap select again with the Select, Node, Text and Gradient tools.
- Drawing rectangles, ellipses, lines, polygons and stars — polygons and stars stay editable
  (sides, star, inner ratio).
- Selecting (click, Shift-click, drag-select), moving, resizing (strokes keep their width;
  corner handles keep the proportions, Shift stretches freely, edge handles stretch one way),
  rotating (Shift snaps to 15°) and Alt-duplicating. On an object too small to hold them, the
  resize handles move outside it, so its middle stays grabbable.
- The properties panel: fill, stroke, width, cap, join, opacity, and X/Y/W/H/rotation, with
  defaults for new shapes when nothing is selected. The last fill, stroke, width, cap, join or
  opacity you set on a selection also becomes the default for the next shape you draw. Every
  number can be typed or dragged sideways — the artwork follows live, a drag is one undo step,
  and Shift makes it finer.
- Convert to path and flatten transform.
- Flip horizontal (⇧H) and vertical (⇧V), from the Object menu, the right-click menu or the top
  bar's flip buttons on wide windows: the selection is mirrored about its own centre, and titles
  and polygons stay editable.
- **Align and distribute**, in an Align section at the top of the Properties panel and in the
  Object menu: align left, centre, right, top, middle or bottom — several objects to each other,
  a single object to the artboard — and distribute three or more with equal gaps, horizontally or
  vertically. Everything stays editable; each command is one undo step.
- Copy, cut and paste — within the editor and as SVG with other apps.
- Snapping to the artboard and other objects while moving, resizing and drawing, with guide
  lines — including other paths' nodes while editing one.
- The Layers and Properties panels split one column, Layers on top, with a divider you can drag
  and a chevron on each to fold it away. Properties folds itself away when nothing is selected —
  click its header to reach the new-shape defaults, and it stays open until you select something.
  Opening and closing it never shifts the layer list; a selected row that would be hidden scrolls
  just into view.
- An on-screen Shift/Alt/Snap pad for touch. Snap is always there; the Shift and Alt latches fold
  away behind a chevron, and open themselves the first time you use a finger or a Pencil. A latched
  Shift also adds layer rows to the selection, so several objects can be picked from the panel.
- An icon toolbar with tooltips (also shown in the status bar); on touch, where there is no hover
  and no tooltip, pressing a control shows its label — or, for one that is unavailable, the reason
  — in the status bar. On narrower windows some icon groups fold away (flip first, clipboard
  last); their commands stay in the menus at every width. Shape options (corner radius, polygon sides/star) live in the properties
  panel.
- **Artistic titles**: place a title with the Text tool (T) and type it right on the canvas — the whole
  text is selected, so typing replaces “Text”. To edit one later, double-click it with the Select tool or
  click it with the Text tool: a caret appears where you clicked. Drag, Shift and the arrow keys, ⌘A and a
  double-click on a word select text; ↑ and ↓ move between lines; paste replaces a selection; Escape (or
  a click elsewhere) finishes, and the whole session is one undo step. Selecting exactly one character
  gives you the Character block below, and dragging that character moves it. On an iPad the on-screen
  keyboard comes up and the canvas pans to keep the caret above it; if Chrome leaves the app shifted
  after the keyboard closes, use Safari or the Home Screen app. The properties panel's text field still
  edits the same string —
  choose a font, size, letter-spacing, line height and alignment, and press Return for a second line, then **randomise the characters** — rotation,
  scale, baseline and skew, each by its own amount, with a seed you can re-roll until you like it. Click a single character to tweak just that
  one by hand, or drag it — your changes survive a re-roll of the rest. The title is outlined to paths, so it looks the
  same on every machine and can be combined, node-edited and recoloured like any other artwork,
  while staying re-typeable. Drop in your own `.ttf`, `.otf` or `.woff`, or add one from the
  **Google Fonts** library (~2000 open-licensed families) via Add a font… ▸ From Google Fonts…:
  search and pick a family and it downloads — from jsDelivr, never Google — only then, and stays
  available offline afterwards. **Weight** and **Italic** are selectable wherever the family
  offers them.
- Layers: a layers panel with show/hide, lock, rename, drag to reorder (by a row's grip: the row
  follows the pointer and its place in the list moves to where it will land), and a current layer for
  new shapes; z-order (bring forward/backward, to front/back). **Every shape and group has its own
  eye and lock too** — a hidden or locked object can't be clicked, dragged or marquee-selected, and
  its row in the panel is how you get it back; a closed eye or a shut lock shows in yellow. The panel's trash deletes the selected objects when
  anything is selected, and the current layer only when nothing is — click a layer's name to
  select the layer itself.
- Hidden content in other tools' files is kept, not thrown away: `display:none` and
  `visibility:hidden` come in as hidden objects you can switch back on.
- Groups: group and ungroup (⌘G / ⇧⌘G), double-click to work inside a group, nested rows in the
  layers panel.
- Node editing: double-click a path with the Select tool, or press N, to edit its nodes — move
  nodes and handles, add and delete nodes, change node type and close a path. Corner retracts a
  node's handles into a sharp point; Smooth and Symmetric line them up, growing any the node lacks.
  Delete selected nodes with ⌫, the top bar's Delete (which deletes nodes, not the path, while
  nodes are selected), or the Delete node button in the Node section — the touch route.
- Pen: draw paths node by node (P) — click for corners, drag for curves, click the first node to
  close, or pick up an open path where you left it.
- Installs to the Home Screen and runs standalone (web app manifest + icon).
- Select All and Invert Selection; Select Same Fill Colour, Stroke Colour, Style or Kind, from the
  current selection — in a Select menu in the top bar and in the right-click menu.
- Boolean operations: Unite, Subtract, Intersect and Exclude, on two or more selected shapes — in a
  Path menu in the top bar (with icons on wider windows) and in the right-click menu. The result
  replaces the shapes it was made from; undo brings them back.
- Path operations, in the same Path menu (menu only, no icons): **Subdivide** (add a node to the
  middle of every segment), **Reverse direction**, **Break apart** (a multi-part path back into
  separate shapes) and its inverse **Combine**, and **Simplify** (fewer nodes, same shape).
  Reverse, Subdivide and Break apart work on paths — convert a rectangle, ellipse or polygon first
  (Object ▸ Convert to path); Combine converts its shapes for you, since the result can't stay a
  live rectangle or ellipse. To cut a hole in a shape: convert both to paths, reverse the one that
  should become the hole, then Combine — reversing after combining flips both and leaves no hole.
- **PNG export**: File ▸ Export PNG… offers the whole artboard or just the current selection, a
  scale multiplier with a live pixel readout, and a transparent-background toggle (on by default
  for a selection, off for the artboard). Edit ▸ Copy as PNG puts the artboard on the clipboard at
  1× for pasting straight into another app.
- **Gradients**: linear and radial gradients on fill and stroke (two stops, colour + opacity
  each). Pick Flat/Linear/Radial in the Properties panel — a Type row shows which the selection
  has — or use the Gradient tool (G): drag across the selection to draw one, in whichever type is
  current. A linear gradient has a knob at each end and the line between; a radial one has a
  centre knob and two rim knobs — drag the centre or a line to move the whole gradient, one rim to
  stretch the circle into an ellipse, the other to rotate and scale it (Shift snaps that one to
  45°, or keeps the stretch perpendicular). Knobs are shaped by what they do — a circle for the
  start or centre, a square for the end or the stretching rim, a ring for the rim that rotates
  and scales. A small diamond on the line is the **midpoint**, where the two colours mix 50/50:
  drag it, or use the Midpoint slider under the gradient's Start row, to push the blend toward one
  end. Its colour is automatic — the mix of the two ends — until you give it one: edit the Mid
  colour row (or click the diamond to pick it), and a colour can hold its strength out to the
  diamond before fading. Auto puts the mix back. Linear and radial gradients from other apps'
  SVGs are kept when they have two or three stops — a three-colour gradient opens with its middle
  colour.
- **Warp**: select something, press W (or the tool strip's envelope icon), and drag any of the four
  corners or eight handles to bend everything selected through one cage. Enter applies it as one
  undo step; Esc cancels. Shift snaps a drag to 45°. The result is ordinary paths — polygons,
  rectangles, ellipses and titles stop being live, and a notice says which — and gradients move
  with the shape. A heavy warp can add nodes; Path ▸ Simplify sheds them.
- **Brush**: press B (or the tool strip's brush icon) and draw. With an Apple Pencil the stroke's
  width follows pressure; a mouse or a finger draws an even line. Each stroke is a filled shape
  in the current stroke colour, simplified to a few nodes, and one undo step. Esc drops a stroke in
  progress. The Properties panel shows the Brush settings while the tool is active: **Size**,
  **Pressure** (how far pressure swings the width), **Taper** (thin ends), **Stream** (a rope that
  lags behind the pen to steady it) and **Smooth** (rounds the path off).

## Keyboard

| Action                                          | Keys                                  |
| ----------------------------------------------- | ------------------------------------- |
| Open / Save / Save As                           | ⌘O / ⌘S / ⇧⌘S (Ctrl on Windows/Linux) |
| Undo / Redo                                     | ⌘Z / ⇧⌘Z (or Ctrl+Y)                  |
| Zoom in / out                                   | `=` / `-`                             |
| Fit artboard / 100%                             | ⌘0 / ⌘1                               |
| Select / Rect / Ellipse / Line / Polygon / Hand | V / R / E / L / Y / H                 |
| Pan                                             | Space + drag                          |
| Delete                                          | Delete / Backspace                    |
| Cancel / Deselect                               | Esc                                   |
| Nudge / nudge ×10                               | Arrows / Shift+Arrows                 |
| Duplicate                                       | ⌘D                                    |
| Cut / Copy / Paste                              | ⌘X / ⌘C / ⌘V                          |
| Snap on/off                                     | %                                     |
| Select All / Invert Selection                   | ⌘A / ⇧⌘A                              |
| Bring forward / Send backward                   | ⌘] / ⌘[                               |
| Bring to front / Send to back                   | ⇧⌘] / ⇧⌘[                             |
| Group / Ungroup                                 | ⌘G / ⇧⌘G                              |
| Edit nodes                                      | N                                     |
| Pen                                             | P                                     |
| Text                                            | T                                     |
| Gradient tool                                   | G                                     |
| Warp tool                                       | W                                     |
| Brush tool                                      | B                                     |
| Flip horizontal / vertical                      | ⇧H / ⇧V                               |
| Finish a path                                   | Enter                                 |

## Roadmap

Unplanned: gradients with more than three stops, focal points; grid and smart guides;
masks/clipping; system-clipboard image paste; paragraph text and text
shaping for complex scripts (bold/italic weight and style are done).

## Development

```bash
npm install
npm run dev       # dev server
npm run dev:lan   # HTTPS on your LAN, for iPad testing
npm test          # 1389 unit tests
npm run test:ipad # iPad smoke check in WebKit (Safari's engine); first run: npx playwright install webkit
npm run build     # type-check + production build
npm run deploy    # iPad smoke check, then build + deploy to Cloudflare
```

Svelte 5, TypeScript, Vite, Tailwind CSS 4, Vitest.

## Deploy

`npm run deploy` runs the iPad smoke check first (`predeploy`; a failure stops the deploy), then
builds and publishes to Cloudflare (assets-only Worker); it needs `wrangler` auth. The live demo above is that deploy.

## Licence

MIT — see [LICENSE](LICENSE).

### Bundled fonts

Four typefaces ship with the editor, each under the [SIL Open Font License 1.1](https://openfontlicense.org),
with its licence text beside it in `src/text/fonts/`:

| Font                                                             | Copyright                      |
| ---------------------------------------------------------------- | ------------------------------ |
| [Anton](https://fonts.google.com/specimen/Anton)                 | The Anton Project Authors      |
| [Bebas Neue](https://fonts.google.com/specimen/Bebas+Neue)       | The Bebas Neue Project Authors |
| [Archivo Black](https://fonts.google.com/specimen/Archivo+Black) | The Archivo Project Authors    |
| [Righteous](https://fonts.google.com/specimen/Righteous)         | The Righteous Project Authors  |

The OFL is separate from this project's MIT licence and continues to govern the fonts themselves.

Fonts added from the Google Fonts library are downloaded, on demand, under whichever of the SIL
Open Font License 1.1, the Apache License 2.0 or the Ubuntu Font Licence 1.0 that family ships
under — shown in the Google Fonts dialog when you pick it.
