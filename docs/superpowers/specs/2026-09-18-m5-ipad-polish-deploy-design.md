# slop-vector-editor — milestone 5 design: iPad polish and deploy

Date: 2026-09-18. Status: approved in brainstorming. Closes the milestone list in the project design
(`2026-09-16-slop-vector-editor-design.md` §9.5: "iPad pass, README/CLAUDE.md, Cloudflare deploy").
Follows M4b (`2026-09-18-m4b-pen-tool-design.md`).

**No device is available for this milestone.** Every touch and Pencil behaviour below is built from
the pure routing rules and verified with synthetic pointer events in desktop Chrome; none of it may
be recorded as device-verified. §10 lists exactly what that leaves owed.

## 1. Scope

In:

- **Palm-before-Pencil routing** (§2) — a Pencil takes over from fingers already on the glass, and
  fingers never interrupt a running Pencil or mouse gesture;
- **a small-object handle policy** (§3) — resize handles move outside an object too small to hold
  them, so its interior stays grabbable;
- **the drawer covering the modifier dock** at iPad-portrait widths, and the notices sitting on both
  (§4);
- **discoverability by touch** (§5) — an icon-only bar whose every label lives in a `title` is
  unreadable on a device with no hover;
- **the Snap button's missing `touch-action`** (§6);
- **deploy preparation** (§7) — a web manifest, an apple-touch-icon, and `public/_headers` with
  immutable asset caching and a Content-Security-Policy;
- **the docs** (§8): README, CLAUDE.md, CHANGELOG.

Out:

- **Running the deploy.** `npm run deploy` is the user's to run: it is their Cloudflare account, and
  publishing is an outward-facing action. This milestone leaves it ready and stops.
- **Accessibility and keyboard work** — Space not activating a focused button, the Modal focus trap,
  File-menu keyboard navigation, `aria-current`/`aria-selected` on layer rows, the PaintField
  opacity label, `.ui-mixed`'s contrast. Parked, as a group, for a milestone of its own.
- **Performance** — the id index for `findNode`, layer-row measurement caching, `collectTargets`
  recomputing every bounds per pointer-down, `nearestOnSubpath`'s cost.
- **Safe-area insets.** `index.html` deliberately omits `viewport-fit=cover`, and that stays. Without
  it iOS insets the visual viewport itself, so no app chrome can land under the home indicator;
  adopting `cover` would make the page edge-to-edge and *create* the padding problem this milestone
  cannot verify a fix for. The existing `#app { position: fixed; inset: 0 }` and
  `overscroll-behavior: none` already stop the rubber-banding they were added for.
- Everything on the post-v1 list (project design §10).

## 2. Palm-before-Pencil routing

`src/input/route.ts` decides what a pointer-down does. Two gaps show up only on a device:

1. **A resting palm blocks the Pencil.** A palm lands first, `routePointerDown` returns `"pan"` for
   it, and the Pencil that follows hits `if (i.activePointers >= 1) return "ignore"` — the stroke
   never starts. On an iPad this is the difference between a usable editor and an unusable one.
2. **Palm rejection during a stroke is emergent, not stated.** A finger that arrives while a Pencil
   gesture runs is rejected today only because `activeTouches` happens to be 0, so the `"pinch"`
   rule doesn't fire first. Any future change to the counting resurrects the bug.

`RouteInput` gains one field and the function two rules:

```ts
export type RouteInput = {
  …
  /** A pen or mouse gesture is already running: fingers must not interrupt it. */
  penActive: boolean;
};

export function routePointerDown(i: RouteInput): Route {
  // A finger never interrupts a Pencil or mouse gesture — that is a palm, not an intent (§2.2).
  if (i.pointerType === "touch" && i.penActive) return "ignore";
  // A Pencil takes over from fingers already on the glass: a resting hand must not stop a stroke
  // before it starts (§2.1). Only fingers are overridden — a second pen or a mouse is not.
  const takesOver =
    i.pointerType === "pen" && i.activePointers > 0 && i.activePointers === i.activeTouches;
  if (!takesOver) {
    if (i.pointerType === "touch" && i.activeTouches >= 1) return "pinch";
    if (i.activePointers >= 1) return "ignore";
  }
  // …the existing mouse-button, space/hand and pencilSeen rules, unchanged.
}
```

The takeover deliberately falls through to the ordinary rules rather than returning `"tool"`
directly, so the Hand tool and a held Space still pan with a Pencil.

`Canvas.svelte` carries the consequence: when a pointer-down routes to `"tool"` or `"pan"` while a
gesture is already running, it ends that gesture before starting the new one. A pan and a pinch
change only the view, so there is nothing to roll back and no document edit to lose. The fingers
that were panning stay down and are ignored for the rest of their life — they must not resume the
pan when the Pencil lifts, and must not start a pinch mid-stroke (`penActive` now says so outright).

## 3. The small-object handle policy

Today a handle is drawn on the frame, and its reach is `size / 2 + 2` px — 6 for a mouse, 10 for
touch. An object smaller than about twice that is entirely covered by its own handles: every press
resizes it and none moves it. CLAUDE.md invariant 14 records this as known, with a policy owed to
M5.

**Handles move outside the object.** The frame outline still draws the true geometry; only the
handles are pushed out, so the interior stays grabbable and the object keeps its real size on screen.

- `reach = size / 2 + 2`, and an axis is **tight** when its on-screen length is under
  `MIN_SPAN = 3 * reach` — 18 px for a mouse, 30 px for touch. Three reaches is the smallest span
  that leaves a reach-wide gap between the two opposite handles.
- A tight, **non-zero** axis is expanded symmetrically to `MIN_SPAN`, outward from the frame, in
  frame space (`MIN_SPAN / zoom` document units). A **zero**-size axis is left alone: CLAUDE.md
  invariant 14 has a horizontal or vertical line draggable by its middle because `activeHandles`
  drops the handles that would act on a zero axis, and padding would put four separated corner
  handles back on it.
- The expansion is applied in `handlePositions`, which both the overlay and `handleAt` read, so
  drawing and hit-testing can never disagree. `frameOutline` asks for the unpadded positions and
  keeps drawing the true frame.

`handlePositions(f, view)` therefore gains an optional handle size — with it, the positions are
padded; without it, they are exact:

```ts
export function handlePositions(f: Frame, view: View, size?: number): Record<Handle, Vec>;
```

**The resize maths need no change.** `select.ts` computes `grab = handleFramePoint(handle, box) −
pressedPoint`, so a press on a pushed-out handle carries an offset that puts the drag back on the
true corner. The rotate handle is derived from the `n` position and so moves out with it, which is
what keeps it clear of a small shape.

## 4. The drawer, the dock and the notices

Below the 900 px breakpoint the Properties/Layers column renders as an overlay drawer
(`absolute inset-y-0 right-0 z-20`, 240 px wide). The modifier dock is `absolute right-3 bottom-3
z-10` and the notices are `fixed right-3 bottom-10 z-40`. At iPad portrait (744–834 px) an open
drawer covers the dock completely — the Shift and Alt latches, which touch needs most, are exactly
what disappears — and notices paint on top of the drawer.

Both move aside while the drawer is open, and only at widths where the drawer is an overlay:

- the dock and the notices sit at `right-63` (the drawer's 240 px plus the usual 12 px gutter) when
  `app.propertiesOpen` is true and the viewport is under 900 px, and at `right-3` otherwise;
- classes stay one expression per element, per CLAUDE.md invariant 23 — no `class:` directive over a
  positioned base;
- nothing changes at 900 px and above, where the column is docked in the flow and the dock already
  clears it.

## 5. Discoverability by touch

`hintFrom` returns `null` for any pointer type other than `"mouse"`, and iPadOS Safari shows no
tooltip for a `title`. On a device, an icon-only top bar therefore explains nothing at all, and an
`aria-disabled` button's reason ("Cut — nothing selected") is unreachable — the one place the app
tells the user *why* an action is unavailable.

**A press shows the hint.** On a non-mouse pointer-down the status bar shows the pressed control's
nearest `title`, the same string a mouse gets on hover, through the same `app.hoverHint` channel:

- the hint is set from the pressed element and stays until another press replaces it or a press
  lands on something with no title;
- it costs no long-press timer, no new surface and no change to any `title`;
- an `aria-disabled` control is not activated by the press, so this is exactly how its reason
  becomes readable;
- a mouse keeps hover as it is. The canvas itself carries no `title`, so drawing never disturbs the
  hint.

CLAUDE.md invariant 24 is amended: the status bar shows the hovered element's title on mouse, and
the pressed element's title on touch and pen.

## 6. The Snap button's `touch-action`

`ModifierDock.svelte` sets `touch-action: none` on the Shift and Alt latches but not on the Snap
toggle beside them, so a touch that begins on Snap can still be claimed as a scroll or a double-tap
zoom. It gets the same inline style as its neighbours.

## 7. Deploy preparation

The Worker config already exists and stays as it is: assets-only, no `main`, `./dist`. What is
missing is everything the browser asks for when the app is installed or cached.

- **`public/manifest.webmanifest`**, linked from `index.html`: `name` "slop vector editor",
  `short_name` "slop vector" (matching the existing `apple-mobile-web-app-title`), `start_url` "/",
  `display` "standalone", `orientation` "any", `background_color` and `theme_color` `#1e1e22` (the
  value already in the `theme-color` meta), and both icons below. The existing
  `apple-mobile-web-app-*` meta tags stay — iOS reads those, not the manifest.
- **`public/apple-touch-icon.png`**, 180×180, rendered from `public/favicon.svg` on the existing
  `#1e1e22` background (iOS does not composite transparency; it fills it black). Linked with
  `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`. It is generated once and committed
  as a binary asset — no image dependency is added to the project.
- **`public/_headers`**, which the assets-only Worker serves:
  - `/assets/*` gets `Cache-Control: public, max-age=31536000, immutable` — Vite fingerprints those
    filenames, so they are safe to cache forever. Everything else stays default (revalidated), so a
    deploy is picked up on the next load.
  - Every path gets a Content-Security-Policy: `default-src 'self'`, `script-src 'self'`,
    `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `font-src 'self'`,
    `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`,
    `frame-ancestors 'none'`. `'unsafe-inline'` for styles is required and not incidental: the
    overlay and `svg/attrs.ts` set `style` attributes on every rendered element, which CSP counts as
    inline styles. Scripts need no such exception.
  - Plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- The policy is **verified against the built app**, not reasoned about: a production build served
  with the same policy, exercised through draw, save, open and autosave, with the console watched
  for CSP violations.

## 8. Documentation

README gains nothing user-facing except the install/standalone note; CLAUDE.md records the routing
rule, the handle policy and the amended invariant 24; the CHANGELOG entry carries the usual
`Browser-verified:` and `Owed:` lines. The README's roadmap line moves from "iPad polish and deploy"
to the post-v1 list.

## 9. Testing

- **Unit (Vitest, node):**
  - `routePointerDown`: a Pencil down over one, two and three resting fingers routes to the tool; a
    Pencil over another pen is ignored; a finger during a pen or mouse gesture is ignored rather than
    starting a pinch; the Hand tool and a held Space still pan with a Pencil; every existing case
    keeps its current answer.
  - `handlePositions`/`handleAt`: a tight axis is expanded to `MIN_SPAN` and a wide one is untouched;
    a zero-size axis is never padded; the padding is symmetric about the frame and survives rotation;
    the rotate handle follows the padded `n`; `frameOutline` is unchanged; a press on a pushed-out
    handle returns that handle; the interior of a small object returns no handle.
  - `hintFrom`: a `title` is returned for touch and pen as well as mouse.
- **Build:** 0 errors, 0 warnings; lint and format clean.
- **Browser (controller, port 5198, screenshots):** synthetic `PointerEvent`s with
  `pointerType: "pen"` and `"touch"` for the takeover and the palm rejection, including that the
  resting fingers do not resume the pan when the Pencil lifts; a 20×20 object showing pushed-out
  handles with a grabbable middle, and a normal object unchanged; the window narrowed to 768 px with
  the drawer open, showing the dock and a notice clear of it; a touch press on a top-bar button and
  on a disabled one putting the right text in the status bar; the built app under the real CSP with
  no console violations; the manifest and icon links present in the built `index.html`.

## 10. Owed after this milestone

Nothing here has touched a device. Owed, and to be recorded as such: the whole iPad pass — Pencil
drawing, palm rejection with a real hand, pinch and two-finger pan, the modifier dock under a held
finger, the drawer at real portrait and landscape widths, touch hints on a real device, and the
installed standalone app; Safari and Firefox; Alt from a physical keyboard (the desktop automation
delivers `altKey: false`, so it is verified only through the on-screen dock); and the deploy itself,
which the user runs.
