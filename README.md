# slop-vector-editor

A simple vector graphics editor that runs entirely in your browser — in the spirit of Inkscape
and Affinity Designer, but small. Works with a mouse and keyboard, and on iPad with touch and
Apple Pencil. Nothing is uploaded anywhere.

Your document is a plain `.svg` file: open it in any browser or design tool.

**[Try it → slop-vector-editor.meigo.workers.dev](https://slop-vector-editor.meigo.workers.dev)**

![The editor with a vectorised drawing open: the tool strip, a canvas holding a sketched portrait and a red circle, a selected vertical title reading “SLOP VECTOR EDITOR” with its per-character randomiser settings in the properties panel, the layers panel, and the on-screen modifier pad](docs/screenshot.png)

## Status

What works today:

- Open and save SVG files (save in place on Chromium desktop browsers; on iPad, Save, Save As
  and Export PNG offer the share sheet's **Save to Files** so you choose the destination — Save
  and Save As open it directly, Export via a confirmation dialog since rasterising takes a moment
  and the original tap has expired by then; Save and Save As are the same action there, and it's
  still a new file each time, not an overwrite; other browsers download). Other tools' SVGs
  import best-effort — unsupported content (their `<text>`
  elements, gradients, filters, CSS classes…) is listed when you open the file, and such files
  always open as a copy (Save asks where to write them) so the original is never overwritten with
  a lossy re-export.
- New document with size presets; artboard size and background (or transparent).
- Pan and zoom: drag, mouse wheel, trackpad or two-finger pinch.
- Undo/redo and automatic saving to the browser.
- Drawing rectangles, ellipses, lines, polygons and stars — polygons and stars stay editable
  (sides, star, inner ratio).
- Selecting (click, Shift-click, drag-select), moving, resizing (strokes keep their width),
  rotating (Shift snaps to 15°) and Alt-duplicating. On an object too small to hold them, the
  resize handles move outside it, so its middle stays grabbable.
- The properties panel: fill, stroke, width, cap, join, opacity, and X/Y/W/H/rotation, with
  defaults for new shapes when nothing is selected.
- Convert to path and flatten transform.
- Copy, cut and paste — within the editor and as SVG with other apps.
- Snapping to the artboard and other objects while moving, resizing and drawing, with guide
  lines — including other paths' nodes while editing one.
- The Properties and Layers panels split one column, with a divider you can drag and a chevron on
  each to fold it away. Properties folds itself away when nothing is selected — click its header to
  reach the new-shape defaults, and it stays open until you select something.
- An on-screen Shift/Alt/Snap pad for touch. Snap is always there; the Shift and Alt latches fold
  away behind a chevron, and open themselves the first time you use a finger or a Pencil.
- An icon toolbar with tooltips (also shown in the status bar); on touch, where there is no hover
  and no tooltip, pressing a control shows its label — or, for one that is unavailable, the reason
  — in the status bar. Shape options (corner radius, polygon sides/star) live in the properties
  panel.
- **Artistic titles**: place a title with the Text tool (T) and type it in the properties panel —
  choose a font, size, letter-spacing, line height and alignment, and press Return for a second line, then **randomise the characters** — rotation,
  scale, baseline and skew, each by its own amount, with a seed you can re-roll until you like it. Click a single character to tweak just that
  one by hand, or drag it — your changes survive a re-roll of the rest. The title is outlined to paths, so it looks the
  same on every machine and can be combined, node-edited and recoloured like any other artwork,
  while staying re-typeable. Drop in your own `.ttf`, `.otf` or `.woff`.
- Layers: a layers panel with show/hide, lock, rename, drag to reorder, and a current layer for
  new shapes; z-order (bring forward/backward, to front/back). **Every shape and group has its own
  eye and lock too** — a hidden or locked object can't be clicked, dragged or marquee-selected, and
  its row in the panel is how you get it back.
- Hidden content in other tools' files is kept, not thrown away: `display:none` and
  `visibility:hidden` come in as hidden objects you can switch back on.
- Groups: group and ungroup (⌘G / ⇧⌘G), double-click to work inside a group, nested rows in the
  layers panel.
- Node editing: double-click a path with the Select tool, or press N, to edit its nodes — move
  nodes and handles, add and delete nodes, change node type and close a path.
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
| Finish a path                                   | Enter                                 |

## Roadmap

Unplanned: gradients; a freehand pencil/brush tool; grid and smart guides; masks/clipping;
align & distribute; system-clipboard image paste.

## Development

```bash
npm install
npm run dev       # dev server
npm run dev:lan   # HTTPS on your LAN, for iPad testing
npm test          # 734 unit tests
npm run build     # type-check + production build
npm run deploy    # build + deploy to Cloudflare
```

Svelte 5, TypeScript, Vite, Tailwind CSS 4, Vitest.

## Deploy

`npm run deploy` builds and publishes to Cloudflare (assets-only Worker); it needs `wrangler`
auth. The live demo above is that deploy.

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
