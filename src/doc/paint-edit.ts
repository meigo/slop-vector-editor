import { nodeBounds } from "../geom/bounds";
import type { Box } from "../geom/box";
import { applyMat, IDENTITY, invert, multiply, type Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";
import {
  DEFAULT_STYLE,
  flatIfDegenerate,
  isGradient,
  midStop,
  sameFill,
  withMid,
  withMidPaint,
  type Doc,
  type Fill,
  type Gradient,
  type LinearGradient,
  type Node,
  type Paint,
  type RadialGradient,
  type Shape,
} from "./document";
import { mapNodes } from "./tree";

/** Spec M15 §6–§7, M16 §5–§6, M18 §2: the gradient edits. Each maps shape by shape, so no shape
 *  is ever handed another shape's coordinates. */

export type PaintSlot = "fill" | "stroke";
/** Spec M18 §2: "mid" is the middle stop (its colour is `midPaint`). */
export type StopEnd = "start" | "mid" | "end";
export type GradientKind = "linear" | "radial";

/** Rotates a vector 90°: `to − from` becomes the radial's other rim direction (spec M16 §5). */
const perp = (v: Vec): Vec => ({ x: -v.y, y: v.x });

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

/** Linear ↔ radial conversion keeps the stops and reads centre = start point, rim = end point
 *  (spec M16 §5 ruling 3); a gradient already of the target kind is returned as itself. */
export function toRadial(g: Gradient): RadialGradient {
  if (g.kind === "radial") return g;
  const rim = perp({ x: g.to.x - g.from.x, y: g.to.y - g.from.y });
  return carry(
    {
      kind: "radial",
      center: g.from,
      a: g.to,
      b: { x: g.from.x + rim.x, y: g.from.y + rim.y },
      start: g.start,
      end: g.end,
    },
    g,
  );
}

export function toLinear(g: Gradient): LinearGradient {
  return g.kind === "linear"
    ? g
    : carry({ kind: "linear", from: g.center, to: g.a, start: g.start, end: g.end }, g);
}

const convertKind = (g: Gradient, kind: GradientKind): Gradient =>
  kind === "radial" ? toRadial(g) : toLinear(g);

/** The stop properties that ride along whenever a gradient is rebuilt from its geometry: the
 *  midpoint (M17) and the middle colour (M18). */
type StopProps = { mid?: number; midPaint?: Paint };
const carry = <G extends Gradient>(g: G, src: StopProps): G =>
  withMidPaint(withMid(g, src.mid), src.midPaint);

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
 *  `start` is the flat colour the paint has now, so a colour picked while flat is kept; `end`
 *  defaults to the remembered gradient's own end stop (Flat→Linear/Radial has no other end to
 *  offer) but a kind-to-kind restore passes the CURRENT gradient's end too, so a stop edited after
 *  the earlier conversion survives (fix M16, "switching Type back restores the gradient") — and,
 *  likewise, the CURRENT midpoint and middle colour (spec M17 §2, M18 §2: stop properties). */
function restored(
  r: RememberedGradient,
  box: Box | null,
  start: Paint,
  end: Paint = r.g.end,
  props: StopProps = r.g,
): Fill {
  const a = r.box;
  const axis = (v: number, a0: number, aw: number, b0: number, bw: number) =>
    aw > 0 ? b0 + ((v - a0) * bw) / aw : v + (b0 - a0);
  const map = (p: Vec): Vec =>
    !a || !box ? p : { x: axis(p.x, a.x, a.w, box.x, box.w), y: axis(p.y, a.y, a.h, box.y, box.h) };
  return r.g.kind === "linear"
    ? flatIfDegenerate(carry({ ...r.g, from: map(r.g.from), to: map(r.g.to), start, end }, props))
    : flatIfDegenerate(
        carry({ ...r.g, center: map(r.g.center), a: map(r.g.a), b: map(r.g.b), start, end }, props),
      );
}

/** Converts `f` (a gradient already known to be of some OTHER kind than `kind`) to `kind`: a
 *  remembered gradient of that kind, if one exists, is restored into the shape's current
 *  own-space box (`restored()`'s carry-with-the-box logic) with `f`'s CURRENT stops, so a colour
 *  edited after the earlier conversion survives; otherwise the ordinary point-based conversion —
 *  which loses whatever the other kind's geometry has no matching point for (a radial's rim B has
 *  no linear equivalent) — same as before nothing was remembered (fix M16). */
function convertOrRestore(
  f: Gradient,
  kind: GradientKind,
  box: Box | null,
  r: RememberedGradient | undefined,
): Fill {
  return r && r.g.kind === kind ? restored(r, box, f.start, f.end, f) : convertKind(f, kind);
}

/** `remembered` answers the gradient (either kind) a shape's paint had before it went flat, if
 *  the session still knows it; Flat→Linear/Radial restores that, converted to the requested kind,
 *  instead of the default. A gradient already of the requested kind is left alone; one of the
 *  other kind is converted — restoring a remembered gradient of the requested kind, carried to the
 *  current box, when the session has one; the ordinary point-based conversion otherwise (spec M16
 *  §5; the memory case is the fix for "Radial→Linear→Radial turns an ellipse into a circle"). */
export function setPaintKind(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  kind: "flat" | GradientKind,
  remembered: (id: string) => RememberedGradient | undefined = () => undefined,
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    if (f === null) return s;
    if (kind === "flat") return isGradient(f) ? withFill(s, which, f.start) : s;
    if (isGradient(f)) {
      return f.kind === kind
        ? s
        : withFill(s, which, convertOrRestore(f, kind, ownBox(s), remembered(s.id)));
    }
    const box = ownBox(s);
    const r = remembered(s.id);
    if (r) {
      const g = restored(r, box, f);
      return withFill(s, which, isGradient(g) ? convertKind(g, kind) : g);
    }
    if (kind === "linear") {
      if (!box || (box.w <= 0 && box.h <= 0)) return s;
      // A zero-width shape (a vertical line) has no horizontal mid-line to fade across, but it
      // does have a vertical one — lay the default line along it instead of silently doing
      // nothing (review finding 3).
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
    }
    // Radial default: a circle centred on the box, radius half its larger side (spec M16 §5); a
    // box with no extent at all is left unchanged, as the linear default is above.
    if (!box) return s;
    const radius = Math.max(box.w, box.h) / 2;
    if (radius <= 0) return s;
    const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const g: RadialGradient = {
      kind: "radial",
      center,
      a: { x: center.x + radius, y: center.y },
      b: { x: center.x, y: center.y + radius },
      start: f,
      end: { ...f, opacity: 0 },
    };
    return withFill(s, which, g);
  });
}

/** Converts every gradient (of either kind) under `ids` to `kind`; flat paints are untouched
 *  (spec M16 §5, the Gradient section's Type row). `remembered` restores a gradient of `kind` the
 *  session set aside when the selection last left it, so a Radial→Linear→Radial round trip through
 *  the Type row gets its ellipse back rather than a fresh circle (fix M16). */
export function convertGradients(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  kind: GradientKind,
  remembered: (id: string) => RememberedGradient | undefined = () => undefined,
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    return isGradient(f) && f.kind !== kind
      ? withFill(s, which, convertOrRestore(f, kind, ownBox(s), remembered(s.id)))
      : s;
  });
}

/** Replaces a gradient's geometry in the shape's own space, keeping its CURRENT stops and midpoint
 *  — `next`'s own stops are ignored. Only applies when the current paint is already a gradient of
 *  `next`'s kind; a rim collapsed onto the centre (or a linear collapsed to a point) stores the end
 *  stop flat, as everywhere else (spec M16 §6, the tool's drags). */
export function setGradientGeometry(doc: Doc, id: string, which: PaintSlot, next: Gradient): Doc {
  return mapNodes(doc, [id], (n) => {
    if (n.kind === "group") return n;
    const f = n.style[which];
    if (!isGradient(f) || f.kind !== next.kind) return n;
    return withFill(n, which, flatIfDegenerate(carry({ ...next, start: f.start, end: f.end }, f)));
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
    if (!isGradient(f)) return s;
    // Spec M18 §2: the middle stop's colour lives in `midPaint`.
    return withFill(s, which, stop === "mid" ? withMidPaint(f, paint) : { ...f, [stop]: paint });
  });
}

/** Spec M17 §2: sets every selected gradient's midpoint on `which`; 0.5 deletes the key. Flat
 *  paints are untouched, and an unchanged gradient keeps its reference (`withFill`/`sameFill`). */
export function setGradientMid(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  mid: number,
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    return isGradient(f) ? withFill(s, which, withMid(f, mid)) : s;
  });
}

/** Spec M18 §2: Auto on drops every selected gradient's custom middle colour; Auto off gives the
 *  ones without one their current mix, so turning it off changes nothing visible. */
export function setGradientMidAuto(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  auto: boolean,
): Doc {
  return mapShapesWorld(doc, ids, (s) => {
    const f = s.style[which];
    if (!isGradient(f)) return s;
    if (auto) return withFill(s, which, withMidPaint(f, undefined));
    return f.midPaint ? s : withFill(s, which, withMidPaint(f, midStop(f.start, f.end)));
  });
}

/** One document-space line (or, for a radial, circle) mapped into every shape under `ids`, so a
 *  drag across several shapes reads as one continuous gradient (spec M15 §7, M16 §6). An existing
 *  gradient of EITHER kind keeps its stops and midpoint; a flat or null paint gets the fade stops
 *  as today. */
export function drawGradientLine(
  doc: Doc,
  ids: readonly string[],
  which: PaintSlot,
  from: Vec,
  to: Vec,
  kind: GradientKind = "linear",
): Doc {
  return mapShapesWorld(doc, ids, (s, world) => {
    const inv = invert(world);
    if (!inv) return s;
    const f = s.style[which];
    const start = isGradient(f) ? f.start : (f ?? (DEFAULT_STYLE[which] as Paint));
    const end = isGradient(f) ? f.end : { ...start, opacity: 0 };
    const props: StopProps = isGradient(f) ? f : {};
    let next: Gradient;
    if (kind === "linear") {
      next = { kind: "linear", from: applyMat(inv, from), to: applyMat(inv, to), start, end };
    } else {
      const rim = perp({ x: to.x - from.x, y: to.y - from.y });
      const bDoc = { x: from.x + rim.x, y: from.y + rim.y };
      next = {
        kind: "radial",
        center: applyMat(inv, from),
        a: applyMat(inv, to),
        b: applyMat(inv, bDoc),
        start,
        end,
      };
    }
    return withFill(s, which, flatIfDegenerate(carry(next, props)));
  });
}
