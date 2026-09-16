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
