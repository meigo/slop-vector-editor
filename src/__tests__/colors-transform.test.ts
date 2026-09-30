import { describe, expect, it } from "vitest";
import { applyMat, IDENTITY } from "../geom/mat";
import { parseColor } from "../svg/colors";
import { parseTransform, parseTransformOrNull } from "../svg/transform";

describe("parseColor", () => {
  it("parses hex forms", () => {
    expect(parseColor("#ABC")).toEqual({ kind: "color", color: "#aabbcc", alpha: 1 });
    expect(parseColor("#aabbcc80")).toEqual({ kind: "color", color: "#aabbcc", alpha: 128 / 255 });
    expect(parseColor("#f008")).toEqual({ kind: "color", color: "#ff0000", alpha: 136 / 255 });
  });

  it("parses rgb()/rgba() in legacy and modern syntax", () => {
    expect(parseColor("rgb(255, 0, 10)")).toEqual({ kind: "color", color: "#ff000a", alpha: 1 });
    expect(parseColor("rgba(0,0,0,0.5)")).toEqual({ kind: "color", color: "#000000", alpha: 0.5 });
    expect(parseColor("rgb(100% 50% 0% / 25%)")).toEqual({
      kind: "color",
      color: "#ff8000",
      alpha: 0.25,
    });
  });

  /** Review L9 (2026-09-30): these read as "no colour", so the paint fell back to the inherited
   *  one — a green shape came in black. */
  it("parses hsl()/hsla() and hwb(), legacy and modern", () => {
    expect(parseColor("hsl(120, 100%, 25%)")).toEqual({
      kind: "color",
      color: "#008000",
      alpha: 1,
    });
    expect(parseColor("hsla(0 100% 50% / 0.5)")).toEqual({
      kind: "color",
      color: "#ff0000",
      alpha: 0.5,
    });
    expect(parseColor("hsl(0.5turn 100% 50%)")).toEqual({
      kind: "color",
      color: "#00ffff",
      alpha: 1,
    });
    expect(parseColor("hwb(240 0% 0%)")).toEqual({ kind: "color", color: "#0000ff", alpha: 1 });
    expect(parseColor("hwb(0 50% 50%)")).toEqual({ kind: "color", color: "#808080", alpha: 1 });
    expect(parseColor("hsl(nope)")).toBeNull();
  });

  it("parses names, none, currentColor and url()", () => {
    expect(parseColor(" RebeccaPurple ")).toEqual({ kind: "color", color: "#663399", alpha: 1 });
    expect(parseColor("none")).toEqual({ kind: "none" });
    expect(parseColor("transparent")).toEqual({ kind: "none" });
    expect(parseColor("currentColor")).toEqual({ kind: "color", color: "#000000", alpha: 1 });
    // Spec M15 §4: a same-document url() now carries its id and fallback (see the describe block
    // below); only an external reference is still unsupported.
    expect(parseColor("url(#grad)")).toEqual({ kind: "url", id: "grad", fallback: null });
    expect(parseColor("url(#grad) red")).toEqual({
      kind: "url",
      id: "grad",
      fallback: { kind: "color", color: "#ff0000", alpha: 1 },
    });
  });

  it("returns null for unknown values", () => {
    expect(parseColor("inherit")).toBeNull();
    expect(parseColor("#12")).toBeNull();
    expect(parseColor("notacolor")).toBeNull();
  });
});

describe("parseTransform", () => {
  const at = (s: string, x: number, y: number) => applyMat(parseTransform(s), { x, y });

  it("parses each function", () => {
    expect(parseTransform("matrix(1 2 3 4 5 6)")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(at("translate(10)", 0, 0)).toEqual({ x: 10, y: 0 });
    expect(at("translate(10, 5)", 0, 0)).toEqual({ x: 10, y: 5 });
    expect(at("scale(2)", 1, 1)).toEqual({ x: 2, y: 2 });
    expect(at("scale(2 3)", 1, 1)).toEqual({ x: 2, y: 3 });
    const r = at("rotate(90 10 10)", 20, 10);
    expect(r.x).toBeCloseTo(10);
    expect(r.y).toBeCloseTo(20);
    expect(at("skewX(45)", 0, 1).x).toBeCloseTo(1);
    expect(at("skewY(45)", 1, 0).y).toBeCloseTo(1);
  });

  it("composes left to right (the rightmost applies first)", () => {
    expect(at("translate(10,0) scale(2)", 1, 1)).toEqual({ x: 12, y: 2 });
  });

  it("returns identity for empty or invalid input", () => {
    expect(parseTransform("")).toEqual(IDENTITY);
    expect(parseTransform("bogus(1)")).toEqual(IDENTITY);
    expect(parseTransform("matrix(1 2)")).toEqual(IDENTITY);
    expect(parseTransform("translate(1,2) foo(9,9) scale(2)")).toEqual(IDENTITY);
    expect(parseTransform("translate(1,2), scale(2)")).not.toEqual(IDENTITY);
  });

  it("returns identity when an argument is non-finite", () => {
    expect(parseTransform("translate(1e999)")).toEqual(IDENTITY);
  });

  it("returns identity when the composed matrix overflows the coordinate maximum", () => {
    expect(parseTransform("scale(1e300) scale(1e300)")).toEqual(IDENTITY);
  });
});

describe("url() paints and strict transforms (spec M15 §4)", () => {
  it("parses url references with and without a fallback", () => {
    expect(parseColor("url(#g1)")).toEqual({ kind: "url", id: "g1", fallback: null });
    expect(parseColor("url('#g1') #ff0000")).toEqual({
      kind: "url",
      id: "g1",
      fallback: { kind: "color", color: "#ff0000", alpha: 1 },
    });
    expect(parseColor('url("#a b") none')).toEqual({
      kind: "url",
      id: "a b",
      fallback: { kind: "none" },
    });
    expect(parseColor("url(other.svg#g)")).toEqual({ kind: "unsupported" });
  });

  it("tells an unreadable transform list from identity", () => {
    expect(parseTransformOrNull("")).toEqual([1, 0, 0, 1, 0, 0]);
    expect(parseTransformOrNull("translate(3 4)")).toEqual([1, 0, 0, 1, 3, 4]);
    expect(parseTransformOrNull("translate(3 4) wobble(2)")).toBeNull();
    expect(parseTransformOrNull("scale(a)")).toBeNull();
  });
});
