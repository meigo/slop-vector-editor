/** The Google Fonts catalogue (spec M20 §2): a build-time snapshot of Fontsource's API, taken by
 *  `scripts/google-fonts-catalogue.mjs` into `./google-fonts.json` and committed. Nothing here
 *  contacts Fontsource or Google at runtime — `loadCatalogue` only ever reads the committed file,
 *  through a dynamic `import()` so it stays a lazy chunk, fetched only when the Google Fonts
 *  dialog opens. */

export type GoogleFamily = {
  id: string;
  family: string;
  category: string;
  license: "OFL-1.1" | "Apache-2.0" | "UFL-1.0";
  weights: number[];
  italic: boolean;
  variable: boolean;
};

export const GF_PREFIX = "gf:";

export function googleFontId(f: GoogleFamily): string {
  return GF_PREFIX + f.id;
}

/** The fontsource id inside a `gf:` font id, or null when this isn't one — a bundled or
 *  file-added font's id never carries the prefix. */
export function familyIdOf(fontId: string): string | null {
  return fontId.startsWith(GF_PREFIX) ? fontId.slice(GF_PREFIX.length) : null;
}

/** google/fonts' own top-level folders, one per licence (Global Constraints). */
const LICENCE_DIR: Record<GoogleFamily["license"], string> = {
  "OFL-1.1": "ofl",
  "Apache-2.0": "apache",
  "UFL-1.0": "ufl",
};

/** e.g. "ofl/roboto" — the licence folder plus the id with its hyphens stripped, which is how
 *  google/fonts names a family's own directory. */
export function familyDir(f: GoogleFamily): string {
  return `${LICENCE_DIR[f.license]}/${f.id.replace(/-/g, "")}`;
}

/** Case- and accent-insensitive: strips combining marks after NFD decomposition, so "Zázä"
 *  matches "zaza". */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** How well a normalized name matches a normalized query: 0 exact, 1 the name starts with it,
 *  2 a later word starts with it, 3 anywhere else, null no match. */
function matchRank(name: string, q: string): number | null {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  const at = name.indexOf(q);
  if (at < 0) return null;
  // Any occurrence at a word start, not only the first: "Grandiflora Lora" is a word match.
  for (let i = at; i >= 0; i = name.indexOf(q, i + 1)) {
    if (/[^\p{L}\p{N}]/u.test(name[i - 1])) return 2;
  }
  return 3;
}

/** Families whose name contains the query, best matches first — exact, then names starting with
 *  it, then a word starting with it, then anywhere — so "lora" lists Lora ahead of Explora. Stable:
 *  within a group the catalogue's own order holds. */
export function searchFamilies(
  all: readonly GoogleFamily[],
  query: string,
  category: string | null,
): GoogleFamily[] {
  const q = normalize(query.trim());
  const groups: GoogleFamily[][] = [[], [], [], []];
  for (const f of all) {
    if (category !== null && f.category !== category) continue;
    const rank = q === "" ? 0 : matchRank(normalize(f.family), q);
    if (rank !== null) groups[rank].push(f);
  }
  return groups.flat();
}

let cataloguePromise: Promise<readonly GoogleFamily[]> | null = null;

/** Dynamic import of the committed JSON, so it loads only when the dialog opens. The promise is
 *  cached (invariant 37's rule for the paper loader, reused here) and cleared on rejection so a
 *  failed load can be retried rather than replayed from a broken cache. */
export async function loadCatalogue(): Promise<readonly GoogleFamily[]> {
  if (!cataloguePromise) {
    cataloguePromise = import("./google-fonts.json")
      .then((m) => m.default as GoogleFamily[])
      .catch((e: unknown) => {
        cataloguePromise = null;
        throw e;
      });
  }
  return cataloguePromise;
}

export const CATEGORIES: readonly { id: string | null; label: string }[] = [
  { id: null, label: "All" },
  { id: "sans-serif", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "display", label: "Display" },
  { id: "handwriting", label: "Handwriting" },
  { id: "monospace", label: "Mono" },
];

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

export function weightName(w: number): string {
  return WEIGHT_NAMES[w] ?? String(w);
}
