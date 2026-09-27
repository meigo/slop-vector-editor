import { nodeBounds } from "../geom/bounds";
import type { Box } from "../geom/box";
import { applyMat, IDENTITY, invert, multiply, type Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";
import {
  DEFAULT_STYLE,
  flatIfDegenerate,
  isGradient,
  isLinear,
  sameFill,
  type Doc,
  type Fill,
  type Gradient,
  type LinearGradient,
  type Node,
  type Paint,
  type Shape,
} from "./document";
import { mapNodes } from "./tree";

/** Spec M15 §6–§7: the gradient edits. Each maps shape by shape, so no shape is ever handed
 *  another shape's coordinates. */

export type PaintSlot = "fill" | "stroke";
export type StopEnd = "start" | "end";

function withFill(s: Shape, which: PaintSlot, f: Fill | null): Shape {
  return sameFill(s.style[which], f) ? s : { ...s, style: { ...s.style, [which]: f } };
}

/** Maps every shape under `ids`, groups descended, with each shape's world matrix. */
function mapShapesWorld(
  doc: Doc,
  ids: readonly string[],
  fn: (s: Shape, world: Mat) => Shape,
): Doc {
  const walk = (n: Node, parent: Mat): Node => {
    const world = multiply(parent, n.transform);
    if (n.kind !== "group") return fn(n, world);
    let changed = false;
    const children = n.children.map((c) => {
      const m = walk(c, world);
      if (m !== c) changed = true;
      return m;
    });
    return changed ? { ...n, children } : n;
  };
  return mapNodes(doc, ids, walk);
}

/** A fade from the paint to the same colour at opacity 0: the most common first gradient, and
 *  one that is visibly a gradient (spec M15 ruling 5). */
const fadeOf = (p: Paint, from: Vec, to: Vec): LinearGradient => ({
  kind: "linear",
  from,
  to,
  start: p,
  end: { ...p, opacity: 0 },
});

/** A gradient set aside when its paint went flat, with the shape's own-space box at the time, so
 *  switching back can restore it — and stretch it if the shape was resized in between. */
export type RememberedGradient = { g: Gradient; box: Box | null };

const ownBox = (s: Shape): Box | null => nodeBounds({ ...s, transform: IDENTITY }, IDENTITY);

/** The linear paints `setPaintKind(…, "flat")` is about to discard, keyed by shape id. The store
 *  keeps them for the session; nothing here is saved. */
export function gradientsToRemember(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
): [string, RememberedGradient][] {
  const out: [string, RememberedGradient][] = [];
  mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    if (isGradient(f)) out.push([s.id, { g: f, box: ownBox(s) }]);
    return s;
  });
  return out;
}

/** The remembered line (or, for a radial, the three points — spec M16) carried from the box it was
 *  set aside in to the shape's box now, axis by axis; an axis that had no extent then only moves.
 *  The start stop is the flat colour the paint has now, so a colour picked while flat is kept. */
function restored(r: RememberedGradient, box: Box | null, start: Paint): Fill {
  const a = r.box;
  const axis = (v: number, a0: number, aw: number, b0: number, bw: number) =>
    aw > 0 ? b0 + ((v - a0) * bw) / aw : v + (b0 - a0);
  const map = (p: Vec): Vec =>
    !a || !box ? p : { x: axis(p.x, a.x, a.w, box.x, box.w), y: axis(p.y, a.y, a.h, box.y, box.h) };
  return r.g.kind === "linear"
    ? flatIfDegenerate({ ...r.g, from: map(r.g.from), to: map(r.g.to), start })
    : flatIfDegenerate({ ...r.g, center: map(r.g.center), a: map(r.g.a), b: map(r.g.b), start });
}

/** `remembered` answers the gradient a shape's paint had before it went flat, if the session
 *  still knows it; Flat→Linear restores that instead of the default fade. */
export function setPaintKind(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  kind: "flat" | "linear",
  remembered: (id: string) => RememberedGradient | undefined = () => undefined,
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    if (f === null) return s;
    if (kind === "flat") return isGradient(f) ? withFill(s, which, f.start) : s;
    if (isGradient(f)) return s;
    const box = ownBox(s);
    const r = remembered(s.id);
    if (r) return withFill(s, which, restored(r, box, f));
    if (!box || (box.w <= 0 && box.h <= 0)) return s;
    // A zero-width shape (a vertical line) has no horizontal mid-line to fade across, but it does
    // have a vertical one — lay the default line along it instead of silently doing nothing
    // (review finding 3).
    const [from, to] =
      box.w > 0
        ? [
            { x: box.x, y: box.y + box.h / 2 },
            { x: box.x + box.w, y: box.y + box.h / 2 },
          ]
        : [
            { x: box.x, y: box.y },
            { x: box.x, y: box.y + box.h },
          ];
    return withFill(s, which, fadeOf(f, from, to));
  });
}

export function setGradientStop(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  stop: StopEnd,
  paint: Paint,
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    return isGradient(f) ? withFill(s, which, { ...f, [stop]: paint }) : s;
  });
}

/** `from`/`to` in the shape's own space; used by the tool's knob and line drags. Linear only — a
 *  radial's own handles arrive later (task 5). */
export function setGradientPoints(doc: Doc, id: string, which: PaintSlot, from: Vec, to: Vec): Doc {
  return mapNodes(doc, [id], (n) => {
    if (n.kind === "group") return n;
    const f = n.style[which];
    return isLinear(f) ? withFill(n, which, flatIfDegenerate({ ...f, from, to })) : n;
  });
}

/** One document-space line mapped into every shape under `ids`, so a line drawn across several
 *  shapes reads as one continuous gradient (spec M15 §7). Linear only — drawing a radial's line
 *  arrives later (task 5), so a radial paint is redrawn as a fresh linear fade, same as a flat one. */
export function drawGradientLine(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  from: Vec,
  to: Vec,
): Doc {
  return mapShapesWorld(doc, ids, (s, world) => {
    const inv = invert(world);
    if (!inv) return s;
    const a = applyMat(inv, from);
    const b = applyMat(inv, to);
    const f = s.style[which];
    const next: LinearGradient = isLinear(f)
      ? { ...f, from: a, to: b }
      : fadeOf((isGradient(f) ? f.start : f) ?? (DEFAULT_STYLE[which] as Paint), a, b);
    return withFill(s, which, flatIfDegenerate(next));
  });
}
