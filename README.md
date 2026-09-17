# slop-vector-editor

A simple vector graphics editor that runs entirely in your browser — in the spirit of Inkscape
and Affinity Designer, but small. Works with a mouse and keyboard, and on iPad with touch and
Apple Pencil. Nothing is uploaded anywhere.

Your document is a plain `.svg` file: open it in any browser or design tool.

## Status

Early development. What works today:

- Open and save SVG files (save in place on Chromium desktop browsers; download elsewhere).
  Other tools' SVGs import best-effort — unsupported content (text, gradients, filters, CSS
  classes…) is listed when you open the file, and such files always open as a copy (Save asks
  where to write them) so the original is never overwritten with a lossy re-export.
- New document with size presets; artboard size and background (or transparent).
- Pan and zoom: drag, mouse wheel, trackpad or two-finger pinch.
- Undo/redo and automatic saving to the browser.
- Drawing rectangles, ellipses, lines, polygons and stars — polygons and stars stay editable
  (sides, star, inner ratio).
- Selecting (click, Shift-click, drag-select), moving, resizing (strokes keep their width),
  rotating (Shift snaps to 15°) and Alt-duplicating.
- The properties panel: fill, stroke, width, cap, join, opacity, and X/Y/W/H/rotation, with
  defaults for new shapes when nothing is selected.
- Convert to path and flatten transform.
- Copy, cut and paste — within the editor and as SVG with other apps.
- Snapping to the artboard and other objects while moving, resizing and drawing, with guide lines.
- An on-screen Shift/Alt/Snap pad for touch.

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
| Cancel                                          | Esc                                   |
| Nudge / nudge ×10                               | Arrows / Shift+Arrows                 |
| Duplicate                                       | ⌘D                                    |
| Cut / Copy / Paste                              | ⌘X / ⌘C / ⌘V                          |
| Snap on/off                                     | %                                     |

## Roadmap

Next: layers and groups, then pen and node editing.

## Development

```bash
npm install
npm run dev       # dev server
npm run dev:lan   # HTTPS on your LAN, for iPad testing
npm test          # 269 unit tests
npm run build     # type-check + production build
npm run deploy    # build + deploy to Cloudflare
```

Svelte 5, TypeScript, Vite, Tailwind CSS 4, Vitest.
