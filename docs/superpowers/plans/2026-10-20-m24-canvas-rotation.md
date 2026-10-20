# M24 Canvas Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rotate the view (never the document): two-finger twist on touch, `,`/`.`/Shift/Shift+0 on
the keyboard, a status-bar readout that resets, a "Reset rotation" command — with every tool working
on a turned page.

**Architecture:** `View` gains an optional `rotation` (radians, absent = 0) and every mapping in
`src/state/viewport.ts` goes through `screen = R(rotation)·doc·zoom + (x, y)`. `zoom` stays the pure
scale, so the ~25 `px / zoom` tolerance sites are untouched. Tools keep working in document space;
only what is drawn from document geometry as screen-axis shapes (the marquee, snap guides, the scrim,
the rotate knob) changes. Commands and keys go through the existing `Command` / `runCommand` path.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Playwright WebKit (`npm run test:ipad`).

**Spec:** `docs/superpowers/specs/2026-10-20-m24-canvas-rotation-design.md`

## Global Constraints

- Rotation never touches the document: no edit, no undo entry, no dirty flag, no export change.
- Angles of every constraint stay in document space (Shift 45°, 15° rotate step, snapping).
- Snap on a two-finger lift within **3°** (`SNAP_ANGLE = 3 * Math.PI / 180`) of a multiple of 90°; a
  `pointercancel` never snaps.
- Keys by `e.code`, no ⌘/Ctrl: `Comma` −15°, `Period` +15°, Shift+`Comma` −90°, Shift+`Period`
  +90°, Shift+`Digit0` reset. Steps land on the next multiple of 15° / 90° in that direction.
  Shift+`Digit0` is checked **before** the `"="`/`"+"` zoom-in check (Estonian Shift+0 types `=`).
- Positive rotation = clockwise on screen. Stored normalised to (−π, π]. Readout shows whole degrees
  `0°`…`359°`.
- Keys, reset, readout and menu rotate about the **viewport centre**; a twist about the fingers'
  midpoint; the lift-snap about the viewport centre.
- New / Open / autosave restore (`replaceDocument` → `fitNonce`) reset to 0°. ⌘0 Fit and ⌘1 100%
  keep the angle. Document settings' Apply keeps it.
- Not saved anywhere (file, prefs, reload).
- The top bar is not touched. Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `npm run build` 0 errors 0 warnings; `npm test` green; `npm run test:ipad` green (needs the
  sandbox off to bind a port).

## Review Focus

1. **A pinch that drifts 1–2° must come back to exactly 0** (not 1e-16) — `snappedRotation` returns
   the multiple exactly, and the readout then reads `0°`. Test in Task 1.
2. **Angle wrap:** −179° + (−15° key) must land on −180°≡180° (normalised), and `snappedRotation`
   near ±180° / 359.5° must snap to 180° / 0°. Tests in Task 1.
3. **A marquee on a turned page selects what the drawn rectangle visibly contains**, not the
   document-axis box of its two corners. Test in Task 2.
4. **Snap guides on a turned page are drawn along the page's axes through the snapped coordinate**,
   covering the whole viewport at any angle (incl. 90°, where a document-x guide is horizontal on
   screen). Browser check in Task 3.
5. **Shift+0 on Estonian resets instead of zooming; plain `=` on US still zooms in; `,` in a focused
   text field types a comma.** Tests in Task 4.

---

### Task 1: The rotated viewport maths

**Files:**
- Modify: `src/state/viewport.ts`
- Test: `src/__tests__/viewport-rotation.test.ts` (create)

**Interfaces:**
- Produces (all in `src/state/viewport.ts`):
  - `type View = { x: number; y: number; zoom: number; rotation?: number }` — absent means 0.
  - `viewAngle(v: View): number` — `v.rotation ?? 0`.
  - `viewMatrix(v: View): Mat` — document → screen (`src/geom/mat.ts` `Mat` order).
  - `docToScreen`, `screenToDoc` — now through the rotation.
  - `panBy`, `zoomAt` — preserve `rotation` (spread the view; never drop the key).
  - `rotateAt(v: View, screen: Vec, delta: number): View` — rotate by `delta` keeping `screen` fixed;
    result normalised.
  - `normalizeAngle(a: number): number` — into (−π, π].
  - `SNAP_ANGLE = 3 * Math.PI / 180`; `snappedRotation(a: number, snap = SNAP_ANGLE): number` — the
    nearest multiple of π/2 (normalised, exact) when within `snap`, else `a` unchanged.
  - `steppedRotation(a: number, step: number, dir: 1 | -1): number` — the next multiple of `step`
    strictly beyond `a` in direction `dir`, normalised (use a 1e-9 epsilon so 30° + 15° is 45°, not
    60°).
  - `pinch(v, a0, b0, a1, b1)` — now also rotates by the change in angle of `b − a`, pivoting on the
    midpoint (zoom and rotate about `m0`, then pan `m1 − m0`).
  - `fitRect(rect, viewW, viewH, margin = 40, rotation = 0): View` — fits the rotated rect's screen
    bounding box, centred, with that rotation.
  - `revealPan`, `wheelView` — unchanged signatures (screen-space pans; they must preserve rotation
    through `panBy`).

- [ ] **Step 1: Write the failing tests**

```ts
const close = (a: Vec, b: Vec) => { expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); };
const deg = (d: number) => (d * Math.PI) / 180;

it("an absent rotation maps exactly as before", () => {
  expect(docToScreen({ x: 5, y: 7, zoom: 2 }, { x: 1, y: 1 })).toEqual({ x: 7, y: 9 });
});
it("90° clockwise maps doc +x to screen +y", () => {
  close(docToScreen({ x: 0, y: 0, zoom: 2, rotation: deg(90) }, { x: 1, y: 0 }), { x: 0, y: 2 });
});
it("screenToDoc inverts docToScreen at 30°, 137° and −170°", () => { /* round-trip 3 points each */ });
it("viewMatrix agrees with docToScreen", () => { /* applyMat(viewMatrix(v), p) ≈ docToScreen(v, p) */ });
it("panBy and zoomAt keep the rotation", () => {
  const v = { x: 0, y: 0, zoom: 1, rotation: 0.5 };
  expect(panBy(v, 3, 4).rotation).toBe(0.5);
  expect(zoomAt(v, { x: 10, y: 10 }, 2).rotation).toBe(0.5);
});
it("rotateAt keeps the pivot fixed", () => {
  const v = { x: 12, y: -3, zoom: 1.5, rotation: deg(20) };
  const piv = { x: 100, y: 80 };
  const d = screenToDoc(v, piv);
  close(docToScreen(rotateAt(v, piv, deg(35)), d), piv);
});
it("pinch with a pure twist rotates about the midpoint and keeps zoom", () => {
  const v = { x: 0, y: 0, zoom: 1 };
  const r = pinch(v, { x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 }, { x: 0, y: 10 });
  expect(viewAngle(r)).toBeCloseTo(deg(90), 9);
  expect(r.zoom).toBeCloseTo(1, 9);
  close(docToScreen(r, { x: 0, y: 0 }), { x: 0, y: 0 });
});
it("pinch with a pure spread leaves the angle at 0", () => { /* a0(-10,0) b0(10,0) → a1(-20,0) b1(20,0): viewAngle 0, zoom 2 */ });
it("snappedRotation snaps within 3° and exactly", () => {
  expect(snappedRotation(deg(2.9))).toBe(0);
  expect(snappedRotation(deg(-2.9))).toBe(0);
  expect(snappedRotation(deg(3.1))).toBeCloseTo(deg(3.1), 12);
  expect(snappedRotation(deg(88))).toBe(Math.PI / 2);
  expect(snappedRotation(deg(179))).toBe(Math.PI);
  expect(snappedRotation(deg(-179))).toBe(Math.PI);
  expect(snappedRotation(deg(359.5))).toBe(0);
});
it("steppedRotation lands on the next multiple", () => {
  expect(steppedRotation(deg(37), deg(15), 1)).toBeCloseTo(deg(45), 9);
  expect(steppedRotation(deg(37), deg(15), -1)).toBeCloseTo(deg(30), 9);
  expect(steppedRotation(deg(30), deg(15), 1)).toBeCloseTo(deg(45), 9);
  expect(steppedRotation(deg(37), deg(90), 1)).toBeCloseTo(deg(90), 9);
  expect(steppedRotation(deg(-179), deg(15), -1)).toBeCloseTo(Math.PI, 9); // wraps to +180°
});
it("normalizeAngle maps into (−π, π]", () => {
  expect(normalizeAngle(-Math.PI)).toBe(Math.PI);
  expect(normalizeAngle(deg(270))).toBeCloseTo(deg(-90), 12);
});
it("fitRect at 90° fits the turned rectangle and centres it", () => {
  // 200×100 rect into 400×400 with margin 40: turned it is 100 wide, 200 tall → zoom 320/200 = 1.6
  const v = fitRect({ x: 0, y: 0, w: 200, h: 100 }, 400, 400, 40, deg(90));
  expect(v.zoom).toBeCloseTo(1.6, 9);
  close(docToScreen(v, { x: 100, y: 50 }), { x: 200, y: 200 });
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/viewport-rotation.test.ts` — Expected: FAIL (missing exports).
- [ ] **Step 3: Implement** the Interfaces above in `src/state/viewport.ts`. Keep the existing
  doc comment's formula current (`screen = R·doc·zoom + (x, y)`).
- [ ] **Step 4: Run** `npx vitest run` — Expected: all pass, including the untouched
  `viewport-keys.test.ts` (unrotated views map exactly as before).
- [ ] **Step 5: Commit** `feat: M24 rotated viewport maths`.

---

### Task 2: Marquee and rotate knob on a turned page (tools)

**Files:**
- Modify: `src/geom/hit.ts` (`marqueeSelect`), `src/tools/tool.ts` (`Overlay`'s marquee variant),
  `src/tools/select.ts` (≈ 246–249), `src/tools/gizmo.ts` (`handlePositions`, ≈ 59–62)
- Test: `src/__tests__/hit.test.ts`, `src/__tests__/select-tool.test.ts` (≈ 104–110 updates),
  `src/__tests__/frame-gizmo.test.ts`

**Interfaces:**
- Consumes: `viewMatrix`, `viewAngle`, `screenToDoc` (Task 1).
- Produces:
  - `marqueeSelect(doc: Doc, box: Box, enteredGroupId: string | null = null, toBox: Mat = IDENTITY): string[]`
    — `box` lives in the space `toBox` maps the document into; a node is in when
    `nodeBounds(node, multiply(toBox, parent))` is contained in `box`. The select tool passes the
    **screen** box and `viewMatrix(view)`; every existing caller keeps passing a document box.
  - `Overlay` marquee: `{ kind: "marquee"; quad: Vec[] }` — four document-space points, the screen
    rectangle's corners through `screenToDoc`, in order press → (press.x, cur.y)… any consistent
    winding.
  - `handlePositions`: the rotate knob offset uses `f.angle + viewAngle(view)`.

- [ ] **Step 1: Write the failing tests**
  - `hit.test.ts` "marqueeSelect in a rotated frame selects what the turned rectangle contains": a
    10×10 rect at (0,0) and one at (40,0); `toBox = viewMatrix({x:0,y:0,zoom:1,rotation:π/2})`;
    the screen box `{x:-15,y:-5,w:20,h:20}` contains the first rect's screen bounds (x −10…0,
    y 0…10) → `["a"]`; the second (screen y 40…50) is out.
  - `select-tool.test.ts`: the existing marquee test now expects `state.overlay` to be
    `{ kind: "marquee", quad: [...] }` with the four corners of the same doc box at rotation 0; add
    "a marquee on a 90°-turned view selects by the screen rectangle" with `state.view` rotated,
    asserting the selection.
  - `frame-gizmo.test.ts` "the rotate knob sits on the frame's axis on a turned view": unrotated
    rect, view rotation π/2 → `rotate` is `ROTATE_OFFSET` screen px from `n` along the frame's
    outward normal on screen, i.e. `rotate ≈ { x: n.x + 24, y: n.y }`; and at rotation 0 the
    existing expectations still hold.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/hit.test.ts src/__tests__/select-tool.test.ts src/__tests__/frame-gizmo.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** In `select.ts`'s marquee case use `m.start.screen` and `e.screen` for
  the screen box (`boxFromPoints`), `viewMatrix(ctx.view())` for `toBox`, and the quad through
  `screenToDoc(ctx.view(), …)` for the overlay. Hit tolerances, `padBox`, `visibleHandles` and
  `rotateDelta` need no change.
- [ ] **Step 4: Run** `npx vitest run` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: M24 marquee and rotate knob follow a turned view`.

---

### Task 3: Draw the turned page, and the twist gesture

**Files:**
- Modify: `src/lib/Canvas.svelte` (render matrix ≈ 537, `scrimPath` ≈ 132–138, pinch end in
  `endPointer` ≈ 362–380, Safari `gesturechange` ≈ 465–471 unchanged), `src/lib/Overlay.svelte`
  (marquee ≈ 125–128 and 549–556; guides ≈ 559–570)
- No unit tests (DOM); verified in the browser (Step 4).

**Interfaces:**
- Consumes: `viewMatrix`, `docToScreen`, `screenToDoc`, `viewAngle`, `rotateAt`, `snappedRotation`
  (Task 1); the marquee `quad` (Task 2).

- [ ] **Step 1: Render.** The artwork group's `transform` is `matrix(…viewMatrix(view))`. The scrim's
  hole is the four artboard corners through `docToScreen` (`M…L…L…L…Z`); `evenodd` still makes it a
  hole.
- [ ] **Step 2: Overlay.** The marquee is a `<polygon>` of the quad through `docToScreen` (same
  style and dash as today, plus the existing halo). A guide at document `x` is the segment from
  `(x, yMin)` to `(x, yMax)` through `docToScreen`, where `yMin`/`yMax` span `screenToDoc` of the four
  viewport corners (`app.viewportSize`); `ys` likewise along x. No other Overlay `<rect>` changes:
  they are screen-square knobs at mapped centres (audited in planning).
- [ ] **Step 3: The lift-snap.** In `endPointer`, when `g?.kind === "pinch"`, the event is not
  `cancelled`, and this lift takes the tracked pointers from 2 to 1, set the view to
  `rotateAt(app.view, viewport centre, snappedRotation(a) − a)` when that delta is non-zero
  (`a = viewAngle(app.view)`). The move path needs no change — `pinch()` now rotates.
- [ ] **Step 4: Browser check** (dev server on port 5198, not 5173): set `app.view` to 30° from the
  console or via Task 4's keys once merged; with a rect, an ellipse, a path and a title: the artwork
  and checker turn together, the scrim hugs the turned artboard, the marquee is a screen rectangle
  that selects what it visibly contains, snap guides (drag a shape with Snap on) run along the
  page's axes across the whole canvas, the rotate knob sits on the frame's axis. Record what was
  checked for the CHANGELOG.
- [ ] **Step 5: Run** `npm run build` — Expected: 0 errors, 0 warnings.
- [ ] **Step 6: Commit** `feat: M24 draw a turned page; two-finger twist with snap on lift`.

---

### Task 4: Commands, keys and the store

**Files:**
- Modify: `src/state/keys.ts` (`Command`, `commandForKey`), `src/state/commands.ts` (`runCommand`),
  `src/state/appState.svelte.ts` (`fitArtboard` ≈ 700–705, new actions beside `zoomBy`),
  `src/lib/Canvas.svelte` (the `fitNonce` effect ≈ 151–155)
- Test: `src/__tests__/viewport-keys.test.ts`

**Interfaces:**
- Consumes: `rotateAt`, `steppedRotation`, `viewAngle`, `fitRect(…, rotation)` (Task 1).
- Produces:
  - `Command` gains `"rotateCcw" | "rotateCw" | "rotateCcw90" | "rotateCw90" | "resetRotation"`.
  - Store: `rotateViewStep(step: number, dir: 1 | -1): void` and `resetRotation(): void`, both about
    the viewport centre, no-ops (same `app.view` reference) when the angle would not change.
  - `fitArtboard(keepRotation = true): void` — `fitRect(…, keepRotation ? viewAngle(app.view) : 0)`;
    the `fitNonce` effect (first size + every `replaceDocument`) calls `fitArtboard(false)`.

- [ ] **Step 1: Write the failing tests** (in `viewport-keys.test.ts`'s `commandForKey` block)

```ts
const key = (code: string, key: string, shiftKey = false) =>
  ({ code, key, shiftKey, metaKey: false, ctrlKey: false });
expect(commandForKey(key("Comma", ","))).toBe("rotateCcw");
expect(commandForKey(key("Period", "."))).toBe("rotateCw");
expect(commandForKey(key("Comma", ";", true))).toBe("rotateCcw90");   // Estonian Shift+,
expect(commandForKey(key("Period", ":", true))).toBe("rotateCw90");
expect(commandForKey(key("Digit0", "=", true))).toBe("resetRotation"); // Estonian Shift+0
expect(commandForKey(key("Digit0", ")", true))).toBe("resetRotation"); // US Shift+0
expect(commandForKey(key("Equal", "="))).toBe("zoomIn");               // US = still zooms
expect(commandForKey({ ...key("Comma", ","), metaKey: true })).toBeNull();
```
  And in the focused-field block: `fieldPassesKey("text", key("Comma", ","))` is `false`.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/viewport-keys.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `commandForKey`'s non-mod branch by `e.code` before the zoom checks;
  `runCommand` cases call `rotateViewStep(Math.PI / 12, ±1)`, `rotateViewStep(Math.PI / 2, ±1)` and
  `resetRotation()`; the store actions and `fitArtboard` as in Interfaces.
- [ ] **Step 4: Run** `npx vitest run` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: M24 rotate keys, Reset rotation, fit keeps the angle`.

---

### Task 5: The readout, the menus and the iPad check

**Files:**
- Modify: `src/lib/StatusBar.svelte`, `src/lib/TopBar.svelte` (File menu, ≈ 276–278),
  `src/lib/ContextMenu.svelte`, `scripts/ipad-smoke.mjs` (after check 8's pinch, ≈ 400)

**Interfaces:**
- Consumes: `resetRotation`, `viewAngle` (Tasks 1, 4).

- [ ] **Step 1: Readout.** In `StatusBar.svelte`, between the hint and the artboard size (keep
  `ml-auto` on the artboard size span — the readout goes after it), a `<button>` showing
  `` `${deg}°` `` where `deg = ((Math.round(angle·180/π) % 360) + 360) % 360`; fixed width
  (`w-12`, `tabular-nums`, text-right); `title="Rotation — tap to reset (⇧0)"`; `onclick` →
  `resetRotation()`. Height `var(--ctl-h)`; the footer changes `h-7` to `min-h-7` so it is 28px with a
  mouse and grows to 32px on touch (test:ipad's 32px target rule).
- [ ] **Step 2: Menus.** File menu: after "Document settings…", a "Reset rotation" item with
  `<span class="kbd">⇧0</span>`; context menu: the same item after the Flip pair. At 0° both are
  `aria-disabled="true"` with `title="Reset rotation — the page is upright"` and do nothing.
- [ ] **Step 3: test:ipad check** `[sim] a two-finger twist turns the page; a straight pinch stays
  at 0°; tapping the readout resets`: a pinch whose fingers rotate 30° about `c` (ten moves) → the
  readout text is not `0°`; tap the readout (`page.getByTitle(/^Rotation/).tap()`) → `0°`; repeat
  check 8's straight pinch → still `0°`. Read the screenshot.
- [ ] **Step 4: Run** `npm run build` (0/0) and `npm run test:ipad` (sandbox off) — Expected: all
  checks pass, including every touch target ≥ 32px.
- [ ] **Step 5: Commit** `feat: M24 rotation readout, Reset rotation menu items, iPad smoke check`.

---

### Task 6: Docs

**Files:**
- Modify: `CLAUDE.md` (architecture map: `viewport.ts` entry; a new invariant 51 "The view rotates,
  the page doesn't" — rotation optional/absent = 0, `zoom` stays the pure scale, screen-axis drawing
  goes through point mapping, marquee is screen-aligned and selects through `toBox`, snap on lift,
  keys by code and Shift+0 before zoom-in; Current state: M24; test counts), `README.md` (rotation:
  gesture, keys, readout), `docs/superpowers/CHANGELOG.md` (M24 entry with what was browser-checked
  and what is owed), `docs/superpowers/IPAD-CHECKLIST.md` (the real twist's feel/pivot/snap; twisting
  mid-pen-path and mid-text-session; a twist never firing two-finger undo; the Pencil at an angle;
  the keyboard and auto-pan while rotated; the readout tap target).

- [ ] **Step 1:** Write the above; run `npm test` to get the new count for CLAUDE.md.
- [ ] **Step 2: Commit** `docs: M24 canvas rotation — CLAUDE.md, README, CHANGELOG, iPad checklist`.
