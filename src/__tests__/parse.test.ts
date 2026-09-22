import { describe, expect, it } from "vitest";
import figma from "../../fixtures/figma-flat.svg?raw";
import illustrator from "../../fixtures/illustrator-classes.svg?raw";
import inkscape from "../../fixtures/inkscape-layers.svg?raw";
import {
  createDoc,
  DEFAULT_STYLE,
  type Doc,
  type PathShape,
  type PolygonShape,
  type Shape,
} from "../doc/document";
import { IDENTITY, rotateAbout } from "../geom/mat";
import { rectPath } from "../geom/shapes";
import { parsePolygonAttr, parseSvg, SvgError } from "../svg/parse";
import { polygonD } from "../svg/attrs";
import { fmt } from "../svg/fmt";
import { parsePathData } from "../svg/pathdata";
import { serializeDoc } from "../svg/serialize";
import { XmlError } from "../svg/xml";
import { stripIds } from "./helpers";

describe("rectPath", () => {
  it("makes 4 corners without radius and 8 nodes with one", () => {
    const sharp = rectPath(0, 0, 10, 20, 0, 0);
    expect(sharp.closed).toBe(true);
    expect(sharp.nodes.map((n) => n.p)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ]);
    const round = rectPath(0, 0, 10, 20, 2, 4);
    expect(round.nodes).toHaveLength(8);
    expect(round.nodes[0].p).toEqual({ x: 2, y: 0 });
    expect(round.nodes[0].in!.x).toBeCloseTo(2 - 2 * 0.5523, 3);
    expect(round.nodes[2].p).toEqual({ x: 10, y: 4 });
  });
});

describe("parseSvg — own format round-trip", () => {
  it("reads back exactly what it wrote", () => {
    const base = createDoc(300, 200);
    const doc: Doc = {
      ...base,
      artboard: { w: 300, h: 200, background: { color: "#123456", opacity: 0.5 } },
      layers: [
        {
          id: "n1",
          name: `Front & "center"`,
          visible: true,
          locked: true,
          children: [
            {
              kind: "group",
              id: "n2",
              name: "G",
              transform: [0.866025, 0.5, -0.5, 0.866025, 10, 20],
              opacity: 0.75,
              children: [
                {
                  kind: "rect",
                  id: "n3",
                  name: "R",
                  transform: [1, 0, 0, 1, 0, 0],
                  style: DEFAULT_STYLE,
                  x: 1,
                  y: 2,
                  w: 30,
                  h: 40,
                  rx: 5,
                },
              ],
            },
            {
              kind: "ellipse",
              id: "n4",
              transform: [2, 0, 0, 2, 0, 0],
              style: {
                fill: null,
                stroke: { color: "#ff0000", opacity: 0.4 },
                strokeWidth: 3,
                cap: "round",
                join: "bevel",
                opacity: 0.9,
              },
              cx: 5,
              cy: 6,
              rx: 7,
              ry: 8,
            },
          ],
        },
        {
          id: "n5",
          name: "Hidden",
          visible: false,
          locked: false,
          children: [
            {
              kind: "path",
              id: "n6",
              transform: [1, 0, 0, 1, 0, 0],
              style: { ...DEFAULT_STYLE, stroke: null, strokeWidth: 4, join: "round" },
              subpaths: [
                {
                  closed: true,
                  nodes: [
                    {
                      p: { x: 0, y: 0 },
                      in: { x: 0, y: 5 },
                      out: { x: 0, y: -5 },
                      type: "symmetric",
                    },
                    { p: { x: 10, y: 0 }, in: { x: 10, y: -5 }, out: null, type: "corner" },
                    { p: { x: 5, y: 10 }, in: null, out: null, type: "corner" },
                  ],
                },
                {
                  closed: false,
                  nodes: [
                    { p: { x: 20, y: 20 }, in: null, out: { x: 25, y: 20 }, type: "corner" },
                    { p: { x: 30, y: 30 }, in: { x: 30, y: 25 }, out: null, type: "smooth" },
                  ],
                },
              ],
            },
          ],
        },
      ],
      nextId: 7,
    };
    const { doc: back, dropped } = parseSvg(serializeDoc(doc));
    expect(dropped).toEqual([]);
    expect(stripIds(back)).toEqual(stripIds(doc));
    expect(back.nextId).toBe(7);
  });

  it("reads a null background and an empty document", () => {
    const doc = createDoc(10, 20);
    const noBg = { ...doc, artboard: { ...doc.artboard, background: null } };
    expect(stripIds(parseSvg(serializeDoc(noBg)).doc)).toEqual(stripIds(noBg));
  });

  it("marks own-format output as native", () => {
    expect(parseSvg(serializeDoc(createDoc(10, 10))).native).toBe(true);
  });
});

describe("parseSvg — foreign files", () => {
  it("reads Inkscape layers, inherited styles and mm-based viewBox", () => {
    const { doc, dropped, native } = parseSvg(inkscape);
    expect(native).toBe(false);
    expect(doc.artboard).toEqual({ w: 210, h: 297, background: null });
    expect(doc.layers.map((l) => [l.name, l.visible, l.locked])).toEqual([
      ["Background", true, true],
      ["Shapes", true, false],
      ["Hidden", false, false],
    ]);
    const [circle, path] = doc.layers[1].children as Shape[];
    expect(circle).toMatchObject({ kind: "ellipse", cx: 50, cy: 50, rx: 20, ry: 20 });
    expect(circle.style.fill).toEqual({ color: "#0000ff", opacity: 0.5 });
    expect(circle.style.stroke).toEqual({ color: "#000000", opacity: 1 });
    expect(circle.style.strokeWidth).toBe(2);
    expect(path.kind).toBe("path");
    expect(path.style.fill).toEqual({ color: "#ff0000", opacity: 1 });
    expect(path.style.join).toBe("round");
    expect((path as PathShape).subpaths[0].closed).toBe(true);
    expect(doc.layers[2].children).toHaveLength(1);
    expect(dropped).toEqual(["<text>"]);
  });

  it("reads a flat Figma export with gradients dropped", () => {
    const { doc, dropped, native } = parseSvg(figma);
    expect(native).toBe(false);
    expect(doc.layers).toHaveLength(1);
    const [rect, line, poly] = doc.layers[0].children as Shape[];
    expect(rect).toMatchObject({ kind: "rect", x: 4, y: 4, w: 56, h: 56, rx: 12 });
    expect(rect.style.fill).toBeNull();
    expect(line.style.stroke).toEqual({ color: "#ffffff", opacity: 1 });
    expect(line.style.fill).toBeNull(); // inherited fill="none" from <svg>
    expect(line.style.cap).toBe("round");
    expect(poly.kind).toBe("path");
    expect((poly as PathShape).subpaths[0].nodes).toHaveLength(3);
    expect((poly as PathShape).subpaths[0].closed).toBe(true);
    expect(poly.style.fill).toEqual({ color: "#ffcc00", opacity: 1 });
    expect(dropped).toEqual(["gradients/patterns"]);
  });

  it("offsets a viewBox origin, converts unequal radii and reports classes", () => {
    const { doc, dropped, native } = parseSvg(illustrator);
    expect(native).toBe(false);
    expect(doc.artboard).toEqual({ w: 100, h: 50, background: null });
    const [rect, line, rounded] = doc.layers[0].children as Shape[];
    expect(rect.transform).toEqual([1, 0, 0, 1, -10, -20]);
    expect(rect.style.fill).toEqual({ color: "#000000", opacity: 1 }); // class ignored → default
    expect(line.kind).toBe("path");
    expect(rounded.kind).toBe("path");
    expect((rounded as PathShape).subpaths[0].nodes).toHaveLength(8);
    expect(dropped).toEqual(["CSS stylesheets", "CSS classes"]);
  });

  it("hides a top-level group with visibility, and reads a styled background", () => {
    const hidden = parseSvg(`<svg><g visibility="hidden"><rect width="10" height="10"/></g></svg>`);
    expect(hidden.doc.layers[0].visible).toBe(false);
    expect(hidden.dropped).toEqual([]);
    const styled = parseSvg(
      `<svg data-sv-version="1" width="10" height="10" viewBox="0 0 10 10">` +
        `<rect data-sv-background="" width="10" height="10" style="fill:#010203;fill-opacity:0.5"/>` +
        `<g data-sv-layer="" data-sv-name="Layer 1"/></svg>`,
    );
    expect(styled.doc.artboard.background).toEqual({ color: "#010203", opacity: 0.5 });
  });

  it("keeps a presentation color when the style value does not parse", () => {
    const { doc } = parseSvg(
      `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="blue" style="fill:red !important"/></svg>`,
    );
    expect((doc.layers[0].children[0] as Shape).style.fill!.color).toBe("#ff0000");
    const kept = parseSvg(
      `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="blue" style="fill:not-a-color"/></svg>`,
    );
    expect((kept.doc.layers[0].children[0] as Shape).style.fill!.color).toBe("#0000ff");
  });

  it("reports a style visibility override and not one under display:none", () => {
    const styled = parseSvg(
      `<svg><g visibility="hidden"><rect width="5" height="5" style="visibility:visible"/></g></svg>`,
    );
    expect(styled.dropped).toContain("nested visibility override");
    const displayed = parseSvg(
      `<svg><g display="none"><rect width="5" height="5" visibility="visible"/></g></svg>`,
    );
    expect(displayed.dropped).not.toContain("nested visibility override");
  });

  it("multiplies color alpha into opacity and honors style over attributes", () => {
    const { doc } = parseSvg(
      `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="blue" style="fill:#ff000080" fill-opacity="0.5"/></svg>`,
    );
    const [rect] = doc.layers[0].children as Shape[];
    expect(rect.style.fill!.color).toBe("#ff0000");
    expect(rect.style.fill!.opacity).toBeCloseTo(0.25, 2);
  });

  it("skips empty and zero-size content, but KEEPS hidden content (spec M9 §1)", () => {
    const { doc } = parseSvg(
      `<svg width="10" height="10"><rect width="0" height="5"/><g/><path d=""/>` +
        `<circle r="1" style="display:none"/><g opacity="0.5"><circle r="2"/></g></svg>`,
    );
    // The zero-size rect, the empty group and the node-less path cannot be represented and go.
    // The hidden circle can be, and used to be deleted silently — that was data loss.
    expect(doc.layers[0].children).toHaveLength(2);
    expect(doc.layers[0].children[0]).toMatchObject({ kind: "ellipse", hidden: true });
    expect(doc.layers[0].children[1]).toMatchObject({ kind: "group", opacity: 0.5 });
  });

  it("defaults the artboard to 300 × 150 and always has a layer", () => {
    const { doc } = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"/>`);
    expect(doc.artboard).toEqual({ w: 300, h: 150, background: null });
    expect(doc.layers).toHaveLength(1);
    expect(doc.nextId).toBe(2);
  });

  it("rejects non-SVG and malformed input", () => {
    expect(() => parseSvg("<html></html>")).toThrow(SvgError);
    expect(() => parseSvg("<svg>")).toThrow(XmlError);
  });
});

describe("parseSvg — non-finite numbers and invalid artboards", () => {
  const allFinite = (v: unknown): boolean => {
    if (typeof v === "number") return Number.isFinite(v);
    if (Array.isArray(v)) return v.every(allFinite);
    if (v && typeof v === "object") return Object.values(v).every(allFinite);
    return true;
  };

  it("drops a non-finite polygon point instead of producing Infinity", () => {
    const { doc } = parseSvg(`<svg><polygon points="1e999,2 3,4"/></svg>`);
    expect(doc.layers[0].children).toHaveLength(0);
    expect(allFinite(doc)).toBe(true);
  });

  it("falls back to 300 × 150 for a non-finite viewBox origin", () => {
    const { doc } = parseSvg(`<svg viewBox="-1e999 0 10 10"/>`);
    expect(doc.artboard).toEqual({ w: 300, h: 150, background: null });
    expect(allFinite(doc)).toBe(true);
  });

  it("ignores a non-finite transform argument", () => {
    const { doc } = parseSvg(
      `<svg><rect width="5" height="5" transform="translate(1e999)"/></svg>`,
    );
    const [rect] = doc.layers[0].children as Shape[];
    expect(rect.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(allFinite(doc)).toBe(true);
  });

  it("stops path parsing before a non-finite coordinate", () => {
    const { doc } = parseSvg(`<svg><path d="M 1e999 0 L 1 1"/></svg>`);
    expect(doc.layers[0].children).toHaveLength(0);
    expect(allFinite(doc)).toBe(true);
  });

  it("reports and falls back to 300 × 150 when the viewBox size is non-finite", () => {
    const { doc, dropped } = parseSvg(`<svg viewBox="0 0 1e999 10"/>`);
    expect(doc.artboard).toEqual({ w: 300, h: 150, background: null });
    expect(dropped).toEqual(["invalid artboard size"]);
  });

  it("reports and falls back to 300 × 150 when the viewBox size exceeds the maximum", () => {
    const { doc, dropped } = parseSvg(`<svg viewBox="0 0 250000 180000"/>`);
    expect(doc.artboard).toEqual({ w: 300, h: 150, background: null });
    expect(dropped).toEqual(["invalid artboard size"]);
  });

  it("caps an overflowing coordinate at the fallback instead of Infinity", () => {
    const { doc } = parseSvg(`<svg><rect x="1e305" width="5" height="5"/></svg>`);
    const [rect] = doc.layers[0].children as Shape[];
    expect(rect).toMatchObject({ x: 0 });
    expect(serializeDoc(doc)).not.toMatch(/Infinity|NaN/);
  });

  it("caps an overflowing stroke-width at the inherited value", () => {
    const { doc } = parseSvg(`<svg><rect width="5" height="5" stroke-width="1e305"/></svg>`);
    const [rect] = doc.layers[0].children as Shape[];
    expect(rect.style.strokeWidth).toBe(1);
    expect(serializeDoc(doc)).not.toMatch(/Infinity|NaN/);
  });

  it("ignores an overflowing composed transform", () => {
    const { doc } = parseSvg(
      `<svg><rect width="5" height="5" transform="scale(1e300) scale(1e300)"/></svg>`,
    );
    const [rect] = doc.layers[0].children as Shape[];
    expect(rect.transform).toEqual(IDENTITY);
    expect(serializeDoc(doc)).not.toMatch(/Infinity|NaN/);
  });

  it("uses a valid width/height when the viewBox is invalid", () => {
    const { doc, dropped } = parseSvg(`<svg viewBox="0 0 1e999 10" width="50" height="60"/>`);
    expect(doc.artboard).toEqual({ w: 50, h: 60, background: null });
    expect(dropped).toEqual(["invalid artboard size"]);
  });
});

describe("live polygons", () => {
  const poly: PolygonShape = {
    kind: "polygon",
    id: "p",
    name: "Badge",
    transform: rotateAbout(0.3, { x: 100, y: 0 }),
    style: { ...DEFAULT_STYLE, strokeWidth: 2 },
    cx: 100.1234567,
    cy: -3,
    rx: 33.3333333,
    ry: 12,
    sides: 7,
    star: true,
    innerRatio: 0.37,
  };
  const withPoly = (): Doc => {
    const d = createDoc(300, 200);
    return { ...d, layers: [{ ...d.layers[0], children: [poly] }] };
  };

  it("round-trips a polygon byte for byte", () => {
    const text = serializeDoc(withPoly());
    const back = parseSvg(text);
    expect(back.dropped).toEqual([]);
    const p = back.doc.layers[0].children[0] as PolygonShape;
    expect(p).toMatchObject({
      kind: "polygon",
      name: "Badge",
      cx: 100.123457,
      cy: -3,
      rx: 33.333333,
      ry: 12,
      sides: 7,
      star: true,
      innerRatio: 0.37,
    });
    expect(serializeDoc(back.doc)).toBe(text);
  });

  it("imports an edited outline as a plain path", () => {
    const text = serializeDoc(withPoly()).replace(/ d="[^"]*"/, ' d="M0 0 L10 0 L10 10 Z"');
    const back = parseSvg(text);
    expect(back.dropped).toEqual([]);
    const p = back.doc.layers[0].children[0] as PathShape;
    expect(p.kind).toBe("path");
    expect(p.subpaths[0].nodes.map((n) => n.p)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  /** The saved file with the first `M` x value of the polygon's `d` shifted by `dx`. */
  const nudged = (dx: number): string =>
    serializeDoc(withPoly()).replace(
      / d="M([-+.\de]+)/,
      (_, x: string) => ` d="M${fmt(Number(x) + dx)}`,
    );

  it("reads the written polygon d as one closed subpath without a duplicate last node", () => {
    const sp = parsePathData(polygonD(poly));
    expect(sp).toHaveLength(1);
    expect(sp[0].closed).toBe(true);
    expect(sp[0].nodes).toHaveLength(14);
  });

  it("keeps a polygon whose outline differs by float noise", () => {
    const text = nudged(1e-6);
    expect(text).not.toBe(serializeDoc(withPoly()));
    const back = parseSvg(text);
    expect(back.dropped).toEqual([]);
    expect(back.doc.layers[0].children[0].kind).toBe("polygon");
  });

  it("imports an outline moved by more than the tolerance as a path", () => {
    const back = parseSvg(nudged(1e-4));
    expect(back.dropped).toEqual([]);
    expect(back.doc.layers[0].children[0].kind).toBe("path");
  });

  it("imports an outline with an extra node as a path", () => {
    const text = serializeDoc(withPoly()).replace(/ Z"/, ' L0 0 Z"');
    expect(text).toContain(' L0 0 Z"');
    const back = parseSvg(text);
    expect(back.dropped).toEqual([]);
    expect(back.doc.layers[0].children[0].kind).toBe("path");
  });

  it("stores the polygon parameters as a save would write them", () => {
    const d = polygonD({ cx: 1, cy: 0, rx: 10, ry: 10, sides: 5, star: false, innerRatio: 0.5 });
    const back = parseSvg(
      `<svg><path d="${d}" data-sv-polygon="5 0 0.5 1.0000001 0 10 10"/></svg>`,
    );
    const p = back.doc.layers[0].children[0] as PolygonShape;
    expect(p.kind).toBe("polygon");
    expect(p.cx).toBe(1);
  });

  it("imports a path with an invalid polygon attribute as a path", () => {
    const d = polygonD({ cx: 0, cy: 0, rx: 10, ry: 10, sides: 5, star: false, innerRatio: 0.5 });
    const back = parseSvg(`<svg><path d="${d}" data-sv-polygon="5 0 0.5 0 0 10 -10"/></svg>`);
    expect(back.doc.layers[0].children[0].kind).toBe("path");
    expect(back.dropped).toEqual([]);
  });

  it("validates the polygon attribute", () => {
    expect(parsePolygonAttr(" 5 1 0.5 1 -2 10 20 ")).toEqual({
      sides: 5,
      star: true,
      innerRatio: 0.5,
      cx: 1,
      cy: -2,
      rx: 10,
      ry: 20,
    });
    for (const bad of [
      "",
      "5 0 0.5 0 0 10",
      "5 0 0.5 0 0 10 10 1",
      "2 0 0.5 0 0 10 10",
      "33 0 0.5 0 0 10 10",
      "5.5 0 0.5 0 0 10 10",
      "5 2 0.5 0 0 10 10",
      "5 0 0.05 0 0 10 10",
      "5 0 0.99 0 0 10 10",
      "5 0 0.5 2e9 0 10 10",
      "5 0 0.5 0 0 0 10",
      "5 0 0.5 0 0 10 2e9",
      "5 0 0.5 0 0 10 NaN",
      "5 0 0.5 0 0 10 abc",
      "0x5 0 0.5 0 0 10 10",
      "5 0 0.5 0 0 10 1e1x",
      "5 0 0.5 0 0 10\u00a010",
      "5 0 0.5 0 0 10 10\u00a0",
      "5 0 0.5 0 0 0.0000001 10",
    ]) {
      expect(parsePolygonAttr(bad), bad).toBeNull();
    }
  });
});

describe("closing a path after a save round trip", () => {
  it("merges a last node that rounding left a hair away from the first", () => {
    const d = "M 0 0 L 10 0 L 10 10 L 0.0000004 0.0000003 Z";
    const [sp] = parsePathData(d);
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(3);
    const far = parsePathData("M 0 0 L 10 0 L 10 10 L 0.001 0.001 Z")[0];
    expect(far.nodes).toHaveLength(4);
  });
});
