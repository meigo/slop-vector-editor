# Milestone 5 — iPad Polish and Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor usable with a Pencil and fingers on an iPad — a Pencil that wins over a resting palm, handles that don't swallow small objects, controls the drawer no longer hides, and labels a touch user can read — then get the app ready to deploy.

**Architecture:**
- **Routing stays pure.** All the palm/Pencil logic lives in `src/input/route.ts` as a function of counts and flags; `Canvas.svelte` only supplies them and ends a superseded gesture.
- **The handle policy is geometry, not state.** `handlePositions` expands a too-small frame box on screen; drawing and hit-testing both read it, so they cannot disagree, and the resize maths are untouched because `select.ts` already compensates with its `grab` offset.
- **Touch discoverability reuses the existing channel** — `app.hoverHint` and the status bar — driven by pointer-down instead of hover.
- **Deploy is static.** A manifest, an icon and a `_headers` file; the assets-only Worker config does not change.

**Tech Stack:** Svelte 5.55 (runes), TypeScript strict, Vite 8, Tailwind 4, Vitest 4 (node env), Cloudflare Workers (assets-only).

**Spec:** `docs/superpowers/specs/2026-09-18-m5-ipad-polish-deploy-design.md` (binding).

## Global Constraints

- **Checks:** `npm run build` ends with **0 errors, 0 warnings**; `npm run lint` silent; `npm test` passes; `npm run format:check` clean. Run `npx prettier --write` on touched files before committing.
- **No device.** Nothing in this milestone may be described as verified on an iPad. Synthetic pointer events in desktop Chrome are the ceiling.
- **Tools never import the store** (`ToolContext` only) and never import from `src/lib/`. `src/input/` imports nothing from the store.
- **UI:** theme tokens only; **one class expression per element** (`class={["btn", on && "ui-on"]}`), never a `class:` colour directive over a coloured base; 32px bar controls; a state change must not move the layout.
- **Every `title` is also a status-bar hint.** Titles read as short actions with their shortcut.
- **The document is immutable**; edits return the same reference when nothing changes.
- **Existing tests keep their expected values** unless a step says otherwise.
- **Do not run `npm run deploy`.** Publishing is the user's to trigger.
- **Commit trailer**, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. One commit per task.
- **Git:** branch `m5-ipad-deploy` off `main` (the controller creates it).
- **The sandboxed `git commit` fails with EPERM on `.git/index.lock`** — retry that one command with the sandbox disabled.

## File map

```
src/input/route.ts          + penActive, the Pencil takeover, explicit palm rejection
src/lib/Canvas.svelte       supplies penActive; ends a superseded pan/pinch
src/tools/gizmo.ts          handlePositions pads a too-small frame; handleAt follows
src/lib/Overlay.svelte      passes the handle size so drawn handles match hit-tested ones
src/lib/ModifierDock.svelte moves clear of the drawer; Snap gets touch-action: none
src/lib/Notices.svelte      moves clear of the drawer
src/lib/hover-hint.ts       a title is a hint for touch and pen too
src/App.svelte              a non-mouse pointer-down sets the hint
index.html                  manifest + apple-touch-icon links
public/manifest.webmanifest, public/apple-touch-icon.png, public/_headers   new
README.md, CLAUDE.md, docs/superpowers/CHANGELOG.md
```

---

### Task 1: A Pencil beats a resting palm

**Files:**
- Modify: `src/input/route.ts`, `src/lib/Canvas.svelte`
- Test: `src/__tests__/prefs-route-keys.test.ts` (extended)

**Interfaces:**
- Consumes: nothing new.
- Produces: `RouteInput` gains `penActive: boolean`; `routePointerDown` returns `"tool"`/`"pan"` for a pen over resting fingers, and `"ignore"` for a finger during a pen or mouse gesture.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/prefs-route-keys.test.ts` already has a `describe("routePointerDown")` with a helper that builds a `RouteInput`. Read it first: add `penActive: false` to that helper's defaults so every existing case keeps its current answer, then append:

```ts
  it("lets a Pencil take over from fingers already down", () => {
    // A palm (or a whole resting hand) landed first and started a pan or a pinch.
    expect(r({ pointerType: "pen", activePointers: 1, activeTouches: 1 })).toBe("tool");
    expect(r({ pointerType: "pen", activePointers: 2, activeTouches: 2 })).toBe("tool");
    expect(r({ pointerType: "pen", activePointers: 3, activeTouches: 3 })).toBe("tool");
  });

  it("still routes a taking-over Pencil by the tool and the space key", () => {
    expect(r({ pointerType: "pen", activePointers: 1, activeTouches: 1, tool: "hand" })).toBe("pan");
    expect(r({ pointerType: "pen", activePointers: 1, activeTouches: 1, spaceHeld: true })).toBe(
      "pan",
    );
  });

  it("does not let a pen take over from another pen or a mouse", () => {
    expect(r({ pointerType: "pen", activePointers: 1, activeTouches: 0 })).toBe("ignore");
    expect(r({ pointerType: "pen", activePointers: 2, activeTouches: 1 })).toBe("ignore");
  });

  it("ignores a finger while a pen or mouse gesture is running", () => {
    // Without penActive this would start a pinch — a palm landing beside the Pencil (spec M5 §2).
    expect(r({ pointerType: "touch", activePointers: 1, activeTouches: 1, penActive: true })).toBe(
      "ignore",
    );
    expect(r({ pointerType: "touch", activePointers: 1, activeTouches: 0, penActive: true })).toBe(
      "ignore",
    );
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/prefs-route-keys.test.ts`
Expected: FAIL — `penActive` is not a field, and a pen over a finger is ignored.

- [ ] **Step 3: Implement**

`src/input/route.ts` — add the field to `RouteInput`:

```ts
  /** A pen or mouse gesture is already running: fingers must not interrupt it. */
  penActive: boolean;
```

and replace the top of `routePointerDown` (keep everything from the mouse-button block down exactly as it is):

```ts
export function routePointerDown(i: RouteInput): Route {
  // A finger never interrupts a Pencil or mouse gesture — that is a palm, not an intent (spec M5 §2).
  if (i.pointerType === "touch" && i.penActive) return "ignore";
  // A Pencil takes over from fingers already on the glass, so a resting hand can't stop a stroke
  // before it starts. Only fingers are overridden: a second pen, or a mouse, is not.
  const takesOver =
    i.pointerType === "pen" && i.activePointers > 0 && i.activePointers === i.activeTouches;
  if (!takesOver) {
    if (i.pointerType === "touch" && i.activeTouches >= 1) return "pinch";
    if (i.activePointers >= 1) return "ignore";
  }
  if (i.pointerType === "mouse") {
    // …unchanged…
```

`src/lib/Canvas.svelte` — the gesture's own pointer type decides `penActive`, and a superseded gesture ends. Add beside the other helpers:

```ts
  /** True while a pen or mouse gesture is running: a finger arriving now is a palm (spec M5 §2). */
  function penGestureActive(): boolean {
    if (!gesture || gesture.kind === "pinch") return false;
    const t = pointerTypes.get(gesture.pointerId);
    return t === "pen" || t === "mouse";
  }
```

pass it in the `routePointerDown({ … })` call as `penActive: penGestureActive(),`, and — after the `route === "menu"` early return, before `pointers.set(...)` — end a gesture the new pointer supersedes:

```ts
    // A Pencil that took over from fingers: their pan or pinch stops here. Both only moved the
    // view, so there is nothing to roll back, and the fingers stay down but do nothing until they
    // lift (`gesture` no longer names them).
    if (gesture && route !== "pinch") {
      if (gesture.kind === "tool") {
        gesture.tool.cancel(storeContext);
        registerGestureCancel(null);
      }
      gesture = null;
    }
```

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(input): a Pencil takes over from a resting palm

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Handles move outside a small object

**Files:**
- Modify: `src/tools/gizmo.ts`, `src/lib/Overlay.svelte`
- Test: `src/__tests__/frame-gizmo.test.ts` (extended — that is the file's real name)

**Interfaces:**
- Produces: `handlePositions(f: Frame, view: View, size?: number)` — with `size`, a tight non-zero axis is expanded to `3 * (size / 2 + 2)` screen px; without it, positions are exact. `handleAt` passes its `size` through.

- [ ] **Step 1: Write the failing tests**

**First, one existing expectation changes** — this is the behaviour this task exists to change, so it is not a violation of "existing tests keep their expected values". In `src/__tests__/frame-gizmo.test.ts`, inside the handle hit-testing case:

```ts
    // A tiny object's handles are pushed outside it (spec M5 §3), so its middle is free to drag.
    const tiny = { angle: 0, box: { x: 0, y: 0, w: 2, h: 2 } };
    expect(handleAt(tiny, view, { x: 1, y: 0 }, 8)).toBeNull();
```

(it currently expects `"nw"`.) Then append the new describe. The file already has a module-level `const view = { x: 0, y: 0, zoom: 1 }` — reuse it; **`View` is `{ x, y, zoom }`, not `{ tx, ty }`**:

```ts
describe("small-object handle policy", () => {
  const small = { angle: 0, box: { x: 0, y: 0, w: 4, h: 4 } };
  const big = { angle: 0, box: { x: 0, y: 0, w: 200, h: 120 } };

  it("pushes the handles of a tight object out to a usable span", () => {
    // reach = 8/2 + 2 = 6, so a mouse span is 18px: 4px wide becomes 18, centred on the same point.
    const p = handlePositions(small, view, 8);
    expect(p.w.x).toBeCloseTo(-7, 9);
    expect(p.e.x).toBeCloseTo(11, 9);
    expect(p.n.y).toBeCloseTo(-7, 9);
    expect(p.s.y).toBeCloseTo(11, 9);
    // The centre is unmoved, so the pushed-out frame is symmetric about the object.
    expect((p.w.x + p.e.x) / 2).toBeCloseTo(2, 9);
  });

  it("uses a bigger span for touch, and scales with zoom", () => {
    // reach = 16/2 + 2 = 10 → 30px.
    const p = handlePositions(small, view, 16);
    expect(p.e.x - p.w.x).toBeCloseTo(30, 9);
    // At 4x zoom the object is already 16px across, so 18px still needs a nudge but a small one.
    const z = handlePositions(small, { x: 0, y: 0, zoom: 4 }, 8);
    expect(z.e.x - z.w.x).toBeCloseTo(18, 9);
  });

  it("leaves a big object, and an unsized call, exactly alone", () => {
    expect(handlePositions(big, view, 8)).toEqual(handlePositions(big, view));
    expect(handlePositions(small, view).e.x).toBeCloseTo(4, 9);
  });

  it("never pads a zero-size axis, so a line keeps its draggable middle", () => {
    const line = { angle: 0, box: { x: 0, y: 10, w: 100, h: 0 } };
    const p = handlePositions(line, view, 16);
    expect(p.n.y).toBeCloseTo(10, 9);
    expect(p.s.y).toBeCloseTo(10, 9);
    expect(p.e.x).toBeCloseTo(100, 9);
  });

  it("hit-tests where it draws", () => {
    const p = handlePositions(small, view, 8);
    expect(handleAt(small, view, { x: p.se.x, y: p.se.y }, 8)).toBe("se");
    // The object's own middle is now free for a move drag.
    expect(handleAt(small, view, { x: 2, y: 2 }, 8)).toBeNull();
  });

  it("keeps the frame outline on the true geometry", () => {
    expect(frameOutline(small, view)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
  });

  it("pads along the frame's own axes when it is rotated", () => {
    const turned = { angle: Math.PI / 2, box: { x: 0, y: 0, w: 4, h: 4 } };
    const p = handlePositions(turned, view, 8);
    // A quarter turn swaps the axes: the frame's e handle points down the screen.
    expect(p.e.y).toBeCloseTo(11, 9);
    expect(p.w.y).toBeCloseTo(-7, 9);
  });
});
```

`frameOutline`, `handleAt` and `handlePositions` are already imported in that file.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/frame-gizmo.test.ts`
Expected: FAIL — `handlePositions` takes two arguments and pads nothing.

- [ ] **Step 3: Implement** — `src/tools/gizmo.ts`

Add above `handlePositions`:

```ts
/** A handle's reach from its centre — the same 6/10px `handleAt` uses. */
const reachOf = (size: number) => size / 2 + 2;

/** Spec (M5) §3: an object shorter than three reaches is covered by its own handles, so every press
 *  resizes it and none moves it. The box is expanded on screen — symmetrically, so the centre and
 *  therefore the resize maths are unchanged — and only for an axis that has a size at all: a zero
 *  axis keeps its handles coincident, which is what leaves a line draggable by its middle. */
function padBox(box: Box, zoom: number, size: number): Box {
  const span = 3 * reachOf(size);
  const grow = (v: number, len: number): [number, number] => {
    const abs = Math.abs(len);
    if (abs === 0 || abs * zoom >= span) return [v, len];
    const d = ((span / zoom - abs) / 2) * (len < 0 ? -1 : 1);
    return [v - d, len + 2 * d];
  };
  const [x, w] = grow(box.x, box.w);
  const [y, h] = grow(box.y, box.h);
  return { x, y, w, h };
}
```

and give `handlePositions` the optional size:

```ts
export function handlePositions(f: Frame, view: View, size?: number): Record<Handle, Vec> {
  const box = size === undefined ? f.box : padBox(f.box, view.zoom, size);
  const out = {} as Record<Handle, Vec>;
  for (const h of RESIZE_HANDLES) out[h] = docToScreen(view, frameToDoc(f, handleFramePoint(h, box)));
  out.rotate = {
    x: out.n.x + ROTATE_OFFSET * Math.sin(f.angle),
    y: out.n.y - ROTATE_OFFSET * Math.cos(f.angle),
  };
  return out;
}
```

`frameToDoc` reads only `f.angle`, so passing a padded box is safe — it is a rotation, not a box map.

In `handleAt`, pass the size through: `const pos = handlePositions(f, view, size);`. Leave `activeHandles`, `PRIORITY` and the reach as they are — `reach` there stays `size / 2 + 2` (use `reachOf(size)` so the constant lives in one place).

`src/lib/Overlay.svelte` — the drawn handles must be the hit-tested ones. `size` is already derived in that file; make the handles derive from it:

```ts
  const handles = $derived(frame ? handlePositions(frame, view, size) : null);
```

**`size` is currently declared *after* `handles` in that file** — move the `const size = $derived(handleSize(app.lastPointerType));` line above the `handles` line, or the reference is used before it is defined. `frameOutline` is untouched and keeps drawing the true frame.

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(tools): push resize handles outside a too-small object

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The drawer stops covering the controls

**Files:**
- Modify: `src/lib/ModifierDock.svelte`, `src/lib/Notices.svelte`

**Interfaces:**
- Consumes: `app.propertiesOpen` (already in the store).
- Produces: nothing importable — a layout change only.

- [ ] **Step 1: Implement**

Below the 900px breakpoint the Properties/Layers column is an overlay drawer, `absolute inset-y-0 right-0 z-20`, 240px wide (`App.svelte`, `Sidebar.svelte`). The dock (`right-3 bottom-3 z-10`) is completely under it, and notices (`fixed right-3 bottom-10 z-40`) paint on top of it. Both move aside while it is open, and only at those widths — `right-63` is the drawer's 240px plus the usual 12px gutter (63 × 0.25rem = 252px). Use **`max-[900px]`**, not `max-[899px]`: Tailwind compiles it to `@media not all and (width >= 900px)`, the exact complement of the drawer's own `min-[900px]:hidden`. `max-[899px]` would leave the dock under the drawer at exactly 899px.

`src/lib/ModifierDock.svelte`, the wrapper div — one class expression, per the UI rules:

```svelte
<div
  class={[
    "absolute bottom-3 z-10 flex gap-1 rounded-lg border border-line bg-panel p-1 shadow-lg",
    app.propertiesOpen ? "right-3 max-[900px]:right-63" : "right-3",
  ]}
  role="toolbar"
  aria-label="Modifier keys"
>
```

`src/lib/Notices.svelte`, the wrapper div:

```svelte
<div
  class={[
    "pointer-events-none fixed bottom-10 z-40 flex max-w-sm flex-col gap-2",
    app.propertiesOpen ? "right-3 max-[900px]:right-63" : "right-3",
  ]}
>
```

Then the Snap button in `ModifierDock.svelte`: it is the only control in that dock without `style="touch-action: none"`, so a touch starting on it can still be taken for a scroll or a double-tap zoom. Give it the same attribute its Shift and Alt neighbours have. Change nothing else about it.

- [ ] **Step 2: Verify**

`npm run build` (0 / 0), `npm run lint`, `npm run format:check`, `npm test` (unchanged). Then a dev-server compile check on port **5197**: start `npx vite --port 5197 --strictPort` yourself, `curl` the transformed module URLs for `src/lib/ModifierDock.svelte` and `src/lib/Notices.svelte`, confirm 200 with no error payload, and stop the server you started. It needs the sandbox disabled. **Never use port 5173 or 5198**, and **if a port is busy, pick another — never kill the process holding it**: those belong to the user or a neighbouring app.

- [ ] **Step 3: Commit**

```bash
git add -A src
git commit -m "fix(ui): keep the dock and notices clear of the drawer

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: A touch user can read the labels

**Files:**
- Modify: `src/lib/hover-hint.ts`, `src/App.svelte`
- Test: `src/__tests__/hover-hint.test.ts` — it exists, and one of its cases asserts the old behaviour

**Interfaces:**
- Produces: `hintFrom(target, pointerType)` returns a title for every pointer type; `App.svelte` sets `app.hoverHint` on a non-mouse pointer-down.

- [ ] **Step 1: Change the failing test**

`src/__tests__/hover-hint.test.ts` has a case called **"ignores touch and pen, missing targets and empty titles"** whose first two assertions encode exactly the behaviour this task changes. Split it in two, keeping its existing `within()` helper:

```ts
  it("uses the nearest title under a touch or a pen too (spec M5 §5)", () => {
    expect(hintFrom(within("Cut (⌘X)"), "touch")).toBe("Cut (⌘X)");
    expect(hintFrom(within("Cut (⌘X)"), "pen")).toBe("Cut (⌘X)");
  });

  it("ignores missing targets and empty titles", () => {
    expect(hintFrom(null, "mouse")).toBeNull();
    expect(hintFrom(within(null), "mouse")).toBeNull();
    expect(hintFrom(within(""), "mouse")).toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/hover-hint.test.ts`
Expected: FAIL — `hintFrom` returns null for anything but a mouse.

- [ ] **Step 3: Implement**

`src/lib/hover-hint.ts` — the pointer-type gate goes, and the doc comment says why:

```ts
/** Spec (M2e) §4 and (M5) §5: the status bar shows the title of whatever the mouse is over — and,
 *  on a device with no hover, of whatever was last pressed. iPadOS shows no tooltip for a `title`,
 *  so without this an icon-only bar explains nothing and a disabled control never says why.
 *  Structural parameter type so this stays testable without a DOM. */
export function hintFrom(target: HintTarget | null, pointerType: string): string | null {
  if (!target) return null;
  const title = target.closest("[title]")?.getAttribute("title");
  return title ? title : null;
}
```

`pointerType` stays in the signature — `App.svelte` decides *when* to ask, and the parameter keeps the call sites honest. Since it is now unused, prefix it: `_pointerType: string`.

`src/App.svelte` — the current handler is an inline arrow on `<svelte:window>`: `onpointerdown={() => (app.hoverHint = null)}`. Replace it with a named function beside `onpointerover`/`onpointerout` (which keep the mouse behaviour they have):

```ts
  /** A device with no hover gets its hints from a press instead (spec M5 §5). A mouse clears the
   *  hint on press as before — hover will set it again. */
  function onpointerdown(e: PointerEvent) {
    app.hoverHint =
      e.pointerType === "mouse" ? null : hintFrom(e.target as Element | null, e.pointerType);
  }
```

and shorten the attribute to `{onpointerdown}` in the `<svelte:window>` list.

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ui): a touch press shows the control's hint

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Ready to deploy

**Files:**
- Create: `public/manifest.webmanifest`, `public/apple-touch-icon.png`, `public/_headers`
- Modify: `index.html`

**Interfaces:**
- Produces: static assets only. No source imports them; Vite copies `public/` verbatim into `dist/`.

- [ ] **Step 1: Generate the icon**

iOS needs a PNG and does not composite transparency, so the icon is the mark in white on the app's own `#1e1e22`. `public/favicon.svg` cannot be used directly: its fill is `#111` and only turns white under `prefers-color-scheme: dark`, which a rasteriser will not honour. Write this exact source to a scratch file (it is `favicon.svg`'s path and transform verbatim, with the theme CSS replaced by explicit fills and a background rect):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
  <rect width="180" height="180" fill="#1e1e22"/>
  <g transform="matrix(0.964375,0,0,1,7.289884,0.099012)">
    <path fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd" d="M64.68,152.643C73.871,125.601 -6.571,123.24 2.228,77.399C10.049,36.686 28.222,33.804 61.229,13.731C82.499,0.789 109.692,0.87 132.933,4.875C165.009,10.409 176.623,64.063 166.331,87.817C160.958,100.215 149.613,106.084 137.828,111.571C130.155,115.137 106.865,112.104 103.279,102.866C101.603,98.514 102.582,93.084 100.636,88.975C94.137,75.246 72.904,86.475 68.768,95.921C67.213,99.451 66.92,104.95 67.85,108.654C72.292,126.215 92.118,131.482 84.885,156.116C83.099,162.216 80.626,168.143 74.189,170.91C65.451,174.66 62.636,177.728 52.16,177.253C33.485,176.431 13.426,148.58 38.698,144.968C48.33,143.602 55.379,163.119 64.68,152.643ZM68.56,24.149C60.837,17.412 7.026,58.333 17.893,68.694C20.023,68.937 24.061,62.975 25.897,61.193C37.132,50.323 47.987,34.938 63.175,28.409C65.28,27.495 68.853,26.8 68.56,24.149ZM115.799,134.575C143.396,129.678 150.201,159.66 128.037,166.327C111.822,171.213 95.276,138.209 115.799,134.575ZM120.242,140.594C116.35,136.658 111.283,142.33 111.712,146.382C114.82,149.554 120.388,143.372 120.242,140.594Z"/>
  </g>
</svg>
```

Rasterise it once with `sharp`, which is already in `node_modules` as a transitive dependency — this is a one-off that produces a committed asset, so nothing is added to `package.json`:

```bash
node -e "
const sharp=require('sharp'), fs=require('fs');
sharp(fs.readFileSync('<scratch>/icon-src.svg'),{density:600})
  .resize(180,180).png({compressionLevel:9})
  .toFile('public/apple-touch-icon.png')
  .then(i=>console.log(i.width+'x'+i.height, i.size+' bytes'));
"
```

Expected: `180x180` and roughly 4–5 KB. **Look at the PNG before committing it** — read the image and confirm it is the white slop mark on the dark square, not a blank or black tile. If `sharp` is missing, say so in your report and stop rather than adding a dependency.

- [ ] **Step 2: Write `public/manifest.webmanifest`**

```json
{
  "name": "slop vector editor",
  "short_name": "slop vector",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#1e1e22",
  "theme_color": "#1e1e22",
  "icons": [
    { "src": "/favicon.svg", "type": "image/svg+xml", "sizes": "any" },
    { "src": "/apple-touch-icon.png", "type": "image/png", "sizes": "180x180" }
  ]
}
```

- [ ] **Step 3: Write `public/_headers`**

Cloudflare's assets-only Worker serves this file's rules. `'unsafe-inline'` for styles is required and deliberate: the overlay and `src/svg/attrs.ts` set `style` attributes on rendered elements, which CSP counts as inline styles. Scripts need no exception.

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
```

Vite fingerprints everything under `/assets/`, so those are safe to cache forever; everything else keeps the default revalidation, which is what lets a deploy be picked up on the next load.

- [ ] **Step 4: Link them from `index.html`**

Add, after the existing `<link rel="icon" …>`:

```html
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

Change nothing else in that file — the `viewport` line and its comment, the `apple-mobile-web-app-*` meta tags and `theme-color` all stay exactly as they are (spec §1 "Out", and iOS reads those meta tags rather than the manifest).

- [ ] **Step 5: Verify the build output and the policy**

```bash
npm run build
ls -la dist/manifest.webmanifest dist/apple-touch-icon.png dist/_headers
grep -o 'rel="manifest"[^>]*' dist/index.html
```

Then check the app actually runs under that CSP. **Do not inject a `<meta http-equiv>` and reload** — the reload discards the injected tag, and a meta added after parse does not apply retroactively. Serve the build with the real header instead. Write this scratch server (outside the repo — it is not a project file):

```js
// csp-server.mjs — serves dist/ with the rules from public/_headers, so the policy under test is
// the one that ships. Usage: node csp-server.mjs <dist> <headersFile> <port>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const [dist, headersFile, port] = process.argv.slice(2);

function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      current = { path: line.trim(), headers: {} };
      rules.push(current);
    } else if (current) {
      const i = line.indexOf(":");
      current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}

const rules = parseHeaders(await readFile(headersFile, "utf8"));
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

createServer(async (req, res) => {
  let path = normalize(new URL(req.url, "http://localhost").pathname);
  if (path.endsWith("/")) path += "index.html";
  for (const rule of rules) {
    const prefix = rule.path.replace(/\*$/, "");
    if (rule.path.endsWith("*") ? path.startsWith(prefix) : path === rule.path) {
      for (const [k, v] of Object.entries(rule.headers)) res.setHeader(k, v);
    }
  }
  try {
    const body = await readFile(join(dist, path));
    res.setHeader("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(Number(port), () => console.log("serving " + dist + " on " + port));
```

Run it on port **5197** (same port rules as Task 3), then:

```bash
curl -sI http://localhost:5197/ | grep -i -E "content-security|x-content-type|referrer"
curl -sI http://localhost:5197/assets/<any-built-file> | grep -i cache-control
```

Expected: the full policy on `/`, and `public, max-age=31536000, immutable` on the asset. Then open the page and check the app itself: shapes render with their colours (that is `style-src 'unsafe-inline'` working — without it every shape would be unstyled), the autosaved document restores (IndexedDB), `/manifest.webmanifest` and `/apple-touch-icon.png` both fetch 200, a `URL.createObjectURL(new Blob(…))` succeeds (the save fallback needs it), and the console has no `Content Security Policy` or `Refused to…` messages. Stop the server afterwards.

Record what you exercised and the console result in your report. If the policy blocks something, **report it rather than widening the policy silently**; a needed exception is a decision, not a detail.

- [ ] **Step 6: Commit**

```bash
git add -A public index.html
git commit -m "feat(deploy): manifest, apple-touch-icon and asset headers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Controller browser pass (between Task 5 and Task 6)

The controller runs this on `npx vite --port 5198 --strictPort`, with screenshots, and stops the server afterwards.

1. **Pencil over a palm:** synthetic `PointerEvent`s — a touch down (pan starts), then `pointerType: "pen"` down; the pen must draw. A finger arriving during the pen stroke must do nothing.
2. **The fingers don't take the stroke back:** lift the pen, move the resting finger, confirm the view does not pan.
3. **Small object:** a 20×20 rect at 100% zoom shows handles outside it; a press in its middle moves it rather than resizing; a press on a pushed-out handle resizes it.
4. **A normal object is unchanged**, and a horizontal line still drags by its middle.
5. **Narrow layout:** window at 768px with the drawer open — the dock is visible beside the drawer and a notice does not cover it. Screenshot.
6. **Touch hints:** a synthetic touch press on a top-bar button puts its title in the status bar; on an `aria-disabled` one, its reason.
7. **CSP:** the built app under the real policy, with the console clean.
8. No console errors anywhere in the pass.

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`

- [ ] **Step 1: `CLAUDE.md`**

- Update the `npm test` line's count to the suite's new total.
- Amend **invariant 24**: the status bar shows the hovered element's `title` on mouse, and the *pressed* element's on touch and pen — iPadOS shows no tooltip, so a press is the only way an icon-only control or a disabled control's reason can be read.
- Amend **invariant 14**: the small-object policy is no longer owed. Record that `handlePositions` expands a frame whose on-screen axis is under `3 * (size / 2 + 2)`, symmetrically and only for a non-zero axis, that drawing and hit-testing share it, and that the resize maths are unaffected because `select.ts`'s `grab` offset already compensates.
- Amend **invariant 16**: a Pencil takes over from fingers already down, and `penActive` states the palm rejection outright instead of leaving it to emerge from the counting.
- Add a short invariant for the deploy assets: `public/` holds `manifest.webmanifest`, `apple-touch-icon.png` (regenerate from the `favicon.svg` path when the mark changes — the favicon's own fill is theme-dependent and will not rasterise white) and `_headers`, whose CSP needs `style-src 'unsafe-inline'` because canvas and export set `style` attributes.
- Move "Current state" to milestone 5, and the roadmap to the post-v1 list in the project design §10.
- Remove the M5 items from the Roadmap section that this milestone did (palm-before-Pencil, the small-object handle policy, the drawer covering the dock, manifest/apple-touch-icon/_headers). Leave the ones it did not.

- [ ] **Step 2: `README.md`**

- Update the test count.
- Under what works today, note that the app installs to the Home Screen and runs standalone.
- Replace the roadmap line ("Next: iPad polish and deploy") with the post-v1 direction from the project design §10.
- Add a short **Deploy** line: `npm run deploy` builds and publishes to Cloudflare (assets-only Worker); it needs `wrangler` auth.

- [ ] **Step 3: `docs/superpowers/CHANGELOG.md`**

Append a milestone 5 entry — append-only, never rewrite an earlier one. Cover: the Pencil takeover and the explicit palm rejection; the small-object handle policy with its `3 * reach` threshold and why a zero axis is exempt; the dock and notices moving clear of the drawer; the Snap button's `touch-action`; the touch hint; the manifest, icon and headers, with the CSP's `style-src 'unsafe-inline'` reason; and that `viewport-fit=cover` was considered and deliberately not adopted (§1 "Out"). Add a `Browser-verified:` line the controller fills in, and an `Owed:` line: the entire iPad pass, Safari and Firefox, physical Alt, and the deploy itself, which the user runs.

- [ ] **Step 4: Verify and commit**

`npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

```bash
git add -A
git commit -m "docs: milestone 5 iPad polish and deploy

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
