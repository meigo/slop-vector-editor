import type { PathNode, Subpath } from "../doc/document";
import type { Vec } from "./vec";

/** Handle length for a quarter-ellipse cubic. */
export const KAPPA = 0.5522847498;

const node = (p: Vec, inH: Vec | null = null, out: Vec | null = null): PathNode => ({
  p,
  in: inH,
  out,
  type: "corner",
});

/** A rectangle as a closed path, clockwise from the top edge. */
export function rectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): Subpath {
  if (rx <= 0 || ry <= 0) {
    return {
      closed: true,
      nodes: [
        node({ x, y }),
        node({ x: x + w, y }),
        node({ x: x + w, y: y + h }),
        node({ x, y: y + h }),
      ],
    };
  }
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  const r = x + w;
  const b = y + h;
  return {
    closed: true,
    nodes: [
      node({ x: x + rx, y }, { x: x + rx - kx, y }, null),
      node({ x: r - rx, y }, null, { x: r - rx + kx, y }),
      node({ x: r, y: y + ry }, { x: r, y: y + ry - ky }, null),
      node({ x: r, y: b - ry }, null, { x: r, y: b - ry + ky }),
      node({ x: r - rx, y: b }, { x: r - rx + kx, y: b }, null),
      node({ x: x + rx, y: b }, null, { x: x + rx - kx, y: b }),
      node({ x, y: b - ry }, { x, y: b - ry + ky }, null),
      node({ x, y: y + ry }, null, { x, y: y + ry - ky }),
    ],
  };
}
