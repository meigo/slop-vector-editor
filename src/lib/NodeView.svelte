<svelte:options namespace="svg" />

<script lang="ts">
  import type { Node } from "../doc/document";
  import { app } from "../state/appState.svelte";
  import { gradientDefs, groupAttrs, shapeAttrs } from "../svg/attrs";
  import NodeView from "./NodeView.svelte";

  let { node }: { node: Node } = $props();
  // A title whose editing field is empty keeps its old text in the document (an empty title cannot
  // be saved), so it is hidden here until it has text again or the session removes it.
  const emptied = $derived(app.editEmpty && app.textEdit?.id === node.id);
</script>

<!-- Renders through the same attribute functions the SVG exporter uses. -->
{#if node.kind === "group"}
  <g {...groupAttrs(node)}>
    {#each node.children as child (child.id)}
      <NodeView node={child} />
    {/each}
  </g>
{:else if !emptied}
  {@const s = shapeAttrs(node)}
  {@const defs = gradientDefs(node)}
  <!-- Spec M15 §3: a shape's gradients sit right before it; SVG allows <defs> anywhere, and ids are
       page-unique because node ids are. Built by the same function the exporter uses. -->
  {#if defs.length > 0}
    <defs>
      {#each defs as g (g.id)}
        {#if g.tag === "radialGradient"}
          <radialGradient {...g.attrs}>
            {#each g.stops as st, i (i)}
              <stop {...st} />
            {/each}
          </radialGradient>
        {:else}
          <linearGradient {...g.attrs}>
            {#each g.stops as st, i (i)}
              <stop {...st} />
            {/each}
          </linearGradient>
        {/if}
      {/each}
    </defs>
  {/if}
  {#if s.tag === "rect"}
    <rect {...s.attrs} />
  {:else if s.tag === "ellipse"}
    <ellipse {...s.attrs} />
  {:else}
    <path {...s.attrs} />
  {/if}
{/if}
