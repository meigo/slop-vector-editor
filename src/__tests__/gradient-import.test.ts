import { describe, expect, it } from "vitest";
import { isGradient, type LinearGradient } from "../doc/document";
import { collectServers, foldLinear, resolveServer, type RawLinear } from "../svg/gradient-import";
import { parseXml } from "../svg/xml";

const svg = (defs: string) =>
  parseXml(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${defs}</svg>`,
  );
const resolve = (defs: string, id = "g") => resolveServer(collectServers(svg(defs)), id);
const linear = (defs: string, id = "g"): RawLinear => {
  const r = resolve(defs, id);
  if (r.kind !== "linear") throw new Error(`not linear: ${JSON.stringify(r)}`);
  return r.g;
};
const box = { x: 0, y: 0, w: 200, h: 100 };
const view = { w: 400, h: 300 };
const foldOk = (g: RawLinear, b = box, o = 1): LinearGradient => {
  const f = foldLinear(g, b, view, o);
  if (f.kind !== "fill" || !isGradient(f.fill)) throw new Error(JSON.stringify(f));
  return f.fill;
};
const close = (a: { x: number; y: number }, x: number, y: number) => {
  expect(a.x).toBeCloseTo(x, 9);
  expect(a.y).toBeCloseTo(y, 9);
};
const stops2 =
  '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/>';

describe("collectServers / resolveServer", () => {
  it("finds gradients anywhere and reads attributes and stops", () => {
    const g = linear(
      `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="1" y1="2" x2="30" y2="4">${stops2}</linearGradient></defs>`,
    );
    expect(g.units).toBe("user");
    expect(g.x1).toEqual({ v: 1, pct: false });
    expect(g.x2).toEqual({ v: 30, pct: false });
    expect(g.stops).toEqual([
      { offset: 0, color: "#ff0000", opacity: 1 },
      { offset: 1, color: "#0000ff", opacity: 0.5 },
    ]);
  });

  it("follows an Inkscape href chain for stops and inherited attributes", () => {
    const g = linear(
      `<defs><linearGradient id="stops">${stops2}</linearGradient>` +
        `<linearGradient id="g" xlink:href="#stops" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0"/></defs>`,
    );
    expect(g.stops).toHaveLength(2);
    expect(g.units).toBe("user");
  });

  it("reads stop colour and opacity from a style attribute", () => {
    const g = linear(
      `<linearGradient id="g"><stop offset="0" style="stop-color:#00ff00;stop-opacity:0.25"/><stop offset="100%" style="stop-color:#000000"/></linearGradient>`,
    );
    expect(g.stops[0]).toEqual({ offset: 0, color: "#00ff00", opacity: 0.25 });
    expect(g.stops[1].offset).toBe(1);
  });

  it("clamps offsets into [0, 1] and never lets one go backwards", () => {
    const g = linear(
      `<linearGradient id="g"><stop offset="0.6"/><stop offset="0.2"/><stop offset="2"/></linearGradient>`,
    );
    expect(g.stops.map((s) => s.offset)).toEqual([0.6, 0.6, 1]);
  });

  it("defaults units to objectBoundingBox and the points to 0% 0% 100% 0%", () => {
    const g = linear(`<linearGradient id="g">${stops2}</linearGradient>`);
    expect(g.units).toBe("bbox");
    expect([g.x1, g.y1, g.x2, g.y2]).toEqual([
      { v: 0, pct: true },
      { v: 0, pct: true },
      { v: 100, pct: true },
      { v: 0, pct: true },
    ]);
  });

  it("reports radial gradients, patterns, missing ids and href cycles", () => {
    expect(resolve(`<radialGradient id="g">${stops2}</radialGradient>`)).toEqual({
      kind: "drop",
      label: "radial gradients",
    });
    expect(resolve(`<pattern id="g"/>`)).toEqual({ kind: "drop", label: "patterns" });
    expect(resolve(`<linearGradient id="h"/>`)).toEqual({ kind: "missing" });
    expect(resolve(`<rect id="g"/>`)).toEqual({ kind: "missing" });
    const cyc = resolve(`<linearGradient id="g" href="#h"/><linearGradient id="h" href="#g"/>`);
    expect(cyc.kind).toBe("linear"); // a cycle stops the walk; the gradient has no stops
    if (cyc.kind === "linear") expect(cyc.g.stops).toEqual([]);
  });
});

describe("foldLinear (spec M15 §4)", () => {
  const user = (attrs: string, stops = stops2) =>
    linear(
      `<linearGradient id="g" gradientUnits="userSpaceOnUse" ${attrs}>${stops}</linearGradient>`,
    );

  it("keeps userSpaceOnUse points as they stand and carries the stops", () => {
    const f = foldOk(user('x1="10" y1="20" x2="110" y2="20"'));
    close(f.from, 10, 20);
    close(f.to, 110, 20);
    expect(f.start).toEqual({ color: "#ff0000", opacity: 1 });
    expect(f.end).toEqual({ color: "#0000ff", opacity: 0.5 });
  });

  it("maps objectBoundingBox fractions and percentages through the shape's box", () => {
    const f = foldOk(
      linear(
        `<linearGradient id="g" x1="0" y1="0.5" x2="100%" y2="50%">${stops2}</linearGradient>`,
      ),
      { x: 10, y: 10, w: 200, h: 100 },
    );
    close(f.from, 10, 60);
    close(f.to, 210, 60);
  });

  it("reads userSpaceOnUse percentages against the viewport", () => {
    const f = foldOk(user('x1="0%" y1="50%" x2="100%" y2="50%"'));
    close(f.from, 0, 150);
    close(f.to, 400, 150);
  });

  it("folds stop offsets into the points", () => {
    const f = foldOk(
      user(
        'x1="0" y1="0" x2="100" y2="0"',
        '<stop offset="0.2" stop-color="#ff0000"/><stop offset="0.8" stop-color="#0000ff"/>',
      ),
    );
    close(f.from, 20, 0);
    close(f.to, 80, 0);
  });

  it("is exact under a skewing gradientTransform (sampled against the source definition)", () => {
    const src = user('x1="0" y1="0" x2="100" y2="0" gradientTransform="matrix(1 0.5 0.3 2 7 -3)"');
    const f = foldOk(src);
    // Source: s(q) = ((A⁻¹q − p1)·d)/(d·d) with A = [1 .5 .3 2 7 -3], p1 = (0,0), d = (100,0).
    const [a, b, c, d, e, ff] = [1, 0.5, 0.3, 2, 7, -3];
    const det = a * d - b * c;
    const inv = (q: { x: number; y: number }) => {
      const x = q.x - e;
      const y = q.y - ff;
      return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
    };
    const tModel = (q: { x: number; y: number }) => {
      const v = { x: f.to.x - f.from.x, y: f.to.y - f.from.y };
      return ((q.x - f.from.x) * v.x + (q.y - f.from.y) * v.y) / (v.x * v.x + v.y * v.y);
    };
    for (const q of [
      { x: 0, y: 0 },
      { x: 50, y: 20 },
      { x: -30, y: 80 },
      { x: 120, y: -40 },
    ]) {
      expect(tModel(q)).toBeCloseTo(inv(q).x / 100, 9);
    }
  });

  it("turns 0 stops into none and 1 stop into a flat paint", () => {
    expect(foldLinear(user('x2="10"', ""), box, view, 1)).toEqual({ kind: "fill", fill: null });
    expect(
      foldLinear(
        user('x2="10"', '<stop offset="0.3" stop-color="#123456" stop-opacity="0.5"/>'),
        box,
        view,
        0.5,
      ),
    ).toEqual({
      kind: "fill",
      fill: { color: "#123456", opacity: 0.25 },
    });
  });

  it("drops what the model cannot draw exactly", () => {
    const three = '<stop offset="0"/><stop offset="0.5"/><stop offset="1"/>';
    expect(foldLinear(user('x2="10"', three), box, view, 1)).toEqual({
      kind: "drop",
      label: "gradients with more than two stops",
    });
    const hard =
      '<stop offset="0.5" stop-color="#ff0000"/><stop offset="0.5" stop-color="#0000ff"/>';
    expect(foldLinear(user('x2="10"', hard), box, view, 1)).toEqual({
      kind: "drop",
      label: "gradients with more than two stops",
    });
    expect(foldLinear(user('x2="10" spreadMethod="reflect"'), box, view, 1)).toEqual({
      kind: "drop",
      label: "repeating gradients",
    });
    expect(foldLinear(user('x2="10" gradientTransform="scale(0)"'), box, view, 1)).toEqual({
      kind: "drop",
      label: "gradients with an invalid transform",
    });
    expect(foldLinear(user('x2="10" gradientTransform="wobble(1)"'), box, view, 1)).toEqual({
      kind: "drop",
      label: "gradients with an invalid transform",
    });
    const bbox = linear(`<linearGradient id="g">${stops2}</linearGradient>`);
    expect(foldLinear(bbox, { x: 0, y: 0, w: 100, h: 0 }, view, 1)).toEqual({
      kind: "drop",
      label: "gradients on zero-size shapes",
    });
    expect(foldLinear(bbox, null, view, 1)).toEqual({
      kind: "drop",
      label: "gradients on zero-size shapes",
    });
  });

  it("multiplies the element's paint opacity into both stops", () => {
    const f = foldOk(user('x1="0" y1="0" x2="10" y2="0"'), box, 0.5);
    expect(f.start.opacity).toBe(0.5);
    expect(f.end.opacity).toBe(0.25);
  });

  it("collapses coincident points to the last stop, as SVG paints them", () => {
    expect(foldLinear(user('x1="5" y1="5" x2="5" y2="5"'), box, view, 1)).toEqual({
      kind: "fill",
      fill: { color: "#0000ff", opacity: 0.5 },
    });
  });
});
