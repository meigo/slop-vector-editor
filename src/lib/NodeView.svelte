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
