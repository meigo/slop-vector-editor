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
