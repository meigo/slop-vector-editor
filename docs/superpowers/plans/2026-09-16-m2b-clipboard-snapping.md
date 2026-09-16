# Milestone 2b — Clipboard and Snapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy/cut/paste objects within the app and as SVG text with other apps, and snap moving,
resizing and drawing to the artboard and other objects, with guide lines and a Snap toggle.

**Architecture:** Pure snap math (`geom/snap.ts`) used by the tools through `ToolContext`; pure
clipboard planning (`state/clipboard.ts`) on top of the existing SVG serializer/importer and a new
`insertNodes` edit; a tiny never-throwing adapter for `navigator.clipboard`; store actions and
window `copy`/`cut`/`paste` events; UI additions in the overlay, modifier dock, context bar and
context menu.

**Tech Stack:** Svelte 5 (runes), TypeScript 5.9 strict, Vite 8, Tailwind 4, Vitest 4 (node env),
`@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-09-16-m2b-clipboard-snapping-design.md` (binding); extends
`docs/superpowers/specs/2026-09-16-m2a-select-transform-shapes-design.md` and the v1 spec.

## Global Constraints

- `npm run build` (= `svelte-check && tsc --noEmit && vite build`) must end with **0 errors, 0 warnings**; `npm run lint` silent; `npm test` all passing; `npm run format:check` clean.
- Vitest runs in node with no DOM: only pure logic is unit-tested. UI tasks are gated by the build and a dev-server compile check; the controller runs the real browser pass.
- tsconfig: `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums, no namespaces, no constructor parameter properties).
- The document is immutable; an edit that changes nothing returns the same reference. No edit creates empty groups, zero-size shapes or node-less paths.
- Tools never import the store; they use `ToolContext`. Every document-editing store action calls `cancelActiveGesture()` first (CLAUDE.md gotcha #15).
- Snap threshold: `SNAP_PX = 8` screen px (tools use `SNAP_PX / view.zoom`). Paste cascade step: 10 doc units. Guide colour token: `--color-guide: #ff3ea5`.
- `Prefs.snap` defaults to `true`; existing tests that are not about snapping must keep their expected values — if snapping changes one, pass `{ ...DEFAULT_PREFS, snap: false }` to that test's fake context and report it; never change an expected value to fit snapping.
- The clipboard adapter never throws. Keyboard copy/cut/paste use the window events and never prompt; only buttons/menu read `navigator.clipboard`.
- No native `alert`/`confirm`/`prompt`. UI colours come from theme tokens.
- Plan code blocks are not Prettier-formatted: run `npx prettier --write` on touched files before committing.
- Numbers in tests were hand-computed (Tasks 1, 5 and 6 were dry-run against the current tree and pass); if a test disagrees with the code, trace the input first and report.
- Commit trailer on every commit, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Git: branch `m2b-clipboard-snapping` off `main`; one commit per task; merge only when the user says so.

## File map

```
src/geom/snap.ts             SNAP_PX, SnapTargets, Guides, Axes, collectTargets, snapValue, snapBox, snapPoint, hasGuides
src/persist/preferences.ts   + Prefs.snap
src/tools/tool.ts            + Overlay "guides" kind, ToolContext.snapEnabled()
src/tools/context.ts         + snapEnabled
src/__tests__/fake-context.ts + snapEnabled
src/state/keys.ts            + EditAction toggleSnap ("%")
src/state/commands.ts        + toggleSnap
src/tools/shape-tools.ts     snapping while drawing
src/tools/select.ts          snapping while moving/resizing; Alt-drag-back fix
src/doc/edits.ts             + insertNodes
src/state/clipboard.ts       Clip, PastePlan, PasteError, clipboardText, planPaste, isPasteError, looksLikeSvg
src/persist/system-clipboard.ts  writeClipboardText, readClipboardText
src/state/appState.svelte.ts + toggleSnap, visibleDocBox, copySelection, cutSelection, pasteText, pasteFromClipboard, copyToSystem, cutToSystem
src/App.svelte               window copy/cut/paste
src/app.css                  + --color-guide
src/lib/Overlay.svelte       guide lines
src/lib/ModifierDock.svelte  Snap toggle
src/lib/ContextBar.svelte    Cut / Copy / Paste
src/lib/ContextMenu.svelte   Cut / Copy / Paste, empty-canvas menu
src/lib/Canvas.svelte        context menu also on empty canvas
CLAUDE.md, README.md, docs/superpowers/CHANGELOG.md
```

---

### Task 1: Snap math

**Files:**
- Create: `src/geom/snap.ts`
- Test: `src/__tests__/snap.test.ts`

**Interfaces:**
- Consumes: `Doc`; `nodeBounds`; `Box`; `IDENTITY`; `Vec`.
- Produces (spec §3.1):
  - `SNAP_PX = 8`
  - `type SnapTargets = { xs: number[]; ys: number[] }` (ascending)
  - `type Guides = { xs: number[]; ys: number[] }`; `NO_GUIDES: Guides`; `hasGuides(g): boolean`
  - `type Axes = { x: boolean; y: boolean }`
  - `collectTargets(doc, exclude: readonly string[]): SnapTargets`
  - `snapValue(values, targets, threshold): { delta: number; at: number } | null`
  - `snapBox(box, targets, threshold, axes?): { dx: number; dy: number; guides: Guides }`
  - `snapPoint(p, targets, threshold, axes?): { p: Vec; guides: Guides }`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/meigo/Projects/slop/slop-vector-editor
git checkout -b m2b-clipboard-snapping
```

- [ ] **Step 2: Write the failing test** — `src/__tests__/snap.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Layer, type Node } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import {
  collectTargets,
  hasGuides,
  NO_GUIDES,
  SNAP_PX,
  snapBox,
  snapPoint,
  snapValue,
} from "../geom/snap";

const rect = (id: string, x: number, y: number, w: number, h: number): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x,
  y,
  w,
  h,
  rx: 0,
});

const layer = (id: string, children: Node[], over: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  children,
  ...over,
});

describe("snapValue", () => {
  it("picks the closest target within the threshold", () => {
    expect(SNAP_PX).toBe(8);
    expect(snapValue([10], [0, 12, 50], 3)).toEqual({ delta: 2, at: 12 });
    expect(snapValue([10], [0, 12, 50], 1)).toBeNull();
    expect(snapValue([], [1], 5)).toBeNull();
  });

  it("breaks ties by earlier value, then smaller target", () => {
    expect(snapValue([10, 20], [12, 18], 5)).toEqual({ delta: 2, at: 12 });
    expect(snapValue([10], [8, 12], 5)).toEqual({ delta: -2, at: 8 });
  });
});

describe("collectTargets", () => {
  it("uses the artboard and visible top-level bounds, skipping excluded ids", () => {
    const base = createDoc(100, 50);
    const doc: Doc = {
      ...base,
      layers: [
        layer("L0", [rect("a", 10, 10, 20, 20), rect("b", 50, 0, 10, 10)]),
        layer("L1", [rect("c", 80, 0, 10, 10)], { visible: false }),
        layer("L2", [rect("d", 70, 30, 10, 10)], { locked: true }),
      ],
    };
    expect(collectTargets(doc, ["b"])).toEqual({
      xs: [0, 10, 20, 30, 50, 70, 75, 80, 100],
      ys: [0, 10, 20, 25, 30, 30, 35, 40, 50],
    });
  });
});

describe("snapBox and snapPoint", () => {
  const targets = { xs: [0, 50, 100], ys: [0, 25, 50] };

  it("snaps a box by its edges and centre, per enabled axis", () => {
    expect(snapBox({ x: 48, y: 0, w: 10, h: 10 }, targets, 3)).toEqual({
      dx: 2,
      dy: 0,
      guides: { xs: [50], ys: [0] },
    });
    expect(snapBox({ x: 48, y: 0, w: 10, h: 10 }, targets, 3, { x: true, y: false })).toEqual({
      dx: 2,
      dy: 0,
      guides: { xs: [50], ys: [] },
    });
    expect(snapBox({ x: 20, y: 10, w: 5, h: 5 }, targets, 3)).toEqual({
      dx: 0,
      dy: 0,
      guides: NO_GUIDES,
    });
  });

  it("snaps a point", () => {
    expect(snapPoint({ x: 49, y: 26 }, targets, 2)).toEqual({
      p: { x: 50, y: 25 },
      guides: { xs: [50], ys: [25] },
    });
    const none = snapPoint({ x: 49, y: 26 }, targets, 0.5);
    expect(none.p).toEqual({ x: 49, y: 26 });
    expect(hasGuides(none.guides)).toBe(false);
    expect(snapPoint({ x: 49, y: 26 }, targets, 2, { x: false, y: true }).p).toEqual({
      x: 49,
      y: 25,
    });
  });
});
```

Hand-check of the `collectTargets` expectation: artboard xs 0, 50, 100 and ys 0, 25, 50; `a`
adds xs 10, 20, 30 and ys 10, 20, 30; `b` is excluded; `c` is on a hidden layer; `d` (locked, still
visible) adds xs 70, 75, 80 and ys 30, 35, 40.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/__tests__/snap.test.ts`
Expected: FAIL — cannot resolve `../geom/snap`.

- [ ] **Step 4: Implement** — `src/geom/snap.ts`

```ts
import type { Doc } from "../doc/document";
import { nodeBounds } from "./bounds";
import type { Box } from "./box";
import { IDENTITY } from "./mat";
import type { Vec } from "./vec";

/** Snap distance in screen pixels; callers divide by the zoom. */
export const SNAP_PX = 8;

export type SnapTargets = { xs: number[]; ys: number[] };
export type Guides = { xs: number[]; ys: number[] };
export type Axes = { x: boolean; y: boolean };

export const NO_GUIDES: Guides = { xs: [], ys: [] };
const BOTH: Axes = { x: true, y: true };

export function hasGuides(g: Guides): boolean {
  return g.xs.length > 0 || g.ys.length > 0;
}

/** Candidate lines: the artboard's edges and centre, and the bounds of every top-level node on a
 *  visible layer (locked layers included — you can align to what you can't edit). */
export function collectTargets(doc: Doc, exclude: readonly string[]): SnapTargets {
  const skip = new Set(exclude);
  const { w, h } = doc.artboard;
  const xs = [0, w / 2, w];
  const ys = [0, h / 2, h];
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    for (const n of layer.children) {
      if (skip.has(n.id)) continue;
      const b = nodeBounds(n, IDENTITY);
      if (!b) continue;
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
  }
  return { xs: xs.sort((a, b) => a - b), ys: ys.sort((a, b) => a - b) };
}

/** The closest (value, target) pair within `threshold`. Ties keep the earlier value, then the
 *  smaller target (targets are ascending). */
export function snapValue(
  values: readonly number[],
  targets: readonly number[],
  threshold: number,
): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) > threshold) continue;
      if (!best || Math.abs(d) < Math.abs(best.delta)) best = { delta: d, at: t };
    }
  }
  return best;
}

export function snapBox(
  box: Box,
  targets: SnapTargets,
  threshold: number,
  axes: Axes = BOTH,
): { dx: number; dy: number; guides: Guides } {
  const sx = axes.x
    ? snapValue([box.x, box.x + box.w / 2, box.x + box.w], targets.xs, threshold)
    : null;
  const sy = axes.y
    ? snapValue([box.y, box.y + box.h / 2, box.y + box.h], targets.ys, threshold)
    : null;
  return {
    dx: sx?.delta ?? 0,
    dy: sy?.delta ?? 0,
    guides: { xs: sx ? [sx.at] : [], ys: sy ? [sy.at] : [] },
  };
}

export function snapPoint(
  p: Vec,
  targets: SnapTargets,
  threshold: number,
  axes: Axes = BOTH,
): { p: Vec; guides: Guides } {
  const sx = axes.x ? snapValue([p.x], targets.xs, threshold) : null;
  const sy = axes.y ? snapValue([p.y], targets.ys, threshold) : null;
  return {
    p: { x: p.x + (sx?.delta ?? 0), y: p.y + (sy?.delta ?? 0) },
    guides: { xs: sx ? [sx.at] : [], ys: sy ? [sy.at] : [] },
  };
}
```

Note: the third `snapBox` case expects `guides` to equal `NO_GUIDES` by value (`toEqual`), not by
reference.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/snap.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`.
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/geom/snap.ts src/__tests__/snap.test.ts
git commit -m "feat(geom): snap targets and per-axis snapping

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Snap preference, toggle key and tool-context plumbing

**Files:**
- Modify: `src/persist/preferences.ts`, `src/tools/tool.ts`, `src/tools/context.ts`, `src/__tests__/fake-context.ts`, `src/state/keys.ts`, `src/state/commands.ts`, `src/state/appState.svelte.ts`, `src/__tests__/prefs-route-keys.test.ts`
- Test: `src/__tests__/prefs-route-keys.test.ts` (extended)

**Interfaces:**
- Consumes: `Guides` (Task 1).
- Produces:
  - `Prefs = { style; polygon; snap: boolean }`; `DEFAULT_PREFS.snap = true`; `sanitizePrefs` keeps a boolean `snap`, otherwise uses the default.
  - `Overlay = { kind: "marquee"; box: Box } | { kind: "guides"; xs: number[]; ys: number[] } | null`
  - `ToolContext.snapEnabled(): boolean` — real: `app.prefs.snap`; fake: `prefs.snap`
  - `EditAction` gains `{ kind: "toggleSnap" }`; `editActionForKey` returns it for the key `%` (no ⌘/Ctrl)
  - store `toggleSnap(): void` (flips and saves `prefs.snap`); `runEditAction` handles `toggleSnap`

- [ ] **Step 1: Extend the tests** — in `src/__tests__/prefs-route-keys.test.ts`

In the `custom` prefs object, add `snap: false` after `polygon`. In the "validates field by
field" test, add `snap: "yes",` to the raw input object and, after the existing assertions,
`expect(p.snap).toBe(true);`. Add one more test to `describe("preferences")`:

```ts
  it("keeps a boolean snap preference", () => {
    expect(DEFAULT_PREFS.snap).toBe(true);
    expect(sanitizePrefs({ snap: false }).snap).toBe(false);
    expect(sanitizePrefs({}).snap).toBe(true);
  });
```

In `describe("editActionForKey")`, "maps editing keys", add:

```ts
    expect(k("%", { shiftKey: true })).toEqual({ kind: "toggleSnap" });
    expect(k("%", { metaKey: true })).toBeNull();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/prefs-route-keys.test.ts`
Expected: FAIL — `snap` is missing from sanitised prefs; `%` maps to null.

- [ ] **Step 3: Implement**

`src/persist/preferences.ts`:
- `export type Prefs = { style: Style; polygon: PolygonPrefs; snap: boolean };`
- add `snap: true,` to `DEFAULT_PREFS`
- in `sanitizePrefs`'s returned object, after `polygon: {...},` add
  `snap: typeof r.snap === "boolean" ? r.snap : d.snap,`

`src/tools/tool.ts`:
- replace the `Overlay` type with
  ```ts
  /** Transient drawing that is not part of the document (doc-space coordinates). */
  export type Overlay =
    | { kind: "marquee"; box: Box }
    | { kind: "guides"; xs: number[]; ys: number[] }
    | null;
  ```
- add to `ToolContext`, after `prefs(): Prefs;`:
  ```ts
    /** Whether moves, resizes and drawing should snap (the Snap toggle). */
    snapEnabled(): boolean;
  ```

`src/tools/context.ts`: add `snapEnabled: () => app.prefs.snap,` after `prefs`.

`src/__tests__/fake-context.ts`: add `snapEnabled: () => prefs.snap,` after `prefs`.

`src/state/keys.ts`:
- add `| { kind: "toggleSnap" }` to `EditAction`
- in `editActionForKey`, right after the `if (e.metaKey || e.ctrlKey) ...` line, add
  `if (e.key === "%") return { kind: "toggleSnap" };`

`src/state/appState.svelte.ts` — add after `setPolygonPrefs`:

```ts
export function toggleSnap(): void {
  setPrefs({ ...app.prefs, snap: !app.prefs.snap });
}
```

`src/state/commands.ts` — import `toggleSnap` with the other store imports and add to
`runEditAction`'s switch:

```ts
    case "toggleSnap":
      return toggleSnap();
```

- [ ] **Step 4: Verify**

Run: `npx vitest run src/__tests__/prefs-route-keys.test.ts`, then `npm test`, `npm run build`,
`npm run lint`.
Expected: all pass (the prefs file now has 11 tests); build 0 errors / 0 warnings. `Overlay.svelte`
still compiles because it only reads `app.overlay?.kind === "marquee"`.

- [ ] **Step 5: Commit**

```bash
git add src/persist/preferences.ts src/tools/tool.ts src/tools/context.ts src/__tests__/fake-context.ts src/state/keys.ts src/state/commands.ts src/state/appState.svelte.ts src/__tests__/prefs-route-keys.test.ts
git commit -m "feat: snap preference, % toggle and tool-context plumbing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Snapping while drawing

**Files:**
- Modify: `src/tools/shape-tools.ts`
- Test: `src/__tests__/shape-tools.test.ts` (extended)

**Interfaces:**
- Consumes: `SNAP_PX`, `collectTargets`, `snapPoint`, `hasGuides`, `NO_GUIDES`, `SnapTargets`, `Guides`; `ToolContext.snapEnabled`, `Overlay` guides kind.
- Produces (spec §3.2 "Draw"): with Snap on, `createDragTool` collects targets for the whole document at `down`, snaps the start point once at `down`, and snaps the current point on every update (threshold `SNAP_PX / ctx.view().zoom`), except the line tool while Shift is held. While the current point is snapped, the overlay is `{ kind: "guides", ...guides }`, otherwise `null`; `up` and `cancel` clear it. With Snap off, behaviour is unchanged.

- [ ] **Step 1: Write the failing tests** — append to `src/__tests__/shape-tools.test.ts`

```ts
describe("snapping while drawing", () => {
  const withRect = (): Doc => {
    const d = createDoc(100, 100);
    return {
      ...d,
      layers: [
        {
          ...d.layers[0],
          children: [
            {
              kind: "rect",
              id: "a",
              transform: IDENTITY,
              style: DEFAULT_PREFS.style,
              x: 20,
              y: 20,
              w: 10,
              h: 10,
              rx: 0,
            },
          ],
        },
      ],
    };
  };

  it("snaps the start and current points to the artboard and shows guides", () => {
    const { ctx, state } = fakeContext(blank());
    const tool = createRectTool();
    tool.down(ctx, ev(1, 1));
    tool.move(ctx, ev(48, 30));
    expect(state.overlay).toEqual({ kind: "guides", xs: [50], ys: [] });
    tool.up(ctx, ev(48, 30));
    expect(children(state.session.doc)[0]).toMatchObject({ x: 0, y: 0, w: 50, h: 30 });
    expect(state.overlay).toBeNull();
  });

  it("snaps to other objects' edges", () => {
    const { ctx, state } = fakeContext(withRect());
    drag(createRectTool(), ctx, [60, 60], [31, 71]);
    expect(children(state.session.doc)[1]).toMatchObject({ x: 30, y: 60, w: 30, h: 11 });
  });

  it("does nothing when Snap is off", () => {
    const { ctx, state } = fakeContext(blank(), { ...DEFAULT_PREFS, snap: false });
    drag(createRectTool(), ctx, [1, 1], [48, 30]);
    expect(children(state.session.doc)[0]).toMatchObject({ x: 1, y: 1, w: 47, h: 29 });
    expect(state.overlay).toBeNull();
  });

  it("uses a screen-sized threshold", () => {
    const { ctx, state } = fakeContext(blank());
    state.view = { x: 0, y: 0, zoom: 4 };
    drag(createRectTool(), ctx, [3, 3], [40, 40]);
    expect(children(state.session.doc)[0]).toMatchObject({ x: 3, y: 3 });
  });

  it("does not snap a Shift-constrained line end", () => {
    const { ctx, state } = fakeContext(blank());
    drag(createLineTool(), ctx, [1, 1], [48, 3], { shift: true });
    const line = children(state.session.doc)[0] as PathShape;
    const [a, b] = line.subpaths[0].nodes;
    expect(a.p).toEqual({ x: 0, y: 0 });
    expect(b.p.x).toBeCloseTo(Math.hypot(48, 3));
    expect(b.p.y).toBeCloseTo(0);
  });

  it("clears the guides on cancel", () => {
    const { ctx, state } = fakeContext(blank());
    const tool = createRectTool();
    tool.down(ctx, ev(1, 1));
    tool.move(ctx, ev(48, 30));
    tool.cancel(ctx);
    expect(state.overlay).toBeNull();
  });
});
```

Also add `import { IDENTITY } from "../geom/mat";` to the test file's imports.

Hand-checks (artboard targets xs = ys = [0, 50, 100], threshold 8):
- **Start (1, 1):** snaps to (0, 0).
- **End (48, 30):** x 48 snaps to 50 (d = 2); y 30 has nothing within 8, so it stays. The rect is (0, 0, 50, 30), and the guides are xs [50] and ys [].
- **With rect `a` (20–30):**
  - the start point (60, 60) has nothing within 8 and stays;
  - the end point (31, 71) snaps x 31 → 30, and y 71 stays;
  - so the new rect is x 30–60 (w 30), y 60–71 (h 11).
- **Zoom 4:** the threshold is 2 doc units, so (3, 3) is 3 away from 0 and doesn't snap.
- **Line:** its start snaps to (0, 0). The end is Shift-constrained to angle 0, with length √(48² + 3²).

The earlier tests in this file must still pass unchanged (their points are all more than 8 units
from the artboard lines, or already on them).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/shape-tools.test.ts`
Expected: FAIL in the snapping tests (no snapping yet).

- [ ] **Step 3: Implement** — edit `src/tools/shape-tools.ts`

Add imports:

```ts
import {
  collectTargets,
  hasGuides,
  NO_GUIDES,
  SNAP_PX,
  snapPoint,
  type Guides,
  type SnapTargets,
} from "../geom/snap";
```

Replace `Active` and `createDragTool` with:

```ts
type Active = {
  start: ToolEvent;
  /** The start point after snapping. */
  from: Vec;
  layerId: string;
  base: Doc;
  createdId: string | null;
  targets: SnapTargets | null;
};

/** `snapEnd` says whether the current point may snap (the line tool opts out while Shift
 *  constrains its angle). */
function createDragTool(
  id: ToolId,
  hint: string,
  build: Build,
  snapEnd: (mods: Mods) => boolean = () => true,
): Tool {
  let active: Active | null = null;

  const threshold = (ctx: ToolContext) => SNAP_PX / ctx.view().zoom;

  function update(ctx: ToolContext, e: ToolEvent): void {
    if (!active) return;
    let to = e.doc;
    let guides: Guides = NO_GUIDES;
    if (active.targets && snapEnd(e.mods)) {
      const s = snapPoint(e.doc, active.targets, threshold(ctx));
      to = s.p;
      guides = s.guides;
    }
    ctx.setOverlay(hasGuides(guides) ? { kind: "guides", ...guides } : null);
    const shape = movedEnough(active.start.screen, e.screen)
      ? build(active.from, to, e.mods, ctx.prefs())
      : null;
    if (!shape) {
      ctx.commit(active.base);
      active.createdId = null;
      return;
    }
    const r = addShape(active.base, active.layerId, shape);
    ctx.commit(r.doc);
    active.createdId = r.id;
  }

  return {
    id,
    hint,
    cursor: "crosshair",
    down(ctx, e) {
      const doc = ctx.doc();
      const layerId = targetLayerId(doc);
      if (!layerId) {
        ctx.notify("info", "Every layer is hidden or locked — there is nowhere to draw.");
        return;
      }
      const targets = ctx.snapEnabled() ? collectTargets(doc, []) : null;
      const from = targets ? snapPoint(e.doc, targets, threshold(ctx)).p : e.doc;
      ctx.beginGesture();
      active = { start: e, from, layerId, base: doc, createdId: null, targets };
    },
    move(ctx, e) {
      update(ctx, e);
    },
    up(ctx, e) {
      if (!active) return;
      update(ctx, e);
      if (active.createdId) ctx.setSelection([active.createdId]);
      ctx.setOverlay(null);
      ctx.endGesture();
      active = null;
    },
    cancel(ctx) {
      if (!active) return;
      ctx.commit(active.base);
      ctx.setOverlay(null);
      ctx.endGesture();
      active = null;
    },
  };
}
```

In `createLineTool`, pass the fourth argument to `createDragTool`:
`(mods) => !mods.shift`.

`{ kind: "guides", ...guides }` spreads the `xs`/`ys` arrays by reference. That is fine: nothing
mutates them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/shape-tools.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`.
Expected: PASS (19 tests in this file); the full suite passes.

- [ ] **Step 5: Commit**

```bash
git add src/tools/shape-tools.ts src/__tests__/shape-tools.test.ts
git commit -m "feat(tools): snap drawing to the artboard and other objects, with guides

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Snapping in the select tool, and the Alt-drag-back fix

**Files:**
- Modify: `src/tools/select.ts` (full replacement below)
- Test: `src/__tests__/select-tool.test.ts` (extended)

**Interfaces:**
- Consumes: `collectTargets`, `snapBox`, `snapPoint`, `hasGuides`, `NO_GUIDES`, `SNAP_PX`, `SnapTargets`, `Guides`, `Axes`; `selectionBounds`; `Box`.
- Produces (spec §3.2 "Move"/"Resize", §4):
  - **Move:**
    - Targets are collected when the drag starts, excluding the moving ids. After an Alt-duplicate these are the copies, so the originals still count as targets.
    - The moved bounds snap with `snapBox`. Without Shift both axes snap. With a Shift constraint, only the constrained axis snaps (x for horizontal, y for vertical, none for diagonal).
  - **Resize:** when the frame angle is 0 and Snap is on, the handle target point (pointer + grab) snaps with `snapPoint` on the axes that handle moves.
  - **Guides:** the overlay shows them while snapped. `up` and `cancel` clear it.
  - **Alt-drag back:** if the final translation of an Alt-duplicate drag is (0, 0), `up` restores the original document and the pre-drag selection, so there is no duplicate and no history step.

- [ ] **Step 1: Write the failing tests** — append to `src/__tests__/select-tool.test.ts`

```ts
describe("select tool: snapping", () => {
  // twoRects(): a at x 0–40, b at x 60–100, both y 0–40; artboard 200 × 200.
  it("snaps a moved selection to other objects and shows guides", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    t.down(ctx, ev(20, 20));
    t.move(ctx, ev(37, 20));
    expect(state.overlay).toEqual({ kind: "guides", xs: [60], ys: [0] });
    t.up(ctx, ev(37, 20));
    expect(origin(state.session.doc, "a")).toEqual({ x: 20, y: 0 });
    expect(state.overlay).toBeNull();
    expect(state.session.history.past).toHaveLength(1);
  });

  it("does not snap when Snap is off", () => {
    const { ctx, state } = fakeContext(twoRects(), { ...DEFAULT_PREFS, snap: false });
    drag(createSelectTool(), ctx, [20, 20], [37, 20]);
    expect(origin(state.session.doc, "a")).toEqual({ x: 17, y: 0 });
  });

  it("snaps only along a Shift-constrained axis", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    t.down(ctx, ev(20, 20, { shift: true }));
    t.move(ctx, ev(37, 22, { shift: true }));
    expect(state.overlay).toEqual({ kind: "guides", xs: [60], ys: [] });
    t.up(ctx, ev(37, 22, { shift: true }));
    const p = origin(state.session.doc, "a");
    expect(p.x).toBeCloseTo(20);
    expect(p.y).toBeCloseTo(0);
  });

  it("snaps a resize handle", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    tap(t, ctx, 20, 20);
    drag(t, ctx, [40, 40], [57, 43]);
    expect(node(state.session.doc, "a")).toMatchObject({ x: 0, y: 0, w: 60, h: 40 });
  });

  it("an Alt-drag that ends where it started leaves nothing behind", () => {
    const { ctx, state } = fakeContext(twoRects());
    const t = createSelectTool();
    t.down(ctx, ev(20, 20, { alt: true }));
    t.move(ctx, ev(20, 60, { alt: true }));
    expect(state.session.doc.layers[0].children).toHaveLength(3);
    t.move(ctx, ev(20, 20, { alt: true }));
    t.up(ctx, ev(20, 20, { alt: true }));
    expect(state.session.doc.layers[0].children.map((n) => n.id)).toEqual(["a", "b"]);
    expect(state.session.history.past).toHaveLength(0);
    expect(state.selection).toEqual(["a"]);
    expect(state.overlay).toBeNull();
  });
});
```

Add `import { DEFAULT_PREFS } from "../persist/preferences";` to the test file's imports.

Hand-checks. Targets are the artboard (0, 100, 200 on both axes) plus `b` (xs 60, 80, 100; ys 0, 20,
40). Sorted: xs [0, 60, 80, 100, 100, 200] and ys [0, 0, 20, 40, 100, 200]. The threshold is 8.
- **Move by (17, 0):** a's bounds become x 17–57 (centre 37) and y 0–40.
  - x: 17 → 0 is 17 away, too far; 57 → 60 is 3 away, snaps; 37 has nothing near. So dx becomes 20, guide x 60.
  - y: 0 → 0 is 0 away, so dy stays 0, guide y 0.
- **Shift-constrained (17, 2):** the constraint gives (17, 0), so only x snaps: dx 20, and ys is empty.
- **Resize:** `se` is grabbed exactly at (40, 40), so grab = (0, 0), and the target is (57, 43). x 57 → 60 (3 away); y 43 → 40 (3 away). The rect becomes 60 × 40.
- **Alt-drag back:** the last move is (0, 0). The copy's bounds (0–40) snap to 0 with a delta of 0, so the final translation is exactly (0, 0).

The earlier tests in this file must still pass unchanged. Their drags stay more than 8 units from
every target, or land exactly on one (a 0 delta).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/select-tool.test.ts`
Expected: FAIL in the new snapping / Alt-drag-back tests.

- [ ] **Step 3: Implement** — replace `src/tools/select.ts` with:

```ts
import type { Doc } from "../doc/document";
import { duplicateNodes, rotateNodes, translateNodes } from "../doc/edits";
import { resizeNodes } from "../doc/resize";
import { boxFromPoints, type Box } from "../geom/box";
import { hitTest, marqueeSelect } from "../geom/hit";
import {
  collectTargets,
  hasGuides,
  NO_GUIDES,
  SNAP_PX,
  snapBox,
  snapPoint,
  type Axes,
  type Guides,
  type SnapTargets,
} from "../geom/snap";
import type { Vec } from "../geom/vec";
import {
  docToFrame,
  frameCenter,
  frameResizeMap,
  selectionBounds,
  selectionFrame,
  type Frame,
} from "./frame";
import {
  dragHandle,
  handleAt,
  handleFramePoint,
  handleSize,
  rotateDelta,
  type Handle,
  type ResizeHandle,
} from "./gizmo";
import { SNAP_45 } from "./shape-tools";
import { movedEnough, pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

type Common = { start: ToolEvent; startSelection: readonly string[] };
type Pending = Common & {
  kind: "pending";
  hitId: string | null;
  handle: Handle | null;
  frame: Frame | null;
  toggleOnUp: boolean;
  collapseOnUp: boolean;
};
type MoveMode = Common & {
  kind: "move";
  original: Doc;
  base: Doc;
  ids: readonly string[];
  /** Set when the drag duplicated with Alt: the selection the copies were made from. */
  duplicatedFrom: readonly string[] | null;
  bounds: Box | null;
  targets: SnapTargets | null;
  /** The last committed translation. */
  last: Vec;
};
type Mode =
  | Pending
  | (Common & { kind: "marquee"; base: readonly string[] })
  | MoveMode
  | (Common & {
      kind: "resize";
      original: Doc;
      ids: readonly string[];
      frame: Frame;
      handle: ResizeHandle;
      /** Handle point minus the press point, in frame coordinates. */
      grab: Vec;
      targets: SnapTargets | null;
    })
  | (Common & { kind: "rotate"; original: Doc; ids: readonly string[]; frame: Frame; centre: Vec });

const ALL_AXES: Axes = { x: true, y: true };
const NO_AXES: Axes = { x: false, y: false };

function constrain(dx: number, dy: number): [number, number, Axes] {
  const angle = Math.round(Math.atan2(dy, dx) / SNAP_45) * SNAP_45;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const along = dx * c + dy * s;
  const horizontal = Math.abs(s) < 1e-9;
  const vertical = Math.abs(c) < 1e-9;
  const axes = horizontal ? { x: true, y: false } : vertical ? { x: false, y: true } : NO_AXES;
  return [along * c, along * s, axes];
}

const threshold = (ctx: ToolContext) => SNAP_PX / ctx.view().zoom;

function showGuides(ctx: ToolContext, guides: Guides): void {
  ctx.setOverlay(hasGuides(guides) ? { kind: "guides", ...guides } : null);
}

function startDrag(ctx: ToolContext, p: Pending): Mode {
  const doc = ctx.doc();
  const ids = ctx.selection();
  const snapping = ctx.snapEnabled();
  const common = { start: p.start, startSelection: p.startSelection };
  if (p.handle && p.frame) {
    ctx.beginGesture();
    if (p.handle === "rotate") {
      return {
        ...common,
        kind: "rotate",
        original: doc,
        ids,
        frame: p.frame,
        centre: frameCenter(p.frame),
      };
    }
    const pressed = docToFrame(p.frame, p.start.doc);
    const at = handleFramePoint(p.handle, p.frame.box);
    const grab = { x: at.x - pressed.x, y: at.y - pressed.y };
    const targets = snapping && p.frame.angle === 0 ? collectTargets(doc, ids) : null;
    return {
      ...common,
      kind: "resize",
      original: doc,
      ids,
      frame: p.frame,
      handle: p.handle,
      grab,
      targets,
    };
  }
  if (p.hitId) {
    ctx.beginGesture();
    let base = doc;
    let moveIds = ids;
    let duplicatedFrom: readonly string[] | null = null;
    if (p.start.mods.alt) {
      const dup = duplicateNodes(doc, ids, 0, 0);
      base = dup.doc;
      moveIds = dup.ids;
      duplicatedFrom = ids;
      ctx.commit(base);
      ctx.setSelection(moveIds);
    }
    return {
      ...common,
      kind: "move",
      original: doc,
      base,
      ids: moveIds,
      duplicatedFrom,
      bounds: selectionBounds(base, moveIds),
      targets: snapping ? collectTargets(base, moveIds) : null,
      last: { x: 0, y: 0 },
    };
  }
  return { ...common, kind: "marquee", base: p.start.mods.shift ? ids : [] };
}

function drag(ctx: ToolContext, m: Mode, e: ToolEvent): void {
  switch (m.kind) {
    case "pending":
      return;
    case "move": {
      let dx = e.doc.x - m.start.doc.x;
      let dy = e.doc.y - m.start.doc.y;
      let axes = ALL_AXES;
      if (e.mods.shift) [dx, dy, axes] = constrain(dx, dy);
      let guides = NO_GUIDES;
      if (m.targets && m.bounds) {
        const moved = { ...m.bounds, x: m.bounds.x + dx, y: m.bounds.y + dy };
        const s = snapBox(moved, m.targets, threshold(ctx), axes);
        dx += s.dx;
        dy += s.dy;
        guides = s.guides;
      }
      showGuides(ctx, guides);
      m.last = { x: dx, y: dy };
      ctx.commit(translateNodes(m.base, m.ids, dx, dy));
      return;
    }
    case "resize": {
      const p = docToFrame(m.frame, e.doc);
      let target = { x: p.x + m.grab.x, y: p.y + m.grab.y };
      let guides = NO_GUIDES;
      if (m.targets) {
        const axes = {
          x: m.handle.includes("e") || m.handle.includes("w"),
          y: m.handle.includes("n") || m.handle.includes("s"),
        };
        const s = snapPoint(target, m.targets, threshold(ctx), axes);
        target = s.p;
        guides = s.guides;
      }
      showGuides(ctx, guides);
      const box = dragHandle(m.handle, m.frame.box, target, e.mods);
      ctx.commit(resizeNodes(m.original, m.ids, frameResizeMap(m.frame.angle, m.frame.box, box)));
      return;
    }
    case "rotate": {
      const d = rotateDelta(m.centre, m.start.doc, e.doc, m.frame.angle, e.mods.shift);
      ctx.commit(rotateNodes(m.original, m.ids, d, m.centre));
      return;
    }
    case "marquee": {
      const box = boxFromPoints([m.start.doc, e.doc])!;
      ctx.setOverlay({ kind: "marquee", box });
      const inside = marqueeSelect(ctx.doc(), box).filter((id) => !m.base.includes(id));
      ctx.setSelection([...m.base, ...inside]);
      return;
    }
  }
}

export function createSelectTool(): Tool {
  let mode: Mode | null = null;

  function cancelMode(ctx: ToolContext): void {
    const m = mode;
    mode = null;
    if (!m) return;
    if (m.kind === "move" || m.kind === "resize" || m.kind === "rotate") {
      ctx.commit(m.original);
      ctx.endGesture();
    }
    ctx.setOverlay(null);
    ctx.setSelection(m.startSelection);
  }

  return {
    id: "select",
    hint: "Click to select · drag to move · Shift: add · drag empty space to select an area",
    cursor: "default",

    down(ctx, e) {
      cancelMode(ctx);
      const sel = ctx.selection();
      const doc = ctx.doc();
      const view = ctx.view();
      const frame = sel.length > 0 ? selectionFrame(doc, sel) : null;
      const handle = frame ? handleAt(frame, view, e.screen, handleSize(e.pointerType)) : null;
      let hitId: string | null = null;
      let toggleOnUp = false;
      let collapseOnUp = false;
      if (!handle) {
        hitId = hitTest(doc, e.doc, pointerTolerance(e.pointerType) / view.zoom)?.nodeId ?? null;
        if (hitId && !sel.includes(hitId))
          ctx.setSelection(e.mods.shift ? [...sel, hitId] : [hitId]);
        else if (hitId && e.mods.shift) toggleOnUp = true;
        else if (hitId && sel.length > 1) collapseOnUp = true;
      }
      mode = {
        kind: "pending",
        start: e,
        startSelection: sel,
        hitId,
        handle,
        frame,
        toggleOnUp,
        collapseOnUp,
      };
    },

    move(ctx, e) {
      if (!mode) return;
      if (mode.kind === "pending") {
        if (!movedEnough(mode.start.screen, e.screen)) return;
        mode = startDrag(ctx, mode);
      }
      drag(ctx, mode, e);
    },

    up(ctx, e) {
      const m = mode;
      mode = null;
      if (!m) return;
      if (m.kind === "pending") {
        if (m.handle) return;
        if (m.hitId && m.toggleOnUp) {
          const id = m.hitId;
          ctx.setSelection(ctx.selection().filter((s) => s !== id));
        } else if (m.hitId && m.collapseOnUp) {
          ctx.setSelection([m.hitId]);
        } else if (!m.hitId && !m.start.mods.shift) {
          ctx.setSelection([]);
        }
        return;
      }
      drag(ctx, m, e);
      ctx.setOverlay(null);
      if (m.kind === "marquee") return;
      if (m.kind === "move" && m.duplicatedFrom && m.last.x === 0 && m.last.y === 0) {
        // Alt-dragged back to the start: drop the copies rather than stacking a hidden duplicate.
        ctx.commit(m.original);
        ctx.setSelection(m.duplicatedFrom);
      }
      ctx.endGesture();
    },

    cancel(ctx) {
      cancelMode(ctx);
    },
  };
}
```

Notes:
- `m.last = …` mutates the tool's private mode object. It is not document state, so the immutability constraint doesn't apply.
- In the Alt-drag-back case, `endGesture` sees `doc === gestureBase` (the original) and records nothing.
- With the frame angle at 0, `docToFrame` is the identity (`rot` in frame.ts), so a snapped frame point is a snapped doc point.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/select-tool.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`.
Expected: PASS (21 tests in this file); the full suite passes.

- [ ] **Step 5: Commit**

```bash
git add src/tools/select.ts src/__tests__/select-tool.test.ts
git commit -m "feat(tools): snap moves and resizes; Alt-drag back to start leaves no copy

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Clipboard planning and `insertNodes`

**Files:**
- Modify: `src/doc/edits.ts` (append `insertNodes`)
- Create: `src/state/clipboard.ts`
- Test: `src/__tests__/clipboard.test.ts`

**Interfaces:**
- Consumes: `withFreshIds` (private in edits.ts), `idFor`, `translate`, `multiply`; `targetLayerId`; `nodeBounds`; `Box`, `boxCenter`, `unionBox`; `IDENTITY`; `parseSvg`; `serializeDoc`.
- Produces (spec §2.3):
  - `edits.ts`: `insertNodes(doc, layerId, nodes: readonly Node[], dx, dy): { doc: Doc; ids: string[] }` — deep copies with fresh ids, appended on top of the layer, translated when `dx`/`dy` ≠ 0; no nodes → `{ doc, ids: [] }` (same doc); unknown layer → throws `Error`.
  - `clipboard.ts`:
    - `PASTE_STEP = 10`
    - messages `NOT_SVG = "The clipboard doesn't contain an SVG drawing."`, `EMPTY = "The clipboard drawing is empty."`, `NO_LAYER = "Every layer is hidden or locked — there is nowhere to paste."`
    - `type Clip = { text: string; pastes: number }`
    - `type PastePlan = { doc: Doc; ids: string[]; dropped: string[]; clip: Clip | null }`
    - `type PasteError = { error: string }`
    - `clipboardText(doc, ids): string | null`
    - `planPaste(doc, text, clip: Clip | null, view: Box): PastePlan | PasteError`
    - `isPasteError(r): r is PasteError`
    - `looksLikeSvg(text: string): boolean` (`/<svg[\s>/]/i`)

- [ ] **Step 1: Write the failing test** — `src/__tests__/clipboard.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Group,
  type Layer,
  type Node,
} from "../doc/document";
import { insertNodes } from "../doc/edits";
import { applyMat, IDENTITY, translate } from "../geom/mat";
import {
  clipboardText,
  EMPTY,
  isPasteError,
  looksLikeSvg,
  NO_LAYER,
  NOT_SVG,
  planPaste,
  type Clip,
  type PastePlan,
} from "../state/clipboard";
import { parseSvg } from "../svg/parse";
import { deepFreeze, stripIds } from "./helpers";

const rect = (id: string, x: number, y: number): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x,
  y,
  w: 20,
  h: 20,
  rx: 0,
});

function doc(layers: Partial<Layer>[], nextId = 50): Doc {
  return deepFreeze({
    ...createDoc(100, 100),
    nextId,
    layers: layers.map((l, i) => ({
      id: `L${i}`,
      name: `L${i}`,
      visible: true,
      locked: false,
      children: [],
      ...l,
    })),
  });
}

const view = { x: 0, y: 0, w: 100, h: 100 };
const plan = (r: ReturnType<typeof planPaste>): PastePlan => {
  if (isPasteError(r)) throw new Error(r.error);
  return r;
};
const originOf = (d: Doc, id: string) =>
  applyMat(d.layers.flatMap((l) => l.children).find((n) => n.id === id)!.transform, { x: 0, y: 0 });

describe("insertNodes", () => {
  it("appends deep copies with fresh ids, translated", () => {
    const d = doc([{ children: [rect("a", 0, 0)] }]);
    const g: Group = {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      opacity: 1,
      children: [rect("inner", 0, 0)],
    };
    const r = insertNodes(d, "L0", [rect("x", 1, 1), g], 5, 6);
    expect(r.ids).toEqual(["n50", "n51"]);
    expect(r.doc.layers[0].children.map((n) => n.id)).toEqual(["a", "n50", "n51"]);
    expect((r.doc.layers[0].children[2] as Group).children[0].id).toBe("n52");
    expect(r.doc.nextId).toBe(53);
    expect(r.doc.layers[0].children[1].transform).toEqual(translate(5, 6));
    const none = insertNodes(d, "L0", [], 1, 1);
    expect(none.doc).toBe(d);
    expect(none.ids).toEqual([]);
    expect(() => insertNodes(d, "nope", [rect("x", 0, 0)], 0, 0)).toThrow();
    const still = insertNodes(d, "L0", [rect("x", 0, 0)], 0, 0);
    expect(still.doc.layers[0].children[1].transform).toBe(IDENTITY);
  });
});

describe("clipboardText", () => {
  it("serialises the selected top-level nodes in document order", () => {
    const d = doc([{ children: [rect("a", 10, 10), rect("b", 50, 50)] }, { children: [rect("c", 0, 0)] }]);
    expect(clipboardText(d, [])).toBeNull();
    expect(clipboardText(d, ["zz"])).toBeNull();
    const text = clipboardText(d, ["c", "a"])!;
    expect(text).toContain('data-sv-name="Clipboard"');
    expect(looksLikeSvg(text)).toBe(true);
    const back = parseSvg(text).doc;
    expect(back.layers).toHaveLength(1);
    expect(stripIds(back).layers[0].children).toEqual(
      stripIds({ ...d, layers: [{ ...d.layers[0], children: [rect("a", 10, 10), rect("c", 0, 0)] }] })
        .layers[0].children,
    );
  });
});

describe("planPaste", () => {
  const source = doc([{ children: [rect("a", 10, 10)] }]);
  const text = clipboardText(source, ["a"])!;

  it("cascades repeated pastes of our own copy by 10", () => {
    const clip: Clip = { text, pastes: 0 };
    const first = plan(planPaste(source, text, clip, view));
    expect(first.ids).toEqual(["n50"]);
    expect(originOf(first.doc, "n50")).toEqual({ x: 10, y: 10 });
    expect(first.clip).toEqual({ text, pastes: 1 });
    expect(first.dropped).toEqual([]);
    const second = plan(planPaste(first.doc, text, first.clip, view));
    expect(originOf(second.doc, second.ids[0])).toEqual({ x: 20, y: 20 });
    expect(second.clip).toEqual({ text, pastes: 2 });
  });

  it("centres our copy in the view when the offset copy would be off-screen", () => {
    const far = { x: 500, y: 500, w: 100, h: 100 };
    const r = plan(planPaste(source, text, { text, pastes: 0 }, far));
    // bounds (10,10,20,20) centre (20,20) → view centre (550,550)
    expect(originOf(r.doc, r.ids[0])).toEqual({ x: 530, y: 530 });
    expect(r.clip).toEqual({ text, pastes: 1 });
  });

  it("centres external SVG on the view and keeps the in-app copy", () => {
    const clip: Clip = { text, pastes: 3 };
    const ext = `<svg viewBox="0 0 50 50"><circle cx="5" cy="5" r="5"/><text>hi</text></svg>`;
    expect(looksLikeSvg(ext)).toBe(true);
    const r = plan(planPaste(source, ext, clip, view));
    expect(r.clip).toBe(clip);
    expect(r.dropped).toEqual(["<text>"]);
    expect(originOf(r.doc, r.ids[0])).toEqual({ x: 45, y: 45 });
    const noClip = plan(planPaste(source, ext, null, view));
    expect(noClip.clip).toBeNull();
  });

  it("pastes into the top-most visible unlocked layer", () => {
    const d = doc([{ children: [] }, { children: [] }, { children: [], locked: true }]);
    const r = plan(planPaste(d, text, null, view));
    expect(r.doc.layers[1].children.map((n) => n.id)).toEqual(r.ids);
    expect(r.doc.layers[0].children).toHaveLength(0);
  });

  it("reports errors without changing anything", () => {
    expect(planPaste(source, "hello", null, view)).toEqual({ error: NOT_SVG });
    expect(planPaste(source, "<html></html>", null, view)).toEqual({ error: NOT_SVG });
    expect(planPaste(source, "<svg/>", null, view)).toEqual({ error: EMPTY });
    const locked = doc([{ children: [], locked: true }]);
    expect(planPaste(locked, text, null, view)).toEqual({ error: NO_LAYER });
    expect(looksLikeSvg("just text")).toBe(false);
    expect(looksLikeSvg("<SVG width='1'/>")).toBe(true);
  });
});
```

Hand-checks:
- **Own copy, first paste:** the copy's bounds are (10, 10, 20, 20). With n = 1 the offset is (10, 10), which still meets the view (0, 0, 100, 100), so the node's origin maps to (10, 10). The rect keeps x 10, and its matrix is `translate(10, 10)`.
- **Own copy, second paste:** n = 2, so the offset is (20, 20).
- **External SVG:** the circle's bounds are (0, 0, 10, 10) with centre (5, 5). The view centre is (50, 50), so the translation is (45, 45). The `<text>` element is reported as dropped.
- **Target layer:** L2 is locked, so L1 is the top-most usable layer.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/clipboard.test.ts`
Expected: FAIL — cannot resolve `../state/clipboard`.

- [ ] **Step 3: Implement**

Append to `src/doc/edits.ts`:

```ts
/** Adds copies of `nodes` (fresh ids) on top of a layer, moved by (dx, dy). */
export function insertNodes(
  doc: Doc,
  layerId: string,
  nodes: readonly Node[],
  dx: number,
  dy: number,
): { doc: Doc; ids: string[] } {
  const li = doc.layers.findIndex((l) => l.id === layerId);
  if (li < 0) throw new Error(`No layer ${layerId}`);
  if (nodes.length === 0) return { doc, ids: [] };
  let nextId = doc.nextId;
  const next = () => idFor(nextId++);
  const offset = translate(dx, dy);
  const added = nodes.map((n) => {
    const copy = withFreshIds(n, next);
    return dx === 0 && dy === 0 ? copy : { ...copy, transform: multiply(offset, copy.transform) };
  });
  const layers = doc.layers.slice();
  layers[li] = { ...layers[li], children: [...layers[li].children, ...added] };
  return { doc: { ...doc, layers, nextId }, ids: added.map((n) => n.id) };
}
```

`src/state/clipboard.ts`:

```ts
import type { Doc, Node } from "../doc/document";
import { insertNodes } from "../doc/edits";
import { targetLayerId } from "../doc/tree";
import { nodeBounds } from "../geom/bounds";
import { boxCenter, unionBox, type Box } from "../geom/box";
import { IDENTITY } from "../geom/mat";
import { parseSvg, type ParseResult } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";

export const PASTE_STEP = 10;
export const NOT_SVG = "The clipboard doesn't contain an SVG drawing.";
export const EMPTY = "The clipboard drawing is empty.";
export const NO_LAYER = "Every layer is hidden or locked — there is nowhere to paste.";

/** The in-app copy: what we last copied, and how many times it has been pasted since. */
export type Clip = { text: string; pastes: number };
export type PastePlan = { doc: Doc; ids: string[]; dropped: string[]; clip: Clip | null };
export type PasteError = { error: string };

export function isPasteError(r: PastePlan | PasteError): r is PasteError {
  return "error" in r;
}

export function looksLikeSvg(text: string): boolean {
  return /<svg[\s>/]/i.test(text);
}

/** The selected top-level nodes as a standalone SVG in our own format, coordinates unchanged. */
export function clipboardText(doc: Doc, ids: readonly string[]): string | null {
  const wanted = new Set(ids);
  const nodes = doc.layers.flatMap((l) => l.children.filter((n) => wanted.has(n.id)));
  if (nodes.length === 0) return null;
  return serializeDoc({
    ...doc,
    artboard: { ...doc.artboard, background: null },
    layers: [{ id: "clip", name: "Clipboard", visible: true, locked: false, children: nodes }],
  });
}

function boundsOf(nodes: readonly Node[]): Box | null {
  let box: Box | null = null;
  for (const n of nodes) box = unionBox(box, nodeBounds(n, IDENTITY));
  return box;
}

function intersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Spec (M2b) §2.3. `view` is the visible canvas area in document coordinates. */
export function planPaste(
  doc: Doc,
  text: string,
  clip: Clip | null,
  view: Box,
): PastePlan | PasteError {
  let parsed: ParseResult;
  try {
    parsed = parseSvg(text);
  } catch {
    return { error: NOT_SVG };
  }
  const nodes = parsed.doc.layers.flatMap((l) => l.children);
  const bounds = boundsOf(nodes);
  if (nodes.length === 0 || !bounds) return { error: EMPTY };
  const layerId = targetLayerId(doc);
  if (!layerId) return { error: NO_LAYER };

  const own = clip !== null && text === clip.text;
  const n = own ? clip.pastes + 1 : 0;
  const vc = boxCenter(view);
  const bc = boxCenter(bounds);
  let dx = vc.x - bc.x;
  let dy = vc.y - bc.y;
  if (own) {
    const step = PASTE_STEP * n;
    if (intersects({ ...bounds, x: bounds.x + step, y: bounds.y + step }, view)) {
      dx = step;
      dy = step;
    }
  }
  const r = insertNodes(doc, layerId, nodes, dx, dy);
  return {
    doc: r.doc,
    ids: r.ids,
    dropped: parsed.dropped,
    clip: own ? { text, pastes: n } : clip,
  };
}
```

Notes:
- **`parseSvg` never throws for unsupported content.** It throws only for malformed XML or a non-SVG root, and very deep nesting can throw `RangeError`. The bare `catch` turns all of these into `NOT_SVG`.
- **The `"<svg/>"` case:** the importer gives it one empty layer, so `nodes` is empty and the result is `EMPTY`.
- **Why the round-trip test uses `stripIds`:** parsing re-assigns ids.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/clipboard.test.ts`, then `npm test`, `npx tsc --noEmit`, `npm run lint`.
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/doc/edits.ts src/state/clipboard.ts src/__tests__/clipboard.test.ts
git commit -m "feat(clipboard): copy as SVG, paste planning with cascade and centring

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: System clipboard adapter, store actions, window clipboard events

**Files:**
- Create: `src/persist/system-clipboard.ts`
- Test: `src/__tests__/system-clipboard.test.ts`
- Modify: `src/state/appState.svelte.ts` (clipboard section at the end)
- Modify: `src/App.svelte` (window `copy` / `cut` / `paste`)

**Interfaces:**
- Consumes: `clipboardText`, `planPaste`, `isPasteError`, `looksLikeSvg`, `Clip` (Task 5); `deleteNodes`; `screenToDoc`; `Box`; the store's `commitDoc`, `setSelection`, `notify`, `cancelActiveGesture`.
- Produces:
  - `system-clipboard.ts` (spec §2.4). Both functions never throw. The optional parameter exists only for tests:
    - `type ClipboardLike = { writeText?: (text: string) => Promise<void>; readText?: () => Promise<string> }`
    - `writeClipboardText(text: string, clipboard?: ClipboardLike): Promise<boolean>`
    - `readClipboardText(clipboard?: ClipboardLike): Promise<string | null>`
  - Store actions (spec §2.5); the Task 7 UI relies on these names:
    - `visibleDocBox(): Box`
    - `copySelection(): string | null`
    - `cutSelection(): string | null`
    - `pasteText(text: string): void`
    - `pasteFromClipboard(): Promise<void>`
    - `copyToSystem(): void` and `cutToSystem(): void`, for buttons and menu items: copy/cut, then write the system clipboard, silently ignoring failure.

**Rulings the implementer follows:**
- **`pasteFromClipboard` order:**
  1. System text that `looksLikeSvg`.
  2. Otherwise the in-app copy.
  3. Otherwise any system text; `pasteText` then shows the "doesn't contain an SVG drawing" error.
  4. Otherwise the info notice `Nothing to paste.`

  This follows spec §2.5 ("falls back to the in-app copy"). A non-SVG system clipboard, such as text copied from a web page, counts as "can't use it".
- **`PasteError` messages** are shown as `notify("error", …)`.
- **Dropped features** are shown as `notify("info", "Some content was not imported: " + dropped.join(", "))`, the same text `openText` uses.
- **The window `paste` event** pastes whenever there is non-empty text (spec §2.5), so non-SVG text gets the error notice. It does nothing when there is no text (for example, an image only).

- [ ] **Step 1: Write the failing test** — `src/__tests__/system-clipboard.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { readClipboardText, writeClipboardText } from "../persist/system-clipboard";

describe("system clipboard adapter", () => {
  it("writes, and reports failure instead of throwing", async () => {
    const written: string[] = [];
    const ok = {
      writeText: async (t: string) => {
        written.push(t);
      },
    };
    expect(await writeClipboardText("<svg/>", ok)).toBe(true);
    expect(written).toEqual(["<svg/>"]);
    expect(await writeClipboardText("x", {})).toBe(false);
    expect(await writeClipboardText("x", { writeText: () => Promise.reject(new Error("denied")) })).toBe(false);
    const throwsNow = {
      writeText: (): Promise<void> => {
        throw new Error("sync");
      },
    };
    expect(await writeClipboardText("x", throwsNow)).toBe(false);
  });

  it("reads, and returns null for missing, empty or refused text", async () => {
    expect(await readClipboardText({ readText: async () => "<svg/>" })).toBe("<svg/>");
    expect(await readClipboardText({ readText: async () => "" })).toBeNull();
    expect(await readClipboardText({})).toBeNull();
    expect(await readClipboardText({ readText: () => Promise.reject(new Error("denied")) })).toBeNull();
    const throwsNow = {
      readText: (): Promise<string> => {
        throw new Error("sync");
      },
    };
    expect(await readClipboardText(throwsNow)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/system-clipboard.test.ts`
Expected: FAIL — cannot resolve `../persist/system-clipboard`.

- [ ] **Step 3: Implement the adapter** — `src/persist/system-clipboard.ts`

```ts
/** A thin, never-throwing wrapper around `navigator.clipboard` (spec M2b §2.4). The parameter
 *  exists for tests; the app always uses the browser's clipboard. */
export type ClipboardLike = {
  writeText?: (text: string) => Promise<void>;
  readText?: () => Promise<string>;
};

function browserClipboard(): ClipboardLike | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.clipboard;
}

export async function writeClipboardText(
  text: string,
  clipboard: ClipboardLike | undefined = browserClipboard(),
): Promise<boolean> {
  try {
    if (!clipboard?.writeText) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Null when the clipboard is unavailable, refused (permission) or holds no text. */
export async function readClipboardText(
  clipboard: ClipboardLike | undefined = browserClipboard(),
): Promise<string | null> {
  try {
    if (!clipboard?.readText) return null;
    const text = await clipboard.readText();
    return text ? text : null;
  } catch {
    return null;
  }
}
```

`writeText` and `readText` are called as methods (`clipboard.writeText(...)`), so the browser's `Clipboard` receiver is kept. Do not destructure them.

Run: `npx vitest run src/__tests__/system-clipboard.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Add the store actions** — `src/state/appState.svelte.ts`

Imports: `deleteNodes` is already imported from `../doc/edits`. Add these lines:

```ts
import type { Box } from "../geom/box";
import { readClipboardText, writeClipboardText } from "../persist/system-clipboard";
import { clipboardText, isPasteError, looksLikeSvg, planPaste, type Clip } from "./clipboard";
```

Change the existing viewport import to `import { fitRect, screenToDoc, zoomAt, type View } from "./viewport";`.

Append at the end of the file:

```ts
// ----- clipboard (spec M2b §2) -----

/** Our last copy, used to recognise repeated pastes and as the fallback when the system
 *  clipboard can't be read. Nothing renders it, so it isn't reactive. */
let clip: Clip | null = null;

/** The canvas viewport in document coordinates. */
export function visibleDocBox(): Box {
  const { w, h } = app.viewportSize;
  const a = screenToDoc(app.view, { x: 0, y: 0 });
  const b = screenToDoc(app.view, { x: w, y: h });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** Returns the SVG text for the system clipboard, or null when nothing is selected. */
export function copySelection(): string | null {
  cancelActiveGesture();
  const text = clipboardText(app.doc, app.selection);
  if (text !== null) clip = { text, pastes: 0 };
  return text;
}

export function cutSelection(): string | null {
  const text = copySelection();
  if (text !== null) commitDoc(deleteNodes(app.doc, app.selection));
  return text;
}

/** One undo step; selects what was pasted. */
export function pasteText(text: string): void {
  cancelActiveGesture();
  const r = planPaste(app.doc, text, clip, visibleDocBox());
  if (isPasteError(r)) {
    notify("error", r.error);
    return;
  }
  clip = r.clip;
  commitDoc(r.doc);
  setSelection(r.ids);
  if (r.dropped.length > 0) {
    notify("info", `Some content was not imported: ${r.dropped.join(", ")}`);
  }
}

/** For buttons and menu items. Keyboard paste uses the window `paste` event instead. */
export async function pasteFromClipboard(): Promise<void> {
  cancelActiveGesture();
  const system = await readClipboardText();
  if (system !== null && looksLikeSvg(system)) return pasteText(system);
  if (clip) return pasteText(clip.text);
  if (system !== null) return pasteText(system);
  notify("info", "Nothing to paste.");
}

/** For buttons and menu items: a failed system write is silent — the in-app copy still works. */
export function copyToSystem(): void {
  const text = copySelection();
  if (text !== null) void writeClipboardText(text);
}

export function cutToSystem(): void {
  const text = cutSelection();
  if (text !== null) void writeClipboardText(text);
}
```

- [ ] **Step 5: Handle the window clipboard events** — `src/App.svelte`

Import the new store actions — change the store import to:

```ts
  import { app, copySelection, cutSelection, notify, pasteText } from "./state/appState.svelte";
```

Add these after `onkeyup`:

```ts
  /** Text fields and dialogs keep the browser's own clipboard behaviour. */
  function clipboardIgnored(e: ClipboardEvent): boolean {
    return app.dialog !== null || app.confirm !== null || isEditable(e.target);
  }

  function writeClipboard(e: ClipboardEvent, action: () => string | null) {
    if (clipboardIgnored(e) || !e.clipboardData || app.selection.length === 0) return;
    const text = action();
    if (text === null) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", text);
    e.clipboardData.setData("image/svg+xml", text);
  }

  function onpaste(e: ClipboardEvent) {
    if (clipboardIgnored(e) || !e.clipboardData) return;
    const text = e.clipboardData.getData("image/svg+xml") || e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    pasteText(text);
  }
```

Replace the `<svelte:window …/>` line with:

```svelte
<svelte:window
  {onkeydown}
  {onkeyup}
  onblur={() => (app.spaceHeld = false)}
  oncopy={(e) => writeClipboard(e, copySelection)}
  oncut={(e) => writeClipboard(e, cutSelection)}
  {onpaste}
/>
```

Notes:
- **`clipboardData` is checked before `action()` runs,** so a cut never deletes anything unless its text can reach the clipboard.
- **Keyboard shortcuts:** `commandForKey` and `editActionForKey` return null for ⌘C/⌘X/⌘V and do not call `preventDefault()` on those keys, so the browser fires the clipboard events. Leave `keys.ts` unchanged.
- **Safari:** it may not fire `copy`/`cut` when no text is selected on the page. This is recorded as owed verification in Task 8; do not add a keydown fallback.

- [ ] **Step 6: Verify**

Run: `npm test`, `npm run build`, `npm run lint`, `npm run format:check`.
Expected: all pass (full suite +2 tests); build 0 errors / 0 warnings.

Then compile-check the dev server (the controller runs the browser pass after Task 7):

```bash
npx vite --port 5199 --strictPort >/tmp/sv-vite.log 2>&1 &
sleep 3; curl -s http://localhost:5199/src/App.svelte | head -c 200; kill %1
```

Expected: JavaScript output, not an error overlay.

- [ ] **Step 7: Commit**

```bash
git add src/persist/system-clipboard.ts src/__tests__/system-clipboard.test.ts src/state/appState.svelte.ts src/App.svelte
git commit -m "feat(clipboard): system clipboard adapter, copy/cut/paste actions and events

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Clipboard and snapping UI

**Files:**
- Modify: `src/app.css` (theme token)
- Modify: `src/lib/Overlay.svelte` (guide lines)
- Modify: `src/lib/ModifierDock.svelte` (Snap toggle)
- Modify: `src/lib/ContextBar.svelte` (Cut / Copy / Paste)
- Modify: `src/lib/ContextMenu.svelte` (Cut / Copy / Paste; Paste-only on empty canvas)
- Modify: `src/lib/Canvas.svelte` (menu also opens on empty canvas)

**Interfaces:**
- Consumes:
  - Overlay `{ kind: "guides"; xs: number[]; ys: number[] }` (Task 2)
  - `toggleSnap` (Task 2)
  - `copyToSystem`, `cutToSystem`, `pasteFromClipboard` (Task 6)
  - `app.prefs.snap`, `app.viewportSize`, `docToScreen`
- Produces: UI only. There are no unit tests; the build and the controller's browser pass gate this task.

- [ ] **Step 1: Add the theme token** — in `src/app.css`, add after `--color-ok: #34d399;`:

```css
  --color-guide: #ff3ea5;
```

- [ ] **Step 2: Draw guide lines** — `src/lib/Overlay.svelte`

Add to the script, after `marqueeB`:

```ts
  const guides = $derived(app.overlay?.kind === "guides" ? app.overlay : null);
  const GUIDE = "stroke: var(--color-guide)";
```

Add inside `<g pointer-events="none">`, after the marquee block:

```svelte
  {#if guides}
    {#each guides.xs as x, i (i)}
      {@const sx = docToScreen(view, { x, y: 0 }).x}
      <line x1={sx} y1="0" x2={sx} y2={app.viewportSize.h} style={GUIDE} stroke-width="1" />
    {/each}
    {#each guides.ys as y, i (i)}
      {@const sy = docToScreen(view, { x: 0, y }).y}
      <line x1="0" y1={sy} x2={app.viewportSize.w} y2={sy} style={GUIDE} stroke-width="1" />
    {/each}
  {/if}
```

- [ ] **Step 3: Add the Snap toggle** — `src/lib/ModifierDock.svelte`

Change the store import to `import { app, setDock, toggleSnap, type DockState } from "../state/appState.svelte";`.
Insert this before `{#each KEYS as key (key)}`:

```svelte
  <button
    class="h-10 w-14 rounded border border-line text-xs select-none"
    class:dock-on={app.prefs.snap}
    aria-pressed={app.prefs.snap}
    title="Snap to the artboard and objects (%)"
    onclick={toggleSnap}
  >
    Snap
  </button>
```

The Snap button is a plain tap toggle: no hold behaviour and no pointer capture (spec §3.3).

- [ ] **Step 4: Add the context bar buttons** — `src/lib/ContextBar.svelte`

- Icons: `import { ClipboardPaste, Copy, CopyPlus, Scissors, Trash2 } from "@lucide/svelte";`
- Add to the store import: `copyToSystem`, `cutToSystem`, `pasteFromClipboard`.
- Selection branch: replace the Delete and Duplicate buttons with:

```svelte
    <button class="btn gap-1" onclick={cutToSystem}><Scissors size={14} /> Cut</button>
    <button class="btn gap-1" onclick={copyToSystem}><Copy size={14} /> Copy</button>
    <button class="btn gap-1" onclick={() => void pasteFromClipboard()}>
      <ClipboardPaste size={14} /> Paste
    </button>
    <button class="btn gap-1" onclick={duplicateSelection}>
      <CopyPlus size={14} /> Duplicate
    </button>
    <button class="btn gap-1" onclick={deleteSelection}><Trash2 size={14} /> Delete</button>
```

- The final `{:else}` branch becomes:

```svelte
  {:else}
    {#if app.toolId === "select"}
      <button class="btn gap-1" onclick={() => void pasteFromClipboard()}>
        <ClipboardPaste size={14} /> Paste
      </button>
    {/if}
    <span class="truncate text-muted">{TOOLS[app.toolId].hint}</span>
  {/if}
```

Before relying on the icon names, check that they exist:

```bash
ls node_modules/@lucide/svelte/dist/icons | grep -E '^(clipboard-paste|copy-plus|scissors)\.svelte$'
```

Expected: all three are listed. If one is missing, use `Clipboard` in place of `ClipboardPaste` or `Files` in place of `CopyPlus`, and report it.

- [ ] **Step 5: Update the context menu** — `src/lib/ContextMenu.svelte`

Add to the store import: `copyToSystem`, `cutToSystem`, `pasteFromClipboard`. Replace the menu body (everything inside `<div class="fixed z-50 …" role="menu" …>`) with:

```svelte
    {#if app.selection.length > 0}
      <button class="menu-item" role="menuitem" onclick={() => run(cutToSystem)}>
        Cut <span class="kbd">⌘X</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => run(copyToSystem)}>
        Copy <span class="kbd">⌘C</span>
      </button>
    {/if}
    <button
      class="menu-item"
      role="menuitem"
      onclick={() => run(() => void pasteFromClipboard())}
    >
      Paste <span class="kbd">⌘V</span>
    </button>
    {#if app.selection.length > 0}
      <div class="my-1 h-px bg-line"></div>
      <button class="menu-item" role="menuitem" onclick={() => run(duplicateSelection)}>
        Duplicate <span class="kbd">⌘D</span>
      </button>
      {#if actions.canConvert}
        <button class="menu-item" role="menuitem" onclick={() => run(convertSelectionToPath)}>
          Convert to path
        </button>
      {/if}
      {#if actions.canFlatten}
        <button class="menu-item" role="menuitem" onclick={() => run(flattenSelection)}>
          Flatten transform
        </button>
      {/if}
      <div class="my-1 h-px bg-line"></div>
      <button class="menu-item" role="menuitem" onclick={() => run(deleteSelection)}>
        Delete <span class="kbd">⌫</span>
      </button>
    {/if}
```

- [ ] **Step 6: Open the menu on empty canvas** — `src/lib/Canvas.svelte`, in `oncontextmenu`

Replace
`    if (app.selection.length > 0) app.contextMenu = { x: e.clientX, y: e.clientY };`
with
`    app.contextMenu = { x: e.clientX, y: e.clientY };`

The rest stays as it is: mouse only, select tool only, and a hit on an unselected object selects it. With nothing selected, the menu offers only Paste.

- [ ] **Step 7: Verify**

Run: `npm run build`, `npm run lint`, `npm run format:check`, `npm test`.
Expected: 0 errors / 0 warnings; everything else passes.

Then compile-check the dev server:

```bash
npx vite --port 5199 --strictPort >/tmp/sv-vite.log 2>&1 &
sleep 3
for f in lib/Overlay lib/ModifierDock lib/ContextBar lib/ContextMenu lib/Canvas; do
  curl -s -o /dev/null -w "$f %{http_code}\n" "http://localhost:5199/src/$f.svelte"
done
kill %1
```

Expected: `200` for each file.

- [ ] **Step 8: Commit**

```bash
git add src/app.css src/lib/Overlay.svelte src/lib/ModifierDock.svelte src/lib/ContextBar.svelte src/lib/ContextMenu.svelte src/lib/Canvas.svelte
git commit -m "feat(ui): snap guides and toggle, clipboard buttons and menu items

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Controller browser pass (between Task 7 and Task 8)

Run by the controller, not a subagent, with the dev server on the branch in desktop Chrome. Follow the harness tips in memory:
- To script the store, import the app's own `?t=` module URL, found via `performance.getEntriesByType('resource')`.
- Automation drags don't send modifier keys, so use the dock or synthetic PointerEvents.
- Key presses right after navigating can be lost.

Do not click the context bar's or menu's **Paste** while the clipboard-read permission is undecided. Chrome would show a site-permission prompt, and granting it is the user's decision. Before using those buttons, stub the read:

```js
Object.defineProperty(navigator.clipboard, "readText", { configurable: true, value: () => Promise.reject(new Error("stub")) })
```

That exercises the in-app fallback. Stubbing it to resolve some SVG text exercises the system path.

Checklist:
1. **Copy and paste:** draw two rects. Copy one with a synthetic `copy` event (`new ClipboardEvent("copy", { clipboardData: new DataTransfer(), bubbles: true })` dispatched on `document.body`).
   - The event's `clipboardData` has the same SVG text for `text/plain` and `image/svg+xml`, and `defaultPrevented` is true.
   - A `paste` event carrying that data three times makes copies at +10, +20 and +30.
   - Each paste is one undo step, and the pasted copy is selected.
2. **Cut:** a synthetic `cut` removes the selection, in one undo step. A paste then puts it back at +10.
3. **External SVG:** paste `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="red"/><text>x</text></svg>`. It lands centred in the visible canvas, and the info notice lists `<text>`.
4. **Paste errors:** pasting plain text shows the "doesn't contain an SVG drawing" error. Pasting with every layer locked isn't reachable yet (M3), so skip it.
5. **Text fields:** with focus in a properties NumberField, a `copy` event is not intercepted (`defaultPrevented` false).
6. **Buttons and menu:** the context bar shows Cut/Copy/Paste/Duplicate/Delete with a selection, and Paste plus the hint without one (select tool). The right-click menu on empty canvas shows only Paste, and on an object shows the full list. Menu Copy, then Paste with the stubbed read, pastes the in-app copy.
7. **Snapping while moving:** drag a rect near the artboard centre and near another rect's edge. A pink guide appears, the rect lands exactly on the target (check the X/Y fields), and the guide disappears on release.
8. **Snapping while resizing:** drag an edge handle of an unrotated rect near another rect's edge. It snaps and shows a guide. A rotated rect doesn't snap.
9. **Snapping while drawing:** a rect drawn starting near an artboard corner starts exactly on it.
10. **Snap toggle:** the dock's Snap button and the `%` key both toggle it; the button shows its on state. With snapping off, nothing snaps. The setting survives a reload.
11. **Alt-drag back:** Alt-drag (dock Alt latched) a rect and return to the start with synthetic PointerEvents. No duplicate is left and there's no undo step.
12. **No console errors.**

Record the results (and anything owed) for the Task 8 CHANGELOG entry. Fix failures through a fix dispatch before Task 8.

---

### Task 8: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/superpowers/CHANGELOG.md`

**Interfaces:** none (docs only). The controller passes in the browser-pass results.

- [ ] **Step 1: `CLAUDE.md`**
  - **Architecture map:**
    - `src/geom/` bullet: add `snap.ts` (snap targets from the artboard and object bounds, `snapValue`/`snapBox`/`snapPoint`).
    - `src/state/` bullet: add `clipboard.ts` (pure copy text and paste planning: cascade, centring, errors).
    - `src/persist/` bullet: add `system-clipboard.ts` (never-throwing `navigator.clipboard` wrapper).
    - Also add `insertNodes` to the `edits.ts` description (as "pure `(doc, args) => doc`, incl. `insertNodes` for paste").
  - **New gotchas, appended after #18:**
    19. **Keyboard copy/cut/paste use the window `copy`/`cut`/`paste` events** (App.svelte), never `navigator.clipboard`: the events need no permission and can set `image/svg+xml`. Only the context bar and menu buttons read `navigator.clipboard`, and they fall back to the in-app copy (`clip` in the store). Text fields and dialogs keep the browser's own behaviour.
    20. **Snapping is per gesture.** Tools collect targets at pointer-down (`collectTargets`, excluding what moves) and put guides in the overlay; they must clear the overlay on up/cancel. Resize snaps only unrotated frames; rotation and marquee never snap. The threshold is `SNAP_PX / zoom`.
  - **Current state:** replace it with `Milestone 2b (clipboard, snapping) — see CHANGELOG. Next is milestone 3: layers and groups.`
  - **Roadmap:**
    - The first line becomes `M3 layers/groups, M4 pen + node editing, M5 iPad polish + deploy (spec §9). Post-v1 list in spec §10.`
    - Delete the `M2b: the snapping hook …` paragraph (done).
    - Append to the `M4` paragraph: `Snapping to path nodes is M4 (spec M2b §1).`

- [ ] **Step 2: `README.md`**
  - Status list, before the "An on-screen Shift/Alt pad" line:
    `- Copy, cut and paste — within the editor and as SVG with other apps.`
    `- Snapping to the artboard and other objects while moving, resizing and drawing, with guide lines.`
  - Change `- An on-screen Shift/Alt pad for touch.` to `- An on-screen Shift/Alt/Snap pad for touch.`
  - Keyboard table: add these rows after Duplicate, and re-align the table with `npx prettier --write README.md`:
    `| Cut / Copy / Paste | ⌘X / ⌘C / ⌘V |`
    `| Snap on/off | % |`
  - Roadmap: `Next: layers and groups, then pen and node editing.`
  - Development: `npm test          # 242 unit tests` (use the actual count from `npm test`; 216 + 26 new is expected).

- [ ] **Step 3: `docs/superpowers/CHANGELOG.md`** — append:

```markdown
## 2026-09-16 — Milestone 2b: clipboard and snapping

- Copy/cut/paste: the selection is copied as standalone SVG in our own format (`text/plain` and
  `image/svg+xml`); paste accepts any SVG text through the importer. Repeated pastes of our own
  copy cascade by 10 (centred on the view when the offset copy would be off-screen); external
  SVG is centred on the view. One undo step; the pasted nodes are selected; dropped features are
  listed. Keyboard uses the window clipboard events; the context bar and right-click menu (which
  now also opens on empty canvas, Paste only) use `navigator.clipboard` with the in-app copy as
  fallback.
- Snapping (8 screen px) to the artboard edges/centre and other objects' bounds (visible layers,
  locked included) while moving (Shift-constrained moves snap only their axis), resizing
  (unrotated frames, the moving handle's axes) and drawing (start and current point; not the end
  of a Shift-constrained line). Pink guide lines; Snap toggle in the dock and on `%`; saved in
  preferences (default on).
- An Alt-drag released at its start no longer leaves a hidden duplicate.
- Plan: `docs/superpowers/plans/2026-09-16-m2b-clipboard-snapping.md`.
- Browser-verified (desktop Chrome): <controller fills in from the browser pass>.
- Owed: Safari (does it fire `copy`/`cut` with no text selection?), Firefox, the iPad clipboard
  permission prompt and paste button, snapping by touch/Pencil, a real clipboard-read permission
  prompt, pasting from Inkscape/Illustrator/Figma directly.
```

Replace the `<controller fills in …>` line with the actual browser-pass results, which the controller provides in the dispatch.

- [ ] **Step 4: Verify**

Run: `npm run format:check` (then `npx prettier --write` on the three files if needed) and `npm test`.
Expected: clean; the test count matches the README.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/superpowers/CHANGELOG.md
git commit -m "docs: milestone 2b clipboard and snapping

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
