# M24 — Canvas rotation (design)

2026-10-20. Status: approved.

## 1. Intent

On the iPad, with the Pencil, people turn the page the way they turn paper: to place a pen-tool
curve at a comfortable angle, or just to look at the drawing from another side. Drawing apps in this
family have it (Affinity Designer and Illustrator on iPad, Procreate, Inkscape 1.x, Linearity Curve);
layout tools (Figma, Sketch) do not. This app has the Pencil, the Brush and the Pen, so it belongs
with the first group. Two sibling apps already rotate their view (slop-animator, slop-spine).

Rotation is **how you look at the page, never the page itself**.

## 2. Goals

1. **Two-finger twist on touch** rotates the view, in the same gesture as pinch-zoom and two-finger
   pan, pivoting on the fingers' midpoint.
2. **Everything works on a rotated page** — every tool (Select, Node, Pen, Brush, shapes, Gradient,
   Warp, Text), marquee, snapping, context menu, text editing. No tool is disabled or degraded while
   rotated. You can twist mid-pen-path, mid-text-session, between brush strokes, and carry on.
3. **Angles follow the page** (decided by the user): every constraint that snaps to an angle —
   Shift's 45° for lines, gradient lines and warp handles, the 15° rotate step, 0/45/90° moves — is
   measured in document space. A Shift-drawn "horizontal" line on a page turned 30° is level in the
   drawing, so it is level once the page is straight again. This is what the code does today, so it
   mostly means *not* changing it.
4. **Three ways back to upright** (decided by the user, all three):
   - **Snap on lift:** releasing a twist within 3° of 0°, 90°, 180° or 270° settles on it.
   - **Tap the angle readout** in the status bar: resets to 0° from any angle.
   - **A menu command, "Reset rotation"**, in the File menu (beside Document settings) and in the
     context menu, with shortcut **Shift+0**.
5. **Desktop: shortcut keys only** (decided by the user):
   - **`,` / `.`** turn 15° counter-clockwise / clockwise.
   - **Shift+`,` / Shift+`.`** turn 90°.
   - **Shift+0** resets.
6. **An angle readout** in the status bar, always shown (`0°` when upright), fixed width.

## 3. Non-goals

- A rotate-view tool or a drag-to-rotate on desktop; the Mac trackpad's twist. (Safari's
  `gesturechange` carries a `rotation` — `Canvas.svelte` already listens for its `scale` — but the
  user asked for keys only. Ignore `rotation` there.)
- Saving the angle: not in the file, not in prefs, not across a reload (the zoom isn't either).
- An undo step for rotation, or any effect on the dirty flag.
- An animated reset or snap.
- Mirroring the view.
- Rotating any UI: panels, top bar, dock, status bar, menus, dialogs stay put.

## 4. Anti-goals (would make it a failure even if it "works")

- **Rotation touching the document.** No edit, no undo entry, no dirty flag, no change to exported
  SVG or PNG. `View` is store state, like zoom.
- **An accidental tilt.** A plain pinch-zoom must not leave the page at 2°.
- **Breaking two-finger tap = undo / three-finger tap = redo** (`input/finger-tap.ts`). A twist moves
  fingers well past the tap's 15 px limit, so it should never read as a tap — keep it that way.
- **A mark that disagrees with what it does.** The thing drawn on screen and the thing hit-tested
  must be the same shape. E.g. a marquee drawn as one rectangle but selecting a different one, or a
  snap guide drawn screen-vertical while snapping to a document x.

## 5. Constraints (from the codebase)

- `src/state/viewport.ts`: `View = { x, y, zoom }`, `screen = doc · zoom + (x, y)`. It becomes
  `View = { x, y, zoom, rotation }` with `screen = R(rotation) · doc · zoom + (x, y)` — the same order
  as slop-animator's `core/viewport.ts` (translate · rotate · scale). `rotation` in radians, positive
  is clockwise on screen (SVG's y-down convention).
- **`zoom` stays the pure scale.** About 25 sites compute a tolerance as `px / view.zoom` (hit
  tolerances, `SNAP_PX`, `padBox`, the brush smoothing radius, the Overlay's minimum sizes). A
  rotation preserves lengths, so every one of those stays correct untouched — keep it that way; do
  not fold rotation into anything those sites read.
- `docToScreen`/`screenToDoc`, `panBy` (screen-space, unchanged), `zoomAt`, `pinch`, `fitRect`,
  `revealPan` and `wheelView` all go through the new mapping. Wheel pan stays screen-space (scroll
  down moves the page up on screen, whatever its angle).
- Invariant 12: tools never import the store; they read the view through `ToolContext.view()`,
  which already exists.
- Invariant 24: the status-bar readout has a `title` (it is also the status-bar hint). The File-menu
  and context-menu "Reset rotation" use `aria-disabled` with a reason title at 0° ("Reset rotation —
  the page is upright"), never `disabled`, never hidden.
- Invariant 50: the new keys go through `fieldPassesKey` like every other shortcut — never fire while
  a text field has focus.
- Invariant 23: a state change must not move the layout — so the readout is always present at a
  fixed width, never appearing only when rotated. The **top bar is not touched** (its breakpoints are
  measured to the pixel).

## 6. Behaviour

### 6.1 The gesture (touch)

- Two fingers: pan + zoom + rotate together, pivot = the fingers' midpoint, rotation = the change in
  the angle of the line between them. Extend `pinch()` in `viewport.ts`; `Canvas.svelte`'s pinch call
  site (≈ line 339) keeps calling it per move.
- **Snap on lift:** when the pinch ends by a lift and the angle is within **3°** of a multiple of 90°,
  set it to that multiple, pivoting on the viewport centre so the page doesn't jump. A
  `pointercancel` ends the pinch **without** snapping (slop-animator's lesson: a cancelled gesture's
  angle is whatever it was when the OS took the pointer, and snapping it twists the canvas unasked).
  Port `snappedRotation` / `SNAP_ANGLE` from slop-animator `src/core/touch-gestures.ts`; there 3° was
  tuned from 5° so an accidental tilt pops back while a deliberate 8° stays. That snap is also what
  satisfies "a plain pinch doesn't tilt" — **my call** not to add a dead zone during the gesture as
  well (slop-animator has none, and a dead zone makes the start of a deliberate twist jump).
- Normalise the stored angle to (−π, π] after every change.

### 6.2 Keys and the reset

- `,` / `.`: to the next multiple of 15° in that direction (so 37° → 30° or 45°, not 22° / 52°).
  Shift: the next multiple of 90°. **My call** — landing on round numbers keeps a reset-free route
  back to straight.
- Match `e.code` (`Comma`, `Period`, `Digit0`) with `e.shiftKey`, not `e.key`: Shift changes the
  key (`<`, `>`, `)`), and the user's Estonian layout differs from US — same reason z-order matches
  `BracketLeft`/`BracketRight`.
- Keys, the readout tap and the menu rotate about the **viewport centre**.
- No modifier other than Shift (⌘/Ctrl+`,` is the browser's / OS's).
- **Shift+0 vs zoom-in on Estonian** (builder check): `commandForKey` maps `e.key` `"="`/`"+"` to
  zoom in, and on the Estonian layout Shift+0 types `=`. The `Digit0`+Shift check runs **first**, so
  Shift+0 always resets. Nothing is lost: Estonian zooms in with its unshifted `+` key (right of 0),
  and on US `=` is its own unshifted key (`Equal`), untouched. **My call.**

### 6.3 The readout

- In `StatusBar.svelte`, beside the artboard size: a fixed-width button showing whole degrees,
  `0°`…`359°`, clockwise. **My call** on the 0–359 range (readable, no sign).
- Tap or click resets. Title: "Rotation — tap to reset (⇧0)". At 0° it still shows and the tap is a
  no-op (it's a readout first).
- A 32 px touch target on touch (invariant 23 / `test:ipad`'s size check).

### 6.4 What follows the page and what stays upright

Follow the page (drawn through the full view mapping): the artwork, the artboard and its dimmed
surround, selection frames and handles' positions, node and Bézier handles, the pen draft and rubber
band, the brush preview, gradient lines and knobs, the warp cage, the character highlight, the text
caret and selection rectangles, snap guides.

Stay screen-upright: handle **knobs** are drawn as screen-aligned squares/circles at their mapped
positions (today's behaviour for a rotated object — unchanged), the brush size ring, the context
menu, every panel.

### 6.5 Per-area rules

- **Rendering.** `Canvas.svelte`'s `<g transform="matrix(zoom 0 0 zoom x y)">` takes the rotated
  matrix. The dimmed surround (`hole`, ≈ line 136) is built from four screen-mapped artboard corners,
  not from `x/y/w/h`.
- **Overlay rule:** anything derived from document geometry is mapped **point by point** with
  `docToScreen` and drawn as a polygon/polyline — never as a screen `<rect>` from two mapped corners.
  The known offender is the marquee (`Overlay.svelte` ≈ 125–128, 549); the builder audits the
  Overlay's other `<rect>`s against this rule.
- **Marquee: screen-aligned** — **my call**. What you drag is the rectangle you see on screen. In
  document space it is a rotated rectangle, so `marqueeSelect` (`geom/hit.ts`) must test against a
  quad (four document points), not a `Box`. Drawn as that same rectangle on screen. The select tool
  builds the quad from the press and current screen points through `screenToDoc`.
- **Rect, ellipse and polygon drags are square to the page** (decided by the user): the two document
  points the drag tool already builds from stay as they are, so a rectangle drawn on a page turned
  30° is an ordinary unrotated rectangle in the file and looks tilted on screen while drawing; the
  finger traces its diagonal. Shift's square/circle, snapping and Alt-from-centre keep working in
  document space unchanged. (The marquee is the deliberate exception: it creates nothing.)
- **Snap guides** follow the page: a guide at document x is the line through that x along the
  document's y axis, mapped to screen and clipped to the viewport (`Overlay.svelte` ≈ 559–570 today
  draws a full-height screen line at `docToScreen(x).x`).
- **Snapping, resize, Shift constraints** stay in document space — unchanged (Goal 3). "Resize
  snaps only unrotated frames" (invariant 20) still means unrotated in the document.
- **Handles (`gizmo.ts`).** Padding, the push-outside rule and dropping side midpoints are lengths in
  screen px, which a rotation preserves, so they need no change — confirm with a test at 30°.
  **The rotate knob does need one** (builder check): `handlePositions` offsets it 24 screen px from
  the top-edge midpoint along `f.angle`, the object's angle on the page; on a turned view that must
  be `f.angle + view.rotation`, or the knob sits off the frame's axis. It **follows the page** —
  beyond the object's own top edge, so at a 180° view it is below the object on screen, exactly as
  for an object rotated 180° today. `frame.ts`'s fold of a mirrored frame's angle stays in document
  terms. **My call**, consistent with Goal 3.
- **Hover cursors.** A directional CSS cursor (the Gradient tool's `ew-resize` on the midpoint, any
  resize cursors) is computed for the document axes; on a rotated view it points the wrong way. The
  builder rotates the choice by the view angle, or falls back to a non-directional cursor where that
  is simpler — mouse-only, low stakes, **builder's call**.
- **Text editing (invariant 49).** The hidden textarea sits at the caret's screen position (mapped
  through world · view); `revealPan` receives the screen bounding box of the rotated caret rectangle.
  The textarea itself is not rotated.
- **Brush.** Points are mapped through the view at the moment they are accepted, so a twist
  mid-stroke keeps the ink under the pen — that already holds once `screenToDoc` rotates.
- **Fit artboard (⌘0)** keeps the angle and fits the turned artboard's screen bounding box.
  **Zoom to 100% (⌘1)** keeps the angle.
- **Document replaced** (New, Open, autosave restore — `replaceDocument`): angle back to 0°.
  Document settings' Apply (resize) keeps it.
- **Cursor readout** in the status bar stays in document coordinates — unchanged.
- **PNG/SVG export, copy as PNG:** unaffected — they render the document, not the view. Confirm that
  nothing in `persist/png.ts` reads `app.view`.

## 7. Testing

- Unit (Vitest): `docToScreen`/`screenToDoc` round-trip at several angles; `pinch` with a pure twist
  (pivot fixed, angle changes), a pure zoom (angle unchanged); `snappedRotation` (inside/outside 3°,
  near 360°/−180°); the 15°/90° step rule; `fitRect` at 30° and 90°; `revealPan` with a rotated
  caret; `marqueeSelect` with a rotated quad; the key mapping by `code` with Shift.
- `npm run test:ipad`: one `[sim]` two-finger twist check — the readout changes, a plain pinch with
  a <3° twist leaves `0°`, tapping the readout restores `0°`. Read its screenshot.
- Browser (desktop): `,` `.` Shift variants and Shift+0; draw with each tool at 30°; marquee at 30°;
  a Shift-line at 30° is level in the file; snap guides at 30°; text editing at 30°.
- iPad pass owed (`IPAD-CHECKLIST.md`): the real twist (feel, pivot, snap), twisting mid-pen-path
  and mid-text-session, a twist never firing two-finger undo, the Pencil at an angle, the keyboard
  and auto-pan while rotated.

## 8. Left to the builder

Task split and order; whether `pinch()` takes the angle from the two points itself or as an
argument; the exact Overlay audit; directional cursors (6.5); where in the File menu exactly the
command sits; the readout's exact width.

## 9. Calls made without the user (check these)

- Snap on lift within 3° of 0/90/180/270, no dead zone during the twist; a cancelled pinch never
  snaps.
- Keys step to the next multiple of 15° / 90°, not by ±15° / ±90°.
- The readout shows 0–359°, clockwise, always visible; tapping it at 0° does nothing.
- The marquee is screen-aligned (selects a rotated rectangle in document space).
- New / Open / restore reset the angle; Document settings' resize keeps it; Fit and 100% keep it.
- Rotation is about the viewport centre for keys, reset and the readout.
