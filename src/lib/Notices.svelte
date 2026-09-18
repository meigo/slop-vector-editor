<script lang="ts">
  import { X } from "@lucide/svelte";
  import { app, dismissNotice } from "../state/appState.svelte";
</script>

<div
  class={[
    // Clear of the modifier dock, which shares this corner: the status bar (h-7 and its border),
    // the dock's own bottom-3 and its 50px height put the dock's top edge 96px above the viewport
    // bottom, so 100px leaves a 4px gap above it (spec M5 §4).
    "pointer-events-none fixed bottom-25 z-40 flex max-w-sm flex-col gap-2",
    app.propertiesOpen ? "right-3 max-[900px]:right-63" : "right-3",
  ]}
>
  {#each app.notices as n (n.id)}
    <div
      class="pointer-events-auto flex items-start gap-2 rounded border bg-panel px-3 py-2 text-xs shadow-lg"
      class:border-danger={n.kind === "error"}
      class:border-line={n.kind === "info"}
      role={n.kind === "error" ? "alert" : "status"}
    >
      <span class="flex-1 select-text">{n.text}</span>
      <button
        class="text-muted hover:text-text"
        aria-label="Dismiss"
        onclick={() => dismissNotice(n.id)}
      >
        <X size={14} />
      </button>
    </div>
  {/each}
</div>
