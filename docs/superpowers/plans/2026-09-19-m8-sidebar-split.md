# M8 — The Sidebar Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Properties and Layers panels a visible boundary, a draggable split, and
collapse chevrons, and let Properties fold away when nothing is selected.

**Architecture:** One new pure module (`src/lib/split.ts`) holds every number: the ratio clamp, the
drag maths, and the two-line rule that decides whether Properties is open. `Sidebar.svelte` owns the
geometry and the divider; each panel renders its own raised header through a shared
`PanelHeader.svelte` so its actions stay with its logic. Two preferences persist (`splitRatio`,
`layersOpen`); the Properties override lives in the store, because `App.svelte` mounts the sidebar
twice and the two copies must agree.

**Tech Stack:** Svelte 5 runes (`$state`, `$derived`, `$props`, snippets), TypeScript strict,
Tailwind 4, Vitest (node environment, **no DOM** — only pure modules are unit-tested),
`@lucide/svelte` icons.

**Spec:** `docs/superpowers/specs/2026-09-19-m8-sidebar-split-design.md`

## Global Constraints

- **Node/Vitest has no DOM.** Unit tests cover pure modules only. Never import a `.svelte` file
  from a test.
- **TypeScript is strict**, with `verbatimModuleSyntax` (type-only imports must say `import type`)
  and `erasableSyntaxOnly` (no enums, no parameter properties).
- **Build bar: 0 errors, 0 warnings** from `npm run build` (`svelte-check && tsc --noEmit && vite build`).
- **Write each element's classes as one expression** — `class={["btn", on && "ui-on"]}` — never a
  `class:` directive over a coloured base (CLAUDE.md invariant 23).
- **Every `title` is also a status-bar hint** (invariant 24): write titles as short action
  descriptions, e.g. `Hide the properties`, `Drag to resize the panels`.
- **Drag surfaces need `touch-action: none` and must treat `pointercancel` exactly like
  `pointerup`** (invariant 6).
- **The store is `app`**; `$state.raw` fields are replaced, never mutated (invariant 2).
- **Every session change goes through `setSession`, every selection change through `setSelection`**
  (invariant 13). Do not assign `app.session` anywhere else.
- **Prefs are sanitized field by field** — `sanitizePrefs` must never trust stored JSON.
- Palette tokens only: `bg-panel` `#1e1e22`, `bg-raised` `#2d2d33`, `border-line` `#2e2e35`,
  `text-muted` `#a1a1aa`, `text-text` `#f4f4f5`. Do not invent colours.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Run `npm test` before each commit; the pre-commit hook runs eslint --fix and prettier.

---

### Task 1: The pure split logic

**Files:**

- Create: `src/lib/split.ts`
- Test: `src/__tests__/split.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `MIN_BODY_PX: number`, `HEADER_PX: number`, `STRIP_PX: number`, `MIN_PANEL_PX: number`;
  `clampRatio(ratio: number, bodyPx: number, minPx: number): number`;
  `ratioFromDrag(startRatio: number, deltaPx: number, bodyPx: number, minPx: number): number`;
  `propsOpen(override: boolean | null, hasSelection: boolean): boolean`;
  `clearedOverride(override: boolean | null, wasEmpty: boolean, isEmpty: boolean): boolean | null`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/split.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clampRatio,
  clearedOverride,
  MIN_BODY_PX,
  propsOpen,
  ratioFromDrag,
} from "../lib/split";

describe("clampRatio", () => {
  it("leaves a ratio that starves neither panel alone", () => {
    expect(clampRatio(0.55, 800, 120)).toBe(0.55);
  });

  it("clamps to the minimum body at each end", () => {
    expect(clampRatio(0.01, 800, 120)).toBeCloseTo(0.15, 10);
    expect(clampRatio(0.99, 800, 120)).toBeCloseTo(0.85, 10);
  });

  it("splits evenly when the body cannot hold two minimums", () => {
    expect(clampRatio(0.8, 200, 120)).toBe(0.5);
    expect(clampRatio(0.8, 240, 120)).toBe(0.5);
  });

  it("splits evenly rather than trusting a non-finite number", () => {
    expect(clampRatio(Number.NaN, 800, 120)).toBe(0.5);
    expect(clampRatio(0.55, Number.NaN, 120)).toBe(0.5);
  });

  it("offers a minimum a layer row can use", () => {
    expect(MIN_BODY_PX).toBe(120);
  });
});

describe("ratioFromDrag", () => {
  it("moves the ratio by the pointer's share of the body", () => {
    expect(ratioFromDrag(0.5, 80, 800, 120)).toBeCloseTo(0.6, 10);
    expect(ratioFromDrag(0.5, -80, 800, 120)).toBeCloseTo(0.4, 10);
  });

  it("clamps a drag that would starve either panel", () => {
    expect(ratioFromDrag(0.5, 1000, 800, 120)).toBeCloseTo(0.85, 10);
    expect(ratioFromDrag(0.5, -1000, 800, 120)).toBeCloseTo(0.15, 10);
  });

  it("cannot divide by a body of zero", () => {
    expect(ratioFromDrag(0.55, 40, 0, 120)).toBe(0.5);
  });
});

describe("propsOpen", () => {
  it("follows the selection until someone overrides it", () => {
    expect(propsOpen(null, false)).toBe(false);
    expect(propsOpen(null, true)).toBe(true);
    expect(propsOpen(true, false)).toBe(true);
    expect(propsOpen(false, true)).toBe(false);
  });
});

describe("clearedOverride", () => {
  it("drops a decision when the selection's emptiness flips", () => {
    expect(clearedOverride(true, true, false)).toBeNull();
    expect(clearedOverride(false, false, true)).toBeNull();
  });

  it("keeps the same value when nothing flipped, so the caller can skip the write", () => {
    expect(clearedOverride(true, true, true)).toBe(true);
    expect(clearedOverride(false, false, false)).toBe(false);
    expect(clearedOverride(null, false, false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/split.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/split"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/split.ts`:

```ts
/** The Properties/Layers split in the sidebar (spec M8 §4–§5). Pure: no store, no DOM, no Svelte —
 *  every number the divider and the two chevrons need lives here and is unit-tested. */

/** The smallest body a panel keeps when the divider is dragged to an extreme: about three layer
 *  rows at `h-8`. */
export const MIN_BODY_PX = 120;

/** A panel header's height, and the divider strip's. */
export const HEADER_PX = 40;
export const STRIP_PX = 12;

/** A panel's smallest whole height. Flex distributes whole sections, headers included, so this —
 *  not `MIN_BODY_PX` — is what the ratio is clamped against, and the share it divides is the column
 *  minus the strip. Clamping against the body alone left the losing panel 40px short. */
export const MIN_PANEL_PX = HEADER_PX + MIN_BODY_PX;

/** Keep `ratio` — Properties' share of the body — inside the range that leaves both panels at least
 *  `minPx`. A body too short for two minimums splits evenly instead: honouring the ratio there
 *  would starve one side completely, and half of too little is still something. */
export function clampRatio(ratio: number, bodyPx: number, minPx: number): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(bodyPx) || bodyPx < 2 * minPx) return 0.5;
  const min = minPx / bodyPx;
  return Math.min(Math.max(ratio, min), 1 - min);
}

/** The ratio a drag lands on: the pointer's travel since pointer-down, as a share of the body. */
export function ratioFromDrag(
  startRatio: number,
  deltaPx: number,
  bodyPx: number,
  minPx: number,
): number {
  if (!Number.isFinite(bodyPx) || bodyPx <= 0) return clampRatio(startRatio, bodyPx, minPx);
  return clampRatio(startRatio + deltaPx / bodyPx, bodyPx, minPx);
}

/** Properties is open when the user has said so, and otherwise whenever something is selected —
 *  the panel's whole content is about the selection, so with none it has nothing to say. */
export function propsOpen(override: boolean | null, hasSelection: boolean): boolean {
  return override ?? hasSelection;
}

/** A decision about the Properties panel was made for one selection state and does not survive the
 *  other. Returns the same value when nothing flipped, so the caller can skip the write. */
export function clearedOverride(
  override: boolean | null,
  wasEmpty: boolean,
  isEmpty: boolean,
): boolean | null {
  return wasEmpty === isEmpty ? override : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/split.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; build reports 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/lib/split.ts src/__tests__/split.test.ts
git commit -F - <<'MSG'
feat: pure split logic for the sidebar

The ratio clamp, the drag maths and the rule that decides whether Properties
is open, in one testable module with no DOM and no store.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: The preferences and the store state

**Files:**

- Modify: `src/persist/preferences.ts`
- Modify: `src/state/appState.svelte.ts`
- Test: `src/__tests__/prefs-route-keys.test.ts`

**Interfaces:**

- Consumes: `propsOpen`, `clearedOverride` from `src/lib/split.ts` (Task 1).
- Produces: `Prefs.splitRatio: number` and `Prefs.layersOpen: boolean`;
  `app.propsOverride: boolean | null`; `togglePropsPanel(): void` exported from
  `src/state/appState.svelte.ts`.

- [ ] **Step 1: Write the failing test**

In `src/__tests__/prefs-route-keys.test.ts`, the `custom` fixture at the top of the
`describe("preferences")` block currently ends with `dockExpanded: true,`. Add two fields so it
stays a complete `Prefs`:

```ts
    snap: false,
    dockExpanded: true,
    splitRatio: 0.3,
    layersOpen: false,
  };
```

Then add this test inside the same `describe("preferences")` block, after the existing
`dockExpanded` test:

```ts
  it("keeps the sidebar split inside a usable range", () => {
    expect(sanitizePrefs({}).splitRatio).toBe(0.55);
    expect(sanitizePrefs({ splitRatio: 0.3 }).splitRatio).toBe(0.3);
    expect(sanitizePrefs({ splitRatio: 0 }).splitRatio).toBe(0.55);
    expect(sanitizePrefs({ splitRatio: 1 }).splitRatio).toBe(0.55);
    expect(sanitizePrefs({ splitRatio: Number.NaN }).splitRatio).toBe(0.55);
    expect(sanitizePrefs({ splitRatio: "0.4" }).splitRatio).toBe(0.55);
  });

  it("keeps the Layers panel open unless it was closed", () => {
    expect(sanitizePrefs({}).layersOpen).toBe(true);
    expect(sanitizePrefs({ layersOpen: "no" }).layersOpen).toBe(true);
    expect(sanitizePrefs({ layersOpen: false }).layersOpen).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/prefs-route-keys.test.ts`
Expected: FAIL — the two new tests report `undefined` for `splitRatio` and `layersOpen`, and
`tsc` would reject the fixture's extra fields.

- [ ] **Step 3: Add the two preferences**

In `src/persist/preferences.ts`, extend the `Prefs` type — add these two fields after
`dockExpanded`:

```ts
  /** Properties' share of the sidebar's body; Layers gets the rest (spec M8 §4). */
  splitRatio: number;
  /** The Layers panel's collapse. Unlike Properties, nothing but the user opens or closes it. */
  layersOpen: boolean;
```

Extend `DEFAULT_PREFS` — `0.55` is exactly what the old `h-[45%]` Layers section gave:

```ts
export const DEFAULT_PREFS: Prefs = {
  style: DEFAULT_STYLE,
  polygon: { sides: 5, star: false, innerRatio: 0.5 },
  snap: true,
  dockExpanded: null,
  splitRatio: 0.55,
  layersOpen: true,
};
```

And in `sanitizePrefs`, after the `dockExpanded` line:

```ts
    splitRatio: num(r.splitRatio, 0.1, 0.9, d.splitRatio),
    layersOpen: typeof r.layersOpen === "boolean" ? r.layersOpen : d.layersOpen,
```

(`num` is the existing helper in this file: it returns the fallback unless the value is a finite
number within the range, which is why a string and `NaN` both fall back.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/prefs-route-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the store state and its clearing**

In `src/state/appState.svelte.ts`:

Add to the import from `../lib/split` (a new import line, placed with the other `../lib`-free
imports in alphabetical position — after the `../input/dock` import):

```ts
import { clearedOverride, propsOpen } from "../lib/split";
```

Add a field to the `AppState` class, next to `propertiesOpen`:

```ts
  /** The Properties panel's collapse, when the user has overridden what the selection implies
   *  (spec M8 §5). Not saved and not undoable: a decision made with nothing selected does not
   *  survive selecting something. */
  propsOverride = $state<boolean | null>(null);
```

Add this helper immediately above `function setSession(s: Session): void {`:

```ts
/** Keeps the Properties panel's override tied to the selection state it was made in (spec M8 §5).
 *  Called from the two functions that assign `app.selection`, never from an effect. */
function syncPropsOverride(wasEmpty: boolean): void {
  const next = clearedOverride(app.propsOverride, wasEmpty, app.selection.length === 0);
  if (next !== app.propsOverride) app.propsOverride = next;
}
```

In `setSession`, capture the emptiness before the prune and sync after it. The function starts:

```ts
function setSession(s: Session): void {
  app.session = s;
  const pruned = pruneSelection(s.doc, app.selection);
  if (pruned !== app.selection) app.selection = pruned;
```

Change those lines to:

```ts
function setSession(s: Session): void {
  const wasEmpty = app.selection.length === 0;
  app.session = s;
  const pruned = pruneSelection(s.doc, app.selection);
  if (pruned !== app.selection) app.selection = pruned;
  syncPropsOverride(wasEmpty);
```

In `setSelection`, do the same. The function currently reads:

```ts
export function setSelection(ids: readonly string[]): void {
  app.selection = pruneSelection(app.doc, ids);
  // The layer of the last selected object becomes current (spec M3a §2).
  const last = app.selection[app.selection.length - 1];
  const found = last === undefined ? null : findNode(app.doc, last);
  if (found && found.layer.id !== app.currentLayerId) app.currentLayerId = found.layer.id;
}
```

Change it to:

```ts
export function setSelection(ids: readonly string[]): void {
  const wasEmpty = app.selection.length === 0;
  app.selection = pruneSelection(app.doc, ids);
  syncPropsOverride(wasEmpty);
  // The layer of the last selected object becomes current (spec M3a §2).
  const last = app.selection[app.selection.length - 1];
  const found = last === undefined ? null : findNode(app.doc, last);
  if (found && found.layer.id !== app.currentLayerId) app.currentLayerId = found.layer.id;
}
```

Add the toggle action next to `setPrefs`:

```ts
/** The Properties panel's header chevron (spec M8 §5). It records the opposite of what is showing,
 *  and `setSelection`/`setSession` drop it again when the selection's emptiness flips. */
export function togglePropsPanel(): void {
  app.propsOverride = !propsOpen(app.propsOverride, app.selection.length > 0);
}
```

- [ ] **Step 6: Run the suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; 0 errors, 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add src/persist/preferences.ts src/state/appState.svelte.ts src/__tests__/prefs-route-keys.test.ts
git commit -F - <<'MSG'
feat: sidebar split preferences and the Properties override

splitRatio and layersOpen persist; the Properties override lives in the store
so the drawer and the inline column agree, and is cleared wherever the
selection is assigned rather than from an effect.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: The header bars and the collapse

**Files:**

- Create: `src/lib/PanelHeader.svelte`
- Modify: `src/lib/PropertiesPanel.svelte` (the `<aside>` root at line 65 and its `<script>`)
- Modify: `src/lib/LayersPanel.svelte` (the `<section>` root and header row at lines 225-240)
- Modify: `src/lib/Sidebar.svelte` (whole file)

**Interfaces:**

- Consumes: `propsOpen` from `src/lib/split.ts`; `app`, `togglePropsPanel`, `setPrefs` from
  `src/state/appState.svelte.ts` (Tasks 1-2).
- Produces: `PanelHeader.svelte` with props
  `{ title: string; open: boolean; showTitle: string; hideTitle: string; ontoggle: () => void; actions?: Snippet }`;
  `PropertiesPanel.svelte` and `LayersPanel.svelte` each taking
  `{ expanded: boolean; ontoggle: () => void; grow: number | boolean }`.

**Note for the implementer:** after this task the panels collapse but the divider is still fixed at
55/45 — Task 4 makes it draggable. Do not build the drag here.

- [ ] **Step 1: Write the header component**

Create `src/lib/PanelHeader.svelte`:

```svelte
<script lang="ts">
  import { ChevronDown, ChevronRight } from "@lucide/svelte";
  import type { Snippet } from "svelte";

  /** A sidebar panel's header bar (spec M8 §3). It is raised, so the boundary between the two
   *  panels is a band of a different colour rather than a 1px line one palette step from its
   *  background — and content scrolling under it reads as continuing. The name is the collapse
   *  target, not just the chevron; the panel's own actions sit at the right. */
  let {
    title,
    open,
    showTitle,
    hideTitle,
    ontoggle,
    actions,
  }: {
    title: string;
    open: boolean;
    showTitle: string;
    hideTitle: string;
    ontoggle: () => void;
    actions?: Snippet;
  } = $props();
</script>

<div class="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-raised pr-2 pl-1">
  <button
    type="button"
    class="flex h-8 items-center gap-1 rounded px-1 text-muted hover:text-text"
    aria-expanded={open}
    title={open ? hideTitle : showTitle}
    onclick={ontoggle}
  >
    {#if open}
      <ChevronDown size={14} />
    {:else}
      <ChevronRight size={14} />
    {/if}
    <span class="section-title text-inherit">{title}</span>
  </button>
  {#if actions}
    <div class="ml-auto flex items-center gap-1">{@render actions()}</div>
  {/if}
</div>
```

(`text-inherit` lets the button's `hover:text-text` reach the title; `.section-title` sets
`text-muted` itself and is unlayered-adjacent, so the span must opt out explicitly.)

- [ ] **Step 2: Give PropertiesPanel a header and its props**

In `src/lib/PropertiesPanel.svelte`, add to the end of the `<script>` block:

```ts
  let { open, ontoggle }: { open: boolean; ontoggle: () => void } = $props();
```

and add the import beside the other `./` imports:

```ts
  import PanelHeader from "./PanelHeader.svelte";
```

Replace the `<aside …>` opening tag (currently
`class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 text-xs"`) and close the body
properly. The panel becomes a header plus a scrolling body:

```svelte
<section class="flex min-h-0 flex-col" aria-label="Properties">
  <PanelHeader
    title="Properties"
    {open}
    {ontoggle}
    showTitle="Show the properties"
    hideTitle="Hide the properties"
  />
  {#if open}
    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3 text-xs">
      <h2 class="section-title">
        {hasSelection ? "Selection" : "Defaults for new shapes"}
      </h2>
      <!-- …every existing child of the old <aside>, unchanged… -->
    </div>
  {/if}
</section>
```

Keep every existing child exactly as it is; only the wrapper changes. The old `<aside>`'s closing
tag becomes `</div>{/if}</section>`.

- [ ] **Step 3: Give LayersPanel a header and its props**

In `src/lib/LayersPanel.svelte`, add to the end of the `<script>` block:

```ts
  let { open, ontoggle }: { open: boolean; ontoggle: () => void } = $props();
```

and the import beside the other `./` imports:

```ts
  import PanelHeader from "./PanelHeader.svelte";
```

Replace the section root and its hand-rolled header row — currently:

```svelte
<section class="flex h-[45%] min-h-40 shrink-0 flex-col border-t border-line" aria-label="Layers">
  <div class="flex h-10 shrink-0 items-center gap-1 pr-2 pl-3">
    <span class="section-title">Layers</span>
    <div class="ml-auto flex items-center gap-1">
      <IconButton label="New layer" title="New layer" icon={Plus} onclick={addLayerAboveCurrent} />
      <IconButton
        label="Delete layer"
        title={current ? `Delete layer “${current.name}”` : "Delete layer"}
        icon={Trash2}
        disabled={app.doc.layers.length <= 1}
        disabledTitle="Delete layer — it is the only layer"
        onclick={() => void deleteCurrentLayer()}
      />
    </div>
  </div>

  <div bind:this={list} class="relative min-h-0 flex-1 overflow-y-auto pb-2 text-xs">
```

with:

```svelte
<section class="flex min-h-0 flex-col" aria-label="Layers">
  <PanelHeader
    title="Layers"
    {open}
    {ontoggle}
    showTitle="Show the layers"
    hideTitle="Hide the layers"
  >
    {#snippet actions()}
      <IconButton label="New layer" title="New layer" icon={Plus} onclick={addLayerAboveCurrent} />
      <IconButton
        label="Delete layer"
        title={current ? `Delete layer “${current.name}”` : "Delete layer"}
        icon={Trash2}
        disabled={app.doc.layers.length <= 1}
        disabledTitle="Delete layer — it is the only layer"
        onclick={() => void deleteCurrentLayer()}
      />
    {/snippet}
  </PanelHeader>

  {#if open}
    <div
      bind:this={list}
      class="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 text-xs"
    >
```

and close the new `{#if}` before `</section>` at the end of the file.

The row-drag logic that reads `list` still works: `list` is only bound while the body is rendered,
and a drag cannot start from a body that is not on screen.

- [ ] **Step 4: Wire the Sidebar**

Replace `src/lib/Sidebar.svelte` entirely:

```svelte
<script lang="ts">
  import { propsOpen } from "./split";
  import { app, setPrefs, togglePropsPanel } from "../state/appState.svelte";
  import LayersPanel from "./LayersPanel.svelte";
  import PropertiesPanel from "./PropertiesPanel.svelte";

  /** Spec (M8) §3–§5: two panels, each with a raised header it can collapse into. Properties
   *  follows the selection unless the user has overridden it; Layers is the user's toggle alone. */
  const showProps = $derived(propsOpen(app.propsOverride, app.selection.length > 0));
  const showLayers = $derived(app.prefs.layersOpen);

  function toggleLayers() {
    setPrefs({ ...app.prefs, layersOpen: !showLayers });
  }
</script>

<div class="flex h-full w-60 shrink-0 flex-col border-l border-line bg-panel">
  <PropertiesPanel open={showProps} ontoggle={togglePropsPanel} />
  <LayersPanel open={showLayers} ontoggle={toggleLayers} />
</div>
```

With both open this gives each panel `flex: 0 1 auto` and they share the column by content — the
fixed ratio arrives in Task 4. With one collapsed, the open one must take the rest, so add
`class={["flex min-h-0 flex-col", open && "flex-1"]}` to **both** panel section roots (replacing the
`class="flex min-h-0 flex-col"` written in Steps 2 and 3).

- [ ] **Step 5: Run the suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; 0 errors, 0 warnings. A `svelte-check` warning about an unused
`{#snippet}` or a missing prop is a failure at this bar — fix it rather than accepting it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/PanelHeader.svelte src/lib/PropertiesPanel.svelte src/lib/LayersPanel.svelte src/lib/Sidebar.svelte
git commit -F - <<'MSG'
feat: raised header bars that collapse each sidebar panel

A 40px raised bar per panel replaces the 1px divider that was one palette
step from its background, and each bar's name is the collapse target.
Properties folds away when nothing is selected; Layers is the user's toggle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: The draggable divider

**Files:**

- Modify: `src/lib/Sidebar.svelte` (whole file)

**Interfaces:**

- Consumes: `clampRatio`, `ratioFromDrag`, `MIN_BODY_PX`, `propsOpen` from `src/lib/split.ts`;
  `app`, `setPrefs`, `togglePropsPanel` from the store; `PropertiesPanel`/`LayersPanel` with
  `{ expanded, ontoggle, grow }` (Task 3).
- Produces: nothing other modules consume.

- [ ] **Step 1: Write the Sidebar with the split and the divider**

Replace `src/lib/Sidebar.svelte` entirely:

```svelte
<script lang="ts">
  import { clampRatio, MIN_BODY_PX, propsOpen, ratioFromDrag } from "./split";
  import { app, setPrefs, togglePropsPanel } from "../state/appState.svelte";
  import LayersPanel from "./LayersPanel.svelte";
  import PropertiesPanel from "./PropertiesPanel.svelte";

  /** Spec (M8): two panels with raised headers, a draggable divider between them, and a ratio that
   *  persists. Properties follows the selection unless the user overrode it; Layers is a plain
   *  toggle. The divider only exists while both are open — with one collapsed there is nothing to
   *  distribute, and an inert strip between two bars would be dead space that looks draggable. */
  const HEADER_PX = 40;
  const STRIP_PX = 12;

  const showProps = $derived(propsOpen(app.propsOverride, app.selection.length > 0));
  const showLayers = $derived(app.prefs.layersOpen);
  const split = $derived(showProps && showLayers);

  let column = $state<HTMLElement | null>(null);
  let columnPx = $state(0);
  /** The ratio being dragged right now; null when no drag is running and the pref rules. */
  let live = $state<number | null>(null);
  let drag: { pointerId: number; startY: number; startRatio: number; bodyPx: number } | null = null;

  const bodyPx = $derived(Math.max(0, columnPx - 2 * HEADER_PX - STRIP_PX));
  const ratio = $derived(clampRatio(live ?? app.prefs.splitRatio, bodyPx, MIN_BODY_PX));

  $effect(() => {
    const el = column;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      columnPx = entry?.contentRect.height ?? 0;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  function toggleLayers() {
    setPrefs({ ...app.prefs, layersOpen: !showLayers });
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || drag) return;
    drag = { pointerId: e.pointerId, startY: e.clientY, startRatio: ratio, bodyPx };
    live = ratio;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    live = ratioFromDrag(drag.startRatio, e.clientY - drag.startY, drag.bodyPx, MIN_BODY_PX);
  }

  /** `pointercancel` — a palm rejected mid-drag — keeps the position the drag reached, exactly as
   *  a lift would (CLAUDE.md invariant 6: cancel is treated like up). */
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    const next = live;
    live = null;
    if (next !== null && next !== app.prefs.splitRatio) {
      setPrefs({ ...app.prefs, splitRatio: next });
    }
  }
</script>

<div
  bind:this={column}
  class="flex h-full w-60 shrink-0 flex-col border-l border-line bg-panel"
>
  <PropertiesPanel
    open={showProps}
    ontoggle={togglePropsPanel}
    grow={split ? ratio : showProps}
  />
  {#if split}
    <div
      class="group flex h-3 shrink-0 cursor-row-resize touch-none items-center justify-center bg-panel"
      role="separator"
      aria-orientation="horizontal"
      title="Drag to resize the panels"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
    >
      <div class="h-0.5 w-8 rounded-full bg-disabled group-hover:bg-muted"></div>
    </div>
  {/if}
  <LayersPanel open={showLayers} ontoggle={toggleLayers} grow={split ? 1 - ratio : showLayers} />
</div>
```

- [ ] **Step 2: Let each panel take the height the Sidebar gives it**

Both panels need a `grow` prop. In **both** `src/lib/PropertiesPanel.svelte` and
`src/lib/LayersPanel.svelte`, change the props line written in Task 3 to:

```ts
  let {
    open,
    ontoggle,
    grow,
  }: { open: boolean; ontoggle: () => void; grow: number | boolean } = $props();
```

and change each panel's `<section>` root to carry the flex basis:

```svelte
<section
  class="flex min-h-0 flex-col"
  style:flex={typeof grow === "number" ? `${grow} 1 0%` : grow ? "1 1 0%" : "0 0 auto"}
  aria-label="Properties"
>
```

(the same for `aria-label="Layers"`). A number means "both open, take this share"; `true` means
"the other one is collapsed, take everything left"; `false` means "I am collapsed, just my header".

- [ ] **Step 3: Run the suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; 0 errors, 0 warnings.

- [ ] **Step 4: Check the three states by reading the rendered classes**

There is no DOM in the test environment, so verify by reasoning against the code and record it in
the report: with both open the two `flex` values are `ratio` and `1 - ratio` and the strip is
rendered; with Properties collapsed its `flex` is `0 0 auto` (header only) and Layers' is `1 1 0%`;
with both collapsed both are `0 0 auto` and the column ends in empty `bg-panel`. State in the
report that the browser pass is the controller's.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Sidebar.svelte src/lib/PropertiesPanel.svelte src/lib/LayersPanel.svelte
git commit -F - <<'MSG'
feat: a draggable divider between the sidebar panels

A 12px strip with a grip splits the column by a persisted ratio, clamped so
neither panel drops below 120px. It exists only while both panels are open.
pointercancel keeps the position the drag reached, as a lift would.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: The documents

**Files:**

- Modify: `CLAUDE.md` (invariant 23, the architecture map's `src/lib/` and `src/persist/` lines,
  the `npm test` count on the Commands line)
- Modify: `README.md`
- Modify: `docs/superpowers/CHANGELOG.md`

**Interfaces:**

- Consumes: everything built in Tasks 1-4.
- Produces: nothing code depends on.

- [ ] **Step 1: Record the exception in CLAUDE.md**

Invariant 23 currently contains the bullet:

```
    - A state change must not move the layout. For example, unsaved changes recolour the file
      name.
```

Replace it with:

```
    - A state change must not move the layout. For example, unsaved changes recolour the file
      name. **The sidebar's Properties panel is the one exception** (spec M8 §5): it collapses when
      nothing is selected and opens when something is. The rule exists so a passive state — a dirty
      flag, a hover, a mode — does not shuffle controls under a finger; it is not meant to make a
      panel whose entire content is the selection hold half a column while it has nothing to say.
      Clicking its header overrides that, and the override is dropped wherever `app.selection` is
      assigned, the moment the selection's emptiness flips — never from an effect.
```

Add a bullet at the end of invariant 23, after the `dockExpanded` one:

```
    - **The sidebar's divider is 12px**, a deliberate deviation from the 32px bar-control rule: a
      divider is approached by sliding onto it rather than by tapping it, and 12px is 1.5× the grip
      slop-paint ships for the same job. It is rendered only when both panels are open.
```

- [ ] **Step 2: Update the architecture map and the test count**

In the `src/lib/` entry, replace `` `Sidebar`\n  (the Properties + Layers column) `` so the line
reads:

```
  helper), `Sidebar` (the Properties + Layers column: the split ratio, the divider drag and which
  panel is open), `PanelHeader` (a panel's raised, collapsible header bar), `split.ts` (pure: the
  ratio clamp, the drag maths and the Properties open/override rule),
```

In the `src/persist/` entry, change the `preferences.ts` parenthetical to:

```
  (localStorage: style + polygon defaults for new shapes, snap, the dock's expanded state, the
  sidebar's split ratio and the Layers panel's collapse),
```

On the Commands line, change `503 tests in 39 files` to the number `npm test` actually prints.

- [ ] **Step 3: Update README.md**

The features list has a line about the properties and layers panels. Add, after it:

```
- The Properties and Layers panels split one column, with a divider you can drag and a chevron on
  each to fold it away. Properties folds itself away when nothing is selected — click its header to
  open the new-shape defaults, and it stays open until you select something.
```

- [ ] **Step 4: Append the CHANGELOG entry**

Append to `docs/superpowers/CHANGELOG.md`:

```markdown
## 2026-09-19 — Milestone 8: the sidebar split

- The Properties and Layers panels each gained a **40px raised header bar** with a collapse
  chevron. The old boundary was `border-line` against `border-panel` — one step apart in the
  palette — and both sections used `.section-title`, so the column read as one long scroll whose
  content was clipped mid-control. A band of a different colour is a boundary; content scrolling
  under a solid bar reads as continuing.
- A **12px divider** between them drags the split, clamped so neither body drops below 120px, with
  the ratio persisted as `prefs.splitRatio` (default 0.55 — what the old `h-[45%]` gave). It is
  rendered only while both panels are open. `pointercancel` keeps the position the drag reached.
- **Properties collapses itself when nothing is selected**, which is a knowing exception to
  invariant 23: a panel whose entire content is the selection should not hold half the column while
  it has nothing to say. Clicking the header overrides it — that is how the new-shape defaults stay
  reachable — and the override is dropped wherever `app.selection` is assigned, the moment the
  selection's emptiness flips.
- Two columns (layers left, properties right — the Figma/Sketch convention) were considered and
  rejected: they cost ~480px of a 768px iPad portrait window, so both would become drawers anyway.
- Plan: `docs/superpowers/plans/2026-09-19-m8-sidebar-split.md`.
```

Leave the browser-verification and owed bullets to the controller, who runs that pass.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/superpowers/CHANGELOG.md
git commit -F - <<'MSG'
docs: M8 — the sidebar split

Records the one deliberate exception to "a state change must not move the
layout", the 12px divider's deviation from the 32px control rule, and the
two-column arrangement that was considered and rejected.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-review

**Spec coverage.** §3 header bars → Task 3. §4 divider, 12px, clamp, ratio, `touch-action`,
`pointercancel`, strip-only-when-both-open → Tasks 1 and 4. §5 the three state pieces, the override
rule, both-collapsed allowed, the store placement, the invariant exception → Tasks 1, 2, 3 and 5.
§6 architecture, file by file → Tasks 1-4 create exactly those files. §8 unit tests → Tasks 1-2;
build bar → every task's penultimate step; the browser pass is the controller's, stated in Task 4
Step 4. §2's "out" list is honoured: no scroll shadows, no width grip, no drawer changes.

**Placeholders.** None: every step carries the code it needs, and the one "…unchanged…" marker in
Task 3 Step 2 points at existing file content the implementer is told explicitly not to alter.

**Type consistency.** `propsOpen`, `clearedOverride`, `clampRatio`, `ratioFromDrag`, `MIN_BODY_PX`
are declared in Task 1 and consumed under exactly those names in Tasks 2-4. `togglePropsPanel` is
declared in Task 2 and used in Tasks 3-4. Both panels take `{ expanded, ontoggle, grow }` in Task 3 and gain
`grow` in Task 4, and both changes are spelled out for both files. `Prefs.splitRatio` and
`Prefs.layersOpen` are added in Task 2 and read in Tasks 3-4.


---

## What the dry run found

The plan was executed once in a throwaway worktree before any of it was trusted, and the browser
pass ran against that. Six things came back, all now folded into the tasks above:

1. **`open` collides in `LayersPanel.svelte`.** The file already binds `{@const open = …}` twice,
   per row, for its own expand/collapse chevrons. A prop of the same name would be shadowed inside
   every row block — legal, and a trap for the next edit. Both panels take **`expanded`** instead.
2. **The clamp was 40px out.** Flex distributes whole `<section>`s, headers included, so a ratio
   clamped against `columnPx − 2·HEADER_PX − STRIP_PX` left the losing panel a 95px body, not 120.
   The share the ratio divides is `columnPx − STRIP_PX`, and the minimum it is clamped against is
   `MIN_PANEL_PX` (header + body = 160). Measured after the fix: both clamps land on a 120px body
   exactly.
3. **The grip was invisible** at `bg-line` on `bg-panel` — one palette step, the very contrast
   failure this milestone exists to fix. It is `bg-disabled` (`#52525b`), `group-hover:bg-muted`.
4. **A collapsed panel kept its action buttons.** New layer on a folded-away list would add a layer
   with nothing to show for it, so `PanelHeader` renders its actions only while open.
5. **`HEADER_PX` is not imported by `Sidebar.svelte`** — it is used only inside `split.ts` to build
   `MIN_PANEL_PX`. Importing it fails the 0-warning build bar.
6. `split.test.ts` has **12** tests, and the suite finishes at **519 in 40 files**.
