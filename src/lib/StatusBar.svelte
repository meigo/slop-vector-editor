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
