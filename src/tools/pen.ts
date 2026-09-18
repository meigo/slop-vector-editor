import type { Doc, Node, PathNode, PathShape, Subpath } from "../doc/document";
import { addShape } from "../doc/edits";
import { blockMessage, layerBlock } from "../doc/layers";
import { appendNode, reverseSubpath } from "../doc/path-edit";
import { findNode, mapNodes } from "../doc/tree";
import { flattenSubpath } from "../geom/bezier";
import { applyMat, IDENTITY, invert, multiply, type Mat } from "../geom/mat";
import { collectTargets, SNAP_PX, snapPoint, type Axes, type SnapTargets } from "../geom/snap";
import type { Vec } from "../geom/vec";
import { isDoubleTap, type Tap } from "../input/double-tap";
import { SNAP_45 } from "./shape-tools";
import { movedEnough, pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

/** Spec (M4b) §2. The path being drawn lives here and in the overlay, never in the document, so a
 *  one-node path can't reach the file and the whole stroke is one undo step. */
type Draft = {
  /** null while drawing a new path; the id of the path being extended when resuming (§5). */
  pathId: string | null;
  sub: number;
  world: Mat;
  inv: Mat;
  nodes: PathNode[];
  /** How many leading nodes were copied from the resumed path (0 for a new path). Backspace stops
   *  there, and the commit appends only what follows — the originals are never written back. */
  base: number;
  /** Whether the resumed subpath was reversed so the pen could append (§5). */
  reversed: boolean;
  layerId: string;
  targets: SnapTargets | null;
};

/** The writer's own merge tolerance (`mergeCoincident` in `geom/shapes.ts`): two nodes this close
 *  become one on reload, so the pen must not place them. */
const COINCIDENT = 1e-6;

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

const coincident = (a: Vec, b: Vec) =>
  Math.abs(a.x - b.x) <= COINCIDENT && Math.abs(a.y - b.y) <= COINCIDENT;

/** `to` constrained to 45° steps measured from `from`, with the axes that constraint pins. Those
 *  go on to `snapPoint`, so snapping to a target near the locked-out axis can't pull the point off
 *  the exact 45° (the node and select tools do the same). */
function constrain45(from: Vec, to: Vec): { p: Vec; axes: Axes } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.round(Math.atan2(dy, dx) / SNAP_45) * SNAP_45;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const along = dx * c + dy * s;
  const horizontal = Math.abs(s) < 1e-9;
  const vertical = Math.abs(c) < 1e-9;
  const axes: Axes = horizontal
    ? { x: true, y: false }
    : vertical
      ? { x: false, y: true }
      : { x: false, y: false };
  return {
    p: {
      x: from.x + (vertical ? 0 : along * c),
      y: from.y + (horizontal ? 0 : along * s),
    },
    axes,
  };
}

export function createPenTool(): Tool {
  let draft: Draft | null = null;
  let pulling: { start: Vec; dragging: boolean } | null = null;
  let lastTap: Tap | null = null;
  let lastTapPos: Vec | null = null;
  /** The last pointer seen, so the overlay can size the close tolerance between presses. */
  let pointerKind = "mouse";

  const toDoc = (d: Draft, p: Vec) => applyMat(d.world, p);
  const toLocal = (d: Draft, p: Vec) => applyMat(d.inv, p);

  /** The point a press places, after Shift and snapping (both in document space). */
  const placeAt = (ctx: ToolContext, d: Draft, e: ToolEvent): Vec => {
    const last = d.nodes[d.nodes.length - 1];
    let at = e.doc;
    let axes: Axes | undefined;
    if (last && e.mods.shift) {
      const c = constrain45(toDoc(d, last.p), at);
      at = c.p;
      axes = c.axes;
    }
    if (d.targets) at = snapPoint(at, d.targets, SNAP_PX / ctx.view().zoom, axes).p;
    return at;
  };

  const paint = (ctx: ToolContext, pointer: Vec | null) => {
    const d = draft;
    if (!d || d.nodes.length === 0) {
      ctx.setOverlay(null);
      return;
    }
    const view = ctx.view();
    // Flatten at the on-screen scale, as the node overlay does, or a curve drawn zoomed in looks
    // polygonal while it is being drawn.
    const det = Math.sqrt(Math.abs(d.world[0] * d.world[3] - d.world[1] * d.world[2])) * view.zoom;
    const scale = Number.isFinite(det) && det > 0 ? det : 1;
    const sp: Subpath = { nodes: d.nodes, closed: false };
    const first = d.nodes[0];
    const last = d.nodes[d.nodes.length - 1];
    const handles: { a: Vec; b: Vec }[] = [];
    if (last.in) handles.push({ a: toDoc(d, last.p), b: toDoc(d, last.in) });
    if (last.out) handles.push({ a: toDoc(d, last.p), b: toDoc(d, last.out) });
    ctx.setOverlay({
      kind: "pen",
      outline: [flattenSubpath(sp, scale).map((p) => toDoc(d, p))],
      knobs: d.nodes.map((n) => toDoc(d, n.p)),
      handles,
      rubber: pointer ? { a: toDoc(d, last.p), b: pointer } : null,
      // Spec §7: the first knob fills once a press there would close the path.
      closeHint:
        d.nodes.length >= 2 &&
        pointer !== null &&
        dist(toDoc(d, first.p), pointer) <= pointerTolerance(pointerKind) / view.zoom,
    });
  };

  /** Ends the stroke: the draft is gone and the overlay is clear whatever happens next. */
  const reset = (ctx: ToolContext): Draft | null => {
    const d = draft;
    draft = null;
    pulling = null;
    lastTap = null;
    lastTapPos = null;
    ctx.setOverlay(null);
    return d;
  };

  /** Writes the draft into the document, or drops it when it is too short to draw. */
  const finish = (ctx: ToolContext, close: boolean) => {
    const d = reset(ctx);
    if (!d || d.nodes.length < 2) return;
    if (d.pathId === null) {
      const doc = ctx.doc();
      // The layer captured at the first press may be gone by now: fall back to the current layer,
      // and drop the drawing rather than let `addShape` throw when neither exists.
      const layerId = [d.layerId, ctx.currentLayerId()].find((id) =>
        doc.layers.some((l) => l.id === id),
      );
      if (layerId === undefined) return;
      const shape: PathShape = {
        kind: "path",
        id: "",
        transform: IDENTITY,
        style: ctx.prefs().style,
        subpaths: [{ nodes: d.nodes, closed: close }],
      };
      const r = addShape(doc, layerId, shape);
      ctx.commit(r.doc);
      ctx.setSelection([r.id]);
      return;
    }
    // A resumed path is re-read now and only the nodes added during this stroke are appended: the
    // copies taken at resume are stale — the path may have moved, or been edited, since.
    const found = findNode(ctx.doc(), d.pathId);
    if (!found || found.node.kind !== "path") return;
    const path = found.node;
    const current = path.subpaths[d.sub];
    if (!current || current.closed) return;
    const added = d.nodes.slice(d.base);
    if (added.length === 0 && !close) return;
    // Reversing only matters when something is appended; closing in place keeps the node order.
    let next = added.length > 0 && d.reversed ? reverseSubpath(path, d.sub) : path;
    for (const n of added) next = appendNode(next, d.sub, n);
    if (close) {
      const subpaths = next.subpaths.slice();
      subpaths[d.sub] = { ...subpaths[d.sub], closed: true };
      next = { ...next, subpaths };
    }
    if (next === path) return;
    ctx.commit(mapNodes(ctx.doc(), [path.id], () => next));
    ctx.setSelection([path.id]);
  };

  return {
    id: "pen",
    hint: "Click to place · drag for a curve · click the first node to close · Enter to finish",
    cursor: "crosshair",

    down(ctx, e) {
      const doc = ctx.doc();
      pointerKind = e.pointerType;
      const tol = pointerTolerance(e.pointerType) / ctx.view().zoom;
      if (!draft) {
        const resumed = resumeAt(doc, e.doc, tol, ctx.snapEnabled());
        if (resumed) {
          draft = resumed;
          lastTap = null;
          lastTapPos = null;
          paint(ctx, e.doc);
          return;
        }
        const layerId = ctx.currentLayerId();
        const block = layerBlock(doc, layerId);
        if (block) {
          ctx.notify("info", blockMessage(block, "draw"));
          return;
        }
        draft = {
          pathId: null,
          sub: 0,
          world: IDENTITY,
          inv: IDENTITY,
          nodes: [],
          base: 0,
          reversed: false,
          layerId,
          targets: ctx.snapEnabled() ? collectTargets(doc, [], { nodes: true }) : null,
        };
      }

      const d = draft;
      // A second press finishes the path, but only when it lands where the first one did (spec
      // M4b §3) — isDoubleTap alone only checks timing, so a fast, distant press must not count.
      const tap = { id: "pen", time: e.time };
      if (
        d.nodes.length >= 2 &&
        isDoubleTap(lastTap, tap) &&
        lastTapPos &&
        dist(lastTapPos, e.doc) <= tol
      ) {
        finish(ctx, false);
        return;
      }
      lastTap = tap;
      lastTapPos = e.doc;

      // The placed point is worked out before the close test: snapping can move a press that was
      // outside the close tolerance right onto the first node, and placing a copy of it would be
      // the one shape the M4b constraint forbids (a node lost on reload).
      const at = placeAt(ctx, d, e);
      const first = d.nodes[0];
      if (
        d.nodes.length >= 2 &&
        first &&
        (dist(toDoc(d, first.p), e.doc) <= tol || dist(toDoc(d, first.p), at) <= tol)
      ) {
        finish(ctx, true);
        return;
      }

      const p = toLocal(d, at);
      const last = d.nodes[d.nodes.length - 1];
      // A press that lands on the previous node could only make a zero-length segment, which the
      // writer's own merge tolerance would collapse on reload.
      if (last && coincident(p, last.p)) return;
      d.nodes.push({ p, in: null, out: null, type: "corner" });
      pulling = { start: e.screen, dragging: false };
      paint(ctx, null);
    },

    move(ctx, e) {
      const d = draft;
      pointerKind = e.pointerType;
      if (!d || !pulling) return;
      if (!pulling.dragging && !movedEnough(pulling.start, e.screen)) return;
      pulling.dragging = true;
      const last = d.nodes[d.nodes.length - 1];
      const out = toLocal(d, e.doc);
      last.out = out;
      if (e.mods.alt) {
        last.in = null;
        last.type = "corner";
      } else {
        last.in = { x: 2 * last.p.x - out.x, y: 2 * last.p.y - out.y };
        last.type = "symmetric";
      }
      paint(ctx, null);
    },

    up(ctx, e) {
      pulling = null;
      pointerKind = e.pointerType;
      if (draft) paint(ctx, e.doc);
    },

    /** A lost press must not cost the drawing (spec M4b §8): keep the draft. */
    cancel(ctx) {
      pulling = null;
      if (draft) paint(ctx, null);
    },

    hover(ctx, e) {
      pointerKind = e.pointerType;
      if (draft) paint(ctx, e.doc);
    },

    busy() {
      return draft !== null;
    },

    /** The store calls this when the whole document changes under the draft (replace, undo, redo):
     *  nothing is committed and the drawing is dropped. */
    discard(ctx) {
      reset(ctx);
    },

    keydown(ctx, key) {
      if (!draft) return false;
      if (key === "escape") {
        reset(ctx);
        return true;
      }
      if (key === "enter") {
        finish(ctx, false);
        return true;
      }
      // Backspace removes the last node *you placed*: the nodes a resume copied are the original
      // path's and are never the pen's to delete.
      if (draft.nodes.length <= draft.base) return true;
      draft.nodes.pop();
      if (draft.nodes.length === 0) {
        draft = null;
        ctx.setOverlay(null);
      } else {
        paint(ctx, null);
      }
      return true;
    },
  };
}

/** Spec (M4b) §5: a press near an open path's end continues that path. The subpath is reversed when
 *  the pen starts from its first node, so drawing always appends. */
function resumeAt(doc: Doc, at: Vec, tol: number, snap: boolean): Draft | null {
  let best: Draft | null = null;
  let bestDist = Infinity;

  const visit = (node: Node, parent: Mat, layerId: string) => {
    const world = multiply(parent, node.transform);
    if (node.kind === "group") {
      for (const child of node.children) visit(child, world, layerId);
      return;
    }
    if (node.kind !== "path") return;
    const inv = invert(world);
    if (!inv) return;
    node.subpaths.forEach((sp, sub) => {
      if (sp.closed || sp.nodes.length < 2) return;
      const ends = [
        { index: 0, reverse: true },
        { index: sp.nodes.length - 1, reverse: false },
      ];
      for (const end of ends) {
        const d = dist(applyMat(world, sp.nodes[end.index].p), at);
        if (d > tol || d >= bestDist) continue;
        bestDist = d;
        const nodes = end.reverse
          ? reverseSubpath(node, sub).subpaths[sub].nodes.slice()
          : sp.nodes.slice();
        best = {
          pathId: node.id,
          sub,
          world,
          inv,
          nodes,
          base: nodes.length,
          reversed: end.reverse,
          layerId,
          targets: snap ? collectTargets(doc, [node.id], { nodes: true }) : null,
        };
      }
    });
  };

  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const node of layer.children) visit(node, IDENTITY, layer.id);
  }
  return best;
}
