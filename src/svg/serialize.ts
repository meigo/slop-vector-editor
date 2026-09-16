import type { Doc, Node } from "../doc/document";
import { groupAttrs, layerAttrs, shapeAttrs, styleAttrs, type Attrs } from "./attrs";
import { fmt } from "./fmt";

const escapeAttr = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
    // eslint-disable-next-line no-control-regex -- stripping the remaining C0 controls XML forbids
    .replace(/[\u0000-\u001f]/g, "");

function open(tag: string, attrs: Attrs): string {
  const parts = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`);
  return `<${tag}${parts.join("")}`;
}

function element(tag: string, attrs: Attrs, children: string[], depth: number): string {
  const pad = "  ".repeat(depth);
  if (children.length === 0) return `${pad}${open(tag, attrs)}/>`;
  return [`${pad}${open(tag, attrs)}>`, ...children, `${pad}</${tag}>`].join("\n");
}

function node(n: Node, depth: number): string {
  if (n.kind === "group") {
    return element(
      "g",
      groupAttrs(n),
      n.children.map((c) => node(c, depth + 1)),
      depth,
    );
  }
  const { tag, attrs } = shapeAttrs(n);
  return element(tag, attrs, [], depth);
}

export function serializeDoc(doc: Doc): string {
  const { w, h, background } = doc.artboard;
  const body: string[] = [];
  if (background) {
    const fill = styleAttrs({
      fill: background,
      stroke: null,
      strokeWidth: 0,
      cap: "butt",
      join: "miter",
      opacity: 1,
    });
    body.push(
      element(
        "rect",
        {
          "data-sv-background": "",
          x: "0",
          y: "0",
          width: fmt(w),
          height: fmt(h),
          fill: fill.fill,
          ...(fill["fill-opacity"] ? { "fill-opacity": fill["fill-opacity"] } : {}),
        },
        [],
        1,
      ),
    );
  }
  for (const layer of doc.layers) {
    body.push(
      element(
        "g",
        layerAttrs(layer),
        layer.children.map((c) => node(c, 2)),
        1,
      ),
    );
  }
  const root = element(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: fmt(w),
      height: fmt(h),
      viewBox: `0 0 ${fmt(w)} ${fmt(h)}`,
      "data-sv-version": "1",
    },
    body,
    0,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n${root}\n`;
}
