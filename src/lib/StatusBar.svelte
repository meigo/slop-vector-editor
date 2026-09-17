<script lang="ts">
  import { rowLabel } from "../doc/layers";
  import { findNode } from "../doc/tree";
  import type { Vec } from "../geom/vec";
  import { app } from "../state/appState.svelte";
  import { TOOLS } from "../tools/registry";

  let { cursor }: { cursor: Vec | null } = $props();
  const ab = $derived(app.doc.artboard);
  const enteredHint = $derived.by(() => {
    const id = app.enteredGroupId;
    if (id === null) return null;
    const found = findNode(app.doc, id);
    return found ? `Inside “${rowLabel(found.node)}” — Escape to leave` : null;
  });
</script>

<footer
  class="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-xs text-muted tabular-nums"
>
  <span class="min-w-0 truncate">{app.hoverHint ?? enteredHint ?? TOOLS[app.toolId].hint}</span>
  {#if app.selection.length > 0}
    <span>{app.selection.length} selected</span>
  {/if}
  <span class="ml-auto whitespace-nowrap">{ab.w} × {ab.h} px</span>
  <span class="w-28 text-right">
    {cursor ? `${cursor.x.toFixed(1)}, ${cursor.y.toFixed(1)}` : "–"}
  </span>
</footer>
