# Milestone 7 — Boolean Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unite, Subtract, Intersect and Exclude on the selected shapes, using Paper.js as a geometry-only helper that is downloaded only when someone first runs an operation.

**Architecture:**
- **One file touches Paper.** `src/geom/boolean.ts` takes `Subpath[][]` in and gives `Subpath[]` back. It loads Paper with a dynamic `import()` on first use, so the library is its own chunk and the app's initial download is unchanged.
- **One file decides what the document becomes.** `src/doc/boolean-edit.ts` resolves the selection, refuses what cannot work, maps every operand into document space, runs the operation and returns a new document — or says why it did not.
- **One predicate decides what is offered.** `booleanRefusal` is pure and synchronous, so the menus and the icons never wait on a download to know whether a command applies, and they cannot disagree with the edit about it.

**Tech Stack:** Svelte 5.55 (runes), TypeScript strict, Vite 8, Tailwind 4, Vitest 4 (node env), Paper.js (`paper-core`, geometry only).

**Spec:** `docs/superpowers/specs/2026-09-19-m7-boolean-operations-design.md` (binding).

## Global Constraints

- **Checks:** `npm run build` ends with **0 errors, 0 warnings**; `npm run lint` silent; `npm test` passes; `npm run format:check` clean. Run `npx prettier --write` on touched files before committing.
- **The build must emit two chunks** — the app's and paper's — and the app's own chunk must stay within a few KB of where it was (69.2 KB gzipped before this milestone). A single chunk means the dynamic import was defeated and the milestone's bundle promise is broken. **This can only be checked once something actually calls the code**: until then Rollup drops the module and Paper with it, and the build honestly shows one chunk. The check belongs to Task 4, where the UI first calls `booleanSelection`; Tasks 1–3 will each show a single chunk and that is correct.
- **Import `paper/dist/paper-core`, with no file extension.** The package declares that exact module name for its types; the extension-ful path has none, and the default entry (`paper`) is the full build, which needs a DOM.
- **No module other than `src/geom/boolean.ts` may import Paper**, directly or indirectly by type.
- **The document is immutable**; an operation that changes nothing returns the same reference. Every session change goes through `setSession`, selection through `setSelection`.
- **Nothing may create a shape the importer drops:** an operation that leaves no area must leave the document untouched, not write an empty path.
- **UI:** theme tokens only; one class expression per element; the top bar must never wrap or scroll; a command that cannot run is disabled with a reason in the top bar and the Path menu, and hidden in the context menu.
- **Existing tests keep their expected values.**
- **Commit trailer**, exactly: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. One commit per task.
- **Git:** branch `m7-boolean` off `main` (the controller creates it).
- **The sandboxed `git commit` fails with EPERM on `.git/index.lock`** — retry that one command with the sandbox disabled.

## File map

```
package.json                   + paper dependency
src/geom/boolean.ts            + the lazy Paper loader, conversion, the four operations   (new)
src/doc/boolean-edit.ts        + booleanRefusal and booleanShapes                          (new)
src/state/appState.svelte.ts   + booleanSelection
src/state/properties.ts        selectionActions gains booleanRefusal
src/lib/TopBar.svelte          + the Path menu and the four icons (>=900px)
src/lib/ContextMenu.svelte     + the four entries
README.md, CLAUDE.md, docs/superpowers/CHANGELOG.md
```

---

### Task 1: The geometry

**Files:**
- Modify: `package.json` (add the dependency)
- Create: `src/geom/boolean.ts`
- Test: `src/__tests__/boolean.test.ts` (new)

**Interfaces:**
- Produces: `BoolOp`, `BOOL_OPS`, `BOOL_LABEL`, `BOOL_TITLE`, `BOOL_REASON`, and
  `booleanOf(operands: readonly (readonly Subpath[])[], op: BoolOp): Promise<Subpath[]>`.

- [ ] **Step 1: Add the dependency**

```bash
npm install paper
```

Expected: one package added, and `paper` appears in `dependencies` in `package.json`. Do not install anything else, and do not add `@types/paper` — the package ships its own declarations.

- [ ] **Step 2: Write the failing tests** — `src/__tests__/boolean.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { booleanOf } from "../geom/boolean";
import type { Subpath } from "../doc/document";

const corner = (x: number, y: number) => ({ p: { x, y }, in: null, out: null, type: "corner" as const });
const rect = (x: number, y: number, w: number, h: number): Subpath => ({
  closed: true,
  nodes: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)],
});
const K = 0.5522847498307936 * 30;
const circle: Subpath = {
  closed: true,
  nodes: [
    { p: { x: 20, y: 50 }, in: { x: 20, y: 50 + K }, out: { x: 20, y: 50 - K }, type: "symmetric" },
    { p: { x: 50, y: 20 }, in: { x: 50 - K, y: 20 }, out: { x: 50 + K, y: 20 }, type: "symmetric" },
    { p: { x: 80, y: 50 }, in: { x: 80, y: 50 - K }, out: { x: 80, y: 50 + K }, type: "symmetric" },
    { p: { x: 50, y: 80 }, in: { x: 50 + K, y: 80 }, out: { x: 50 - K, y: 80 }, type: "symmetric" },
  ],
};

describe("booleanOf", () => {
  it("round-trips a shape through paper unchanged", async () => {
    const out = await booleanOf([[circle], [rect(500, 500, 10, 10)]], "unite");
    const back = out.find((sp) => sp.nodes.some((n) => Math.abs(n.p.x - 20) < 1e-9));
    expect(back).toBeDefined();
    expect(back!.nodes.map((n) => [n.p.x, n.p.y])).toEqual(circle.nodes.map((n) => [n.p.x, n.p.y]));
    expect(back!.nodes[0].in).toEqual(circle.nodes[0].in);
    expect(back!.nodes[0].type).toBe("symmetric");
  });

  it("unites, subtracts, intersects and excludes", async () => {
    const sq = rect(50, 50, 40, 40);
    expect((await booleanOf([[circle], [sq]], "unite"))[0].nodes.length).toBeGreaterThan(4);
    expect(await booleanOf([[circle], [sq]], "subtract")).toHaveLength(1);
    expect(await booleanOf([[circle], [sq]], "intersect")).toHaveLength(1);
    expect(await booleanOf([[circle], [sq]], "exclude")).toHaveLength(2);
  });

  it("keeps curves", async () => {
    const out = await booleanOf([[circle], [rect(50, 50, 40, 40)]], "subtract");
    expect(out[0].nodes.some((n) => n.in !== null || n.out !== null)).toBe(true);
  });

  it("gives a hole opposite winding, which is what nonzero fill needs", async () => {
    const out = await booleanOf([[rect(0, 0, 100, 100)], [rect(40, 40, 20, 20)]], "subtract");
    expect(out).toHaveLength(2);
    const area = (sp: Subpath) => {
      let a = 0;
      for (let i = 0; i < sp.nodes.length; i++) {
        const p = sp.nodes[i].p;
        const q = sp.nodes[(i + 1) % sp.nodes.length].p;
        a += p.x * q.y - q.x * p.y;
      }
      return a / 2;
    };
    expect(Math.sign(area(out[0]))).toBe(-Math.sign(area(out[1])));
  });

  it("returns nothing when the result is empty", async () => {
    expect(await booleanOf([[rect(0, 0, 10, 10)], [rect(50, 50, 10, 10)]], "intersect")).toEqual([]);
  });

  it("unites disjoint shapes into two subpaths", async () => {
    expect(await booleanOf([[rect(0, 0, 10, 10)], [rect(50, 50, 10, 10)]], "unite")).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/__tests__/boolean.test.ts`
Expected: FAIL — `../geom/boolean` does not exist.

- [ ] **Step 4: Implement** — `src/geom/boolean.ts`

```ts
import type { PathNode, Subpath } from "../doc/document";

/** The module's own types, taken from the dynamic import so nothing is imported at load time. */
type Paper = typeof import("paper/dist/paper-core");
type PaperPath = InstanceType<Paper["Path"]>;
type PaperItem = InstanceType<Paper["PathItem"]>;
type PaperSegment = InstanceType<Paper["Segment"]>;

/** Spec (M7) §4. */
export type BoolOp = "unite" | "subtract" | "intersect" | "exclude";

/** The command names, used by every surface and by the notices, so they cannot drift apart. */
export const BOOL_LABEL: Readonly<Record<BoolOp, string>> = {
  unite: "Unite",
  subtract: "Subtract",
  intersect: "Intersect",
  exclude: "Exclude",
};

export const BOOL_OPS: readonly BoolOp[] = ["unite", "subtract", "intersect", "exclude"];

/** Tooltips read as actions, because every title is also the status-bar hint (invariant 24). */
export const BOOL_TITLE: Readonly<Record<BoolOp, string>> = {
  unite: "Combine the selected shapes into one",
  subtract: "Remove what is in front from what is behind",
  intersect: "Keep only where the selected shapes overlap",
  exclude: "Keep everything except where they overlap",
};

/** Spec (M7) §7. */
export const BOOL_REASON = {
  few: "select two or more shapes",
  group: "a group can't take part",
  open: "an open path can't take part",
} as const;

/** Two handles that mirror each other about the point are a symmetric node; the importer uses the
 *  same tolerance. */
const MIRROR = 1e-6;

/** Paper is ~72 KB gzipped — as much as the rest of the app — and boolean operations are rare, so
 *  it is fetched on first use rather than at load (spec M7 §2). Nothing else imports it, and the
 *  refusal rules the menus need are pure, so no menu ever waits on this. */
let paper: Paper | null = null;
async function load(): Promise<Paper> {
  if (paper) return paper;
  const mod = await import("paper/dist/paper-core");
  const p = (mod as unknown as { default?: Paper }).default ?? (mod as unknown as Paper);
  // No canvas and no DOM: paper only ever does geometry here.
  p.setup(new p.Size(1, 1));
  paper = p;
  return p;
}

/** Our handles are absolute in the shape's own space; paper's are relative to the segment point. */
function toPaperPath(P: Paper, sp: Subpath): PaperPath {
  return new P.Path({
    segments: sp.nodes.map(
      (n) =>
        new P.Segment(
          new P.Point(n.p.x, n.p.y),
          n.in ? new P.Point(n.in.x - n.p.x, n.in.y - n.p.y) : undefined,
          n.out ? new P.Point(n.out.x - n.p.x, n.out.y - n.p.y) : undefined,
        ),
    ),
    closed: sp.closed,
  });
}

function toPaperItem(P: Paper, subpaths: readonly Subpath[]): PaperItem {
  const paths = subpaths.map((sp) => toPaperPath(P, sp));
  return paths.length === 1 ? paths[0] : new P.CompoundPath({ children: paths });
}

function nodeFrom(s: PaperSegment): PathNode {
  const inH = s.handleIn.isZero()
    ? null
    : { x: s.point.x + s.handleIn.x, y: s.point.y + s.handleIn.y };
  const outH = s.handleOut.isZero()
    ? null
    : { x: s.point.x + s.handleOut.x, y: s.point.y + s.handleOut.y };
  const mirrored =
    inH !== null &&
    outH !== null &&
    Math.abs(inH.x + outH.x - 2 * s.point.x) <= MIRROR &&
    Math.abs(inH.y + outH.y - 2 * s.point.y) <= MIRROR;
  return {
    p: { x: s.point.x, y: s.point.y },
    in: inH,
    out: outH,
    type: inH === null && outH === null ? "corner" : mirrored ? "symmetric" : "smooth",
  };
}

function fromPaperItem(item: PaperItem): Subpath[] {
  const paths =
    "children" in item && item.children ? (item.children as PaperPath[]) : [item as PaperPath];
  return paths
    .filter((p) => p.segments && p.segments.length >= 2)
    .map((p) => ({ nodes: p.segments.map(nodeFrom), closed: p.closed }));
}

/** Spec (M7) §4. Every operand is in document space already. Returns [] when the result is empty —
 *  the caller must leave the document alone rather than write a path the importer would drop. */
export async function booleanOf(
  operands: readonly (readonly Subpath[])[],
  op: BoolOp,
): Promise<Subpath[]> {
  const P = await load();
  const items = operands.map((o) => toPaperItem(P, o));
  let acc = items[0];
  for (const next of items.slice(1)) acc = acc[op](next);
  return fromPaperItem(acc);
}
```

Three things in that file are load-bearing and were each arrived at by fixing a failure:

- `type Paper = typeof import("paper/dist/paper-core")` and the `InstanceType<...>` aliases. A
  value import would pull Paper into the main bundle; `import type * as` does not work, because the
  package declares `export = `, and a default type import cannot be used as a namespace.
- `undefined`, not `null`, for a missing handle in `new P.Segment(...)` — the declared parameter
  type is `PointLike | undefined`.
- The dynamic import's `.default ?? mod` interop dance: the package is CommonJS, and which of the
  two shapes arrives depends on the bundler.

- [ ] **Step 5: Verify**

Run the Step 3 command, then `npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

Expect the build to emit **one** chunk at this point, unchanged in size. Nothing imports this module
yet, so Rollup drops it and Paper with it; that is correct, not a failure of the dynamic import. The
two-chunk check happens in Task 4, where the UI first calls it.

- [ ] **Step 6: Commit**

```bash
git add -A src package.json package-lock.json
git commit -m "feat(geom): boolean operations on subpaths, with paper loaded on first use

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: What the document becomes

**Files:**
- Create: `src/doc/boolean-edit.ts`
- Test: `src/__tests__/boolean-edit.test.ts` (new)

**Interfaces:**
- Consumes: `booleanOf`, `BoolOp` (Task 1); `toPath` from `src/geom/shapes.ts`; `findNode`/`mapNodes` from `src/doc/tree.ts`; `deleteNodes` from `src/doc/edits.ts`; `applyMat`/`invert`/`multiply`/`IDENTITY` from `src/geom/mat.ts`.
- Produces: `BoolRefusal`, `BoolOutcome`, `booleanRefusal(doc, ids)`, `booleanShapes(doc, ids, op)`.

- [ ] **Step 1: Write the failing tests** — `src/__tests__/boolean-edit.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Node, type Style } from "../doc/document";
import { booleanShapes } from "../doc/boolean-edit";
import { IDENTITY, translate } from "../geom/mat";
import { findNode } from "../doc/tree";

const paint = (c: string): Style => ({ ...DEFAULT_STYLE, fill: { color: c, opacity: 1 } });
const rect = (id: string, x: number, y: number, w: number, h: number, style = DEFAULT_STYLE, t = IDENTITY): Node => ({
  kind: "rect", id, transform: t, style, x, y, w, h, rx: 0,
});
const doc = (children: Node[]): Doc => {
  const d = createDoc(200, 200);
  return { ...d, layers: [{ ...d.layers[0], id: "L0", children }] };
};

describe("booleanShapes", () => {
  it("replaces the inputs with one path in the frontmost's place", async () => {
    const d = doc([rect("a", 0, 0, 60, 60, paint("#111111")), rect("b", 40, 40, 60, 60, paint("#222222"))]);
    const out = await booleanShapes(d, ["a", "b"], "unite");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const kids = out.doc.layers[0].children;
    expect(kids).toHaveLength(1);
    expect(kids[0].kind).toBe("path");
    // The frontmost input keeps its id and place, and its style wins.
    expect(kids[0].id).toBe("b");
    expect(kids[0].kind === "path" && kids[0].style.fill?.color).toBe("#222222");
  });

  it("subtracts the front from the back and keeps the back's style", async () => {
    const d = doc([rect("back", 0, 0, 100, 100, paint("#aaaaaa")), rect("front", 40, 40, 20, 20, paint("#bbbbbb"))]);
    const out = await booleanShapes(d, ["back", "front"], "subtract");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const p = out.doc.layers[0].children[0];
    // A hole: the outer ring plus the cut-out.
    expect(p.kind === "path" && p.subpaths).toHaveLength(2);
    expect(p.kind === "path" && p.style.fill?.color).toBe("#aaaaaa");
  });

  it("works in document space when the inputs carry transforms", async () => {
    // Identical rects, one placed by its own transform: they must overlap after mapping.
    const d = doc([rect("a", 0, 0, 60, 60), rect("b", 0, 0, 60, 60, DEFAULT_STYLE, translate(40, 40))]);
    const out = await booleanShapes(d, ["a", "b"], "intersect");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const p = out.doc.layers[0].children[0];
    expect(p.kind === "path" && p.transform).toEqual(IDENTITY);
    const xs = p.kind === "path" ? p.subpaths[0].nodes.map((n) => n.p.x) : [];
    expect(Math.min(...xs)).toBeCloseTo(40, 6);
    expect(Math.max(...xs)).toBeCloseTo(60, 6);
  });

  it("refuses fewer than two, a group, and an open path", async () => {
    const d = doc([rect("a", 0, 0, 10, 10)]);
    expect(await booleanShapes(d, ["a"], "unite")).toEqual({ kind: "refused", why: "few" });
    const g = doc([
      rect("a", 0, 0, 10, 10),
      { kind: "group", id: "g", transform: IDENTITY, opacity: 1, children: [rect("c", 0, 0, 5, 5)] },
    ]);
    expect(await booleanShapes(g, ["a", "g"], "unite")).toEqual({ kind: "refused", why: "group" });
    const open = doc([
      rect("a", 0, 0, 10, 10),
      { kind: "path", id: "p", transform: IDENTITY, style: DEFAULT_STYLE,
        subpaths: [{ closed: false, nodes: [
          { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
          { p: { x: 9, y: 9 }, in: null, out: null, type: "corner" }] }] },
    ]);
    expect(await booleanShapes(open, ["a", "p"], "unite")).toEqual({ kind: "refused", why: "open" });
  });

  it("leaves the document alone when nothing is left", async () => {
    const d = doc([rect("a", 0, 0, 10, 10), rect("b", 50, 50, 10, 10)]);
    expect(await booleanShapes(d, ["a", "b"], "intersect")).toEqual({ kind: "empty" });
  });

  it("converts a rect and an ellipse before combining", async () => {
    const d = doc([
      rect("a", 0, 0, 60, 60),
      { kind: "ellipse", id: "e", transform: IDENTITY, style: DEFAULT_STYLE, cx: 60, cy: 30, rx: 25, ry: 25 },
    ]);
    const out = await booleanShapes(d, ["a", "e"], "unite");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const p = out.doc.layers[0].children[0];
    expect(p.kind).toBe("path");
    expect(p.kind === "path" && p.subpaths[0].nodes.some((n) => n.in !== null)).toBe(true);
  });

  it("keeps the result inside the group the frontmost input was in", async () => {
    const d = doc([
      { kind: "group", id: "g", transform: translate(100, 0), opacity: 1,
        children: [rect("a", 0, 0, 60, 60), rect("b", 40, 40, 60, 60)] },
    ]);
    const out = await booleanShapes(d, ["a", "b"], "unite");
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const g = out.doc.layers[0].children[0];
    expect(g.kind === "group" && g.children).toHaveLength(1);
    // Expressed in the group's space, so it renders where the originals were.
    const inner = findNode(out.doc, "b");
    const xs = inner && inner.node.kind === "path" ? inner.node.subpaths[0].nodes.map((n) => n.p.x) : [];
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/__tests__/boolean-edit.test.ts`
Expected: FAIL — `../doc/boolean-edit` does not exist.

- [ ] **Step 3: Implement** — `src/doc/boolean-edit.ts`

```ts
import { booleanOf, type BoolOp } from "../geom/boolean";
import { applyMat, invert, multiply, IDENTITY } from "../geom/mat";
import { toPath } from "../geom/shapes";
import type { Doc, Node, PathShape, Subpath } from "./document";
import { deleteNodes } from "./edits";
import { findNode, mapNodes } from "./tree";

/** Why an operation cannot run (spec M7 §7). */
export type BoolRefusal = "few" | "group" | "open";

export type BoolOutcome =
  | { kind: "ok"; doc: Doc; id: string }
  /** The operation ran and left no area: the document must not change (spec M7 §7). */
  | { kind: "empty" }
  | { kind: "refused"; why: BoolRefusal };

/** Paint order: later children sit in front, so the greatest key is the frontmost. */
const order = (layerIndex: number, path: readonly number[]) => [layerIndex, ...path];
const after = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x > y;
  }
  return false;
};

const mapSubpath = (sp: Subpath, m: import("../geom/mat").Mat): Subpath => ({
  closed: sp.closed,
  nodes: sp.nodes.map((n) => ({
    ...n,
    p: applyMat(m, n.p),
    in: n.in ? applyMat(m, n.in) : null,
    out: n.out ? applyMat(m, n.out) : null,
  })),
});

/** The one place that decides whether an operation can run, so the menus and the edit itself can
 *  never disagree about it (spec M7 §7). */
export function booleanRefusal(doc: Doc, ids: readonly string[]): BoolRefusal | null {
  const found = ids.flatMap((id) => findNode(doc, id) ?? []);
  if (found.length < 2) return "few";
  if (found.some((f) => f.node.kind === "group")) return "group";
  const open = found.some(
    (f) => f.node.kind === "path" && f.node.subpaths.some((sp) => !sp.closed),
  );
  return open ? "open" : null;
}

/** Spec (M7) §4–§7. Combines the selected shapes and returns a new document, or says why not. */
export async function booleanShapes(
  doc: Doc,
  ids: readonly string[],
  op: BoolOp,
): Promise<BoolOutcome> {
  const why = booleanRefusal(doc, ids);
  if (why) return { kind: "refused", why };
  const found = ids.flatMap((id) => findNode(doc, id) ?? []);

  const shapes = found.map((f) => ({
    found: f,
    path: f.node.kind === "path" ? f.node : toPath(f.node as Parameters<typeof toPath>[0]),
    key: order(f.layerIndex, f.path),
  }));

  // Front to back by paint order, so the operands go into paper in the order the user sees.
  const back = shapes.reduce((a, b) => (after(a.key, b.key) ? b : a));
  const front = shapes.reduce((a, b) => (after(a.key, b.key) ? a : b));
  const ordered = op === "subtract" ? [back, ...shapes.filter((s) => s !== back)] : shapes;

  const operands: Subpath[][] = [];
  for (const s of ordered) {
    const world = multiply(s.found.parent, s.path.transform);
    operands.push(s.path.subpaths.map((sp) => mapSubpath(sp, world)));
  }
  const result = await booleanOf(operands, op);
  if (result.length === 0) return { kind: "empty" };

  // The result lands where the frontmost input was, so it must be expressed in that node's parent
  // space rather than in document space.
  const toParent = invert(front.found.parent);
  if (!toParent) return { kind: "empty" };
  // Subtract's front shape is the knife: only the backmost shape's area survives, so its style is
  // the one still on screen (spec M7 §4).
  const styleFrom = op === "subtract" ? back : front;
  const shape: PathShape = {
    kind: "path",
    id: front.path.id,
    transform: IDENTITY,
    style: styleFrom.path.style,
    subpaths: result.map((sp) => mapSubpath(sp, toParent)),
  };
  const replaced = mapNodes(doc, [front.path.id], () => shape as Node);
  const others = shapes.filter((s) => s !== front).map((s) => s.path.id);
  return { kind: "ok", doc: deleteNodes(replaced, others), id: shape.id };
}
```

Note what the `order`/`after` pair is for: `findNode` gives a layer index and a path of child
indices, and paint order is that tuple compared left to right — the greatest is the frontmost. The
result is written into the **frontmost input's** place, which is why it takes that node's id, and
why its subpaths are mapped back through the inverse of that node's parent matrix: an identity
transform inside a transformed group would otherwise render in the wrong place.

- [ ] **Step 4: Verify**

Run the Step 2 command, then `npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(doc): combine the selected shapes into one path

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The store action and the applies-to flag

**Files:**
- Modify: `src/state/appState.svelte.ts`, `src/state/properties.ts`

**Interfaces:**
- Produces: `booleanSelection(op: BoolOp): Promise<void>`; `SelectionActions` gains
  `booleanRefusal: BoolRefusal | null`.

- [ ] **Step 1: Implement**

In `src/state/appState.svelte.ts`, beside the other selection actions:

```ts
/** Spec (M7) §4. One operation is one commit and one undo step; a refusal or an empty result says
 *  so and leaves the document alone. */
export async function booleanSelection(op: BoolOp): Promise<void> {
  cancelActiveGesture();
  const out = await booleanShapes(app.doc, app.selection, op);
  if (out.kind === "refused") {
    notify("info", `${BOOL_LABEL[op]} — ${BOOL_REASON[out.why]}`);
    return;
  }
  if (out.kind === "empty") {
    notify("info", `${BOOL_LABEL[op]} left nothing.`);
    return;
  }
  commitDoc(out.doc);
  setSelection([out.id]);
}
```

with `import { booleanShapes } from "../doc/boolean-edit";` and
`import { BOOL_LABEL, BOOL_REASON, type BoolOp } from "../geom/boolean";`.

In `src/state/properties.ts`, `SelectionActions` gains one field and `selectionActions` one line:

```ts
  /** null when a boolean operation can run; otherwise why it cannot (spec M7 §7). */
  booleanRefusal: BoolRefusal | null;
```

```ts
    booleanRefusal: booleanRefusal(doc, ids),
```

with `import { booleanRefusal, type BoolRefusal } from "../doc/boolean-edit";`. This keeps the one
predicate between the menus and the edit, so a command can never be offered and then refuse.

- [ ] **Step 2: Verify**

`npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`. The suite should be unchanged in count: this task adds no test of its own, because everything it wires is covered by Tasks 1 and 2 and by the browser pass.

- [ ] **Step 3: Commit**

```bash
git add -A src
git commit -m "feat(state): run a boolean operation on the selection

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The Path menu and the icons

**Files:**
- Modify: `src/lib/TopBar.svelte`

- [ ] **Step 1: Implement**

Everything this task needs already exists in that file: `actions` (derived from `selectionActions`),
`mod`/`shiftMod`, the File and Select menus to copy, and `IconButton`.

Add to the script block:

```ts
  let pathOpen = $state(false);

  const boolReason = $derived(
    actions.booleanRefusal === null ? null : BOOL_REASON[actions.booleanRefusal],
  );

  const BOOL_ICON = { unite: Combine, subtract: SquareMinus, intersect: Blend, exclude: SquareSlash };

  /** Close the menu, then act — the same order the File menu uses. */
  function runPath(op: BoolOp) {
    pathOpen = false;
    void booleanSelection(op);
  }
```

`booleanSelection` joins the `../state/appState.svelte` import list (it is alphabetical: it goes
after `app`), `Blend`, `Combine`, `SquareMinus` and `SquareSlash` join the `@lucide/svelte` import,
and `BOOL_LABEL`, `BOOL_OPS`, `BOOL_REASON`, `BOOL_TITLE` and `type BoolOp` come from
`../geom/boolean`.

**The Path menu** goes after the Select menu's wrapper `</div>`, built exactly like it — same button
classes, same `aria-haspopup`/`aria-expanded`, same backdrop, same panel classes. Its button closes
the other two menus when it opens (`menuOpen = false; selectOpen = false;`), and the other two must
close it. The entries:

```svelte
        {#each BOOL_OPS as op (op)}
          <button
            class="menu-item"
            role="menuitem"
            aria-disabled={boolReason !== null}
            title={boolReason === null ? BOOL_TITLE[op] : `${BOOL_LABEL[op]} — ${boolReason}`}
            onclick={() => boolReason === null && runPath(op)}
          >
            {BOOL_LABEL[op]}
          </button>
        {/each}
```

**The four icons** go immediately after the Ungroup `IconButton`, before the `<span class="bar-sep">`
that follows it:

```svelte
  <!-- The bar already carries 18 icons and three menus; four more do not fit at iPad-portrait
       widths, and it must never wrap or scroll (M2e). They appear where there is room, and the
       Path menu carries them at every width (spec M7 §6). -->
  <span class="hidden min-[900px]:contents">
    {#each BOOL_OPS as op (op)}
      <IconButton
        label={BOOL_LABEL[op]}
        title={BOOL_TITLE[op]}
        icon={BOOL_ICON[op]}
        disabled={boolReason !== null}
        disabledTitle="{BOOL_LABEL[op]} — {boolReason}"
        onclick={() => void booleanSelection(op)}
      />
    {/each}
  </span>
```

`contents` rather than `flex` on that wrapper matters: the icons must sit in the header's own flex
row, sharing its `gap-1`, not in a nested box of their own.

- [ ] **Step 2: Verify**

`npm run build` (0 / 0), `npm run lint`, `npm run format:check`, `npm test` (unchanged).

**This is the task where the bundle split becomes real**, because this is the first code that calls
`booleanSelection`. `dist/assets/` must now hold **two** JavaScript chunks: the app's, still about
71 KB gzipped, and paper's, about 72 KB. Record both. One chunk here means the dynamic import was
defeated — check that nothing added a static `import ... from "paper..."` anywhere.

Then a dev-server compile check on port **5197**: start `npx vite --port 5197 --strictPort` yourself,
`curl` the transformed module URL for `src/lib/TopBar.svelte`, confirm 200 with no error payload,
and stop the server you started. It needs the sandbox disabled. **Never use port 5173 or 5198**, and
if a port is busy pick another — **never kill the process holding it**.

- [ ] **Step 3: Commit**

```bash
git add -A src
git commit -m "feat(ui): a Path menu and four boolean icons

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The context menu

**Files:**
- Modify: `src/lib/ContextMenu.svelte`

- [ ] **Step 1: Implement**

The four commands go in their own section **above** the selection commands M6 added — so the order
down the menu is: the shape actions, the boolean section, then Select All and the rest. Hidden
entirely when they do not apply, which is this menu's pattern:

```svelte
    {#if actions.booleanRefusal === null}
      <div class="my-1 h-px bg-line"></div>
      {#each BOOL_OPS as op (op)}
        <button
          class="menu-item"
          role="menuitem"
          onclick={() => run(() => void booleanSelection(op))}
        >
          {BOOL_LABEL[op]}
        </button>
      {/each}
    {/if}
```

Place it immediately before the `<div class="my-1 h-px bg-line"></div>` that precedes
`{#if allIds(app.doc, app.enteredGroupId).length > 0}`. `booleanSelection` joins the
`../state/appState.svelte` import after `app`; `BOOL_LABEL` and `BOOL_OPS` come from
`../geom/boolean`.

- [ ] **Step 2: Verify**

`npm run build` (0 / 0), `npm run lint`, `npm run format:check`, `npm test` (unchanged), and the same
dev-server compile check as Task 4 for `src/lib/ContextMenu.svelte`, on port 5197.

- [ ] **Step 3: Commit**

```bash
git add -A src
git commit -m "feat(ui): boolean operations in the context menu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Controller browser pass (between Task 5 and Task 6)

The controller runs this on `npx vite --port 5198 --strictPort`, with screenshots, and stops the server afterwards.

1. **Subtract** an overlapping front shape from a back one: one path, the back shape's style, one undo step, selected afterwards.
2. **A hole**: a small shape fully inside a large one, subtracted — two subpaths, and it must *render* as a hole rather than filling solid. Screenshot.
3. **Save and reload** that holed path: nothing dropped, still two subpaths.
4. **Unite, Intersect and Exclude** on overlapping shapes.
5. **A rect and an ellipse** combined without converting them by hand first.
6. **Refusals**: one shape selected, a group selected, an open path selected — each notice verbatim.
7. **An empty result**: intersect two disjoint shapes — the notice appears and the document is the *same reference*.
8. **The icons are absent at 768 px** and the Path menu still offers everything.
9. **The network panel or the chunk list** shows paper arriving only on the first operation.
10. No console errors.

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`

- [ ] **Step 1: `CLAUDE.md`**

- Update the `npm test` count.
- Add `boolean-edit.ts` to the `src/doc/` line and `boolean.ts` to the `src/geom/` line of the architecture map.
- Add an invariant covering: Paper is loaded on first use and only `src/geom/boolean.ts` may import it; the import specifier has no extension and the default entry must not be used; operands are mapped into document space and the result back into the frontmost input's parent space; an operation that leaves no area must leave the document untouched; and `booleanRefusal` is the one predicate both menus and the edit share.
- Add a line to the Commands section: the build now emits two chunks, and the app's own must stay near 69 KB gzipped.
- Move "Current state" to milestone 7 and name what is next from the post-v1 list.

- [ ] **Step 2: `README.md`**

- Update the test count.
- Add the four operations to the feature list, saying the result replaces the shapes and undo brings them back.

- [ ] **Step 3: `docs/superpowers/CHANGELOG.md`**

Append a milestone 7 entry — append-only. Cover: the four operations and what each keeps; Subtract's direction and why it keeps the backmost style; that shapes convert automatically and groups and open paths are refused; the document-space round trip; Paper as a geometry-only helper loaded on first use, with the measured before/after of both chunks; the Path menu plus icons above 900 px and why the icons are not unconditional; and the empty-result rule. Add a `Browser-verified:` line the controller fills in, and an `Owed:` line (the iPad pass now also covers the Path menu; performance on heavy paths is unmeasured).

- [ ] **Step 4: Verify and commit**

`npm test`, `npm run build` (0 / 0), `npm run lint`, `npm run format:check`.

```bash
git add -A
git commit -m "docs: milestone 7 boolean operations

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
