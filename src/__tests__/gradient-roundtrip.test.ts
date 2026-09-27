import { describe, expect, it } from "vitest";
import {
  createDoc,
  DEFAULT_STYLE,
  isGradient,
  isLinear,
  isRadial,
  type Doc,
  type LinearGradient,
  type RadialGradient,
  type Shape,
} from "../doc/document";
import { parseSvg } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";
import { stripIds } from "./helpers";

const shapesOf = (d: Doc): Shape[] =>
  d.layers
    .flatMap((l) => l.children)
    .flatMap(function f(n): Shape[] {
      return n.kind === "group" ? n.children.flatMap(f) : [n];
    });
const wrap = (body: string, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="300" ${extra}>${body}</svg>`;
const stops = '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>';

describe("gradient import (spec M15 §4)", () => {
  it("round-trips our own gradients exactly and keeps the file native with nothing dropped", () => {
    const g: LinearGradient = {
      kind: "linear",
      from: { x: 1.5, y: 2.25 },
      to: { x: 90.125, y: -4 },
      start: { color: "#ff3366", opacity: 1 },
      end: { color: "#00ff00", opacity: 0.4 },
    };
    const d0 = createDoc(200, 100);
    const d: Doc = {
      ...d0,
      layers: [
        {
          ...d0.layers[0],
          children: [
            {
              kind: "ellipse",
              id: "n5",
              transform: [0.8, 0.6, -0.6, 0.8, 10, 20],
              style: { ...DEFAULT_STYLE, fill: g, stroke: g },
              cx: 50,
              cy: 40,
              rx: 30,
              ry: 20,
            },
          ],
        },
      ],
    };
    const r = parseSvg(serializeDoc(d));
    expect(r.dropped).toEqual([]);
    expect(r.native).toBe(true);
    expect(stripIds(r.doc).layers[0].children[0]).toEqual(stripIds(d).layers[0].children[0]);
  });

  it("round-trips a radial gradient exactly, circle and skewed ellipse alike", () => {
    const fill: RadialGradient = {
      kind: "radial",
      center: { x: 50, y: 40 },
      a: { x: 80, y: 40 },
      b: { x: 50, y: 70 },
      start: { color: "#ff3366", opacity: 1 },
      end: { color: "#00ff00", opacity: 0.4 },
    };
    const stroke: RadialGradient = {
      kind: "radial",
      center: { x: 50, y: 40 },
      a: { x: 80, y: 43 },
      b: { x: 47, y: 52 },
      start: { color: "#3366ff", opacity: 0.8 },
      end: { color: "#ffff00", opacity: 1 },
    };
    const d0 = createDoc(200, 100);
    const d: Doc = {
      ...d0,
      layers: [
        {
          ...d0.layers[0],
          children: [
            {
              kind: "ellipse",
              id: "n5",
              transform: [0.8, 0.6, -0.6, 0.8, 10, 20],
              style: { ...DEFAULT_STYLE, fill, stroke },
              cx: 50,
              cy: 40,
              rx: 30,
              ry: 20,
            },
          ],
        },
      ],
    };
    const r = parseSvg(serializeDoc(d));
    expect(r.dropped).toEqual([]);
    expect(r.native).toBe(true);
    expect(stripIds(r.doc).layers[0].children[0]).toEqual(stripIds(d).layers[0].children[0]);
  });

  it("resolves a group's inherited url per child, in each child's own box", () => {
    const r = parseSvg(
      wrap(
        `<defs><linearGradient id="g">${stops}</linearGradient></defs>` +
          `<g fill="url(#g)"><rect x="0" y="0" width="100" height="10"/><rect x="200" y="50" width="50" height="10"/></g>`,
      ),
    );
    expect(r.dropped).toEqual([]);
    const [a, b] = shapesOf(r.doc);
    expect(isLinear(a.style.fill) && a.style.fill.to.x).toBe(100);
    expect(isLinear(b.style.fill) && b.style.fill.from.x).toBe(200);
    expect(isLinear(b.style.fill) && b.style.fill.to.x).toBe(250);
  });

  it("uses a url's fallback colour when the reference is missing, else none and a report", () => {
    const r1 = parseSvg(wrap(`<rect width="10" height="10" fill="url(#nope) #00ff00"/>`));
    expect(shapesOf(r1.doc)[0].style.fill).toEqual({ color: "#00ff00", opacity: 1 });
    expect(r1.dropped).toEqual([]);
    const r2 = parseSvg(wrap(`<rect width="10" height="10" fill="url(#nope)"/>`));
    expect(shapesOf(r2.doc)[0].style.fill).toBeNull();
    expect(r2.dropped).toContain("missing paint references");
  });

  it("imports a radial gradient fill and still drops a pattern stroke by name", () => {
    const r = parseSvg(
      wrap(
        `<radialGradient id="r">${stops}</radialGradient><pattern id="p"/>` +
          `<rect width="10" height="10" fill="url(#r)" stroke="url(#p)"/>`,
      ),
    );
    const s = shapesOf(r.doc)[0];
    expect(isRadial(s.style.fill)).toBe(true);
    expect(s.style.stroke).toBeNull();
    expect(r.dropped).toEqual(["patterns"]);
  });

  it("multiplies fill-opacity into the stops", () => {
    const r = parseSvg(
      wrap(
        `<linearGradient id="g" gradientUnits="userSpaceOnUse" x2="10">${stops}</linearGradient>` +
          `<rect width="10" height="10" fill="url(#g)" fill-opacity="0.5"/>`,
      ),
    );
    const f = shapesOf(r.doc)[0].style.fill;
    expect(isGradient(f) && [f.start.opacity, f.end.opacity]).toEqual([0.5, 0.5]);
  });

  it("gives a line a userSpaceOnUse stroke gradient (a zero-height box is fine in user space)", () => {
    const r = parseSvg(
      wrap(
        `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" x2="100">${stops}</linearGradient>` +
          `<line x1="0" y1="5" x2="100" y2="5" stroke="url(#g)"/>`,
      ),
    );
    expect(isGradient(shapesOf(r.doc)[0].style.stroke)).toBe(true);
    expect(r.dropped).toEqual([]);
  });

  it("keeps a gradient on the artboard background out of the model and reports it", () => {
    const r = parseSvg(
      wrap(
        `<linearGradient id="g">${stops}</linearGradient>` +
          `<rect data-sv-background="" x="0" y="0" width="400" height="300" fill="url(#g)"/>` +
          `<g data-sv-layer=""/>`,
        'data-sv-version="1"',
      ),
    );
    expect(r.doc.artboard.background).toBeNull();
    expect(r.dropped).toContain("background gradients");
  });
});
