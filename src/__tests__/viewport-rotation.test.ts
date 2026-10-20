import { describe, expect, it } from "vitest";
import { applyMat } from "../geom/mat";
import type { Vec } from "../geom/vec";
import {
  docToScreen,
  fitRect,
  normalizeAngle,
  panBy,
  revealPan,
  visibleDocBox,
  pinch,
  rotateAt,
  screenToDoc,
  snappedRotation,
  steppedRotation,
  viewAngle,
  viewMatrix,
  zoomAt,
  type View,
} from "../state/viewport";

const close = (a: Vec, b: Vec) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};
const deg = (d: number) => (d * Math.PI) / 180;

describe("rotated viewport", () => {
  it("an absent rotation maps exactly as before", () => {
    expect(docToScreen({ x: 5, y: 7, zoom: 2 }, { x: 1, y: 1 })).toEqual({ x: 7, y: 9 });
  });
  it("90° clockwise maps doc +x to screen +y", () => {
    close(docToScreen({ x: 0, y: 0, zoom: 2, rotation: deg(90) }, { x: 1, y: 0 }), { x: 0, y: 2 });
  });
  it("screenToDoc inverts docToScreen at 30°, 137° and −170°", () => {
    for (const a of [30, 137, -170]) {
      const v: View = { x: 13, y: -40, zoom: 1.7, rotation: deg(a) };
      for (const p of [
        { x: 0, y: 0 },
        { x: 25, y: -9 },
        { x: -300, y: 410 },
      ]) {
        close(screenToDoc(v, docToScreen(v, p)), p);
      }
    }
  });
  it("viewMatrix agrees with docToScreen", () => {
    const v: View = { x: 4, y: 9, zoom: 2.5, rotation: deg(65) };
    const p = { x: 11, y: -6 };
    close(applyMat(viewMatrix(v), p), docToScreen(v, p));
  });
  it("panBy and zoomAt keep the rotation", () => {
    const v = { x: 0, y: 0, zoom: 1, rotation: 0.5 };
    expect(panBy(v, 3, 4).rotation).toBe(0.5);
    expect(zoomAt(v, { x: 10, y: 10 }, 2).rotation).toBe(0.5);
  });
  it("zoomAt keeps the point under the cursor on a rotated view", () => {
    const v: View = { x: 7, y: 3, zoom: 1, rotation: deg(40) };
    const at = { x: 50, y: 60 };
    const d = screenToDoc(v, at);
    close(docToScreen(zoomAt(v, at, 2), d), at);
  });
  it("rotateAt keeps the pivot fixed", () => {
    const v = { x: 12, y: -3, zoom: 1.5, rotation: deg(20) };
    const piv = { x: 100, y: 80 };
    const d = screenToDoc(v, piv);
    close(docToScreen(rotateAt(v, piv, deg(35)), d), piv);
    expect(viewAngle(rotateAt(v, piv, deg(35)))).toBeCloseTo(deg(55), 12);
  });
  it("rotating back to zero drops the key", () => {
    const r = rotateAt({ x: 0, y: 0, zoom: 1 }, { x: 5, y: 5 }, 0);
    expect("rotation" in r).toBe(false);
  });
  it("pinch with a pure twist rotates about the midpoint and keeps zoom", () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const r = pinch(v, { x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 }, { x: 0, y: 10 });
    expect(viewAngle(r)).toBeCloseTo(deg(90), 9);
    expect(r.zoom).toBeCloseTo(1, 9);
    close(docToScreen(r, { x: 0, y: 0 }), { x: 0, y: 0 });
  });
  it("pinch with a pure spread leaves the angle at 0", () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const r = pinch(v, { x: -10, y: 0 }, { x: 10, y: 0 }, { x: -20, y: 0 }, { x: 20, y: 0 });
    expect(viewAngle(r)).toBe(0);
    expect(r.zoom).toBeCloseTo(2, 9);
  });
  it("snappedRotation snaps within 3° and exactly", () => {
    expect(snappedRotation(deg(2.9))).toBe(0);
    expect(snappedRotation(deg(-2.9))).toBe(0);
    expect(snappedRotation(deg(3.1))).toBeCloseTo(deg(3.1), 12);
    expect(snappedRotation(deg(88))).toBe(Math.PI / 2);
    expect(snappedRotation(deg(179))).toBe(Math.PI);
    expect(snappedRotation(deg(-179))).toBe(Math.PI);
    expect(snappedRotation(deg(359.5))).toBe(0);
  });
  it("steppedRotation lands on the next multiple", () => {
    expect(steppedRotation(deg(37), deg(15), 1)).toBeCloseTo(deg(45), 9);
    expect(steppedRotation(deg(37), deg(15), -1)).toBeCloseTo(deg(30), 9);
    expect(steppedRotation(deg(30), deg(15), 1)).toBeCloseTo(deg(45), 9);
    expect(steppedRotation(deg(37), deg(90), 1)).toBeCloseTo(deg(90), 9);
    expect(steppedRotation(deg(-179), deg(15), -1)).toBeCloseTo(Math.PI, 9);
  });
  it("normalizeAngle maps into (−π, π]", () => {
    expect(normalizeAngle(-Math.PI)).toBe(Math.PI);
    expect(normalizeAngle(deg(270))).toBeCloseTo(deg(-90), 12);
  });
  it("fitRect at 90° fits the turned rectangle and centres it", () => {
    const v = fitRect({ x: 0, y: 0, w: 200, h: 100 }, 400, 400, 40, deg(90));
    expect(v.zoom).toBeCloseTo(1.6, 9);
    close(docToScreen(v, { x: 100, y: 50 }), { x: 200, y: 200 });
  });
});

describe("rotated viewport: visible box, fit and reveal", () => {
  it("visibleDocBox at 0° is the plain viewport", () => {
    expect(visibleDocBox({ x: 10, y: 20, zoom: 2 }, 100, 50)).toEqual({
      x: -5,
      y: -10,
      w: 50,
      h: 25,
    });
  });
  it("visibleDocBox at 90° has positive size and holds every viewport corner", () => {
    const v: View = { x: 300, y: 0, zoom: 1, rotation: deg(90) };
    const b = visibleDocBox(v, 300, 200);
    expect(b.w).toBeCloseTo(200, 9);
    expect(b.h).toBeCloseTo(300, 9);
    // the viewport centre maps to the box centre
    const c = screenToDoc(v, { x: 150, y: 100 });
    expect(b.x + b.w / 2).toBeCloseTo(c.x, 9);
    expect(b.y + b.h / 2).toBeCloseTo(c.y, 9);
  });
  it("visibleDocBox at 30° is the turned viewport's bounding box", () => {
    const v: View = { x: 0, y: 0, zoom: 1, rotation: deg(30) };
    const b = visibleDocBox(v, 200, 100);
    const c = Math.cos(deg(30));
    const s = Math.sin(deg(30));
    expect(b.w).toBeCloseTo(200 * c + 100 * s, 9);
    expect(b.h).toBeCloseTo(200 * s + 100 * c, 9);
  });
  it("fitRect at 30° fits the turned bounding box and centres it", () => {
    const rect = { x: 10, y: 20, w: 200, h: 100 };
    const a = deg(30);
    const bw = 200 * Math.cos(a) + 100 * Math.sin(a);
    const bh = 200 * Math.sin(a) + 100 * Math.cos(a);
    const v = fitRect(rect, 500, 400, 40, a);
    expect(v.zoom).toBeCloseTo(Math.min(420 / bw, 320 / bh), 9);
    expect(viewAngle(v)).toBeCloseTo(a, 12);
    close(docToScreen(v, { x: 110, y: 70 }), { x: 250, y: 200 });
    const pts = [
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      { x: 210, y: 120 },
      { x: 10, y: 120 },
    ].map((p) => docToScreen(v, p));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(bw * v.zoom, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(bh * v.zoom, 6);
  });
  it("revealPan pans a turned caret's screen box the minimal amount and keeps rotation", () => {
    const v: View = { x: 50, y: 60, zoom: 2, rotation: deg(30) };
    const p = docToScreen(v, { x: 40, y: 10 });
    const q = docToScreen(v, { x: 40, y: 30 });
    const rect = {
      x: Math.min(p.x, q.x),
      y: Math.min(p.y, q.y),
      w: Math.abs(p.x - q.x),
      h: Math.abs(p.y - q.y),
    };
    const visible = { x: 0, y: 0, w: rect.x + rect.w - 20, h: 1000 };
    const r = revealPan(v, rect, visible, 10);
    expect(r.rotation).toBe(v.rotation);
    expect(r.x - v.x).toBeCloseTo(visible.w - (rect.x + rect.w + 10), 9);
    expect(r.y).toBe(v.y);
    expect(r.zoom).toBe(v.zoom);
    expect(revealPan(v, rect, { x: -1000, y: -1000, w: 5000, h: 5000 }, 10)).toBe(v);
  });
});
