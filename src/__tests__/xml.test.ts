import { describe, expect, it } from "vitest";
import { parseXml, XmlError } from "../svg/xml";

describe("parseXml", () => {
  it("parses nested elements and attributes with both quote styles", () => {
    const root = parseXml(`<svg a="1" b='two'><g><rect x="0"/></g><path d="M0 0"></path></svg>`);
    expect(root.name).toBe("svg");
    expect(root.attrs).toEqual({ a: "1", b: "two" });
    expect(root.children.map((c) => c.name)).toEqual(["g", "path"]);
    expect(root.children[0].children[0]).toEqual({
      name: "rect",
      attrs: { x: "0" },
      children: [],
      text: "",
    });
  });

  it("skips the prolog, doctype (with internal subset), comments and PIs", () => {
    const root = parseXml(`<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [ <!ENTITY e "v"> ]>
<!-- hello > world -->
<svg><?pi data?><!-- <g/> --><g/></svg>`);
    expect(root.children.map((c) => c.name)).toEqual(["g"]);
  });

  it("decodes entities in attributes and text, and keeps CDATA raw", () => {
    const root = parseXml(
      `<svg t="a &amp; b &lt;c&gt; &quot;&apos; &#65;&#x42;"><style>x &gt; y<![CDATA[ a < b ]]></style></svg>`,
    );
    expect(root.attrs.t).toBe(`a & b <c> "' AB`);
    expect(root.children[0].text).toBe("x > y a < b ");
  });

  it("keeps namespaced names and tolerates whitespace around =", () => {
    const root = parseXml(`<svg xmlns:inkscape="ns"><g inkscape:label = "L1" /></svg>`);
    expect(root.children[0].attrs["inkscape:label"]).toBe("L1");
  });

  it("throws XmlError on malformed input", () => {
    expect(() => parseXml("<svg><g></svg>")).toThrow(XmlError);
    expect(() => parseXml("<svg>")).toThrow(XmlError);
    expect(() => parseXml("just text")).toThrow(XmlError);
    expect(() => parseXml("<a/><b/>")).toThrow(XmlError);
    expect(() => parseXml(`<svg a="1></svg>`)).toThrow(XmlError);
    expect(() => parseXml("<svg><!-- open</svg>")).toThrow(XmlError);
  });

  it("throws XmlError instead of RangeError for an out-of-range numeric character reference", () => {
    expect(() => parseXml('<svg><g id="&#x110000;"/></svg>')).toThrow(XmlError);
  });

  it("throws XmlError for a character reference to a code point XML 1.0 forbids", () => {
    expect(() => parseXml('<a b="&#1;"/>')).toThrow(XmlError);
    expect(() => parseXml('<a b="&#xD800;"/>')).toThrow(XmlError);
  });
});

/** Review L20 (2026-10-17): older Illustrator files ("Style Elements: Entity References") declare
 *  their styles as internal-subset entities and reference them from attributes; the references
 *  stayed literal and every colour was lost, unreported. */
describe("internal-subset entities", () => {
  it("expands a general entity declared in the DOCTYPE, in attributes and text", () => {
    const root = parseXml(`<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x" [
  <!ENTITY st0 "fill:#FF0000;">
  <!ENTITY ns_svg 'http://www.w3.org/2000/svg'>
  <!ENTITY % param "ignored">
]>
<svg xmlns="&ns_svg;"><rect style="&st0;stroke:none"/><text>&st0;</text></svg>`);
    expect(root.attrs.xmlns).toBe("http://www.w3.org/2000/svg");
    expect(root.children[0].attrs.style).toBe("fill:#FF0000;stroke:none");
    expect(root.children[1].text).toBe("fill:#FF0000;");
  });

  it("expands one level only, so a nested reference can't multiply", () => {
    const root = parseXml(`<!DOCTYPE svg [
  <!ENTITY a "x">
  <!ENTITY b "&a;&a;">
]><svg t="&b;"/>`);
    expect(root.attrs.t).toBe("&a;&a;");
  });

  it("leaves an undeclared reference as it was", () => {
    expect(parseXml(`<svg t="&nope;"/>`).attrs.t).toBe("&nope;");
  });
});
