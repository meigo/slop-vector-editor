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
