import {
  flatIfDegenerate,
  isGradient,
  midStop,
  withMid,
  type Fill,
  type Paint,
} from "../doc/document";
import type { Box } from "../geom/box";
import { applyMat, IDENTITY, invert, multiply, type Mat } from "../geom/mat";
import { parseColor } from "./colors";
import { parseTransformOrNull } from "./transform";
import type { XmlElement } from "./xml";

/** Spec M15 §4 (linear) and M16 §4 (radial): foreign paint servers, resolved into our two- or
 *  three-point model exactly or not at all. */

/** Mirrors parse.ts's MAX_COORD; kept as a local copy because parse.ts imports foldLinear and
 *  resolveServer, so importing from parse.ts here would be a circular import (invariant 8). */
const MAX_COORD = 1e9;

export type Len = { v: number; pct: boolean };
export type RawStop = { offset: number; color: string; opacity: number };
export type RawLinear = {
  units: "user" | "bbox";
  x1: Len;
  y1: Len;
  x2: Len;
  y2: Len;
  /** null when the list could not be read in full: the gradient is dropped, never guessed. */
  transform: Mat | null;
  spread: string;
  stops: RawStop[];
};
export type RawRadial = {
  units: "user" | "bbox";
  cx: Len;
  cy: Len;
  r: Len;
  /** null = absent (defaults: cx, cy, 0), as opposed to present and equal to it. */
  fx: Len | null;
  fy: Len | null;
  fr: Len | null;
  /** null when the list could not be read in full: the gradient is dropped, never guessed. */
  transform: Mat | null;
  spread: string;
  stops: RawStop[];
};
export type Resolved =
  | { kind: "linear"; g: RawLinear }
  | { kind: "radial"; g: RawRadial }
  | { kind: "drop"; label: string }
  | { kind: "missing" };
export type Folded = { kind: "fill"; fill: Fill | null } | { kind: "drop"; label: string };

const MAX_CHAIN = 16;
const local = (name: string) => (name.startsWith("svg:") ? name.slice(4) : name);
const SERVERS = new Set(["linearGradient", "radialGradient", "pattern"]);

/** Every paint server with an id, wherever it sits — they may be referenced before they appear.
 *  The first of a duplicated id wins, as in a browser. */
export function collectServers(root: XmlElement): Map<string, XmlElement> {
  const out = new Map<string, XmlElement>();
  const walk = (el: XmlElement) => {
    const id = el.attrs.id;
    if (id !== undefined && SERVERS.has(local(el.name)) && !out.has(id)) out.set(id, el);
    el.children.forEach(walk);
  };
  walk(root);
  return out;
}

function hrefOf(el: XmlElement): string | null {
  const h = el.attrs.href ?? el.attrs["xlink:href"];
  return h !== undefined && h.startsWith("#") ? h.slice(1) : null;
}

/** The element and the gradients it inherits from, nearest first. A cycle or an over-long chain
 *  ends the walk here; `chainBroken` tells the two apart from an ordinary end of chain. */
function chain(servers: Map<string, XmlElement>, first: XmlElement): XmlElement[] {
  const out = [first];
  let el = first;
  while (out.length < MAX_CHAIN) {
    const id = hrefOf(el);
    const next = id === null ? undefined : servers.get(id);
    if (!next || out.includes(next) || local(next.name) === "pattern") break;
    out.push(next);
    el = next;
  }
  return out;
}

/** Spec M15 §4 / review finding 5: a cycle or a chain cut at `MAX_CHAIN` is dropped, not silently
 *  followed as far as it goes. True when the chain's last link still points at a further, distinct,
 *  non-pattern gradient — the two reasons `chain`'s walk can stop short of the end of the links. */
function chainBroken(servers: Map<string, XmlElement>, all: readonly XmlElement[]): boolean {
  const id = hrefOf(all[all.length - 1]);
  const next = id === null ? undefined : servers.get(id);
  if (!next || local(next.name) === "pattern") return false;
  return all.includes(next) || all.length >= MAX_CHAIN;
}

function len(v: string | undefined, fallback: Len): Len {
  if (v === undefined) return fallback;
  const t = v.trim();
  const pct = t.endsWith("%");
  const n = Number(pct ? t.slice(0, -1) : t);
  return Number.isFinite(n) && Math.abs(n) <= MAX_COORD ? { v: n, pct } : fallback;
}

/** Like `len`, but an unparseable value counts as absent rather than falling back to a default
 *  literal — used for fx/fy/fr (review finding 5), which are meaningful only by their PRESENCE
 *  (null defaults to cx/cy/0 in `foldRadial`); a browser ignores a bad focal attribute instead of
 *  treating it as a literal focal point, and `len`'s fallback would otherwise manufacture one. */
function lenOrAbsent(v: string | undefined): Len | null {
  if (v === undefined) return null;
  const t = v.trim();
  const pct = t.endsWith("%");
  const n = Number(pct ? t.slice(0, -1) : t);
  return Number.isFinite(n) && Math.abs(n) <= MAX_COORD ? { v: n, pct } : null;
}

/** A stop's own attribute, overridden by its `style` declaration (Inkscape writes the latter). */
function stopProp(el: XmlElement, key: "stop-color" | "stop-opacity"): string | undefined {
  let v = el.attrs[key];
  for (const decl of (el.attrs.style ?? "").split(";")) {
    const colon = decl.indexOf(":");
    if (colon >= 0 && decl.slice(0, colon).trim().toLowerCase() === key) {
      v = decl.slice(colon + 1).trim();
    }
  }
  return v;
}

function readStops(el: XmlElement): RawStop[] {
  let last = 0;
  return el.children
    .filter((c) => local(c.name) === "stop")
    .map((c) => {
      const o = len(c.attrs.offset, { v: 0, pct: false });
      const raw = o.pct ? o.v / 100 : o.v;
      // SVG: clamp into [0, 1], and never before the previous stop.
      const offset = Math.max(last, Math.min(1, Math.max(0, raw)));
      last = offset;
      const col = parseColor(stopProp(c, "stop-color") ?? "#000000");
      const color = col && col.kind === "color" ? col.color : "#000000";
      const alpha = col && col.kind === "color" ? col.alpha : 1;
      const so = Number(stopProp(c, "stop-opacity") ?? "1");
      const opacity = (Number.isFinite(so) ? Math.min(1, Math.max(0, so)) : 1) * alpha;
      return { offset, color, opacity };
    });
}

export function resolveServer(servers: Map<string, XmlElement>, id: string): Resolved {
  const el = servers.get(id);
  if (!el) return { kind: "missing" };
  const name = local(el.name);
  if (name === "pattern") return { kind: "drop", label: "patterns" };
  const all = chain(servers, el);
  if (chainBroken(servers, all)) return { kind: "drop", label: "broken gradient references" };
  const attr = (k: string) => all.find((e) => e.attrs[k] !== undefined)?.attrs[k];
  const withStops = all.find((e) => e.children.some((c) => local(c.name) === "stop"));
  const tr = attr("gradientTransform");
  const units = attr("gradientUnits") === "userSpaceOnUse" ? "user" : "bbox";
  const transform = tr === undefined ? IDENTITY : parseTransformOrNull(tr);
  const spread = (attr("spreadMethod") ?? "pad").trim();
  const stops = withStops ? readStops(withStops) : [];
  if (name === "radialGradient") {
    return {
      kind: "radial",
      g: {
        units,
        cx: len(attr("cx"), { v: 50, pct: true }),
        cy: len(attr("cy"), { v: 50, pct: true }),
        r: len(attr("r"), { v: 50, pct: true }),
        fx: lenOrAbsent(attr("fx")),
        fy: lenOrAbsent(attr("fy")),
        fr: lenOrAbsent(attr("fr")),
        transform,
        spread,
        stops,
      },
    };
  }
  return {
    kind: "linear",
    g: {
      units,
      x1: len(attr("x1"), { v: 0, pct: true }),
      y1: len(attr("y1"), { v: 0, pct: true }),
      x2: len(attr("x2"), { v: 100, pct: true }),
      y2: len(attr("y2"), { v: 0, pct: true }),
      transform,
      spread,
      stops,
    },
  };
}

/** Invariant 8, shared by both folds: a coordinate is rejected the same way whether it comes from
 *  the file directly or from folding it through a transform — an absurd length, or a transform
 *  that blows the points up, must not silently reach the document as NaN or a coordinate `fmt`
 *  would overflow. */
function coordsOk(fill: Fill): boolean {
  if (!isGradient(fill)) return true;
  const pts = fill.kind === "linear" ? [fill.from, fill.to] : [fill.center, fill.a, fill.b];
  return pts.every(
    (p) =>
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      Math.abs(p.x) <= MAX_COORD &&
      Math.abs(p.y) <= MAX_COORD,
  );
}

type Outer = { o0: number; o1: number; start: Paint; end: Paint; mid: number | undefined };

const hexChannel = (c: string, i: number) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);

/** Spec M17 §4: within rounding of the mix our own writer (and other editors) put there. */
function isMidStop(p: Paint, want: Paint): boolean {
  return (
    Math.abs(p.opacity - want.opacity) <= 0.005 &&
    [0, 1, 2].every((i) => Math.abs(hexChannel(p.color, i) - hexChannel(want.color, i)) <= 1)
  );
}

/** The two stops the model keeps, with their offsets — plus a midpoint when a third, middle stop
 *  is exactly their mix (spec M17 §4). Anything else is more than the model can hold. */
function outerStops(raw: readonly RawStop[], stops: readonly Paint[]): Outer | { drop: string } {
  const more = { drop: "gradients with more than two stops" };
  if (raw.length === 2) {
    if (raw[1].offset <= raw[0].offset) return more;
    return { o0: raw[0].offset, o1: raw[1].offset, start: stops[0], end: stops[1], mid: undefined };
  }
  if (raw.length !== 3) return more;
  const [o0, om, o1] = raw.map((s) => s.offset);
  if (!(o0 < om && om < o1)) return more;
  if (!isMidStop(stops[1], midStop(stops[0], stops[2]))) return more;
  const t = (om - o0) / (o1 - o0);
  return { o0, o1, start: stops[0], end: stops[2], mid: Math.abs(t - 0.5) < 1e-6 ? undefined : t };
}

/** Spec M15 §4's fold: the source's parameter `s(q)` is affine in own-space `q`, so the stops'
 *  offsets are reached at two points along its gradient `g = A⁻ᵀd/(d·d)` — exact for any
 *  invertible `A`, skew included (which is why `g` is never `A·d`).
 *  Spec M17 §4: a third, middle stop equal to the outer two's mix is read as a midpoint. */
export function foldLinear(
  g: RawLinear,
  box: Box | null,
  viewport: { w: number; h: number },
  opacity: number,
): Folded {
  const stops = g.stops.map((s) => ({ color: s.color, opacity: s.opacity * opacity }));
  if (g.stops.length === 0) return { kind: "fill", fill: null };
  if (g.stops.length === 1) return { kind: "fill", fill: stops[0] };
  const outer = outerStops(g.stops, stops);
  if ("drop" in outer) return { kind: "drop", label: outer.drop };
  if (g.spread !== "pad") return { kind: "drop", label: "repeating gradients" };
  if (!g.transform) return { kind: "drop", label: "gradients with an invalid transform" };

  let unit: Mat = [1, 0, 0, 1, 0, 0];
  let num: (l: Len, axis: "x" | "y") => number;
  if (g.units === "bbox") {
    if (!box || box.w <= 0 || box.h <= 0)
      return { kind: "drop", label: "gradients on zero-size shapes" };
    unit = [box.w, 0, 0, box.h, box.x, box.y];
    num = (l) => (l.pct ? l.v / 100 : l.v);
  } else {
    num = (l, axis) => (l.pct ? (l.v / 100) * (axis === "x" ? viewport.w : viewport.h) : l.v);
  }
  const A = multiply(unit, g.transform);
  const inv = invert(A);
  if (!inv) return { kind: "drop", label: "gradients with an invalid transform" };

  const p1 = { x: num(g.x1, "x"), y: num(g.y1, "y") };
  const p2 = { x: num(g.x2, "x"), y: num(g.y2, "y") };
  const d = { x: p2.x - p1.x, y: p2.y - p1.y };
  const dd = d.x * d.x + d.y * d.y;
  // SVG: coincident points paint the last stop's colour.
  if (dd === 0) return { kind: "fill", fill: outer.end };
  const [ai, bi, ci, di] = inv;
  const gx = (ai * d.x + bi * d.y) / dd;
  const gy = (ci * d.x + di * d.y) / dd;
  const gg = gx * gx + gy * gy;
  const q0 = applyMat(A, p1);
  const at = (o: number) => ({ x: q0.x + (gx * o) / gg, y: q0.y + (gy * o) / gg });
  const fill = flatIfDegenerate(
    withMid(
      {
        kind: "linear",
        from: at(outer.o0),
        to: at(outer.o1),
        start: outer.start,
        end: outer.end,
      },
      outer.mid,
    ),
  );
  if (!coordsOk(fill)) return { kind: "drop", label: "invalid gradient coordinates" };
  return { kind: "fill", fill };
}

/** Spec M16 §4: a radial with no focal offset is the unit circle under `A · [r, 0, 0, r, cx, cy]`
 *  — exact for any invertible `A`. A first stop above 0 would paint a solid disc the model cannot
 *  draw; a last stop below 1 simply shrinks the rim.
 *  Spec M17 §4: a third, middle stop equal to the outer two's mix is read as a midpoint. */
export function foldRadial(
  g: RawRadial,
  box: Box | null,
  viewport: { w: number; h: number },
  opacity: number,
): Folded {
  const stops = g.stops.map((s) => ({ color: s.color, opacity: s.opacity * opacity }));
  if (g.stops.length === 0) return { kind: "fill", fill: null };
  if (g.stops.length === 1) return { kind: "fill", fill: stops[0] };
  const outer = outerStops(g.stops, stops);
  if ("drop" in outer) return { kind: "drop", label: outer.drop };
  if (outer.o0 > 0) return { kind: "drop", label: "radial gradients with an inner stop" };
  if (g.spread !== "pad") return { kind: "drop", label: "repeating gradients" };
  if (!g.transform) return { kind: "drop", label: "gradients with an invalid transform" };

  let unit: Mat = IDENTITY;
  let x: (l: Len) => number;
  let y: (l: Len) => number;
  let len: (l: Len) => number;
  if (g.units === "bbox") {
    if (!box || box.w <= 0 || box.h <= 0)
      return { kind: "drop", label: "gradients on zero-size shapes" };
    unit = [box.w, 0, 0, box.h, box.x, box.y];
    x = y = len = (l) => (l.pct ? l.v / 100 : l.v);
  } else {
    const diag = Math.sqrt((viewport.w ** 2 + viewport.h ** 2) / 2);
    x = (l) => (l.pct ? (l.v / 100) * viewport.w : l.v);
    y = (l) => (l.pct ? (l.v / 100) * viewport.h : l.v);
    len = (l) => (l.pct ? (l.v / 100) * diag : l.v);
  }
  const cx = x(g.cx);
  const cy = y(g.cy);
  const r = len(g.r);
  const fx = g.fx ? x(g.fx) : cx;
  const fy = g.fy ? y(g.fy) : cy;
  const fr = g.fr ? len(g.fr) : 0;
  if (fx !== cx || fy !== cy || fr !== 0) {
    return { kind: "drop", label: "radial gradients with a focal point" };
  }
  if (r < 0) return { kind: "drop", label: "invalid gradient coordinates" };
  if (r === 0) return { kind: "fill", fill: outer.end };
  const A = multiply(unit, g.transform);
  if (!invert(A)) return { kind: "drop", label: "gradients with an invalid transform" };
  const o1 = outer.o1;
  const fill = flatIfDegenerate(
    withMid(
      {
        kind: "radial",
        center: applyMat(A, { x: cx, y: cy }),
        a: applyMat(A, { x: cx + r * o1, y: cy }),
        b: applyMat(A, { x: cx, y: cy + r * o1 }),
        start: outer.start,
        end: outer.end,
      },
      outer.mid,
    ),
  );
  if (!coordsOk(fill)) return { kind: "drop", label: "invalid gradient coordinates" };
  return { kind: "fill", fill };
}
