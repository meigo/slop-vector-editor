import { describe, expect, it } from "vitest";
import figma from "../../fixtures/figma-flat.svg?raw";
import illustrator from "../../fixtures/illustrator-classes.svg?raw";
import inkscape from "../../fixtures/inkscape-layers.svg?raw";
import {
  createDoc,
  DEFAULT_STYLE,
  isGradient,
  type Doc,
  type Fill,
  type Paint,
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

/** Asserts a fill is flat; used only where the input has no gradient (the figma fixture below has
 *  a radial one, which Task 2 now resolves instead of dropping). */
function flatFill(f: Fill | null): Paint {
  if (f === null || isGradient(f)) throw new Error("expected a flat paint");
  return f;
}

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

  it("reads a flat Figma export, resolving its radial gradient fill", () => {
    const { doc, dropped, native } = parseSvg(figma);
    expect(native).toBe(false);
    expect(doc.layers).toHaveLength(1);
    const [rect, line, poly] = doc.layers[0].children as Shape[];
    expect(rect).toMatchObject({ kind: "rect", x: 4, y: 4, w: 56, h: 56, rx: 12 });
    expect(rect.style.fill).toEqual({
      kind: "radial",
      center: { x: 32, y: 32 },
      a: { x: 60, y: 32 },
      b: { x: 32, y: 60 },
      start: { color: "#5b8cff", opacity: 1 },
      end: { color: "#7aa3ff", opacity: 1 },
    });
    expect(line.style.stroke).toEqual({ color: "#ffffff", opacity: 1 });
    expect(line.style.fill).toBeNull(); // inherited fill="none" from <svg>
    expect(line.style.cap).toBe("round");
    expect(poly.kind).toBe("path");
    expect((poly as PathShape).subpaths[0].nodes).toHaveLength(3);
    expect((poly as PathShape).subpaths[0].closed).toBe(true);
    expect(poly.style.fill).toEqual({ color: "#ffcc00", opacity: 1 });
    expect(dropped).toEqual([]);
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
    expect(flatFill((doc.layers[0].children[0] as Shape).style.fill).color).toBe("#ff0000");
    const kept = parseSvg(
      `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="blue" style="fill:not-a-color"/></svg>`,
    );
    expect(flatFill((kept.doc.layers[0].children[0] as Shape).style.fill).color).toBe("#0000ff");
  });

  it("reports an external paint reference by its own label (review finding 10)", () => {
    const { doc, dropped } = parseSvg(
      `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="url(other.svg#g)"/></svg>`,
    );
    expect((doc.layers[0].children[0] as Shape).style.fill).toBeNull();
    expect(dropped).toEqual(["external paint references"]);
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
    expect(flatFill(rect.style.fill).color).toBe("#ff0000");
    expect(flatFill(rect.style.fill).opacity).toBeCloseTo(0.25, 2);
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

/** Review H2 (2026-09-30): properties the model can't draw were ignored with `dropped` empty, so a
 *  file of ours edited elsewhere kept its save-in-place handle and ⌘S wrote them away. */
describe("properties the model can't represent", () => {
  const one = (attrs: string) =>
    parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" data-sv-version="1">
      <path d="M0 0L10 0L10 10Z" ${attrs}/></svg>`);

  it("reports each by name, as an attribute or in style", () => {
    expect(one(`fill-rule="evenodd"`).dropped).toEqual(["even-odd fill"]);
    expect(one(`style="fill-rule: evenodd"`).dropped).toEqual(["even-odd fill"]);
    expect(one(`stroke-dasharray="4 2"`).dropped).toEqual(["dashed strokes"]);
    expect(one(`marker-end="url(#a)"`).dropped).toEqual(["markers"]);
    expect(one(`style="marker: url(#a)"`).dropped).toEqual(["markers"]);
    expect(one(`transform-origin="5 5"`).dropped).toEqual(["transform-origin"]);
    expect(one(`style="transform: rotate(45deg)"`).dropped).toEqual(["CSS transforms"]);
  });

  it("stays quiet about the defaults, which draw the same", () => {
    for (const a of [
      `fill-rule="nonzero"`,
      `stroke-dasharray="none"`,
      `marker-start="none"`,
      `transform-origin="0 0"`,
      `style="transform: none"`,
    ]) {
      expect(one(a).dropped).toEqual([]);
    }
  });

  it("counts on a group too, since fill-rule and markers inherit", () => {
    const r = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
      <g fill-rule="evenodd"><rect width="5" height="5"/></g></svg>`);
    expect(r.dropped).toEqual(["even-odd fill"]);
  });
});

/** Review M11 (2026-09-30): our own file with a layer transform or opacity added elsewhere (Inkscape
 *  writes layer opacity) lost both on import, with the save-in-place handle kept. */
it("keeps an own-format layer's transform and opacity in a group, as for a foreign file", () => {
  const r =
    parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" data-sv-version="1">
    <g data-sv-layer="" data-sv-name="A" opacity="0.5" transform="translate(3 4)">
      <rect width="5" height="5"/></g></svg>`);
  const [g] = r.doc.layers[0].children;
  expect(r.doc.layers[0].name).toBe("A");
  expect(g.kind).toBe("group");
  expect(g.kind === "group" && g.opacity).toBe(0.5);
  expect(g.transform).toEqual([1, 0, 0, 1, 3, 4]);
  expect(r.dropped).toEqual([]);
});

/** Review M13 (2026-09-30): `<switch>` was an unknown element, so an Illustrator or draw.io file
 *  whose whole drawing sits in one imported empty — while a browser renders it. */
describe("<switch>", () => {
  it("renders its first child whose conditions pass, as a browser does", () => {
    const r = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
      <switch opacity="0.5">
        <foreignObject requiredExtensions="http://ns.adobe.com/AdobeIllustrator/10.0/"/>
        <g><rect width="5" height="5"/></g>
        <rect width="9" height="9"/>
      </switch></svg>`);
    expect(r.dropped).toEqual([]);
    const [sw] = r.doc.layers[0].children;
    expect(sw.kind).toBe("group");
    if (sw.kind !== "group") return;
    expect(sw.opacity).toBe(0.5);
    expect(sw.children).toHaveLength(1);
    expect(sw.children[0].kind).toBe("group");
  });

  it("an empty requiredExtensions fails too, and no passing child imports nothing", () => {
    const r = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
      <switch><rect requiredExtensions="" width="5" height="5"/></switch></svg>`);
    expect(r.doc.layers[0].children).toEqual([]);
    expect(r.dropped).toEqual([]);
  });
});

/** Review L10 (2026-09-30): `currentColor` was always black; it is the inherited `color`. */
it("resolves currentColor through the inherited color property", () => {
  const r = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
    <g color="#ff0000"><rect width="5" height="5" fill="currentColor" style="color: blue"/>
    <rect width="5" height="5" stroke="currentColor"/></g>
    <rect width="5" height="5" fill="currentColor"/></svg>`);
  const [g, top] = r.doc.layers[0].children;
  if (g.kind !== "group") throw new Error("group expected");
  expect(g.children[0].kind !== "group" && g.children[0].style.fill).toEqual({
    color: "#0000ff",
    opacity: 1,
  });
  expect(g.children[1].kind !== "group" && g.children[1].style.stroke).toEqual({
    color: "#ff0000",
    opacity: 1,
  });
  expect(top.kind !== "group" && top.style.fill).toEqual({ color: "#000000", opacity: 1 });
});

describe("review L11-L13 (2026-09-30)", () => {
  const svg = (body: string) =>
    parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${body}</svg>`);

  it("L11: reports a shape length in CSS units or a percentage; px and bare numbers are fine", () => {
    expect(svg(`<rect width="5mm" height="5"/>`).dropped).toEqual(["lengths in CSS units"]);
    expect(svg(`<circle r="10%"/>`).dropped).toEqual(["lengths in CSS units"]);
    expect(svg(`<rect width="5px" height="5" x="1e2"/>`).dropped).toEqual([]);
  });

  it("L12: a path whose relative steps add up past the limit is dropped and reported", () => {
    const r = svg(`<path d="M0 0 l9e8 0 l9e8 0"/>`);
    expect(r.doc.layers[0].children).toEqual([]);
    expect(r.dropped).toEqual(["invalid coordinates"]);
    expect(svg(`<rect width="2e9" height="5"/>`).dropped).toEqual(["invalid coordinates"]);
  });

  it("L13: drops 1-node subpaths and merges a polygon's repeated closing point", () => {
    const [p] = svg(`<path d="M0 0 L5 0 M7 7"/>`).doc.layers[0].children;
    expect(p.kind === "path" && p.subpaths.map((s) => s.nodes.length)).toEqual([2]);
    expect(svg(`<path d="M3 3"/>`).doc.layers[0].children).toEqual([]);
    const [g] = svg(`<polygon points="0,0 10,0 10,10 0,0"/>`).doc.layers[0].children;
    expect(g.kind === "path" && g.subpaths[0].nodes).toHaveLength(3);
  });
});
