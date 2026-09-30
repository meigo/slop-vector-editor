import {
  isHidden,
  isLinear,
  isRadial,
  midOf,
  midPaintOf,
  type Doc,
  type Node,
  type Paint,
  type Shape,
} from "../doc/document";
import type { PaintSlot } from "../doc/paint-edit";
import { ancestorIds, findNode, isAfter, paintKey } from "../doc/tree";
import { applyMat, multiply, type Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";

const lerp = (p: Vec, q: Vec, t: number): Vec => ({
  x: p.x + (q.x - p.x) * t,
  y: p.y + (q.y - p.y) * t,
});

/** Spec M15 §7, M16 §6: the one function the Overlay draws from and the tool hit-tests against, so
 *  the two can never disagree (the gizmo's rule, invariant 14). Points are in document space. */
export type GradientHandle =
  | {
      kind: "linear";
      id: string;
      from: Vec;
      to: Vec;
      /** Spec M17 §6: the midpoint diamond, in document space — affine maps keep ratios along a
       *  line, so document-space `t` equals own-space `t`. */
      mid: Vec;
      /** Spec M18 §5: the diamond's colour — custom, or the mix. */
      midPaint: Paint;
      start: Paint;
      end: Paint;
      world: Mat;
    }
  | {
      kind: "radial";
      id: string;
      center: Vec;
      a: Vec;
      b: Vec;
      mid: Vec;
      midPaint: Paint;
      start: Paint;
      end: Paint;
      world: Mat;
    };

/** Document order (back to front), regardless of the order `ids` lists them in — `pickHandle`
 *  scans from the end, so this is what makes the frontmost shape's knob win a coincident pick
 *  (invariant 14: it must agree with `hitTest`, which scans the reach in reverse). An id whose
 *  ancestor is also selected is dropped: the ancestor's own expansion into `shapesWithWorld`
 *  already reaches it, and keeping both would double its handle. */
/** `shapesWithWorld` without hidden nodes or anything inside them (review L15): a hidden child of
 *  a selected group has nothing on screen for its knobs to belong to. */
function visibleShapes(node: Node, parent: Mat): { shape: Shape; world: Mat }[] {
  if (isHidden(node)) return [];
  const world = multiply(parent, node.transform);
  if (node.kind !== "group") return [{ shape: node, world }];
  return node.children.flatMap((c) => visibleShapes(c, world));
}

export function gradientHandles(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
): GradientHandle[] {
  const idSet = new Set(ids);
  const founds = [...idSet]
    .filter((id) => !ancestorIds(doc, id).some((a) => idSet.has(a)))
    .map((id) => findNode(doc, id))
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .map((f) => ({ found: f, key: paintKey(f.layerIndex, f.path) }));
  founds.sort((a, b) => (isAfter(a.key, b.key) ? 1 : isAfter(b.key, a.key) ? -1 : 0));

  const out: GradientHandle[] = [];
  for (const { found } of founds) {
    for (const { shape, world } of visibleShapes(found.node, found.parent)) {
      const f = shape.style[which];
      if (isLinear(f)) {
        const from = applyMat(world, f.from);
        const to = applyMat(world, f.to);
        out.push({
          kind: "linear",
          id: shape.id,
          from,
          to,
          mid: lerp(from, to, midOf(f)),
          midPaint: midPaintOf(f),
          start: f.start,
          end: f.end,
          world,
        });
      } else if (isRadial(f)) {
        const center = applyMat(world, f.center);
        const a = applyMat(world, f.a);
        out.push({
          kind: "radial",
          id: shape.id,
          center,
          a,
          b: applyMat(world, f.b),
          mid: lerp(center, a, midOf(f)),
          midPaint: midPaintOf(f),
          start: f.start,
          end: f.end,
          world,
        });
      }
    }
  }
  return out;
}

export type HandlePart = "start" | "end" | "line" | "center" | "rimA" | "rimB" | "mid";
export type HandlePick = { h: GradientHandle; part: HandlePart } | null;

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function toSegment(p: Vec, a: Vec, b: Vec): number {
  const v = { x: b.x - a.x, y: b.y - a.y };
  const vv = v.x * v.x + v.y * v.y;
  const t = vv === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / vv));
  return dist(p, { x: a.x + v.x * t, y: a.y + v.y * t });
}

/** Knobs first, across every handle, then lines — a knob sits on its own line. Both passes scan
 *  from the end, so a coincident pick goes to the FRONTMOST shape, matching `hitTest` (which scans
 *  the reach in reverse) and the Overlay (which draws `handles` in the same back-to-front order,
 *  so the frontmost knob is also the one drawn on top — invariant 14). Radial knobs: centre, then
 *  rim A, then rim B; radial lines: centre→A and centre→B (both part `"line"`, spec M16 §6).
 *
 *  Within ONE handle, the NEAREST knob inside tolerance wins (review finding 2): on a small
 *  radial all three knobs can sit within `tol` of each other, and always taking the first in
 *  declared order made the far side of a small ellipse unreachable. A tie (equal distance) keeps
 *  the declared order — centre, A, B; start, end — which is also why the Overlay draws each
 *  handle's knobs in the reverse of that order, so the knob a tie picks is the one drawn on top.
 *  Diamonds (spec M17 §6) are a pass of their own between the two. */
export function pickHandle(handles: readonly GradientHandle[], p: Vec, tol: number): HandlePick {
  for (let i = handles.length - 1; i >= 0; i--) {
    const h = handles[i];
    const knobs: { part: HandlePart; at: Vec }[] =
      h.kind === "linear"
        ? [
            { part: "start", at: h.from },
            { part: "end", at: h.to },
          ]
        : [
            { part: "center", at: h.center },
            { part: "rimA", at: h.a },
            { part: "rimB", at: h.b },
          ];
    let best: { part: HandlePart; d: number } | null = null;
    for (const k of knobs) {
      const d = dist(k.at, p);
      if (d <= tol && (!best || d < best.d)) best = { part: k.part, d };
    }
    if (best) return { h, part: best.part };
  }
  // Spec M17 §6: diamonds after every knob (a short gradient's diamond sits under its knobs, and
  // the knob must win — the panel is the route then) and before every line.
  for (let i = handles.length - 1; i >= 0; i--) {
    if (dist(handles[i].mid, p) <= tol) return { h: handles[i], part: "mid" };
  }
  for (let i = handles.length - 1; i >= 0; i--) {
    const h = handles[i];
    if (h.kind === "linear") {
      if (toSegment(p, h.from, h.to) <= tol) return { h, part: "line" };
    } else {
      if (toSegment(p, h.center, h.a) <= tol || toSegment(p, h.center, h.b) <= tol) {
        return { h, part: "line" };
      }
    }
  }
  return null;
}
