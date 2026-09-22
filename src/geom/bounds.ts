import { isHidden, type Node, type PathNode, type Subpath } from "../doc/document";
import { cubicBounds, segmentCubic } from "./bezier";
import { boxFromPoints, unionBox, type Box } from "./box";
import { applyMat, isAxisAligned, multiply, type Mat } from "./mat";
import { polygonSubpath, rectPath } from "./shapes";

function mapNode(m: Mat, n: PathNode): PathNode {
  return {
    p: applyMat(m, n.p),
    in: n.in && applyMat(m, n.in),
    out: n.out && applyMat(m, n.out),
    type: n.type,
  };
}

function pathBounds(subpaths: readonly Subpath[], m: Mat): Box | null {
  let box = null as Box | null;
  const segment = (a: PathNode, b: PathNode) => {
    const c = segmentCubic(a, b);
    box = unionBox(box, c ? cubicBounds(c) : boxFromPoints([b.p]));
  };
  for (const sp of subpaths) {
    const n = sp.nodes.map((node) => mapNode(m, node));
    if (n.length === 0) continue;
    box = unionBox(box, boxFromPoints([n[0].p]));
    for (let i = 1; i < n.length; i++) segment(n[i - 1], n[i]);
    if (sp.closed && n.length > 1) segment(n[n.length - 1], n[0]);
  }
  return box;
}

/** Geometric bounds (stroke excluded) of `node` drawn under `m`. */
export function nodeBounds(node: Node, m: Mat): Box | null {
  const t = multiply(m, node.transform);
  switch (node.kind) {
    case "group": {
      let box: Box | null = null;
      for (const c of node.children) {
        if (isHidden(c)) continue;
        box = unionBox(box, nodeBounds(c, t));
      }
      return box;
    }
    case "rect": {
      const r = Math.min(Math.max(node.rx, 0), node.w / 2, node.h / 2);
      // Axis-aligned, the sharp box is exact for a rounded rect: the arcs sit inside the corners.
      // Rotated or skewed, that box is the rotated square, which is larger than the arc.
      if (r > 0 && !isAxisAligned(t)) {
        return pathBounds([rectPath(node.x, node.y, node.w, node.h, r, r)], t);
      }
      return boxFromPoints(
        [
          { x: node.x, y: node.y },
          { x: node.x + node.w, y: node.y },
          { x: node.x + node.w, y: node.y + node.h },
          { x: node.x, y: node.y + node.h },
        ].map((p) => applyMat(t, p)),
      );
    }
    case "ellipse": {
      const c = applyMat(t, { x: node.cx, y: node.cy });
      const ex = Math.hypot(t[0] * node.rx, t[2] * node.ry);
      const ey = Math.hypot(t[1] * node.rx, t[3] * node.ry);
      return { x: c.x - ex, y: c.y - ey, w: 2 * ex, h: 2 * ey };
    }
    case "polygon":
      return boxFromPoints(polygonSubpath(node).nodes.map((n) => applyMat(t, n.p)));
    case "path":
      return pathBounds(node.subpaths, t);
  }
}
