import {
  DOC_VERSION,
  idFor,
  isValidArtboardSize,
  type Doc,
  type Layer,
  type LineCap,
  type LineJoin,
  type Node,
  type Paint,
  type Style,
  type Subpath,
} from "../doc/document";
import { isIdentity, multiply, translate, type Mat } from "../geom/mat";
import { rectPath } from "../geom/shapes";
import { parseColor } from "./colors";
import { applyNodeTypes, parsePathData } from "./pathdata";
import { parseTransform } from "./transform";
import { parseXml, type XmlElement } from "./xml";

export class SvgError extends Error {}

export type ParseResult = { doc: Doc; dropped: string[] };

/** Inherited paint state while walking the tree. */
type Inherited = {
  fill: Paint | null;
  fillOpacity: number;
  stroke: Paint | null;
  strokeOpacity: number;
  strokeWidth: number;
  cap: LineCap;
  join: LineJoin;
};

const ROOT_INHERITED: Inherited = {
  fill: { color: "#000000", opacity: 1 },
  fillOpacity: 1,
  stroke: null,
  strokeOpacity: 1,
  strokeWidth: 1,
  cap: "butt",
  join: "miter",
};

const PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "display",
  "clip-path",
  "mask",
  "filter",
] as const;

const SILENT = new Set(["defs", "title", "desc", "metadata", "script"]);
const CAPS: readonly string[] = ["butt", "round", "square"];
const JOINS: readonly string[] = ["miter", "round", "bevel"];

function num(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function opacityValue(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, v.trim().endsWith("%") ? n / 100 : n));
}

function numbers(v: string | undefined): number[] {
  const out: number[] = [];
  for (const m of v?.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []) {
    const n = Number(m);
    // SVG stops parsing a number list at the first error; a non-finite value counts as one so
    // later values don't shift into the wrong slot of an x/y pair.
    if (!Number.isFinite(n)) break;
    out.push(n);
  }
  return out;
}

export function parseSvg(src: string): ParseResult {
  const root = parseXml(src);
  if (root.name !== "svg" && root.name !== "svg:svg") throw new SvgError("Not an SVG file");

  const dropped: string[] = [];
  const drop = (label: string) => {
    if (!dropped.includes(label)) dropped.push(label);
  };
  let next = 1;
  const newId = () => idFor(next++);

  /** Presentation attributes, overridden by inline style declarations. */
  function props(el: XmlElement): Partial<Record<(typeof PROPS)[number], string>> {
    const out: Partial<Record<(typeof PROPS)[number], string>> = {};
    for (const p of PROPS) if (el.attrs[p] !== undefined) out[p] = el.attrs[p];
    for (const decl of (el.attrs.style ?? "").split(";")) {
      const colon = decl.indexOf(":");
      if (colon < 0) continue;
      const key = decl.slice(0, colon).trim() as (typeof PROPS)[number];
      if ((PROPS as readonly string[]).includes(key)) out[key] = decl.slice(colon + 1).trim();
    }
    if (el.attrs.class !== undefined) drop("CSS classes");
    if (out.filter && out.filter !== "none") drop("filters");
    if ((out["clip-path"] && out["clip-path"] !== "none") || (out.mask && out.mask !== "none")) {
      drop("clipping/masks");
    }
    return out;
  }

  function paint(value: string | undefined, current: Paint | null): Paint | null {
    if (value === undefined) return current;
    const c = parseColor(value);
    if (c === null) return current;
    if (c.kind === "none") return null;
    if (c.kind === "unsupported") {
      drop("gradients/patterns");
      return null;
    }
    return { color: c.color, opacity: c.alpha };
  }

  function inherit(parent: Inherited, p: ReturnType<typeof props>): Inherited {
    const cap = p["stroke-linecap"];
    const join = p["stroke-linejoin"];
    return {
      fill: paint(p.fill, parent.fill),
      fillOpacity: opacityValue(p["fill-opacity"], parent.fillOpacity),
      stroke: paint(p.stroke, parent.stroke),
      strokeOpacity: opacityValue(p["stroke-opacity"], parent.strokeOpacity),
      strokeWidth: Math.max(0, num(p["stroke-width"], parent.strokeWidth)),
      cap: cap && CAPS.includes(cap) ? (cap as LineCap) : parent.cap,
      join: join && JOINS.includes(join) ? (join as LineJoin) : parent.join,
    };
  }

  function style(inh: Inherited, opacity: number): Style {
    const withOpacity = (p: Paint | null, o: number): Paint | null =>
      p ? { color: p.color, opacity: p.opacity * o } : null;
    return {
      fill: withOpacity(inh.fill, inh.fillOpacity),
      stroke: withOpacity(inh.stroke, inh.strokeOpacity),
      strokeWidth: inh.strokeWidth,
      cap: inh.cap,
      join: inh.join,
      opacity,
    };
  }

  function children(el: XmlElement, inh: Inherited): Node[] {
    const out: Node[] = [];
    for (const child of el.children) {
      const n = convert(child, inh);
      if (n) out.push(n);
    }
    return out;
  }

  function pathNode(
    subpaths: Subpath[],
    id: string,
    name: string | undefined,
    transform: Mat,
    st: Style,
  ): Node | null {
    const nonEmpty = subpaths.filter((sp) => sp.nodes.length > 0);
    if (nonEmpty.length === 0) return null;
    return { kind: "path", id, name, transform, style: st, subpaths: nonEmpty };
  }

  function convert(el: XmlElement, inh: Inherited): Node | null {
    const name = el.name.startsWith("svg:") ? el.name.slice(4) : el.name;
    if (name.includes(":") || SILENT.has(name)) return null;
    if (name === "style") {
      drop("CSS stylesheets");
      return null;
    }
    const p = props(el);
    if (p.display === "none") return null;
    const i2 = inherit(inh, p);
    const opacity = opacityValue(p.opacity, 1);
    let transform = parseTransform(el.attrs.transform ?? "");
    const label = el.attrs["data-sv-name"] ?? el.attrs["inkscape:label"];
    const a = el.attrs;

    switch (name) {
      case "g":
      case "a":
      case "svg": {
        if (name === "svg") {
          transform = multiply(transform, translate(num(a.x, 0), num(a.y, 0)));
          if (a.viewBox !== undefined) drop("nested viewBox scaling");
        }
        // Allocate the group id before its children so ids follow document order.
        const id = newId();
        const kids = children(el, i2);
        if (kids.length === 0) return null;
        return { kind: "group", id, name: label, transform, opacity, children: kids };
      }
      case "rect": {
        const w = num(a.width, 0);
        const h = num(a.height, 0);
        if (w <= 0 || h <= 0) return null;
        let rx = a.rx !== undefined ? num(a.rx, 0) : a.ry !== undefined ? num(a.ry, 0) : 0;
        let ry = a.ry !== undefined ? num(a.ry, 0) : rx;
        rx = Math.min(Math.max(0, rx), w / 2);
        ry = Math.min(Math.max(0, ry), h / 2);
        const x = num(a.x, 0);
        const y = num(a.y, 0);
        const st = style(i2, opacity);
        if (rx === ry) {
          return { kind: "rect", id: newId(), name: label, transform, style: st, x, y, w, h, rx };
        }
        return pathNode([rectPath(x, y, w, h, rx, ry)], newId(), label, transform, st);
      }
      case "circle":
      case "ellipse": {
        const rx = name === "circle" ? num(a.r, 0) : num(a.rx, 0);
        const ry = name === "circle" ? rx : num(a.ry, 0);
        if (rx <= 0 || ry <= 0) return null;
        return {
          kind: "ellipse",
          id: newId(),
          name: label,
          transform,
          style: style(i2, opacity),
          cx: num(a.cx, 0),
          cy: num(a.cy, 0),
          rx,
          ry,
        };
      }
      case "line": {
        const corner = (x: number, y: number) => ({
          p: { x, y },
          in: null,
          out: null,
          type: "corner" as const,
        });
        const sp: Subpath = {
          closed: false,
          nodes: [corner(num(a.x1, 0), num(a.y1, 0)), corner(num(a.x2, 0), num(a.y2, 0))],
        };
        return pathNode([sp], newId(), label, transform, style(i2, opacity));
      }
      case "polyline":
      case "polygon": {
        const n = numbers(a.points);
        const nodes = [];
        for (let i = 0; i + 1 < n.length; i += 2) {
          nodes.push({ p: { x: n[i], y: n[i + 1] }, in: null, out: null, type: "corner" as const });
        }
        const sp: Subpath = { closed: name === "polygon", nodes };
        return pathNode([sp], newId(), label, transform, style(i2, opacity));
      }
      case "path": {
        let subpaths = parsePathData(a.d ?? "");
        if (a["data-sv-nodes"] !== undefined)
          subpaths = applyNodeTypes(subpaths, a["data-sv-nodes"]);
        return pathNode(subpaths, newId(), label, transform, style(i2, opacity));
      }
      default:
        drop(`<${name}>`);
        return null;
    }
  }

  // ----- artboard -----
  const vbAttr = root.attrs.viewBox;
  const vb = numbers(vbAttr);
  const vbOk =
    vb.length === 4 &&
    Number.isFinite(vb[0]) &&
    Number.isFinite(vb[1]) &&
    isValidArtboardSize(vb[2]) &&
    isValidArtboardSize(vb[3]);
  if (vbAttr !== undefined && !vbOk) drop("invalid artboard size");

  let minX = 0;
  let minY = 0;
  let w: number;
  let h: number;
  if (vbOk) {
    [minX, minY, w, h] = vb;
  } else {
    const wAttr = root.attrs.width;
    const hAttr = root.attrs.height;
    const wNum = num(wAttr, NaN);
    const hNum = num(hAttr, NaN);
    const whOk = isValidArtboardSize(wNum) && isValidArtboardSize(hNum);
    if (!whOk && (wAttr !== undefined || hAttr !== undefined)) drop("invalid artboard size");
    w = whOk ? wNum : 300;
    h = whOk ? hNum : 150;
  }
  const rootMat = translate(-minX, -minY);
  const place = (n: Node): Node =>
    isIdentity(rootMat) ? n : { ...n, transform: multiply(rootMat, n.transform) };

  const rootInh = inherit(ROOT_INHERITED, props(root));
  const layers: Layer[] = [];
  let background: Paint | null = null;

  const isRendering = (el: XmlElement) =>
    !el.name.includes(":") && !SILENT.has(el.name) && el.name !== "style";
  const ownFormat = root.children.some(
    (c) => c.name === "g" && c.attrs["data-sv-layer"] !== undefined,
  );
  const topLevel = root.children.filter(isRendering);
  const allGroups = topLevel.length > 0 && topLevel.every((c) => c.name === "g");

  const makeLayer = (el: XmlElement, index: number): Layer => {
    const p = props(el);
    const id = newId();
    const inh = inherit(rootInh, p);
    let kids = children(el, inh);
    const t = parseTransform(el.attrs.transform ?? "");
    const opacity = opacityValue(p.opacity, 1);
    if (!ownFormat && kids.length > 0 && (!isIdentity(t) || opacity !== 1)) {
      kids = [{ kind: "group", id: newId(), transform: t, opacity, children: kids }];
    }
    return {
      id,
      name:
        el.attrs["data-sv-name"] ??
        el.attrs["inkscape:label"] ??
        el.attrs.id ??
        `Layer ${index + 1}`,
      visible: p.display !== "none",
      locked:
        el.attrs["data-sv-locked"] !== undefined || el.attrs["sodipodi:insensitive"] === "true",
      children: kids.map(place),
    };
  };

  if (ownFormat || allGroups) {
    for (const el of root.children) {
      // Styles/classes on skipped top-level elements are still reported via props() in convert().
      if (ownFormat && el.name === "rect" && el.attrs["data-sv-background"] !== undefined) {
        const fill = paint(el.attrs.fill, null);
        background = fill && {
          color: fill.color,
          opacity: fill.opacity * opacityValue(el.attrs["fill-opacity"], 1),
        };
        continue;
      }
      if (el.name === "g" && (!ownFormat || el.attrs["data-sv-layer"] !== undefined)) {
        layers.push(makeLayer(el, layers.length));
        continue;
      }
      if (el.name === "style") drop("CSS stylesheets");
      const n = isRendering(el) ? convert(el, rootInh) : null;
      if (n) {
        if (layers.length === 0) {
          layers.push({ id: newId(), name: "Layer 1", visible: true, locked: false, children: [] });
        }
        const last = layers[layers.length - 1];
        last.children = [...last.children, place(n)];
      }
    }
  } else {
    const id = newId();
    layers.push({
      id,
      name: "Layer 1",
      visible: true,
      locked: false,
      children: children(root, rootInh).map(place),
    });
  }

  if (layers.length === 0) {
    layers.push({ id: newId(), name: "Layer 1", visible: true, locked: false, children: [] });
  }

  return {
    doc: { version: DOC_VERSION, artboard: { w, h, background }, layers, nextId: next },
    dropped,
  };
}
