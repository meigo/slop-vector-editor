# M9 — Per-Object Visibility and Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every shape and group the eye and lock that layers already have, and stop the
importer silently deleting hidden content.

**Architecture:** Two optional flags on the node types, read only through `isHidden`/`isLocked`. The
reach rule that `selectableIds`, `hitTest` and `marqueeSelect` each re-implement today is extracted
into one `reachableNodes` in `src/doc/tree.ts` and the three are rewired through it, so the new
clause is added once. The round-trip reuses the `display="none"` / `data-sv-locked` pair
`attrs.ts` already writes for layers.

**Tech Stack:** TypeScript strict, Svelte 5 runes, Vitest (node, **no DOM**), `@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-09-19-m9-object-visibility-design.md`

## Global Constraints

- **The document is immutable** (invariant 1). An edit that changes nothing returns the **same
  reference**. Turning a flag off **deletes the key** rather than storing `false`.
- **Node/Vitest has no DOM.** Unit tests cover pure modules only; never import a `.svelte` file.
- **TypeScript strict**, `verbatimModuleSyntax` (type-only imports say `import type`),
  `erasableSyntaxOnly`.
- **Build bar: 0 errors, 0 warnings.**
- **Canvas and export share `src/svg/attrs.ts`** (invariant 3). Never style or hide a node on the
  canvas any other way.
- **The importer never throws on unsupported content**; it reports it in `dropped` (invariant 4).
- **Every `title` is also a status-bar hint** (invariant 24), written as an action phrase.
- **Store actions that edit the document call `cancelActiveGesture()` first** (invariant 15).
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: The model, the predicates and the pure edits

**Files:** Modify `src/doc/document.ts`, `src/doc/edits.ts`; Test `src/__tests__/node-flags.test.ts` (create)

**Interfaces — Produces:** `Shape`/`Group` fields `hidden?: true` and `locked?: true`;
`isHidden(n: Node): boolean`; `isLocked(n: Node): boolean`;
`setNodeHidden(doc: Doc, ids: readonly string[], hidden: boolean): Doc`;
`setNodeLocked(doc: Doc, ids: readonly string[], locked: boolean): Doc`.

- [ ] **Step 1: Write the failing test** — `src/__tests__/node-flags.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isHidden, isLocked, type Doc } from "../doc/document";
import { setNodeHidden, setNodeLocked } from "../doc/edits";
import { findNode } from "../doc/tree";
import { twoRects } from "./fixtures";

const nodeOf = (d: Doc, id: string) => findNode(d, id)!.node;

describe("node flags", () => {
  it("hides and shows, and a no-op keeps the same document", () => {
    const d = twoRects();
    const hidden = setNodeHidden(d, ["a"], true);
    expect(isHidden(nodeOf(hidden, "a"))).toBe(true);
    expect(isHidden(nodeOf(hidden, "b"))).toBe(false);
    expect(setNodeHidden(hidden, ["a"], true)).toBe(hidden);
    expect(setNodeHidden(d, ["a"], false)).toBe(d);
  });

  it("deletes the key when turning a flag off, so the node is as it never was", () => {
    const d = twoRects();
    const shown = setNodeHidden(setNodeHidden(d, ["a"], true), ["a"], false);
    expect("hidden" in nodeOf(shown, "a")).toBe(false);
    expect(JSON.stringify(shown)).toBe(JSON.stringify(d));
  });

  it("locks several at once and leaves the rest alone", () => {
    const d = twoRects();
    const locked = setNodeLocked(d, ["a", "b"], true);
    expect(isLocked(nodeOf(locked, "a"))).toBe(true);
    expect(isLocked(nodeOf(locked, "b"))).toBe(true);
    expect(setNodeLocked(locked, [], true)).toBe(locked);
  });

  it("the two flags are independent", () => {
    const d = setNodeLocked(setNodeHidden(twoRects(), ["a"], true), ["a"], true);
    expect(isHidden(nodeOf(d, "a"))).toBe(true);
    expect(isLocked(nodeOf(d, "a"))).toBe(true);
    const shown = setNodeHidden(d, ["a"], false);
    expect(isLocked(nodeOf(shown, "a"))).toBe(true);
  });
});
```

(If `./fixtures` has no `twoRects`, build the same two-rect document inline — check
`src/__tests__/` for the existing helper before writing a new one.)

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run src/__tests__/node-flags.test.ts`.
      Expected: FAIL, `setNodeHidden` is not exported.

- [ ] **Step 3: Add the fields and predicates** to `src/doc/document.ts`. On `ShapeBase`, after
      `name?: string`, and on `Group`, after `name?: string`:

```ts
  /** Absent means normal — a node carries a flag only in its `true` state, so "not hidden" has
   *  exactly one representation and a no-op edit can return the same reference (spec M9 §3). */
  hidden?: true;
  locked?: true;
```

and beside the other type exports:

```ts
export const isHidden = (n: Node): boolean => n.hidden === true;
export const isLocked = (n: Node): boolean => n.locked === true;
```

- [ ] **Step 4: Add the edits** to `src/doc/edits.ts`, following the file's existing `mapNodes`
      style:

```ts
/** Spec M9 §3. Turning a flag off deletes the key, so a node hidden and shown again is structurally
 *  identical to one that never was and still saves byte-identically. */
function setFlag(doc: Doc, ids: readonly string[], key: "hidden" | "locked", on: boolean): Doc {
  if (ids.length === 0) return doc;
  const want = new Set(ids);
  return mapNodes(doc, (n) => {
    if (!want.has(n.id)) return n;
    if (on) return n[key] === true ? n : { ...n, [key]: true as const };
    if (n[key] === undefined) return n;
    const next = { ...n };
    delete next[key];
    return next;
  });
}

export const setNodeHidden = (doc: Doc, ids: readonly string[], hidden: boolean): Doc =>
  setFlag(doc, ids, "hidden", hidden);
export const setNodeLocked = (doc: Doc, ids: readonly string[], locked: boolean): Doc =>
  setFlag(doc, ids, "locked", locked);
```

Check `mapNodes`' exact signature in `src/doc/tree.ts` first — it passes the parent matrix and
returns the same document when no node changed, which is what makes the no-op test pass.

- [ ] **Step 5: Tests pass, then the full gates** — `npm test && npm run build`.

- [ ] **Step 6: Commit** — `feat: hidden and locked flags on shapes and groups`.

---

### Task 2: One reach rule, shared

**Files:** Modify `src/doc/tree.ts`, `src/geom/hit.ts`, `src/geom/snap.ts`;
Test `src/__tests__/reach.test.ts` (create)

**Interfaces — Consumes:** `isHidden`, `isLocked` (Task 1).
**Produces:** `type Reachable = { node: Node; layer: Layer; parent: Mat }`;
`reachableNodes(doc: Doc, enteredGroupId?: string | null): Reachable[]`;
`blocked(doc: Doc, id: string): boolean`.

**Why this task exists:** invariant 37 records that `hitTest` and `marqueeSelect` re-implement
`selectableIds`' rule inline. This milestone adds a clause to that rule, so it must be extracted
rather than copied a third time.

- [ ] **Step 1: Write the failing test** — `src/__tests__/reach.test.ts`. Build a document with two
      top-level rects `a`, `b`, a group `g` holding `c` and `d`, and a second, hidden layer. Assert:
      `selectableIds` drops a hidden `a` and a locked `b`; a node inside a hidden group is
      unreachable; with `g` entered, only `c`/`d` are reachable and a hidden `c` drops out; entering
      a **hidden** `g` falls through to the top-level rule rather than returning nothing;
      `hitTest` returns null over a hidden shape and over a locked one; `marqueeSelect` skips both;
      `pruneSelection` drops an id that has just been hidden. Write each as its own `it`.

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Write `reachableNodes` and `blocked`** in `src/doc/tree.ts`:

```ts
/** One node the user may reach right now, with the matrix its geometry sits in. */
export type Reachable = { node: Node; layer: Layer; parent: Mat };

/** True when this node, or anything containing it, is hidden or locked — layer included. */
export function blocked(doc: Doc, id: string): boolean {
  const found = findNode(doc, id);
  if (!found) return true;
  if (!found.layer.visible || found.layer.locked) return true;
  if (isHidden(found.node) || isLocked(found.node)) return true;
  return ancestorIds(doc, id).some((a) => {
    const f = findNode(doc, a);
    return !f || isHidden(f.node) || isLocked(f.node);
  });
}

/** THE reach rule (invariant 37, spec M9 §5): inside a valid entered group, that group's children;
 *  otherwise every top-level node — skipping anything hidden or locked. Document order; callers
 *  wanting z-order walk it backwards. An invalid or blocked entered group falls THROUGH to the
 *  top-level rule, which is what stops the canvas going dead when a group is hidden mid-session. */
export function reachableNodes(doc: Doc, enteredGroupId: string | null = null): Reachable[] {
  if (enteredGroupId !== null) {
    const found = findNode(doc, enteredGroupId);
    if (found && found.node.kind === "group" && !blocked(doc, enteredGroupId)) {
      const parent = multiply(found.parent, found.node.transform);
      return found.node.children
        .filter((n) => !isHidden(n) && !isLocked(n))
        .map((node) => ({ node, layer: found.layer, parent }));
    }
  }
  const out: Reachable[] = [];
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const node of layer.children) {
      if (isHidden(node) || isLocked(node)) continue;
      out.push({ node, layer, parent: IDENTITY });
    }
  }
  return out;
}
```

Import `multiply` and `IDENTITY` from `../geom/mat` if `tree.ts` does not already.

- [ ] **Step 4: Rewire `selectableIds`** to `new Set(reachableNodes(doc, enteredGroupId).map((r) => r.node.id))`,
      keeping its doc comment.

- [ ] **Step 5: Rewire `existingIds`** (the private helper behind `pruneSelection`) to skip a hidden
      or locked node **and its subtree**, so hiding a selected node deselects it:

```ts
  const add = (n: Node) => {
    if (isHidden(n) || isLocked(n)) return;
    out.add(n.id);
    if (n.kind === "group") for (const c of n.children) add(c);
  };
```

- [ ] **Step 6: Rewire `hitTest` and `marqueeSelect`** in `src/geom/hit.ts` onto `reachableNodes`.
      `hitTest` walks the list backwards, computing `inv`/`scale` from each entry's `parent`;
      `marqueeSelect` walks it forwards using `nodeBounds(node, parent)`. Both lose their inline
      entered-group blocks and their layer loops. Keep `Hit`'s shape: `{ layerId, nodeId }`.

- [ ] **Step 7: Skip hidden nodes in `collectTargets`** (`src/geom/snap.ts`) — `if (isHidden(n)) continue;`
      beside the existing layer check. **Locked nodes stay targets**: the file's comment records
      that locked layers are deliberately snappable ("you can align to what you can't edit").

- [ ] **Step 8: Gates and commit** — `npm test && npm run build`, then
      `refactor: one reach rule for selection, hit-testing and the marquee`.

---

### Task 3: The round-trip, and the data-loss fix

**Files:** Modify `src/svg/attrs.ts`, `src/svg/parse.ts`; Test `src/__tests__/hidden-roundtrip.test.ts` (create)

**Interfaces — Consumes:** `isHidden`, `isLocked` (Task 1).

- [ ] **Step 1: Write the failing test** — `src/__tests__/hidden-roundtrip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isHidden, isLocked, type Shape } from "../doc/document";
import { parseSvg } from "../svg/parse";

const kids = (svg: string) => {
  const r = parseSvg(svg);
  return { r, nodes: r.doc.layers.flatMap((l) => l.children) };
};

describe("hidden and locked content survives an import", () => {
  it("keeps every spelling of hidden instead of deleting it", () => {
    const { r, nodes } = kids(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect x="0" y="0" width="10" height="10" fill="#ff0000"/>
      <rect x="20" y="0" width="10" height="10" fill="#00ff00" display="none"/>
      <rect x="40" y="0" width="10" height="10" fill="#0000ff" style="display:none"/>
      <rect x="60" y="0" width="10" height="10" fill="#ffff00" visibility="hidden"/>
    </svg>`);
    expect(nodes).toHaveLength(4);
    expect(nodes.map((n) => isHidden(n))).toEqual([false, true, true, true]);
    expect((nodes[0] as Shape).style.fill?.color).toBe("#ff0000");
    expect(r.dropped).toEqual([]);
  });

  it("keeps a hidden group's children", () => {
    const { nodes } = kids(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <g display="none"><rect x="0" y="0" width="5" height="5" fill="#ff00ff"/></g>
    </svg>`);
    expect(nodes).toHaveLength(1);
    expect(isHidden(nodes[0])).toBe(true);
    expect(nodes[0].kind === "group" && nodes[0].children).toHaveLength(1);
  });

  it("reads both spellings of locked", () => {
    const { nodes } = kids(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="100" height="100">
      <rect x="0" y="0" width="5" height="5" data-sv-locked=""/>
      <rect x="10" y="0" width="5" height="5" sodipodi:insensitive="true"/>
    </svg>`);
    expect(nodes.map((n) => isLocked(n))).toEqual([true, true]);
  });

  it("reports a nested visibility override rather than changing the file silently", () => {
    const { r } = kids(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <g visibility="hidden"><rect x="0" y="0" width="5" height="5" visibility="visible"/></g>
    </svg>`);
    expect(r.dropped).toContain("nested visibility override");
  });
});
```

Add a round-trip case to the existing serializer test file too: a document with a hidden and a
locked node exports, re-imports and matches; and hide-then-show serializes byte-identically to
never having touched it.

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Write the attributes** in `src/svg/attrs.ts`. Find the function that builds a
      node's attributes (the one shared by canvas and export) and add, mirroring lines 113-114's
      layer treatment:

```ts
    ...(isLocked(n) ? { "data-sv-locked": "" } : {}),
    ...(isHidden(n) ? { display: "none" } : {}),
```

- [ ] **Step 4: Read them back** in `src/svg/parse.ts`. Replace the silent drop at the
      `if (p.display === "none") return null;` line: compute `hidden` from
      `p.display === "none" || p.visibility === "hidden"` and carry it onto the node instead of
      returning null. Add `"visibility"` to the property list at line 64 if it is not there. Read
      `locked` from `el.attrs["data-sv-locked"] !== undefined || el.attrs["sodipodi:insensitive"] === "true"`.
      When a node is hidden and any descendant carries `visibility="visible"`, call the existing
      `drop("nested visibility override")`.

      **Do not change the layer branch** (around line 404) — layers already read both flags.

- [ ] **Step 5: Gates and commit** — `fix: keep hidden and locked content instead of deleting it`.

---

### Task 4: The store actions and the panel rows

**Files:** Modify `src/state/appState.svelte.ts`, `src/lib/LayersPanel.svelte`

**Interfaces — Consumes:** `setNodeHidden`, `setNodeLocked`, `isHidden`, `isLocked`.
**Produces:** `toggleNodeVisible(id: string): void`, `toggleNodeLocked(id: string): void`.

- [ ] **Step 1: Add the store actions**, beside the layer ones (`toggleLayerVisible` /
      `toggleLayerLocked` — copy their shape exactly):

```ts
export function toggleNodeVisible(id: string): void {
  cancelActiveGesture();
  const found = findNode(app.doc, id);
  if (!found) return;
  commitDoc(setNodeHidden(app.doc, [id], !isHidden(found.node)));
}

export function toggleNodeLocked(id: string): void {
  cancelActiveGesture();
  const found = findNode(app.doc, id);
  if (!found) return;
  commitDoc(setNodeLocked(app.doc, [id], !isLocked(found.node)));
}
```

- [ ] **Step 2: Add the two buttons to the node row.** In `src/lib/LayersPanel.svelte`'s `nodeRow`
      snippet, mirror the eye/lock buttons the **layer** row already has (same icons, same 20px
      hit target, same `size={14}`). Titles are action phrases and are also status-bar hints:
      `Hide “{rowLabel(node)}”` / `Show “{rowLabel(node)}”`, `Lock “…”` / `Unlock “…”`.

- [ ] **Step 3: Generalise `blocked`.** `nodeRow` already takes a `blocked` parameter and passes it
      to its children. Pass `blocked || isHidden(node) || isLocked(node)` down to the recursive
      `nodeRow` call, so a hidden group greys its whole subtree. The row's own eye and lock
      **must stay live while blocked** — that is the only way back — so exclude them from whatever
      guards the row's other interactions (`if (!blocked)` on select, drag and rename).

- [ ] **Step 4: Widen `blockedTitle`** so it names the responsible node, not just the layer:
      `Layer “X” is hidden` stays for a layer, and a node adds `“Y” is hidden` / `“Y” is locked`.

- [ ] **Step 5: Gates and commit** — `feat: an eye and a lock on every shape and group row`.

---

### Task 5: The documents

**Files:** Modify `CLAUDE.md`, `README.md`, `docs/superpowers/CHANGELOG.md`

- [ ] **Step 1:** Amend **invariant 37** — it says `selectableIds` has callers again but that
      `hitTest`/`marqueeSelect` re-implement its rule inline. That is no longer true: record that
      all three now go through `reachableNodes`, and that a new reach clause belongs there and
      nowhere else.
- [ ] **Step 2:** Add an invariant for the flags: optional, absent = normal, read only through
      `isHidden`/`isLocked`, turning off deletes the key, and a locked node cannot be selected at
      all (the row's buttons are the way back).
- [ ] **Step 3:** Amend **invariant 4** (the importer) to say hidden content is kept, not dropped.
- [ ] **Step 4:** Update the architecture map, the `npm test` count, README's feature list and
      keyboard table if touched, and append a CHANGELOG entry covering the data-loss fix with its
      before/after table.
- [ ] **Step 5: Commit** — `docs: M9 — per-object visibility and lock`.

## Self-review

**Spec coverage.** §3 model → Task 1. §4 round-trip both ways → Task 3. §5 reach, all six call
sites → Task 2 (snap's hidden-only rule is Step 7; `selectFromPanel` comes via the panel's `blocked`
in Task 4). §6 panel → Task 4. §1's data loss → Task 3. §8's unit tests → Tasks 1-3; the browser
pass is the controller's.

**Placeholders.** Task 2 Step 1 describes its assertions rather than spelling out the fixture —
deliberate, because the fixture must match whatever `src/__tests__/` already provides, and Step 1
says to check. Every other code step carries its code.

**Type consistency.** `isHidden`/`isLocked`/`setNodeHidden`/`setNodeLocked` are defined in Task 1 and
used under those names in Tasks 2-4. `reachableNodes`/`blocked`/`Reachable` are defined in Task 2
and used in Task 2 only. `toggleNodeVisible`/`toggleNodeLocked` are defined in Task 4 Step 1 and
used in Step 2.
