# Milestone 2e — One Icon Top Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the file bar + context bar pair with one icon-only top bar whose tooltips also show in the status bar, and move the shape fields (Radius, Sides/Star/Inner, polygon defaults) into the Properties panel.

**Architecture:**
- **Pure helpers:** `hintFrom` (hover hint text) and `summarizeRects` (rect radius summary) are unit-tested.
- **Top bar:** a small `IconButton` component builds it. Buttons that don't apply stay visible and are marked `aria-disabled`, so their "why" tooltip still shows and the bar never jumps.
- **Removed:** `ContextBar.svelte`.
- **Properties:** gains a "Shape" section for a selection and a "Polygon" defaults section when nothing is selected.

**Tech Stack:** Svelte 5.55 (runes, `class={[...]}`), TypeScript strict, Vite 8, Tailwind 4, Vitest 4 (node env), `@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-09-17-m2e-icon-toolbar-design.md` (binding). It supersedes parts of the M2d spec. The family UI guide is `../SLOP-TIMELINE-UI.md`.

## Global Constraints

- **Checks:**
  - `npm run build` must end with **0 errors, 0 warnings**, svelte-check a11y warnings included.
  - `npm run lint` must be silent, `npm test` must pass, and `npm run format:check` must be clean.
  - Run `npx prettier --write` on touched files before committing.
- **Tests:** Vitest has no DOM. Only the pure helpers get unit tests. UI tasks are gated by the build and a dev-server compile check, and the controller runs the browser pass.
- **Colours:** use theme tokens only.
- **Classes:** write each element's classes as one expression (`class={[...]}`), never a `class:` colour directive over a coloured base.
- **State must not move layout:** disabled buttons stay in place, and the bar never wraps or scrolls.
- **Top bar controls:** each is 32px (`.icon-btn`) with an 18px icon, and each has an `aria-label` (the action name) and a `title` (tooltip text with shortcut, or the reason it is disabled).
- **Unchanged:** the tool strip (left), the right-click menu, the store actions, the file format, the keyboard shortcuts.
- **Dry run:** Tasks 1–3 were applied to `main` 6ae6589 in a throwaway worktree. Build 0 errors / 0 warnings, lint clean, 281 tests pass. At 768px the header fitted on one row with the file name still ~200px wide, and a screenshot matched the design.
- **Dev server:** the user's dev server on `:5173` must not be touched. Compile checks use another port.
- **Commit trailer** on every commit, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Git:** work on branch `m2e-icon-toolbar` off `main`, one commit per task, and merge only when the user says so.

## File map

```
src/lib/hover-hint.ts               + hintFrom (pure)
src/__tests__/hover-hint.test.ts    + tests
src/state/properties.ts             + RectSummary, summarizeRects
src/__tests__/properties.test.ts    + rect summary test
src/lib/PropertiesPanel.svelte      + Shape section (selection), Polygon defaults section
src/app.css                         .icon-btn gets aria-disabled styling
src/lib/IconButton.svelte           + shared icon button (aria-disabled, reason tooltip)
src/lib/TopBar.svelte               all actions as icon buttons
src/lib/ContextBar.svelte           − deleted
src/App.svelte                      − ContextBar; + hover-hint listeners
src/state/appState.svelte.ts        + app.hoverHint
src/lib/StatusBar.svelte            shows hoverHint ?? tool hint
CLAUDE.md, README.md, docs/superpowers/CHANGELOG.md
```

---

### Task 1: Pure helpers

**Files:**
- Create: `src/lib/hover-hint.ts`
- Test: `src/__tests__/hover-hint.test.ts`
- Modify: `src/state/properties.ts`
- Test: `src/__tests__/properties.test.ts` (extended)

**Interfaces:**
- Produces:
  - `type HintTarget = { closest(selector: string): { getAttribute(name: string): string | null } | null }`
  - `hintFrom(target: HintTarget | null, pointerType: string): string | null`
  - `type RectSummary = { radius: number | null }`
  - `summarizeRects(doc: Doc, ids: readonly string[]): RectSummary | null`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/meigo/Projects/slop/slop-vector-editor
git checkout -b m2e-icon-toolbar
```

- [ ] **Step 2: Write the failing tests**

`src/__tests__/hover-hint.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hintFrom, type HintTarget } from "../lib/hover-hint";

const within = (title: string | null): HintTarget => ({
  closest: (selector) => {
    expect(selector).toBe("[title]");
    return title === null ? null : { getAttribute: (name) => (name === "title" ? title : null) };
  },
});

describe("status-bar hover hints", () => {
  it("uses the nearest title under a mouse", () => {
    expect(hintFrom(within("Cut (⌘X)"), "mouse")).toBe("Cut (⌘X)");
  });

  it("ignores touch and pen, missing targets and empty titles", () => {
    expect(hintFrom(within("Cut (⌘X)"), "touch")).toBeNull();
    expect(hintFrom(within("Cut (⌘X)"), "pen")).toBeNull();
    expect(hintFrom(null, "mouse")).toBeNull();
    expect(hintFrom(within(null), "mouse")).toBeNull();
    expect(hintFrom(within(""), "mouse")).toBeNull();
  });
});
```

`src/__tests__/properties.test.ts`: add `summarizeRects` to the `../state/properties` import. Then append:

```ts
describe("rect summary", () => {
  it("summarises rect radii, blanking values that differ", () => {
    const e: Node = {
      kind: "ellipse",
      id: "e",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      cx: 5,
      cy: 5,
      rx: 5,
      ry: 5,
    };
    const d = doc(
      rect("a", 0, 0, 10, 10),
      { ...rect("b", 20, 0, 10, 10), rx: 3 },
      { ...rect("c", 40, 0, 10, 10), rx: 3 },
      e,
    );
    expect(summarizeRects(d, [])).toBeNull();
    expect(summarizeRects(d, ["a", "e"])).toBeNull();
    expect(summarizeRects(d, ["b", "c"])).toEqual({ radius: 3 });
    expect(summarizeRects(d, ["a", "b"])).toEqual({ radius: null });
  });
});
```

This file already defines `rect(id, x, y, w, h)` (rx 0) and `doc(...children)`, and already imports `Node`, `IDENTITY` and `DEFAULT_STYLE`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/__tests__/hover-hint.test.ts src/__tests__/properties.test.ts`
Expected: FAIL. `../lib/hover-hint` can't be resolved, and `summarizeRects` isn't exported.

- [ ] **Step 4: Implement**

`src/lib/hover-hint.ts`:

```ts
/** Spec (M2e) §4: the status bar shows the title of whatever the mouse is over. Structural
 *  parameter type so this stays testable without a DOM. */
export type HintTarget = {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
};

export function hintFrom(target: HintTarget | null, pointerType: string): string | null {
  if (pointerType !== "mouse" || !target) return null;
  const title = target.closest("[title]")?.getAttribute("title");
  return title ? title : null;
}
```

`src/state/properties.ts`:
- Change the document import to also bring in `RectShape`:
  `import type { Doc, LineCap, LineJoin, Paint, PolygonShape, RectShape, Style } from "../doc/document";`
- After `summarizePolygons`, add:

```ts
export type RectSummary = { radius: number | null };

/** Shape-section value for a selection made only of rects (spec M2e §5); null otherwise. */
export function summarizeRects(doc: Doc, ids: readonly string[]): RectSummary | null {
  const nodes = ids.flatMap((id) => findTopLevel(doc, id)?.node ?? []);
  const rects = nodes.filter((n): n is RectShape => n.kind === "rect");
  if (rects.length === 0 || rects.length !== nodes.length) return null;
  return { radius: rects.every((r) => r.rx === rects[0].rx) ? rects[0].rx : null };
}
```

Also change `summarizePolygons`' doc comment from "Context-bar values" to "Shape-section values". The context bar is going away in Task 3.

- [ ] **Step 5: Run the tests to verify they pass**

Run the Step 3 command, then `npm test` (expected 281), `npx tsc --noEmit`, `npm run lint`, `npm run format:check`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hover-hint.ts src/__tests__/hover-hint.test.ts src/state/properties.ts src/__tests__/properties.test.ts
git commit -m "feat: hover-hint and rect-summary helpers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Shape fields in the Properties panel

**Files:**
- Modify: `src/lib/PropertiesPanel.svelte`

**Interfaces:**
- Consumes:
  - `summarizeRects` (Task 1) and `summarizePolygons`;
  - `ToggleButton`, `NumberField`;
  - the store actions `setSelectionRectRadius`, `setSelectionPolygon`, `setPolygonPrefs`.
- Produces: UI only. The context bar keeps its own copies of these fields until Task 3 removes it.

- [ ] **Step 1: Wire the data** — in the `<script>`:

- Change the store import to
  `import { app, applyGeometry, setPolygonPrefs, setSelectionPolygon, setSelectionRectRadius, setSelectionStyle } from "../state/appState.svelte";`
- Add `summarizePolygons` and `summarizeRects` to the `../state/properties` import.
- Add `import ToggleButton from "./ToggleButton.svelte";`.
- After `const geometry = …`, add:

```ts
  const rects = $derived(hasSelection ? summarizeRects(app.doc, app.selection) : null);
  const polygons = $derived(hasSelection ? summarizePolygons(app.doc, app.selection) : null);
  const poly = $derived(app.prefs.polygon);
```

- [ ] **Step 2: Add the sections** — insert right before `{#if geometry}`:

```svelte
  {#if rects || polygons}
    <div class="flex flex-col gap-2 border-t border-line pt-3">
      <span class="section-title">Shape</span>
      {#if rects}
        <NumberField
          label="Radius"
          value={rects.radius}
          min={0}
          onchange={setSelectionRectRadius}
        />
      {/if}
      {#if polygons}
        <div class="flex flex-wrap items-center gap-2">
          <NumberField
            label="Sides"
            value={polygons.sides}
            min={3}
            max={32}
            onchange={(v) => setSelectionPolygon({ sides: Math.round(v) })}
          />
          <ToggleButton
            label="Star"
            value={polygons.star}
            onchange={(star) => setSelectionPolygon({ star })}
          />
          {#if polygons.anyStar}
            <NumberField
              label="Inner"
              value={polygons.innerRatio === null ? null : Math.round(polygons.innerRatio * 100)}
              min={10}
              max={95}
              suffix="%"
              onchange={(v) => setSelectionPolygon({ innerRatio: v / 100 })}
            />
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if !hasSelection}
    <div class="flex flex-col gap-2 border-t border-line pt-3">
      <span class="section-title">Polygon</span>
      <div class="flex flex-wrap items-center gap-2">
        <NumberField
          label="Sides"
          value={poly.sides}
          min={3}
          max={32}
          onchange={(v) => setPolygonPrefs({ sides: Math.round(v) })}
        />
        <ToggleButton
          label="Star"
          value={poly.star}
          onchange={(star) => setPolygonPrefs({ star })}
        />
        {#if poly.star}
          <NumberField
            label="Inner"
            value={Math.round(poly.innerRatio * 100)}
            min={10}
            max={95}
            suffix="%"
            onchange={(v) => setPolygonPrefs({ innerRatio: v / 100 })}
          />
        {/if}
      </div>
    </div>
  {/if}
```

The field ranges match the tool's (3–32 sides, 10–95 %). `rects` and `polygons` are `null` whenever nothing is selected, so the two sections never show together.

- [ ] **Step 3: Verify**

Run: `npm run build` (0 errors / 0 warnings), `npm run lint`, `npm run format:check`, `npm test` (281).

Then compile-check on a spare port:

```bash
(npx vite --port 5199 --strictPort > "$TMPDIR/sv-5199.log" 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}" http://localhost:5199/ | grep -q 200 && break; perl -e 'select(undef,undef,undef,0.5)'; done
curl -s -o /dev/null -w "PropertiesPanel %{http_code}\n" http://localhost:5199/src/lib/PropertiesPanel.svelte
pkill -f "vite --port 5199"
```

Expected: `200`. Localhost access may need the sandbox disabled.

- [ ] **Step 4: Commit**

```bash
git add src/lib/PropertiesPanel.svelte
git commit -m "feat(ui): shape fields and polygon defaults in the properties panel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: One icon top bar, context bar removed, status-bar hints

**Files:**
- Modify: `src/app.css`, `src/lib/TopBar.svelte`, `src/App.svelte`, `src/state/appState.svelte.ts`, `src/lib/StatusBar.svelte`
- Create: `src/lib/IconButton.svelte`
- Delete: `src/lib/ContextBar.svelte`

**Interfaces:**
- Consumes:
  - `hintFrom` (Task 1);
  - `selectionActions`;
  - the store actions `cutToSystem`, `copyToSystem`, `pasteFromClipboard`, `duplicateSelection`, `deleteSelection`, `convertSelectionToPath`, `flattenSelection`;
  - `runCommand`.
- Produces:
  - `app.hoverHint: string | null`
  - `<IconButton label title icon onclick disabled? disabledTitle? />`

- [ ] **Step 1: `aria-disabled` styling** — in `src/app.css`, replace the `.icon-btn` rule with:

```css
  .icon-btn {
    @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-text hover:bg-raised disabled:text-disabled disabled:hover:bg-transparent aria-disabled:cursor-default aria-disabled:text-disabled aria-disabled:hover:bg-transparent;
  }
```

`aria-disabled` is used instead of `disabled` because browsers don't show a disabled button's tooltip or send it pointer events. With `aria-disabled`, the "why" tooltip stays reachable (guide §4).

- [ ] **Step 2: `src/lib/IconButton.svelte`**

```svelte
<script lang="ts">
  import type { Scissors } from "@lucide/svelte";

  /** A top-bar action (spec M2e §2): icon only, named by aria-label, explained by title. A
   *  disabled button stays in place and says why (aria-disabled keeps its tooltip reachable). */
  let {
    label,
    title,
    icon: Icon,
    onclick,
    disabled = false,
    disabledTitle,
  }: {
    label: string;
    title: string;
    icon: typeof Scissors;
    onclick: () => void;
    disabled?: boolean;
    disabledTitle?: string;
  } = $props();
</script>

<button
  type="button"
  class="icon-btn"
  aria-label={label}
  aria-disabled={disabled}
  title={disabled && disabledTitle ? disabledTitle : title}
  onclick={() => {
    if (!disabled) onclick();
  }}
>
  <Icon size={18} />
</button>
```

- [ ] **Step 3: Replace `src/lib/TopBar.svelte`** with:

```svelte
<script lang="ts">
  import {
    ClipboardPaste,
    Copy,
    CopyPlus,
    Maximize,
    Redo2,
    Scissors,
    SlidersHorizontal,
    Spline,
    Stamp,
    Trash2,
    Undo2,
    ZoomIn,
    ZoomOut,
  } from "@lucide/svelte";
  import {
    app,
    convertSelectionToPath,
    copyToSystem,
    cutToSystem,
    deleteSelection,
    duplicateSelection,
    flattenSelection,
    pasteFromClipboard,
    type DialogKind,
  } from "../state/appState.svelte";
  import { runCommand } from "../state/commands";
  import type { Command } from "../state/keys";
  import { selectionActions } from "../state/properties";
  import IconButton from "./IconButton.svelte";

  let menuOpen = $state(false);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl+";

  const none = $derived(app.selection.length === 0);
  const actions = $derived(selectionActions(app.doc, app.selection));

  function command(cmd: Command) {
    menuOpen = false;
    runCommand(cmd);
  }

  function dialog(kind: DialogKind) {
    menuOpen = false;
    app.dialog = kind;
  }
</script>

<!-- One bar, icons only (spec M2e §2). It never wraps or scrolls: a scrolling bar would clip the
     File menu (M2d §5), so only the file name shrinks. -->
<header class="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2 text-xs">
  <div class="relative shrink-0">
    <button
      class={[
        "inline-flex h-8 shrink-0 items-center gap-1 rounded px-2 text-xs whitespace-nowrap hover:bg-raised",
        menuOpen && "ui-on",
      ]}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
    >
      File<span class="text-[10px] opacity-70">▾</span>
    </button>
    {#if menuOpen}
      <button
        class="fixed inset-0 z-40 cursor-default"
        aria-label="Close menu"
        tabindex="-1"
        onclick={() => (menuOpen = false)}
      ></button>
      <div
        class="absolute top-full left-0 z-50 mt-1 w-56 rounded border border-line bg-panel py-1 shadow-lg"
        role="menu"
      >
        <button class="menu-item" role="menuitem" onclick={() => dialog("new")}>New…</button>
        <button class="menu-item" role="menuitem" onclick={() => command("open")}>
          Open… <span class="kbd">{mod}O</span>
        </button>
        <button class="menu-item" role="menuitem" onclick={() => command("save")}>
          Save <span class="kbd">{mod}S</span>
        </button>
        <button class="menu-item" role="menuitem" onclick={() => command("saveAs")}>
          Save As… <span class="kbd">⇧{mod}S</span>
        </button>
        <div class="my-1 h-px bg-line"></div>
        <button class="menu-item" role="menuitem" onclick={() => dialog("settings")}>
          Document settings…
        </button>
      </div>
    {/if}
  </div>

  <!-- Unsaved = recoloured name, never an inserted glyph (guide §5: state must not move layout). -->
  <span class={["ml-1 min-w-0 truncate", app.dirty && "text-accent"]} title={app.fileName}>
    {app.fileName}{#if app.dirty}<span class="sr-only">, unsaved changes</span>{/if}
  </span>

  <span class="bar-sep"></span>
  <IconButton
    label="Undo"
    title="Undo ({mod}Z)"
    icon={Undo2}
    disabled={!app.canUndo}
    disabledTitle="Undo — nothing to undo"
    onclick={() => command("undo")}
  />
  <IconButton
    label="Redo"
    title="Redo (⇧{mod}Z)"
    icon={Redo2}
    disabled={!app.canRedo}
    disabledTitle="Redo — nothing to redo"
    onclick={() => command("redo")}
  />

  <span class="bar-sep"></span>
  <IconButton
    label="Cut"
    title="Cut ({mod}X)"
    icon={Scissors}
    disabled={none}
    disabledTitle="Cut — nothing selected"
    onclick={cutToSystem}
  />
  <IconButton
    label="Copy"
    title="Copy ({mod}C)"
    icon={Copy}
    disabled={none}
    disabledTitle="Copy — nothing selected"
    onclick={copyToSystem}
  />
  <IconButton
    label="Paste"
    title="Paste ({mod}V)"
    icon={ClipboardPaste}
    onclick={() => void pasteFromClipboard()}
  />

  <span class="bar-sep"></span>
  <IconButton
    label="Duplicate"
    title="Duplicate ({mod}D)"
    icon={CopyPlus}
    disabled={none}
    disabledTitle="Duplicate — nothing selected"
    onclick={duplicateSelection}
  />
  <IconButton
    label="Delete"
    title="Delete (⌫)"
    icon={Trash2}
    disabled={none}
    disabledTitle="Delete — nothing selected"
    onclick={deleteSelection}
  />

  <span class="bar-sep"></span>
  <IconButton
    label="Convert to path"
    title="Convert to path"
    icon={Spline}
    disabled={!actions.canConvert}
    disabledTitle="Convert to path — select a rectangle, ellipse or polygon"
    onclick={convertSelectionToPath}
  />
  <IconButton
    label="Flatten transform"
    title="Flatten transform"
    icon={Stamp}
    disabled={!actions.canFlatten}
    disabledTitle="Flatten transform — select a moved or rotated path"
    onclick={flattenSelection}
  />

  <div class="ml-auto flex shrink-0 items-center gap-1">
    <IconButton
      label="Zoom out"
      title="Zoom out (-)"
      icon={ZoomOut}
      onclick={() => command("zoomOut")}
    />
    <button
      class="h-8 w-14 shrink-0 rounded text-center tabular-nums hover:bg-raised"
      title="Zoom to 100% ({mod}1)"
      onclick={() => command("zoom100")}
    >
      {Math.round(app.view.zoom * 100)}%
    </button>
    <IconButton
      label="Zoom in"
      title="Zoom in (+)"
      icon={ZoomIn}
      onclick={() => command("zoomIn")}
    />
    <IconButton
      label="Fit artboard"
      title="Fit artboard ({mod}0)"
      icon={Maximize}
      onclick={() => command("fit")}
    />
    <span class="bar-sep min-[900px]:hidden"></span>
    <button
      class={["icon-btn min-[900px]:hidden", app.propertiesOpen && "ui-on"]}
      aria-label="Properties"
      aria-pressed={app.propertiesOpen}
      title="Properties"
      onclick={() => (app.propertiesOpen = !app.propertiesOpen)}
    >
      <SlidersHorizontal size={18} />
    </button>
  </div>
</header>
```

Before relying on the icon names, check that they exist:

```bash
ls node_modules/@lucide/svelte/dist/icons | grep -E '^(spline|stamp|scissors|copy|copy-plus|clipboard-paste|trash-2)\.svelte$'
```

Expected: all 7 are listed.

- [ ] **Step 4: Remove the context bar**

```bash
git rm src/lib/ContextBar.svelte
```

In `src/App.svelte`:
- delete `import ContextBar from "./lib/ContextBar.svelte";`
- delete the `<ContextBar />` line.

- [ ] **Step 5: Status-bar hover hints**

`src/state/appState.svelte.ts`: in `AppState`, add after `lastPointerType`:

```ts
  /** Tooltip text of whatever the mouse is over, shown in the status bar (spec M2e §4). */
  hoverHint = $state<string | null>(null);
```

`src/App.svelte`:
- Add `import { hintFrom } from "./lib/hover-hint";`.
- Add these functions after `onkeyup`:

```ts
  function onpointerover(e: PointerEvent) {
    app.hoverHint = hintFrom(e.target as Element | null, e.pointerType);
  }

  function onpointerout(e: PointerEvent) {
    if (!e.relatedTarget) app.hoverHint = null;
  }
```

- In `<svelte:window …/>`, add the attributes
  `{onpointerover}`, `{onpointerout}` and `onpointerdown={() => (app.hoverHint = null)}`.

`src/lib/StatusBar.svelte`: replace `<span class="min-w-0 truncate">{TOOLS[app.toolId].hint}</span>` with

```svelte
  <span class="min-w-0 truncate">{app.hoverHint ?? TOOLS[app.toolId].hint}</span>
```

- [ ] **Step 6: Verify**

Run: `npm run build` (0 errors / 0 warnings), `npm run lint`, `npm run format:check`, `npm test` (281), and

```bash
grep -rn "ContextBar" src
```

Expected: no output.

Then run the Task 2 compile check with these files: `lib/TopBar.svelte lib/IconButton.svelte lib/StatusBar.svelte App.svelte`.

- [ ] **Step 7: Commit**

```bash
git add src/app.css src/lib/IconButton.svelte src/lib/TopBar.svelte src/App.svelte src/state/appState.svelte.ts src/lib/StatusBar.svelte
git commit -m "feat(ui): one icon top bar with status-bar hints; context bar removed

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

`git rm` has already staged the deletion. Confirm that `git show --stat HEAD` lists `src/lib/ContextBar.svelte` as deleted.

---

### Controller browser pass (between Task 3 and Task 4)

The controller runs this pass itself on a separate dev server (`npx vite --port 5198 --strictPort`) and stops it afterwards. Take a **screenshot of every state below.** A DOM check alone is not enough; that lesson is from M2d.

1. The top bar with nothing selected: Cut, Copy, Duplicate, Delete, Convert and Flatten are `aria-disabled="true"`, their titles give the reasons, and Paste is enabled.
2. The top bar with a rect selected: Cut, Copy, Duplicate, Delete and Convert are enabled, and Flatten is disabled with its reason. Every button has an `aria-label` and a `title`.
3. The open File menu is fully visible, and "Document settings…" opens the dialog.
4. Hovering Cut shows "Cut (⌘X)" in the status bar. Moving onto the canvas brings back the tool hint.
5. Clicking a disabled button does nothing: the document is unchanged and no history is added.
6. The top-bar buttons work: cut, copy, paste (clipboard stubbed), duplicate, delete, convert, flatten, undo and redo.
7. Properties with two rects of different radius selected: the Shape section shows Radius blank, and setting it changes both in one undo step.
8. Properties with a polygon and a star selected: Sides, Star (`aria-pressed="mixed"`) and Inner. Editing them takes one undo step each.
9. Properties with nothing selected: the Polygon section. Changing Sides to 7 and Star to on updates `prefs.polygon`, and the next drawn polygon has 7 points and is a star.
10. Width: with `#app` set to 768px and to 820px, the header stays one row with `scrollWidth <= clientWidth`. Record how much room is left for M3a's four z-order icons.
11. No `ContextBar` element is left, the canvas is taller by the removed bar, and there are no console errors.

Record the results for Task 4. Fix any failures first.

---

### Task 4: Documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/CHANGELOG.md`

**Interfaces:** none. The controller passes the browser results in the dispatch.

- [ ] **Step 1: `CLAUDE.md`**
  - **Architecture map, `src/lib/` bullet:** remove `ContextBar`. Add `IconButton` (top-bar icon action with reason tooltips) and `hover-hint.ts` (the status bar shows the hovered element's `title`).
  - **Gotchas:**
    - In the M2d UI gotcha, change any mention of the context bar so it refers to the top bar.
    - Append a new gotcha:
      > **Every `title` is also a status-bar hint** (spec M2e). On mouse hover, the status bar shows the nearest `title`. Write titles as short action descriptions with the shortcut, e.g. "Cut (⌘X)".
      > Top-bar actions that don't apply use `aria-disabled` with a reason title, e.g. "Cut — nothing selected". They never use `disabled` and are never hidden: a disabled button shows no tooltip, and a hidden one moves the bar.
      > The top bar must never scroll or wrap, because that would clip the File menu. Only the file name shrinks.
  - **Current state:** `Milestone 2e (one icon top bar) — see CHANGELOG. Next is milestone 3a: the layers panel and z-order.`
  - **Commands:** update the test count to the actual `npm test` result.
- [ ] **Step 2: `README.md`**
  - Add to the Status list: `- An icon toolbar with tooltips (also shown in the status bar); shape options (corner radius, polygon sides/star) live in the properties panel.`
  - Development: update the test count to the actual result.
- [ ] **Step 3: `docs/superpowers/CHANGELOG.md`** — append:

```markdown
## 2026-09-17 — Milestone 2e: one icon top bar

- The file bar and the context bar became one icon-only top bar: File ▾ · name | undo redo |
  cut copy paste | duplicate delete | convert-to-path flatten … zoom | properties (narrow).
  Actions that don't apply stay in place, `aria-disabled`, with the reason in the tooltip.
- Every `title` also shows in the status bar on mouse hover (tool hint otherwise).
- Rect radius and polygon Sides / Star / Inner moved to a "Shape" section in Properties; the
  polygon tool's defaults are a "Polygon" section under "Defaults for new shapes".
- Superseded: the M2d entry's context-bar bullets (separators, Star toggle in the context bar,
  40px context bar) — the context bar no longer exists.
- Plan: `docs/superpowers/plans/2026-09-17-m2e-icon-toolbar.md`.
- Browser-verified (desktop Chrome): <controller fills in from the browser pass>.
- Owed: iPad (no hover, so no status-bar hints on touch; tooltips need a long-press), Safari/Firefox.
```

Replace `<controller fills in …>` with the results the controller provides.

- [ ] **Step 4: Verify and commit**

Run: `npm test` (use its count) and `npm run format:check`.

```bash
git add CLAUDE.md README.md docs/superpowers/CHANGELOG.md
git commit -m "docs: milestone 2e icon top bar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
