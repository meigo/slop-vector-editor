# Milestone 2d — UI Alignment with slop-animator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the app's look and controls with slop-animator and the family UI guide: system font, raised fields, one on-state, toggle buttons, focus rings, a labelled File menu, grouped no-wrap bars, a layout-stable unsaved indicator and section titles.

**Architecture:** Shared CSS lives in `src/app.css`. Component classes stay in `@layer components`. The on-state, selection and focus rules sit outside any layer, so utilities can't override them. A pure `toggle.ts` helper and a `ToggleButton.svelte` component replace every checkbox. The bars and panels get a few class changes. The layout doesn't change.

**Tech Stack:** Svelte 5.55 (runes; `class={[...]}` arrays are supported), TypeScript strict, Vite 8, Tailwind 4, Vitest 4 (node env).

**Spec:** `docs/superpowers/specs/2026-09-17-m2d-ui-alignment-design.md` (binding). The rules come from `../SLOP-TIMELINE-UI.md`.

## Global Constraints

- **Checks:**
  - `npm run build` must end with **0 errors, 0 warnings**. This includes svelte-check's a11y warnings.
  - `npm run lint` must be silent, `npm test` must pass, and `npm run format:check` must be clean.
  - Run `npx prettier --write` on touched files before committing.
- **Tests:** Vitest has no DOM. Only `src/lib/toggle.ts` gets unit tests. UI tasks are gated by the build and a dev-server compile check, and the controller runs the browser pass.
- **Colours:** use theme tokens only; no literal colours in components.
- **Classes:** write each element's classes as ONE expression, for example `class={["btn", on && "ui-on"]}`. Never layer a `class:` colour directive over a base class that sets a colour (guide §6).
- **State and layout:** a state change must not change an element's size or position (guide §5).
- **Control height:** controls in the top bar and context bar are 32px (`h-8`). This deliberately differs from the guide's 24px, as slop-animator does. The floating modifier dock keeps its 40px buttons.
- **Dry run:** Tasks 1–3 were applied to `main` 58414ed in a throwaway worktree. Build 0 errors / 0 warnings, lint clean, 278 tests pass, and a screenshot matched the design.
- **Behaviour:** no change to layout (tool strip, context bar, right panel/drawer, status bar, dock) or to any feature.
- **Dev server:** the user's dev server on `:5173` must not be touched. Compile checks use another port.
- **Commit trailer** on every commit, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Git:** work on branch `m2d-ui-alignment` off `main`, one commit per task, and merge only when the user says so.

## File map

```
index.html                              − IBM Plex Mono links
src/app.css                             font, body size, raised .field, .section-title, .bar-sep, shrink/no-wrap on buttons,
                                        unlayered .ui-on/.ui-mixed/.ui-selected(-tint), focus rules; − .tool-on/.dock-on/.btn-on
src/lib/ToolStrip.svelte                .ui-on
src/lib/ModifierDock.svelte             .ui-on
src/lib/NewDocumentDialog.svelte        .ui-on + aria-pressed presets (Task 1); "Size" section title (Task 3)
src/lib/toggle.ts                       + toggleView, nextToggle (pure)
src/__tests__/toggle.test.ts            + tests
src/lib/ToggleButton.svelte             + shared toggle button
src/lib/ContextBar.svelte               Star toggles (Task 2); separators, no-wrap (Task 3)
src/lib/PaintField.svelte               "On" toggle, section title, raised swatch, tabular hex
src/lib/DocumentSettingsDialog.svelte   Background toggle, section titles, raised swatch
src/lib/TopBar.svelte                   File ▾ menu button, unsaved colour, separators, no-wrap
src/lib/NumberField.svelte              no-wrap label
src/lib/PropertiesPanel.svelte          section titles
CLAUDE.md, docs/superpowers/CHANGELOG.md
```

---

### Task 1: Shared styles, font and the single on-state

**Files:**
- Modify: `index.html`, `src/app.css`, `src/lib/ToolStrip.svelte`, `src/lib/ModifierDock.svelte`, `src/lib/NewDocumentDialog.svelte`

**Interfaces:**
- Produces these CSS classes, which later tasks use:
  - `.ui-on`, `.ui-mixed`, `.ui-selected`, `.ui-selected-tint` (unlayered)
  - `.section-title`, `.bar-sep` (components layer)
  - `.field` is raised
  - `.icon-btn` and `.btn` get `shrink-0`; `.btn` also gets `whitespace-nowrap`
- `.tool-on`, `.dock-on` and `.btn-on` no longer exist.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/meigo/Projects/slop/slop-vector-editor
git checkout -b m2d-ui-alignment
```

- [ ] **Step 2: Drop the web font** — in `index.html`, delete these lines:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap"
    />
```

- [ ] **Step 3: Replace `src/app.css`** with:

```css
@import "tailwindcss";

/* Family palette, verbatim from ../SLOP-TIMELINE-UI.md §1 (role names kept). Dark only. The
   ARTWORK is unaffected: the artboard background is document data, painted by the canvas.
   System font like slop-animator (spec M2d §2). */
@theme {
  --font-sans: system-ui, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --color-ground: #101013;
  --color-panel: #1e1e22;
  --color-raised: #2d2d33;
  --color-line: #2e2e35;
  --color-text: #f4f4f5;
  --color-muted: #a1a1aa;
  --color-accent: #5b8cff;
  --color-accent-hover: #7aa3ff;
  --color-accent-text: #121212;
  --color-danger: #f87171;
  --color-warn: #d5b75d;
  --color-ok: #34d399;
  --color-guide: #ff3ea5;
  --color-disabled: #52525b;
}

html,
body {
  height: 100%;
  margin: 0;
  overscroll-behavior: none;
  background: var(--color-ground);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.4;
  -webkit-user-select: none;
  user-select: none;
}

/* Fixed like slop-animator: iOS must not scroll or rubber-band the app shell. */
#app {
  position: fixed;
  inset: 0;
}

@layer components {
  /* Every control in a bar is 32px high (spec M2d §5; the guide says 24px, slop-animator and
     touch use 32px). Controls never shrink or wrap; the bar scrolls instead. */
  .icon-btn {
    @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-text hover:bg-raised disabled:text-disabled disabled:hover:bg-transparent;
  }
  .btn {
    @apply inline-flex h-8 shrink-0 items-center rounded border border-line bg-raised px-3 text-xs whitespace-nowrap text-text hover:border-muted disabled:text-disabled;
  }
  .btn-primary {
    @apply border-accent bg-accent text-accent-text hover:bg-accent-hover;
  }
  /* Fields are raised: an input must not be the colour of the surface it sits on (guide §3). */
  .field {
    @apply h-8 rounded border border-line bg-raised px-2 text-xs text-text select-text focus:border-accent;
  }
  .menu-item {
    @apply flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-raised;
  }
  .kbd {
    @apply text-muted;
  }
  .section-title {
    @apply text-[11px] font-medium tracking-wide text-muted uppercase;
  }
  /* Group separator in a bar: 1px rule, bar height minus 8px (guide §4). */
  .bar-sep {
    @apply mx-1 my-1 w-px shrink-0 self-stretch bg-line;
  }
}

/* THE on-state, defined once (guide §6: one idiom per app). Unlayered on purpose: unlayered
   declarations beat every Tailwind layer, so a button's own text/background utilities can never
   hide it. Copied from slop-animator/src/app.css. */
.ui-on {
  background-color: var(--color-accent);
  color: var(--color-accent-text);
}
.ui-on:hover {
  background-color: var(--color-accent-hover);
}
/* A toggle whose selection is mixed: accent text, no fill. */
.ui-mixed {
  color: var(--color-accent);
}
/* A selected ROW: a quiet tint plus a 2px left edge. The edge is an inset shadow so selecting a
   row never changes its geometry (guide §5). For the M3 layers panel. */
.ui-selected,
.ui-selected-tint {
  --ui-selected-tint: color-mix(in srgb, var(--color-accent) 10%, transparent);
  background-color: var(--ui-selected-tint);
}
.ui-selected {
  box-shadow: inset 2px 0 0 var(--color-accent);
}

/* Focus rings are a keyboard affordance: none after a mouse/pen click, one consistent ring for
   the keyboard. */
:focus:not(:focus-visible) {
  outline: none;
}
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
```

- [ ] **Step 4: Switch the three on-state users**

`src/lib/ToolStrip.svelte`: replace

```svelte
      class="icon-btn"
      class:tool-on={app.toolId === t.id}
```

with

```svelte
      class={["icon-btn", app.toolId === t.id && "ui-on"]}
```

`src/lib/ModifierDock.svelte`: replace both occurrences. The Snap button

```svelte
    class="h-10 w-14 rounded border border-line text-xs select-none"
    class:dock-on={app.prefs.snap}
```

becomes

```svelte
    class={["h-10 w-14 rounded border border-line text-xs select-none", app.prefs.snap && "ui-on"]}
```

and the Shift/Alt buttons

```svelte
      class="h-10 w-14 rounded border border-line text-xs select-none"
      class:dock-on={app.dock[key] !== "off"}
```

become

```svelte
      class={[
        "h-10 w-14 rounded border border-line text-xs select-none",
        app.dock[key] !== "off" && "ui-on",
      ]}
```

`src/lib/NewDocumentDialog.svelte`: replace

```svelte
      <button
        class="btn"
        class:btn-on={p.w === w && p.h === h}
```

with

```svelte
      <button
        class={["btn", p.w === w && p.h === h && "ui-on"]}
        aria-pressed={p.w === w && p.h === h}
```

Then confirm that nothing refers to the removed classes:

```bash
grep -rn "tool-on\|dock-on\|btn-on\|IBM Plex" src index.html
```

Expected: no output.

- [ ] **Step 5: Verify**

Run: `npm run build` (0 errors / 0 warnings), `npm run lint`, `npm run format:check`, `npm test` (expected 276).

Compile check on port 5199:

```bash
(npx vite --port 5199 --strictPort > "$TMPDIR/sv-5199.log" 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}" http://localhost:5199/ | grep -q 200 && break; perl -e 'select(undef,undef,undef,0.5)'; done
for f in app.css lib/ToolStrip.svelte lib/ModifierDock.svelte lib/NewDocumentDialog.svelte; do curl -s -o /dev/null -w "$f %{http_code}\n" "http://localhost:5199/src/$f"; done
pkill -f "vite --port 5199"
```

Expected: `200` for each file. Localhost access may need the sandbox disabled.

- [ ] **Step 6: Commit**

```bash
git add index.html src/app.css src/lib/ToolStrip.svelte src/lib/ModifierDock.svelte src/lib/NewDocumentDialog.svelte
git commit -m "style: system font, raised fields, one on-state, focus rings

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Toggles are buttons

**Files:**
- Create: `src/lib/toggle.ts`, `src/lib/ToggleButton.svelte`
- Test: `src/__tests__/toggle.test.ts`
- Modify: `src/lib/ContextBar.svelte` (the two Star checkboxes), `src/lib/PaintField.svelte`, `src/lib/DocumentSettingsDialog.svelte`

**Interfaces:**
- Consumes: `.ui-on`, `.ui-mixed`, `.btn`, `.section-title`, and the raised `.field` (Task 1).
- Produces:
  - `type ToggleValue = boolean | "mixed"`
  - `toggleView(v): { pressed: "true" | "false" | "mixed"; on: boolean; mixed: boolean }`
  - `nextToggle(v): boolean`
  - `<ToggleButton value label ariaLabel? title? disabled? onchange={(next: boolean) => …} />`

Plan decision: the spec's table column "Label" is the toggle's accessible name. PaintField and Document settings show a section title (Fill / Stroke / Background) followed by a toggle reading "On", whose `aria-label` is that name. This keeps the two panels consistent, and screen readers announce "Fill, toggle button, pressed".

- [ ] **Step 1: Write the failing test** — `src/__tests__/toggle.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { nextToggle, toggleView } from "../lib/toggle";

describe("toggle buttons", () => {
  it("describes the three states", () => {
    expect(toggleView(true)).toEqual({ pressed: "true", on: true, mixed: false });
    expect(toggleView(false)).toEqual({ pressed: "false", on: false, mixed: false });
    expect(toggleView("mixed")).toEqual({ pressed: "mixed", on: false, mixed: true });
  });

  it("turns a mixed or off toggle on, and an on toggle off", () => {
    expect(nextToggle(false)).toBe(true);
    expect(nextToggle("mixed")).toBe(true);
    expect(nextToggle(true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/toggle.test.ts`
Expected: FAIL — cannot resolve `../lib/toggle`.

- [ ] **Step 3: Implement the helper and the component**

`src/lib/toggle.ts`:

```ts
/** Spec (M2d) §4: toggles are buttons with aria-pressed; a mixed selection shows accent text. */
export type ToggleValue = boolean | "mixed";

export type ToggleView = { pressed: "true" | "false" | "mixed"; on: boolean; mixed: boolean };

export function toggleView(v: ToggleValue): ToggleView {
  return {
    pressed: v === "mixed" ? "mixed" : v ? "true" : "false",
    on: v === true,
    mixed: v === "mixed",
  };
}

/** A click turns a mixed or off toggle on, and an on toggle off. */
export function nextToggle(v: ToggleValue): boolean {
  return v !== true;
}
```

`src/lib/ToggleButton.svelte`:

```svelte
<script lang="ts">
  import { nextToggle, toggleView, type ToggleValue } from "./toggle";

  let {
    value,
    label,
    ariaLabel,
    title,
    disabled = false,
    onchange,
  }: {
    value: ToggleValue;
    label: string;
    ariaLabel?: string;
    title?: string;
    disabled?: boolean;
    onchange: (next: boolean) => void;
  } = $props();

  const view = $derived(toggleView(value));
</script>

<button
  type="button"
  class={["btn", view.on && "ui-on", view.mixed && "ui-mixed"]}
  aria-pressed={view.pressed}
  aria-label={ariaLabel}
  {title}
  {disabled}
  onclick={() => onchange(nextToggle(value))}
>
  {label}
</button>
```

Run: `npx vitest run src/__tests__/toggle.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Replace the checkboxes**

`src/lib/ContextBar.svelte`: add `import ToggleButton from "./ToggleButton.svelte";`. Then:

- Replace the polygon-tool block

```svelte
    <label class="flex items-center gap-1">
      <input
        type="checkbox"
        checked={poly.star}
        onchange={(e) => setPolygonPrefs({ star: e.currentTarget.checked })}
      />
      Star
    </label>
```

with

```svelte
    <ToggleButton label="Star" value={poly.star} onchange={(star) => setPolygonPrefs({ star })} />
```

- Replace the selected-polygons block

```svelte
      <label class="flex items-center gap-1">
        <input
          type="checkbox"
          checked={polygons.star === true}
          indeterminate={polygons.star === "mixed"}
          onchange={(e) => setSelectionPolygon({ star: e.currentTarget.checked })}
        />
        Star
      </label>
```

with

```svelte
      <ToggleButton
        label="Star"
        value={polygons.star}
        onchange={(star) => setSelectionPolygon({ star })}
      />
```

`src/lib/PaintField.svelte`: add `import ToggleButton from "./ToggleButton.svelte";`. Then:

- Replace the header row

```svelte
  <div class="flex items-center justify-between">
    <span class="font-semibold">{label}</span>
    <label class="flex items-center gap-1 text-muted">
      <input
        type="checkbox"
        checked={paint !== null}
        onchange={(e) => onchange(e.currentTarget.checked ? (paint ?? fallback) : null)}
      />
      {field.mixed ? "mixed" : paint ? "on" : "none"}
    </label>
  </div>
```

with

```svelte
  <div class="flex items-center justify-between">
    <span class="section-title">{label}</span>
    <ToggleButton
      label="On"
      ariaLabel={label}
      value={field.mixed ? "mixed" : paint !== null}
      onchange={(on) => onchange(on ? (paint ?? fallback) : null)}
    />
  </div>
```

- In the same file, change the swatch class `bg-ground` to `bg-raised`, and the hex input's class `field w-20 font-mono` to `field w-20 font-mono tabular-nums`.

`src/lib/DocumentSettingsDialog.svelte`: add `import ToggleButton from "./ToggleButton.svelte";`. Replace the two rows inside `<Modal …>` (everything before `{#snippet actions()}`) with:

```svelte
  <div class="flex flex-col gap-1">
    <span class="section-title">Size</span>
    <div class="flex items-center gap-3 text-xs">
      <label class="flex items-center gap-1">
        W <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={w} />
      </label>
      <label class="flex items-center gap-1">
        H <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={h} />
      </label>
      <span class="text-muted">px</span>
    </div>
  </div>
  <div class="mt-3 flex flex-col gap-1">
    <span class="section-title">Background</span>
    <div class="flex items-center gap-3 text-xs">
      <ToggleButton
        label="On"
        ariaLabel="Background"
        value={hasBackground}
        onchange={(on) => (hasBackground = on)}
      />
      <input
        class="h-8 w-12 cursor-pointer rounded border border-line bg-raised disabled:opacity-40"
        type="color"
        disabled={!hasBackground}
        bind:value={color}
        aria-label="Background color"
      />
      {#if !hasBackground}<span class="text-muted">transparent</span>{/if}
    </div>
  </div>
```

Then confirm that no checkbox is left:

```bash
grep -rn 'type="checkbox"' src/lib
```

Expected: no output.

- [ ] **Step 5: Verify**

Run: `npm test` (expected 278), `npm run build` (0 errors / 0 warnings), `npm run lint`, `npm run format:check`.

Then run the Task 1 compile check with these files: `lib/ToggleButton.svelte lib/ContextBar.svelte lib/PaintField.svelte lib/DocumentSettingsDialog.svelte`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/toggle.ts src/lib/ToggleButton.svelte src/__tests__/toggle.test.ts src/lib/ContextBar.svelte src/lib/PaintField.svelte src/lib/DocumentSettingsDialog.svelte
git commit -m "style: toggles are buttons with aria-pressed, including a mixed state

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Bars, File menu, unsaved indicator, section titles

**Files:**
- Modify: `src/lib/TopBar.svelte`, `src/lib/ContextBar.svelte`, `src/lib/NumberField.svelte`, `src/lib/PropertiesPanel.svelte`, `src/lib/NewDocumentDialog.svelte`

**Interfaces:**
- Consumes: `.bar-sep`, `.section-title`, `.ui-on`, and the no-wrap `.btn`/`.icon-btn` (Task 1); `ToggleButton` (Task 2).
- Produces: UI only.

- [ ] **Step 1: Top bar** — `src/lib/TopBar.svelte`

- Remove `Menu` from the `@lucide/svelte` import.
- Change the header's class to add `overflow-x-auto`:

```svelte
<header
  class="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2 text-xs"
>
```

- Replace the menu trigger

```svelte
    <button
      class="icon-btn"
      aria-label="File menu"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
    >
      <Menu size={18} />
    </button>
```

with

```svelte
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
```

- Replace the file-name span

```svelte
  <span class="ml-1 min-w-0 truncate" title={app.fileName}>
    {app.fileName}{#if app.dirty}<span class="text-warn" aria-label="unsaved changes"> ●</span>{/if}
  </span>
```

with

```svelte
  <!-- Unsaved = recoloured name, never an inserted glyph (guide §5: state must not move layout). -->
  <span
    class={["ml-1 min-w-0 truncate", app.dirty && "text-accent"]}
    title={app.fileName}
    aria-label={app.dirty ? `${app.fileName}, unsaved changes` : app.fileName}
  >
    {app.fileName}
  </span>
```

- In the right-hand group, change `<div class="ml-auto flex items-center gap-1">` to `<div class="ml-auto flex shrink-0 items-center gap-1">`.
- After the Properties toggle button, and before the Undo button, insert:

```svelte
    <span class="bar-sep min-[900px]:hidden"></span>
```

- Replace the existing separator `<span class="mx-1 h-5 w-px bg-line"></span>` with `<span class="bar-sep"></span>`.
- Add `shrink-0` to the zoom-percentage button's class: `class="h-8 w-14 shrink-0 rounded text-center tabular-nums hover:bg-raised"`.

- [ ] **Step 2: Context bar** — `src/lib/ContextBar.svelte`

In the polygon-tool branch, insert `<span class="bar-sep"></span>` between the Sides `NumberField` and the Star `ToggleButton`.

Replace the selection branch, from `{:else if app.selection.length > 0}` up to the `{:else}` that opens the no-selection branch, with:

```svelte
  {:else if app.selection.length > 0}
    <span class="shrink-0 whitespace-nowrap text-muted">{app.selection.length} selected</span>
    <span class="bar-sep"></span>
    <button class="btn gap-1" onclick={cutToSystem}><Scissors size={14} /> Cut</button>
    <button class="btn gap-1" onclick={copyToSystem}><Copy size={14} /> Copy</button>
    <button class="btn gap-1" onclick={() => void pasteFromClipboard()}>
      <ClipboardPaste size={14} /> Paste
    </button>
    <span class="bar-sep"></span>
    <button class="btn gap-1" onclick={duplicateSelection}>
      <CopyPlus size={14} /> Duplicate
    </button>
    <button class="btn gap-1" onclick={deleteSelection}><Trash2 size={14} /> Delete</button>
    {#if actions.canConvert || actions.canFlatten}
      <span class="bar-sep"></span>
    {/if}
    {#if actions.canConvert}
      <button class="btn" onclick={convertSelectionToPath}>Convert to path</button>
    {/if}
    {#if actions.canFlatten}
      <button class="btn" onclick={flattenSelection}>Flatten transform</button>
    {/if}
    {#if onlyRects || polygons}
      <span class="bar-sep"></span>
    {/if}
    {#if onlyRects}
      <NumberField label="Radius" value={radius} min={0} onchange={setSelectionRectRadius} />
    {/if}
    {#if polygons}
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
    {/if}
```

The block is unchanged apart from the separators and the count's classes.

- [ ] **Step 3: Number fields never wrap** — `src/lib/NumberField.svelte`

Change the wrapper `<label class="flex items-center gap-1 text-xs">` to `<label class="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap">`.

- [ ] **Step 4: Section titles**

`src/lib/PropertiesPanel.svelte`:
- Change `<h2 class="font-semibold text-muted">` to `<h2 class="section-title">`.
- Change `<span class="font-semibold">Geometry</span>` to `<span class="section-title">Geometry</span>`.

`src/lib/NewDocumentDialog.svelte`: wrap the W/H row in a titled group. Replace

```svelte
  <div class="mt-3 flex items-center gap-3 text-xs">
    <label class="flex items-center gap-1">
      W <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={w} />
    </label>
    <label class="flex items-center gap-1">
      H <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={h} />
    </label>
    <span class="text-muted">px</span>
  </div>
```

with

```svelte
  <div class="mt-3 flex flex-col gap-1">
    <span class="section-title">Size</span>
    <div class="flex items-center gap-3 text-xs">
      <label class="flex items-center gap-1">
        W <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={w} />
      </label>
      <label class="flex items-center gap-1">
        H <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={h} />
      </label>
      <span class="text-muted">px</span>
    </div>
  </div>
```

- [ ] **Step 5: Verify**

Run: `npm run build` (0 errors / 0 warnings), `npm run lint`, `npm run format:check`, `npm test` (expected 278).

Then run the Task 1 compile check with these files: `lib/TopBar.svelte lib/ContextBar.svelte lib/NumberField.svelte lib/PropertiesPanel.svelte lib/NewDocumentDialog.svelte`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/TopBar.svelte src/lib/ContextBar.svelte src/lib/NumberField.svelte src/lib/PropertiesPanel.svelte src/lib/NewDocumentDialog.svelte
git commit -m "style: labelled File menu, grouped no-wrap bars, stable unsaved indicator, section titles

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Controller browser pass (between Task 3 and Task 4)

The controller runs this pass itself, not a subagent. Use a separate dev server (`npx vite --port 5198 --strictPort`) and stop it afterwards. Screenshots of `main` for comparison come from a throwaway worktree on another port.

Check each of the following:

1. The computed `font-family` of the body is `system-ui, sans-serif`, and no resource entry mentions `fonts.googleapis.com` or `fonts.gstatic.com`.
2. The screenshots are acceptable:
   - top bar;
   - context bar with a selection, with a polygon selection, and with the polygon tool;
   - Properties with and without a selection;
   - the New and Settings dialogs.
3. There is no `input[type=checkbox]` in the DOM. Every toggle has `aria-pressed`:
   - Star is `"mixed"` for a polygon and a star selected together;
   - Fill's toggle is `"mixed"` for a filled and an unfilled shape selected together;
   - clicking a toggle changes the document with one undo step, as before.
4. Tool strip, dock and preset "on" buttons have the accent background (`.ui-on`), and hovering keeps them accent.
5. Focus: pressing Tab shows a 2px accent outline on the focused button, and clicking a button with the mouse shows none.
6. The file name's bounding box is identical when the document is clean and when it is dirty, and the dirty name's colour is the accent.
7. At 820px wide, neither bar wraps: each bar's height is unchanged, and the bars scroll sideways if needed.
8. `.field` computed background is `rgb(45, 45, 51)` (raised).
9. The File ▾ button opens the menu and shows `.ui-on` while it is open.
10. No console errors.

Record the results for Task 4 and send any failures through a fix dispatch first.

---

### Task 4: Documentation

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`

**Interfaces:** none. The controller passes the browser results in the dispatch.

- [ ] **Step 1: `CLAUDE.md`**
  - **Architecture map:** in the `src/lib/` bullet, add `ToggleButton` (with `toggle.ts`, the pure state helper).
  - **New gotcha**, appended after the last one:
    > **UI follows `../SLOP-TIMELINE-UI.md` and slop-animator** (spec M2d).
    > - The on-state is `.ui-on`, and a row selection is `.ui-selected`. Both are unlayered in `app.css`, so no utility can hide them.
    > - Write each element's classes as one expression (`class={["btn", on && "ui-on"]}`), never a `class:` colour directive over a coloured base.
    > - Toggles are `ToggleButton`s (`aria-pressed`, with a `"mixed"` state), never checkboxes.
    > - Fields are raised.
    > - A state change must not move the layout. For example, unsaved changes recolour the file name.
    > - Bar controls are 32px high. This is a deliberate difference from the guide's 24px, shared with slop-animator, because it suits touch.
  - **Commands:** update the test count to the actual `npm test` result.
- [ ] **Step 2: `docs/superpowers/CHANGELOG.md`** — append:

```markdown
## 2026-09-17 — Milestone 2d: UI alignment with slop-animator

- System UI font (IBM Plex Mono and its Google Fonts request removed); 14px body text; tabular
  digits in number and hex fields.
- Raised fields; one on-state (`.ui-on`, unlayered) for tools, dock, presets and the open File
  menu; `.ui-selected` row style ready for the layers panel; keyboard-only focus rings.
- Checkboxes became toggle buttons (`ToggleButton`, `aria-pressed`, with a mixed state): Star (tool
  and selection), Fill/Stroke "On", Document settings Background.
- The ☰ menu is a labelled "File ▾" button; bars have group separators and never wrap (they scroll
  when too narrow); the unsaved state recolours the file name instead of inserting a dot; panel and
  dialog section titles are small uppercase labels.
- Deliberate deviation from SLOP-TIMELINE-UI.md: bar controls are 32px (as in slop-animator), not
  24px.
- Plan: `docs/superpowers/plans/2026-09-17-m2d-ui-alignment.md`.
- Browser-verified (desktop Chrome): <controller fills in from the browser pass>.
- Owed: iPad/Safari look (system font there is SF), touch sizes on a device.
```

Replace `<controller fills in …>` with the results the controller provides.

- [ ] **Step 3: Verify and commit**

Run: `npm test` (use its count) and `npm run format:check`.

```bash
git add CLAUDE.md docs/superpowers/CHANGELOG.md
git commit -m "docs: milestone 2d UI alignment

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
