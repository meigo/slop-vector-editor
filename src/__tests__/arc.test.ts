import { describe, expect, it } from "vitest";
import { arcToCubics } from "../svg/arc";
import { fmt } from "../svg/fmt";

describe("fmt", () => {
  it("rounds to 6 decimals and drops negative zero", () => {
    expect(fmt(0.1 + 0.2)).toBe("0.3");
    expect(fmt(-0.0000001)).toBe("0");
    expect(fmt(12.3456789)).toBe("12.345679");
    expect(fmt(-4)).toBe("-4");
  });
});

describe("arcToCubics", () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 2, y: 0 };

  it("sweep=1 semicircle passes above the chord (y-down space)", () => {
    const segs = arcToCubics(p0, 1, 1, 0, false, true, p1);
    expect(segs).toHaveLength(2);
    expect(segs[0][2].x).toBeCloseTo(1);
    expect(segs[0][2].y).toBeCloseTo(-1);
    expect(segs[1][2]).toEqual(p1);
  });

  it("sweep=0 semicircle passes below the chord", () => {
    const segs = arcToCubics(p0, 1, 1, 0, false, false, p1);
    expect(segs[0][2].y).toBeCloseTo(1);
  });

  it("scales radii up when they are too small to reach", () => {
    const segs = arcToCubics(p0, 0.5, 0.5, 0, false, true, p1);
    expect(segs[0][2].x).toBeCloseTo(1);
    expect(segs[0][2].y).toBeCloseTo(-1);
  });

  it("control points approximate a circle (quarter-circle kappa)", () => {
    const [first] = arcToCubics(p0, 1, 1, 0, false, true, p1);
    // Quarter from angle π to 3π/2 around (1,0): c1 = p0 + k·(0,-1), k ≈ 0.5523
    expect(first[0].x).toBeCloseTo(0);
    expect(first[0].y).toBeCloseTo(-0.5523, 3);
  });

  it("large-arc chooses the long way round", () => {
    const segs = arcToCubics({ x: 0, y: 0 }, 1, 1, 0, true, true, { x: 1, y: 1 });
    expect(segs.length).toBeGreaterThanOrEqual(3);
    expect(segs[segs.length - 1][2]).toEqual({ x: 1, y: 1 });
  });

  it("handles degenerate input", () => {
    expect(arcToCubics(p0, 1, 1, 0, false, true, p0)).toEqual([]);
    expect(arcToCubics(p0, 0, 1, 0, false, true, p1)).toEqual([[p0, p1, p1]]);
  });
});
