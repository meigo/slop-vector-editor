import type { Doc, PathShape } from "../doc/document";
import { rowLabel } from "../doc/layers";
import { insertNode, moveHandle, movePathNodes, setNodeType, type NodeRef } from "../doc/path-edit";
import { findNode, mapNodes } from "../doc/tree";
import { nearestOnSubpath } from "../geom/bezier";
import { boxFromPoints, type Box } from "../geom/box";
import { hitTest } from "../geom/hit";
import { applyMat, invert, multiply, type Mat } from "../geom/mat";
import { collectTargets, hasGuides, SNAP_PX, snapPoint, type SnapTargets } from "../geom/snap";
import type { Vec } from "../geom/vec";
import { isDoubleTap, type Tap } from "../input/double-tap";
import { SNAP_45 } from "./shape-tools";
import { movedEnough, pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

/** Spec (M4a) §6. Editing one path's nodes; everything happens in that path's own space. */

type Target = { path: PathShape; world: Mat; inv: Mat; scale: number };

type Pick =
  | { kind: "handle"; ref: NodeRef; which: "in" | "out" }
  | { kind: "node"; ref: NodeRef }
  | { kind: "segment"; ref: NodeRef; seg: number; t: number }
  | null;

type Mode =
  | { kind: "pending"; start: ToolEvent; pick: Pick; collapseOnUp: boolean }
  | {
      kind: "nodes";
      base: Doc;
      start: Vec;
      /** The press point in document space, so Shift can constrain to 45° the way the user sees
       *  it, regardless of the path's own rotation (spec M4a §7). */
      startDoc: Vec;
      refs: readonly NodeRef[];
      targets: SnapTargets | null;
    }
  | { kind: "handle"; base: Doc; ref: NodeRef; which: "in" | "out" }
  /** The marquee is dragged and hit-tested in document space, like the select tool's own
   *  marquee — nodes are tested by their world position, not the path's own space. */
  | { kind: "marquee"; start: Vec; base: readonly NodeRef[] };

const sameRef = (a: NodeRef, b: NodeRef) => a.sub === b.sub && a.i === b.i;
const refKey = (r: NodeRef) => `${r.sub}:${r.i}`;
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Shift constrains a node drag to the nearest 45°, mirroring the select tool's own drag
 *  constraint (spec M4a §7). */
function constrain45(dx: number, dy: number): Vec {
  const angle = Math.round(Math.atan2(dy, dx) / SNAP_45) * SNAP_45;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const along = dx * c + dy * s;
  const horizontal = Math.abs(s) < 1e-9;
  const vertical = Math.abs(c) < 1e-9;
  return { x: vertical ? 0 : along * c, y: horizontal ? 0 : along * s };
}

function targetOf(ctx: ToolContext): Target | null {
  const id = ctx.nodeTarget();
  if (id === null) return null;
  const found = findNode(ctx.doc(), id);
  if (!found || found.node.kind !== "path") return null;
  const world = multiply(found.parent, found.node.transform);
  const inv = invert(world);
  if (!inv) return null;
  const scale = Math.sqrt(Math.abs(world[0] * world[3] - world[1] * world[2])) || 1;
  return { path: found.node, world, inv, scale };
}

/** What the pointer is over, in the path's own space. Handles of selected nodes win, then nodes,
 *  then segments. */
function pickAt(t: Target, sel: readonly NodeRef[], p: Vec, tol: number): Pick {
  const selected = new Set(sel.map(refKey));
  for (let sub = 0; sub < t.path.subpaths.length; sub++) {
    const nodes = t.path.subpaths[sub].nodes;
    for (let i = 0; i < nodes.length; i++) {
      const ref = { sub, i };
      if (!selected.has(refKey(ref))) continue;
      const n = nodes[i];
      if (n.in && dist(n.in, p) <= tol) return { kind: "handle", ref, which: "in" };
      if (n.out && dist(n.out, p) <= tol) return { kind: "handle", ref, which: "out" };
    }
  }
  for (let sub = 0; sub < t.path.subpaths.length; sub++) {
    const nodes = t.path.subpaths[sub].nodes;
    for (let i = 0; i < nodes.length; i++) {
      if (dist(nodes[i].p, p) <= tol) return { kind: "node", ref: { sub, i } };
    }
  }
  for (let sub = 0; sub < t.path.subpaths.length; sub++) {
    const near = nearestOnSubpath(t.path.subpaths[sub], p);
    if (near && near.dist <= tol) {
      return { kind: "segment", ref: { sub, i: near.seg }, seg: near.seg, t: near.t };
    }
  }
  return null;
}

function replacePath(ctx: ToolContext, base: Doc, path: PathShape, next: PathShape): void {
  if (next === path) return;
  ctx.commit(mapNodes(base, [path.id], () => next));
}

export function createNodeTool(): Tool {
  let mode: Mode | null = null;
  let lastTap: Tap | null = null;

  function cancelMode(ctx: ToolContext): void {
    const m = mode;
    mode = null;
    if (!m) return;
    ctx.setOverlay(null);
    if (m.kind === "nodes" || m.kind === "handle") {
      ctx.commit(m.base);
      ctx.endGesture();
    }
  }

  const cycle = (ctx: ToolContext, t: Target, ref: NodeRef) => {
    const node = t.path.subpaths[ref.sub]?.nodes[ref.i];
    if (!node) return;
    const next =
      node.type === "corner" ? "smooth" : node.type === "smooth" ? "symmetric" : "corner";
    replacePath(ctx, ctx.doc(), t.path, setNodeType(t.path, [ref], next));
  };

  return {
    id: "node",
    hint: "Click a node · drag to move · double-click a segment to add · Shift: add",
    cursor: "default",

    down(ctx, e) {
      cancelMode(ctx);
      const t = targetOf(ctx);
      if (!t) {
        pickTarget(ctx, e);
        return;
      }
      const p = applyMat(t.inv, e.doc);
      const tol = pointerTolerance(e.pointerType) / (ctx.view().zoom * t.scale);
      const pick = pickAt(t, ctx.nodeSel(), p, tol);

      // A second tap on the same thing adds a node or cycles a type (spec M4a §6). A handle's
      // key includes which one, so an `in` tap followed by an `out` tap is never a double tap.
      const tap =
        pick === null
          ? null
          : {
              id:
                pick.kind === "handle"
                  ? `handle:${refKey(pick.ref)}:${pick.which}`
                  : `${pick.kind}:${refKey(pick.ref)}`,
              time: e.time,
            };
      const second = tap !== null && isDoubleTap(lastTap, tap);
      lastTap = second ? null : tap;
      if (second && pick) {
        if (pick.kind === "segment") {
          const r = insertNode(t.path, pick.ref.sub, pick.seg, pick.t);
          if (r.path !== t.path) {
            replacePath(ctx, ctx.doc(), t.path, r.path);
            ctx.setNodeSel([r.ref]);
          }
          return;
        }
        if (pick.kind === "node") {
          cycle(ctx, t, pick.ref);
          return;
        }
      }

      if (pick === null) {
        // Empty space: either retarget to whatever is under the pointer, or start a marquee.
        const hit = hitTest(
          ctx.doc(),
          e.doc,
          pointerTolerance(e.pointerType) / ctx.view().zoom,
          ctx.enteredGroupId(),
        );
        if (hit && hit.nodeId !== t.path.id) {
          pickTarget(ctx, e);
          return;
        }
        mode = { kind: "marquee", start: e.doc, base: e.mods.shift ? ctx.nodeSel() : [] };
        if (!e.mods.shift) ctx.setNodeSel([]);
        return;
      }

      let collapseOnUp = false;
      if (pick.kind === "node") {
        const sel = ctx.nodeSel();
        const already = sel.some((r) => sameRef(r, pick.ref));
        if (e.mods.shift) {
          ctx.setNodeSel(already ? sel.filter((r) => !sameRef(r, pick.ref)) : [...sel, pick.ref]);
        } else if (!already) {
          ctx.setNodeSel([pick.ref]);
        } else if (sel.length > 1) {
          // A plain click on an already-selected node narrows the selection to it, but only if
          // the gesture turns out to be a click rather than a drag (spec M4a §6).
          collapseOnUp = true;
        }
      }
      mode = { kind: "pending", start: e, pick, collapseOnUp };
    },

    move(ctx, e) {
      const t = targetOf(ctx);
      if (!mode || !t) return;
      const p = applyMat(t.inv, e.doc);

      if (mode.kind === "pending") {
        if (!movedEnough(mode.start.screen, e.screen)) return;
        const pick = mode.pick;
        if (pick?.kind === "handle") {
          ctx.beginGesture();
          mode = { kind: "handle", base: ctx.doc(), ref: pick.ref, which: pick.which };
        } else if (pick?.kind === "node") {
          ctx.beginGesture();
          const refs = ctx.nodeSel();
          mode = {
            kind: "nodes",
            base: ctx.doc(),
            start: applyMat(t.inv, mode.start.doc),
            startDoc: mode.start.doc,
            refs: refs.length > 0 ? refs : [pick.ref],
            targets: ctx.snapEnabled()
              ? collectTargets(ctx.doc(), [t.path.id], { nodes: true })
              : null,
          };
        } else {
          return;
        }
      }

      if (mode.kind === "handle") {
        const path = pathOf(mode.base, t.path.id);
        if (path)
          replacePath(ctx, mode.base, path, moveHandle(path, mode.ref, mode.which, p, e.mods.alt));
        return;
      }
      if (mode.kind === "nodes") {
        const path = pathOf(mode.base, t.path.id);
        if (!path) return;
        let to = p;
        // Shift constrains to the nearest 45° in document space, matching what the user sees,
        // regardless of the path's own rotation (spec M4a §7).
        if (e.mods.shift) {
          const d = constrain45(e.doc.x - mode.startDoc.x, e.doc.y - mode.startDoc.y);
          to = applyMat(t.inv, { x: mode.startDoc.x + d.x, y: mode.startDoc.y + d.y });
        }
        if (mode.targets) {
          const world = applyMat(t.world, to);
          const snapped = snapPoint(world, mode.targets, SNAP_PX / ctx.view().zoom);
          ctx.setOverlay(hasGuides(snapped.guides) ? { kind: "guides", ...snapped.guides } : null);
          to = applyMat(t.inv, snapped.p);
        }
        replacePath(
          ctx,
          mode.base,
          path,
          movePathNodes(path, mode.refs, to.x - mode.start.x, to.y - mode.start.y),
        );
        return;
      }
      if (mode.kind === "marquee") {
        const box = boxFromPoints([mode.start, e.doc]);
        if (!box) return;
        ctx.setOverlay({ kind: "marquee", box });
        ctx.setNodeSel(mergeRefs(mode.base, nodesIn(t, box)));
      }
    },

    up(ctx, e) {
      const m = mode;
      mode = null;
      if (!m) return;
      if (m.kind === "pending") {
        // The gesture stayed a click (never dragged): apply a deferred collapse now.
        if (m.collapseOnUp && m.pick && m.pick.kind === "node") ctx.setNodeSel([m.pick.ref]);
        return;
      }
      this.move(ctx, e);
      ctx.setOverlay(null);
      if (m.kind !== "marquee") ctx.endGesture();
    },

    cancel(ctx) {
      cancelMode(ctx);
    },
  };
}

function pathOf(base: Doc, id: string): PathShape | null {
  const found = findNode(base, id);
  return found && found.node.kind === "path" ? found.node : null;
}

/** Nodes are tested by their world position (spec M4a §7), since the marquee itself is drawn and
 *  dragged in document space. */
function nodesIn(t: Target, box: Box): NodeRef[] {
  const out: NodeRef[] = [];
  t.path.subpaths.forEach((sp, sub) => {
    sp.nodes.forEach((n, i) => {
      const q = applyMat(t.world, n.p);
      if (q.x >= box.x && q.x <= box.x + box.w && q.y >= box.y && q.y <= box.y + box.h) {
        out.push({ sub, i });
      }
    });
  });
  return out;
}

function mergeRefs(base: readonly NodeRef[], found: readonly NodeRef[]): NodeRef[] {
  const seen = new Set(base.map(refKey));
  const out = [...base];
  for (const r of found) {
    if (seen.has(refKey(r))) continue;
    seen.add(refKey(r));
    out.push(r);
  }
  return out;
}

/** Clicking away from the current target: pick a new path, refuse a live shape, or clear. */
function pickTarget(ctx: ToolContext, e: ToolEvent): void {
  const doc = ctx.doc();
  const hit = hitTest(
    doc,
    e.doc,
    pointerTolerance(e.pointerType) / ctx.view().zoom,
    ctx.enteredGroupId(),
  );
  if (!hit) {
    ctx.setNodeTarget(null);
    ctx.setSelection([]);
    return;
  }
  const found = findNode(doc, hit.nodeId);
  const node = found?.node;
  if (!node) return;
  ctx.setSelection([node.id]);
  if (node.kind === "path") {
    ctx.setNodeTarget(node.id);
    return;
  }
  ctx.setNodeTarget(null);
  if (node.kind !== "group") {
    ctx.notify(
      "info",
      `“${rowLabel(node)}” is a live shape — use Convert to path to edit its nodes.`,
    );
  }
}
