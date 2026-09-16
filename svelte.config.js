import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  // Every component is runes-mode; enforce it so legacy reactivity cannot creep back in.
  compilerOptions: { runes: true },
};
