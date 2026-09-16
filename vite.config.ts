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
