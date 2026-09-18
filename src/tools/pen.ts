import type { Doc, PathNode, PathShape, Subpath } from "../doc/document";
import { addShape } from "../doc/edits";
import { blockMessage, layerBlock } from "../doc/layers";
import { findNode, mapNodes } from "../doc/tree";
import { flattenSubpath } from "../geom/bezier";
import { applyMat, IDENTITY, type Mat } from "../geom/mat";
import { collectTargets, SNAP_PX, snapPoint, type SnapTargets } from "../geom/snap";
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
  layerId: string;
  targets: SnapTargets | null;
};

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** `to` constrained to 45° steps measured from `from`. */
function constrain45(from: Vec, to: Vec): Vec {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.round(Math.atan2(dy, dx) / SNAP_45) * SNAP_45;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const along = dx * c + dy * s;
  const horizontal = Math.abs(s) < 1e-9;
  const vertical = Math.abs(c) < 1e-9;
  return {
    x: from.x + (vertical ? 0 : along * c),
    y: from.y + (horizontal ? 0 : along * s),
  };
}

export function createPenTool(): Tool {
  let draft: Draft | null = null;
  let pulling: { start: Vec; dragging: boolean } | null = null;
  let lastTap: Tap | null = null;

  const toDoc = (d: Draft, p: Vec) => applyMat(d.world, p);
  const toLocal = (d: Draft, p: Vec) => applyMat(d.inv, p);

  /** The point a press places, after Shift and snapping (both in document space). */
  const placeAt = (ctx: ToolContext, d: Draft, e: ToolEvent): Vec => {
    const last = d.nodes[d.nodes.length - 1];
    let at = e.doc;
    if (last && e.mods.shift) at = constrain45(toDoc(d, last.p), at);
    if (d.targets) at = snapPoint(at, d.targets, SNAP_PX / ctx.view().zoom).p;
    return at;
  };

  const paint = (ctx: ToolContext, pointer: Vec | null) => {
    const d = draft;
    if (!d || d.nodes.length === 0) {
      ctx.setOverlay(null);
      return;
    }
    const sp: Subpath = { nodes: d.nodes, closed: false };
    const last = d.nodes[d.nodes.length - 1];
    const handles: { a: Vec; b: Vec }[] = [];
    if (last.in) handles.push({ a: toDoc(d, last.p), b: toDoc(d, last.in) });
    if (last.out) handles.push({ a: toDoc(d, last.p), b: toDoc(d, last.out) });
    ctx.setOverlay({
      kind: "pen",
      outline: [flattenSubpath(sp).map((p) => toDoc(d, p))],
      knobs: d.nodes.map((n) => toDoc(d, n.p)),
      handles,
      rubber: pointer ? { a: toDoc(d, last.p), b: pointer } : null,
    });
  };

  /** Writes the draft into the document, or drops it when it is too short to draw. */
  const finish = (ctx: ToolContext, close: boolean) => {
    const d = draft;
    draft = null;
    pulling = null;
    lastTap = null;
    ctx.setOverlay(null);
    if (!d || d.nodes.length < 2) return;
    const subpath: Subpath = { nodes: d.nodes, closed: close };
    if (d.pathId === null) {
      const shape: PathShape = {
        kind: "path",
        id: "",
        transform: IDENTITY,
        style: ctx.prefs().style,
        subpaths: [subpath],
      };
      const r = addShape(ctx.doc(), d.layerId, shape);
      ctx.commit(r.doc);
      ctx.setSelection([r.id]);
      return;
    }
    const found = findNode(ctx.doc(), d.pathId);
    if (!found || found.node.kind !== "path") return;
    const path = found.node;
    const next: PathShape = {
      ...path,
      subpaths: path.subpaths.map((sp, i) => (i === d.sub ? subpath : sp)),
    };
    ctx.commit(mapNodes(ctx.doc(), [path.id], () => next));
    ctx.setSelection([path.id]);
  };

  return {
    id: "pen",
    hint: "Click to place · drag for a curve · click the first node to close · Enter to finish",
    cursor: "crosshair",

    down(ctx, e) {
      const doc = ctx.doc();
      const tol = pointerTolerance(e.pointerType) / ctx.view().zoom;
      if (!draft) {
        const resumed = resumeAt(doc, e.doc, tol, ctx.snapEnabled());
        if (resumed) {
          draft = resumed;
          lastTap = null;
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
          layerId,
          targets: ctx.snapEnabled() ? collectTargets(doc, [], { nodes: true }) : null,
        };
      }

      const d = draft;
      // A second press in the same place finishes the path (spec M4b §3).
      const tap = { id: "pen", time: e.time };
      if (d.nodes.length >= 2 && isDoubleTap(lastTap, tap)) {
        finish(ctx, false);
        return;
      }
      lastTap = tap;

      const first = d.nodes[0];
      if (d.nodes.length >= 2 && first && dist(toDoc(d, first.p), e.doc) <= tol) {
        finish(ctx, true);
        return;
      }

      const at = placeAt(ctx, d, e);
      d.nodes.push({ p: toLocal(d, at), in: null, out: null, type: "corner" });
      pulling = { start: e.screen, dragging: false };
      paint(ctx, null);
    },

    move(ctx, e) {
      const d = draft;
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
      if (draft) paint(ctx, e.doc);
    },

    /** A lost press must not cost the drawing (spec M4b §8): keep the draft. */
    cancel(ctx) {
      pulling = null;
      if (draft) paint(ctx, null);
    },

    hover(ctx, e) {
      if (draft) paint(ctx, e.doc);
    },

    busy() {
      return draft !== null;
    },

    keydown(ctx, key) {
      if (!draft) return false;
      if (key === "escape") {
        draft = null;
        pulling = null;
        lastTap = null;
        ctx.setOverlay(null);
        return true;
      }
      if (key === "enter") {
        finish(ctx, false);
        return true;
      }
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

/** Spec (M4b) §5 — filled in by Task 4; until then the pen always starts a new path. */
function resumeAt(_doc: Doc, _at: Vec, _tol: number, _snap: boolean): Draft | null {
  return null;
}
