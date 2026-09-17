# Milestone 3a — Layers Panel and Z-order — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A current layer that receives new objects, layer and object edits, z-order, and a Layers panel under Properties with rename and drag-to-reorder.

**Architecture:**
- **Pure layer and z-order edits** live in a new `src/doc/layers.ts`.
- **The current layer** is store state. Tools reach it through `ToolContext.currentLayerId()`.
- **Paste** takes the target layer as a parameter.
- **Panel logic** (double tap, drop position) is pure and tested.
- **The panel component** composes those helpers with the existing `IconButton`, `.ui-selected` and `.section-title`.

**Tech Stack:** Svelte 5.55 (runes, `class={[...]}`, `{@attach}`), TypeScript strict, Vite 8, Tailwind 4, Vitest 4 (node env), `@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-09-17-m3a-layers-panel-design.md` (binding). It builds on the M2d and M2e specs and on CLAUDE.md.

## Global Constraints

- **Checks:**
  - `npm run build` must end with **0 errors, 0 warnings** (svelte-check a11y warnings included).
  - `npm run lint` is silent, `npm test` passes, and `npm run format:check` is clean.
  - Run `npx prettier --write` on touched files before committing.
- **Tests:** Vitest has no DOM. Only pure logic gets unit tests. UI tasks are gated by the build and a dev-server compile check (port 5199, never the user's `:5173`), and the controller runs the browser pass.
- **Document edits:**
  - The document is immutable, and an edit that changes nothing returns the **same** reference.
  - No edit leaves zero layers. User-typed names are trimmed and capped at 100 characters.
- **Store actions:** every one that edits the document calls `cancelActiveGesture()` first and commits exactly one undo step (gotcha #15). Every session change goes through `setSession` (gotcha #13).
- **Tools** never import the store; they use `ToolContext` (gotcha #12).
- **UI:** theme tokens only; one class expression per element (`class={[...]}`); state never moves layout; top-bar controls are `IconButton`s with `aria-label`, a `title` and an `aria-disabled` reason (gotcha #24).
- **Blocked-layer messages** (exact): `“{name}” is hidden — show it to draw.`, `“{name}” is locked — unlock it to draw.`, and the same with `to paste.`
- **Existing tests** keep their expected values. The exceptions are the ones this plan rewrites explicitly: the `targetLayerId` assertions, the `NO_LAYER` paste error, and the shape tool's "every layer" refusal text.
- **Dry run:** the controller applied Tasks 1–6 to `main` in a throwaway worktree before execution. Where a step says so, its code was checked there.
- **Commit trailer** on every commit, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Git:** branch `m3a-layers-panel` off `main`, one commit per task.

## File map

```
src/doc/layers.ts                 + resolveLayerId, layerBlock, blockMessage, addLayer, deleteLayer, renameLayer,
                                    setLayerVisible, setLayerLocked, moveLayer, moveNodes, renameNode, rowLabel,
                                    bringForward, sendBackward, bringToFront, sendToBack
src/__tests__/layers.test.ts      + tests
src/doc/tree.ts                   − targetLayerId
src/tools/tool.ts, tools/context.ts, __tests__/fake-context.ts   + currentLayerId
src/tools/shape-tools.ts          draws into the current layer; refuses a blocked one
src/state/clipboard.ts            planPaste(…, layerId); − NO_LAYER
src/state/appState.svelte.ts      + currentLayerId state + layer/z-order/panel actions
src/state/keys.ts, commands.ts    + z-order keys (code BracketLeft/Right)
src/svg/serialize.ts              escapeAttr strips lone surrogates, U+FFFE, U+FFFF
src/lib/TopBar.svelte             + z-order icons
src/lib/ContextMenu.svelte        + z-order items
src/lib/double-tap.ts, layer-drop.ts   + pure panel helpers (+ tests)
src/lib/LayersPanel.svelte        + panel
src/lib/Sidebar.svelte            + Properties + Layers column
src/lib/PropertiesPanel.svelte    sized as the column's top part
src/App.svelte                    uses Sidebar
CLAUDE.md, README.md, docs/superpowers/CHANGELOG.md
```

---

### Task 1: Pure layer and z-order edits

**Files:**
- Create: `src/doc/layers.ts`
- Test: `src/__tests__/layers.test.ts`

**Interfaces:**
- Produces:
  - `type LayerBlock = { name: string; reason: "hidden" | "locked" }`
  - `resolveLayerId(doc, id: string | null): string`
  - `layerBlock(doc, id): LayerBlock | null`
  - `blockMessage(block: LayerBlock, verb: "draw" | "paste"): string`
  - `addLayer(doc, aboveId: string | null): { doc; id }`
  - `deleteLayer(doc, id)`, `renameLayer(doc, id, name)`
  - `setLayerVisible(doc, id, visible)`, `setLayerLocked(doc, id, locked)`
  - `moveLayer(doc, id, toIndex)`, `moveNodes(doc, ids, layerId, index)`
  - `renameNode(doc, id, name)`, `rowLabel(node): string`
  - `bringForward`, `sendBackward`, `bringToFront`, `sendToBack` — all `(doc, ids) => Doc`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/meigo/Projects/slop/slop-vector-editor
git checkout -b m3a-layers-panel
```

- [ ] **Step 2: Write the failing test** — `src/__tests__/layers.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Layer, type Node } from "../doc/document";
import {
  addLayer,
  blockMessage,
  bringForward,
  bringToFront,
  deleteLayer,
  layerBlock,
  moveLayer,
  moveNodes,
  renameLayer,
  renameNode,
  resolveLayerId,
  rowLabel,
  sendBackward,
  sendToBack,
  setLayerLocked,
  setLayerVisible,
} from "../doc/layers";
import { IDENTITY } from "../geom/mat";
import { deepFreeze } from "./helpers";

const rect = (id: string): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rx: 0,
});
const layer = (id: string, childIds: string[], over: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  children: childIds.map(rect),
  ...over,
});
const doc = (...layers: Layer[]): Doc => deepFreeze({ ...createDoc(100, 100), nextId: 20, layers });
const ids = (d: Doc, i: number) => d.layers[i].children.map((n) => n.id);
const layerIds = (d: Doc) => d.layers.map((l) => l.id);

describe("current layer helpers", () => {
  it("resolves to an existing layer or the top-most one", () => {
    const d = doc(layer("A", []), layer("B", []));
    expect(resolveLayerId(d, "A")).toBe("A");
    expect(resolveLayerId(d, "gone")).toBe("B");
    expect(resolveLayerId(d, null)).toBe("B");
  });

  it("reports why a layer can't take new objects", () => {
    const d = doc(
      layer("A", []),
      layer("H", [], { name: "Sketch", visible: false, locked: true }),
      layer("K", [], { locked: true }),
    );
    expect(layerBlock(d, "A")).toBeNull();
    expect(layerBlock(d, "H")).toEqual({ name: "Sketch", reason: "hidden" });
    expect(layerBlock(d, "K")).toEqual({ name: "K", reason: "locked" });
    expect(blockMessage({ name: "Sketch", reason: "hidden" }, "draw")).toBe(
      "“Sketch” is hidden — show it to draw.",
    );
    expect(blockMessage({ name: "K", reason: "locked" }, "paste")).toBe(
      "“K” is locked — unlock it to paste.",
    );
  });
});

describe("layer edits", () => {
  it("adds a numbered layer above another, or on top", () => {
    const d = doc(
      layer("A", [], { name: "Layer 1" }),
      layer("B", [], { name: "Layer 7" }),
      layer("C", [], { name: "Ink" }),
    );
    const r = addLayer(d, "A");
    expect(r.id).toBe("n20");
    expect(layerIds(r.doc)).toEqual(["A", "n20", "B", "C"]);
    expect(r.doc.layers[1]).toEqual({
      id: "n20",
      name: "Layer 8",
      visible: true,
      locked: false,
      children: [],
    });
    expect(r.doc.nextId).toBe(21);
    expect(layerIds(addLayer(d, null).doc)).toEqual(["A", "B", "C", "n20"]);
    expect(layerIds(addLayer(d, "zz").doc)).toEqual(["A", "B", "C", "n20"]);
    expect(addLayer(doc(layer("X", [], { name: "Ink" })), null).doc.layers[1].name).toBe("Layer 1");
  });

  it("deletes a layer but never the last one", () => {
    const d = doc(layer("A", ["a"]), layer("B", []));
    expect(layerIds(deleteLayer(d, "A"))).toEqual(["B"]);
    expect(deleteLayer(d, "zz")).toBe(d);
    const one = doc(layer("A", []));
    expect(deleteLayer(one, "A")).toBe(one);
  });

  it("renames with trimming and a length cap", () => {
    const d = doc(layer("A", []));
    expect(renameLayer(d, "A", "  Ink  ").layers[0].name).toBe("Ink");
    expect(renameLayer(d, "A", "x".repeat(150)).layers[0].name).toHaveLength(100);
    expect(renameLayer(d, "A", "   ")).toBe(d);
    expect(renameLayer(d, "A", "A")).toBe(d);
    expect(renameLayer(d, "zz", "Ink")).toBe(d);
  });

  it("shows, hides, locks and unlocks", () => {
    const d = doc(layer("A", []));
    expect(setLayerVisible(d, "A", false).layers[0].visible).toBe(false);
    expect(setLayerVisible(d, "A", true)).toBe(d);
    expect(setLayerLocked(d, "A", true).layers[0].locked).toBe(true);
    expect(setLayerLocked(d, "A", false)).toBe(d);
    expect(setLayerLocked(d, "zz", true)).toBe(d);
  });

  it("moves a layer to a clamped index", () => {
    const d = doc(layer("A", []), layer("B", []), layer("C", []));
    expect(layerIds(moveLayer(d, "A", 2))).toEqual(["B", "C", "A"]);
    expect(layerIds(moveLayer(d, "C", -5))).toEqual(["C", "A", "B"]);
    expect(moveLayer(d, "B", 1)).toBe(d);
    expect(moveLayer(d, "zz", 0)).toBe(d);
  });
});

describe("moving and naming objects", () => {
  it("moves nodes within and between layers, keeping document order", () => {
    const d = doc(layer("A", ["a1", "a2", "a3"]), layer("B", ["b1", "b2"]));
    expect(ids(moveNodes(d, ["a1"], "A", 2), 0)).toEqual(["a2", "a3", "a1"]);
    const across = moveNodes(d, ["b2", "a1", "a3"], "B", 1);
    expect(ids(across, 0)).toEqual(["a2"]);
    expect(ids(across, 1)).toEqual(["b1", "a1", "a3", "b2"]);
    expect(ids(moveNodes(d, ["a1"], "B", 99), 1)).toEqual(["b1", "b2", "a1"]);
    expect(moveNodes(d, ["a2"], "A", 1)).toBe(d);
    expect(moveNodes(d, ["zz"], "B", 0)).toBe(d);
    expect(moveNodes(d, ["a1"], "zz", 0)).toBe(d);
  });

  it("renames objects and falls back to the default label", () => {
    const d = doc(layer("A", ["a"]));
    const named = renameNode(d, "a", "  Logo ");
    expect(named.layers[0].children[0].name).toBe("Logo");
    expect(rowLabel(named.layers[0].children[0])).toBe("Logo");
    const cleared = renameNode(named, "a", "");
    expect("name" in cleared.layers[0].children[0]).toBe(false);
    expect(rowLabel(cleared.layers[0].children[0])).toBe("Rectangle");
    expect(renameNode(d, "a", "")).toBe(d);
    expect(renameNode(named, "a", "Logo")).toBe(named);
  });

  it("labels every kind", () => {
    const base = { id: "x", transform: IDENTITY, style: DEFAULT_STYLE };
    expect(rowLabel({ ...base, kind: "ellipse", cx: 0, cy: 0, rx: 1, ry: 1 })).toBe("Ellipse");
    const poly = {
      ...base,
      kind: "polygon" as const,
      cx: 0,
      cy: 0,
      rx: 1,
      ry: 1,
      sides: 5,
      innerRatio: 0.5,
    };
    expect(rowLabel({ ...poly, star: false })).toBe("Polygon");
    expect(rowLabel({ ...poly, star: true })).toBe("Star");
    expect(rowLabel({ ...base, kind: "path", subpaths: [] })).toBe("Path");
    expect(
      rowLabel({ kind: "group", id: "g", transform: IDENTITY, opacity: 1, children: [] }),
    ).toBe("Group");
  });
});

describe("z-order", () => {
  const d = doc(layer("A", ["a", "s1", "s2", "b"]), layer("B", ["c", "t"]));

  it("brings forward one step, moving a block together", () => {
    expect(ids(bringForward(d, ["s1", "s2"]), 0)).toEqual(["a", "b", "s1", "s2"]);
    expect(ids(bringForward(d, ["a", "s2"]), 0)).toEqual(["s1", "a", "b", "s2"]);
  });

  it("sends backward one step", () => {
    expect(ids(sendBackward(d, ["s1", "s2"]), 0)).toEqual(["s1", "s2", "a", "b"]);
    expect(ids(sendBackward(d, ["b"]), 0)).toEqual(["a", "s1", "b", "s2"]);
  });

  it("brings to front and sends to back, keeping relative order", () => {
    expect(ids(bringToFront(d, ["a", "s1"]), 0)).toEqual(["s2", "b", "a", "s1"]);
    expect(ids(sendToBack(d, ["b", "s2"]), 0)).toEqual(["s2", "b", "a", "s1"]);
  });

  it("works per layer and returns the same document when nothing moves", () => {
    const r = bringForward(d, ["a", "c"]);
    expect(ids(r, 0)).toEqual(["s1", "a", "s2", "b"]);
    expect(ids(r, 1)).toEqual(["t", "c"]);
    expect(bringForward(d, ["b"])).toBe(d);
    expect(bringToFront(d, ["t"])).toBe(d);
    expect(sendBackward(d, ["a"])).toBe(d);
    expect(sendToBack(d, ["c"])).toBe(d);
    expect(bringForward(d, [])).toBe(d);
  });
});
```

Hand-checks. Children are listed bottom to top.
- **Forward, {s1, s2} in [a, s1, s2, b]:**
  - At i=2, s2 swaps with b, giving [a, s1, b, s2].
  - At i=1, s1 swaps with b, giving [a, b, s1, s2].
- **Forward, {a, s2}:**
  - At i=2, s2 swaps with b, giving [a, s1, b, s2].
  - At i=0, a swaps with s1, giving [s1, a, b, s2].
- **Backward, {b}:** at i=3, b swaps with s2, giving [a, s1, b, s2].
- **Move across layers, (b2, a1, a3) → B at index 1:**
  - The moving nodes in document order are a1, a3, b2.
  - B after removal is [b1]; inserting at 1 gives [b1, a1, a3, b2].

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/__tests__/layers.test.ts`
Expected: FAIL — cannot resolve `../doc/layers`.

- [ ] **Step 4: Implement** — `src/doc/layers.ts`

```ts
import { idFor, type Doc, type Layer, type Node } from "./document";
import { mapTopLevel } from "./tree";

/** Spec (M3a) §2–§3: pure layer, naming and z-order edits. Every edit returns the same document
 *  when nothing changes, and none leaves the document without a layer. */

const MAX_NAME = 100;

/** A user-typed name, trimmed and capped; null when nothing is left. */
function cleanName(name: string): string | null {
  const t = name.trim().slice(0, MAX_NAME);
  return t === "" ? null : t;
}

export function resolveLayerId(doc: Doc, id: string | null): string {
  if (id !== null && doc.layers.some((l) => l.id === id)) return id;
  return doc.layers[doc.layers.length - 1].id;
}

export type LayerBlock = { name: string; reason: "hidden" | "locked" };

/** Why new objects can't go into a layer (hidden wins over locked); null when they can. */
export function layerBlock(doc: Doc, id: string): LayerBlock | null {
  const l = doc.layers.find((x) => x.id === id);
  if (!l) return null;
  if (!l.visible) return { name: l.name, reason: "hidden" };
  if (l.locked) return { name: l.name, reason: "locked" };
  return null;
}

export function blockMessage(block: LayerBlock, verb: "draw" | "paste"): string {
  const fix = block.reason === "hidden" ? "show it" : "unlock it";
  return `“${block.name}” is ${block.reason} — ${fix} to ${verb}.`;
}

function replaceLayer(doc: Doc, id: string, fn: (l: Layer) => Layer): Doc {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return doc;
  const next = fn(doc.layers[i]);
  if (next === doc.layers[i]) return doc;
  const layers = doc.layers.slice();
  layers[i] = next;
  return { ...doc, layers };
}

export function addLayer(doc: Doc, aboveId: string | null): { doc: Doc; id: string } {
  let highest = 0;
  for (const l of doc.layers) {
    const m = /^Layer (\d+)$/.exec(l.name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  const id = idFor(doc.nextId);
  const layer: Layer = {
    id,
    name: `Layer ${highest + 1}`,
    visible: true,
    locked: false,
    children: [],
  };
  const at = aboveId === null ? -1 : doc.layers.findIndex((l) => l.id === aboveId);
  const layers = doc.layers.slice();
  layers.splice(at < 0 ? layers.length : at + 1, 0, layer);
  return { doc: { ...doc, layers, nextId: doc.nextId + 1 }, id };
}

export function deleteLayer(doc: Doc, id: string): Doc {
  if (doc.layers.length <= 1 || !doc.layers.some((l) => l.id === id)) return doc;
  return { ...doc, layers: doc.layers.filter((l) => l.id !== id) };
}

export function renameLayer(doc: Doc, id: string, name: string): Doc {
  const clean = cleanName(name);
  if (clean === null) return doc;
  return replaceLayer(doc, id, (l) => (l.name === clean ? l : { ...l, name: clean }));
}

export function setLayerVisible(doc: Doc, id: string, visible: boolean): Doc {
  return replaceLayer(doc, id, (l) => (l.visible === visible ? l : { ...l, visible }));
}

export function setLayerLocked(doc: Doc, id: string, locked: boolean): Doc {
  return replaceLayer(doc, id, (l) => (l.locked === locked ? l : { ...l, locked }));
}

/** `toIndex` is the layer's index in the result (0 = bottom), clamped. */
export function moveLayer(doc: Doc, id: string, toIndex: number): Doc {
  const from = doc.layers.findIndex((l) => l.id === id);
  if (from < 0 || !Number.isFinite(toIndex)) return doc;
  const to = Math.max(0, Math.min(doc.layers.length - 1, Math.round(toIndex)));
  if (to === from) return doc;
  const layers = doc.layers.slice();
  const [moved] = layers.splice(from, 1);
  layers.splice(to, 0, moved);
  return { ...doc, layers };
}

/** Moves top-level nodes (kept in document order) into `layerId` at `index`, counted among the
 *  target's children after the moved nodes are taken out (0 = bottom), clamped. */
export function moveNodes(doc: Doc, ids: readonly string[], layerId: string, index: number): Doc {
  const target = doc.layers.findIndex((l) => l.id === layerId);
  if (target < 0 || !Number.isFinite(index)) return doc;
  const set = new Set(ids);
  const moving: Node[] = [];
  const stripped = doc.layers.map((l) => {
    if (!l.children.some((n) => set.has(n.id))) return l;
    const kept: Node[] = [];
    for (const n of l.children) (set.has(n.id) ? moving : kept).push(n);
    return { ...l, children: kept };
  });
  if (moving.length === 0) return doc;
  const t = stripped[target];
  const at = Math.max(0, Math.min(t.children.length, Math.round(index)));
  const layers = stripped.slice();
  layers[target] = {
    ...t,
    children: [...t.children.slice(0, at), ...moving, ...t.children.slice(at)],
  };
  const unchanged = layers.every(
    (l, i) =>
      l.children.length === doc.layers[i].children.length &&
      l.children.every((n, j) => n === doc.layers[i].children[j]),
  );
  return unchanged ? doc : { ...doc, layers };
}

/** An empty name removes it, so the row falls back to its default label. */
export function renameNode(doc: Doc, id: string, name: string): Doc {
  const clean = cleanName(name);
  return mapTopLevel(doc, [id], (n) => {
    if ((n.name ?? null) === clean) return n;
    if (clean !== null) return { ...n, name: clean };
    const copy: Node = { ...n };
    delete copy.name;
    return copy;
  });
}

export function rowLabel(node: Node): string {
  if (node.name) return node.name;
  switch (node.kind) {
    case "rect":
      return "Rectangle";
    case "ellipse":
      return "Ellipse";
    case "polygon":
      return node.star ? "Star" : "Polygon";
    case "path":
      return "Path";
    case "group":
      return "Group";
  }
}

/** Reorders each layer holding a selected node; layers without one are untouched. */
function reorder(
  doc: Doc,
  ids: readonly string[],
  fn: (children: Node[], selected: (n: Node) => boolean) => Node[],
): Doc {
  const set = new Set(ids);
  const selected = (n: Node) => set.has(n.id);
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (!l.children.some(selected)) return l;
    const next = fn(l.children, selected);
    if (next.every((n, i) => n === l.children[i])) return l;
    changed = true;
    return { ...l, children: next };
  });
  return changed ? { ...doc, layers } : doc;
}

function swap(list: Node[], i: number, j: number): void {
  [list[i], list[j]] = [list[j], list[i]];
}

/** Each selected node moves one step up, past the next unselected sibling; working top-down
 *  moves a contiguous block together. */
export function bringForward(doc: Doc, ids: readonly string[]): Doc {
  return reorder(doc, ids, (children, selected) => {
    const out = children.slice();
    for (let i = out.length - 2; i >= 0; i--) {
      if (selected(out[i]) && !selected(out[i + 1])) swap(out, i, i + 1);
    }
    return out;
  });
}

export function sendBackward(doc: Doc, ids: readonly string[]): Doc {
  return reorder(doc, ids, (children, selected) => {
    const out = children.slice();
    for (let i = 1; i < out.length; i++) {
      if (selected(out[i]) && !selected(out[i - 1])) swap(out, i, i - 1);
    }
    return out;
  });
}

export function bringToFront(doc: Doc, ids: readonly string[]): Doc {
  return reorder(doc, ids, (children, selected) => [
    ...children.filter((n) => !selected(n)),
    ...children.filter(selected),
  ]);
}

export function sendToBack(doc: Doc, ids: readonly string[]): Doc {
  return reorder(doc, ids, (children, selected) => [
    ...children.filter(selected),
    ...children.filter((n) => !selected(n)),
  ]);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/layers.test.ts`, then `npm test` (expected 295), `npx tsc --noEmit`, `npm run lint`, `npm run format:check`.

- [ ] **Step 6: Commit**

```bash
git add src/doc/layers.ts src/__tests__/layers.test.ts
git commit -m "feat(doc): layer, naming and z-order edits

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The current layer

**Files:**
- Modify:
  - `src/tools/tool.ts`, `src/tools/context.ts`, `src/__tests__/fake-context.ts`
  - `src/tools/shape-tools.ts`
  - `src/state/clipboard.ts`
  - `src/state/appState.svelte.ts`
  - `src/doc/tree.ts`
- Test: `src/__tests__/shape-tools.test.ts`, `src/__tests__/clipboard.test.ts`, `src/__tests__/tree-edits.test.ts` (edited)

**Interfaces:**
- Consumes: `resolveLayerId`, `layerBlock`, `blockMessage` (Task 1).
- Produces:
  - `ToolContext.currentLayerId(): string`
  - `FakeState.currentLayerId: string`
  - `planPaste(doc, text, clip, view, layerId: string)`
  - store:
    - `app.currentLayerId: string` (resolved on every session change, set from the last selected id, reset by `replaceDocument`)
    - `setCurrentLayer(id: string): void`
  - `targetLayerId` and `NO_LAYER` are removed.

- [ ] **Step 1: Update the tests**

`src/__tests__/shape-tools.test.ts` — replace the whole test `it("refuses to draw when every layer is locked or hidden", …)` with:

```ts
  it("refuses to draw on a hidden or locked current layer", () => {
    const d = blank();
    const locked: Doc = { ...d, layers: [{ ...d.layers[0], locked: true }] };
    const l = fakeContext(locked);
    drag(createRectTool(), l.ctx, [0, 0], [10, 10]);
    expect(children(l.state.session.doc)).toHaveLength(0);
    expect(l.state.notices).toEqual(["“Layer 1” is locked — unlock it to draw."]);
    const hidden: Doc = { ...d, layers: [{ ...d.layers[0], visible: false }] };
    const h = fakeContext(hidden);
    drag(createRectTool(), h.ctx, [0, 0], [10, 10]);
    expect(h.state.notices).toEqual(["“Layer 1” is hidden — show it to draw."]);
  });

  it("draws into the current layer", () => {
    const d = blank();
    const two: Doc = { ...d, layers: [d.layers[0], { ...d.layers[0], id: "top", name: "Top" }] };
    const { ctx, state } = fakeContext(two);
    expect(state.currentLayerId).toBe("top");
    state.currentLayerId = d.layers[0].id;
    drag(createRectTool(), ctx, [0, 0], [10, 10]);
    expect(state.session.doc.layers[0].children).toHaveLength(1);
    expect(state.session.doc.layers[1].children).toHaveLength(0);
  });
```

`src/__tests__/clipboard.test.ts`:
- Remove `NO_LAYER,` from the `../state/clipboard` import.
- Add `"L0"` as a fifth argument to every existing `planPaste(…)` call. Every document in this file names its first layer `L0`.
- Replace `it("pastes into the top-most visible unlocked layer", …)` with:

```ts
  it("pastes into the given layer and refuses blocked ones", () => {
    const d = doc([
      { children: [] },
      { children: [] },
      { children: [], locked: true, name: "Ink" },
      { children: [], visible: false, name: "Sketch" },
    ]);
    const r = plan(planPaste(d, text, null, view, "L0"));
    expect(r.doc.layers[0].children.map((n) => n.id)).toEqual(r.ids);
    expect(r.doc.layers[1].children).toHaveLength(0);
    expect(planPaste(d, text, null, view, "L2")).toEqual({
      error: "“Ink” is locked — unlock it to paste.",
    });
    expect(planPaste(d, text, null, view, "L3")).toEqual({
      error: "“Sketch” is hidden — show it to paste.",
    });
  });
```

- In `it("reports errors without changing anything", …)`, delete the two lines that build `locked` and expect `NO_LAYER`.

`src/__tests__/tree-edits.test.ts`:
- Remove `targetLayerId,` from the `../doc/tree` import.
- In `it("lists selectable ids and the target layer", …)`:
  - rename the test to `it("lists selectable ids", …)`;
  - delete its three `targetLayerId` expectations.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/shape-tools.test.ts src/__tests__/clipboard.test.ts`
Expected: FAIL. The new messages and `state.currentLayerId` are missing, and `planPaste` ignores its layer.

- [ ] **Step 3: Implement**

`src/tools/tool.ts` — in `ToolContext`, after `selection(): readonly string[];`, add:

```ts
  /** The layer new objects go into (spec M3a §2); tools check `layerBlock` before using it. */
  currentLayerId(): string;
```

`src/tools/context.ts` — add `currentLayerId: () => app.currentLayerId,` after `selection`.

`src/__tests__/fake-context.ts`:
- Add `import { resolveLayerId } from "../doc/layers";`.
- Add `currentLayerId: string;` to `FakeState`.
- Initialise it in `state` with `currentLayerId: resolveLayerId(doc, null),`.
- Add `currentLayerId: () => state.currentLayerId,` to `ctx`, after `selection`.

`src/tools/shape-tools.ts`:
- Replace `import { targetLayerId } from "../doc/tree";` with `import { blockMessage, layerBlock } from "../doc/layers";`.
- In `createDragTool`'s `down`, replace

```ts
      const layerId = targetLayerId(doc);
      if (!layerId) {
        ctx.notify("info", "Every layer is hidden or locked — there is nowhere to draw.");
        return;
      }
```

with

```ts
      const layerId = ctx.currentLayerId();
      const block = layerBlock(doc, layerId);
      if (block) {
        ctx.notify("info", blockMessage(block, "draw"));
        return;
      }
```

`src/state/clipboard.ts`:
- Replace `import { targetLayerId } from "../doc/tree";` with `import { blockMessage, layerBlock } from "../doc/layers";`.
- Delete the `NO_LAYER` constant.
- Replace the doc comment and the (multi-line) signature with:

```ts
/** Spec (M2b) §2.3, M3a §2. `view` is the visible canvas area in document coordinates; `layerId`
 *  is the current layer, which receives the pasted nodes. */
export function planPaste(
  doc: Doc,
  text: string,
  clip: Clip | null,
  view: Box,
  layerId: string,
): PastePlan | PasteError {
```
- Replace

```ts
  const layerId = targetLayerId(doc);
  if (!layerId) return { error: NO_LAYER };
```

with

```ts
  const block = layerBlock(doc, layerId);
  if (block) return { error: blockMessage(block, "paste") };
```

`src/doc/tree.ts`: delete `targetLayerId` and its doc comment.

`src/state/appState.svelte.ts`:
- Imports:
  - add `import { resolveLayerId } from "../doc/layers";`;
  - change the tree import to `import { findTopLevel, pruneSelection } from "../doc/tree";`.
- In `AppState`, right after the `session = …` field, add:

```ts
  /** Where new objects go (spec M3a §2). Not saved, not undoable. */
  currentLayerId = $state<string>(resolveLayerId(this.session.doc, null));
```

- In `setSession`, after the selection pruning, add:

```ts
  const current = resolveLayerId(s.doc, app.currentLayerId);
  if (current !== app.currentLayerId) app.currentLayerId = current;
```

- Replace `setSelection` with:

```ts
export function setSelection(ids: readonly string[]): void {
  app.selection = pruneSelection(app.doc, ids);
  // The layer of the last selected object becomes current (spec M3a §2).
  const last = app.selection[app.selection.length - 1];
  const found = last === undefined ? null : findTopLevel(app.doc, last);
  if (found && found.layer.id !== app.currentLayerId) app.currentLayerId = found.layer.id;
}

export function setCurrentLayer(id: string): void {
  app.currentLayerId = resolveLayerId(app.doc, id);
}
```

- In `replaceDocument`, right after `setSession(newSession(doc, saved));`, add `app.currentLayerId = resolveLayerId(doc, null);`.
- In `pasteText`, change the call to `planPaste(app.doc, text, clip, visibleDocBox(), app.currentLayerId)`.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/__tests__/shape-tools.test.ts src/__tests__/clipboard.test.ts src/__tests__/tree-edits.test.ts`, then `npm test` (expected 296), `npm run build` (0 / 0), `npm run lint`, `npm run format:check`, and

```bash
grep -rn "targetLayerId\|NO_LAYER" src
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool.ts src/tools/context.ts src/__tests__/fake-context.ts src/tools/shape-tools.ts src/state/clipboard.ts src/state/appState.svelte.ts src/doc/tree.ts src/__tests__/shape-tools.test.ts src/__tests__/clipboard.test.ts src/__tests__/tree-edits.test.ts
git commit -m "feat: a current layer receives new shapes and pastes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Store actions, z-order keys, name sanitising

**Files:**
- Modify: `src/state/appState.svelte.ts`, `src/state/keys.ts`, `src/state/commands.ts`, `src/svg/serialize.ts`
- Test: `src/__tests__/prefs-route-keys.test.ts`, `src/__tests__/serialize.test.ts` (extended)

**Interfaces:**
- Consumes: all Task 1 edits, plus `setSelection` and `askConfirm`.
- Produces:
  - store actions:
    - `addLayerAboveCurrent()`, `deleteCurrentLayer(): Promise<void>`
    - `renameLayerById(id, name)`, `toggleLayerVisible(id)`, `toggleLayerLocked(id)`, `moveLayerTo(id, index)`
    - `moveNodesTo(ids, layerId, index)`, `renameNodeById(id, name)`
    - `selectFromPanel(id, additive)`
    - `bringSelectionForward()`, `sendSelectionBackward()`, `bringSelectionToFront()`, `sendSelectionToBack()`
  - `KeyLike.code?: string`
  - `type ZOrderOp = "forward" | "backward" | "front" | "back"`
  - `EditAction` gains `{ kind: "zorder"; op: ZOrderOp }`

- [ ] **Step 1: Write the failing tests**

`src/__tests__/prefs-route-keys.test.ts`: in `describe("editActionForKey")`, widen the helper's `mods` type to `Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; code: string }>`. Then add:

```ts
  it("maps bracket keys with a modifier to z-order", () => {
    expect(k("]", { metaKey: true, code: "BracketRight" })).toEqual({ kind: "zorder", op: "forward" });
    expect(k("}", { metaKey: true, shiftKey: true, code: "BracketRight" })).toEqual({
      kind: "zorder",
      op: "front",
    });
    expect(k("[", { ctrlKey: true, code: "BracketLeft" })).toEqual({ kind: "zorder", op: "backward" });
    expect(k("{", { ctrlKey: true, shiftKey: true, code: "BracketLeft" })).toEqual({
      kind: "zorder",
      op: "back",
    });
    expect(k("]", { code: "BracketRight" })).toBeNull();
    expect(k("x", { metaKey: true, code: "KeyX" })).toBeNull();
  });
```

`src/__tests__/serialize.test.ts` — append:

```ts
describe("name sanitising", () => {
  it("drops code points XML forbids from names", () => {
    const d = createDoc(10, 10);
    const bad: Doc = {
      ...d,
      layers: [{ ...d.layers[0], name: "A\uFFFEB\uFFFF\uD800C\uDC00D\uD83D\uDE00" }],
    };
    expect(serializeDoc(bad)).toContain('data-sv-name="ABCD\uD83D\uDE00"');
  });
});
```

The lone high surrogate (before C) and the lone low surrogate (after C) are dropped. The valid pair `\uD83D\uDE00` (an emoji) is kept.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/prefs-route-keys.test.ts src/__tests__/serialize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/svg/serialize.ts` — at the end of the `escapeAttr` chain, after the C0-control `.replace`, add:

```ts
    // …and the other code points XML forbids: U+FFFE/U+FFFF and unpaired surrogates.
    .replace(/[\uFFFE\uFFFF]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
```

Move the chain's terminating semicolon to the new last line.

`src/state/keys.ts`:
- `export type KeyLike = { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean };`
- Add `export type ZOrderOp = "forward" | "backward" | "front" | "back";` and the `EditAction` member `| { kind: "zorder"; op: ZOrderOp }`.
- In `editActionForKey`, replace `if (e.metaKey || e.ctrlKey) return k === "d" ? { kind: "duplicate" } : null;` with:

```ts
  if (e.metaKey || e.ctrlKey) {
    if (k === "d") return { kind: "duplicate" };
    // By physical key: Shift turns "]" into "}" on many layouts.
    if (e.code === "BracketRight") return { kind: "zorder", op: e.shiftKey ? "front" : "forward" };
    if (e.code === "BracketLeft") return { kind: "zorder", op: e.shiftKey ? "back" : "backward" };
    return null;
  }
```

`src/state/appState.svelte.ts`:
- Add the imports:

```ts
import {
  addLayer,
  bringForward,
  bringToFront,
  deleteLayer,
  moveLayer,
  moveNodes,
  renameLayer,
  renameNode,
  resolveLayerId,
  sendBackward,
  sendToBack,
  setLayerLocked,
  setLayerVisible,
} from "../doc/layers";
```

  This replaces the Task 2 single-name import.
- Append at the end of the file:

```ts
// ----- layers, objects and z-order (spec M3a §4) -----

export function addLayerAboveCurrent(): void {
  cancelActiveGesture();
  const r = addLayer(app.doc, app.currentLayerId);
  commitDoc(r.doc);
  app.currentLayerId = r.id;
}

export async function deleteCurrentLayer(): Promise<void> {
  cancelActiveGesture();
  const layer = app.doc.layers.find((l) => l.id === app.currentLayerId);
  if (!layer || app.doc.layers.length <= 1) return;
  const n = layer.children.length;
  if (n > 0) {
    const what = `${n} ${n === 1 ? "object" : "objects"}`;
    if (!(await askConfirm(`Delete layer “${layer.name}” and its ${what}?`, "Delete"))) return;
  }
  cancelActiveGesture();
  commitDoc(deleteLayer(app.doc, layer.id));
}

export function renameLayerById(id: string, name: string): void {
  cancelActiveGesture();
  commitDoc(renameLayer(app.doc, id, name));
}

export function toggleLayerVisible(id: string): void {
  cancelActiveGesture();
  const layer = app.doc.layers.find((l) => l.id === id);
  if (layer) commitDoc(setLayerVisible(app.doc, id, !layer.visible));
}

export function toggleLayerLocked(id: string): void {
  cancelActiveGesture();
  const layer = app.doc.layers.find((l) => l.id === id);
  if (layer) commitDoc(setLayerLocked(app.doc, id, !layer.locked));
}

export function moveLayerTo(id: string, index: number): void {
  cancelActiveGesture();
  commitDoc(moveLayer(app.doc, id, index));
}

/** The moved objects become the selection (and so their new layer becomes current). */
export function moveNodesTo(ids: readonly string[], layerId: string, index: number): void {
  cancelActiveGesture();
  commitDoc(moveNodes(app.doc, ids, layerId, index));
  setSelection(ids);
}

export function renameNodeById(id: string, name: string): void {
  cancelActiveGesture();
  commitDoc(renameNode(app.doc, id, name));
}

/** A panel row tap: replace the selection, or toggle the row in it. */
export function selectFromPanel(id: string, additive: boolean): void {
  cancelActiveGesture();
  if (!additive) {
    setSelection([id]);
    return;
  }
  setSelection(
    app.selection.includes(id) ? app.selection.filter((s) => s !== id) : [...app.selection, id],
  );
}

export function bringSelectionForward(): void {
  cancelActiveGesture();
  commitDoc(bringForward(app.doc, app.selection));
}

export function sendSelectionBackward(): void {
  cancelActiveGesture();
  commitDoc(sendBackward(app.doc, app.selection));
}

export function bringSelectionToFront(): void {
  cancelActiveGesture();
  commitDoc(bringToFront(app.doc, app.selection));
}

export function sendSelectionToBack(): void {
  cancelActiveGesture();
  commitDoc(sendToBack(app.doc, app.selection));
}
```

`src/state/commands.ts`:
- Add `bringSelectionForward`, `bringSelectionToFront`, `sendSelectionBackward`, `sendSelectionToBack` to the store import.
- In `runEditAction`, add:

```ts
    case "zorder":
      switch (a.op) {
        case "forward":
          return bringSelectionForward();
        case "backward":
          return sendSelectionBackward();
        case "front":
          return bringSelectionToFront();
        case "back":
          return sendSelectionToBack();
      }
```

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test` (expected 298), `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add src/state/appState.svelte.ts src/state/keys.ts src/state/commands.ts src/svg/serialize.ts src/__tests__/prefs-route-keys.test.ts src/__tests__/serialize.test.ts
git commit -m "feat: layer and z-order store actions, bracket shortcuts, safe names

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Z-order in the top bar and the context menu

**Files:**
- Modify: `src/lib/TopBar.svelte`, `src/lib/ContextMenu.svelte`

**Interfaces:**
- Consumes: the four z-order store actions (Task 3), `IconButton`, `mod`/`shiftMod` in TopBar.
- Produces: UI only.

- [ ] **Step 1: Top bar**

In `src/lib/TopBar.svelte`:
- Add `ArrowDown`, `ArrowUp`, `BringToFront`, `SendToBack` to the lucide import.
- Add `bringSelectionForward`, `bringSelectionToFront`, `sendSelectionBackward`, `sendSelectionToBack` to the store import.
- Right after the Delete `IconButton` (the one with `onclick={deleteSelection}`), insert:

```svelte
  <span class="bar-sep"></span>
  <IconButton
    label="Bring to front"
    title="Bring to front ({shiftMod}])"
    icon={BringToFront}
    disabled={none}
    disabledTitle="Bring to front — nothing selected"
    onclick={bringSelectionToFront}
  />
  <IconButton
    label="Bring forward"
    title="Bring forward ({mod}])"
    icon={ArrowUp}
    disabled={none}
    disabledTitle="Bring forward — nothing selected"
    onclick={bringSelectionForward}
  />
  <IconButton
    label="Send backward"
    title="Send backward ({mod}[)"
    icon={ArrowDown}
    disabled={none}
    disabledTitle="Send backward — nothing selected"
    onclick={sendSelectionBackward}
  />
  <IconButton
    label="Send to back"
    title="Send to back ({shiftMod}[)"
    icon={SendToBack}
    disabled={none}
    disabledTitle="Send to back — nothing selected"
    onclick={sendSelectionToBack}
  />
```

- [ ] **Step 2: Context menu**

In `src/lib/ContextMenu.svelte`:
- Add the same four store actions to its store import.
- Inside the second `{#if app.selection.length > 0}` block, right after the `{#if actions.canFlatten}…{/if}` block and before the separator that precedes Delete, insert:

```svelte
      <div class="my-1 h-px bg-line"></div>
      <button class="menu-item" role="menuitem" onclick={() => run(bringSelectionToFront)}>
        Bring to front <span class="kbd">⇧⌘]</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => run(bringSelectionForward)}>
        Bring forward <span class="kbd">⌘]</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => run(sendSelectionBackward)}>
        Send backward <span class="kbd">⌘[</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => run(sendSelectionToBack)}>
        Send to back <span class="kbd">⇧⌘[</span>
      </button>
```

- [ ] **Step 3: Verify**

Run: `npm run build` (0 / 0), `npm run lint`, `npm run format:check`, `npm test` (298).

Then compile-check on port 5199:

```bash
(npx vite --port 5199 --strictPort > "$TMPDIR/sv-5199.log" 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}" http://localhost:5199/ | grep -q 200 && break; perl -e 'select(undef,undef,undef,0.5)'; done
for f in lib/TopBar.svelte lib/ContextMenu.svelte; do curl -s -o /dev/null -w "$f %{http_code}\n" "http://localhost:5199/src/$f"; done
pkill -f "vite --port 5199"
```

Expected: `200` for each file. Localhost access may need the sandbox disabled.

- [ ] **Step 4: Commit**

```bash
git add src/lib/TopBar.svelte src/lib/ContextMenu.svelte
git commit -m "feat(ui): z-order in the top bar and context menu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Pure panel helpers

**Files:**
- Create: `src/lib/double-tap.ts`, `src/lib/layer-drop.ts`
- Test: `src/__tests__/layer-panel.test.ts`

**Interfaces:**
- Consumes: `moveLayer`, `moveNodes`, `layerBlock` (Task 1); `findTopLevel`.
- Produces:
  - `type Tap = { id: string; time: number }`
  - `DOUBLE_TAP_MS = 350`
  - `isDoubleTap(prev: Tap | null, next: Tap): boolean`
  - `type RowBox = { kind: "layer" | "node"; id: string; top: number; bottom: number }` — rows in display order, top first
  - `type Drag = { kind: "layer"; id: string } | { kind: "node"; ids: readonly string[] }`
  - `type Drop = { kind: "layer"; index: number; line: number } | { kind: "node"; layerId: string; index: number; line: number }`
  - `dropTarget(doc, rows: readonly RowBox[], y: number, drag: Drag): Drop | null`

- [ ] **Step 1: Write the failing test** — `src/__tests__/layer-panel.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Layer, type Node } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { DOUBLE_TAP_MS, isDoubleTap } from "../lib/double-tap";
import { dropTarget, type RowBox } from "../lib/layer-drop";
import { deepFreeze } from "./helpers";

const rect = (id: string): Node => ({
  kind: "rect",
  id,
  transform: IDENTITY,
  style: DEFAULT_STYLE,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rx: 0,
});
const layer = (id: string, childIds: string[], over: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  children: childIds.map(rect),
  ...over,
});
const doc = (...layers: Layer[]): Doc => deepFreeze({ ...createDoc(100, 100), layers });

describe("double tap", () => {
  it("needs the same row within the time limit", () => {
    expect(DOUBLE_TAP_MS).toBe(350);
    expect(isDoubleTap(null, { id: "a", time: 10 })).toBe(false);
    expect(isDoubleTap({ id: "a", time: 10 }, { id: "a", time: 360 })).toBe(true);
    expect(isDoubleTap({ id: "a", time: 10 }, { id: "a", time: 361 })).toBe(false);
    expect(isDoubleTap({ id: "a", time: 10 }, { id: "b", time: 20 })).toBe(false);
    expect(isDoubleTap({ id: "a", time: 10 }, { id: "a", time: 5 })).toBe(false);
  });
});

describe("drop target", () => {
  // Display order, top first: B (b2, b1) then A (a2, a1), 32px rows.
  const d = doc(layer("A", ["a1", "a2"]), layer("B", ["b1", "b2"]));
  const rows: RowBox[] = [
    { kind: "layer", id: "B", top: 0, bottom: 32 },
    { kind: "node", id: "b2", top: 32, bottom: 64 },
    { kind: "node", id: "b1", top: 64, bottom: 96 },
    { kind: "layer", id: "A", top: 96, bottom: 128 },
    { kind: "node", id: "a2", top: 128, bottom: 160 },
    { kind: "node", id: "a1", top: 160, bottom: 192 },
  ];

  it("places a dragged layer by layer-row midpoints", () => {
    expect(dropTarget(d, rows, 10, { kind: "layer", id: "A" })).toEqual({
      kind: "layer",
      index: 1,
      line: 0,
    });
    expect(dropTarget(d, rows, 150, { kind: "layer", id: "A" })).toBeNull();
    expect(dropTarget(d, rows, 190, { kind: "layer", id: "B" })).toEqual({
      kind: "layer",
      index: 0,
      line: 192,
    });
  });

  it("places dragged objects above or below a row, or on top of a layer", () => {
    const one = { kind: "node" as const, ids: ["a1"] };
    expect(dropTarget(d, rows, 40, one)).toEqual({
      kind: "node",
      layerId: "B",
      index: 2,
      line: 32,
    });
    expect(dropTarget(d, rows, 60, one)).toEqual({
      kind: "node",
      layerId: "B",
      index: 1,
      line: 64,
    });
    expect(dropTarget(d, rows, 5, one)).toEqual({ kind: "node", layerId: "B", index: 2, line: 32 });
    expect(dropTarget(d, rows, -20, one)).toEqual({
      kind: "node",
      layerId: "B",
      index: 2,
      line: 32,
    });
    expect(dropTarget(d, rows, 130, one)).toEqual({
      kind: "node",
      layerId: "A",
      index: 1,
      line: 128,
    });
    expect(dropTarget(d, rows, 150, one)).toBeNull();
    expect(dropTarget(d, rows, 500, one)).toBeNull();
    expect(dropTarget(d, rows, 5, { kind: "node", ids: ["a1", "b1"] })).toEqual({
      kind: "node",
      layerId: "B",
      index: 1,
      line: 32,
    });
  });

  it("refuses hidden or locked target layers and empty row lists", () => {
    const locked = doc(layer("A", ["a1", "a2"]), layer("B", ["b1", "b2"], { locked: true }));
    expect(dropTarget(locked, rows, 40, { kind: "node", ids: ["a1"] })).toBeNull();
    expect(dropTarget(locked, rows, 10, { kind: "layer", id: "A" })).not.toBeNull();
    expect(dropTarget(d, [], 10, { kind: "layer", id: "A" })).toBeNull();
  });
});
```

Hand-checks:
- **Layer A at y 10:** the other layer rows are [B], and B's midpoint 16 is not above 10. So the slot is 0 and the index is 2 − 1 − 0 = 1. That moves A to the top, and the line is at B's top (0).
- **Layer A at y 150:** the slot is 1 and the index is 0, which is A's current place, so the result is null.
- **Layer B at y 190:** the slot is 1 and the index is 0, which is a change. The slot is past the last other row, so the line is at the last row's bottom (192).
- **a1 at y 40:** the pointer is over b2 (index 1), in its upper half (the midpoint is 48). The slot index is 2, and B's children below it are [b1, b2], none moving, so the index is 2. The line is at 32.
- **a1 at y 60:** the pointer is in b2's lower half. The slot is 1, so the index is 1 and the line is at 64.
- **a1 at y 5:** over B's layer row, so it goes on top of B (slot 2) and the line is at the row's bottom (32).
- **a1 at y 130:** over a2, in its upper half. The slot is 2, and A's children below it are [a1, a2]; without a1 that leaves 1. The index is 1, which is a change, and the line is at 128.
- **a1 at y 150:** a2's lower half. The slot is 1, so the index is 0, which is a1's current place: null.
- **a1 at y 500:** below all rows, so the last row counts. That is a1 itself; 500 is not above its midpoint 176, so this is its lower half and the slot is a1's index, 0. The index is 0, which is a1's own place: null.
- **{a1, b1} at y 5:** B's children are [b1, b2]; without b1 the index is 1. The result is B = [b2, a1, b1], which is a change.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/layer-panel.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`src/lib/double-tap.ts`:

```ts
/** Spec (M3a) §5: rename starts on a double tap. Decided on pointerup so it works on iPad, where
 *  Safari does not reliably fire dblclick. */
export type Tap = { id: string; time: number };

export const DOUBLE_TAP_MS = 350;

export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev || prev.id !== next.id) return false;
  const gap = next.time - prev.time;
  return gap >= 0 && gap <= DOUBLE_TAP_MS;
}
```

`src/lib/layer-drop.ts`:

```ts
import type { Doc } from "../doc/document";
import { layerBlock, moveLayer, moveNodes } from "../doc/layers";
import { findTopLevel } from "../doc/tree";

/** Spec (M3a) §5: where a row dragged in the layers panel would land. Rows are in display order
 *  (top first) with their on-screen top/bottom; `line` is where to draw the drop indicator. */
export type RowBox = { kind: "layer" | "node"; id: string; top: number; bottom: number };
export type Drag = { kind: "layer"; id: string } | { kind: "node"; ids: readonly string[] };
export type Drop =
  | { kind: "layer"; index: number; line: number }
  | { kind: "node"; layerId: string; index: number; line: number };

const mid = (r: RowBox) => (r.top + r.bottom) / 2;

export function dropTarget(doc: Doc, rows: readonly RowBox[], y: number, drag: Drag): Drop | null {
  if (rows.length === 0) return null;

  if (drag.kind === "layer") {
    const others = rows.filter((r) => r.kind === "layer" && r.id !== drag.id);
    const slot = others.filter((r) => mid(r) < y).length;
    const index = doc.layers.length - 1 - slot;
    if (moveLayer(doc, drag.id, index) === doc) return null;
    const line = slot < others.length ? others[slot].top : rows[rows.length - 1].bottom;
    return { kind: "layer", index, line };
  }

  const row =
    rows.find((r) => y >= r.top && y < r.bottom) ??
    (y < rows[0].top ? rows[0] : rows[rows.length - 1]);
  let layerId: string;
  let slotIndex: number;
  let line: number;
  if (row.kind === "layer") {
    const layer = doc.layers.find((l) => l.id === row.id);
    if (!layer) return null;
    layerId = layer.id;
    slotIndex = layer.children.length;
    line = row.bottom;
  } else {
    const found = findTopLevel(doc, row.id);
    if (!found) return null;
    const upper = y < mid(row);
    layerId = found.layer.id;
    slotIndex = upper ? found.index + 1 : found.index;
    line = upper ? row.top : row.bottom;
  }
  if (layerBlock(doc, layerId)) return null;
  const target = doc.layers.find((l) => l.id === layerId)!;
  const moving = new Set(drag.ids);
  const index = target.children.slice(0, slotIndex).filter((n) => !moving.has(n.id)).length;
  if (moveNodes(doc, drag.ids, layerId, index) === doc) return null;
  return { kind: "node", layerId, index, line };
}
```

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test` (expected 302), `npx tsc --noEmit`, `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/double-tap.ts src/lib/layer-drop.ts src/__tests__/layer-panel.test.ts
git commit -m "feat: double-tap and drop-position helpers for the layers panel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The Layers panel and the sidebar column

**Files:**
- Create: `src/lib/LayersPanel.svelte`, `src/lib/Sidebar.svelte`
- Modify: `src/lib/PropertiesPanel.svelte` (outer classes), `src/App.svelte`

**Interfaces:**
- Consumes:
  - Task 3 store actions and `setCurrentLayer` (Task 2);
  - `rowLabel` (Task 1);
  - `isDoubleTap`, `dropTarget` (Task 5);
  - `IconButton`, `.ui-selected`, `.ui-selected-tint`, `.section-title`, `.field`, `.icon-btn`.
- Produces: UI only.

- [ ] **Step 1: `src/lib/Sidebar.svelte`**

```svelte
<script lang="ts">
  import LayersPanel from "./LayersPanel.svelte";
  import PropertiesPanel from "./PropertiesPanel.svelte";
</script>

<!-- Spec (M3a) §5: Properties on top (scrolls), Layers below with its own scroll. -->
<div class="flex h-full w-60 shrink-0 flex-col border-l border-line bg-panel">
  <PropertiesPanel />
  <LayersPanel />
</div>
```

- [ ] **Step 2: Size Properties as the column's top part**

In `src/lib/PropertiesPanel.svelte`, change the `<aside>` class from
`flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-panel p-3 text-xs`
to
`flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 text-xs`.

- [ ] **Step 3: Use the column in `src/App.svelte`**

- Replace `import PropertiesPanel from "./lib/PropertiesPanel.svelte";` with `import Sidebar from "./lib/Sidebar.svelte";`.
- Replace both `<PropertiesPanel />` usages (the narrow drawer and the wide column) with `<Sidebar />`.

- [ ] **Step 4: `src/lib/LayersPanel.svelte`**

```svelte
<script lang="ts">
  import {
    ChevronDown,
    ChevronRight,
    Eye,
    EyeOff,
    GripVertical,
    Lock,
    LockOpen,
    Plus,
    Trash2,
  } from "@lucide/svelte";
  import type { Layer } from "../doc/document";
  import { rowLabel } from "../doc/layers";
  import {
    addLayerAboveCurrent,
    app,
    deleteCurrentLayer,
    moveLayerTo,
    moveNodesTo,
    renameLayerById,
    renameNodeById,
    selectFromPanel,
    setCurrentLayer,
    toggleLayerLocked,
    toggleLayerVisible,
  } from "../state/appState.svelte";
  import { isDoubleTap, type Tap } from "./double-tap";
  import IconButton from "./IconButton.svelte";
  import { dropTarget, type Drag, type Drop, type RowBox } from "./layer-drop";

  /** Spec (M3a) §5. Collapsed layers and the rename draft are panel-local, never saved. */
  const collapsed = $state<Record<string, boolean>>({});
  let editing = $state<{ kind: "layer" | "node"; id: string } | null>(null);
  let draft = $state("");
  let lastTap: Tap | null = null;
  let list = $state<HTMLElement | null>(null);
  let dragging: { drag: Drag; pointerId: number } | null = null;
  let drop = $state<Drop | null>(null);
  let lineTop = $state(0);

  const layers = $derived([...app.doc.layers].reverse());
  const current = $derived(app.doc.layers.find((l) => l.id === app.currentLayerId) ?? null);
  const selected = $derived(new Set(app.selection));

  const blockedTitle = (l: Layer): string | undefined =>
    !l.visible
      ? `Layer “${l.name}” is hidden`
      : l.locked
        ? `Layer “${l.name}” is locked`
        : undefined;

  const focusSelect = (el: HTMLInputElement) => {
    el.focus();
    el.select();
  };

  /** A second tap on the same name within the double-tap window starts renaming it. */
  function tapName(kind: "layer" | "node", id: string, initial: string, e: PointerEvent) {
    const tap = { id, time: e.timeStamp };
    if (isDoubleTap(lastTap, tap)) {
      lastTap = null;
      editing = { kind, id };
      draft = initial;
    } else {
      lastTap = tap;
    }
  }

  function finishRename(commit: boolean) {
    const e = editing;
    editing = null;
    if (!e || !commit) return;
    if (e.kind === "layer") renameLayerById(e.id, draft);
    else renameNodeById(e.id, draft);
  }

  function rows(): RowBox[] {
    if (!list) return [];
    return [...list.querySelectorAll<HTMLElement>("[data-row-id]")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        kind: el.dataset.rowKind === "layer" ? "layer" : "node",
        id: el.dataset.rowId ?? "",
        top: r.top,
        bottom: r.bottom,
      };
    });
  }

  function startDrag(e: PointerEvent, drag: Drag) {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience; moves still arrive while the pointer stays on the grip.
    }
    dragging = { drag, pointerId: e.pointerId };
    drop = null;
  }

  function moveDrag(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragging.pointerId || !list) return;
    drop = dropTarget(app.doc, rows(), e.clientY, dragging.drag);
    if (drop) lineTop = drop.line - list.getBoundingClientRect().top + list.scrollTop;
  }

  function endDrag(e: PointerEvent, apply: boolean) {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    const drag = dragging.drag;
    const target = drop;
    dragging = null;
    drop = null;
    if (!apply || !target) return;
    if (drag.kind === "layer" && target.kind === "layer") moveLayerTo(drag.id, target.index);
    else if (drag.kind === "node" && target.kind === "node") {
      moveNodesTo(drag.ids, target.layerId, target.index);
    }
  }

  /** Dragging a selected row moves the whole selection; any other row moves on its own. */
  const nodeDrag = (id: string): Drag => ({
    kind: "node",
    ids: selected.has(id) ? app.selection : [id],
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && dragging) {
      dragging = null;
      drop = null;
    }
  }}
/>

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
    <ul>
      {#each layers as layer (layer.id)}
        {@const isCurrent = layer.id === app.currentLayerId}
        {@const blocked = !layer.visible || layer.locked}
        {@const open = !collapsed[layer.id]}
        <li>
          <div
            data-row-id={layer.id}
            data-row-kind="layer"
            class={["flex h-8 items-center gap-0.5 pr-1", isCurrent && "ui-selected-tint"]}
          >
            <button
              type="button"
              tabindex="-1"
              class="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-muted"
              style="touch-action: none"
              aria-label="Drag “{layer.name}”"
              onpointerdown={(e) => startDrag(e, { kind: "layer", id: layer.id })}
              onpointermove={moveDrag}
              onpointerup={(e) => endDrag(e, true)}
              onpointercancel={(e) => endDrag(e, false)}
            >
              <GripVertical size={14} />
            </button>
            <button
              type="button"
              class="flex h-8 w-5 shrink-0 items-center justify-center text-muted"
              aria-label={open ? `Collapse “${layer.name}”` : `Expand “${layer.name}”`}
              aria-expanded={open}
              onclick={() => (collapsed[layer.id] = open)}
            >
              {#if open}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
            </button>
            {#if editing?.kind === "layer" && editing.id === layer.id}
              <input
                class="field h-7 min-w-0 flex-1"
                aria-label="Layer name"
                bind:value={draft}
                {@attach focusSelect}
                onkeydown={(e) => {
                  if (e.key === "Enter") finishRename(true);
                  if (e.key === "Escape") finishRename(false);
                }}
                onblur={() => finishRename(true)}
              />
            {:else}
              <button
                type="button"
                class={[
                  "h-8 min-w-0 flex-1 truncate text-left",
                  isCurrent && "font-medium",
                  blocked && "text-muted",
                ]}
                title={layer.name}
                onclick={() => setCurrentLayer(layer.id)}
                onpointerup={(e) => tapName("layer", layer.id, layer.name, e)}
              >
                {layer.name}
              </button>
            {/if}
            <button
              type="button"
              class="icon-btn"
              aria-label={layer.visible ? `Hide “${layer.name}”` : `Show “${layer.name}”`}
              title={layer.visible ? `Hide “${layer.name}”` : `Show “${layer.name}”`}
              onclick={() => toggleLayerVisible(layer.id)}
            >
              {#if layer.visible}<Eye size={14} />{:else}<EyeOff size={14} />{/if}
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label={layer.locked ? `Unlock “${layer.name}”` : `Lock “${layer.name}”`}
              title={layer.locked ? `Unlock “${layer.name}”` : `Lock “${layer.name}”`}
              onclick={() => toggleLayerLocked(layer.id)}
            >
              {#if layer.locked}<Lock size={14} />{:else}<LockOpen size={14} />{/if}
            </button>
          </div>

          {#if open}
            <ul>
              {#each [...layer.children].reverse() as node (node.id)}
                {@const isSelected = selected.has(node.id)}
                <li
                  data-row-id={node.id}
                  data-row-kind="node"
                  class={[
                    "flex h-8 items-center gap-0.5 pr-1 pl-5",
                    isSelected && "ui-selected",
                    blocked && "text-muted",
                  ]}
                  title={blockedTitle(layer)}
                >
                  <button
                    type="button"
                    tabindex="-1"
                    class="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-muted"
                    style="touch-action: none"
                    aria-label="Drag “{rowLabel(node)}”"
                    onpointerdown={(e) => {
                      if (!blocked) startDrag(e, nodeDrag(node.id));
                    }}
                    onpointermove={moveDrag}
                    onpointerup={(e) => endDrag(e, true)}
                    onpointercancel={(e) => endDrag(e, false)}
                  >
                    <GripVertical size={14} />
                  </button>
                  {#if editing?.kind === "node" && editing.id === node.id}
                    <input
                      class="field h-7 min-w-0 flex-1"
                      aria-label="Object name"
                      placeholder={rowLabel(node)}
                      bind:value={draft}
                      {@attach focusSelect}
                      onkeydown={(e) => {
                        if (e.key === "Enter") finishRename(true);
                        if (e.key === "Escape") finishRename(false);
                      }}
                      onblur={() => finishRename(true)}
                    />
                  {:else}
                    <button
                      type="button"
                      class="h-8 min-w-0 flex-1 truncate text-left"
                      onclick={(e) => {
                        if (!blocked)
                          selectFromPanel(node.id, e.shiftKey || e.metaKey || e.ctrlKey);
                      }}
                      onpointerup={(e) => {
                        if (!blocked) tapName("node", node.id, node.name ?? "", e);
                      }}
                    >
                      {rowLabel(node)}
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
    {#if drop}
      <div
        class="pointer-events-none absolute inset-x-1 h-0.5 bg-accent"
        style="top: {lineTop - 1}px"
      ></div>
    {/if}
  </div>
</section>
```

Notes:
- **Collapsing:** `onclick={() => (collapsed[layer.id] = open)}` sets "collapsed" to the current "open" value, so the click flips the state.
- **Rename commit:** Enter commits, then the input disappears. The blur that follows finds `editing === null` and does nothing.

- [ ] **Step 5: Verify**

Run: `npm run build` (0 errors / 0 warnings — svelte-check a11y included), `npm run lint`, `npm run format:check`, `npm test` (302).

Then run the Task 4 compile check with these files: `lib/LayersPanel.svelte lib/Sidebar.svelte lib/PropertiesPanel.svelte App.svelte`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/LayersPanel.svelte src/lib/Sidebar.svelte src/lib/PropertiesPanel.svelte src/App.svelte
git commit -m "feat(ui): layers panel with rename and drag-to-reorder

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Controller browser pass (between Task 6 and Task 7)

The controller runs this itself on a separate dev server (`npx vite --port 5198 --strictPort`), takes screenshots of each state, and stops the server afterwards. Click in the page first (`document.hasFocus()` must be true, or focus and blur never fire).

1. **Panel:** two layers, one collapsed and one expanded, with rows front-most first. The current layer is tinted.
2. **Add and delete:** New layer adds "Layer N" above the current layer and makes it current. Delete on an empty layer happens at once. Delete on a non-empty layer shows the in-app confirmation, and Cancel keeps the layer. Delete is disabled with its reason when only one layer is left.
3. **Rename:** double-click a layer name, type, and press Enter to rename. Escape cancels. Renaming an object and clearing its name brings back the default label. Undo restores each rename.
4. **Hide and lock:**
   - Hiding the current layer turns its rows muted and drops its objects from the selection.
   - Drawing then shows "“X” is hidden — show it to draw.", and pasting shows the paste message.
   - Lock behaves the same way.
5. **Current layer:** selecting an object on the canvas makes its layer current, and a new rect lands in that layer.
6. **Drag:**
   - Dragging a layer by its grip (synthetic PointerEvents) reorders the layers, with the drop line visible mid-drag.
   - Dragging an object into another layer moves it and selects it.
   - A drop onto a locked layer is refused.
   - Escape cancels a drag.
7. **Z-order:**
   - The top-bar icons and the menu items reorder objects.
   - ⌘] ⌘[ ⇧⌘] ⇧⌘[ (key events with `code`) work, and the page does not navigate.
   - The buttons are disabled with a reason when nothing is selected.
8. **Row selection:** Shift/⌘ click on object rows toggles them in the selection.
9. **Width:** with `#app` at 768px the top bar stays one row, and the sidebar column shows both parts, each scrolling.
10. **Console:** no errors.

Record the results for Task 7. Send any failures through a fix dispatch first.

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/CHANGELOG.md`

- [ ] **Step 1: `CLAUDE.md`**
- **Architecture map:**
  - `src/doc/`: add `layers.ts` (layer, naming and z-order edits; current-layer helpers).
  - `src/lib/`: add `Sidebar` (Properties + Layers column), `LayersPanel`, `double-tap.ts` and `layer-drop.ts`.
  - Remove `targetLayerId` from the `tree.ts` description.
- **New gotcha** (append):
  > **New objects go into the current layer** (`app.currentLayerId`, spec M3a). It is store state (not saved or undoable), re-resolved in `setSession`, set from the last selected object in `setSelection`, and reset by `replaceDocument`.
  > Tools read it through `ToolContext.currentLayerId()`, and paste receives it as a parameter. A hidden or locked current layer refuses with `blockMessage`, never silently falls back.
  > Z-order shortcuts match `KeyboardEvent.code` (`BracketLeft`/`BracketRight`), because Shift changes `key`.
- **Current state:** `Milestone 3a (layers panel, z-order) — see CHANGELOG. Next is milestone 3b: groups.`
- **Roadmap:** the paragraph starting "M3:" becomes "M3b:", and keeps its items.
- **Commands:** update the test count to the actual `npm test` result.

- [ ] **Step 2: `README.md`**
- **Status list:** add `- Layers: a layers panel with show/hide, lock, rename, drag to reorder, and a current layer for new shapes; bring forward / send backward.`
- **Keyboard table:** add a row `| Bring forward / Send backward | ⌘] / ⌘[ |`, then a row `| Bring to front / Send to back | ⇧⌘] / ⇧⌘[ |`. Then run `npx prettier --write README.md`.
- **Roadmap:** `Next: groups, then pen and node editing.`
- **Development:** update the test count to the actual result.

- [ ] **Step 3: `docs/superpowers/CHANGELOG.md`** — append:

```markdown
## 2026-09-17 — Milestone 3a: layers panel and z-order

- A current layer receives new shapes and pastes; selecting an object makes its layer current; a
  hidden or locked current layer refuses with a notice instead of falling back to another layer.
- Layers panel under Properties: layers (top first) with their objects, eye/lock, current-layer
  tint, selected-object rows, rename by double-click/double-tap, drag-to-reorder by grip (layers,
  and objects within/between layers) with a drop line, New layer / Delete layer (confirmation when
  not empty; never the last layer).
- Z-order (per layer): top-bar icons, context-menu items and ⌘] ⌘[ ⇧⌘] ⇧⌘[.
- The SVG writer strips unpaired surrogates and U+FFFE/U+FFFF from attributes (user-typed names).
- Plan: `docs/superpowers/plans/2026-09-17-m3a-layers-panel.md`.
- Browser-verified (desktop Chrome): <controller fills in from the browser pass>.
- Owed: iPad (touch drag of rows, double-tap rename, the drawer with both panels), Safari/Firefox,
  real ⌘[ / ⌘] presses in Safari.
```

Replace `<controller fills in …>` with the results the controller provides.

- [ ] **Step 4: Verify and commit**

Run: `npm test` (use its count) and `npm run format:check`.

```bash
git add CLAUDE.md README.md docs/superpowers/CHANGELOG.md
git commit -m "docs: milestone 3a layers panel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
