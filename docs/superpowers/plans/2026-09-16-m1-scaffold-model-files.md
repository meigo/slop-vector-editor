# Milestone 1 — Scaffold, Model, Render, Files — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable-quality app shell that shows an SVG document on a pannable/zoomable
pasteboard, opens and saves plain SVG files, autosaves, and has working undo/redo for document
edits (artboard settings are the only edit in this milestone).

**Architecture:** Plain immutable document data (`src/doc`), pure geometry (`src/geom`), a
hand-written XML reader + SVG importer/exporter (`src/svg`), a pure undo session
(`src/state/session.ts`) held in a Svelte 5 class store with `$state.raw` fields, and Svelte
components that render the document through the SAME attribute functions the exporter uses
(`src/svg/attrs.ts`), so screen and file cannot drift.

**Tech Stack:** Svelte 5 (runes), TypeScript 5.9 strict, Vite 8, Tailwind 4, Vitest 4 (node env),
`@lucide/svelte`, ESLint 10 + Prettier 3, husky + lint-staged, Wrangler 4 (assets-only).

**Spec:** `docs/superpowers/specs/2026-09-16-slop-vector-editor-design.md` (this plan implements
§9 milestone 1; §2, §3, §4, §6 file-menu/dialog parts, §7, §8).

## Global Constraints

- `npm run build` (= `svelte-check && tsc --noEmit && vite build`) must end with **0 errors, 0 warnings**.
- `npm test` = Vitest, node environment, no DOM. Only pure logic is unit-tested.
- `svelte.config.js` sets `compilerOptions: { runes: true }`.
- tsconfig: `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums, no namespaces, **no constructor parameter properties**).
- The document is immutable: every edit returns a new object and never mutates its input. Undo stores references, not clones.
- The store is exported as `app` (NOT `state`) — this sidesteps the `store_rune_conflict` gotcha the sibling apps document.
- Every drag surface sets `touch-action: none`; `pointercancel` is handled like `pointerup`.
- No native `alert`/`confirm`/`prompt` — use the in-app `ConfirmDialog`.
- Colors come from the family tokens (`SLOP-TIMELINE-UI.md`): ground `#101013`, panel `#1e1e22`, raised `#2d2d33`, line `#2e2e35`, text `#f4f4f5`, muted `#a1a1aa`, accent `#5b8cff`, accent-hover `#7aa3ff`, danger `#f87171`, warn `#d5b75d`, ok `#34d399`, disabled `#52525b`. Font: IBM Plex Mono.
- Numbers written to SVG are rounded to 6 decimals (`fmt`), so "lossless round-trip" means equal within 1e-6.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Git: work on a branch `m1-scaffold` off `main`; one commit per task; merge only when the user says so.

## File map

```
package.json, tsconfig.json, vite.config.ts, svelte.config.js, eslint.config.js,
.prettierrc.json, .prettierignore, .husky/pre-commit, wrangler.jsonc, index.html,
public/favicon.svg
fixtures/inkscape-layers.svg, fixtures/figma-flat.svg, fixtures/illustrator-classes.svg
src/main.ts, src/app.css, src/App.svelte
src/geom/vec.ts          Vec type + mid/dist
src/geom/mat.ts          Mat (SVG matrix) ops
src/geom/shapes.ts       rectPath (rect with independent rx/ry → path)
src/doc/document.ts      Doc/Layer/Node/Shape/Style types, createDoc, DEFAULT_STYLE, size limits
src/doc/edits.ts         setArtboard (M1's only edit)
src/svg/fmt.ts           number formatting for SVG output
src/svg/arc.ts           SVG elliptical arc → cubic beziers
src/svg/pathdata.ts      Subpath[] ↔ d string, node-type inference and data-sv-nodes codec
src/svg/xml.ts           minimal XML parser (works in node and browser)
src/svg/colors.ts        CSS color parsing
src/svg/transform.ts     SVG transform-list parsing
src/svg/attrs.ts         model → SVG attributes (shared by render + export)
src/svg/serialize.ts     Doc → SVG text
src/svg/parse.ts         SVG text → Doc + dropped-feature report
src/state/history.ts     generic snapshot undo stacks
src/state/session.ts     doc + history + gesture + saved marker (pure)
src/state/viewport.ts    View (pan/zoom) math (pure)
src/state/keys.ts        keyboard → Command mapping (pure)
src/state/appState.svelte.ts   the store (`app`) and its actions
src/state/commands.ts    Command → action dispatch
src/persist/file-io.ts   open/save via File System Access API or input/download fallback
src/persist/autosave.ts  IndexedDB autosave with debounce
src/persist/project-io.ts  new/open/save/restore orchestration
src/lib/Canvas.svelte, NodeView.svelte, TopBar.svelte, StatusBar.svelte, Modal.svelte,
        NewDocumentDialog.svelte, DocumentSettingsDialog.svelte, ConfirmDialog.svelte,
        Notices.svelte
src/__tests__/*.test.ts, src/__tests__/helpers.ts
CLAUDE.md, README.md, docs/superpowers/CHANGELOG.md
```

---

### Task 1: Project scaffold and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `svelte.config.js`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.husky/pre-commit`, `wrangler.jsonc`, `index.html`, `public/favicon.svg`, `src/main.ts`, `src/app.css`, `src/App.svelte`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: working `npm run dev|build|test|lint|format|deploy`; Tailwind color utilities `bg-ground`, `bg-panel`, `bg-raised`, `border-line`, `text-text`, `text-muted`, `bg-accent`, `text-warn`, `text-danger`, …; component classes `.icon-btn`, `.btn`, `.btn-primary`, `.btn-on`, `.field`, `.menu-item`, `.kbd`.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/meigo/Projects/slop/slop-vector-editor
git checkout -b m1-scaffold
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "slop-vector-editor",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:lan": "HTTPS=1 vite --host",
    "build": "svelte-check && tsc --noEmit && vite build",
    "preview": "vite preview",
    "deploy": "npm run build && wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "check": "svelte-check",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,js,cjs,mjs,svelte}": ["eslint --fix", "prettier --write"],
    "*.{css,json,md,html,yml,yaml}": "prettier --write --ignore-unknown"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@sveltejs/vite-plugin-svelte": "^7.0.0",
    "@tailwindcss/vite": "^4.2.2",
    "@vitejs/plugin-basic-ssl": "^2.3.0",
    "eslint": "^10.2.0",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-better-tailwindcss": "^4.7.0",
    "eslint-plugin-svelte": "^3.19.0",
    "globals": "^16.5.0",
    "husky": "^9.1.7",
    "lint-staged": "^17.0.7",
    "prettier": "^3.8.4",
    "prettier-plugin-svelte": "^4.1.1",
    "prettier-plugin-tailwindcss": "^0.8.0",
    "svelte": "^5.55.1",
    "svelte-check": "^4.4.6",
    "svelte-eslint-parser": "^1.8.0",
    "tailwindcss": "^4.2.2",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.58.0",
    "vite": "^8.0.1",
    "vitest": "^4.1.2",
    "wrangler": "^4.115.0"
  },
  "dependencies": {
    "@lucide/svelte": "^1.3.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "skipLibCheck": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src", "src/**/*.svelte"]
}
```

- [ ] **Step 4: Write `vite.config.ts` and `svelte.config.js`**

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  // HTTPS only for dev:lan — an iPad reaching the LAN dev server needs a secure context.
  plugins: [svelte(), tailwindcss(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  test: {
    passWithNoTests: true,
    // Superpowers worktrees live in .worktrees/ inside the repo; without this each one doubles
    // the suite. Spread the defaults: `exclude` replaces rather than merges.
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
  },
});
```

`svelte.config.js`:

```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  // Every component is runes-mode; enforce it so legacy reactivity cannot creep back in.
  compilerOptions: { runes: true },
};
```

- [ ] **Step 5: Write `eslint.config.js`, `.prettierrc.json`, `.prettierignore`**

`eslint.config.js`:

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteConfig from "./svelte.config.js";
import globals from "globals";
import prettier from "eslint-config-prettier";
import betterTailwind from "eslint-plugin-better-tailwindcss";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  { languageOptions: { globals: { ...globals.browser } } },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "warn",
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: [".svelte"], svelteConfig },
    },
  },
  {
    rules: {
      // svelte-check owns compiler + a11y diagnostics.
      "svelte/valid-compile": "off",
      // Plain Maps here are intentional non-reactive caches (e.g. active pointers).
      "svelte/prefer-svelte-reactivity": "off",
    },
  },
  {
    // `let { x } = $props()` legitimately needs `let`; use the runes-aware rule instead.
    files: ["**/*.svelte"],
    rules: { "prefer-const": "off", "svelte/prefer-const": "warn" },
  },
  prettier,
  ...svelte.configs.prettier,
  {
    // Only the conflict/duplicate rules: class order is Prettier's job, and this codebase has
    // its own component classes (.icon-btn, .btn …) that an "unregistered class" rule would flag.
    files: ["**/*.svelte", "**/*.html"],
    plugins: { "better-tailwindcss": betterTailwind },
    settings: { "better-tailwindcss": { entryPoint: "src/app.css" } },
    rules: {
      "better-tailwindcss/no-conflicting-classes": "error",
      "better-tailwindcss/no-duplicate-classes": "warn",
      "better-tailwindcss/enforce-canonical-classes": "warn",
      "better-tailwindcss/no-unnecessary-whitespace": "warn",
    },
  },
  { ignores: ["dist/"] },
);
```

`.prettierrc.json`:

```json
{
  "printWidth": 100,
  "plugins": ["prettier-plugin-svelte", "prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./src/app.css",
  "overrides": [{ "files": "*.svelte", "options": { "parser": "svelte" } }]
}
```

`.prettierignore`:

```
dist
node_modules
package-lock.json
docs
fixtures
```

- [ ] **Step 6: Write `wrangler.jsonc`, `index.html`, favicon**

`wrangler.jsonc`:

```jsonc
{
  // Assets-only Workers deploy: no `main`. Static-asset requests are free and unlimited; only
  // Worker invocations are billed, so a Worker script would meter traffic for no benefit.
  // No `not_found_handling`: the app has no client-side routes.
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "slop-vector-editor",
  "compatibility_date": "2026-09-16",
  "assets": { "directory": "./dist" },
}
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <!-- No viewport-fit=cover: the app does no safe-area padding (same reasoning as slop-animator). -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>slop-vector-editor</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap"
    />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <meta name="apple-mobile-web-app-title" content="slop vector" />
    <meta name="theme-color" content="#1e1e22" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Favicon (the family star):

```bash
mkdir -p public && cp ../slop-animator/public/favicon.svg public/favicon.svg
```

- [ ] **Step 7: Write `src/main.ts`, `src/app.css`, placeholder `src/App.svelte`**

`src/main.ts`:

```ts
import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

const app = mount(App, { target: document.getElementById("app")! });
export default app;
```

`src/app.css`:

```css
@import "tailwindcss";

/* Family palette, verbatim from ../SLOP-TIMELINE-UI.md §1 (role names kept). Dark only. The
   ARTWORK is unaffected: the artboard background is document data, painted by the canvas. */
@theme {
  --font-sans: "IBM Plex Mono", ui-monospace, monospace;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --color-ground: #101013;
  --color-panel: #1e1e22;
  --color-raised: #2d2d33;
  --color-line: #2e2e35;
  --color-text: #f4f4f5;
  --color-muted: #a1a1aa;
  --color-accent: #5b8cff;
  --color-accent-hover: #7aa3ff;
  --color-accent-text: #121212;
  --color-danger: #f87171;
  --color-warn: #d5b75d;
  --color-ok: #34d399;
  --color-disabled: #52525b;
}

html,
body {
  height: 100%;
  margin: 0;
  overscroll-behavior: none;
  background: var(--color-ground);
  color: var(--color-text);
  font-family: var(--font-sans);
  -webkit-user-select: none;
  user-select: none;
}

/* Fixed like slop-animator: iOS must not scroll or rubber-band the app shell. */
#app {
  position: fixed;
  inset: 0;
}

@layer components {
  .icon-btn {
    @apply inline-flex h-8 w-8 items-center justify-center rounded text-text hover:bg-raised disabled:text-disabled disabled:hover:bg-transparent;
  }
  .btn {
    @apply inline-flex h-8 items-center rounded border border-line bg-raised px-3 text-xs text-text hover:border-muted disabled:text-disabled;
  }
  .btn-primary {
    @apply border-accent bg-accent text-accent-text hover:bg-accent-hover;
  }
  .btn-on {
    @apply border-accent text-accent;
  }
  .field {
    @apply h-8 rounded border border-line bg-ground px-2 text-xs text-text select-text focus:border-accent focus:outline-none;
  }
  .menu-item {
    @apply flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-raised;
  }
  .kbd {
    @apply text-muted;
  }
}
```

`src/App.svelte` (placeholder, replaced in Task 12):

```svelte
<main class="flex h-full items-center justify-center text-muted">slop-vector-editor</main>
```

- [ ] **Step 8: Update `.gitignore`**

```
node_modules/
dist/
.worktrees/
.wrangler/
.DS_Store
.claude/
```

- [ ] **Step 9: Install and set up the hook**

```bash
npm install
printf 'npx lint-staged\n' > .husky/pre-commit
```

Expected: install completes; `.husky/_/` exists (created by the `prepare` script).

- [ ] **Step 10: Verify the toolchain**

Run: `npm run build && npm test && npm run lint`
Expected: build prints `svelte-check found 0 errors and 0 warnings` and writes `dist/`; Vitest prints "No test files found, exiting with code 0"; ESLint prints nothing.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Svelte 5 + Vite + Tailwind 4 project

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Geometry primitives (vec, mat)

**Files:**
- Create: `src/geom/vec.ts`, `src/geom/mat.ts`
- Test: `src/__tests__/mat.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Vec = { x: number; y: number }`; `mid(a: Vec, b: Vec): Vec`; `dist(a: Vec, b: Vec): number`
  - `type Mat = [number, number, number, number, number, number]` (SVG `matrix(a b c d e f)`)
  - `IDENTITY: Mat`; `multiply(m: Mat, n: Mat): Mat` (result applies `n` first, then `m`)
  - `applyMat(m: Mat, p: Vec): Vec`; `invert(m: Mat): Mat | null`
  - `translate(tx: number, ty: number): Mat`; `scale(sx: number, sy?: number): Mat`; `rotate(rad: number): Mat`; `skewX(rad: number): Mat`; `skewY(rad: number): Mat`
  - `isIdentity(m: Mat, eps?: number): boolean`

- [ ] **Step 1: Write the failing test** — `src/__tests__/mat.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  applyMat,
  invert,
  isIdentity,
  multiply,
  rotate,
  scale,
  skewX,
  translate,
} from "../geom/mat";
import { dist, mid } from "../geom/vec";

describe("vec", () => {
  it("mid and dist", () => {
    expect(mid({ x: 0, y: 0 }, { x: 4, y: 2 })).toEqual({ x: 2, y: 1 });
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("mat", () => {
  it("applies translate and scale", () => {
    expect(applyMat(translate(5, -2), { x: 1, y: 1 })).toEqual({ x: 6, y: -1 });
    expect(applyMat(scale(2, 3), { x: 1, y: 1 })).toEqual({ x: 2, y: 3 });
    expect(applyMat(scale(2), { x: 1, y: 1 })).toEqual({ x: 2, y: 2 });
  });

  it("rotates counter-clockwise in math terms (clockwise on a y-down screen)", () => {
    const p = applyMat(rotate(Math.PI / 2), { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it("multiply applies the right-hand matrix first", () => {
    const m = multiply(translate(10, 0), scale(2));
    expect(applyMat(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
  });

  it("skewX shears x by y", () => {
    const p = applyMat(skewX(Math.PI / 4), { x: 0, y: 1 });
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(1);
  });

  it("invert round-trips and rejects singular matrices", () => {
    const m = multiply(translate(3, 4), multiply(rotate(0.7), scale(2, 0.5)));
    const inv = invert(m)!;
    const p = applyMat(inv, applyMat(m, { x: 7, y: -3 }));
    expect(p.x).toBeCloseTo(7);
    expect(p.y).toBeCloseTo(-3);
    expect(invert([0, 0, 0, 0, 1, 1])).toBeNull();
  });

  it("isIdentity tolerates float noise", () => {
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(isIdentity([1, 1e-12, 0, 1, 0, 0])).toBe(true);
    expect(isIdentity(translate(0.01, 0))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/mat.test.ts`
Expected: FAIL — cannot resolve `../geom/mat`.

- [ ] **Step 3: Implement** — `src/geom/vec.ts`

```ts
export type Vec = { x: number; y: number };

export function mid(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
```

`src/geom/mat.ts`:

```ts
import type { Vec } from "./vec";

/** An affine matrix in SVG's `matrix(a b c d e f)` order:
 *  x' = a·x + c·y + e,  y' = b·x + d·y + f. */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** `m ∘ n`: the result applies `n` first, then `m` (same as SVG `transform="m n"`). */
export function multiply(m: Mat, n: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = n;
  return [
    a * A + c * B,
    b * A + d * B,
    a * C + c * D,
    b * C + d * D,
    a * E + c * F + e,
    b * E + d * F + f,
  ];
}

export function applyMat(m: Mat, p: Vec): Vec {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m: Mat): Mat | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function translate(tx: number, ty: number): Mat {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy: number = sx): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotate(rad: number): Mat {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

export function skewX(rad: number): Mat {
  return [1, 0, Math.tan(rad), 1, 0, 0];
}

export function skewY(rad: number): Mat {
  return [1, Math.tan(rad), 0, 1, 0, 0];
}

export function isIdentity(m: Mat, eps = 1e-9): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) <= eps);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/mat.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/geom src/__tests__/mat.test.ts
git commit -m "feat(geom): vec and affine matrix primitives

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Document model and the setArtboard edit

**Files:**
- Create: `src/doc/document.ts`, `src/doc/edits.ts`, `src/__tests__/helpers.ts`
- Test: `src/__tests__/document.test.ts`

**Interfaces:**
- Consumes: `Vec` (`src/geom/vec.ts`), `Mat`, `IDENTITY` (`src/geom/mat.ts`).
- Produces (all exported from `src/doc/document.ts`):
  - Types `Doc`, `Artboard`, `Layer`, `Node`, `Group`, `Shape`, `RectShape`, `EllipseShape`, `PathShape`, `Subpath`, `PathNode`, `NodeType`, `Paint`, `Style`, `LineCap`, `LineJoin` exactly as in spec §4 (`Doc.artboard: Artboard = { w; h; background: Paint | null }`).
  - `DOC_VERSION = 1`, `MAX_ARTBOARD = 100000`, `DEFAULT_STYLE: Style`
  - `idFor(n: number): string` → `"n" + n`
  - `createDoc(w: number, h: number): Doc` — one visible, unlocked layer `"Layer 1"` with id `n1`, white opaque background, `nextId: 2`.
  - `isValidArtboardSize(n: unknown): n is number`
- `src/doc/edits.ts`: `setArtboard(doc: Doc, artboard: Artboard): Doc` — returns `doc` unchanged (same reference) when the values are equal; throws `RangeError` for an invalid size.
- `src/__tests__/helpers.ts`: `deepFreeze<T>(v: T): T`, `stripIds(doc: Doc): Doc` (ids → `""`, `nextId` → `0`).

- [ ] **Step 1: Write the failing test** — `src/__tests__/document.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createDoc, isValidArtboardSize, MAX_ARTBOARD } from "../doc/document";
import { setArtboard } from "../doc/edits";
import { deepFreeze } from "./helpers";

describe("createDoc", () => {
  it("creates one empty layer and a white artboard", () => {
    const doc = createDoc(800, 600);
    expect(doc).toEqual({
      version: 1,
      artboard: { w: 800, h: 600, background: { color: "#ffffff", opacity: 1 } },
      layers: [{ id: "n1", name: "Layer 1", visible: true, locked: false, children: [] }],
      nextId: 2,
    });
  });
});

describe("isValidArtboardSize", () => {
  it("accepts positive finite numbers up to the limit", () => {
    expect(isValidArtboardSize(1)).toBe(true);
    expect(isValidArtboardSize(MAX_ARTBOARD)).toBe(true);
    expect(isValidArtboardSize(0)).toBe(false);
    expect(isValidArtboardSize(MAX_ARTBOARD + 1)).toBe(false);
    expect(isValidArtboardSize(Number.NaN)).toBe(false);
    expect(isValidArtboardSize(null)).toBe(false);
  });
});

describe("setArtboard", () => {
  it("returns a new doc without mutating the input", () => {
    const doc = deepFreeze(createDoc(800, 600));
    const next = setArtboard(doc, { w: 100, h: 50, background: null });
    expect(next).not.toBe(doc);
    expect(next.artboard).toEqual({ w: 100, h: 50, background: null });
    expect(next.layers).toBe(doc.layers);
  });

  it("returns the same reference when nothing changes", () => {
    const doc = createDoc(800, 600);
    expect(setArtboard(doc, { w: 800, h: 600, background: { color: "#ffffff", opacity: 1 } })).toBe(
      doc,
    );
  });

  it("rejects invalid sizes", () => {
    expect(() => setArtboard(createDoc(10, 10), { w: 0, h: 10, background: null })).toThrow(
      RangeError,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: FAIL — cannot resolve `../doc/document`.

- [ ] **Step 3: Implement** — `src/doc/document.ts`

```ts
import type { Mat } from "../geom/mat";
import type { Vec } from "../geom/vec";

/** The document is plain, immutable data: every edit returns a new object and never mutates its
 *  input. That is what lets undo keep references instead of clones. */

export const DOC_VERSION = 1;
export const MAX_ARTBOARD = 100000;

export type Paint = { color: string /* #rrggbb, lowercase */; opacity: number };
export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";

export type Style = {
  fill: Paint | null;
  stroke: Paint | null;
  strokeWidth: number;
  cap: LineCap;
  join: LineJoin;
  opacity: number;
};

export type NodeType = "corner" | "smooth" | "symmetric";

/** Handles are absolute document coordinates (in the shape's own space); null = no handle. */
export type PathNode = { p: Vec; in: Vec | null; out: Vec | null; type: NodeType };
export type Subpath = { nodes: PathNode[]; closed: boolean };

type ShapeBase = { id: string; name?: string; transform: Mat; style: Style };
export type RectShape = ShapeBase & {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
};
export type EllipseShape = ShapeBase & {
  kind: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};
export type PathShape = ShapeBase & { kind: "path"; subpaths: Subpath[] };
export type Shape = RectShape | EllipseShape | PathShape;

export type Group = {
  kind: "group";
  id: string;
  name?: string;
  transform: Mat;
  opacity: number;
  children: Node[];
};
export type Node = Group | Shape;

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  children: Node[];
};

export type Artboard = { w: number; h: number; background: Paint | null };

export type Doc = {
  version: typeof DOC_VERSION;
  artboard: Artboard;
  layers: Layer[];
  nextId: number;
};

export const DEFAULT_STYLE: Style = {
  fill: { color: "#d9d9d9", opacity: 1 },
  stroke: { color: "#000000", opacity: 1 },
  strokeWidth: 1,
  cap: "butt",
  join: "miter",
  opacity: 1,
};

export function idFor(n: number): string {
  return `n${n}`;
}

export function createDoc(w: number, h: number): Doc {
  return {
    version: DOC_VERSION,
    artboard: { w, h, background: { color: "#ffffff", opacity: 1 } },
    layers: [{ id: idFor(1), name: "Layer 1", visible: true, locked: false, children: [] }],
    nextId: 2,
  };
}

export function isValidArtboardSize(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_ARTBOARD;
}
```

`src/doc/edits.ts`:

```ts
import { isValidArtboardSize, type Artboard, type Doc, type Paint } from "./document";

/** Pure document edits: `(doc, args) => doc`. An edit that changes nothing returns the SAME
 *  reference, which is how the undo session knows not to record a step. */

function samePaint(a: Paint | null, b: Paint | null): boolean {
  if (a === null || b === null) return a === b;
  return a.color === b.color && a.opacity === b.opacity;
}

export function setArtboard(doc: Doc, artboard: Artboard): Doc {
  if (!isValidArtboardSize(artboard.w) || !isValidArtboardSize(artboard.h)) {
    throw new RangeError(`Invalid artboard size ${artboard.w} × ${artboard.h}`);
  }
  const cur = doc.artboard;
  if (cur.w === artboard.w && cur.h === artboard.h && samePaint(cur.background, artboard.background)) {
    return doc;
  }
  return { ...doc, artboard: { ...artboard } };
}
```

`src/__tests__/helpers.ts`:

```ts
import type { Doc, Node } from "../doc/document";

/** Freeze recursively so a test fails loudly if code under test mutates its input. */
export function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v)) deepFreeze(child);
  }
  return v;
}

function stripNode(n: Node): Node {
  if (n.kind === "group") return { ...n, id: "", children: n.children.map(stripNode) };
  return { ...n, id: "" };
}

/** Ids are regenerated on import; compare documents without them. */
export function stripIds(doc: Doc): Doc {
  return {
    ...doc,
    nextId: 0,
    layers: doc.layers.map((l) => ({ ...l, id: "", children: l.children.map(stripNode) })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/doc src/__tests__/document.test.ts src/__tests__/helpers.ts
git commit -m "feat(doc): document model types, createDoc, setArtboard

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Number formatting and arc → cubic conversion

**Files:**
- Create: `src/svg/fmt.ts`, `src/svg/arc.ts`
- Test: `src/__tests__/arc.test.ts`

**Interfaces:**
- Consumes: `Vec`.
- Produces:
  - `fmt(n: number): string` — rounds to 6 decimals, never emits `-0`.
  - `arcToCubics(p0: Vec, rx: number, ry: number, rotationDeg: number, largeArc: boolean, sweep: boolean, p1: Vec): [Vec, Vec, Vec][]` — each tuple is `[control1, control2, end]`; ≤ 90° per segment; `[]` when `p0` equals `p1`; one straight degenerate cubic `[p0, p1, p1]` when a radius is 0. The last segment ends exactly at `p1`.

- [ ] **Step 1: Write the failing test** — `src/__tests__/arc.test.ts`

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/arc.test.ts`
Expected: FAIL — cannot resolve `../svg/arc`.

- [ ] **Step 3: Implement** — `src/svg/fmt.ts`

```ts
/** SVG number output: 6 decimals is far below any visible difference and keeps float noise
 *  (0.30000000000000004) out of files. */
export function fmt(n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
}
```

`src/svg/arc.ts`:

```ts
import type { Vec } from "../geom/vec";

/** SVG elliptical arc (endpoint parameterisation) → cubic beziers.
 *  Center conversion per SVG 1.1 implementation notes F.6.5/F.6.6; each piece ≤ 90° using
 *  k = 4/3·tan(Δ/4). */
export function arcToCubics(
  p0: Vec,
  rx: number,
  ry: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Vec,
): [Vec, Vec, Vec][] {
  if (p0.x === p1.x && p0.y === p1.y) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [[p0, p1, p1]];

  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * -(ry * x1p)) / rx;
  const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2;
  const cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let dtheta = angle(ux, uy, vx, vy);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  const n = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2) - 1e-9));
  const delta = dtheta / n;
  const k = (4 / 3) * Math.tan(delta / 4);

  const pointAt = (t: number): Vec => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  });
  const derivAt = (t: number): Vec => ({
    x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  });

  const out: [Vec, Vec, Vec][] = [];
  let a = p0;
  for (let i = 0; i < n; i++) {
    const t0 = theta1 + i * delta;
    const t1 = t0 + delta;
    const b = i === n - 1 ? p1 : pointAt(t1);
    const d0 = derivAt(t0);
    const d1 = derivAt(t1);
    out.push([
      { x: a.x + k * d0.x, y: a.y + k * d0.y },
      { x: b.x - k * d1.x, y: b.y - k * d1.y },
      b,
    ]);
    a = b;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/arc.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/svg/fmt.ts src/svg/arc.ts src/__tests__/arc.test.ts
git commit -m "feat(svg): number formatting and arc-to-cubic conversion

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Path data read/write and node types

**Files:**
- Create: `src/svg/pathdata.ts`
- Test: `src/__tests__/pathdata.test.ts`

**Interfaces:**
- Consumes: `Subpath`, `PathNode`, `NodeType` (`src/doc/document.ts`); `Vec`; `fmt`; `arcToCubics`.
- Produces:
  - `subpathsToD(subpaths: Subpath[]): string` — `M`, `L`, `C`, `Z` only, absolute. A segment is `L` when the start's `out` and the end's `in` are both null, else `C` (a missing handle is written as its node's point). A closed subpath whose closing segment has a handle writes that segment as `C` back to the first point, then `Z`. An open subpath's first `in` and last `out` are not written.
  - `parsePathData(d: string): Subpath[]` — full SVG path grammar (M L H V C S Q T A Z, absolute and relative, implicit repeats, compact numbers, compact arc flags). Never throws: malformed data stops parsing and returns what was read. Handles equal to their node's point become null. On `Z`, a last node coinciding with the first is merged into it (its `in` handle moves to the first node). Node types come from `inferNodeTypes`.
  - `inferNodeTypes(subpaths: Subpath[]): Subpath[]` — `smooth` when both handles exist and are collinear on opposite sides, else `corner`.
  - `nodeTypesAttr(subpaths: Subpath[]): string` — one char per node (`c` corner, `s` smooth, `y` symmetric), subpaths separated by a space.
  - `applyNodeTypes(subpaths: Subpath[], attr: string): Subpath[]` — applies the codes to each subpath whose code length matches its node count; other subpaths are left as they are.

- [ ] **Step 1: Write the failing test** — `src/__tests__/pathdata.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { PathNode, Subpath } from "../doc/document";
import { applyNodeTypes, nodeTypesAttr, parsePathData, subpathsToD } from "../svg/pathdata";

const corner = (x: number, y: number): PathNode => ({
  p: { x, y },
  in: null,
  out: null,
  type: "corner",
});
const pts = (sp: Subpath) => sp.nodes.map((n) => [n.p.x, n.p.y]);

describe("subpathsToD", () => {
  it("writes straight segments with L and closes with Z", () => {
    const d = subpathsToD([
      { nodes: [corner(0, 0), corner(10, 0), corner(10, 10)], closed: true },
    ]);
    expect(d).toBe("M0 0 L10 0 L10 10 Z");
  });

  it("writes curves with C, using the node point for a missing handle", () => {
    const d = subpathsToD([
      {
        nodes: [
          { p: { x: 0, y: 0 }, in: null, out: { x: 5, y: 0 }, type: "corner" },
          { p: { x: 10, y: 10 }, in: null, out: null, type: "corner" },
        ],
        closed: false,
      },
    ]);
    expect(d).toBe("M0 0 C5 0 10 10 10 10");
  });

  it("writes a curved closing segment explicitly before Z", () => {
    const d = subpathsToD([
      {
        nodes: [
          { p: { x: 0, y: 0 }, in: { x: 0, y: 5 }, out: null, type: "corner" },
          corner(10, 0),
        ],
        closed: true,
      },
    ]);
    expect(d).toBe("M0 0 L10 0 C10 0 0 5 0 0 Z");
  });

  it("writes several subpaths", () => {
    const d = subpathsToD([
      { nodes: [corner(0, 0), corner(1, 1)], closed: false },
      { nodes: [corner(5, 5), corner(6, 6)], closed: false },
    ]);
    expect(d).toBe("M0 0 L1 1 M5 5 L6 6");
  });
});

describe("parsePathData", () => {
  it("parses relative moves, H/V and close", () => {
    const [sp] = parsePathData("m10 10 h10 v10 H10 z");
    expect(pts(sp)).toEqual([
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
    ]);
    expect(sp.closed).toBe(true);
  });

  it("treats extra pairs after M as line-tos", () => {
    const [sp] = parsePathData("M0 0 10 0 10 10");
    expect(pts(sp)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(sp.closed).toBe(false);
  });

  it("parses compact numbers", () => {
    const [sp] = parsePathData("M0-5.5.5 1e1");
    expect(pts(sp)).toEqual([
      [0, -5.5],
      [0.5, 10],
    ]);
  });

  it("reflects the previous control point for S and infers smooth nodes", () => {
    const [sp] = parsePathData("M0 0 C0 10 10 10 10 0 S20 -10 20 0");
    const [n0, n1, n2] = sp.nodes;
    expect(n0.out).toEqual({ x: 0, y: 10 });
    expect(n1.in).toEqual({ x: 10, y: 10 });
    expect(n1.out).toEqual({ x: 10, y: -10 });
    expect(n1.type).toBe("smooth");
    expect(n0.type).toBe("corner");
    expect(n2.in).toEqual({ x: 20, y: -10 });
  });

  it("elevates quadratics (Q and T) to cubics", () => {
    const [sp] = parsePathData("M0 0 Q5 5 10 0 T20 0");
    const [n0, n1, n2] = sp.nodes;
    expect(n0.out!.x).toBeCloseTo(10 / 3);
    expect(n0.out!.y).toBeCloseTo(10 / 3);
    expect(n1.in!.x).toBeCloseTo(20 / 3);
    expect(n1.in!.y).toBeCloseTo(10 / 3);
    // T reflects (5,5) about (10,0) → (15,-5)
    expect(n1.out!.x).toBeCloseTo(10 + (2 / 3) * 5);
    expect(n1.out!.y).toBeCloseTo((2 / 3) * -5);
    expect(n2.p).toEqual({ x: 20, y: 0 });
  });

  it("converts arcs, including compact flags", () => {
    for (const d of ["M0 0 A1 1 0 0 1 2 0", "M0 0a1 1 0 012 0"]) {
      const [sp] = parsePathData(d);
      expect(sp.nodes).toHaveLength(3);
      expect(sp.nodes[1].p.x).toBeCloseTo(1);
      expect(sp.nodes[1].p.y).toBeCloseTo(-1);
      expect(sp.nodes[2].p).toEqual({ x: 2, y: 0 });
    }
  });

  it("merges a closing node that lands on the start point", () => {
    const [sp] = parsePathData("M0 0 C0 -5 10 -5 10 0 C10 5 0 5 0 0 Z");
    expect(sp.nodes).toHaveLength(2);
    expect(sp.closed).toBe(true);
    expect(sp.nodes[0].in).toEqual({ x: 0, y: 5 });
    expect(sp.nodes[0].out).toEqual({ x: 0, y: -5 });
    expect(sp.nodes[0].type).toBe("smooth");
  });

  it("starts a new subpath at the start point after Z", () => {
    const sps = parsePathData("M0 0 L10 0 Z L0 10");
    expect(sps).toHaveLength(2);
    expect(pts(sps[1])).toEqual([
      [0, 0],
      [0, 10],
    ]);
  });

  it("stops at garbage or truncated data without throwing", () => {
    expect(pts(parsePathData("M0 0 L10 0 X 5 5")[0])).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(pts(parsePathData("M0 0 L10")[0])).toEqual([[0, 0]]);
    expect(parsePathData("")).toEqual([]);
  });

  it("nulls handles that sit on their node", () => {
    const [sp] = parsePathData("M0 0 C0 0 10 0 10 0");
    expect(sp.nodes[0].out).toBeNull();
    expect(sp.nodes[1].in).toBeNull();
  });

  it("round-trips through subpathsToD", () => {
    const d = "M0 0 C0 -5 10 -5 10 0 C10 5 0 5 0 0 Z M20 20 L30 20 L30 30";
    expect(parsePathData(subpathsToD(parsePathData(d)))).toEqual(parsePathData(d));
  });
});

describe("node type codec", () => {
  it("encodes and applies node types per subpath", () => {
    const sps: Subpath[] = [
      { nodes: [corner(0, 0), { ...corner(1, 1), type: "symmetric" }], closed: false },
      { nodes: [{ ...corner(2, 2), type: "smooth" }], closed: false },
    ];
    const attr = nodeTypesAttr(sps);
    expect(attr).toBe("cy s");
    const plain = sps.map((sp) => ({ ...sp, nodes: sp.nodes.map((n) => ({ ...n, type: "corner" as const })) }));
    expect(applyNodeTypes(plain, attr)).toEqual(sps);
  });

  it("ignores codes whose length does not match", () => {
    const sps: Subpath[] = [{ nodes: [corner(0, 0), corner(1, 1)], closed: false }];
    expect(applyNodeTypes(sps, "s")).toEqual(sps);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/pathdata.test.ts`
Expected: FAIL — cannot resolve `../svg/pathdata`.

- [ ] **Step 3: Implement** — `src/svg/pathdata.ts`

```ts
import type { NodeType, PathNode, Subpath } from "../doc/document";
import type { Vec } from "../geom/vec";
import { arcToCubics } from "./arc";
import { fmt } from "./fmt";

// ---------- writing ----------

const pt = (p: Vec) => `${fmt(p.x)} ${fmt(p.y)}`;

function segment(a: PathNode, b: PathNode): string {
  if (!a.out && !b.in) return `L${pt(b.p)}`;
  return `C${pt(a.out ?? a.p)} ${pt(b.in ?? b.p)} ${pt(b.p)}`;
}

export function subpathsToD(subpaths: Subpath[]): string {
  const parts: string[] = [];
  for (const sp of subpaths) {
    const n = sp.nodes;
    if (n.length === 0) continue;
    parts.push(`M${pt(n[0].p)}`);
    for (let i = 1; i < n.length; i++) parts.push(segment(n[i - 1], n[i]));
    if (sp.closed) {
      const last = n[n.length - 1];
      // A straight closing segment is implied by Z; a curved one must be written out.
      if (n.length > 1 && (last.out || n[0].in)) parts.push(segment(last, n[0]));
      parts.push("Z");
    }
  }
  return parts.join(" ");
}

// ---------- reading ----------

const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const CMD_RE = /[MmLlHhVvCcSsQqTtAaZz]/;

class PathDataError extends Error {}

function scanner(s: string) {
  let i = 0;
  const skip = () => {
    while (i < s.length && (s[i] === "," || /\s/.test(s[i]))) i++;
  };
  return {
    done(): boolean {
      skip();
      return i >= s.length;
    },
    command(): string | null {
      skip();
      const c = s[i];
      if (c !== undefined && CMD_RE.test(c)) {
        i++;
        return c;
      }
      return null;
    },
    hasNumber(): boolean {
      skip();
      return i < s.length && /[-+.\d]/.test(s[i]);
    },
    number(): number {
      skip();
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(s);
      if (!m) throw new PathDataError(`Expected a number at ${i}`);
      i = NUM_RE.lastIndex;
      return parseFloat(m[0]);
    },
    flag(): boolean {
      skip();
      const c = s[i];
      if (c !== "0" && c !== "1") throw new PathDataError(`Expected an arc flag at ${i}`);
      i++;
      return c === "1";
    },
  };
}

const near = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const reflect = (c: Vec, about: Vec): Vec => ({ x: 2 * about.x - c.x, y: 2 * about.y - c.y });
const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function parsePathData(d: string): Subpath[] {
  const sc = scanner(d);
  const out: Subpath[] = [];
  let sub: Subpath | null = null;
  let cur: Vec = { x: 0, y: 0 };
  let start: Vec = { x: 0, y: 0 };
  let prevCubic: Vec | null = null; // second control of the previous C/S
  let prevQuad: Vec | null = null; // control of the previous Q/T
  let cmd = "";

  const moveTo = (p: Vec) => {
    sub = { nodes: [{ p, in: null, out: null, type: "corner" }], closed: false };
    out.push(sub);
    cur = start = p;
  };
  const active = (): Subpath => {
    if (!sub) moveTo(cur);
    return sub!;
  };
  const lineTo = (p: Vec) => {
    active().nodes.push({ p, in: null, out: null, type: "corner" });
    cur = p;
  };
  const cubicTo = (c1: Vec, c2: Vec, p: Vec) => {
    const s = active();
    s.nodes[s.nodes.length - 1].out = c1;
    s.nodes.push({ p, in: c2, out: null, type: "corner" });
    cur = p;
  };
  const close = () => {
    if (!sub) return;
    const n = sub.nodes;
    if (n.length > 1 && near(n[0].p, n[n.length - 1].p)) {
      n[0].in = n[n.length - 1].in;
      n.pop();
    }
    sub.closed = true;
    sub = null;
    cur = start;
  };

  try {
    while (!sc.done()) {
      const c = sc.command();
      if (c) cmd = c;
      else if (!cmd || cmd === "Z" || cmd === "z" || !sc.hasNumber()) break;

      const rel = cmd !== cmd.toUpperCase();
      const upper = cmd.toUpperCase();
      const point = (): Vec => {
        const x = sc.number();
        const y = sc.number();
        return rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      };
      let nextCubic: Vec | null = null;
      let nextQuad: Vec | null = null;

      switch (upper) {
        case "M":
          moveTo(point());
          cmd = rel ? "l" : "L";
          break;
        case "L":
          lineTo(point());
          break;
        case "H": {
          const x = sc.number();
          lineTo({ x: rel ? cur.x + x : x, y: cur.y });
          break;
        }
        case "V": {
          const y = sc.number();
          lineTo({ x: cur.x, y: rel ? cur.y + y : y });
          break;
        }
        case "C": {
          const c1 = point();
          const c2 = point();
          const p = point();
          cubicTo(c1, c2, p);
          nextCubic = c2;
          break;
        }
        case "S": {
          const c1 = prevCubic ? reflect(prevCubic, cur) : cur;
          const c2 = point();
          const p = point();
          cubicTo(c1, c2, p);
          nextCubic = c2;
          break;
        }
        case "Q":
        case "T": {
          const q = upper === "Q" ? point() : prevQuad ? reflect(prevQuad, cur) : cur;
          const p = point();
          cubicTo(lerp(cur, q, 2 / 3), lerp(p, q, 2 / 3), p);
          nextQuad = q;
          break;
        }
        case "A": {
          const rx = sc.number();
          const ry = sc.number();
          const rot = sc.number();
          const large = sc.flag();
          const sweep = sc.flag();
          const p = point();
          for (const [c1, c2, e] of arcToCubics(cur, rx, ry, rot, large, sweep, p)) cubicTo(c1, c2, e);
          break;
        }
        case "Z":
          close();
          break;
      }
      prevCubic = nextCubic;
      prevQuad = nextQuad;
    }
  } catch (err) {
    // SVG renders a path up to its first error; do the same.
    if (!(err instanceof PathDataError)) throw err;
  }

  for (const sp of out) {
    for (const n of sp.nodes) {
      if (n.in && near(n.in, n.p)) n.in = null;
      if (n.out && near(n.out, n.p)) n.out = null;
    }
  }
  return inferNodeTypes(out);
}

// ---------- node types ----------

function isSmooth(n: PathNode): boolean {
  if (!n.in || !n.out) return false;
  const ax = n.p.x - n.in.x;
  const ay = n.p.y - n.in.y;
  const bx = n.out.x - n.p.x;
  const by = n.out.y - n.p.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return false;
  return Math.abs(ax * by - ay * bx) / (la * lb) < 1e-3 && ax * bx + ay * by > 0;
}

export function inferNodeTypes(subpaths: Subpath[]): Subpath[] {
  return subpaths.map((sp) => ({
    ...sp,
    nodes: sp.nodes.map((n) => ({ ...n, type: isSmooth(n) ? "smooth" : "corner" })),
  }));
}

const CODE: Record<NodeType, string> = { corner: "c", smooth: "s", symmetric: "y" };
const TYPE: Record<string, NodeType> = { c: "corner", s: "smooth", y: "symmetric" };

export function nodeTypesAttr(subpaths: Subpath[]): string {
  return subpaths.map((sp) => sp.nodes.map((n) => CODE[n.type]).join("")).join(" ");
}

export function applyNodeTypes(subpaths: Subpath[], attr: string): Subpath[] {
  const codes = attr.split(" ");
  return subpaths.map((sp, i) => {
    const c = codes[i];
    if (c === undefined || c.length !== sp.nodes.length || [...c].some((ch) => !TYPE[ch])) {
      return sp;
    }
    return { ...sp, nodes: sp.nodes.map((n, j) => ({ ...n, type: TYPE[c[j]] })) };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/pathdata.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add src/svg/pathdata.ts src/__tests__/pathdata.test.ts
git commit -m "feat(svg): path data reader/writer and node-type codec

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Minimal XML parser

Why hand-written: the SVG importer must run in Vitest's node environment (no `DOMParser`) and in
the browser with identical behavior. SVG files only need elements, attributes, comments,
CDATA, processing instructions, a DOCTYPE and the predefined/numeric entities.

**Files:**
- Create: `src/svg/xml.ts`
- Test: `src/__tests__/xml.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type XmlElement = { name: string; attrs: Record<string, string>; children: XmlElement[]; text: string }` (`name` keeps any prefix, e.g. `sodipodi:namedview`; `text` is the concatenated, entity-decoded character data and CDATA directly inside the element)
  - `class XmlError extends Error`
  - `parseXml(src: string): XmlElement` — returns the root element; throws `XmlError` on mismatched/unclosed tags, a missing root, several roots, or an unterminated construct.

- [ ] **Step 1: Write the failing test** — `src/__tests__/xml.test.ts`

```ts
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/xml.test.ts`
Expected: FAIL — cannot resolve `../svg/xml`.

- [ ] **Step 3: Implement** — `src/svg/xml.ts`

```ts
/** A deliberately small XML reader for SVG files. Runs identically in node (tests) and the
 *  browser. No namespaces processing: prefixed names are kept verbatim. */

export type XmlElement = {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
};

export class XmlError extends Error {}

const NAME_RE = /[A-Za-z_:][-\w.:]*/y;
const ATTR_NAME_RE = /[^\s=/>]+/y;

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e]!;
  });
}

export function parseXml(src: string): XmlElement {
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let i = 0;

  const indexOrThrow = (needle: string, from: number, what: string) => {
    const at = src.indexOf(needle, from);
    if (at < 0) throw new XmlError(`Unterminated ${what}`);
    return at;
  };
  const addText = (t: string) => {
    if (stack.length) stack[stack.length - 1].text += t;
  };
  const skipWs = (j: number) => {
    while (j < src.length && /\s/.test(src[j])) j++;
    return j;
  };

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      addText(decode(src.slice(i)));
      break;
    }
    if (lt > i) addText(decode(src.slice(i, lt)));

    if (src.startsWith("<!--", lt)) {
      i = indexOrThrow("-->", lt + 4, "comment") + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const end = indexOrThrow("]]>", lt + 9, "CDATA section");
      addText(src.slice(lt + 9, end));
      i = end + 3;
    } else if (src.startsWith("<?", lt)) {
      i = indexOrThrow("?>", lt + 2, "processing instruction") + 2;
    } else if (src.startsWith("<!", lt)) {
      let j = lt + 2;
      let depth = 0;
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth === 0) break;
      }
      if (j >= src.length) throw new XmlError("Unterminated declaration");
      i = j + 1;
    } else if (src[lt + 1] === "/") {
      const end = indexOrThrow(">", lt, "end tag");
      const name = src.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new XmlError(`Unexpected </${name}>`);
      i = end + 1;
    } else {
      NAME_RE.lastIndex = lt + 1;
      const m = NAME_RE.exec(src);
      if (!m) throw new XmlError(`Invalid tag at ${lt}`);
      const el: XmlElement = { name: m[0], attrs: {}, children: [], text: "" };
      let j = NAME_RE.lastIndex;
      let selfClosing = false;
      for (;;) {
        j = skipWs(j);
        if (j >= src.length) throw new XmlError(`Unterminated <${el.name}>`);
        if (src.startsWith("/>", j)) {
          selfClosing = true;
          j += 2;
          break;
        }
        if (src[j] === ">") {
          j++;
          break;
        }
        ATTR_NAME_RE.lastIndex = j;
        const a = ATTR_NAME_RE.exec(src);
        if (!a) throw new XmlError(`Invalid attribute in <${el.name}>`);
        j = skipWs(ATTR_NAME_RE.lastIndex);
        if (src[j] !== "=") throw new XmlError(`Attribute ${a[0]} has no value`);
        j = skipWs(j + 1);
        const quote = src[j];
        if (quote !== '"' && quote !== "'") throw new XmlError(`Unquoted attribute ${a[0]}`);
        const end = indexOrThrow(quote, j + 1, `attribute ${a[0]}`);
        el.attrs[a[0]] = decode(src.slice(j + 1, end));
        j = end + 1;
      }
      if (stack.length) stack[stack.length - 1].children.push(el);
      else if (root) throw new XmlError("More than one root element");
      else root = el;
      if (!selfClosing) stack.push(el);
      i = j;
    }
  }

  if (stack.length) throw new XmlError(`Unclosed <${stack[stack.length - 1].name}>`);
  if (!root) throw new XmlError("No root element");
  return root;
}
```

Note on the `"<svg a=\"1></svg>"` test: the attribute value never finds its closing quote, so
`indexOrThrow` throws — that is the expected path.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/xml.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/svg/xml.ts src/__tests__/xml.test.ts
git commit -m "feat(svg): minimal XML parser shared by node and browser

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: CSS color and SVG transform parsing

**Files:**
- Create: `src/svg/colors.ts`, `src/svg/transform.ts`
- Test: `src/__tests__/colors-transform.test.ts`

**Interfaces:**
- Consumes: `Mat`, `IDENTITY`, `multiply`, `translate`, `scale`, `rotate`, `skewX`, `skewY`.
- Produces:
  - `type ParsedColor = { kind: "none" } | { kind: "color"; color: string; alpha: number } | { kind: "unsupported" }` — `color` is lowercase `#rrggbb`; `alpha` in 0..1.
  - `parseColor(value: string): ParsedColor | null` — `none`/`transparent` → none; `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`; `rgb()`/`rgba()` with commas or spaces, numbers or percentages, optional `/ alpha`; 148 CSS named colors (case-insensitive); `currentColor` → black; `url(...)` → unsupported; anything else → `null` (caller keeps the inherited value).
  - `parseTransform(value: string): Mat` — `matrix`, `translate`, `scale`, `rotate(a [cx cy])`, `skewX`, `skewY`, composed left to right; an unparseable list → `IDENTITY`.

- [ ] **Step 1: Write the failing test** — `src/__tests__/colors-transform.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { applyMat, IDENTITY } from "../geom/mat";
import { parseColor } from "../svg/colors";
import { parseTransform } from "../svg/transform";

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

  it("parses names, none, currentColor and url()", () => {
    expect(parseColor(" RebeccaPurple ")).toEqual({ kind: "color", color: "#663399", alpha: 1 });
    expect(parseColor("none")).toEqual({ kind: "none" });
    expect(parseColor("transparent")).toEqual({ kind: "none" });
    expect(parseColor("currentColor")).toEqual({ kind: "color", color: "#000000", alpha: 1 });
    expect(parseColor("url(#grad)")).toEqual({ kind: "unsupported" });
    expect(parseColor("url(#grad) red")).toEqual({ kind: "unsupported" });
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
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/colors-transform.test.ts`
Expected: FAIL — cannot resolve `../svg/colors`.

- [ ] **Step 3: Implement** — `src/svg/colors.ts`

```ts
export type ParsedColor =
  | { kind: "none" }
  | { kind: "color"; color: string; alpha: number }
  | { kind: "unsupported" };

const NAMED_SRC =
  "aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc," +
  "bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a," +
  "burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50," +
  "cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b," +
  "darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9," +
  "darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00," +
  "darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f," +
  "darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1," +
  "darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969," +
  "dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff," +
  "gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000," +
  "greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c," +
  "indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5," +
  "lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff," +
  "lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3," +
  "lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa," +
  "lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0," +
  "lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000," +
  "mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db," +
  "mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a," +
  "mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa," +
  "mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6," +
  "olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6," +
  "palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093," +
  "papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd," +
  "powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f," +
  "royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57," +
  "seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd," +
  "slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4," +
  "tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee," +
  "wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32";

const NAMED = new Map(
  NAMED_SRC.split(",").map((pair) => {
    const [name, hex] = pair.split(":");
    return [name, `#${hex}`] as const;
  }),
);

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

function channel(s: string): number | null {
  const v = parseFloat(s);
  if (Number.isNaN(v)) return null;
  return s.endsWith("%") ? (v / 100) * 255 : v;
}

function alphaOf(s: string | undefined): number | null {
  if (s === undefined) return 1;
  const v = parseFloat(s);
  if (Number.isNaN(v)) return null;
  return Math.min(1, Math.max(0, s.endsWith("%") ? v / 100 : v));
}

export function parseColor(value: string): ParsedColor | null {
  const v = value.trim().toLowerCase();
  if (v.startsWith("url(")) return { kind: "unsupported" };
  if (v === "none" || v === "transparent") return { kind: "none" };
  if (v === "currentcolor") return { kind: "color", color: "#000000", alpha: 1 };

  const named = NAMED.get(v);
  if (named) return { kind: "color", color: named, alpha: 1 };

  if (/^#[0-9a-f]+$/.test(v)) {
    let h = v.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const alpha = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return { kind: "color", color: `#${h.slice(0, 6)}`, alpha };
  }

  const m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (m) {
    const [rgbPart, slashAlpha] = m[1].split("/");
    const parts = rgbPart.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const rgb = parts.slice(0, 3).map(channel);
    const alpha = alphaOf(slashAlpha?.trim() ?? parts[3]);
    if (rgb.some((c) => c === null) || alpha === null) return null;
    return { kind: "color", color: `#${rgb.map((c) => hex2(c!)).join("")}`, alpha };
  }
  return null;
}
```

`src/svg/transform.ts`:

```ts
import { IDENTITY, multiply, rotate, scale, skewX, skewY, translate, type Mat } from "../geom/mat";

const FN_RE = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const rad = (deg: number) => (deg * Math.PI) / 180;

function fnMatrix(name: string, a: number[]): Mat | null {
  switch (name) {
    case "matrix":
      return a.length === 6 ? [a[0], a[1], a[2], a[3], a[4], a[5]] : null;
    case "translate":
      return a.length === 1 || a.length === 2 ? translate(a[0], a[1] ?? 0) : null;
    case "scale":
      return a.length === 1 || a.length === 2 ? scale(a[0], a[1] ?? a[0]) : null;
    case "rotate":
      if (a.length === 1) return rotate(rad(a[0]));
      if (a.length === 3) {
        return multiply(translate(a[1], a[2]), multiply(rotate(rad(a[0])), translate(-a[1], -a[2])));
      }
      return null;
    case "skewX":
      return a.length === 1 ? skewX(rad(a[0])) : null;
    case "skewY":
      return a.length === 1 ? skewY(rad(a[0])) : null;
  }
  return null;
}

export function parseTransform(value: string): Mat {
  let result: Mat = IDENTITY;
  let found = false;
  for (const m of value.matchAll(FN_RE)) {
    const args = (m[2].match(NUM_RE) ?? []).map(Number);
    const fm = fnMatrix(m[1], args);
    if (!fm) return IDENTITY; // SVG: an invalid list disables the whole transform
    result = multiply(result, fm);
    found = true;
  }
  return found ? result : IDENTITY;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/colors-transform.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/svg/colors.ts src/svg/transform.ts src/__tests__/colors-transform.test.ts
git commit -m "feat(svg): CSS color and transform-list parsing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Shared SVG attributes and the serializer

**Files:**
- Create: `src/svg/attrs.ts`, `src/svg/serialize.ts`
- Test: `src/__tests__/serialize.test.ts`

**Interfaces:**
- Consumes: document types; `Mat`, `isIdentity`; `fmt`; `subpathsToD`, `nodeTypesAttr`.
- Produces:
  - `type Attrs = Record<string, string>`
  - `styleAttrs(s: Style): Attrs` — always `fill` (`none` when null) and `stroke-width`; `fill-opacity`/`stroke-opacity`/`opacity` only when ≠ 1; `stroke` only when non-null; `stroke-linecap`/`stroke-linejoin` only when not `butt`/`miter` (written even when stroke is null, so they survive a round trip).
  - `shapeAttrs(s: Shape): { tag: "rect" | "ellipse" | "path"; attrs: Attrs }` — geometry attributes, `transform="matrix(…)"` when not identity, `data-sv-name` when named, style attributes; paths add `d` and `data-sv-nodes`; rect writes `rx` only when > 0.
  - `groupAttrs(g: Group): Attrs` — `transform`, `opacity` (≠ 1), `data-sv-name`.
  - `layerAttrs(l: Layer): Attrs` — `data-sv-layer=""`, `data-sv-name`, `data-sv-locked=""` when locked, `display="none"` when hidden.
  - `serializeDoc(doc: Doc): string` — XML prolog, `<svg xmlns width height viewBox="0 0 w h" data-sv-version="1">`, optional `<rect data-sv-background="" …>`, then one `<g>` per layer, two-space indented, attribute values escaped, trailing newline.

- [ ] **Step 1: Write the failing test** — `src/__tests__/serialize.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createDoc, DEFAULT_STYLE, type Doc, type Shape } from "../doc/document";
import { IDENTITY } from "../geom/mat";
import { layerAttrs, shapeAttrs, styleAttrs } from "../svg/attrs";
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

describe("layerAttrs", () => {
  it("marks hidden and locked layers", () => {
    expect(
      layerAttrs({ id: "n1", name: "A", visible: false, locked: true, children: [] }),
    ).toEqual({
      "data-sv-layer": "",
      "data-sv-name": "A",
      "data-sv-locked": "",
      display: "none",
    });
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/serialize.test.ts`
Expected: FAIL — cannot resolve `../svg/attrs`.

- [ ] **Step 3: Implement** — `src/svg/attrs.ts`

```ts
import type { Group, Layer, Shape, Style } from "../doc/document";
import { isIdentity, type Mat } from "../geom/mat";
import { fmt } from "./fmt";
import { nodeTypesAttr, subpathsToD } from "./pathdata";

/** Model → SVG attributes. The canvas renders with these and the exporter writes these, so what
 *  you see is what gets saved. Attribute order here is the order in the file. */

export type Attrs = Record<string, string>;

function transformAttr(m: Mat): Attrs {
  return isIdentity(m) ? {} : { transform: `matrix(${m.map(fmt).join(" ")})` };
}

function nameAttr(name: string | undefined): Attrs {
  return name ? { "data-sv-name": name } : {};
}

export function styleAttrs(s: Style): Attrs {
  const a: Attrs = { fill: s.fill ? s.fill.color : "none" };
  if (s.fill && s.fill.opacity !== 1) a["fill-opacity"] = fmt(s.fill.opacity);
  if (s.stroke) {
    a.stroke = s.stroke.color;
    if (s.stroke.opacity !== 1) a["stroke-opacity"] = fmt(s.stroke.opacity);
  }
  a["stroke-width"] = fmt(s.strokeWidth);
  if (s.cap !== "butt") a["stroke-linecap"] = s.cap;
  if (s.join !== "miter") a["stroke-linejoin"] = s.join;
  if (s.opacity !== 1) a.opacity = fmt(s.opacity);
  return a;
}

export function shapeAttrs(s: Shape): { tag: "rect" | "ellipse" | "path"; attrs: Attrs } {
  const common = { ...transformAttr(s.transform), ...nameAttr(s.name), ...styleAttrs(s.style) };
  switch (s.kind) {
    case "rect":
      return {
        tag: "rect",
        attrs: {
          x: fmt(s.x),
          y: fmt(s.y),
          width: fmt(s.w),
          height: fmt(s.h),
          ...(s.rx > 0 ? { rx: fmt(s.rx) } : {}),
          ...common,
        },
      };
    case "ellipse":
      return {
        tag: "ellipse",
        attrs: { cx: fmt(s.cx), cy: fmt(s.cy), rx: fmt(s.rx), ry: fmt(s.ry), ...common },
      };
    case "path":
      return {
        tag: "path",
        attrs: {
          d: subpathsToD(s.subpaths),
          "data-sv-nodes": nodeTypesAttr(s.subpaths),
          ...common,
        },
      };
  }
}

export function groupAttrs(g: Group): Attrs {
  return {
    ...transformAttr(g.transform),
    ...(g.opacity !== 1 ? { opacity: fmt(g.opacity) } : {}),
    ...nameAttr(g.name),
  };
}

export function layerAttrs(l: Layer): Attrs {
  return {
    "data-sv-layer": "",
    "data-sv-name": l.name,
    ...(l.locked ? { "data-sv-locked": "" } : {}),
    ...(l.visible ? {} : { display: "none" }),
  };
}
```

`src/svg/serialize.ts`:

```ts
import type { Doc, Node } from "../doc/document";
import { groupAttrs, layerAttrs, shapeAttrs, styleAttrs, type Attrs } from "./attrs";
import { fmt } from "./fmt";

const escapeAttr = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function open(tag: string, attrs: Attrs): string {
  const parts = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`);
  return `<${tag}${parts.join("")}`;
}

function element(tag: string, attrs: Attrs, children: string[], depth: number): string {
  const pad = "  ".repeat(depth);
  if (children.length === 0) return `${pad}${open(tag, attrs)}/>`;
  return [`${pad}${open(tag, attrs)}>`, ...children, `${pad}</${tag}>`].join("\n");
}

function node(n: Node, depth: number): string {
  if (n.kind === "group") {
    return element("g", groupAttrs(n), n.children.map((c) => node(c, depth + 1)), depth);
  }
  const { tag, attrs } = shapeAttrs(n);
  return element(tag, attrs, [], depth);
}

export function serializeDoc(doc: Doc): string {
  const { w, h, background } = doc.artboard;
  const body: string[] = [];
  if (background) {
    const fill = styleAttrs({
      fill: background,
      stroke: null,
      strokeWidth: 0,
      cap: "butt",
      join: "miter",
      opacity: 1,
    });
    body.push(
      element(
        "rect",
        {
          "data-sv-background": "",
          x: "0",
          y: "0",
          width: fmt(w),
          height: fmt(h),
          fill: fill.fill,
          ...(fill["fill-opacity"] ? { "fill-opacity": fill["fill-opacity"] } : {}),
        },
        [],
        1,
      ),
    );
  }
  for (const layer of doc.layers) {
    body.push(element("g", layerAttrs(layer), layer.children.map((c) => node(c, 2)), 1));
  }
  const root = element(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: fmt(w),
      height: fmt(h),
      viewBox: `0 0 ${fmt(w)} ${fmt(h)}`,
      "data-sv-version": "1",
    },
    body,
    0,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n${root}\n`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/serialize.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/svg/attrs.ts src/svg/serialize.ts src/__tests__/serialize.test.ts
git commit -m "feat(svg): shared model attributes and SVG serializer

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: SVG import (parse.ts), fixtures and round-trip

**Files:**
- Create: `src/geom/shapes.ts`, `src/svg/parse.ts`, `fixtures/inkscape-layers.svg`, `fixtures/figma-flat.svg`, `fixtures/illustrator-classes.svg`
- Test: `src/__tests__/parse.test.ts`

The fixtures are hand-written in the shape of each tool's real export (they are imported into the
test with Vite's `?raw` suffix, and double as manual test files for the browser pass in Task 16).
When real exports are at hand, add them next to these.

**Interfaces:**
- Consumes: `parseXml`, `XmlError`, `XmlElement`; `parseColor`; `parseTransform`; `parsePathData`, `applyNodeTypes`; `multiply`, `translate`, `isIdentity`; document types, `idFor`, `DOC_VERSION`; `serializeDoc` (tests only); `stripIds` (tests only).
- Produces:
  - `rectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): Subpath` (`src/geom/shapes.ts`) — closed; 4 corner nodes when a radius is 0, else 8 nodes with kappa-length handles.
  - `class SvgError extends Error`
  - `type ParseResult = { doc: Doc; dropped: string[] }`
  - `parseSvg(src: string): ParseResult` — throws `XmlError` for malformed XML and `SvgError` when the root is not `<svg>`; never throws for unsupported content. `dropped` holds unique, human-readable feature labels in first-seen order: `"<text>"`-style element labels, `"gradients/patterns"`, `"CSS classes"`, `"CSS stylesheets"`, `"filters"`, `"clipping/masks"`, `"nested viewBox scaling"`.

**Import rules (spec §4):**
- Artboard = `viewBox` size; else `width`/`height` (units ignored); else 300 × 150. A non-zero `viewBox` origin is compensated with a translate on every top-level node.
- Presentation attributes and inline `style` declarations (style wins) for `fill`, `fill-opacity`, `stroke`, `stroke-opacity`, `stroke-width`, `stroke-linecap`, `stroke-linejoin` inherit down the tree (defaults: fill black, stroke none, width 1, butt, miter). `opacity` applies to the element itself (group or shape). `display: none` skips a non-layer element.
- A color's alpha multiplies into the paint opacity (`fill="#ff000080" fill-opacity="0.5"` → 0.25).
- Files containing any top-level `data-sv-layer` group are read as our own format: `data-sv-background` rect → artboard background, each layer group → a layer. Otherwise, if every rendering top-level child is a `<g>`, each becomes a layer (name from `data-sv-name`, `inkscape:label`, `id`, else `Layer N`; locked when `sodipodi:insensitive="true"`; hidden when `display: none`; a transform/opacity on it is kept by wrapping its children in a group). Otherwise everything goes into one `Layer 1`. With no background rect, the background is `null`.
- Prefixed elements (`sodipodi:*`, `inkscape:*` …) and `defs`, `title`, `desc`, `metadata`, `script` are ignored silently; `style` elements add `"CSS stylesheets"`; unknown elements add `"<name>"`.
- `rect` with equal radii → rect shape (one missing radius copies the other; radii clamp to half the size); unequal radii → `rectPath`. `circle` → ellipse. `line`, `polyline`, `polygon` → path. Zero-size shapes and empty paths are skipped. Empty groups are skipped.
- A document always has at least one layer. Ids are assigned `n1, n2, …` in document order; `nextId` follows the last.

- [ ] **Step 1: Write the fixtures**

`fixtures/inkscape-layers.svg`:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   width="210mm" height="297mm" viewBox="0 0 210 297" version="1.1" id="svg1">
  <sodipodi:namedview id="namedview1" pagecolor="#ffffff" inkscape:zoom="0.7"/>
  <defs id="defs1"/>
  <g inkscape:label="Background" inkscape:groupmode="layer" id="layer1" sodipodi:insensitive="true">
    <rect style="fill:#e0e0e0;stroke:none" id="rect1" width="210" height="297" x="0" y="0"/>
  </g>
  <g inkscape:label="Shapes" inkscape:groupmode="layer" id="layer2" style="fill:#0000ff">
    <circle id="c1" cx="50" cy="50" r="20" style="stroke:#000000;stroke-width:2;fill-opacity:0.5"/>
    <path id="p1" d="m 100,100 a 10,10 0 0 1 20,0 z" style="fill:#ff0000;stroke-linejoin:round"/>
    <text x="10" y="200" id="t1">Hello</text>
  </g>
  <g inkscape:label="Hidden" inkscape:groupmode="layer" id="layer3" style="display:none">
    <ellipse cx="10" cy="10" rx="5" ry="3"/>
  </g>
</svg>
```

`fixtures/figma-flat.svg`:

```xml
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="4" y="4" width="56" height="56" rx="12" fill="url(#paint0_linear)"/>
<path d="M20 32H44" stroke="white" stroke-width="4" stroke-linecap="round"/>
<polygon points="32,10 40,20 24,20" fill="#FFCC00"/>
<defs>
<linearGradient id="paint0_linear" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
<stop stop-color="#5B8CFF"/>
<stop offset="1" stop-color="#7AA3FF"/>
</linearGradient>
</defs>
</svg>
```

`fixtures/illustrator-classes.svg`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 28.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px"
	 viewBox="10 20 100 50" style="enable-background:new 0 0 100 50;" xml:space="preserve">
<style type="text/css">
	.st0{fill:#FF0000;}
</style>
<rect x="10" y="20" class="st0" width="30" height="10"/>
<line fill="none" stroke="#000000" stroke-miterlimit="10" x1="10" y1="20" x2="110" y2="70"/>
<rect x="50" y="30" width="20" height="10" rx="2" ry="4" fill="#00FF00"/>
</svg>
```

- [ ] **Step 2: Write the failing test** — `src/__tests__/parse.test.ts`

```ts
import { describe, expect, it } from "vitest";
import figma from "../../fixtures/figma-flat.svg?raw";
import illustrator from "../../fixtures/illustrator-classes.svg?raw";
import inkscape from "../../fixtures/inkscape-layers.svg?raw";
import { createDoc, DEFAULT_STYLE, type Doc, type PathShape, type Shape } from "../doc/document";
import { rectPath } from "../geom/shapes";
import { parseSvg, SvgError } from "../svg/parse";
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
                    { p: { x: 0, y: 0 }, in: { x: 0, y: 5 }, out: { x: 0, y: -5 }, type: "symmetric" },
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
});

describe("parseSvg — foreign files", () => {
  it("reads Inkscape layers, inherited styles and mm-based viewBox", () => {
    const { doc, dropped } = parseSvg(inkscape);
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
    const { doc, dropped } = parseSvg(figma);
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
    const { doc, dropped } = parseSvg(illustrator);
    expect(doc.artboard).toEqual({ w: 100, h: 50, background: null });
    const [rect, line, rounded] = doc.layers[0].children as Shape[];
    expect(rect.transform).toEqual([1, 0, 0, 1, -10, -20]);
    expect(rect.style.fill).toEqual({ color: "#000000", opacity: 1 }); // class ignored → default
    expect(line.kind).toBe("path");
    expect(rounded.kind).toBe("path");
    expect((rounded as PathShape).subpaths[0].nodes).toHaveLength(8);
    expect(dropped).toEqual(["CSS stylesheets", "CSS classes"]);
  });

  it("multiplies color alpha into opacity and honors style over attributes", () => {
    const { doc } = parseSvg(
      `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="blue" style="fill:#ff000080" fill-opacity="0.5"/></svg>`,
    );
    const [rect] = doc.layers[0].children as Shape[];
    expect(rect.style.fill!.color).toBe("#ff0000");
    expect(rect.style.fill!.opacity).toBeCloseTo(0.25, 2);
  });

  it("skips hidden, empty and zero-size content, keeps groups with opacity", () => {
    const { doc } = parseSvg(
      `<svg width="10" height="10"><rect width="0" height="5"/><g/><path d=""/>` +
        `<circle r="1" style="display:none"/><g opacity="0.5"><circle r="2"/></g></svg>`,
    );
    expect(doc.layers[0].children).toHaveLength(1);
    expect(doc.layers[0].children[0]).toMatchObject({ kind: "group", opacity: 0.5 });
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/__tests__/parse.test.ts`
Expected: FAIL — cannot resolve `../geom/shapes`.

- [ ] **Step 4: Implement `src/geom/shapes.ts`**

```ts
import type { PathNode, Subpath } from "../doc/document";
import type { Vec } from "./vec";

/** Handle length for a quarter-ellipse cubic. */
export const KAPPA = 0.5522847498;

const node = (p: Vec, inH: Vec | null = null, out: Vec | null = null): PathNode => ({
  p,
  in: inH,
  out,
  type: "corner",
});

/** A rectangle as a closed path, clockwise from the top edge. */
export function rectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): Subpath {
  if (rx <= 0 || ry <= 0) {
    return {
      closed: true,
      nodes: [node({ x, y }), node({ x: x + w, y }), node({ x: x + w, y: y + h }), node({ x, y: y + h })],
    };
  }
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  const r = x + w;
  const b = y + h;
  return {
    closed: true,
    nodes: [
      node({ x: x + rx, y }, { x: x + rx - kx, y }, null),
      node({ x: r - rx, y }, null, { x: r - rx + kx, y }),
      node({ x: r, y: y + ry }, { x: r, y: y + ry - ky }, null),
      node({ x: r, y: b - ry }, null, { x: r, y: b - ry + ky }),
      node({ x: r - rx, y: b }, { x: r - rx + kx, y: b }, null),
      node({ x: x + rx, y: b }, null, { x: x + rx - kx, y: b }),
      node({ x, y: b - ry }, { x, y: b - ry + ky }, null),
      node({ x, y: y + ry }, null, { x, y: y + ry - ky }),
    ],
  };
}
```

- [ ] **Step 5: Implement `src/svg/parse.ts`**

```ts
import {
  DOC_VERSION,
  idFor,
  type Doc,
  type Layer,
  type LineCap,
  type LineJoin,
  type Node,
  type Paint,
  type Style,
  type Subpath,
} from "../doc/document";
import { isIdentity, multiply, translate, type Mat } from "../geom/mat";
import { rectPath } from "../geom/shapes";
import { parseColor } from "./colors";
import { applyNodeTypes, parsePathData } from "./pathdata";
import { parseTransform } from "./transform";
import { parseXml, type XmlElement } from "./xml";

export class SvgError extends Error {}

export type ParseResult = { doc: Doc; dropped: string[] };

/** Inherited paint state while walking the tree. */
type Inherited = {
  fill: Paint | null;
  fillOpacity: number;
  stroke: Paint | null;
  strokeOpacity: number;
  strokeWidth: number;
  cap: LineCap;
  join: LineJoin;
};

const ROOT_INHERITED: Inherited = {
  fill: { color: "#000000", opacity: 1 },
  fillOpacity: 1,
  stroke: null,
  strokeOpacity: 1,
  strokeWidth: 1,
  cap: "butt",
  join: "miter",
};

const PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "display",
  "clip-path",
  "mask",
  "filter",
] as const;

const SILENT = new Set(["defs", "title", "desc", "metadata", "script"]);
const CAPS: readonly string[] = ["butt", "round", "square"];
const JOINS: readonly string[] = ["miter", "round", "bevel"];

function num(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function opacityValue(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, v.trim().endsWith("%") ? n / 100 : n));
}

function numbers(v: string | undefined): number[] {
  return (v?.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

export function parseSvg(src: string): ParseResult {
  const root = parseXml(src);
  if (root.name !== "svg" && root.name !== "svg:svg") throw new SvgError("Not an SVG file");

  const dropped: string[] = [];
  const drop = (label: string) => {
    if (!dropped.includes(label)) dropped.push(label);
  };
  let next = 1;
  const newId = () => idFor(next++);

  /** Presentation attributes, overridden by inline style declarations. */
  function props(el: XmlElement): Partial<Record<(typeof PROPS)[number], string>> {
    const out: Partial<Record<(typeof PROPS)[number], string>> = {};
    for (const p of PROPS) if (el.attrs[p] !== undefined) out[p] = el.attrs[p];
    for (const decl of (el.attrs.style ?? "").split(";")) {
      const colon = decl.indexOf(":");
      if (colon < 0) continue;
      const key = decl.slice(0, colon).trim() as (typeof PROPS)[number];
      if ((PROPS as readonly string[]).includes(key)) out[key] = decl.slice(colon + 1).trim();
    }
    if (el.attrs.class !== undefined) drop("CSS classes");
    if (out.filter && out.filter !== "none") drop("filters");
    if ((out["clip-path"] && out["clip-path"] !== "none") || (out.mask && out.mask !== "none")) {
      drop("clipping/masks");
    }
    return out;
  }

  function paint(value: string | undefined, current: Paint | null): Paint | null {
    if (value === undefined) return current;
    const c = parseColor(value);
    if (c === null) return current;
    if (c.kind === "none") return null;
    if (c.kind === "unsupported") {
      drop("gradients/patterns");
      return null;
    }
    return { color: c.color, opacity: c.alpha };
  }

  function inherit(parent: Inherited, p: ReturnType<typeof props>): Inherited {
    const cap = p["stroke-linecap"];
    const join = p["stroke-linejoin"];
    return {
      fill: paint(p.fill, parent.fill),
      fillOpacity: opacityValue(p["fill-opacity"], parent.fillOpacity),
      stroke: paint(p.stroke, parent.stroke),
      strokeOpacity: opacityValue(p["stroke-opacity"], parent.strokeOpacity),
      strokeWidth: Math.max(0, num(p["stroke-width"], parent.strokeWidth)),
      cap: cap && CAPS.includes(cap) ? (cap as LineCap) : parent.cap,
      join: join && JOINS.includes(join) ? (join as LineJoin) : parent.join,
    };
  }

  function style(inh: Inherited, opacity: number): Style {
    const withOpacity = (p: Paint | null, o: number): Paint | null =>
      p ? { color: p.color, opacity: p.opacity * o } : null;
    return {
      fill: withOpacity(inh.fill, inh.fillOpacity),
      stroke: withOpacity(inh.stroke, inh.strokeOpacity),
      strokeWidth: inh.strokeWidth,
      cap: inh.cap,
      join: inh.join,
      opacity,
    };
  }

  function children(el: XmlElement, inh: Inherited): Node[] {
    const out: Node[] = [];
    for (const child of el.children) {
      const n = convert(child, inh);
      if (n) out.push(n);
    }
    return out;
  }

  function pathNode(
    subpaths: Subpath[],
    id: string,
    name: string | undefined,
    transform: Mat,
    st: Style,
  ): Node | null {
    const nonEmpty = subpaths.filter((sp) => sp.nodes.length > 0);
    if (nonEmpty.length === 0) return null;
    return { kind: "path", id, name, transform, style: st, subpaths: nonEmpty };
  }

  function convert(el: XmlElement, inh: Inherited): Node | null {
    const name = el.name.startsWith("svg:") ? el.name.slice(4) : el.name;
    if (name.includes(":") || SILENT.has(name)) return null;
    if (name === "style") {
      drop("CSS stylesheets");
      return null;
    }
    const p = props(el);
    if (p.display === "none") return null;
    const i2 = inherit(inh, p);
    const opacity = opacityValue(p.opacity, 1);
    let transform = parseTransform(el.attrs.transform ?? "");
    const label = el.attrs["data-sv-name"] ?? el.attrs["inkscape:label"];
    const a = el.attrs;

    switch (name) {
      case "g":
      case "a":
      case "svg": {
        if (name === "svg") {
          transform = multiply(transform, translate(num(a.x, 0), num(a.y, 0)));
          if (a.viewBox !== undefined) drop("nested viewBox scaling");
        }
        // Allocate the group id before its children so ids follow document order.
        const id = newId();
        const kids = children(el, i2);
        if (kids.length === 0) return null;
        return { kind: "group", id, name: label, transform, opacity, children: kids };
      }
      case "rect": {
        const w = num(a.width, 0);
        const h = num(a.height, 0);
        if (w <= 0 || h <= 0) return null;
        let rx = a.rx !== undefined ? num(a.rx, 0) : a.ry !== undefined ? num(a.ry, 0) : 0;
        let ry = a.ry !== undefined ? num(a.ry, 0) : rx;
        rx = Math.min(Math.max(0, rx), w / 2);
        ry = Math.min(Math.max(0, ry), h / 2);
        const x = num(a.x, 0);
        const y = num(a.y, 0);
        const st = style(i2, opacity);
        if (rx === ry) {
          return { kind: "rect", id: newId(), name: label, transform, style: st, x, y, w, h, rx };
        }
        return pathNode([rectPath(x, y, w, h, rx, ry)], newId(), label, transform, st);
      }
      case "circle":
      case "ellipse": {
        const rx = name === "circle" ? num(a.r, 0) : num(a.rx, 0);
        const ry = name === "circle" ? rx : num(a.ry, 0);
        if (rx <= 0 || ry <= 0) return null;
        return {
          kind: "ellipse",
          id: newId(),
          name: label,
          transform,
          style: style(i2, opacity),
          cx: num(a.cx, 0),
          cy: num(a.cy, 0),
          rx,
          ry,
        };
      }
      case "line": {
        const corner = (x: number, y: number) => ({
          p: { x, y },
          in: null,
          out: null,
          type: "corner" as const,
        });
        const sp: Subpath = {
          closed: false,
          nodes: [corner(num(a.x1, 0), num(a.y1, 0)), corner(num(a.x2, 0), num(a.y2, 0))],
        };
        return pathNode([sp], newId(), label, transform, style(i2, opacity));
      }
      case "polyline":
      case "polygon": {
        const n = numbers(a.points);
        const nodes = [];
        for (let i = 0; i + 1 < n.length; i += 2) {
          nodes.push({ p: { x: n[i], y: n[i + 1] }, in: null, out: null, type: "corner" as const });
        }
        const sp: Subpath = { closed: name === "polygon", nodes };
        return pathNode([sp], newId(), label, transform, style(i2, opacity));
      }
      case "path": {
        let subpaths = parsePathData(a.d ?? "");
        if (a["data-sv-nodes"] !== undefined) subpaths = applyNodeTypes(subpaths, a["data-sv-nodes"]);
        return pathNode(subpaths, newId(), label, transform, style(i2, opacity));
      }
      default:
        drop(`<${name}>`);
        return null;
    }
  }

  // ----- artboard -----
  const vb = numbers(root.attrs.viewBox);
  let minX = 0;
  let minY = 0;
  let w: number;
  let h: number;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    [minX, minY, w, h] = vb;
  } else {
    w = num(root.attrs.width, 300);
    h = num(root.attrs.height, 150);
    if (!(w > 0)) w = 300;
    if (!(h > 0)) h = 150;
  }
  const rootMat = translate(-minX, -minY);
  const place = (n: Node): Node =>
    isIdentity(rootMat) ? n : { ...n, transform: multiply(rootMat, n.transform) };

  const rootInh = inherit(ROOT_INHERITED, props(root));
  const layers: Layer[] = [];
  let background: Paint | null = null;

  const isRendering = (el: XmlElement) =>
    !el.name.includes(":") && !SILENT.has(el.name) && el.name !== "style";
  const ownFormat = root.children.some((c) => c.name === "g" && c.attrs["data-sv-layer"] !== undefined);
  const topLevel = root.children.filter(isRendering);
  const allGroups = topLevel.length > 0 && topLevel.every((c) => c.name === "g");

  const makeLayer = (el: XmlElement, index: number): Layer => {
    const p = props(el);
    const id = newId();
    const inh = inherit(rootInh, p);
    let kids = children(el, inh);
    const t = parseTransform(el.attrs.transform ?? "");
    const opacity = opacityValue(p.opacity, 1);
    if (!ownFormat && kids.length > 0 && (!isIdentity(t) || opacity !== 1)) {
      kids = [{ kind: "group", id: newId(), transform: t, opacity, children: kids }];
    }
    return {
      id,
      name: el.attrs["data-sv-name"] ?? el.attrs["inkscape:label"] ?? el.attrs.id ?? `Layer ${index + 1}`,
      visible: p.display !== "none",
      locked: el.attrs["data-sv-locked"] !== undefined || el.attrs["sodipodi:insensitive"] === "true",
      children: kids.map(place),
    };
  };

  if (ownFormat || allGroups) {
    for (const el of root.children) {
      // Styles/classes on skipped top-level elements are still reported via props() in convert().
      if (ownFormat && el.name === "rect" && el.attrs["data-sv-background"] !== undefined) {
        const fill = paint(el.attrs.fill, null);
        background = fill && { color: fill.color, opacity: fill.opacity * opacityValue(el.attrs["fill-opacity"], 1) };
        continue;
      }
      if (el.name === "g" && (!ownFormat || el.attrs["data-sv-layer"] !== undefined)) {
        layers.push(makeLayer(el, layers.length));
        continue;
      }
      if (el.name === "style") drop("CSS stylesheets");
      const n = isRendering(el) ? convert(el, rootInh) : null;
      if (n) {
        if (layers.length === 0) {
          layers.push({ id: newId(), name: "Layer 1", visible: true, locked: false, children: [] });
        }
        const last = layers[layers.length - 1];
        last.children = [...last.children, place(n)];
      }
    }
  } else {
    const id = newId();
    layers.push({
      id,
      name: "Layer 1",
      visible: true,
      locked: false,
      children: children(root, rootInh).map(place),
    });
  }

  if (layers.length === 0) {
    layers.push({ id: newId(), name: "Layer 1", visible: true, locked: false, children: [] });
  }

  return {
    doc: { version: DOC_VERSION, artboard: { w, h, background }, layers, nextId: next },
    dropped,
  };
}
```

Notes for the implementer:
- In the own-format round-trip test, ids come out `n1…n6` in the same order the fixture uses, so `nextId` is 7 — the test asserts that.
- In the Figma fixture the `<defs>` after the shapes is silent, and the `url(#paint0_linear)` fill reports `gradients/patterns`. In the Illustrator fixture, `<style>` is met before the first `class` attribute, so the order is `["CSS stylesheets", "CSS classes"]`.
- Illustrator's `stroke-miterlimit` is not modeled and is ignored without a report (it has no visible effect at the default join in most files).

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/parse.test.ts`
Expected: PASS (10 tests). If the round-trip test fails, print both sides with `console.log(JSON.stringify(stripIds(back), null, 1))` and fix the mismatching side — do not loosen the test.

- [ ] **Step 7: Run the full suite and the type check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/geom/shapes.ts src/svg/parse.ts fixtures src/__tests__/parse.test.ts
git commit -m "feat(svg): SVG importer with own-format round-trip and foreign-file support

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Undo history and edit session

**Files:**
- Create: `src/state/history.ts`, `src/state/session.ts`
- Test: `src/__tests__/session.test.ts`

**Interfaces:**
- Consumes: `Doc`, `createDoc`, `setArtboard`.
- Produces:
  - `history.ts` (copied from slop-audio-editor): `HISTORY_LIMIT = 100`; `type History<T> = { past: T[]; future: T[] }`; `createHistory<T>()`; `canUndo(h)`; `canRedo(h)`; `record(h, previous)`; `undo(h, current)` / `redo(h, current)` → `{ history, state } | null`.
  - `session.ts`:
    - `type Session = { doc: Doc; history: History<Doc>; gestureBase: Doc | null; savedDoc: Doc | null }`
    - `newSession(doc: Doc, saved: boolean): Session` — `savedDoc` is `doc` when `saved`, else `null`.
    - `commit(s: Session, next: Doc): Session` — same reference → returns `s`; during a gesture replaces `doc` without recording; otherwise records the previous doc.
    - `beginGesture(s)`: sets `gestureBase = doc` (no-op if a gesture is already open).
    - `endGesture(s)`: records `gestureBase` once iff the doc changed; clears `gestureBase`.
    - `undoSession(s)`, `redoSession(s)`: close an open gesture first; return `s` unchanged when there is nothing to undo/redo.
    - `markSaved(s: Session, doc: Doc): Session` — `savedDoc = doc` (the doc that was actually written, which may be older than `s.doc`).
    - `isDirty(s: Session): boolean` — `s.doc !== s.savedDoc`.

- [ ] **Step 1: Write the failing test** — `src/__tests__/session.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createDoc } from "../doc/document";
import { setArtboard } from "../doc/edits";
import { HISTORY_LIMIT } from "../state/history";
import {
  beginGesture,
  commit,
  endGesture,
  isDirty,
  markSaved,
  newSession,
  redoSession,
  undoSession,
} from "../state/session";

const resize = (w: number) => (d: ReturnType<typeof createDoc>) =>
  setArtboard(d, { ...d.artboard, w });

describe("session", () => {
  it("starts clean or dirty", () => {
    const doc = createDoc(10, 10);
    expect(isDirty(newSession(doc, true))).toBe(false);
    expect(isDirty(newSession(doc, false))).toBe(true);
  });

  it("commit records one undo step and ignores no-ops", () => {
    const s0 = newSession(createDoc(10, 10), true);
    expect(commit(s0, s0.doc)).toBe(s0);
    const s1 = commit(s0, resize(20)(s0.doc));
    expect(s1.doc.artboard.w).toBe(20);
    expect(s1.history.past).toEqual([s0.doc]);
    expect(isDirty(s1)).toBe(true);
    const back = undoSession(s1);
    expect(back.doc).toBe(s0.doc);
    expect(isDirty(back)).toBe(false);
    const again = redoSession(back);
    expect(again.doc).toBe(s1.doc);
  });

  it("a gesture records one step for many amends", () => {
    let s = newSession(createDoc(10, 10), true);
    const start = s.doc;
    s = beginGesture(s);
    s = commit(s, resize(11)(s.doc));
    s = commit(s, resize(12)(s.doc));
    s = beginGesture(s); // nested begin is ignored
    s = endGesture(s);
    expect(s.gestureBase).toBeNull();
    expect(s.history.past).toEqual([start]);
    expect(undoSession(s).doc).toBe(start);
  });

  it("a gesture that changes nothing records nothing", () => {
    let s = newSession(createDoc(10, 10), true);
    s = beginGesture(s);
    s = commit(s, resize(11)(s.doc));
    s = commit(s, resize(10)(s.doc));
    // setArtboard returned a NEW object equal in value; only a same-reference end is a no-op,
    // so move back to the base itself to model "dragged and returned".
    s = commit(s, s.gestureBase!);
    s = endGesture(s);
    expect(s.history.past).toEqual([]);
  });

  it("undo closes an open gesture first", () => {
    let s = newSession(createDoc(10, 10), true);
    const start = s.doc;
    s = beginGesture(s);
    s = commit(s, resize(30)(s.doc));
    s = undoSession(s);
    expect(s.doc).toBe(start);
    expect(s.gestureBase).toBeNull();
  });

  it("undo/redo with empty stacks are no-ops", () => {
    const s = newSession(createDoc(10, 10), true);
    expect(undoSession(s)).toBe(s);
    expect(redoSession(s)).toBe(s);
  });

  it("markSaved uses the doc that was written", () => {
    let s = newSession(createDoc(10, 10), false);
    const written = s.doc;
    s = commit(s, resize(40)(s.doc)); // edit while the save was in flight
    s = markSaved(s, written);
    expect(isDirty(s)).toBe(true);
    expect(isDirty(undoSession(s))).toBe(false);
  });

  it("caps history length", () => {
    let s = newSession(createDoc(10, 10), true);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) s = commit(s, resize(11 + i)(s.doc));
    expect(s.history.past).toHaveLength(HISTORY_LIMIT);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/session.test.ts`
Expected: FAIL — cannot resolve `../state/history`.

- [ ] **Step 3: Implement** — `src/state/history.ts`

```ts
/** Snapshot undo, generic over the snapshot type. Documents are immutable, so a snapshot is just
 *  a reference — no cloning, no command objects. */

export const HISTORY_LIMIT = 100;

export interface History<T> {
  past: T[];
  future: T[];
}

export function createHistory<T>(): History<T> {
  return { past: [], future: [] };
}

export function canUndo(h: History<unknown>): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History<unknown>): boolean {
  return h.future.length > 0;
}

/** Call with the state as it was BEFORE the edit. A new edit invalidates the redo stack. */
export function record<T>(h: History<T>, previous: T): History<T> {
  const past = [...h.past, previous];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

export function undo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.past.length === 0) return null;
  const past = h.past.slice();
  const state = past.pop()!;
  return { history: { past, future: [...h.future, current] }, state };
}

export function redo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.future.length === 0) return null;
  const future = h.future.slice();
  const state = future.pop()!;
  return { history: { past: [...h.past, current], future }, state };
}
```

`src/state/session.ts`:

```ts
import type { Doc } from "../doc/document";
import { createHistory, record, redo, undo, type History } from "./history";

/** Everything undo needs, as one immutable value. The store holds it in `$state.raw` and
 *  replaces it wholesale, so reference equality (dirty check, no-op detection) stays reliable. */
export type Session = {
  doc: Doc;
  history: History<Doc>;
  /** The doc when the current drag/gesture began; null outside a gesture. */
  gestureBase: Doc | null;
  /** The doc last written to a file; null when the document was never saved as-is. */
  savedDoc: Doc | null;
};

export function newSession(doc: Doc, saved: boolean): Session {
  return { doc, history: createHistory(), gestureBase: null, savedDoc: saved ? doc : null };
}

export function commit(s: Session, next: Doc): Session {
  if (next === s.doc) return s;
  if (s.gestureBase) return { ...s, doc: next };
  return { ...s, doc: next, history: record(s.history, s.doc) };
}

export function beginGesture(s: Session): Session {
  return s.gestureBase ? s : { ...s, gestureBase: s.doc };
}

export function endGesture(s: Session): Session {
  const base = s.gestureBase;
  if (!base) return s;
  if (base === s.doc) return { ...s, gestureBase: null };
  return { ...s, gestureBase: null, history: record(s.history, base) };
}

export function undoSession(s: Session): Session {
  const closed = endGesture(s);
  const r = undo(closed.history, closed.doc);
  return r ? { ...closed, doc: r.state, history: r.history } : closed;
}

export function redoSession(s: Session): Session {
  const closed = endGesture(s);
  const r = redo(closed.history, closed.doc);
  return r ? { ...closed, doc: r.state, history: r.history } : closed;
}

export function markSaved(s: Session, doc: Doc): Session {
  return { ...s, savedDoc: doc };
}

export function isDirty(s: Session): boolean {
  return s.doc !== s.savedDoc;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/session.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/history.ts src/state/session.ts src/__tests__/session.test.ts
git commit -m "feat(state): snapshot history and gesture-aware edit session

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Viewport math and keyboard commands

**Files:**
- Create: `src/state/viewport.ts`, `src/state/keys.ts`
- Test: `src/__tests__/viewport-keys.test.ts`

**Interfaces:**
- Consumes: `Vec`, `mid`, `dist`.
- Produces:
  - `viewport.ts`:
    - `type View = { x: number; y: number; zoom: number }` — `screen = doc · zoom + (x, y)`, screen = CSS px relative to the canvas element.
    - `MIN_ZOOM = 0.02`, `MAX_ZOOM = 64`, `clampZoom(z)`
    - `docToScreen(v, p)`, `screenToDoc(v, p)`
    - `panBy(v, dx, dy): View`
    - `zoomAt(v, screen: Vec, factor: number): View` — keeps the doc point under `screen` fixed.
    - `fitRect(rect: { x; y; w; h }, viewW: number, viewH: number, margin?: number): View` — margin default 40 px, centered.
    - `pinch(v, a0: Vec, b0: Vec, a1: Vec, b1: Vec): View` — two-finger move from (a0, b0) to (a1, b1): scale by distance ratio around the old midpoint, then pan by the midpoint delta.
    - `wheelView(v, e: { deltaX; deltaY; deltaMode; ctrlKey; metaKey }, at: Vec): View` — ctrl/meta (incl. trackpad pinch in Chromium/Firefox) zooms by `exp(-deltaY · 0.01)`; otherwise pans by `-delta`. `deltaMode` 1 (lines) multiplies by 16, 2 (pages) by 400.
  - `keys.ts`:
    - `type Command = "undo" | "redo" | "save" | "saveAs" | "open" | "fit" | "zoom100" | "zoomIn" | "zoomOut"`
    - `commandForKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): Command | null`

- [ ] **Step 1: Write the failing test** — `src/__tests__/viewport-keys.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { commandForKey } from "../state/keys";
import {
  docToScreen,
  fitRect,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  pinch,
  screenToDoc,
  wheelView,
  zoomAt,
} from "../state/viewport";

const v0 = { x: 10, y: 20, zoom: 2 };

describe("viewport", () => {
  it("converts between doc and screen", () => {
    expect(docToScreen(v0, { x: 5, y: 5 })).toEqual({ x: 20, y: 30 });
    expect(screenToDoc(v0, { x: 20, y: 30 })).toEqual({ x: 5, y: 5 });
  });

  it("pans", () => {
    expect(panBy(v0, 3, -4)).toEqual({ x: 13, y: 16, zoom: 2 });
  });

  it("zooms around a fixed screen point and clamps", () => {
    const at = { x: 100, y: 50 };
    const before = screenToDoc(v0, at);
    const v = zoomAt(v0, at, 3);
    expect(v.zoom).toBe(6);
    const after = screenToDoc(v, at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(v0, at, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(v0, at, 0.00001).zoom).toBe(MIN_ZOOM);
  });

  it("fits and centers a rect", () => {
    const v = fitRect({ x: 0, y: 0, w: 100, h: 50 }, 280, 280, 40);
    expect(v.zoom).toBe(2);
    expect(docToScreen(v, { x: 50, y: 25 })).toEqual({ x: 140, y: 140 });
  });

  it("pinch zooms by the finger-distance ratio and follows the midpoint", () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const out = pinch(v, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 30, y: 10 });
    expect(out.zoom).toBe(2);
    // doc point under the old midpoint (5,0) is now under the new midpoint (20,10)
    expect(docToScreen(out, { x: 5, y: 0 })).toEqual({ x: 20, y: 10 });
  });

  it("wheel pans, and zooms with ctrl/meta", () => {
    const base = { deltaX: 5, deltaY: 10, deltaMode: 0, ctrlKey: false, metaKey: false };
    expect(wheelView(v0, base, { x: 0, y: 0 })).toEqual({ x: 5, y: 10, zoom: 2 });
    expect(wheelView(v0, { ...base, deltaMode: 1 }, { x: 0, y: 0 })).toEqual({
      x: -70,
      y: -140,
      zoom: 2,
    });
    const z = wheelView(v0, { ...base, deltaY: -100, ctrlKey: true }, { x: 0, y: 0 });
    expect(z.zoom).toBeCloseTo(2 * Math.E);
  });
});

describe("commandForKey", () => {
  const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) =>
    commandForKey({ key, metaKey: false, ctrlKey: false, shiftKey: false, ...mods });

  it("maps the file and history shortcuts", () => {
    expect(k("z", { metaKey: true })).toBe("undo");
    expect(k("Z", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(k("y", { ctrlKey: true })).toBe("redo");
    expect(k("s", { ctrlKey: true })).toBe("save");
    expect(k("S", { ctrlKey: true, shiftKey: true })).toBe("saveAs");
    expect(k("o", { metaKey: true })).toBe("open");
  });

  it("maps zoom keys with and without modifiers", () => {
    expect(k("0", { metaKey: true })).toBe("fit");
    expect(k("1", { metaKey: true })).toBe("zoom100");
    expect(k("=")).toBe("zoomIn");
    expect(k("+", { metaKey: true })).toBe("zoomIn");
    expect(k("-")).toBe("zoomOut");
  });

  it("ignores everything else", () => {
    expect(k("z")).toBeNull();
    expect(k("0")).toBeNull();
    expect(k("a", { metaKey: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/viewport-keys.test.ts`
Expected: FAIL — cannot resolve `../state/keys`.

- [ ] **Step 3: Implement** — `src/state/viewport.ts`

```ts
import { dist, mid, type Vec } from "../geom/vec";

/** screen = doc · zoom + (x, y); screen is CSS px relative to the canvas element. */
export type View = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function docToScreen(v: View, p: Vec): Vec {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}

export function screenToDoc(v: View, p: Vec): Vec {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

export function panBy(v: View, dx: number, dy: number): View {
  return { x: v.x + dx, y: v.y + dy, zoom: v.zoom };
}

export function zoomAt(v: View, screen: Vec, factor: number): View {
  const zoom = clampZoom(v.zoom * factor);
  const d = screenToDoc(v, screen);
  return { x: screen.x - d.x * zoom, y: screen.y - d.y * zoom, zoom };
}

export function fitRect(
  rect: { x: number; y: number; w: number; h: number },
  viewW: number,
  viewH: number,
  margin = 40,
): View {
  const zoom = clampZoom(Math.min((viewW - 2 * margin) / rect.w, (viewH - 2 * margin) / rect.h));
  return {
    x: (viewW - rect.w * zoom) / 2 - rect.x * zoom,
    y: (viewH - rect.h * zoom) / 2 - rect.y * zoom,
    zoom,
  };
}

export function pinch(v: View, a0: Vec, b0: Vec, a1: Vec, b1: Vec): View {
  const m0 = mid(a0, b0);
  const m1 = mid(a1, b1);
  const d0 = dist(a0, b0);
  const factor = d0 > 0 ? dist(a1, b1) / d0 : 1;
  return panBy(zoomAt(v, m0, factor), m1.x - m0.x, m1.y - m0.y);
}

export type WheelLike = {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
};

export function wheelView(v: View, e: WheelLike, at: Vec): View {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  if (e.ctrlKey || e.metaKey) return zoomAt(v, at, Math.exp(-dy * 0.01));
  return panBy(v, -dx, -dy);
}
```

`src/state/keys.ts`:

```ts
export type Command =
  | "undo"
  | "redo"
  | "save"
  | "saveAs"
  | "open"
  | "fit"
  | "zoom100"
  | "zoomIn"
  | "zoomOut";

export type KeyLike = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean };

/** New document has no shortcut on purpose: browsers reserve ⌘N / Ctrl+N. */
export function commandForKey(e: KeyLike): Command | null {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod) {
    switch (k) {
      case "z":
        return e.shiftKey ? "redo" : "undo";
      case "y":
        return "redo";
      case "s":
        return e.shiftKey ? "saveAs" : "save";
      case "o":
        return "open";
      case "0":
        return "fit";
      case "1":
        return "zoom100";
    }
  }
  if (k === "=" || k === "+") return "zoomIn";
  if (k === "-" || k === "_") return "zoomOut";
  return null;
}
```

Check against the test: in the `deltaMode: 1` case, `dx = 80`, `dy = 160`, so the result is
`{ x: 10 - 80, y: 20 - 160 }` = `{ -70, -140 }`. For the ctrl case, `exp(-(-100)·0.01) = e`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/viewport-keys.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/viewport.ts src/state/keys.ts src/__tests__/viewport-keys.test.ts
git commit -m "feat(state): viewport pan/zoom/pinch math and keyboard command map

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Store, canvas rendering and pan/zoom

UI tasks (12–15) have no unit tests: Vitest runs without a DOM. Their gate is
`npm run build` (0 errors, 0 warnings), `npm run lint`, and the browser check in each task.

**Files:**
- Create: `src/state/appState.svelte.ts`, `src/lib/Canvas.svelte`, `src/lib/NodeView.svelte`
- Modify: `src/App.svelte` (replace the placeholder)

**Interfaces:**
- Consumes: `Session`, `newSession`, `commit`, `beginGesture`, `endGesture`, `undoSession`, `redoSession`, `markSaved`, `isDirty`; `canUndo`, `canRedo`; `View`, `fitRect`, `zoomAt`, `panBy`, `pinch`, `screenToDoc`, `wheelView`; `createDoc`, `Doc`, `Node`; `groupAttrs`, `shapeAttrs`; `Vec`.
- Produces (`src/state/appState.svelte.ts`):
  - `app` — instance of `AppState` with reactive fields `session` (raw), `fileName`, `view` (raw), `viewportSize` (raw `{ w, h }`), `fitNonce`, `notices` (raw `Notice[]`), `dialog` (`DialogKind`), `confirm` (raw `ConfirmRequest | null`); plain field `fileHandle: FileSystemFileHandle | null`; getters `doc`, `dirty`, `canUndo`, `canRedo`.
  - Types `Notice = { id: number; kind: "info" | "error"; text: string }`, `DialogKind = "new" | "settings" | null`, `ConfirmRequest = { text: string; confirmLabel: string; resolve: (ok: boolean) => void }`.
  - Actions: `commitDoc(next: Doc)`, `beginDocGesture()`, `endDocGesture()`, `undo()`, `redo()`, `replaceDocument(doc: Doc, fileName: string, handle: FileSystemFileHandle | null, saved: boolean)`, `markDocSaved(doc: Doc, fileName: string, handle: FileSystemFileHandle | null)`, `setView(v: View)`, `setViewportSize(w: number, h: number)`, `fitArtboard()`, `zoomBy(factor: number)`, `zoomTo(zoom: number)`, `notify(kind: Notice["kind"], text: string)`, `dismissNotice(id: number)`, `askConfirm(text: string, confirmLabel: string): Promise<boolean>`.
- `Canvas.svelte` props: `{ oncursor: (p: Vec | null) => void }` — reports the pointer position in document coordinates.
- `NodeView.svelte` props: `{ node: Node }`.

- [ ] **Step 1: Write the store** — `src/state/appState.svelte.ts`

```ts
import { createDoc, type Doc } from "../doc/document";
import { canRedo, canUndo } from "./history";
import {
  beginGesture,
  commit,
  endGesture,
  isDirty,
  markSaved,
  newSession,
  redoSession,
  undoSession,
  type Session,
} from "./session";
import { fitRect, zoomAt, type View } from "./viewport";

export type Notice = { id: number; kind: "info" | "error"; text: string };
export type DialogKind = "new" | "settings" | null;
export type ConfirmRequest = {
  text: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
};

/** The single app store. Exported as `app`, never `state`, so components that use the `$state`
 *  rune can import it without the `store_rune_conflict` error the sibling apps hit.
 *  Immutable values (session, view, notices) are `$state.raw`: they are replaced, never mutated,
 *  and raw keeps reference equality intact for the dirty check. */
class AppState {
  session = $state.raw<Session>(newSession(createDoc(1920, 1080), true));
  fileName = $state("Untitled.svg");
  view = $state.raw<View>({ x: 0, y: 0, zoom: 1 });
  viewportSize = $state.raw({ w: 0, h: 0 });
  /** Bumped to ask the canvas to fit the artboard (on load and on document replace). */
  fitNonce = $state(0);
  notices = $state.raw<Notice[]>([]);
  dialog = $state<DialogKind>(null);
  confirm = $state.raw<ConfirmRequest | null>(null);
  /** Where Save writes without asking. Not reactive: nothing renders from it. */
  fileHandle: FileSystemFileHandle | null = null;

  get doc(): Doc {
    return this.session.doc;
  }
  get dirty(): boolean {
    return isDirty(this.session);
  }
  get canUndo(): boolean {
    return canUndo(this.session.history);
  }
  get canRedo(): boolean {
    return canRedo(this.session.history);
  }
}

export const app = new AppState();

export function commitDoc(next: Doc): void {
  app.session = commit(app.session, next);
}

export function beginDocGesture(): void {
  app.session = beginGesture(app.session);
}

export function endDocGesture(): void {
  app.session = endGesture(app.session);
}

export function undo(): void {
  app.session = undoSession(app.session);
}

export function redo(): void {
  app.session = redoSession(app.session);
}

export function replaceDocument(
  doc: Doc,
  fileName: string,
  handle: FileSystemFileHandle | null,
  saved: boolean,
): void {
  app.session = newSession(doc, saved);
  app.fileName = fileName;
  app.fileHandle = handle;
  app.fitNonce++;
}

export function markDocSaved(doc: Doc, fileName: string, handle: FileSystemFileHandle | null): void {
  app.session = markSaved(app.session, doc);
  app.fileName = fileName;
  app.fileHandle = handle;
}

export function setView(v: View): void {
  app.view = v;
}

export function setViewportSize(w: number, h: number): void {
  if (app.viewportSize.w !== w || app.viewportSize.h !== h) app.viewportSize = { w, h };
}

export function fitArtboard(): void {
  const { w, h } = app.viewportSize;
  if (w <= 0 || h <= 0) return;
  const ab = app.doc.artboard;
  app.view = fitRect({ x: 0, y: 0, w: ab.w, h: ab.h }, w, h);
}

export function zoomBy(factor: number): void {
  const { w, h } = app.viewportSize;
  app.view = zoomAt(app.view, { x: w / 2, y: h / 2 }, factor);
}

export function zoomTo(zoom: number): void {
  zoomBy(zoom / app.view.zoom);
}

let noticeSeq = 0;

export function notify(kind: Notice["kind"], text: string): void {
  const id = ++noticeSeq;
  app.notices = [...app.notices, { id, kind, text }];
  // Errors stay until dismissed; info fades on its own.
  if (kind === "info") setTimeout(() => dismissNotice(id), 6000);
}

export function dismissNotice(id: number): void {
  app.notices = app.notices.filter((n) => n.id !== id);
}

/** In-app replacement for window.confirm (native dialogs block the page and browser automation). */
export function askConfirm(text: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    app.confirm = {
      text,
      confirmLabel,
      resolve: (ok) => {
        app.confirm = null;
        resolve(ok);
      },
    };
  });
}
```

- [ ] **Step 2: Write `src/lib/NodeView.svelte`**

```svelte
<svelte:options namespace="svg" />

<script lang="ts">
  import type { Node } from "../doc/document";
  import { groupAttrs, shapeAttrs } from "../svg/attrs";
  import NodeView from "./NodeView.svelte";

  let { node }: { node: Node } = $props();
</script>

<!-- Renders through the same attribute functions the SVG exporter uses. -->
{#if node.kind === "group"}
  <g {...groupAttrs(node)}>
    {#each node.children as child (child.id)}
      <NodeView node={child} />
    {/each}
  </g>
{:else}
  {@const s = shapeAttrs(node)}
  {#if s.tag === "rect"}
    <rect {...s.attrs} />
  {:else if s.tag === "ellipse"}
    <ellipse {...s.attrs} />
  {:else}
    <path {...s.attrs} />
  {/if}
{/if}
```

- [ ] **Step 3: Write `src/lib/Canvas.svelte`**

```svelte
<script lang="ts">
  import { untrack } from "svelte";
  import type { Vec } from "../geom/vec";
  import { app, fitArtboard, setView, setViewportSize } from "../state/appState.svelte";
  import { panBy, pinch, screenToDoc, wheelView, zoomAt } from "../state/viewport";
  import NodeView from "./NodeView.svelte";

  let { oncursor }: { oncursor: (p: Vec | null) => void } = $props();

  let host: HTMLDivElement;
  let width = $state(0);
  let height = $state(0);
  let panning = $state(false);
  /** Active pointers in canvas-local px. A plain Map: nothing renders from it. */
  const pointers = new Map<number, Vec>();

  const ready = $derived(width > 0 && height > 0);
  const view = $derived(app.view);
  const artboard = $derived(app.doc.artboard);

  $effect(() => {
    setViewportSize(width, height);
  });

  // Fit when the canvas first gets a size and whenever a document is replaced.
  $effect(() => {
    void app.fitNonce;
    if (ready) untrack(fitArtboard);
  });

  function local(e: { clientX: number; clientY: number }): Vec {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onpointerdown(e: PointerEvent) {
    host.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    // M1 has no editing tools, so every single-pointer drag pans. Milestone 2 routes this through
    // the active tool and keeps panning for Space / middle button / Hand.
    panning = true;
  }

  function onpointermove(e: PointerEvent) {
    const p = local(e);
    oncursor(screenToDoc(app.view, p));
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (pointers.size >= 2) {
      // Pinch with the first two pointers; any further finger is ignored.
      const [idA, idB] = [...pointers.keys()];
      if (e.pointerId === idA || e.pointerId === idB) {
        const other = pointers.get(e.pointerId === idA ? idB : idA)!;
        setView(pinch(app.view, prev, other, p, other));
      }
    } else if (panning) {
      setView(panBy(app.view, p.x - prev.x, p.y - prev.y));
    }
    pointers.set(e.pointerId, p);
  }

  function onpointerend(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) panning = false;
  }

  $effect(() => {
    // Non-passive so preventDefault stops page scroll / browser zoom.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView(wheelView(app.view, e, local(e)));
    };
    // Safari desktop reports trackpad pinch as proprietary gesture events, not ctrl+wheel.
    // On iPad the same events accompany touch pinches, which the pointer path already handles.
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (pointers.size > 0) return;
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      setView(zoomAt(app.view, local(g), g.scale / lastScale));
      lastScale = g.scale;
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("gesturestart", onGestureStart);
    host.addEventListener("gesturechange", onGestureChange);
    return () => {
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("gesturestart", onGestureStart);
      host.removeEventListener("gesturechange", onGestureChange);
    };
  });
</script>

<div
  bind:this={host}
  bind:clientWidth={width}
  bind:clientHeight={height}
  class="relative h-full w-full overflow-hidden bg-ground"
  class:cursor-grabbing={panning}
  style="touch-action: none"
  role="application"
  aria-label="Drawing canvas"
  {onpointerdown}
  {onpointermove}
  onpointerup={onpointerend}
  onpointercancel={onpointerend}
  onpointerleave={() => {
    if (pointers.size === 0) oncursor(null);
  }}
>
  <svg class="absolute inset-0" {width} {height}>
    <defs>
      <pattern id="sv-checker" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="#ffffff" />
        <rect width="8" height="8" fill="#d4d4d8" />
        <rect x="8" y="8" width="8" height="8" fill="#d4d4d8" />
      </pattern>
    </defs>
    <g transform="matrix({view.zoom} 0 0 {view.zoom} {view.x} {view.y})">
      <rect x="0" y="0" width={artboard.w} height={artboard.h} fill="url(#sv-checker)" />
      {#if artboard.background}
        <rect
          x="0"
          y="0"
          width={artboard.w}
          height={artboard.h}
          fill={artboard.background.color}
          fill-opacity={artboard.background.opacity}
        />
      {/if}
      {#each app.doc.layers as layer (layer.id)}
        {#if layer.visible}
          <g>
            {#each layer.children as node (node.id)}
              <NodeView {node} />
            {/each}
          </g>
        {/if}
      {/each}
      <rect
        x="0"
        y="0"
        width={artboard.w}
        height={artboard.h}
        fill="none"
        stroke="#000000"
        stroke-opacity="0.35"
        vector-effect="non-scaling-stroke"
        pointer-events="none"
      />
    </g>
  </svg>
</div>
```

If svelte-check reports an a11y warning for the pointer handlers on the `div` despite
`role="application"`, keep the role and add `tabindex="-1"`; do not suppress the warning with an
ignore comment unless both fail.

- [ ] **Step 4: Replace `src/App.svelte`**

```svelte
<script lang="ts">
  import type { Vec } from "./geom/vec";
  import Canvas from "./lib/Canvas.svelte";

  let cursor = $state<Vec | null>(null);
</script>

<div class="flex h-full flex-col">
  <main class="min-h-0 flex-1">
    <Canvas oncursor={(p) => (cursor = p)} />
  </main>
  <footer class="flex h-7 items-center border-t border-line bg-panel px-3 text-xs text-muted">
    {cursor ? `${cursor.x.toFixed(1)}, ${cursor.y.toFixed(1)}` : ""}
  </footer>
</div>
```

(Task 14 replaces the footer with `StatusBar` and adds `TopBar`.)

- [ ] **Step 5: Verify build and lint**

Run: `npm run build && npm run lint && npm test`
Expected: `svelte-check found 0 errors and 0 warnings`, build succeeds, lint silent, all tests pass.

- [ ] **Step 6: Verify in the browser**

Run `npm run dev` in the background, open the printed URL (Chrome via the claude-in-chrome tools, or ask the user).
Expected:
- A white 1920 × 1080 artboard fitted and centered on the dark pasteboard, with a faint outline.
- Dragging pans; the wheel pans; Ctrl/⌘+wheel (or trackpad pinch) zooms around the pointer.
- The footer shows document coordinates; (0, 0) is the artboard's top-left.
- Resizing the window does NOT refit.

Temporarily check rendering by pasting this in the dev console, then reload to discard:

```js
// Dev-only smoke check — not committed.
const m = await import("/src/state/appState.svelte.ts");
const p = await import("/src/svg/parse.ts");
m.replaceDocument(p.parseSvg(`<svg viewBox="0 0 200 100"><rect x="10" y="10" width="80" height="40" rx="8" fill="tomato"/><circle cx="150" cy="50" r="30" fill="none" stroke="navy" stroke-width="4"/></svg>`).doc, "test.svg", null, true);
```

Expected: a 200 × 100 artboard (transparent → checkerboard) with a rounded tomato rectangle and a navy ring, fitted to the window.

- [ ] **Step 7: Commit**

```bash
git add src/state/appState.svelte.ts src/lib/Canvas.svelte src/lib/NodeView.svelte src/App.svelte
git commit -m "feat(ui): app store and SVG canvas with pan, wheel and pinch zoom

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: File open/save, dialogs and notices

**Files:**
- Create: `src/persist/file-io.ts`, `src/persist/project-io.ts`, `src/lib/Modal.svelte`, `src/lib/NewDocumentDialog.svelte`, `src/lib/DocumentSettingsDialog.svelte`, `src/lib/ConfirmDialog.svelte`, `src/lib/Notices.svelte`

**Interfaces:**
- Consumes: `app`, `askConfirm`, `commitDoc`, `markDocSaved`, `notify`, `dismissNotice`, `replaceDocument`, `ConfirmRequest`; `createDoc`, `isValidArtboardSize`, `MAX_ARTBOARD`; `setArtboard`; `parseSvg`; `serializeDoc`.
- Produces:
  - `file-io.ts`: `type OpenedFile = { text: string; name: string; handle: FileSystemFileHandle | null }`; `pickSvgFile(): Promise<OpenedFile | null>` (null = cancelled); `writeSvgFile(text: string, name: string, handle: FileSystemFileHandle | null, asNew: boolean): Promise<{ name: string; handle: FileSystemFileHandle | null } | null>` (null = cancelled).
  - `project-io.ts`: `createNewDocument(w: number, h: number): void`; `openDocument(): Promise<void>`; `openText(text: string, name: string, handle: FileSystemFileHandle | null): void`; `saveDocument(asNew: boolean): Promise<void>`; `errorMessage(err: unknown): string`.
  - `Modal.svelte` props: `{ title: string; onclose: () => void; children: Snippet; actions: Snippet }`.
  - `ConfirmDialog.svelte` props: `{ request: ConfirmRequest }`.
  - `NewDocumentDialog.svelte`, `DocumentSettingsDialog.svelte`, `Notices.svelte`: no props.

- [ ] **Step 1: Write `src/persist/file-io.ts`**

```ts
/** Open/save plain .svg files. Chromium desktop gets the File System Access API (save in place);
 *  everything else (iPad Safari, Firefox) opens through a file input and saves as a download. */

type PickerType = { description: string; accept: Record<string, string[]> };

declare global {
  interface Window {
    showOpenFilePicker?: (opts: { types: PickerType[] }) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (opts: {
      suggestedName: string;
      types: PickerType[];
    }) => Promise<FileSystemFileHandle>;
  }
}

const TYPES: PickerType[] = [{ description: "SVG image", accept: { "image/svg+xml": [".svg"] } }];

export type OpenedFile = { text: string; name: string; handle: FileSystemFileHandle | null };

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

export async function pickSvgFile(): Promise<OpenedFile | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: TYPES });
      const file = await handle.getFile();
      return { text: await file.text(), name: file.name, handle };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
  return file ? { text: await file.text(), name: file.name, handle: null } : null;
}

async function writeTo(handle: FileSystemFileHandle, text: string): Promise<void> {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

export async function writeSvgFile(
  text: string,
  name: string,
  handle: FileSystemFileHandle | null,
  asNew: boolean,
): Promise<{ name: string; handle: FileSystemFileHandle | null } | null> {
  if (handle && !asNew) {
    await writeTo(handle, text);
    return { name: handle.name, handle };
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name, types: TYPES });
      await writeTo(h, text);
      return { name: h.name, handle: h };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { name, handle: null };
}
```

If `tsc` reports that `createWritable` does not exist on `FileSystemFileHandle`, add it to the
`declare global` block:
`interface FileSystemFileHandle { createWritable(): Promise<FileSystemWritableFileStream>; }`.

- [ ] **Step 2: Write `src/persist/project-io.ts`**

```ts
import { createDoc } from "../doc/document";
import {
  app,
  askConfirm,
  markDocSaved,
  notify,
  replaceDocument,
} from "../state/appState.svelte";
import { parseSvg } from "../svg/parse";
import { serializeDoc } from "../svg/serialize";
import { pickSvgFile, writeSvgFile } from "./file-io";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createNewDocument(w: number, h: number): void {
  replaceDocument(createDoc(w, h), "Untitled.svg", null, true);
}

export async function openDocument(): Promise<void> {
  if (app.dirty && !(await askConfirm("Discard unsaved changes and open another file?", "Discard"))) {
    return;
  }
  let picked;
  try {
    picked = await pickSvgFile();
  } catch (err) {
    notify("error", `Could not open the file: ${errorMessage(err)}`);
    return;
  }
  if (picked) openText(picked.text, picked.name, picked.handle);
}

/** Parses fully BEFORE touching the open document, so a bad file leaves it intact. */
export function openText(text: string, name: string, handle: FileSystemFileHandle | null): void {
  let result;
  try {
    result = parseSvg(text);
  } catch (err) {
    notify("error", `${name} could not be read: ${errorMessage(err)}`);
    return;
  }
  replaceDocument(result.doc, name, handle, true);
  if (result.dropped.length > 0) {
    notify("info", `Some content was not imported: ${result.dropped.join(", ")}`);
  }
}

export async function saveDocument(asNew: boolean): Promise<void> {
  // Capture the doc being written: edits made while the write is in flight stay dirty.
  const doc = app.doc;
  try {
    const r = await writeSvgFile(serializeDoc(doc), app.fileName, app.fileHandle, asNew);
    if (r) markDocSaved(doc, r.name, r.handle);
  } catch (err) {
    notify("error", `Save failed: ${errorMessage(err)}`);
  }
}
```

- [ ] **Step 3: Write `src/lib/Modal.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    onclose,
    children,
    actions,
  }: { title: string; onclose: () => void; children: Snippet; actions: Snippet } = $props();
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onclose();
  }}
/>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
  <div
    class="w-full max-w-sm rounded-lg border border-line bg-panel p-4 shadow-xl"
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <h2 class="mb-3 text-sm font-semibold">{title}</h2>
    {@render children()}
    <div class="mt-4 flex justify-end gap-2">
      {@render actions()}
    </div>
  </div>
</div>
```

- [ ] **Step 4: Write `src/lib/ConfirmDialog.svelte`**

```svelte
<script lang="ts">
  import type { ConfirmRequest } from "../state/appState.svelte";
  import Modal from "./Modal.svelte";

  let { request }: { request: ConfirmRequest } = $props();
</script>

<Modal title="Please confirm" onclose={() => request.resolve(false)}>
  <p class="text-xs text-muted">{request.text}</p>
  {#snippet actions()}
    <button class="btn" onclick={() => request.resolve(false)}>Cancel</button>
    <button class="btn btn-primary" onclick={() => request.resolve(true)}>
      {request.confirmLabel}
    </button>
  {/snippet}
</Modal>
```

- [ ] **Step 5: Write `src/lib/NewDocumentDialog.svelte`**

```svelte
<script lang="ts">
  import { isValidArtboardSize, MAX_ARTBOARD } from "../doc/document";
  import { createNewDocument } from "../persist/project-io";
  import { app } from "../state/appState.svelte";
  import Modal from "./Modal.svelte";

  const PRESETS = [
    { label: "1920 × 1080", w: 1920, h: 1080 },
    { label: "1080 × 1080", w: 1080, h: 1080 },
    { label: "A4 (96 dpi)", w: 794, h: 1123 },
    { label: "800 × 600", w: 800, h: 600 },
    { label: "512 × 512", w: 512, h: 512 },
  ];

  let w = $state<number | null>(1920);
  let h = $state<number | null>(1080);
  const valid = $derived(isValidArtboardSize(w) && isValidArtboardSize(h));

  function close() {
    app.dialog = null;
  }

  function create() {
    if (!isValidArtboardSize(w) || !isValidArtboardSize(h)) return;
    close();
    createNewDocument(w, h);
  }
</script>

<Modal title="New document" onclose={close}>
  <div class="flex flex-wrap gap-1">
    {#each PRESETS as p (p.label)}
      <button
        class="btn"
        class:btn-on={p.w === w && p.h === h}
        onclick={() => {
          w = p.w;
          h = p.h;
        }}>{p.label}</button
      >
    {/each}
  </div>
  <div class="mt-3 flex items-center gap-3 text-xs">
    <label class="flex items-center gap-1">
      W <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={w} />
    </label>
    <label class="flex items-center gap-1">
      H <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={h} />
    </label>
    <span class="text-muted">px</span>
  </div>
  {#if app.dirty}
    <p class="mt-3 text-xs text-warn">The current document has unsaved changes. They will be lost.</p>
  {/if}
  {#snippet actions()}
    <button class="btn" onclick={close}>Cancel</button>
    <button class="btn btn-primary" disabled={!valid} onclick={create}>Create</button>
  {/snippet}
</Modal>
```

- [ ] **Step 6: Write `src/lib/DocumentSettingsDialog.svelte`**

```svelte
<script lang="ts">
  import { isValidArtboardSize, MAX_ARTBOARD } from "../doc/document";
  import { setArtboard } from "../doc/edits";
  import { app, commitDoc } from "../state/appState.svelte";
  import Modal from "./Modal.svelte";

  // The dialog edits a copy; nothing changes until Apply (one undo step).
  const initial = app.doc.artboard;
  let w = $state<number | null>(initial.w);
  let h = $state<number | null>(initial.h);
  let hasBackground = $state(initial.background !== null);
  let color = $state(initial.background?.color ?? "#ffffff");
  const valid = $derived(isValidArtboardSize(w) && isValidArtboardSize(h));

  function close() {
    app.dialog = null;
  }

  function apply() {
    if (!isValidArtboardSize(w) || !isValidArtboardSize(h)) return;
    const background = hasBackground
      ? { color, opacity: initial.background?.opacity ?? 1 }
      : null;
    commitDoc(setArtboard(app.doc, { w, h, background }));
    close();
  }
</script>

<Modal title="Document settings" onclose={close}>
  <div class="flex items-center gap-3 text-xs">
    <label class="flex items-center gap-1">
      W <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={w} />
    </label>
    <label class="flex items-center gap-1">
      H <input class="field w-24" type="number" min="1" max={MAX_ARTBOARD} bind:value={h} />
    </label>
    <span class="text-muted">px</span>
  </div>
  <div class="mt-3 flex items-center gap-3 text-xs">
    <label class="flex items-center gap-2">
      <input type="checkbox" bind:checked={hasBackground} /> Background
    </label>
    <input
      class="h-8 w-12 cursor-pointer rounded border border-line bg-ground disabled:opacity-40"
      type="color"
      disabled={!hasBackground}
      bind:value={color}
      aria-label="Background color"
    />
    {#if !hasBackground}<span class="text-muted">transparent</span>{/if}
  </div>
  {#snippet actions()}
    <button class="btn" onclick={close}>Cancel</button>
    <button class="btn btn-primary" disabled={!valid} onclick={apply}>Apply</button>
  {/snippet}
</Modal>
```

If svelte-check warns `state_referenced_locally` for `initial`, it is a plain `const` read of the
store at mount time, which is the intent (the dialog is recreated each time it opens); rewrite it
as `const initial = untrack(() => app.doc.artboard);` to make that explicit.

- [ ] **Step 7: Write `src/lib/Notices.svelte`**

```svelte
<script lang="ts">
  import { X } from "@lucide/svelte";
  import { app, dismissNotice } from "../state/appState.svelte";
</script>

<div class="pointer-events-none fixed right-3 bottom-10 z-40 flex max-w-sm flex-col gap-2">
  {#each app.notices as n (n.id)}
    <div
      class="pointer-events-auto flex items-start gap-2 rounded border bg-panel px-3 py-2 text-xs shadow-lg"
      class:border-danger={n.kind === "error"}
      class:border-line={n.kind === "info"}
      role={n.kind === "error" ? "alert" : "status"}
    >
      <span class="flex-1 select-text">{n.text}</span>
      <button class="text-muted hover:text-text" aria-label="Dismiss" onclick={() => dismissNotice(n.id)}>
        <X size={14} />
      </button>
    </div>
  {/each}
</div>
```

- [ ] **Step 8: Verify build and lint**

Run: `npm run build && npm run lint`
Expected: 0 errors, 0 warnings; lint silent. (The dialogs are not reachable from the UI until Task 14.)

- [ ] **Step 9: Commit**

```bash
git add src/persist src/lib/Modal.svelte src/lib/ConfirmDialog.svelte src/lib/NewDocumentDialog.svelte src/lib/DocumentSettingsDialog.svelte src/lib/Notices.svelte
git commit -m "feat(files): SVG open/save, new-document and settings dialogs, notices

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Top bar, status bar, keyboard shortcuts

**Files:**
- Create: `src/state/commands.ts`, `src/lib/TopBar.svelte`, `src/lib/StatusBar.svelte`
- Modify: `src/App.svelte`

**Interfaces:**
- Consumes: `Command`, `commandForKey`; `app`, `undo`, `redo`, `fitArtboard`, `zoomBy`, `zoomTo`; `openDocument`, `saveDocument`; all dialogs and `Notices`.
- Produces:
  - `commands.ts`: `ZOOM_STEP = 1.25`; `runCommand(cmd: Command): void`.
  - `StatusBar.svelte` props: `{ cursor: Vec | null }`.
  - `TopBar.svelte`: no props.

- [ ] **Step 1: Write `src/state/commands.ts`**

```ts
import { openDocument, saveDocument } from "../persist/project-io";
import { fitArtboard, redo, undo, zoomBy, zoomTo } from "./appState.svelte";
import type { Command } from "./keys";

export const ZOOM_STEP = 1.25;

/** One place that maps a command to its action, shared by keyboard and buttons. */
export function runCommand(cmd: Command): void {
  switch (cmd) {
    case "undo":
      return undo();
    case "redo":
      return redo();
    case "save":
      void saveDocument(false);
      return;
    case "saveAs":
      void saveDocument(true);
      return;
    case "open":
      void openDocument();
      return;
    case "fit":
      return fitArtboard();
    case "zoom100":
      return zoomTo(1);
    case "zoomIn":
      return zoomBy(ZOOM_STEP);
    case "zoomOut":
      return zoomBy(1 / ZOOM_STEP);
  }
}
```

- [ ] **Step 2: Write `src/lib/TopBar.svelte`**

```svelte
<script lang="ts">
  import { Maximize, Menu, Redo2, Undo2, ZoomIn, ZoomOut } from "@lucide/svelte";
  import { app, type DialogKind } from "../state/appState.svelte";
  import { runCommand } from "../state/commands";
  import type { Command } from "../state/keys";

  let menuOpen = $state(false);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl+";

  function command(cmd: Command) {
    menuOpen = false;
    runCommand(cmd);
  }

  function dialog(kind: DialogKind) {
    menuOpen = false;
    app.dialog = kind;
  }
</script>

<header class="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2 text-xs">
  <div class="relative">
    <button
      class="icon-btn"
      aria-label="File menu"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
    >
      <Menu size={18} />
    </button>
    {#if menuOpen}
      <button
        class="fixed inset-0 z-40 cursor-default"
        aria-label="Close menu"
        tabindex="-1"
        onclick={() => (menuOpen = false)}
      ></button>
      <div
        class="absolute top-full left-0 z-50 mt-1 w-56 rounded border border-line bg-panel py-1 shadow-lg"
        role="menu"
      >
        <button class="menu-item" role="menuitem" onclick={() => dialog("new")}>New…</button>
        <button class="menu-item" role="menuitem" onclick={() => command("open")}>
          Open… <span class="kbd">{mod}O</span>
        </button>
        <button class="menu-item" role="menuitem" onclick={() => command("save")}>
          Save <span class="kbd">{mod}S</span>
        </button>
        <button class="menu-item" role="menuitem" onclick={() => command("saveAs")}>
          Save As… <span class="kbd">⇧{mod}S</span>
        </button>
        <div class="my-1 h-px bg-line"></div>
        <button class="menu-item" role="menuitem" onclick={() => dialog("settings")}>
          Document settings…
        </button>
      </div>
    {/if}
  </div>

  <span class="ml-1 min-w-0 truncate" title={app.fileName}>
    {app.fileName}{#if app.dirty}<span class="text-warn" aria-label="unsaved changes"> ●</span>{/if}
  </span>

  <div class="ml-auto flex items-center gap-1">
    <button
      class="icon-btn"
      aria-label="Undo"
      title="Undo ({mod}Z)"
      disabled={!app.canUndo}
      onclick={() => command("undo")}
    >
      <Undo2 size={18} />
    </button>
    <button
      class="icon-btn"
      aria-label="Redo"
      title="Redo (⇧{mod}Z)"
      disabled={!app.canRedo}
      onclick={() => command("redo")}
    >
      <Redo2 size={18} />
    </button>
    <span class="mx-1 h-5 w-px bg-line"></span>
    <button class="icon-btn" aria-label="Zoom out" title="Zoom out (-)" onclick={() => command("zoomOut")}>
      <ZoomOut size={18} />
    </button>
    <button
      class="h-8 w-14 rounded text-center tabular-nums hover:bg-raised"
      title="Zoom to 100% ({mod}1)"
      onclick={() => command("zoom100")}
    >
      {Math.round(app.view.zoom * 100)}%
    </button>
    <button class="icon-btn" aria-label="Zoom in" title="Zoom in (+)" onclick={() => command("zoomIn")}>
      <ZoomIn size={18} />
    </button>
    <button class="icon-btn" aria-label="Fit artboard" title="Fit artboard ({mod}0)" onclick={() => command("fit")}>
      <Maximize size={18} />
    </button>
  </div>
</header>
```

If `@lucide/svelte` does not export one of these names, look it up in
`node_modules/@lucide/svelte/dist/icons/` and use the current name — do not add another icon
package.

- [ ] **Step 3: Write `src/lib/StatusBar.svelte`**

```svelte
<script lang="ts">
  import type { Vec } from "../geom/vec";
  import { app } from "../state/appState.svelte";

  let { cursor }: { cursor: Vec | null } = $props();
  const ab = $derived(app.doc.artboard);
</script>

<footer
  class="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-xs text-muted tabular-nums"
>
  <span>Drag to pan · pinch or ⌘/Ctrl + wheel to zoom</span>
  <span class="ml-auto">{ab.w} × {ab.h} px</span>
  <span class="w-28 text-right">
    {cursor ? `${cursor.x.toFixed(1)}, ${cursor.y.toFixed(1)}` : "–"}
  </span>
</footer>
```

- [ ] **Step 4: Replace `src/App.svelte`**

```svelte
<script lang="ts">
  import type { Vec } from "./geom/vec";
  import Canvas from "./lib/Canvas.svelte";
  import ConfirmDialog from "./lib/ConfirmDialog.svelte";
  import DocumentSettingsDialog from "./lib/DocumentSettingsDialog.svelte";
  import NewDocumentDialog from "./lib/NewDocumentDialog.svelte";
  import Notices from "./lib/Notices.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import TopBar from "./lib/TopBar.svelte";
  import { app } from "./state/appState.svelte";
  import { runCommand } from "./state/commands";
  import { commandForKey } from "./state/keys";

  let cursor = $state<Vec | null>(null);

  function isEditable(t: EventTarget | null): boolean {
    return (
      t instanceof HTMLElement &&
      (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")
    );
  }

  function onkeydown(e: KeyboardEvent) {
    // Modals own the keyboard (Modal.svelte handles Escape).
    if (app.dialog || app.confirm || isEditable(e.target)) return;
    const cmd = commandForKey(e);
    if (!cmd) return;
    e.preventDefault();
    runCommand(cmd);
  }
</script>

<svelte:window {onkeydown} />

<div class="flex h-full flex-col">
  <TopBar />
  <main class="min-h-0 flex-1">
    <Canvas oncursor={(p) => (cursor = p)} />
  </main>
  <StatusBar {cursor} />
</div>

<Notices />

{#if app.dialog === "new"}
  <NewDocumentDialog />
{:else if app.dialog === "settings"}
  <DocumentSettingsDialog />
{/if}

{#if app.confirm}
  <ConfirmDialog request={app.confirm} />
{/if}
```

- [ ] **Step 5: Verify build, lint and tests**

Run: `npm run build && npm run lint && npm test`
Expected: 0 errors, 0 warnings; lint silent; all tests pass.

- [ ] **Step 6: Verify in the browser (desktop Chrome)**

With `npm run dev` running:
1. Menu → Document settings… → set 400 × 300, untick Background → Apply. Expected: artboard becomes 400 × 300 with a checkerboard; file name shows `●`; Undo button enabled.
2. ⌘Z / Ctrl+Z → back to 1920 × 1080 white, `●` gone. ⇧⌘Z → 400 × 300 again.
3. Menu → Open… → `fixtures/inkscape-layers.svg`. Expected: A4-shaped artboard with a grey page, a translucent blue circle with a black stroke, a red half-disc; an info notice lists `<text>`; the Hidden layer's ellipse is not drawn.
4. Open `fixtures/figma-flat.svg` and `fixtures/illustrator-classes.svg`. Expected: shapes render; notices list the dropped features.
5. Make an edit (step 1), then Menu → Open… Expected: the in-app confirm appears; Cancel keeps the document.
6. Save As… → pick a new file name. Expected: the file name updates, `●` disappears. Open the saved file in a new browser tab: it renders the same as the canvas. Re-open it in the app: identical, no notice.
7. Menu → New… → 512 × 512 → Create. Expected: fitted white 512 × 512 artboard, `Untitled.svg`, no `●`.
8. `-`, `=`, ⌘0, ⌘1 and the zoom buttons change zoom around the canvas center; the % label updates.
9. Paste a file that is not XML (rename any `.txt` to `.svg`) → Open. Expected: an error notice; the previous document is still shown.

- [ ] **Step 7: Commit**

```bash
git add src/state/commands.ts src/lib/TopBar.svelte src/lib/StatusBar.svelte src/App.svelte
git commit -m "feat(ui): top bar with file menu, undo/redo and zoom; status bar; shortcuts

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Autosave and restore

**Files:**
- Create: `src/persist/autosave.ts`
- Modify: `src/persist/project-io.ts`, `src/App.svelte`

**Interfaces:**
- Consumes: `app`, `notify`, `replaceDocument`, `serializeDoc`, `parseSvg`, `errorMessage`.
- Produces:
  - `autosave.ts`: `type AutosaveRecord = { svg: string; fileName: string; dirty: boolean }`; `AUTOSAVE_DEBOUNCE_MS = 3000`; `loadAutosave(): Promise<AutosaveRecord | null>`; `writeAutosave(rec: AutosaveRecord): Promise<void>`; `scheduleAutosave(get: () => AutosaveRecord, onError: (err: unknown) => void): void`.
  - `project-io.ts` additions: `restoreAutosave(): Promise<void>`; `autosaveRecord(): AutosaveRecord`.

Why the record is SVG text: it reuses the tested serializer/parser, so autosave cannot hold
anything a saved file could not. The file handle is not persisted; after a reload, Save asks for
a location.

- [ ] **Step 1: Write `src/persist/autosave.ts`**

```ts
const DB_NAME = "slop-vector-editor";
const DB_VERSION = 1;
const STORE = "autosave";
const KEY = "current";
export const AUTOSAVE_DEBOUNCE_MS = 3000;

export type AutosaveRecord = { svg: string; fileName: string; dirty: boolean };

/** One shared connection, memoised as a promise; dropped on failure/close so it is retried. */
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  }).catch((err: unknown) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export async function loadAutosave(): Promise<AutosaveRecord | null> {
  const db = await open();
  const rec = await request(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY));
  return (rec as AutosaveRecord | undefined) ?? null;
}

export async function writeAutosave(rec: AutosaveRecord): Promise<void> {
  const db = await open();
  await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(rec, KEY));
}

let timer: ReturnType<typeof setTimeout> | null = null;
let reported = false;

/** Debounced write. `get` runs when the timer fires, so a burst of edits serializes once. */
export function scheduleAutosave(get: () => AutosaveRecord, onError: (err: unknown) => void): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    writeAutosave(get()).catch((err: unknown) => {
      if (reported) return; // one notice per session is enough
      reported = true;
      onError(err);
    });
  }, AUTOSAVE_DEBOUNCE_MS);
}
```

- [ ] **Step 2: Add restore to `src/persist/project-io.ts`**

Add these imports at the top of the file:

```ts
import { loadAutosave, type AutosaveRecord } from "./autosave";
```

Append at the end of the file:

```ts
export function autosaveRecord(): AutosaveRecord {
  return { svg: serializeDoc(app.doc), fileName: app.fileName, dirty: app.dirty };
}

export async function restoreAutosave(): Promise<void> {
  let rec: AutosaveRecord | null;
  try {
    rec = await loadAutosave();
  } catch {
    notify("info", "Autosave is unavailable in this browser session — save your work manually.");
    return;
  }
  if (!rec) return;
  try {
    const { doc } = parseSvg(rec.svg);
    replaceDocument(doc, rec.fileName, null, !rec.dirty);
  } catch (err) {
    notify("error", `The autosaved document could not be restored: ${errorMessage(err)}`);
  }
}
```

- [ ] **Step 3: Wire it into `src/App.svelte`**

Add to the `<script>` imports:

```ts
  import { onMount } from "svelte";
  import { scheduleAutosave } from "./persist/autosave";
  import { autosaveRecord, restoreAutosave } from "./persist/project-io";
  import { notify } from "./state/appState.svelte";
```

(merge `notify` into the existing `./state/appState.svelte` import.) Add below `let cursor`:

```ts
  // Autosave starts only after the restore attempt, so the empty startup document never
  // overwrites the saved one.
  let restored = $state(false);

  onMount(() => {
    void restoreAutosave().finally(() => (restored = true));
  });

  $effect(() => {
    if (!restored) return;
    void app.session; // any edit, undo, save or document replace
    void app.fileName;
    scheduleAutosave(autosaveRecord, (err) =>
      notify("error", `Autosave failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  });
```

- [ ] **Step 4: Verify build, lint and tests**

Run: `npm run build && npm run lint && npm test`
Expected: 0 errors, 0 warnings; lint silent; all tests pass.

- [ ] **Step 5: Verify in the browser**

1. Open `fixtures/inkscape-layers.svg`, change the artboard size (dirty), wait 4 s, reload. Expected: the modified document comes back with `●` and the fixture's file name.
2. Save As, wait 4 s, reload. Expected: the document comes back without `●`; Save now asks for a location (the handle is not kept).
3. In a private window, the app loads with no error notice (Chrome private windows still have IndexedDB); if a browser blocks IndexedDB, one info notice appears and editing still works.

- [ ] **Step 6: Commit**

```bash
git add src/persist/autosave.ts src/persist/project-io.ts src/App.svelte
git commit -m "feat(persist): IndexedDB autosave and restore

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Project docs and final verification

**Files:**
- Create: `CLAUDE.md`, `README.md`, `docs/superpowers/CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the handoff docs the next milestone plan relies on.

- [ ] **Step 1: Count the tests**

Run: `npm test`
Expected: all pass. Note the exact "Tests N passed (M files)" numbers for the docs (planned: 83 tests in 10 files — use what the run prints).

- [ ] **Step 2: Write `CLAUDE.md`**

````markdown
# slop-vector-editor — project guide for Claude

A browser-based vector graphics editor (Inkscape / Affinity Designer family, deliberately
simple). iPad (touch + Apple Pencil) and desktop are equal first-class targets. Svelte 5 +
TypeScript + Vite + Tailwind 4 + Vitest. The document IS a plain SVG file.

Design: `docs/superpowers/specs/2026-09-16-slop-vector-editor-design.md`. Plans:
`docs/superpowers/plans/`. Dated history: `docs/superpowers/CHANGELOG.md` (append-only; later
entries supersede earlier ones — mark superseded entries).

## Commands

- `npm run dev` — Vite dev server. `npm run dev:lan` — HTTPS on the LAN for iPad testing.
- `npm run build` — `svelte-check && tsc --noEmit && vite build`. Bar: **0 errors, 0 warnings.**
- `npm test` — Vitest, node env, no DOM — N tests in M files. Only pure logic is unit-tested.
- `npm run lint` / `npm run format`. Pre-commit (husky + lint-staged) runs eslint --fix + prettier.
- `npm run deploy` — build, then `wrangler deploy` (assets-only Worker, no `main`).

## Workflow

brainstorming → spec → writing-plans → subagent-driven-development → finishing-a-development-branch.
Branch off `main`, one commit per task, merge only when the user says so. Commit trailer:
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Keep README.md current with
every user-visible change.

## Architecture map

- `src/doc/` — `document.ts` (types, `createDoc`), `edits.ts` (pure `(doc, args) => doc`).
- `src/geom/` — `vec.ts`, `mat.ts` (SVG `matrix()` order), `shapes.ts` (`rectPath`).
- `src/svg/` — `xml.ts` (own XML reader), `pathdata.ts`, `arc.ts`, `colors.ts`, `transform.ts`,
  `attrs.ts` (model → attributes, shared by canvas and export), `serialize.ts`, `parse.ts`.
- `src/state/` — `session.ts` (doc + undo + gesture + saved marker, pure), `history.ts`,
  `viewport.ts`, `keys.ts`, `commands.ts`, `appState.svelte.ts` (the `app` store + actions).
- `src/persist/` — `file-io.ts` (File System Access / fallback), `project-io.ts`
  (new/open/save/restore), `autosave.ts` (IndexedDB, SVG text, 3 s debounce).
- `src/lib/` — `Canvas`, `NodeView`, `TopBar`, `StatusBar`, `Modal`, dialogs, `Notices`.

## Invariants and gotchas

1. **The document is immutable.** Edits return new objects; an edit that changes nothing returns
   the SAME reference. Undo stores references; the dirty flag is `doc !== savedDoc`. Mutating a
   doc in place silently corrupts undo and the dirty flag.
2. **The store is `app`, held in `$state.raw` fields** (`session`, `view`, `notices`). Replace,
   never mutate. Deep `$state` would proxy the doc and break reference equality.
3. **Canvas and export share `src/svg/attrs.ts`.** Never style a shape on the canvas any other way,
   or the screen and the saved file drift.
4. **The importer never throws on unsupported content**; it reports it in `dropped`. It throws only
   for malformed XML (`XmlError`) or a non-SVG root (`SvgError`). `openText` parses fully before
   replacing the document.
5. **No native dialogs.** Use `askConfirm` (in-app). Native `confirm` blocks the page and browser
   automation.
6. **Drag surfaces need `touch-action: none`** and must treat `pointercancel` like `pointerup`
   (iPad palm rejection). Canvas has both.
7. **Wheel listeners must be non-passive** (added in an `$effect`), or preventDefault is ignored
   and the page zooms instead of the canvas.

## Current state

Milestone 1 (scaffold, model, render, files) — see CHANGELOG. In M1 every canvas drag pans; there
are no editing tools yet.

## Roadmap

M2 select/transform + shapes, M3 layers/groups, M4 pen + node editing, M5 iPad polish + deploy
(spec §9). Post-v1 list in spec §10.

## Verification debt

Canvas/touch/Pencil behavior is not unit-testable. Record in CHANGELOG what was checked in the
browser and what still needs an iPad pass.
````

Replace `N` and `M` with the numbers from Step 1.

- [ ] **Step 3: Write `README.md`**

````markdown
# slop-vector-editor

A simple vector graphics editor that runs entirely in your browser — in the spirit of Inkscape
and Affinity Designer, but small. Works with a mouse and keyboard, and on iPad with touch and
Apple Pencil. Nothing is uploaded anywhere.

Your document is a plain `.svg` file: open it in any browser or design tool.

## Status

Early development. What works today:

- Open and save SVG files (save in place on Chromium desktop browsers; download elsewhere).
  Other tools' SVGs import best-effort — unsupported content (text, gradients, filters, CSS
  classes…) is listed when you open the file.
- New document with size presets; artboard size and background (or transparent).
- Pan and zoom: drag, mouse wheel, trackpad or two-finger pinch.
- Undo/redo and automatic saving to the browser.

## Keyboard

| Action | Keys |
|---|---|
| Open / Save / Save As | ⌘O / ⌘S / ⇧⌘S (Ctrl on Windows/Linux) |
| Undo / Redo | ⌘Z / ⇧⌘Z (or Ctrl+Y) |
| Zoom in / out | `=` / `-` |
| Fit artboard / 100% | ⌘0 / ⌘1 |

## Roadmap

Selection and transform, shape tools, layers and groups, pen tool and node editing.

## Development

```bash
npm install
npm run dev       # dev server
npm run dev:lan   # HTTPS on your LAN, for iPad testing
npm test          # N unit tests
npm run build     # type-check + production build
npm run deploy    # build + deploy to Cloudflare
```

Svelte 5, TypeScript, Vite, Tailwind CSS 4, Vitest.
````

Replace `N` with the number from Step 1.

- [ ] **Step 4: Write `docs/superpowers/CHANGELOG.md`**

```markdown
# Changelog (append-only; later entries supersede earlier ones)

## 2026-09-16 — Milestone 1: scaffold, model, render, files

- Project scaffold copied from slop-animator's toolchain (Svelte 5 runes, TS strict, Vite 8,
  Tailwind 4 with the SLOP-TIMELINE-UI palette, Vitest, ESLint/Prettier, husky, wrangler).
- Immutable document model; pure undo session with gesture support; `app` store with `$state.raw`.
- Own XML reader (runs in node for tests), SVG path-data reader/writer with arcs and quadratics,
  CSS colors, transform lists, serializer and importer. Own files round-trip exactly (6-decimal
  rounding); Inkscape/Figma/Illustrator-shaped fixtures import with a dropped-feature report.
- Canvas renders through the exporter's attribute functions; pan (drag/wheel), zoom
  (ctrl-wheel, Safari gesture events, two-finger pinch), fit on load/replace.
- File menu: New (presets), Open, Save, Save As, Document settings; in-app confirm; notices;
  keyboard shortcuts; IndexedDB autosave (SVG text) with restore.
- Plan: `docs/superpowers/plans/2026-09-16-m1-scaffold-model-files.md`.
- Browser-verified: <list what Tasks 12–15 browser steps confirmed, in desktop Chrome>.
- Owed: iPad pass (two-finger pinch/pan, file open/save via Files, autosave in Safari).
```

Fill the "Browser-verified" line with what was actually observed; do not claim steps that were not run.

- [ ] **Step 5: Final verification**

Run: `npm run build && npm run lint && npm test && npm run format:check`
Expected: 0 errors, 0 warnings; lint silent; all tests pass; Prettier reports all files formatted
(run `npm run format` first if not, and include the result in this commit).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md docs/superpowers/CHANGELOG.md
git commit -m "docs: CLAUDE.md, README and changelog for milestone 1

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Then hand over to superpowers:finishing-a-development-branch — do not merge or deploy without the
user's go-ahead.
