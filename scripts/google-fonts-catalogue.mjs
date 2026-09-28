#!/usr/bin/env node
/** Builds `src/text/google-fonts.json`, the build-time snapshot of Fontsource's catalogue that
 *  `src/text/google-catalogue.ts` loads at runtime (spec M20 §2). Nothing else talks to Fontsource
 *  or Google — this script runs once, offline from the app, and its output is committed.
 *
 *  Refresh: `node scripts/google-fonts-catalogue.mjs`
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const API_URL = "https://api.fontsource.org/v1/fonts";
const OUT_PATH = fileURLToPath(new URL("../src/text/google-fonts.json", import.meta.url));
const LICENCES = new Set(["OFL-1.1", "Apache-2.0", "UFL-1.0"]);

const res = await fetch(API_URL);
if (!res.ok) throw new Error(`Fontsource API returned ${res.status}`);
/** @type {{ id: string, family: string, category: string, license: string, weights: number[], styles: string[], variable: boolean, type: string }[]} */
const all = await res.json();

const families = all
  .filter((f) => f.type === "google" && LICENCES.has(f.license))
  .map((f) => ({
    id: f.id,
    family: f.family,
    category: f.category,
    license: f.license,
    weights: f.weights,
    italic: f.styles.includes("italic"),
    variable: f.variable,
  }))
  .sort((a, b) => a.family.localeCompare(b.family));

const json = `[\n${families.map((f) => JSON.stringify(f)).join(",\n")}\n]\n`;
await writeFile(OUT_PATH, json);
console.log(`Wrote ${families.length} families to ${OUT_PATH}`);
