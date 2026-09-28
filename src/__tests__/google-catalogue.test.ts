import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  GF_PREFIX,
  familyDir,
  familyIdOf,
  googleFontId,
  loadCatalogue,
  searchFamilies,
  weightName,
  type GoogleFamily,
} from "../text/google-catalogue";
import catalogue from "../text/google-fonts.json";

const roboto: GoogleFamily = {
  id: "roboto",
  family: "Roboto",
  category: "sans-serif",
  license: "OFL-1.1",
  weights: [400, 700],
  italic: true,
  variable: true,
};

const lora: GoogleFamily = {
  id: "lora",
  family: "Lora",
  category: "serif",
  license: "OFL-1.1",
  weights: [400, 700],
  italic: false,
  variable: true,
};

const notoSans: GoogleFamily = {
  id: "noto-sans",
  family: "Noto Sans",
  category: "sans-serif",
  license: "OFL-1.1",
  weights: [400],
  italic: false,
  variable: false,
};

const architectsDaughter: GoogleFamily = {
  id: "architects-daughter",
  family: "Architects Daughter",
  category: "handwriting",
  license: "Apache-2.0",
  weights: [400],
  italic: false,
  variable: false,
};

const ubuntu: GoogleFamily = {
  id: "ubuntu",
  family: "Ubuntu",
  category: "sans-serif",
  license: "UFL-1.0",
  weights: [400, 700],
  italic: true,
  variable: false,
};

const zilla: GoogleFamily = {
  id: "zilla-slab",
  family: "Zilla Slab",
  category: "serif",
  license: "OFL-1.1",
  weights: [400],
  italic: false,
  variable: false,
};

const oldStandard: GoogleFamily = {
  id: "old-standard-tt",
  family: "Old Standard TT",
  category: "serif",
  license: "OFL-1.1",
  weights: [400],
  italic: false,
  variable: false,
};

const all = [roboto, lora, notoSans, architectsDaughter, ubuntu, zilla, oldStandard];

describe("googleFontId / familyIdOf", () => {
  it("prefixes the fontsource id with gf:", () => {
    expect(googleFontId(roboto)).toBe("gf:roboto");
    expect(GF_PREFIX).toBe("gf:");
  });

  it("recovers the fontsource id from a gf: font id", () => {
    expect(familyIdOf("gf:roboto")).toBe("roboto");
  });

  it("returns null for a font id that isn't a Google Fonts id", () => {
    expect(familyIdOf("anton")).toBeNull();
    expect(familyIdOf("file:Some Font")).toBeNull();
  });
});

describe("familyDir", () => {
  it("maps OFL to the ofl/ folder", () => {
    expect(familyDir(roboto)).toBe("ofl/roboto");
  });

  it("maps Apache-2.0 to the apache/ folder", () => {
    expect(familyDir(architectsDaughter)).toBe("apache/architectsdaughter");
  });

  it("maps UFL-1.0 to the ufl/ folder", () => {
    expect(familyDir(ubuntu)).toBe("ufl/ubuntu");
  });

  it("strips hyphens from a multi-word id", () => {
    expect(familyDir(zilla)).toBe("ofl/zillaslab");
    expect(familyDir(oldStandard)).toBe("ofl/oldstandardtt");
  });
});

describe("searchFamilies", () => {
  it("matches a substring of the family name, case-insensitively", () => {
    expect(searchFamilies(all, "rob", null)).toEqual([roboto]);
    expect(searchFamilies(all, "ROB", null)).toEqual([roboto]);
    expect(searchFamilies(all, "obot", null)).toEqual([roboto]);
  });

  it("is accent-insensitive", () => {
    const zaza: GoogleFamily = {
      id: "zaza",
      family: "Zázä",
      category: "display",
      license: "OFL-1.1",
      weights: [400],
      italic: false,
      variable: false,
    };
    expect(searchFamilies([...all, zaza], "zaza", null)).toEqual([zaza]);
    expect(searchFamilies([...all, zaza], "zázä", null)).toEqual([zaza]);
  });

  it("filters by category exactly", () => {
    expect(searchFamilies(all, "", "serif")).toEqual([lora, zilla, oldStandard]);
    expect(searchFamilies(all, "", "handwriting")).toEqual([architectsDaughter]);
  });

  it("combines a query with a category filter", () => {
    expect(searchFamilies(all, "s", "serif")).toEqual([zilla, oldStandard]);
  });

  it("returns everything, in the input's order, for an empty query and no category", () => {
    expect(searchFamilies(all, "", null)).toEqual(all);
  });
});

describe("weightName", () => {
  it("names every standard weight", () => {
    expect(weightName(100)).toBe("Thin");
    expect(weightName(200)).toBe("Extra Light");
    expect(weightName(300)).toBe("Light");
    expect(weightName(400)).toBe("Regular");
    expect(weightName(500)).toBe("Medium");
    expect(weightName(600)).toBe("Semi Bold");
    expect(weightName(700)).toBe("Bold");
    expect(weightName(800)).toBe("Extra Bold");
    expect(weightName(900)).toBe("Black");
  });

  it("falls back to the number for anything else", () => {
    expect(weightName(450)).toBe("450");
    expect(weightName(1000)).toBe("1000");
  });
});

describe("CATEGORIES", () => {
  it("lists All plus the five Google Fonts categories, in order", () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([
      null,
      "sans-serif",
      "serif",
      "display",
      "handwriting",
      "monospace",
    ]);
  });
});

describe("loadCatalogue", () => {
  it("resolves the committed JSON, caching the promise", async () => {
    const a = await loadCatalogue();
    const b = await loadCatalogue();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("the committed google-fonts.json snapshot", () => {
  const families = catalogue as GoogleFamily[];
  const knownLicences = new Set(["OFL-1.1", "Apache-2.0", "UFL-1.0"]);

  it("has at least 1500 families", () => {
    expect(families.length).toBeGreaterThanOrEqual(1500);
  });

  it("gives every family a known licence and at least one weight", () => {
    for (const f of families) {
      expect(knownLicences.has(f.license)).toBe(true);
      expect(f.weights.length).toBeGreaterThan(0);
      expect(f.id.length).toBeGreaterThan(0);
      expect(f.family.length).toBeGreaterThan(0);
    }
  });
});
