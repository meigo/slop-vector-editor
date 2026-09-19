# Milestone 6 — Selection Conveniences — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the editor the selection commands it has never had — Select All, Invert Selection, and Select Same fill / stroke / style / kind — reachable from a new Select menu, the context menu and the keyboard.

**Architecture:**
- **The matching is pure and lives in one file.** `src/doc/select-match.ts` takes a `Doc` and returns id arrays; it imports nothing from the store and knows nothing about menus.
- **Reach is not reinvented.** Every command calls `selectableIds(doc, enteredGroupId)`, which already encodes "visible, unlocked layers, or the entered group's children". That function currently has no production caller, so this milestone stops it drifting from the inline copies in `hitTest`/`marqueeSelect`.
- **Both menus ask one place what applies.** `selectionActions` in `src/state/properties.ts` gains two flags, so the top bar and the context menu cannot disagree about a disabled entry.

**Tech Stack:** Svelte 5.55 (runes), TypeScript strict, Vite 8, Tailwind 4, Vitest 4 (node env).

**Spec:** `docs/superpowers/specs/2026-09-19-m6-selection-conveniences-design.md` (binding).

## Global Constraints

- **Checks:** `npm run build` ends with **0 errors, 0 warnings**; `npm run lint` silent; `npm test` passes; `npm run format:check` clean. Run `npx prettier --write` on touched files before committing.
- **The document is immutable** and **nothing in this milestone edits it.** Every command changes only `app.selection`.
- **Every session change goes through `setSession`;** selection goes through `setSelection`, which prunes. Never assign `app.selection` directly outside it.
- **Reach is `selectableIds(doc, enteredGroupId)`** — never a hand-rolled layer walk.
- **Paints compare exactly**, `null` matches only `null`. No tolerance.
- **Several seeds mean union**, and the seeds always match themselves.
- **UI:** theme tokens only; one class expression per element; every `title` reads as an action and is also the status-bar hint. **An unavailable command is disabled with a reason in the Select menu** (CLAUDE.md invariant 24 — the top bar must not move) **and hidden in the context menu** (its existing pattern; a menu under the pointer has no layout to keep still).
- **Existing tests keep their expected values** unless a step says otherwise.
- **Commit trailer**, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. One commit per task.
- **Git:** branch `m6-selection` off `main` (the controller creates it).
- **The sandboxed `git commit` fails with EPERM on `.git/index.lock`** — retry that one command with the sandbox disabled.

## File map

```
src/doc/select-match.ts        + allIds, invertIds, sameIds, MatchField  (new, pure)
src/state/properties.ts        selectionActions gains canSelectSameStyle / canSelectSameKind
src/state/appState.svelte.ts   + selectAll, invertSelection, selectSame
src/state/keys.ts              ⌘A → selectAll, ⇧⌘A → invertSelection
src/state/commands.ts          routes the two new edit actions
src/lib/TopBar.svelte          + the Select menu
src/lib/ContextMenu.svelte     + the same entries
README.md, CLAUDE.md, docs/superpowers/CHANGELOG.md
```

---

### Task 1: The matching rules

**Files:**
- Create: `src/doc/select-match.ts`
- Test: `src/__tests__/select-match.test.ts` (new)

**Interfaces:**
- Consumes: `selectableIds(doc, enteredGroupId)` and `findNode(doc, id)` from `src/doc/tree.ts`; `Doc`, `Node`, `Paint`, `Style` from `src/doc/document.ts`.
- Produces:
  - `type MatchField = "fill" | "stroke" | "style" | "kind"`
  - `allIds(doc: Doc, entered: string | null): string[]`
  - `invertIds(doc: Doc, ids: readonly string[], entered: string | null): string[]`
  - `sameIds(doc: Doc, ids: readonly string[], entered: string | null, field: MatchField): string[]`

- [ ] **Step 1: Write the failing tests** — `src/__tests__/select-match.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type Node,
  type Paint,
  type Style,
} from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { allIds, invertIds, sameIds } from "../doc/select-match";

const paint = (color: string, opacity = 1): Paint => ({ color, opacity });
const style = (patch: Partial<Style> = {}): Style => ({ ...DEFAULT_STYLE, ...patch });

const rect = (id: string, s: Style): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: s,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rx: 0,
});

const ellipse = (id: string, s: Style): Node => ({
  kind: "ellipse",
  id,
  transform: IDENTITY,
  style: s,
  cx: 0,
  cy: 0,
  rx: 5,
  ry: 5,
});

const group = (id: string, children: Node[]): Node => ({
  kind: "group",
  id,
  transform: IDENTITY,
  opacity: 1,
  children,
});

const ORANGE = style({ fill: paint("#ff8800"), stroke: paint("#000000") });
const BLUE = style({ fill: paint("#0088ff"), stroke: paint("#000000") });
const ORANGE_THICK = style({ fill: paint("#ff8800"), stroke: paint("#000000"), strokeWidth: 4 });
const NO_FILL = style({ fill: null, stroke: paint("#000000") });

/** L0 visible: orange rect a, blue rect b, orange ellipse c, no-fill rect d, group g(e orange).
 *  L1 hidden: orange rect h. L2 locked: orange rect k. */
function makeDoc(): Doc {
  const base = createDoc(200, 200);
  return {
    ...base,
    layers: [
      {
        id: "L0",
        name: "L0",
        visible: true,
        locked: false,
        children: [
          rect("a", ORANGE),
          rect("b", BLUE),
          ellipse("c", ORANGE),
          rect("d", NO_FILL),
          group("g", [rect("e", ORANGE)]),
        ],
      },
      { id: "L1", name: "L1", visible: false, locked: false, children: [rect("h", ORANGE)] },
      { id: "L2", name: "L2", visible: true, locked: true, children: [rect("k", ORANGE)] },
    ],
  };
}

describe("allIds", () => {
  it("returns every top-level id on a visible, unlocked layer, in document order", () => {
    expect(allIds(makeDoc(), null)).toEqual(["a", "b", "c", "d", "g"]);
  });

  it("returns an entered group's children instead", () => {
    expect(allIds(makeDoc(), "g")).toEqual(["e"]);
  });
});

describe("invertIds", () => {
  it("returns everything in reach that is not selected", () => {
    expect(invertIds(makeDoc(), ["a", "c"], null)).toEqual(["b", "d", "g"]);
  });

  it("clears a full selection and selects everything from an empty one", () => {
    const doc = makeDoc();
    expect(invertIds(doc, ["a", "b", "c", "d", "g"], null)).toEqual([]);
    expect(invertIds(doc, [], null)).toEqual(["a", "b", "c", "d", "g"]);
  });

  it("ignores a selected id that is out of reach", () => {
    // "h" is on a hidden layer: it is not in reach, so it cannot be subtracted from it.
    expect(invertIds(makeDoc(), ["h"], null)).toEqual(["a", "b", "c", "d", "g"]);
  });
});

describe("sameIds", () => {
  it("matches fill across kinds, and never reaches a hidden or locked layer", () => {
    expect(sameIds(makeDoc(), ["a"], null, "fill")).toEqual(["a", "c"]);
  });

  it("unions several seeds", () => {
    expect(sameIds(makeDoc(), ["a", "b"], null, "fill")).toEqual(["a", "b", "c"]);
  });

  it("matches a null fill only against another null fill", () => {
    expect(sameIds(makeDoc(), ["d"], null, "fill")).toEqual(["d"]);
    expect(sameIds(makeDoc(), ["a"], null, "fill")).not.toContain("d");
  });

  it("matches stroke independently of fill", () => {
    // Every shape on L0 has the same black stroke, so the orange seed finds all of them.
    expect(sameIds(makeDoc(), ["a"], null, "stroke")).toEqual(["a", "b", "c", "d"]);
  });

  it("requires every style field to match", () => {
    const doc = makeDoc();
    const thick: Doc = {
      ...doc,
      layers: [{ ...doc.layers[0], children: [...doc.layers[0].children, rect("t", ORANGE_THICK)] }, ...doc.layers.slice(1)],
    };
    expect(sameIds(thick, ["a"], null, "style")).toEqual(["a", "c"]);
    expect(sameIds(thick, ["t"], null, "style")).toEqual(["t"]);
  });

  it("matches kind, including groups", () => {
    expect(sameIds(makeDoc(), ["a"], null, "kind")).toEqual(["a", "b", "d"]);
    expect(sameIds(makeDoc(), ["g"], null, "kind")).toEqual(["g"]);
  });

  it("skips groups for the style fields, as seed and as candidate", () => {
    const doc = makeDoc();
    // A group seed has no style, so a style match finds nothing at all.
    expect(sameIds(doc, ["g"], null, "fill")).toEqual([]);
    // And a group is never returned by one.
    expect(sameIds(doc, ["a"], null, "fill")).not.toContain("g");
  });

  it("stays inside an entered group", () => {
    expect(sameIds(makeDoc(), ["e"], "g", "fill")).toEqual(["e"]);
  });

  it("returns an empty array for an empty selection", () => {
    expect(sameIds(makeDoc(), [], null, "fill")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/select-match.test.ts`
Expected: FAIL — `../doc/select-match` does not exist.

- [ ] **Step 3: Implement** — `src/doc/select-match.ts`

```ts
import type { Doc, Node, Paint, Style } from "./document";
import { findNode, selectableIds } from "./tree";

/** What "the same" means for `sameIds` (spec M6 §3). */
export type MatchField = "fill" | "stroke" | "style" | "kind";

/** Colours compare exactly: the document stores what the user picked, and a nearly-equal orange is
 *  a different colour. `null` (no paint) matches only `null`. */
const samePaint = (a: Paint | null, b: Paint | null): boolean =>
  a === null || b === null ? a === b : a.color === b.color && a.opacity === b.opacity;

const sameStyle = (a: Style, b: Style): boolean =>
  samePaint(a.fill, b.fill) &&
  samePaint(a.stroke, b.stroke) &&
  a.strokeWidth === b.strokeWidth &&
  a.cap === b.cap &&
  a.join === b.join &&
  a.opacity === b.opacity;

/** A group has no `Style`, so it is neither a seed nor a candidate for the paint fields. */
const styleOf = (n: Node): Style | null => (n.kind === "group" ? null : n.style);

function matches(field: MatchField, a: Node, b: Node): boolean {
  if (field === "kind") return a.kind === b.kind;
  const x = styleOf(a);
  const y = styleOf(b);
  if (x === null || y === null) return false;
  if (field === "fill") return samePaint(x.fill, y.fill);
  if (field === "stroke") return samePaint(x.stroke, y.stroke);
  return sameStyle(x, y);
}

/** Reach, for every command here: the entered group's children, or every top-level node on a
 *  visible, unlocked layer (spec M6 §4). In document order. */
export function allIds(doc: Doc, entered: string | null): string[] {
  return [...selectableIds(doc, entered)];
}

export function invertIds(doc: Doc, ids: readonly string[], entered: string | null): string[] {
  const selected = new Set(ids);
  return allIds(doc, entered).filter((id) => !selected.has(id));
}

/** Every id in reach matching any selected node on `field`. The seeds match themselves, so the
 *  selection never shrinks (spec M6 §3). */
export function sameIds(
  doc: Doc,
  ids: readonly string[],
  entered: string | null,
  field: MatchField,
): string[] {
  const seeds = ids.flatMap((id) => findNode(doc, id)?.node ?? []);
  if (seeds.length === 0) return [];
  return allIds(doc, entered).filter((id) => {
    const node = findNode(doc, id)?.node;
    return node !== undefined && seeds.some((seed) => matches(field, node, seed));
  });
}
```

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(doc): pure matching for the selection commands

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Store actions, shortcuts and the applies-to flags

**Files:**
- Modify: `src/state/appState.svelte.ts`, `src/state/keys.ts`, `src/state/commands.ts`, `src/state/properties.ts`
- Test: `src/__tests__/prefs-route-keys.test.ts`, `src/__tests__/node-store.test.ts` (both extended)

**Interfaces:**
- Consumes: `allIds`, `invertIds`, `sameIds`, `MatchField` (Task 1).
- Produces:
  - `selectAll(): void`, `invertSelection(): void`, `selectSame(field: MatchField): void` in the store
  - `EditAction` gains `{ kind: "selectAll" }` and `{ kind: "invertSelection" }`
  - `SelectionActions` gains `canSelectSameStyle: boolean` and `canSelectSameKind: boolean`

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/prefs-route-keys.test.ts`, inside `describe("editActionForKey")`:

```ts
  it("maps the selection shortcuts", () => {
    expect(k("a", { metaKey: true })).toEqual({ kind: "selectAll" });
    expect(k("a", { metaKey: true, shiftKey: true })).toEqual({ kind: "invertSelection" });
    expect(k("a", { ctrlKey: true })).toEqual({ kind: "selectAll" });
    // A bare "a" is not a tool key and must stay unhandled.
    expect(k("a")).toBeNull();
  });
```

In `src/__tests__/node-store.test.ts`, append a describe. That file's `beforeEach` already calls `replaceDocument(makeDoc(), …)` and `setTool("select")`, and its document is a 3-node path `p` and a rect `r` on layer `L0`:

```ts
describe("selection commands", () => {
  it("selects everything, then inverts it", () => {
    selectAll();
    expect(app.selection).toEqual(["p", "r"]);
    invertSelection();
    expect(app.selection).toEqual([]);
    invertSelection();
    expect(app.selection).toEqual(["p", "r"]);
  });

  it("selects the same kind", () => {
    setSelection(["r"]);
    selectSame("kind");
    expect(app.selection).toEqual(["r"]);
    setSelection(["p"]);
    selectSame("kind");
    expect(app.selection).toEqual(["p"]);
  });

  it("selects the same fill, and stays out of a hidden layer", () => {
    setSelection(["p"]);
    selectSame("fill");
    // p and r share DEFAULT_STYLE, so both match.
    expect(app.selection).toEqual(["p", "r"]);
    toggleLayerVisible("L0");
    selectAll();
    expect(app.selection).toEqual([]);
  });

  it("routes the two shortcuts through runEditAction", () => {
    setSelection([]);
    runEditAction({ kind: "selectAll" });
    expect(app.selection).toEqual(["p", "r"]);
    runEditAction({ kind: "invertSelection" });
    expect(app.selection).toEqual([]);
  });
});
```

Add `selectAll`, `invertSelection`, `selectSame` to that file's `../state/appState.svelte` import.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/prefs-route-keys.test.ts src/__tests__/node-store.test.ts`
Expected: FAIL — the actions and the two `EditAction` kinds do not exist.

- [ ] **Step 3: Implement**

**`src/state/appState.svelte.ts`** — three actions, beside the other selection actions:

```ts
/** Spec (M6) §2–§4. These change no document, but a selection that moves under a running drag is
 *  the hazard invariant 15 exists for, so the gesture is cancelled first. */
export function selectAll(): void {
  cancelActiveGesture();
  setSelection(allIds(app.doc, app.enteredGroupId));
}

export function invertSelection(): void {
  cancelActiveGesture();
  setSelection(invertIds(app.doc, app.selection, app.enteredGroupId));
}

export function selectSame(field: MatchField): void {
  cancelActiveGesture();
  setSelection(sameIds(app.doc, app.selection, app.enteredGroupId, field));
}
```

with `import { allIds, invertIds, sameIds, type MatchField } from "../doc/select-match";`.

**`src/state/keys.ts`** — `EditAction` gains two kinds. Its **last member is `| { kind: "ungroup" };`** — append after it, keeping the semicolon on the new last line:

```ts
  | { kind: "ungroup" }
  | { kind: "selectAll" }
  | { kind: "invertSelection" };
```

and, inside the `if (e.metaKey || e.ctrlKey)` branch, beside the `d` and `g` lines:

```ts
    if (k === "a") return { kind: e.shiftKey ? "invertSelection" : "selectAll" };
```

**`src/state/commands.ts`** — two cases in `runEditAction`, each returning `true` like its neighbours:

```ts
    case "selectAll":
      selectAll();
      return true;
    case "invertSelection":
      invertSelection();
      return true;
```

with both names added to the `../state/appState.svelte` import. Check the switch's existing return convention before writing these — `runEditAction` returns whether it consumed the action, and every case but `commit` returns `true`.

**`src/state/properties.ts`** — `SelectionActions` gains two flags:

```ts
export type SelectionActions = {
  canConvert: boolean;
  canFlatten: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  /** A group has no Style, so the paint commands need at least one non-group (spec M6 §6). */
  canSelectSameStyle: boolean;
  canSelectSameKind: boolean;
};
```

and `selectionActions` gains, beside its existing entries:

```ts
    canSelectSameStyle: nodes.some((n) => n.kind !== "group"),
    canSelectSameKind: nodes.length > 0,
```

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(state): select all, invert and select same

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The Select menu

**Files:**
- Modify: `src/lib/TopBar.svelte`, `src/app.css`

**Interfaces:**
- Consumes: `selectAll`, `invertSelection`, `selectSame` (Task 2); `selectionActions` (Task 2).

- [ ] **Step 1: Implement**

`TopBar.svelte` already has a File menu: a `relative` wrapper, a button with `aria-haspopup="menu"` and `aria-expanded`, a fixed backdrop button that closes it, and a `role="menu"` panel of `menu-item` buttons. Build the Select menu the same way, immediately after the File menu's wrapper `</div>`, so it reads `File  Select` in the bar.

Read the File menu block first and mirror its classes exactly. The new menu needs its own open state — rename nothing; add `let selectOpen = $state(false);` beside the existing `menuOpen`, and close each when the other opens.

The entries, in order, with the `mod`/`shiftMod` helpers the File menu already uses for shortcut text:

```svelte
        <button class="menu-item" role="menuitem" onclick={() => runSelect(selectAll)}>
          Select All <span class="kbd">{mod}A</span>
        </button>
        <button class="menu-item" role="menuitem" onclick={() => run(invertSelection)}>
          Invert Selection <span class="kbd">{shiftMod}A</span>
        </button>
        <div class="my-1 h-px bg-line"></div>
        <button
          class="menu-item"
          role="menuitem"
          aria-disabled={!actions.canSelectSameStyle}
          title={actions.canSelectSameStyle
            ? "Select every shape with this fill"
            : sameStyleReason}
          onclick={() => actions.canSelectSameStyle && runSelect(() => selectSame("fill"))}
        >
          Same Fill Colour
        </button>
```

and the same shape for `Same Stroke Colour` (`"stroke"`), `Same Style` (`"style"`, gated on `canSelectSameStyle`) and `Same Kind` (`"kind"`, gated on `canSelectSameKind`).

Add to the script block. **`TopBar.svelte` already imports `selectionActions` and already has
`const actions = $derived(selectionActions(app.doc, app.selection));` for its icon buttons — reuse
that one, do not add a second.** The file also already has `mod` and `shiftMod`. So the only new
script members are:

```ts
  const sameStyleReason = $derived(
    app.selection.length === 0 ? "— nothing selected" : "— a group has no fill",
  );

  /** Close the menu, then act — the same order the File menu uses. */
  function runSelect(action: () => void) {
    selectOpen = false;
    action();
  }
```

plus `selectAll`, `invertSelection` and `selectSame` added to the existing `../state/appState.svelte`
import list. Name the helper `runSelect`, not `run` — this file may already have other handlers, and
the context menu's own `run` is a different function in a different component.

**`src/app.css` — a disabled menu entry must look disabled.** `.menu-item` has no `aria-disabled`
styling today, so a greyed-out command would render identically to an enabled one and still
highlight on hover. `.icon-btn` right above it already has the pattern; give `.menu-item` the same
three variants:

```css
  .menu-item {
    @apply flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-raised aria-disabled:cursor-default aria-disabled:text-disabled aria-disabled:hover:bg-transparent;
  }
```

Write each title as a full action phrase, because it is also the status-bar hint (CLAUDE.md invariant 24): `"Select every shape with this fill"`, `"Select every shape with this stroke"`, `"Select every shape with this style"`, `"Select every shape of this kind"`, and for a disabled one the reason forms `"Same Fill Colour — nothing selected"` / `"Same Fill Colour — a group has no fill"`. A disabled entry uses `aria-disabled` and does nothing on click; it is never hidden and never uses `disabled`, which would suppress its tooltip.

- [ ] **Step 2: Verify**

`npm run build` (0 / 0), `npm run lint`, `npm run format:check`, `npm test` (unchanged). Then a dev-server compile check on port **5197**: start `npx vite --port 5197 --strictPort` yourself, `curl` the transformed module URL for `src/lib/TopBar.svelte`, confirm 200 with no error payload, and stop the server you started. It needs the sandbox disabled. **Never use port 5173 or 5198**, and if a port is busy pick another — **never kill the process holding it**.

- [ ] **Step 3: Commit**

```bash
git add -A src
git commit -m "feat(ui): a Select menu in the top bar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The same entries in the context menu

**Files:**
- Modify: `src/lib/ContextMenu.svelte`

**Interfaces:**
- Consumes: the same three store actions and `selectionActions`, both already imported patterns in that file.

- [ ] **Step 1: Implement**

`ContextMenu.svelte` already derives `const actions = $derived(selectionActions(app.doc, app.selection));` and runs entries through its own `run(action)` helper, which closes the menu first. Add a section of the same `menu-item` buttons, separated by the file's existing `<div class="my-1 h-px bg-line"></div>` divider, placed **after** the existing shape actions so the menu's familiar top does not move:

- `Select All` and `Invert Selection` — always shown, always enabled.
- `Same Fill Colour`, `Same Stroke Colour`, `Same Style` — inside `{#if actions.canSelectSameStyle}`.
- `Same Kind` — inside `{#if actions.canSelectSameKind}`.

**This menu hides an unavailable entry rather than disabling it** (spec §5), which is its existing
pattern for Ungroup, Convert and Flatten. Invariant 24 keeps the *top bar* from moving; a menu that
appears under the pointer has no layout to keep still. Put the new section **after** the closing
`{/if}` of the `{#if app.selection.length > 0}` block that ends with Delete, so Select All and
Invert are reachable with nothing selected.

Import `selectAll`, `invertSelection` and `selectSame` from `../state/appState.svelte`. Use the file's existing `run()` so every entry closes the menu before acting.

This is the iPad route: there is no right-click on a device, the long-press opens this menu, and no top-bar menu can be open at the same time.

- [ ] **Step 2: Verify**

`npm run build` (0 / 0), `npm run lint`, `npm run format:check`, `npm test` (unchanged), and the same dev-server compile check as Task 3 for `src/lib/ContextMenu.svelte`, on port 5197.

- [ ] **Step 3: Commit**

```bash
git add -A src
git commit -m "feat(ui): selection commands in the context menu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Controller browser pass (between Task 4 and Task 5)

The controller runs this on `npx vite --port 5198 --strictPort`, with screenshots, and stops the server afterwards.

1. **The Select menu** opens, closes on a backdrop click, and runs each of its six commands.
2. **⌘A and ⇧⌘A** select all and invert; ⌘A inside the file-name field still selects that field's text.
3. **Select Same Fill** across two layers finds the matching shapes and leaves a hidden layer's shapes alone.
4. **Inside an entered group**, every command stays within the group's children.
5. **Disabled reasons**: with nothing selected, the four Same entries read their reason on hover and on a touch press; with only a group selected, the three style entries read "a group has no fill".
6. **The context menu** carries the same entries and runs them. Two harness notes: the first
   right-click after a page load is swallowed, and the menu opens only when `app.lastPointerType` is
   `"mouse"` — so left-click the canvas once first, then right-click.
7. No console errors.

---

### Task 5: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`

- [ ] **Step 1: `CLAUDE.md`**

- Update the `npm test` line's count.
- Add `select-match.ts` to the `src/doc/` line of the architecture map.
- Add an invariant: the selection commands' reach is `selectableIds`, which they exist to keep in production use — `hitTest` and `marqueeSelect` re-implement the same rule inline, and the three must not drift. Paints compare exactly, `null` matches only `null`, and several seeds union.
- Move "Current state" to milestone 6, and record that M7 is boolean operations, already decided to use Paper.js as a geometry-only helper.

- [ ] **Step 2: `README.md`**

- Update the test count.
- Add the commands to the feature list and the two shortcuts to the keyboard table.

- [ ] **Step 3: `docs/superpowers/CHANGELOG.md`**

Append a milestone 6 entry — append-only. Cover: the three commands and what each matches; that reach is `selectableIds` and why that matters; the union-of-seeds rule and the exact-colour rule; groups having no style; the Select menu and the context-menu section; the two shortcuts, and that ⌘A previously fell through to the browser. Add a `Browser-verified:` line the controller fills in, and an `Owed:` line (the iPad pass, which now also covers these menus).

- [ ] **Step 4: Verify and commit**

`npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

```bash
git add -A
git commit -m "docs: milestone 6 selection conveniences

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
