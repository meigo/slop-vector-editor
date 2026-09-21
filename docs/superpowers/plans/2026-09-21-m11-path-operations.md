# M11 Path Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five operations in the Path menu — Subdivide, Reverse direction, Break apart, Combine and Simplify — beside the four booleans M7 put there.

**Architecture:** Four of the five are synchronous, pure document edits built on machinery that already exists (`splitCubic`, `reverseSubpath`, `findNode`/`mapNodes`, `deleteNodes`). The fifth, Simplify, calls Paper's own `simplify(tolerance)` through the conversion layer M7 built, which this plan first extracts from `src/geom/boolean.ts` into `src/geom/paper.ts` so two callers can share it instead of copying it. No new algorithm, and no file format change.

**Tech Stack:** Svelte 5 (runes), TypeScript strict, Vite, Tailwind 4, Vitest (node env, no DOM), `paper/dist/paper-core` as a dynamically-imported lazy chunk.

**Spec:** `docs/superpowers/specs/2026-09-21-m11-path-operations-design.md`

## Global Constraints

- **The document is immutable** (invariant 1). Edits return new objects; an edit that changes nothing returns the **same reference**.
- **The store is `app`, in `$state.raw` fields.** Replace, never mutate (invariant 2).
- **Node/Vitest has no DOM.** Only pure modules are unit-tested.
- **TypeScript strict**, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Build bar: **0 errors, 0 warnings** (`npm run build`).
- **Paper may be imported by exactly one module, dynamically, on first use** (invariant 37). This plan moves that module from `src/geom/boolean.ts` to `src/geom/paper.ts`; the specifier stays `paper/dist/paper-core` with **no file extension**, never the package default `paper`.
- **Paper items must be created with `insert: false`**, or the module-level project grows for the life of the page.
- **No edit may leave** a subpath with fewer than two nodes, a path with no subpaths, or a closed subpath whose last node repeats its first (invariant 30).
- **No edit may leave an empty group** (invariant 27).
- **A node's transform is in its parent's space** (invariant 26). Document-space work goes through the world matrix `multiply(found.parent, node.transform)`.
- **Any structural edit of a path drops its `text`** (invariant 40). `path-edit.ts` funnels through `withSubpaths`; newly-built nodes simply omit the field.
- **Every session change goes through `setSession`** (invariant 13); store document edits call `cancelActiveGesture()` first (invariant 15).
- **Every `title` is also a status-bar hint** (invariant 24). Commands that don't apply use `aria-disabled` with a reason title, never `disabled`.
- **No new top-bar icons and no new keyboard shortcuts** (spec §7). The bar's four hiding breakpoints are measured and it currently fits at 739px; adding icons invalidates all of them.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
|---|---|
| `src/geom/paper.ts` | **New.** The only importer of paper: `loadPaper()`, `toPaperItem`, `fromPaperItem`, and the `Paper*` types. |
| `src/geom/boolean.ts` | **Modified.** Keeps `booleanOf` and the `BoolOp` vocabulary; loses the loader and conversion to `paper.ts`. |
| `src/geom/simplify.ts` | **New.** `simplifyOf(subpaths, tolerance)`. |
| `src/doc/path-edit.ts` | **Modified.** Adds the two pure per-path edits: `subdividePath`, `reversePath`. |
| `src/doc/tree.ts` | **Modified.** Adds `replaceNode` (1→N in place) and the shared paint-order helpers `paintKey` / `isAfter`. |
| `src/doc/boolean-edit.ts` | **Modified.** Uses the shared paint-order helpers and `transformSubpaths` instead of its own private copies. |
| `src/doc/path-ops.ts` | **New.** Document-level `subdivideSelection`, `reverseSelection`, `breakApart`, `combine`, their refusal predicates, and the labels/titles/reasons. |
| `src/doc/simplify-edit.ts` | **New.** `simplifyShapes` — the async outcome type, mirroring `boolean-edit.ts`. |
| `src/state/appState.svelte.ts` | **Modified.** Five store actions. |
| `src/lib/TopBar.svelte` | **Modified.** Five Path-menu entries below the booleans. |

---

### Task 1: Extract `src/geom/paper.ts`

A pure refactor: no behaviour changes and no new tests. Its proof is that `boolean.test.ts` stays green **unchanged**, which is the whole reason for extracting rather than copying.

**Files:**
- Create: `src/geom/paper.ts`
- Modify: `src/geom/boolean.ts`
- Modify: `CLAUDE.md` (invariant 37 and the `npm run build` bar)
- Test: `src/__tests__/boolean.test.ts` (unchanged — must still pass)

**Interfaces:**
- Consumes: nothing.
- Produces: `loadPaper(): Promise<Paper>`, `toPaperItem(P: Paper, subpaths: readonly Subpath[]): PaperItem`, `fromPaperItem(item: PaperItem): Subpath[]`, and exported types `Paper`, `PaperPath`, `PaperItem`, `PaperSegment`.

- [ ] **Step 1: Run the boolean tests first, to have a green baseline**

Run: `npx vitest run src/__tests__/boolean.test.ts`
Expected: PASS. Note the test count — it must be identical at the end of this task.

- [ ] **Step 2: Create `src/geom/paper.ts` with the loader, the conversion and the types**

Move these **verbatim** out of `src/geom/boolean.ts`: the four type aliases, the `MIRROR` constant, `loading`/`load`, `toPaperPath`, `toPaperItem`, `nodeFrom`, `fromPaperItem`. Rename only `load` → `loadPaper`, and export what `boolean.ts` and `simplify.ts` need.

```ts
import type { PathNode, Subpath } from "../doc/document";

/** The module's own types, taken from the dynamic import so nothing is imported at load time. */
export type Paper = typeof import("paper/dist/paper-core");
export type PaperPath = InstanceType<Paper["Path"]>;
export type PaperItem = InstanceType<Paper["PathItem"]>;
export type PaperSegment = InstanceType<Paper["Segment"]>;

/** Two handles that mirror each other about the point are a symmetric node. This is not the
 *  importer's rule: `inferNodeTypes` never emits `symmetric` and tests collinearity at 1e-3, while
 *  this tests the mirror at 1e-6. */
const MIRROR = 1e-6;

/** Paper is ~72 KB gzipped — as much as the rest of the app — and the operations that need it are
 *  rare, so it is fetched on first use rather than at load (spec M7 §2, M11 §6). **This module is
 *  the only importer of paper** (invariant 37); the refusal rules the menus need are pure, so no
 *  menu ever waits on this.
 *
 *  The *promise* is cached, not the module: a value cached after the await would let two
 *  overlapping first calls both fall through the guard and each run `setup()`, leaving a spare
 *  project behind for the life of the page. A rejection clears the cache again, so a failed
 *  download leaves the next attempt free to re-fetch instead of being dead for that tab. */
let loading: Promise<Paper> | null = null;
export function loadPaper(): Promise<Paper> {
  loading ??= import("paper/dist/paper-core")
    .then((mod) => {
      const p = (mod as unknown as { default?: Paper }).default ?? (mod as unknown as Paper);
      // No canvas and no DOM: paper only ever does geometry here.
      p.setup(new p.Size(1, 1));
      return p;
    })
    .catch((e: unknown) => {
      loading = null;
      throw e;
    });
  return loading;
}

/** Our handles are absolute in the shape's own space; paper's are relative to the segment point. */
function toPaperPath(P: Paper, sp: Subpath): PaperPath {
  return new P.Path({
    // Never attach to paper's project: an item created here would stay in the module-level project
    // for the life of the page, and there would be nothing to clean it up if an operation threw.
    insert: false,
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

export function toPaperItem(P: Paper, subpaths: readonly Subpath[]): PaperItem {
  const paths = subpaths.map((sp) => toPaperPath(P, sp));
  return paths.length === 1 ? paths[0] : new P.CompoundPath({ children: paths, insert: false });
}

/** The `Path` children of an item, so a caller can act on each one. A lone `Path` is its own only
 *  child here; paper puts `simplify` on `Path`, not on `CompoundPath`. */
export function paperPaths(item: PaperItem): PaperPath[] {
  return "children" in item && item.children
    ? (item.children as PaperPath[])
    : [item as PaperPath];
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

export function fromPaperItem(item: PaperItem): Subpath[] {
  return paperPaths(item)
    .filter((p) => p.segments && p.segments.length >= 2)
    .map((p) => ({ nodes: p.segments.map(nodeFrom), closed: p.closed }));
}
```

- [ ] **Step 3: Reduce `src/geom/boolean.ts` to the operation and its vocabulary**

Delete everything moved in Step 2 and import it instead. The file keeps `BoolOp`, `BOOL_LABEL`, `BOOL_OPS`, `BOOL_TITLE`, `BOOL_REASON` and `booleanOf` exactly as they are. Replace the file's head and tail with:

```ts
import type { Subpath } from "../doc/document";
import { fromPaperItem, loadPaper, toPaperItem } from "./paper";

/** Spec (M7) §4. */
export type BoolOp = "unite" | "subtract" | "intersect" | "exclude";
```

…and the operation itself, unchanged but for the loader's name:

```ts
/** Spec (M7) §4. Every operand is in document space already. Returns [] when the result is empty —
 *  the caller must leave the document alone rather than write a path the importer would drop. */
export async function booleanOf(
  operands: readonly (readonly Subpath[])[],
  op: BoolOp,
): Promise<Subpath[]> {
  const P = await loadPaper();
  const items = operands.map((o) => toPaperItem(P, o));
  let acc = items[0];
  // The result is not inserted either, for the same reason.
  for (const next of items.slice(1)) acc = acc[op](next, { insert: false });
  return fromPaperItem(acc);
}
```

- [ ] **Step 4: Run the boolean tests unchanged**

Run: `npx vitest run src/__tests__/boolean.test.ts`
Expected: PASS, with **the same test count as Step 1**. Do not edit the test file. In particular do not reorder it — its first test must stay first or it silently becomes a tautology.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass; build reports 0 errors and 0 warnings; `dist/assets/` still contains a separate `paper-core-*.js` chunk (~72 KB gzipped). If paper has landed in the app chunk, something imported `./paper` statically from a module that is itself eagerly loaded — check the import is still `await import(...)` inside `loadPaper`.

- [ ] **Step 6: Update CLAUDE.md so a correct build stops looking like a violation**

In the `npm run build` bullet, change "Either appearing in the app chunk means something outside `src/geom/boolean.ts` or `src/text/font.ts` imported it statically" to name **`src/geom/paper.ts`** instead of `src/geom/boolean.ts`.

In invariant 37, change the opening to:

```
37. **Paper is loaded on first use, and only `src/geom/paper.ts` may import it** (spec M7 §2,
    M11 §6). That module holds the loader and the two-way conversion; `src/geom/boolean.ts`
    (`booleanOf`) and `src/geom/simplify.ts` (`simplifyOf`) are its callers, and neither imports
    paper itself. The specifier is `paper/dist/paper-core`, with **no file extension** …
```

Leave the rest of invariant 37 as it is.

- [ ] **Step 7: Commit**

```bash
git add src/geom/paper.ts src/geom/boolean.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
refactor: extract the paper loader and conversion into geom/paper.ts

Simplify needs the same two-way conversion booleanOf uses, and copying it
is the drift invariant 37 exists to prevent. boolean.test.ts passes
unchanged, which is the point of extracting rather than copying.

Invariant 37 and the build bar now name geom/paper.ts, so a correct
build stops reading as a violation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `subdividePath` and `reversePath`

The two pure, per-path edits. Both live in `path-edit.ts` beside the node edits they resemble, and both go through the existing `withSubpaths` funnel, so both drop a title's `text` (invariant 40).

**Files:**
- Modify: `src/doc/path-edit.ts`
- Test: `src/__tests__/path-edit.test.ts`

**Interfaces:**
- Consumes: `segmentCubic`, `splitCubic` from `../geom/bezier` (already imported by this file); `reverseSubpath` (already in this file).
- Produces: `subdividePath(path: PathShape): PathShape`, `reversePath(path: PathShape): PathShape`.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/path-edit.test.ts`. Add `reversePath` and `subdividePath` to the existing import block from `../doc/path-edit`.

```ts
const style = DEFAULT_STYLE;
const mk = (subpaths: Subpath[]): PathShape => ({
  kind: "path",
  id: "p1",
  transform: [1, 0, 0, 1, 0, 0],
  style,
  subpaths,
});

/** A cubic quarter-ish arc, so handles are non-null and asymmetric. */
const curved: Subpath = {
  closed: false,
  nodes: [
    { p: { x: 0, y: 0 }, in: null, out: { x: 10, y: 0 }, type: "corner" },
    { p: { x: 30, y: 30 }, in: { x: 30, y: 10 }, out: null, type: "corner" },
  ],
};

const square: Subpath = {
  closed: true,
  nodes: [
    { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
    { p: { x: 10, y: 0 }, in: null, out: null, type: "corner" },
    { p: { x: 10, y: 10 }, in: null, out: null, type: "corner" },
    { p: { x: 0, y: 10 }, in: null, out: null, type: "corner" },
  ],
};

describe("subdividePath", () => {
  it("gains one node per segment: an open subpath of n nodes comes back with 2n - 1", () => {
    const out = subdividePath(mk([curved]));
    expect(out.subpaths[0].nodes).toHaveLength(3);
  });

  it("gains one node per segment: a closed subpath of n nodes comes back with 2n", () => {
    const out = subdividePath(mk([square]));
    expect(out.subpaths[0].nodes).toHaveLength(8);
    expect(out.subpaths[0].closed).toBe(true);
  });

  it("does not move the curve: the midpoint of the original is the inserted node", () => {
    const out = subdividePath(mk([curved]));
    // de Casteljau at t = 0.5 of [(0,0) (10,0) (30,10) (30,30)]
    const mid = out.subpaths[0].nodes[1].p;
    expect(mid.x).toBeCloseTo(17.5, 10);
    expect(mid.y).toBeCloseTo(6.25, 10);
  });

  it("inserts a symmetric node, because a midpoint split mirrors its handles", () => {
    const out = subdividePath(mk([curved]));
    const n = out.subpaths[0].nodes[1];
    expect(n.type).toBe("symmetric");
    expect(n.in!.x + n.out!.x).toBeCloseTo(2 * n.p.x, 10);
    expect(n.in!.y + n.out!.y).toBeCloseTo(2 * n.p.y, 10);
  });

  it("keeps a straight segment straight, with a handle-free midpoint", () => {
    const out = subdividePath(mk([square]));
    const n = out.subpaths[0].nodes[1];
    expect(n.p).toEqual({ x: 5, y: 0 });
    expect(n.in).toBeNull();
    expect(n.out).toBeNull();
    expect(n.type).toBe("corner");
  });

  it("keeps each existing node's declared type, because handles halve without turning", () => {
    const sp: Subpath = {
      closed: false,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: { x: 10, y: 0 }, type: "smooth" },
        { p: { x: 30, y: 30 }, in: { x: 30, y: 10 }, out: null, type: "symmetric" },
      ],
    };
    const out = subdividePath(mk([sp]));
    expect(out.subpaths[0].nodes[0].type).toBe("smooth");
    expect(out.subpaths[0].nodes[2].type).toBe("symmetric");
  });

  it("subdivides the wrap segment of a closed subpath", () => {
    const out = subdividePath(mk([square]));
    // The last node is the midpoint of the wrap segment (0,10) -> (0,0).
    expect(out.subpaths[0].nodes[7].p).toEqual({ x: 0, y: 5 });
  });

  it("drops a title's text, because the geometry is hand-edited from now on", () => {
    const titled: PathShape = { ...mk([curved]), text: { seed: 1 } as never };
    expect(subdividePath(titled).text).toBeUndefined();
  });
});

describe("reversePath", () => {
  it("visits the points in the opposite order with handles swapped", () => {
    const out = reversePath(mk([curved]));
    const n = out.subpaths[0].nodes;
    expect(n[0].p).toEqual({ x: 30, y: 30 });
    expect(n[0].out).toEqual({ x: 30, y: 10 });
    expect(n[1].in).toEqual({ x: 10, y: 0 });
  });

  it("is the identity when applied twice", () => {
    const start = mk([curved, square]);
    const out = reversePath(reversePath(start));
    expect(out.subpaths).toEqual(start.subpaths);
  });

  it("reverses every subpath, not just the first", () => {
    const out = reversePath(mk([curved, square]));
    expect(out.subpaths[1].nodes[0].p).toEqual({ x: 0, y: 10 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/path-edit.test.ts`
Expected: FAIL — `subdividePath is not a function`, `reversePath is not a function`.

- [ ] **Step 3: Implement both, at the end of `src/doc/path-edit.ts`**

```ts
/** Spec (M11) §5. Splits one subpath's every segment at `t = 0.5`, the wrap segment of a closed
 *  subpath included.
 *
 *  Each node's `in` comes from the segment that *ends* at it and its `out` from the segment that
 *  *starts* there, so the incoming handle is only known one iteration late — hence `pendingIn`. */
function subdivideSubpath(sp: Subpath): Subpath {
  const n = sp.nodes;
  if (n.length < 2) return sp;
  const segments = sp.closed ? n.length : n.length - 1;
  const out: PathNode[] = [];
  let pendingIn: Vec | null = null;
  for (let s = 0; s < segments; s++) {
    const a = n[s];
    const b = n[(s + 1) % n.length];
    const c = segmentCubic(a, b);
    if (c) {
      const [L, R] = splitCubic(c, 0.5);
      out.push({ ...a, in: s === 0 ? a.in : pendingIn, out: L[1] });
      // A midpoint split leaves the two halves' handles mirrored about the new point, which is
      // exactly what `symmetric` asserts — so it is a fact here, not a guess.
      out.push({ p: L[3], in: L[2], out: R[1], type: "symmetric" });
      pendingIn = R[2];
    } else {
      out.push({ ...a, in: s === 0 ? a.in : pendingIn, out: null });
      out.push({
        p: { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2 },
        in: null,
        out: null,
        type: "corner",
      });
      pendingIn = null;
    }
  }
  if (sp.closed) {
    // Node 0's incoming handle comes from the wrap segment, which is only fitted at the very end.
    out[0] = { ...out[0], in: pendingIn };
  } else {
    // An open subpath's final anchor starts no segment, so the loop never pushed it.
    const last = n[n.length - 1];
    out.push({ ...last, in: pendingIn });
  }
  return { ...sp, nodes: out };
}

/** Spec (M11) §5. The geometry is unchanged **exactly**, not within a tolerance: de Casteljau at
 *  one half halves every existing handle without turning it, so collinearity survives and each
 *  existing node keeps its declared type. This is the opposite of the warp's rule (M12 §4), which
 *  must recompute types because a non-affine map breaks collinearity. */
export function subdividePath(path: PathShape): PathShape {
  let changed = false;
  const subpaths = path.subpaths.map((sp) => {
    const next = subdivideSubpath(sp);
    if (next !== sp) changed = true;
    return next;
  });
  return withSubpaths(path, subpaths, changed);
}

/** Spec (M11) §4. Reverses every subpath. Under nonzero winding — which is all this app has, since
 *  `Style` carries no `fill-rule` — this is what turns a combined inner subpath into a hole. */
export function reversePath(path: PathShape): PathShape {
  let out = path;
  for (let i = 0; i < path.subpaths.length; i++) out = reverseSubpath(out, i);
  return out;
}
```

`Vec` is already imported as a type at the top of the file; `PathNode` is too.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/path-edit.test.ts`
Expected: PASS, including the pre-existing `reverseSubpath` tests at line 233.

- [ ] **Step 5: Commit**

```bash
git add src/doc/path-edit.ts src/__tests__/path-edit.test.ts
git commit -m "$(cat <<'EOF'
feat: subdividePath and reversePath

Subdivide splits every segment at t = 0.5. The geometry is unchanged
exactly, not within a tolerance: a midpoint split halves each existing
handle without turning it, so every node keeps its declared type and the
inserted node is symmetric by construction.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `replaceNode`, and shared paint-order helpers

Break apart needs to put N nodes where one was, keeping the parent and the z-position. `mapNodes` is 1→1 and `insertNodes` appends to a layer, so neither can express it. Combine needs the frontmost-operand rule, which today is private to `boolean-edit.ts`.

**Files:**
- Modify: `src/doc/tree.ts`
- Modify: `src/doc/boolean-edit.ts`
- Test: `src/__tests__/tree-edits.test.ts`

**Interfaces:**
- Consumes: `Doc`, `Node` from `./document`.
- Produces: `replaceNode(doc: Doc, id: string, nodes: readonly Node[]): Doc`, `paintKey(layerIndex: number, path: readonly number[]): number[]`, `isAfter(a: readonly number[], b: readonly number[]): boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/tree-edits.test.ts`, adding `isAfter`, `paintKey` and `replaceNode` to its existing import from `../doc/tree`. That file already defines a `rect(id, x)` builder at the top and already imports `createDoc`, `Group` and `Node` — reuse them, and add this one local helper beside the tests:

```ts
const docWith = (children: Node[]): Doc => {
  const base = createDoc(100, 100);
  return { ...base, layers: [{ ...base.layers[0], children }] };
};
```

```ts
describe("replaceNode", () => {
  it("puts the replacements at the original's index in its own parent", () => {
    const doc = deepFreeze(docWith([rect("a"), rect("b"), rect("c")]));
    const out = replaceNode(doc, "b", [rect("b1"), rect("b2")]);
    expect(out.layers[0].children.map((n) => n.id)).toEqual(["a", "b1", "b2", "c"]);
  });

  it("works inside a group, at any depth", () => {
    const group: Group = {
      kind: "group",
      id: "g",
      transform: IDENTITY,
      children: [rect("x"), rect("y")],
    };
    const doc = deepFreeze(docWith([group]));
    const out = replaceNode(doc, "x", [rect("x1"), rect("x2")]);
    const g = out.layers[0].children[0] as Group;
    expect(g.children.map((n) => n.id)).toEqual(["x1", "x2", "y"]);
  });

  it("returns the same reference when the id is not there", () => {
    const doc = deepFreeze(docWith([rect("a")]));
    expect(replaceNode(doc, "nope", [rect("z")])).toBe(doc);
  });

  it("returns the same reference for an empty replacement, so no group is emptied", () => {
    const doc = deepFreeze(docWith([rect("a")]));
    expect(replaceNode(doc, "a", [])).toBe(doc);
  });
});

describe("paintKey / isAfter", () => {
  it("ranks a later sibling in front", () => {
    expect(isAfter(paintKey(0, [2]), paintKey(0, [1]))).toBe(true);
  });

  it("ranks a later layer in front of an earlier one, whatever the child index", () => {
    expect(isAfter(paintKey(1, [0]), paintKey(0, [9]))).toBe(true);
  });

  it("ranks a child in front of its own shallower sibling slot", () => {
    expect(isAfter(paintKey(0, [1, 0]), paintKey(0, [1]))).toBe(true);
  });

  it("is false for a key compared with itself", () => {
    expect(isAfter(paintKey(0, [1]), paintKey(0, [1]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/tree-edits.test.ts`
Expected: FAIL — `replaceNode is not a function`.

- [ ] **Step 3: Implement in `src/doc/tree.ts`**

```ts
/** Paint order: later children sit in front, so the greatest key is the frontmost. Shared by the
 *  booleans and by Combine, both of which build their result in the frontmost operand's place. */
export const paintKey = (layerIndex: number, path: readonly number[]): number[] => [
  layerIndex,
  ...path,
];

export const isAfter = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x > y;
  }
  return false;
};

/** Replaces one node with several, in its own parent and at its own index. Same reference when `id`
 *  is not found, or when `nodes` is empty — emptying a group that way would leave the shape the
 *  importer drops (invariant 27).
 *
 *  `mapNodes` is 1→1 and `insertNodes` appends to a layer, so neither can express Break apart's
 *  requirement that the fragments keep the original's place in the z-order (spec M11 §3). */
export function replaceNode(doc: Doc, id: string, nodes: readonly Node[]): Doc {
  if (nodes.length === 0) return doc;
  let hit = false;
  const walk = (children: readonly Node[]): Node[] | null => {
    const i = children.findIndex((n) => n.id === id);
    if (i >= 0) {
      hit = true;
      return [...children.slice(0, i), ...nodes, ...children.slice(i + 1)];
    }
    let changed = false;
    const out = children.map((n) => {
      if (n.kind !== "group") return n;
      const inner = walk(n.children);
      if (!inner) return n;
      changed = true;
      return { ...n, children: inner };
    });
    return changed ? out : null;
  };
  const layers = doc.layers.map((l) => {
    const c = walk(l.children);
    return c ? { ...l, children: c } : l;
  });
  return hit ? { ...doc, layers } : doc;
}
```

- [ ] **Step 4: Point `boolean-edit.ts` at the shared helpers**

Delete its private `order`, `after` and `mapSubpath`. `mapSubpath` is a duplicate of `transformSubpaths` in `geom/shapes.ts`, which does exactly the same job for an array.

- Add `paintKey`, `isAfter` to the existing `./tree` import; add `transformSubpaths` to the existing `../geom/shapes` import.
- Replace `order(f.layerIndex, f.path)` with `paintKey(f.layerIndex, f.path)`.
- Replace both `after(a.key, b.key)` calls with `isAfter(a.key, b.key)`.
- Replace `s.path.subpaths.map((sp) => mapSubpath(sp, world))` with `transformSubpaths(s.path.subpaths, world)`.
- Replace `result.map((sp) => mapSubpath(sp, toParent))` with `transformSubpaths(result, toParent)`.
- Remove the now-unused `applyMat` import if nothing else in the file uses it.

- [ ] **Step 5: Run the tree and boolean tests**

Run: `npx vitest run src/__tests__/tree-edits.test.ts src/__tests__/boolean.test.ts src/__tests__/boolean-edit.test.ts`
Expected: PASS. `boolean.test.ts` is again unedited — the helper swap must be behaviour-preserving.

- [ ] **Step 6: Commit**

```bash
git add src/doc/tree.ts src/doc/boolean-edit.ts src/__tests__/tree-edits.test.ts
git commit -m "$(cat <<'EOF'
feat: replaceNode, and paint-order helpers shared with the booleans

Break apart puts N nodes where one was, keeping the parent and the
z-position; mapNodes is 1->1 and insertNodes appends to a layer, so
neither could express it.

boolean-edit.ts's private mapSubpath turned out to be a duplicate of
geom/shapes.ts's transformSubpaths, and its order/after are the
frontmost-operand rule Combine needs too — both now shared.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `src/doc/path-ops.ts` — the four synchronous operations

**Files:**
- Create: `src/doc/path-ops.ts`
- Test: `src/__tests__/path-ops.test.ts`

**Interfaces:**
- Consumes: `subdividePath`, `reversePath` (Task 2); `replaceNode`, `paintKey`, `isAfter` (Task 3); `findNode`, `mapNodes` from `./tree`; `deleteNodes` from `./edits`; `toPath`, `transformSubpaths` from `../geom/shapes`; `invert`, `multiply`, `IDENTITY` from `../geom/mat`; `idFor` from `./document`.
- Produces: `PathOp` (`"subdivide" | "reverse" | "breakApart" | "combine" | "simplify"`), `PATH_OPS`, `PATH_LABEL`, `PATH_TITLE`, `pathOpRefusal(doc, ids, op): string | null`, `subdivideSelection(doc, ids): Doc`, `reverseSelection(doc, ids): Doc`, `breakApart(doc, ids): { doc: Doc; ids: string[] }`, `combine(doc, ids): { doc: Doc; id: string } | null`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/path-ops.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, idFor, type Doc, type Group, type PathShape, type Subpath } from "../doc/document";
import { breakApart, combine, pathOpRefusal, reverseSelection, subdivideSelection } from "../doc/path-ops";
import { findNode } from "../doc/tree";

const IDENT: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

const ring = (cx: number, r: number): Subpath => ({
  closed: true,
  nodes: [
    { p: { x: cx - r, y: 0 }, in: null, out: null, type: "corner" },
    { p: { x: cx, y: r }, in: null, out: null, type: "corner" },
    { p: { x: cx + r, y: 0 }, in: null, out: null, type: "corner" },
    { p: { x: cx, y: -r }, in: null, out: null, type: "corner" },
  ],
});

function docWith(shapes: PathShape[]): Doc {
  const base = createDoc(200, 200);
  return {
    ...base,
    nextId: 100,
    layers: [{ ...base.layers[0], children: shapes }],
  };
}

const path = (id: string, subpaths: Subpath[], extra: Partial<PathShape> = {}): PathShape => ({
  kind: "path",
  id,
  transform: IDENT,
  style: DEFAULT_STYLE,
  subpaths,
  ...extra,
});

describe("breakApart", () => {
  it("turns one path of N subpaths into N path nodes", () => {
    const doc = docWith([path("a", [ring(50, 20), ring(50, 10)])]);
    const out = breakApart(doc, ["a"]);
    expect(out.doc.layers[0].children).toHaveLength(2);
    expect(out.ids).toHaveLength(2);
  });

  it("keeps the original's place in the z-order", () => {
    const doc = docWith([
      path("back", [ring(0, 5)]),
      path("multi", [ring(50, 20), ring(50, 10)]),
      path("front", [ring(100, 5)]),
    ]);
    const out = breakApart(doc, ["multi"]);
    const ids = out.doc.layers[0].children.map((n) => n.id);
    expect(ids[0]).toBe("back");
    expect(ids[ids.length - 1]).toBe("front");
    expect(ids).toHaveLength(4);
  });

  it("keeps the original's id for the first fragment and allocates fresh ones after", () => {
    const doc = docWith([path("a", [ring(50, 20), ring(50, 10)])]);
    const out = breakApart(doc, ["a"]);
    expect(out.ids[0]).toBe("a");
    expect(out.ids[1]).toBe(idFor(100));
    expect(out.doc.nextId).toBe(101);
  });

  it("carries style, transform, name, hidden and locked onto every fragment", () => {
    const doc = docWith([
      path("a", [ring(50, 20), ring(50, 10)], {
        name: "Logo",
        hidden: true,
        locked: true,
        transform: [2, 0, 0, 2, 5, 5],
      }),
    ]);
    const out = breakApart(doc, ["a"]);
    for (const id of out.ids) {
      const f = findNode(out.doc, id)!.node as PathShape;
      expect(f.name).toBe("Logo");
      expect(f.hidden).toBe(true);
      expect(f.locked).toBe(true);
      expect(f.transform).toEqual([2, 0, 0, 2, 5, 5]);
    }
  });

  it("drops a title's text, because the outlines no longer spell the string", () => {
    const doc = docWith([path("a", [ring(50, 20), ring(50, 10)], { text: { seed: 1 } as never })]);
    const out = breakApart(doc, ["a"]);
    for (const id of out.ids) {
      expect((findNode(out.doc, id)!.node as PathShape).text).toBeUndefined();
    }
  });

  it("returns the same document reference when nothing has more than one subpath", () => {
    const doc = docWith([path("a", [ring(50, 20)])]);
    expect(breakApart(doc, ["a"]).doc).toBe(doc);
  });
});

describe("combine", () => {
  it("gathers every operand's subpaths into one node", () => {
    const doc = docWith([path("a", [ring(50, 20)]), path("b", [ring(50, 10)])]);
    const out = combine(doc, ["a", "b"])!;
    expect(out.doc.layers[0].children).toHaveLength(1);
    const p = findNode(out.doc, out.id)!.node as PathShape;
    expect(p.subpaths).toHaveLength(2);
  });

  it("builds the result in the frontmost operand's place, with its style and name", () => {
    const doc = docWith([
      path("back", [ring(50, 20)], { name: "Back" }),
      path("front", [ring(50, 10)], { name: "Front" }),
    ]);
    const out = combine(doc, ["back", "front"])!;
    expect(out.id).toBe("front");
    expect((findNode(out.doc, out.id)!.node as PathShape).name).toBe("Front");
  });

  it("maps an operand from another parent space so it draws where it drew", () => {
    const moved = path("b", [ring(0, 10)], { transform: [1, 0, 0, 1, 50, 0] });
    const doc = docWith([path("a", [ring(50, 20)]), moved]);
    const out = combine(doc, ["a", "b"])!;
    const p = findNode(out.doc, out.id)!.node as PathShape;
    // `b`'s first node was at (-10, 0) under a +50 x translation, i.e. (40, 0) on screen. The
    // result sits in `b`'s own (identity) parent space, so the coordinate is unchanged.
    const xs = p.subpaths[1].nodes.map((n) => n.p.x);
    expect(xs).toContain(40);
  });

  it("deletes every operand but the frontmost", () => {
    const doc = docWith([path("a", [ring(50, 20)]), path("b", [ring(50, 10)])]);
    const out = combine(doc, ["a", "b"])!;
    expect(findNode(out.doc, "a")).toBeNull();
  });

  it("converts a rect, as the booleans do, so two circles can make a donut", () => {
    const base = createDoc(200, 200);
    const doc: Doc = {
      ...base,
      layers: [
        {
          ...base.layers[0],
          children: [
            { kind: "rect", id: "r", transform: IDENT, style: DEFAULT_STYLE, x: 0, y: 0, w: 10, h: 10, rx: 0 },
            path("p", [ring(50, 10)]),
          ],
        },
      ],
    };
    const out = combine(doc, ["r", "p"])!;
    const p = findNode(out.doc, out.id)!.node as PathShape;
    expect(p.kind).toBe("path");
    expect(p.subpaths).toHaveLength(2);
  });

  it("returns null for fewer than two shapes", () => {
    const doc = docWith([path("a", [ring(50, 20)])]);
    expect(combine(doc, ["a"])).toBeNull();
  });

  it("treats one id named twice as one shape", () => {
    const doc = docWith([path("a", [ring(50, 20)])]);
    expect(combine(doc, ["a", "a"])).toBeNull();
  });

  it("drops the result's text", () => {
    const doc = docWith([
      path("a", [ring(50, 20)], { text: { seed: 1 } as never }),
      path("b", [ring(50, 10)]),
    ]);
    const out = combine(doc, ["a", "b"])!;
    expect((findNode(out.doc, out.id)!.node as PathShape).text).toBeUndefined();
  });
});

describe("combine then reverse: the donut", () => {
  it("winds the inner subpath against the outer, which is what nonzero fill needs", () => {
    const doc = docWith([path("outer", [ring(50, 20)]), path("inner", [ring(50, 10)])]);
    const combined = combine(doc, ["outer", "inner"])!;
    const before = findNode(combined.doc, combined.id)!.node as PathShape;
    expect(Math.sign(area(before.subpaths[0]))).toBe(Math.sign(area(before.subpaths[1])));

    const reversed = reverseSelection(combined.doc, [combined.id]);
    const after = findNode(reversed, combined.id)!.node as PathShape;
    expect(Math.sign(area(after.subpaths[0]))).not.toBe(Math.sign(area(after.subpaths[1])));
  });
});

/** Twice the signed area of a subpath's anchor polygon — the shoelace formula. Its sign is the
 *  winding direction, which is the only thing these tests read from it. */
function area(sp: Subpath): number {
  let a = 0;
  for (let i = 0; i < sp.nodes.length; i++) {
    const p = sp.nodes[i].p;
    const q = sp.nodes[(i + 1) % sp.nodes.length].p;
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

describe("subdivideSelection", () => {
  it("subdivides every selected path", () => {
    const doc = docWith([path("a", [ring(50, 20)]), path("b", [ring(50, 10)])]);
    const out = subdivideSelection(doc, ["a", "b"]);
    expect((findNode(out, "a")!.node as PathShape).subpaths[0].nodes).toHaveLength(8);
    expect((findNode(out, "b")!.node as PathShape).subpaths[0].nodes).toHaveLength(8);
  });

  it("leaves a non-path node alone and returns the same reference", () => {
    const base = createDoc(200, 200);
    const doc: Doc = {
      ...base,
      layers: [
        {
          ...base.layers[0],
          children: [
            { kind: "rect", id: "r", transform: IDENT, style: DEFAULT_STYLE, x: 0, y: 0, w: 10, h: 10, rx: 0 },
          ],
        },
      ],
    };
    expect(subdivideSelection(doc, ["r"])).toBe(doc);
  });
});

describe("pathOpRefusal", () => {
  it("refuses Combine with fewer than two shapes", () => {
    const doc = docWith([path("a", [ring(50, 20)])]);
    expect(pathOpRefusal(doc, ["a"], "combine")).toBe("select two or more shapes");
  });

  it("refuses Combine on a group", () => {
    const base = createDoc(200, 200);
    const group: Group = {
      kind: "group",
      id: "g",
      transform: IDENT,
      children: [path("c1", [ring(0, 5)])],
    };
    const doc: Doc = {
      ...base,
      layers: [{ ...base.layers[0], children: [group, path("a", [ring(50, 20)])] }],
    };
    expect(pathOpRefusal(doc, ["g", "a"], "combine")).toBe("a group can't take part");
  });

  it("refuses Break apart when nothing has more than one subpath", () => {
    const doc = docWith([path("a", [ring(50, 20)])]);
    expect(pathOpRefusal(doc, ["a"], "breakApart")).toBe(
      "select a path with more than one subpath",
    );
  });

  it("refuses Subdivide, Reverse and Simplify when no path is selected", () => {
    const doc = docWith([]);
    for (const op of ["subdivide", "reverse", "simplify"] as const) {
      expect(pathOpRefusal(doc, [], op)).toBe("select a path");
    }
  });

  it("allows each operation when its precondition is met", () => {
    const doc = docWith([path("a", [ring(50, 20), ring(50, 10)]), path("b", [ring(50, 5)])]);
    expect(pathOpRefusal(doc, ["a"], "subdivide")).toBeNull();
    expect(pathOpRefusal(doc, ["a"], "reverse")).toBeNull();
    expect(pathOpRefusal(doc, ["a"], "breakApart")).toBeNull();
    expect(pathOpRefusal(doc, ["a", "b"], "combine")).toBeNull();
    expect(pathOpRefusal(doc, ["a"], "simplify")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/path-ops.test.ts`
Expected: FAIL — cannot resolve `../doc/path-ops`.

- [ ] **Step 3: Implement `src/doc/path-ops.ts`**

```ts
import { IDENTITY, invert, multiply } from "../geom/mat";
import { toPath, transformSubpaths } from "../geom/shapes";
import { idFor, type Doc, type Node, type PathShape, type Subpath } from "./document";
import { deleteNodes } from "./edits";
import { reversePath, subdividePath } from "./path-edit";
import { findNode, isAfter, mapNodes, paintKey, replaceNode, type Found } from "./tree";

/** Spec (M11) §2. */
export type PathOp = "subdivide" | "reverse" | "breakApart" | "combine" | "simplify";

export const PATH_OPS: readonly PathOp[] = [
  "subdivide",
  "reverse",
  "breakApart",
  "combine",
  "simplify",
];

/** The command names, used by every surface and by the notices, so they cannot drift apart. */
export const PATH_LABEL: Readonly<Record<PathOp, string>> = {
  subdivide: "Subdivide",
  reverse: "Reverse direction",
  breakApart: "Break apart",
  combine: "Combine",
  simplify: "Simplify",
};

/** Tooltips read as actions, because every title is also the status-bar hint (invariant 24). */
export const PATH_TITLE: Readonly<Record<PathOp, string>> = {
  subdivide: "Add a node in the middle of every segment",
  reverse: "Reverse the direction the path is drawn in",
  breakApart: "Split a path's subpaths into separate objects",
  combine: "Join the selected shapes into one path",
  simplify: "Remove nodes without changing the shape much",
};

const REASON = {
  noPath: "select a path",
  few: "select two or more shapes",
  group: "a group can't take part",
  single: "select a path with more than one subpath",
} as const;

const foundFor = (doc: Doc, ids: readonly string[]): Found[] =>
  [...new Set(ids)].flatMap((id) => findNode(doc, id) ?? []);

const paths = (found: readonly Found[]): PathShape[] =>
  found.flatMap((f) => (f.node.kind === "path" ? [f.node] : []));

/** The one place that decides whether an operation can run, so the menus and the edits can never
 *  disagree about it (spec M11 §7; the shape is `booleanRefusal`'s). Returns the reason text
 *  itself rather than a code — there is one surface, and a second table to keep in step would be a
 *  second thing that can drift. */
export function pathOpRefusal(doc: Doc, ids: readonly string[], op: PathOp): string | null {
  const found = foundFor(doc, ids);
  if (op === "combine") {
    if (found.length < 2) return REASON.few;
    if (found.some((f) => f.node.kind === "group")) return REASON.group;
    return null;
  }
  const ps = paths(found);
  if (ps.length === 0) return REASON.noPath;
  if (op === "breakApart" && !ps.some((p) => p.subpaths.length > 1)) return REASON.single;
  return null;
}

/** Spec (M11) §5. */
export function subdivideSelection(doc: Doc, ids: readonly string[]): Doc {
  return mapNodes(doc, [...new Set(ids)], (n) => (n.kind === "path" ? subdividePath(n) : n));
}

/** Spec (M11) §4. */
export function reverseSelection(doc: Doc, ids: readonly string[]): Doc {
  return mapNodes(doc, [...new Set(ids)], (n) => (n.kind === "path" ? reversePath(n) : n));
}

/** Spec (M11) §3. Each selected path with more than one subpath becomes one node per subpath, in
 *  its own place in the z-order. The first fragment keeps the original's id, so the operation is
 *  visible in the layers panel as a split rather than as a delete and five inserts.
 *
 *  `text` is deliberately not carried over: a title's outlines stop describing its string the
 *  moment they are split up (invariant 40). The fragments are built fresh rather than cleared,
 *  so no bake funnel is involved. */
export function breakApart(doc: Doc, ids: readonly string[]): { doc: Doc; ids: string[] } {
  const targets = paths(foundFor(doc, ids)).filter((p) => p.subpaths.length > 1);
  if (targets.length === 0) return { doc, ids: [] };
  let next = doc;
  let nextId = doc.nextId;
  const made: string[] = [];
  for (const p of targets) {
    const frags: Node[] = p.subpaths.map((sp, k) => {
      const frag: PathShape = {
        kind: "path",
        id: k === 0 ? p.id : idFor(nextId++),
        transform: p.transform,
        style: p.style,
        subpaths: [sp],
      };
      // Optional fields are written only when set, so a fragment of an ordinary path is
      // structurally identical to one drawn that way (invariant 39).
      if (p.name !== undefined) frag.name = p.name;
      if (p.hidden === true) frag.hidden = true;
      if (p.locked === true) frag.locked = true;
      return frag;
    });
    made.push(...frags.map((n) => n.id));
    next = replaceNode(next, p.id, frags);
  }
  return { doc: { ...next, nextId }, ids: made };
}

/** Spec (M11) §3. The inverse of `breakApart`, and `booleanShapes`' rule for where a result goes:
 *  the frontmost operand gives the result its id, place, style and name, and every other operand's
 *  subpaths are mapped into that node's parent space before being gathered in. */
export function combine(doc: Doc, ids: readonly string[]): { doc: Doc; id: string } | null {
  const unique = [...new Set(ids)];
  if (pathOpRefusal(doc, unique, "combine")) return null;
  const found = foundFor(doc, unique);
  const shapes = found.map((f) => ({
    found: f,
    path: f.node.kind === "path" ? f.node : toPath(f.node as Parameters<typeof toPath>[0]),
    key: paintKey(f.layerIndex, f.path),
  }));
  const front = shapes.reduce((a, b) => (isAfter(a.key, b.key) ? a : b));
  const toParent = invert(front.found.parent);
  if (!toParent) return null;

  const subpaths: Subpath[] = [];
  for (const s of shapes) {
    const world = multiply(s.found.parent, s.path.transform);
    // A singular world matrix contributes nothing, as in `booleanOf`.
    const into = multiply(toParent, world);
    if (!invert(into)) continue;
    subpaths.push(...transformSubpaths(s.path.subpaths, into));
  }
  if (subpaths.length === 0) return null;

  const shape: PathShape = {
    kind: "path",
    id: front.path.id,
    transform: IDENTITY,
    style: front.path.style,
    subpaths,
  };
  if (front.path.name !== undefined) shape.name = front.path.name;
  const replaced = mapNodes(doc, [front.path.id], () => shape as Node);
  const others = shapes.filter((s) => s !== front).map((s) => s.path.id);
  return { doc: deleteNodes(replaced, others), id: shape.id };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/path-ops.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS. Nothing outside this file changed behaviour.

- [ ] **Step 6: Commit**

```bash
git add src/doc/path-ops.ts src/__tests__/path-ops.test.ts
git commit -m "$(cat <<'EOF'
feat: Subdivide, Reverse direction, Break apart and Combine

Combine follows booleanShapes' rule for where a result goes: the
frontmost operand gives it id, place, style and name, and every other
operand's subpaths are mapped into that parent space first. Break apart
is its exact inverse and keeps the original's z-position, with the first
fragment keeping its id so the layers panel reads as a split.

Combine converts a rect, ellipse or polygon with toPath as the booleans
do -- refusing an ellipse while Unite accepts one would be arbitrary,
and the donut everyone reaches for is two circles.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Simplify

**Files:**
- Create: `src/geom/simplify.ts`
- Create: `src/doc/simplify-edit.ts`
- Test: `src/__tests__/simplify.test.ts`

**Interfaces:**
- Consumes: `loadPaper`, `toPaperItem`, `fromPaperItem`, `paperPaths` (Task 1); `nodeBounds` from `../geom/bounds`; `IDENTITY` from `../geom/mat`; `findNode`, `mapNodes` from `./tree`; `withBakedSubpaths` from `./document`.
- Produces: `simplifyOf(subpaths: readonly Subpath[], tolerance: number): Promise<Subpath[]>`, `SimplifyOutcome`, `simplifyShapes(doc: Doc, ids: readonly string[]): Promise<SimplifyOutcome>`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/simplify.test.ts`. These exercise our conversion and our guards; Paper's own `simplify` is not re-tested.

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type PathShape, type Subpath } from "../doc/document";
import { simplifyShapes } from "../doc/simplify-edit";
import { findNode } from "../doc/tree";
import { simplifyOf } from "../geom/simplify";

const IDENT: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

/** A noisy polyline: many corner nodes tracing a sine, the shape a trace or a flatten leaves. */
function noisy(n: number): Subpath {
  const nodes = [];
  for (let i = 0; i <= n; i++) {
    nodes.push({
      p: { x: i * 2, y: 20 * Math.sin(i / 4) + (i % 2 ? 0.6 : -0.6) },
      in: null,
      out: null,
      type: "corner" as const,
    });
  }
  return { closed: false, nodes };
}

const path = (id: string, subpaths: Subpath[], extra: Partial<PathShape> = {}): PathShape => ({
  kind: "path",
  id,
  transform: IDENT,
  style: DEFAULT_STYLE,
  subpaths,
  ...extra,
});

function docWith(shapes: PathShape[]): Doc {
  const base = createDoc(200, 200);
  return { ...base, layers: [{ ...base.layers[0], children: shapes }] };
}

describe("simplifyOf", () => {
  it("drops nodes from a noisy path", async () => {
    const out = await simplifyOf([noisy(40)], 0.8);
    expect(out[0].nodes.length).toBeLessThan(41);
    expect(out[0].nodes.length).toBeGreaterThan(2);
  });

  it("keeps the result near the original", async () => {
    const before = noisy(40);
    const [after] = await simplifyOf([before], 0.8);
    // Endpoints are preserved by the fit, which is the cheapest check that we did not lose the
    // path's extent while losing its nodes.
    expect(after.nodes[0].p.x).toBeCloseTo(before.nodes[0].p.x, 6);
    expect(after.nodes[after.nodes.length - 1].p.x).toBeCloseTo(
      before.nodes[before.nodes.length - 1].p.x,
      6,
    );
  });

  it("keeps a closed subpath closed", async () => {
    const closed = { ...noisy(20), closed: true };
    const [after] = await simplifyOf([closed], 0.8);
    expect(after.closed).toBe(true);
  });
});

describe("simplifyShapes", () => {
  it("reports the node count before and after", async () => {
    const doc = docWith([path("a", [noisy(40)])]);
    const out = await simplifyShapes(doc, ["a"]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.before).toBe(41);
    expect(out.after).toBeLessThan(41);
  });

  it("drops a title's text, because the outlines stop matching the string", async () => {
    const doc = docWith([path("a", [noisy(40)], { text: { seed: 1 } as never })]);
    const out = await simplifyShapes(doc, ["a"]);
    if (out.kind !== "ok") throw new Error("expected ok");
    expect((findNode(out.doc, "a")!.node as PathShape).text).toBeUndefined();
  });

  it("refuses when no path is selected", async () => {
    const doc = docWith([]);
    const out = await simplifyShapes(doc, []);
    expect(out.kind).toBe("refused");
  });

  it("leaves the document at the same reference when it changes nothing", async () => {
    // A two-node straight segment has nothing to remove.
    const flat: Subpath = {
      closed: false,
      nodes: [
        { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
        { p: { x: 10, y: 0 }, in: null, out: null, type: "corner" },
      ],
    };
    const doc = docWith([path("a", [flat])]);
    const out = await simplifyShapes(doc, ["a"]);
    expect(out.kind).toBe("none");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/simplify.test.ts`
Expected: FAIL — cannot resolve `../geom/simplify`.

- [ ] **Step 3: Implement `src/geom/simplify.ts`**

```ts
import type { Subpath } from "../doc/document";
import { fromPaperItem, loadPaper, paperPaths, toPaperItem } from "./paper";

/** Spec (M11) §6. Paper's own `simplify` is Schneider's curve fitter, so there is no fitting code
 *  of ours here — only the conversion, which `geom/paper.ts` already owns.
 *
 *  `simplify` lives on `Path`, not on `CompoundPath`, so each child is fitted on its own. */
export async function simplifyOf(
  subpaths: readonly Subpath[],
  tolerance: number,
): Promise<Subpath[]> {
  const P = await loadPaper();
  const item = toPaperItem(P, subpaths);
  for (const p of paperPaths(item)) p.simplify(tolerance);
  return fromPaperItem(item);
}
```

- [ ] **Step 4: Implement `src/doc/simplify-edit.ts`**

```ts
import { nodeBounds } from "../geom/bounds";
import { IDENTITY } from "../geom/mat";
import { simplifyOf } from "../geom/simplify";
import { withBakedSubpaths, type Doc, type Node, type PathShape } from "./document";
import { findNode, mapNodes } from "./tree";

export type SimplifyOutcome =
  | { kind: "ok"; doc: Doc; before: number; after: number }
  /** It ran and removed nothing: the document must not change (invariant 1). */
  | { kind: "none" }
  | { kind: "refused"; why: string };

/** Spec (M11) §6. Relative to the path's own bounding-box diagonal, never absolute: paper's
 *  default of 2.5 is meaningful only in its own example's coordinate space, and a 20-unit logo and
 *  an artboard-sized traced path cannot share a number. */
const TOL_FRACTION = 2e-3;

const countNodes = (p: PathShape): number =>
  p.subpaths.reduce((n, sp) => n + sp.nodes.length, 0);

/** Spec (M11) §6. Async, so it copies `booleanShapes`' shape: the caller must re-check that the
 *  document has not moved under the await before committing (invariant 15's hazard, across an
 *  await). */
export async function simplifyShapes(doc: Doc, ids: readonly string[]): Promise<SimplifyOutcome> {
  const unique = [...new Set(ids)];
  const targets = unique
    .flatMap((id) => findNode(doc, id) ?? [])
    .flatMap((f) => (f.node.kind === "path" ? [f.node] : []));
  if (targets.length === 0) return { kind: "refused", why: "select a path" };

  let before = 0;
  let after = 0;
  const done = new Map<string, PathShape>();
  for (const p of targets) {
    const box = nodeBounds(p, IDENTITY);
    const diag = box ? Math.hypot(box.w, box.h) : 0;
    if (diag === 0) continue;
    const subpaths = await simplifyOf(p.subpaths, diag * TOL_FRACTION);
    // A subpath the fit left with fewer than two nodes is dropped, and a path left with none is
    // not written at all — the importer would drop it (invariant 30).
    const kept = subpaths.filter((sp) => sp.nodes.length >= 2);
    if (kept.length === 0) continue;
    const next = withBakedSubpaths(p, kept);
    const n = countNodes(next);
    if (n === countNodes(p)) continue;
    before += countNodes(p);
    after += n;
    done.set(p.id, next);
  }
  if (done.size === 0) return { kind: "none" };
  const out = mapNodes(doc, [...done.keys()], (n) => (done.get(n.id) ?? n) as Node);
  return { kind: "ok", doc: out, before, after };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/simplify.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: PASS, 0 errors, 0 warnings, and `paper-core-*.js` still a chunk of its own in `dist/assets/`.

- [ ] **Step 7: Commit**

```bash
git add src/geom/simplify.ts src/doc/simplify-edit.ts src/__tests__/simplify.test.ts
git commit -m "$(cat <<'EOF'
feat: Simplify, via paper's own curve fitter

paper.Path.simplify IS Schneider's algorithm, so there is no fitting
code of ours -- only the conversion geom/paper.ts already owns. The
tolerance is relative to the path's bounding-box diagonal, never
absolute: paper's default of 2.5 means something only in its own
example's coordinate space.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Store actions and the Path menu

Not unit-testable — Vitest has no DOM. Verified by the build and by a browser pass — except `pathReason`, which is pure and gets a test.

**Files:**
- Modify: `src/state/appState.svelte.ts`
- Modify: `src/lib/TopBar.svelte`

**Interfaces:**
- Consumes: everything from Tasks 4 and 5.
- Produces: `subdivideSelectionNodes`, `reverseSelectionDirection`, `breakApartSelection`, `combineSelection`, `simplifySelection` — all exported from the store. Note the first is **not** named `subdivideSelection`: that name is already taken by the pure edit in `path-ops.ts`, which this action calls.

- [ ] **Step 1: Add the four synchronous actions to `src/state/appState.svelte.ts`**

Place them beside `booleanSelection`. Each cancels a running tool drag first (invariant 15) and commits through the store's existing `commitDoc`/`setSelection`.

```ts
/** Spec (M11) §5. */
export function subdivideSelectionNodes(): void {
  cancelActiveGesture();
  const why = pathOpRefusal(app.doc, app.selection, "subdivide");
  if (why) return notify("info", `${PATH_LABEL.subdivide} — ${why}`);
  commitDoc(subdivideSelection(app.doc, app.selection));
}

/** Spec (M11) §4. */
export function reverseSelectionDirection(): void {
  cancelActiveGesture();
  const why = pathOpRefusal(app.doc, app.selection, "reverse");
  if (why) return notify("info", `${PATH_LABEL.reverse} — ${why}`);
  commitDoc(reverseSelection(app.doc, app.selection));
}

/** Spec (M11) §3. */
export function breakApartSelection(): void {
  cancelActiveGesture();
  const why = pathOpRefusal(app.doc, app.selection, "breakApart");
  if (why) return notify("info", `${PATH_LABEL.breakApart} — ${why}`);
  const out = breakApart(app.doc, app.selection);
  commitDoc(out.doc);
  setSelection(out.ids);
}

/** Spec (M11) §3. */
export function combineSelection(): void {
  cancelActiveGesture();
  const why = pathOpRefusal(app.doc, app.selection, "combine");
  if (why) return notify("info", `${PATH_LABEL.combine} — ${why}`);
  const out = combine(app.doc, app.selection);
  if (!out) return notify("info", `${PATH_LABEL.combine} — nothing to combine.`);
  commitDoc(out.doc);
  setSelection([out.id]);
}
```

Add to the file's imports:

```ts
import { combine, breakApart, pathOpRefusal, reverseSelection, subdivideSelection, PATH_LABEL } from "../doc/path-ops";
import { simplifyShapes, type SimplifyOutcome } from "../doc/simplify-edit";
```

- [ ] **Step 2: Add the async Simplify action, modelled line-for-line on `booleanSelection`**

```ts
let simplifyRunning = false;

/** Spec (M11) §6. Async even when paper is cached, so it refuses to run twice at once and
 *  re-checks the document after the await — the same hazard `booleanSelection` guards. */
export async function simplifySelection(): Promise<void> {
  if (simplifyRunning) return;
  simplifyRunning = true;
  try {
    cancelActiveGesture();
    const why = pathOpRefusal(app.doc, app.selection, "simplify");
    if (why) {
      notify("info", `${PATH_LABEL.simplify} — ${why}`);
      return;
    }
    const before = app.doc;
    const sel = app.selection;
    let out: SimplifyOutcome;
    try {
      out = await simplifyShapes(before, sel);
    } catch {
      notify(
        "error",
        // Reload, not "try again": a module fetch that failed is recorded in the browser's module
        // map, so every later import of the same chunk fails without asking the network again.
        `${PATH_LABEL.simplify} — the operation could not load. Check your connection, then reload the page.`,
      );
      return;
    }
    cancelActiveGesture();
    if (app.doc !== before) {
      notify("info", `${PATH_LABEL.simplify} — the document changed while it loaded; try again.`);
      return;
    }
    if (out.kind === "refused") {
      notify("info", `${PATH_LABEL.simplify} — ${out.why}`);
      return;
    }
    if (out.kind === "none") {
      notify("info", `${PATH_LABEL.simplify} — nothing to remove.`);
      return;
    }
    commitDoc(out.doc);
    notify("info", `Simplified — ${out.before} nodes → ${out.after}.`);
  } finally {
    simplifyRunning = false;
  }
}
```

- [ ] **Step 3: Add the five entries to the Path menu in `src/lib/TopBar.svelte`**

Import the vocabulary and the actions:

```ts
import { PATH_LABEL, PATH_OPS, PATH_TITLE, type PathOp } from "../doc/path-ops";
import {
  breakApartSelection,
  combineSelection,
  reverseSelectionDirection,
  simplifySelection,
  subdivideSelectionNodes,
} from "../state/appState.svelte";
```

Add only the runner here — the reasons come from `actions`, which `TopBar` already derives as `selectionActions(app.doc, app.selection)` and reads for `actions.booleanRefusal`:

```ts
const PATH_RUN: Readonly<Record<PathOp, () => void>> = {
  subdivide: subdivideSelectionNodes,
  reverse: reverseSelectionDirection,
  breakApart: breakApartSelection,
  combine: combineSelection,
  simplify: () => void simplifySelection(),
};

function runPathOp(op: PathOp) {
  pathOpen = false;
  PATH_RUN[op]();
}
```

`pathOpRefusal` is therefore **not** imported into `TopBar`; only `PATH_LABEL`, `PATH_OPS`, `PATH_TITLE` and the `PathOp` type are.

Then, inside the Path menu's `<div role="menu">` and **after** the `{#each BOOL_OPS …}` block, add a divider and the five entries:

```svelte
<div class="my-1 border-t border-line"></div>
{#each PATH_OPS as op (op)}
  <button
    class="menu-item"
    role="menuitem"
    aria-disabled={actions.pathReason[op] !== null}
    title={actions.pathReason[op] === null
      ? PATH_TITLE[op]
      : `${PATH_LABEL[op]} — ${actions.pathReason[op]}`}
    onclick={() => actions.pathReason[op] === null && runPathOp(op)}
  >
    {PATH_LABEL[op]}
  </button>
{/each}
```

- [ ] **Step 4: Add `pathReason` to `selectionActions`**

`src/state/properties.ts` is the one place that computes selection-dependent menu state, shared by the top bar and the context menu — the booleans' reason already lives there as `booleanRefusal`. Add the table beside it so the Path menu cannot drift from the edits either.

In the `SelectionActions` type:

```ts
  /** null per operation when it can run; otherwise why it cannot (spec M11 §7). */
  pathReason: Readonly<Record<PathOp, string | null>>;
```

In `selectionActions`'s returned object:

```ts
    pathReason: Object.fromEntries(
      PATH_OPS.map((op) => [op, pathOpRefusal(doc, ids, op)]),
    ) as Record<PathOp, string | null>,
```

and at the top of the file:

```ts
import { PATH_OPS, pathOpRefusal, type PathOp } from "../doc/path-ops";
```

- [ ] **Step 5: Add one test that the table is wired, not just the predicate**

Append to `src/__tests__/properties.test.ts`, using whatever document builder that file already uses:

```ts
describe("selectionActions.pathReason", () => {
  it("carries a reason for every operation when nothing is selected", () => {
    const a = selectionActions(createDoc(100, 100), []);
    for (const op of PATH_OPS) expect(a.pathReason[op]).not.toBeNull();
  });
});
```

Run: `npx vitest run src/__tests__/properties.test.ts`
Expected: PASS.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 7: Verify in the browser**

Run the dev server on a port that is **not** the user's 5173, so their own autosaved document is untouched: `npx vite --port 5198 --strictPort`. Then, in the app:

1. Draw two overlapping ellipses. Select both → **Path ▸ Combine** → one object in the Layers panel, both rings still drawn.
2. With it selected → **Path ▸ Reverse direction** → the inner ring becomes a hole.
3. **Path ▸ Break apart** → two objects again, in the same z-position.
4. Select one → **Path ▸ Subdivide** → the node tool (N) shows a node added in the middle of every segment and the shape is unchanged.
5. Select it → **Path ▸ Simplify** → a notice reports a node count drop.
6. Select nothing → open the Path menu → all five read as disabled with a reason in their tooltip, and pressing one does nothing. On a touch device the reason appears in the status bar on press (invariant 24).
7. Check the browser console is clean.

Stop the dev server afterwards.

- [ ] **Step 8: Commit**

```bash
git add src/state/appState.svelte.ts src/state/properties.ts src/lib/TopBar.svelte src/__tests__/properties.test.ts
git commit -m "$(cat <<'EOF'
feat: the five path operations in the Path menu

Menu only: the bar's four hiding breakpoints are measured and it fits at
739px today, so five more icons would invalidate all of them. One
refusal predicate feeds both the menu's disabled-with-a-reason titles
and the edits, so they cannot disagree.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/superpowers/CHANGELOG.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append a CHANGELOG entry**

Append, at the end of the file, following the house format (what shipped, what was learned, what was browser-verified, what is owed):

```markdown
## 2026-09-21 — Milestone 11: path operations

- Five operations in the **Path** menu beside the booleans: **Subdivide**, **Reverse direction**,
  **Break apart**, **Combine** and **Simplify**.
- **Two cost estimates were wrong in opposite directions**, both corrected by probing
  `paper-core` rather than reasoning about it. **Simplify was not the large one**: paper ships
  `simplify(tolerance)`, which *is* Schneider's curve fitter (`segments: 41 -> 16` on a noisy
  sine), so it costs only the async plumbing `booleanSelection` already models. **Outline stroke
  was**: `expand` is undefined on `Path` and there is no `outline` or `offset`, so outlining a
  stroke means offsetting by ±`strokeWidth / 2` with joins, caps and self-intersection cleanup —
  offset path under another name. Both were dropped together.
- **`geom/paper.ts`** now owns the loader and the two-way conversion; `boolean.ts` and
  `simplify.ts` are its callers. Invariant 37 and the build bar name it instead of `boolean.ts`.
  `boolean-edit.ts`'s private `mapSubpath` turned out to be a duplicate of `transformSubpaths`.
- **Reverse direction is load-bearing, not a nicety.** `Style` carries no `fill-rule` and nothing
  in `src/svg/` writes one, so everything renders **nonzero** — Combine on two circles gives a
  blob, and reversing the inner one is what makes the donut.
- **Subdivide is exact.** A midpoint split halves each existing handle without turning it, so every
  node keeps its declared type and the inserted node is `symmetric` by construction. It is **not**
  warp preparation — M12's fit inserts the nodes its tolerance demands, so hand-added ones are
  carried through at identical accuracy.
- Plan: `docs/superpowers/plans/2026-09-21-m11-path-operations.md`.
  Spec: `docs/superpowers/specs/2026-09-21-m11-path-operations-design.md`.
- Browser-verified (desktop Chrome, :5198): [fill in from Task 6 Step 5 — do not write this line
  until the checks have actually been run].
- Owed: an iPad pass; paper's failed-load path is still never browser-verified, now reachable from
  a second command; Simplify's `diag × 2e-3` tolerance is reasoned, not validated against a real
  traced path.
```

- [ ] **Step 2: Update README.md**

Add the five operations wherever the booleans are described, and update the test count to whatever `npm test` now reports.

- [ ] **Step 3: Update CLAUDE.md**

Three edits:

1. **Architecture map** — add `path-ops.ts` and `simplify-edit.ts` to the `src/doc/` list, and `paper.ts` and `simplify.ts` to `src/geom/`. Amend the `boolean.ts` line to say it no longer imports paper itself.
2. **`npm test`** — update the test count.
3. **Current state / Roadmap** — this is three milestones stale. Replace "M10b — the randomiser … is the next step" with M11 complete and **M12 envelope warp** specced and next (`2026-09-20-m12-envelope-warp-design.md`), and add path operations to the completed list beside M6–M10.

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run build`
Expected: PASS, 0 errors, 0 warnings.

```bash
git add docs/superpowers/CHANGELOG.md README.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: M11 path operations

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```
