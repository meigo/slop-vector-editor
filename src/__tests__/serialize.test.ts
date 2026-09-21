import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Shape } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { layerAttrs, polygonD, shapeAttrs, styleAttrs } from "../svg/attrs";
import { parseSvg } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";

describe("styleAttrs", () => {
  it("writes the default style compactly", () => {
    expect(styleAttrs(DEFAULT_STYLE)).toEqual({
      fill: "#d9d9d9",
      stroke: "#000000",
      "stroke-width": "1",
    });
  });

  it("writes none, opacities and non-default caps", () => {
    expect(
      styleAttrs({
        fill: null,
        stroke: { color: "#ff0000", opacity: 0.5 },
        strokeWidth: 2.5,
        cap: "round",
        join: "bevel",
        opacity: 0.25,
      }),
    ).toEqual({
      fill: "none",
      stroke: "#ff0000",
      "stroke-opacity": "0.5",
      "stroke-width": "2.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "bevel",
      opacity: "0.25",
    });
  });

  it("keeps stroke width and caps when stroke is none", () => {
    const a = styleAttrs({ ...DEFAULT_STYLE, stroke: null, strokeWidth: 3, cap: "square" });
    expect(a.stroke).toBeUndefined();
    expect(a["stroke-width"]).toBe("3");
    expect(a["stroke-linecap"]).toBe("square");
  });
});

describe("shapeAttrs", () => {
  it("writes a rect with transform and name", () => {
    const s: Shape = {
      kind: "rect",
      id: "n2",
      name: "Box",
      transform: [1, 0, 0, 1, 5, 6],
      style: DEFAULT_STYLE,
      x: 0,
      y: 0,
      w: 10,
      h: 20,
      rx: 0,
    };
    expect(shapeAttrs(s)).toEqual({
      tag: "rect",
      attrs: {
        x: "0",
        y: "0",
        width: "10",
        height: "20",
        transform: "matrix(1 0 0 1 5 6)",
        "data-sv-name": "Box",
        fill: "#d9d9d9",
        stroke: "#000000",
        "stroke-width": "1",
      },
    });
  });

  it("writes a path with d and node codes", () => {
    const s: Shape = {
      kind: "path",
      id: "n3",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      subpaths: [
        {
          nodes: [
            { p: { x: 0, y: 0 }, in: null, out: null, type: "corner" },
            { p: { x: 1, y: 1 }, in: null, out: null, type: "corner" },
          ],
          closed: false,
        },
      ],
    };
    const { tag, attrs } = shapeAttrs(s);
    expect(tag).toBe("path");
    expect(attrs.d).toBe("M0 0 L1 1");
    expect(attrs["data-sv-nodes"]).toBe("cc");
    expect(attrs.transform).toBeUndefined();
  });
});

describe("polygon attributes", () => {
  it("writes a polygon as a path with its parameters", () => {
    const s: Shape = {
      kind: "polygon",
      id: "p",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      cx: 10,
      cy: 20,
      rx: 5,
      ry: 5,
      sides: 4,
      star: false,
      innerRatio: 0.5,
    };
    expect(shapeAttrs(s)).toEqual({
      tag: "path",
      attrs: {
        d: "M10 15 L15 20 L10 25 L5 20 Z",
        "data-sv-nodes": "cccc",
        "data-sv-polygon": "4 0 0.5 10 20 5 5",
        fill: "#d9d9d9",
        stroke: "#000000",
        "stroke-width": "1",
      },
    });
  });

  it("builds d from the rounded numbers it writes", () => {
    const s: Shape = {
      kind: "polygon",
      id: "p",
      transform: IDENTITY,
      style: DEFAULT_STYLE,
      cx: 0.12345678,
      cy: 0,
      rx: 33.3333333,
      ry: 33.3333333,
      sides: 3,
      star: false,
      innerRatio: 0.5,
    };
    const { attrs } = shapeAttrs(s);
    expect(attrs["data-sv-polygon"]).toBe("3 0 0.5 0.123457 0 33.333333 33.333333");
    expect(attrs.d).toBe(
      polygonD({
        cx: 0.123457,
        cy: 0,
        rx: 33.333333,
        ry: 33.333333,
        sides: 3,
        star: false,
        innerRatio: 0.5,
      }),
    );
  });
});

describe("layerAttrs", () => {
  it("marks hidden and locked layers", () => {
    expect(layerAttrs({ id: "n1", name: "A", visible: false, locked: true, children: [] })).toEqual(
      {
        "data-sv-layer": "",
        "data-sv-name": "A",
        "data-sv-locked": "",
        display: "none",
      },
    );
  });
});

describe("serializeDoc", () => {
  it("writes an empty document", () => {
    expect(serializeDoc(createDoc(100, 50))).toBe(
      [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50" data-sv-version="1">`,
        `  <rect data-sv-background="" x="0" y="0" width="100" height="50" fill="#ffffff"/>`,
        `  <g data-sv-layer="" data-sv-name="Layer 1"/>`,
        `</svg>`,
        ``,
      ].join("\n"),
    );
  });

  it("nests groups, escapes names and omits a null background", () => {
    const base = createDoc(10, 10);
    const doc: Doc = {
      ...base,
      artboard: { ...base.artboard, background: null },
      layers: [
        {
          ...base.layers[0],
          name: `A & "B" <C>`,
          children: [
            {
              kind: "group",
              id: "n2",
              transform: IDENTITY,
              opacity: 0.5,
              children: [
                {
                  kind: "ellipse",
                  id: "n3",
                  transform: IDENTITY,
                  style: DEFAULT_STYLE,
                  cx: 1,
                  cy: 2,
                  rx: 3,
                  ry: 4,
                },
              ],
            },
          ],
        },
      ],
    };
    const out = serializeDoc(doc);
    expect(out).not.toContain("data-sv-background");
    expect(out).toContain(`data-sv-name="A &amp; &quot;B&quot; &lt;C&gt;"`);
    expect(out).toContain(
      [
        `  <g data-sv-layer="" data-sv-name="A &amp; &quot;B&quot; &lt;C&gt;">`,
        `    <g opacity="0.5">`,
        `      <ellipse cx="1" cy="2" rx="3" ry="4" fill="#d9d9d9" stroke="#000000" stroke-width="1"/>`,
        `    </g>`,
        `  </g>`,
      ].join("\n"),
    );
  });

  it("escapes control characters in attribute values so the file stays well-formed XML", () => {
    const base = createDoc(10, 10);
    const doc: Doc = {
      ...base,
      layers: [{ ...base.layers[0], name: "a\nbc" }],
    };
    const out = serializeDoc(doc);
    expect(out).toContain(`data-sv-name="a&#10;bc"`);
    const { doc: back } = parseSvg(out);
    expect(back.layers[0].name).toBe("a\nbc");
  });
});

describe("name sanitising", () => {
  it("drops code points XML forbids from names", () => {
    const d = createDoc(10, 10);
    const bad: Doc = {
      ...d,
      layers: [{ ...d.layers[0], name: "A\uFFFEB\uFFFF\uD800C\uDC00D\uD83D\uDE00" }],
    };
    expect(serializeDoc(bad)).toContain('data-sv-name="ABCD\uD83D\uDE00"');
  });
});

describe("serializeDoc with a view", () => {
  it("writes the artboard's own box when no view is given", () => {
    const svg = serializeDoc(createDoc(400, 300));
    expect(svg).toContain('width="400"');
    expect(svg).toContain('height="300"');
    expect(svg).toContain('viewBox="0 0 400 300"');
  });

  it("writes the given box as width, height and viewBox", () => {
    const svg = serializeDoc(createDoc(400, 300), { x: 200, y: 100, w: 80, h: 60 });
    expect(svg).toContain('width="80"');
    expect(svg).toContain('height="60"');
    expect(svg).toContain('viewBox="200 100 80 60"');
  });

  it("leaves everything but the root untouched, so a view only re-aims the camera", () => {
    const doc = createDoc(400, 300);
    const plain = serializeDoc(doc);
    const aimed = serializeDoc(doc, { x: 10, y: 20, w: 30, h: 40 });
    const body = (s: string) => s.split("\n").slice(2).join("\n");
    expect(body(aimed)).toBe(body(plain));
  });

  it("rounds a fractional box through fmt, as every other coordinate is", () => {
    const svg = serializeDoc(createDoc(400, 300), { x: 1.5, y: 2.25, w: 10.125, h: 20 });
    expect(svg).toContain('viewBox="1.5 2.25 10.125 20"');
  });
});
