import type { Group, Layer, Shape, Style } from "../doc/document";
import { isIdentity, type Mat } from "../geom/mat";
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

export function shapeAttrs(s: Shape): { tag: "rect" | "ellipse" | "path"; attrs: Attrs } {
  const common = { ...transformAttr(s.transform), ...nameAttr(s.name), ...styleAttrs(s.style) };
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
    case "path":
      return {
        tag: "path",
        attrs: {
          d: subpathsToD(s.subpaths),
          "data-sv-nodes": nodeTypesAttr(s.subpaths),
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
