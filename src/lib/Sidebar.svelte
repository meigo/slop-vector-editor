<script lang="ts">
  import LayersPanel from "./LayersPanel.svelte";
  import PropertiesPanel from "./PropertiesPanel.svelte";
</script>

<!-- Spec (M3a) §5: Properties on top (scrolls), Layers below with its own scroll. -->
<div class="flex h-full w-60 shrink-0 flex-col border-l border-line bg-panel">
  <PropertiesPanel />
  <LayersPanel />
</div>
