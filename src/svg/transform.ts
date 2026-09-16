import { IDENTITY, multiply, rotate, scale, skewX, skewY, translate, type Mat } from "../geom/mat";

const FN_RE = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const rad = (deg: number) => (deg * Math.PI) / 180;

function fnMatrix(name: string, a: number[]): Mat | null {
  switch (name) {
    case "matrix":
      return a.length === 6 ? [a[0], a[1], a[2], a[3], a[4], a[5]] : null;
    case "translate":
      return a.length === 1 || a.length === 2 ? translate(a[0], a[1] ?? 0) : null;
    case "scale":
      return a.length === 1 || a.length === 2 ? scale(a[0], a[1] ?? a[0]) : null;
    case "rotate":
      if (a.length === 1) return rotate(rad(a[0]));
      if (a.length === 3) {
        return multiply(
          translate(a[1], a[2]),
          multiply(rotate(rad(a[0])), translate(-a[1], -a[2])),
        );
      }
      return null;
    case "skewX":
      return a.length === 1 ? skewX(rad(a[0])) : null;
    case "skewY":
      return a.length === 1 ? skewY(rad(a[0])) : null;
  }
  return null;
}

export function parseTransform(value: string): Mat {
  let result: Mat = IDENTITY;
  let found = false;
  for (const m of value.matchAll(FN_RE)) {
    const args = (m[2].match(NUM_RE) ?? []).map(Number);
    const fm = fnMatrix(m[1], args);
    if (!fm) return IDENTITY; // SVG: an invalid list disables the whole transform
    result = multiply(result, fm);
    found = true;
  }
  return found ? result : IDENTITY;
}
