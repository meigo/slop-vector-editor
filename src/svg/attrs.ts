import { formatOverrides, formatTextOpts } from "../text/attrs";
import {
  isHidden,
  isLocked,
  type Group,
  type Layer,
  type Node,
  type Shape,
  type Style,
  type TextMeta,
} from "../doc/document";
import { isIdentity, type Mat } from "../geom/mat";
import { polygonSubpath, type PolygonGeometry } from "../geom/shapes";
import { fmt } from "./fmt";
import { nodeTypesAttr, subpathsToD } from "./pathdata";

/** Model → SVG attributes. The canvas renders with these and the exporter writes these, so what
 *  you see is what gets saved. Attribute order here is the order in the file. */

export type Attrs = Record<string, string>;

function transformAttr(m: Mat): Attrs {
  return isIdentity(m) ? {} : { transform: `matrix(${m.map(fmt).join(" ")})` };
}

function nameAttr(name: string | undefined): Attrs {
  return name ? { "data-sv-name": name } : {};
}

export function styleAttrs(s: Style): Attrs {
  const a: Attrs = { fill: s.fill ? s.fill.color : "none" };
  if (s.fill && s.fill.opacity !== 1) a["fill-opacity"] = fmt(s.fill.opacity);
  if (s.stroke) {
    a.stroke = s.stroke.color;
    if (s.stroke.opacity !== 1) a["stroke-opacity"] = fmt(s.stroke.opacity);
  }
  a["stroke-width"] = fmt(s.strokeWidth);
  if (s.cap !== "butt") a["stroke-linecap"] = s.cap;
  if (s.join !== "miter") a["stroke-linejoin"] = s.join;
  if (s.opacity !== 1) a.opacity = fmt(s.opacity);
  return a;
}

/** The parameters exactly as written (spec M2c §7.1). */
function asWritten(p: PolygonGeometry): PolygonGeometry {
  const r = (v: number) => Number(fmt(v));
  return {
    cx: r(p.cx),
    cy: r(p.cy),
    rx: r(p.rx),
    ry: r(p.ry),
    sides: p.sides,
    star: p.star,
    innerRatio: r(p.innerRatio),
  };
}

/** `d` of a polygon, built from its written numbers so reopening regenerates it exactly. */
export function polygonD(p: PolygonGeometry): string {
  return subpathsToD([polygonSubpath(asWritten(p))]);
}

export function polygonAttr(p: PolygonGeometry): string {
  return [p.sides, p.star ? 1 : 0, p.innerRatio, p.cx, p.cy, p.rx, p.ry].map(fmt).join(" ");
}

/** Spec M10 §7: a title is an ordinary `<path>` that carries what it needs to be re-typed. Every
 *  other reader draws the `d` and ignores these. */
function textAttrs(t: TextMeta | undefined): Attrs {
  if (!t) return {};
  const chars = formatOverrides(t.overrides);
  return {
    "data-sv-text": t.text,
    "data-sv-font": t.font,
    "data-sv-text-opts": formatTextOpts(t),
    ...(chars === "" ? {} : { "data-sv-text-chars": chars }),
  };
}

/** Spec M9 §4: the same pair `layerAttrs` writes, so a hidden or locked node is expressed the way
 *  this app already expresses a hidden or locked layer and any reader understands it. */
function flagAttrs(n: Node): Attrs {
  return {
    ...(isLocked(n) ? { "data-sv-locked": "" } : {}),
    ...(isHidden(n) ? { display: "none" } : {}),
  };
}

export function shapeAttrs(s: Shape): { tag: "rect" | "ellipse" | "path"; attrs: Attrs } {
  const common = {
    ...transformAttr(s.transform),
    ...nameAttr(s.name),
    ...flagAttrs(s),
    ...styleAttrs(s.style),
  };
  switch (s.kind) {
    case "rect":
      return {
        tag: "rect",
        attrs: {
          x: fmt(s.x),
          y: fmt(s.y),
          width: fmt(s.w),
          height: fmt(s.h),
          ...(s.rx > 0 ? { rx: fmt(s.rx) } : {}),
          ...common,
        },
      };
    case "ellipse":
      return {
        tag: "ellipse",
        attrs: { cx: fmt(s.cx), cy: fmt(s.cy), rx: fmt(s.rx), ry: fmt(s.ry), ...common },
      };
    case "polygon": {
      const sp = polygonSubpath(asWritten(s));
      return {
        tag: "path",
        attrs: {
          d: subpathsToD([sp]),
          "data-sv-nodes": nodeTypesAttr([sp]),
          "data-sv-polygon": polygonAttr(s),
          ...common,
        },
      };
    }
    case "path":
      return {
        tag: "path",
        attrs: {
          d: subpathsToD(s.subpaths),
          "data-sv-nodes": nodeTypesAttr(s.subpaths),
          ...textAttrs(s.text),
          ...common,
        },
      };
  }
}

export function groupAttrs(g: Group): Attrs {
  return {
    ...transformAttr(g.transform),
    ...(g.opacity !== 1 ? { opacity: fmt(g.opacity) } : {}),
    ...nameAttr(g.name),
    ...flagAttrs(g),
  };
}

export function layerAttrs(l: Layer): Attrs {
  return {
    "data-sv-layer": "",
    "data-sv-name": l.name,
    ...(l.locked ? { "data-sv-locked": "" } : {}),
    ...(l.visible ? {} : { display: "none" }),
  };
}
