import { describe, expect, it } from "vitest";
import { isLinear, isRadial, type LinearGradient, type RadialGradient } from "../doc/document";
import { applyMat, invert, type Mat } from "../geom/mat";
import {
  collectServers,
  foldLinear,
  foldRadial,
  resolveServer,
  type RawLinear,
  type RawRadial,
} from "../svg/gradient-import";
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
  if (f.kind !== "fill" || !isLinear(f.fill)) throw new Error(JSON.stringify(f));
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

  it("reports patterns, missing ids and href cycles, and resolves a radial gradient", () => {
    expect(resolve(`<radialGradient id="g">${stops2}</radialGradient>`).kind).toBe("radial");
    expect(resolve(`<pattern id="g"/>`)).toEqual({ kind: "drop", label: "patterns" });
    expect(resolve(`<linearGradient id="h"/>`)).toEqual({ kind: "missing" });
    expect(resolve(`<rect id="g"/>`)).toEqual({ kind: "missing" });
    const cyc = resolve(`<linearGradient id="g" href="#h"/><linearGradient id="h" href="#g"/>`);
    // Spec M15 §4 / review finding 5: a cycle is dropped, not silently followed into a gradient
    // with no stops.
    expect(cyc).toEqual({ kind: "drop", label: "broken gradient references" });
  });

  it("drops a chain longer than 16 links (review finding 5)", () => {
    const N = 20;
    const links = Array.from(
      { length: N },
      (_, i) =>
        `<linearGradient id="g${i}"${i < N - 1 ? ` href="#g${i + 1}"` : ""}>${i === N - 1 ? stops2 : ""}</linearGradient>`,
    ).join("");
    expect(resolve(links, "g0")).toEqual({ kind: "drop", label: "broken gradient references" });
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

  it("is exact for objectBoundingBox units combined with a non-identity gradientTransform (review finding 11)", () => {
    const g = linear(
      `<linearGradient id="g" gradientTransform="rotate(90 0.5 0.5)">${stops2}</linearGradient>`,
    );
    const f = foldOk(g, box); // box = { x: 0, y: 0, w: 200, h: 100 }
    // Hand computation: rotate(90°, 0.5, 0.5) maps the default unit gradient line (0,0)→(1,0), in
    // bbox fraction space, to (1,0)→(1,1); scaled by the 200×100 box that becomes (200,0)→(200,100)
    // — a vertical line down the box's right edge.
    close(f.from, 200, 0);
    close(f.to, 200, 100);
    // Sample t(q) against the source's own s(q) = ((A⁻¹q − p1)·d)/(d·d), where A is the unit map
    // composed with gradientTransform — derived by hand from the same rotation.
    const A: Mat = [0, 100, -200, 0, 200, 0];
    const inv = invert(A)!;
    const p1 = { x: 0, y: 0 };
    const d = { x: 1, y: 0 };
    const sOf = (q: { x: number; y: number }) => {
      const iq = applyMat(inv, q);
      return ((iq.x - p1.x) * d.x + (iq.y - p1.y) * d.y) / (d.x * d.x + d.y * d.y);
    };
    const tModel = (q: { x: number; y: number }) => {
      const v = { x: f.to.x - f.from.x, y: f.to.y - f.from.y };
      return ((q.x - f.from.x) * v.x + (q.y - f.from.y) * v.y) / (v.x * v.x + v.y * v.y);
    };
    for (const q of [
      { x: 200, y: 0 },
      { x: 200, y: 50 },
      { x: 150, y: 30 },
      { x: 0, y: 100 },
    ]) {
      expect(tModel(q)).toBeCloseTo(sOf(q), 9);
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

describe("bounded coordinates (review finding 2)", () => {
  const userG = (attrs: string) =>
    linear(
      `<linearGradient id="g" gradientUnits="userSpaceOnUse" ${attrs}>${stops2}</linearGradient>`,
    );

  it("rejects a length over MAX_COORD instead of overflowing (x2 = 1e12)", () => {
    const f = foldOk(userG('x1="0" y1="0" x2="1e12" y2="0"'));
    // Rejected by `len`: falls back as if x2 were absent (100%).
    close(f.to, 400, 0);
  });

  it("rejects a grossly absurd length the same way, instead of overflowing to NaN (x2 = 1e200)", () => {
    // Before the fix, `Number("1e200")` is finite but overflows `dd` downstream and stored NaN
    // points, unreported. `len` now bounds it exactly as it bounds 1e12, so the gradient still
    // folds — with x2 falling back to 100%, same as if it were absent.
    const f = foldOk(userG('x1="0" y1="0" x2="1e200" y2="0"'));
    close(f.to, 400, 0);
  });

  it("drops a gradient whose folded points exceed MAX_COORD, even with a readable transform", () => {
    // Every individual number here is well under MAX_COORD (1e9) — the transform parses, the
    // points parse — but the FOLDED point (100 · 100000 + 999000000) does not.
    const g = userG(
      'x1="100000" y1="0" x2="100010" y2="0" ' +
        'gradientTransform="matrix(100 0 0 100 999000000 0)"',
    );
    expect(foldLinear(g, box, view, 1)).toEqual({
      kind: "drop",
      label: "invalid gradient coordinates",
    });
  });
});

const radial = (defs: string, id = "g"): RawRadial => {
  const r = resolve(defs, id);
  if (r.kind !== "radial") throw new Error(`not radial: ${JSON.stringify(r)}`);
  return r.g;
};
const radOk = (g: RawRadial, b = box, o = 1): RadialGradient => {
  const f = foldRadial(g, b, view, o);
  if (f.kind !== "fill" || !isRadial(f.fill)) throw new Error(JSON.stringify(f));
  return f.fill;
};
const userR = (attrs: string, stops = stops2) =>
  radial(
    `<radialGradient id="g" gradientUnits="userSpaceOnUse" ${attrs}>${stops}</radialGradient>`,
  );

describe("foldRadial (spec M16 §4)", () => {
  it("keeps a userSpaceOnUse circle as centre and two rim points", () => {
    const f = radOk(userR('cx="50" cy="40" r="30"'));
    close(f.center, 50, 40);
    close(f.a, 80, 40);
    close(f.b, 50, 70);
    expect(f.end).toEqual({ color: "#0000ff", opacity: 0.5 });
  });

  it("keeps an ellipse given as the unit circle under a matrix", () => {
    const f = radOk(userR('cx="0" cy="0" r="1" gradientTransform="matrix(30 0 0 10 50 40)"'));
    close(f.center, 50, 40);
    close(f.a, 80, 40);
    close(f.b, 50, 50);
  });

  it("maps objectBoundingBox defaults through a non-square box into an ellipse, exactly", () => {
    const f = radOk(radial(`<radialGradient id="g">${stops2}</radialGradient>`), {
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
    close(f.center, 100, 50);
    close(f.a, 200, 50);
    close(f.b, 100, 100);
    // Sampled against the source: s(q) = |((q − box.xy)/(w, h)) − (.5, .5)| / .5.
    const M = [f.a.x - f.center.x, f.a.y - f.center.y, f.b.x - f.center.x, f.b.y - f.center.y];
    const det = M[0] * M[3] - M[1] * M[2];
    const model = (q: { x: number; y: number }) => {
      const x = q.x - f.center.x,
        y = q.y - f.center.y;
      return Math.hypot((M[3] * x - M[2] * y) / det, (-M[1] * x + M[0] * y) / det);
    };
    for (const q of [
      { x: 30, y: 20 },
      { x: 170, y: 90 },
      { x: 100, y: 5 },
    ]) {
      expect(model(q)).toBeCloseTo(Math.hypot(q.x / 200 - 0.5, q.y / 100 - 0.5) / 0.5, 9);
    }
  });

  it("reads a userSpaceOnUse % radius against the viewport's normalised diagonal", () => {
    const f = radOk(userR('cx="0" cy="0" r="10%"'));
    close(f.a, Math.sqrt((400 * 400 + 300 * 300) / 2) / 10, 0);
  });

  it("folds a last stop below 1 into the rim", () => {
    const f = radOk(
      userR(
        'cx="50" cy="40" r="30"',
        '<stop offset="0" stop-color="#ff0000"/><stop offset="0.5" stop-color="#0000ff"/>',
      ),
    );
    close(f.a, 65, 40);
    close(f.b, 50, 55);
  });

  it("drops what the model cannot draw exactly", () => {
    const d = (attrs: string, stops = stops2) => foldRadial(userR(attrs, stops), box, view, 1);
    expect(d('cx="50" cy="40" r="30" fx="60"')).toEqual({
      kind: "drop",
      label: "radial gradients with a focal point",
    });
    expect(d('cx="50" cy="40" r="30" fr="5"')).toEqual({
      kind: "drop",
      label: "radial gradients with a focal point",
    });
    expect(d('cx="50" cy="40" r="30"', '<stop offset="0.2"/><stop offset="1"/>')).toEqual({
      kind: "drop",
      label: "radial gradients with an inner stop",
    });
    expect(
      d('cx="50" cy="40" r="30"', '<stop offset="0"/><stop offset="0.5"/><stop offset="1"/>'),
    ).toEqual({ kind: "drop", label: "gradients with more than two stops" });
    expect(d('cx="50" cy="40" r="30" spreadMethod="repeat"')).toEqual({
      kind: "drop",
      label: "repeating gradients",
    });
    expect(d('cx="0" cy="0" r="100" gradientTransform="scale(1e8)"')).toEqual({
      kind: "drop",
      label: "invalid gradient coordinates",
    });
    expect(d('cx="0" cy="0" r="1" gradientTransform="scale(0)"')).toEqual({
      kind: "drop",
      label: "gradients with an invalid transform",
    });
  });

  it("an explicit fx/fy equal to the centre is not a focal point", () => {
    const f = foldRadial(userR('cx="50" cy="40" r="30" fx="50" fy="40"'), box, view, 1);
    expect(f.kind === "fill" && isRadial(f.fill)).toBe(true);
  });

  it("paints r = 0 as the last stop, flat", () => {
    expect(foldRadial(userR('cx="50" cy="40" r="0"'), box, view, 1)).toEqual({
      kind: "fill",
      fill: { color: "#0000ff", opacity: 0.5 },
    });
  });

  it("follows an href from a radial to a linear holding the stops", () => {
    const g = radial(
      `<linearGradient id="s">${stops2}</linearGradient><radialGradient id="g" href="#s" gradientUnits="userSpaceOnUse" cx="10" cy="10" r="5"/>`,
    );
    expect(g.stops).toHaveLength(2);
    close(radOk(g).a, 15, 10);
  });
});
