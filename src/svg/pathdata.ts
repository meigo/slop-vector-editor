import type { NodeType, PathNode, Subpath } from "../doc/document";
import type { Vec } from "../geom/vec";
import { arcToCubics } from "./arc";
import { fmt } from "./fmt";

// ---------- writing ----------

const pt = (p: Vec) => `${fmt(p.x)} ${fmt(p.y)}`;

function segment(a: PathNode, b: PathNode): string {
  if (!a.out && !b.in) return `L${pt(b.p)}`;
  return `C${pt(a.out ?? a.p)} ${pt(b.in ?? b.p)} ${pt(b.p)}`;
}

export function subpathsToD(subpaths: Subpath[]): string {
  const parts: string[] = [];
  for (const sp of subpaths) {
    const n = sp.nodes;
    if (n.length === 0) continue;
    parts.push(`M${pt(n[0].p)}`);
    for (let i = 1; i < n.length; i++) parts.push(segment(n[i - 1], n[i]));
    if (sp.closed) {
      const last = n[n.length - 1];
      // A straight closing segment is implied by Z; a curved one must be written out.
      if (n.length > 1 && (last.out || n[0].in)) parts.push(segment(last, n[0]));
      parts.push("Z");
    }
  }
  return parts.join(" ");
}

// ---------- reading ----------

const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const CMD_RE = /[MmLlHhVvCcSsQqTtAaZz]/;

/** Mirrors parse.ts's MAX_COORD; kept as a local copy because parse.ts imports parsePathData,
 *  so importing from parse.ts here would be a circular import. */
const MAX_COORD = 1e9;

class PathDataError extends Error {}

function scanner(s: string) {
  let i = 0;
  const skip = () => {
    while (i < s.length && (s[i] === "," || /\s/.test(s[i]))) i++;
  };
  return {
    done(): boolean {
      skip();
      return i >= s.length;
    },
    command(): string | null {
      skip();
      const c = s[i];
      if (c !== undefined && CMD_RE.test(c)) {
        i++;
        return c;
      }
      return null;
    },
    hasNumber(): boolean {
      skip();
      return i < s.length && /[-+.\d]/.test(s[i]);
    },
    number(): number {
      skip();
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(s);
      if (!m) throw new PathDataError(`Expected a number at ${i}`);
      i = NUM_RE.lastIndex;
      const n = parseFloat(m[0]);
      if (!Number.isFinite(n) || Math.abs(n) > MAX_COORD) {
        throw new PathDataError(`Non-finite number at ${i}`);
      }
      return n;
    },
    flag(): boolean {
      skip();
      const c = s[i];
      if (c !== "0" && c !== "1") throw new PathDataError(`Expected an arc flag at ${i}`);
      i++;
      return c === "1";
    },
  };
}

const near = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const reflect = (c: Vec, about: Vec): Vec => ({ x: 2 * about.x - c.x, y: 2 * about.y - c.y });
const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function parsePathData(d: string): Subpath[] {
  const sc = scanner(d);
  const out: Subpath[] = [];
  let sub: Subpath | null = null;
  let cur: Vec = { x: 0, y: 0 };
  let start: Vec = { x: 0, y: 0 };
  let prevCubic: Vec | null = null; // second control of the previous C/S
  let prevQuad: Vec | null = null; // control of the previous Q/T
  let cmd = "";

  const moveTo = (p: Vec) => {
    sub = { nodes: [{ p, in: null, out: null, type: "corner" }], closed: false };
    out.push(sub);
    cur = start = p;
  };
  const active = (): Subpath => {
    if (!sub) moveTo(cur);
    return sub!;
  };
  const lineTo = (p: Vec) => {
    active().nodes.push({ p, in: null, out: null, type: "corner" });
    cur = p;
  };
  const cubicTo = (c1: Vec, c2: Vec, p: Vec) => {
    const s = active();
    s.nodes[s.nodes.length - 1].out = c1;
    s.nodes.push({ p, in: c2, out: null, type: "corner" });
    cur = p;
  };
  const close = () => {
    if (!sub) return;
    const n = sub.nodes;
    if (n.length > 1 && near(n[0].p, n[n.length - 1].p)) {
      n[0].in = n[n.length - 1].in;
      n.pop();
    }
    sub.closed = true;
    sub = null;
    cur = start;
  };

  try {
    while (!sc.done()) {
      const c = sc.command();
      if (c) cmd = c;
      else if (!cmd || cmd === "Z" || cmd === "z" || !sc.hasNumber()) break;

      const rel = cmd !== cmd.toUpperCase();
      const upper = cmd.toUpperCase();
      const point = (): Vec => {
        const x = sc.number();
        const y = sc.number();
        return rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      };
      let nextCubic: Vec | null = null;
      let nextQuad: Vec | null = null;

      switch (upper) {
        case "M":
          moveTo(point());
          cmd = rel ? "l" : "L";
          break;
        case "L":
          lineTo(point());
          break;
        case "H": {
          const x = sc.number();
          lineTo({ x: rel ? cur.x + x : x, y: cur.y });
          break;
        }
        case "V": {
          const y = sc.number();
          lineTo({ x: cur.x, y: rel ? cur.y + y : y });
          break;
        }
        case "C": {
          const c1 = point();
          const c2 = point();
          const p = point();
          cubicTo(c1, c2, p);
          nextCubic = c2;
          break;
        }
        case "S": {
          const c1 = prevCubic ? reflect(prevCubic, cur) : cur;
          const c2 = point();
          const p = point();
          cubicTo(c1, c2, p);
          nextCubic = c2;
          break;
        }
        case "Q":
        case "T": {
          const q: Vec = upper === "Q" ? point() : prevQuad ? reflect(prevQuad, cur) : cur;
          const p = point();
          cubicTo(lerp(cur, q, 2 / 3), lerp(p, q, 2 / 3), p);
          nextQuad = q;
          break;
        }
        case "A": {
          const rx = sc.number();
          const ry = sc.number();
          const rot = sc.number();
          const large = sc.flag();
          const sweep = sc.flag();
          const p = point();
          for (const [c1, c2, e] of arcToCubics(cur, rx, ry, rot, large, sweep, p))
            cubicTo(c1, c2, e);
          break;
        }
        case "Z":
          close();
          break;
      }
      prevCubic = nextCubic;
      prevQuad = nextQuad;
    }
  } catch (err) {
    // SVG renders a path up to its first error; do the same.
    if (!(err instanceof PathDataError)) throw err;
  }

  for (const sp of out) {
    for (const n of sp.nodes) {
      if (n.in && near(n.in, n.p)) n.in = null;
      if (n.out && near(n.out, n.p)) n.out = null;
    }
  }
  return inferNodeTypes(out);
}

// ---------- node types ----------

function isSmooth(n: PathNode): boolean {
  if (!n.in || !n.out) return false;
  const ax = n.p.x - n.in.x;
  const ay = n.p.y - n.in.y;
  const bx = n.out.x - n.p.x;
  const by = n.out.y - n.p.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return false;
  return Math.abs(ax * by - ay * bx) / (la * lb) < 1e-3 && ax * bx + ay * by > 0;
}

export function inferNodeTypes(subpaths: Subpath[]): Subpath[] {
  return subpaths.map((sp) => ({
    ...sp,
    nodes: sp.nodes.map((n) => ({ ...n, type: isSmooth(n) ? "smooth" : "corner" })),
  }));
}

const CODE: Record<NodeType, string> = { corner: "c", smooth: "s", symmetric: "y" };
const TYPE: Record<string, NodeType> = { c: "corner", s: "smooth", y: "symmetric" };

export function nodeTypesAttr(subpaths: Subpath[]): string {
  return subpaths.map((sp) => sp.nodes.map((n) => CODE[n.type]).join("")).join(" ");
}

export function applyNodeTypes(subpaths: Subpath[], attr: string): Subpath[] {
  const codes = attr.split(" ");
  return subpaths.map((sp, i) => {
    const c = codes[i];
    if (c === undefined || c.length !== sp.nodes.length || [...c].some((ch) => !TYPE[ch])) {
      return sp;
    }
    return { ...sp, nodes: sp.nodes.map((n, j) => ({ ...n, type: TYPE[c[j]] })) };
  });
}
