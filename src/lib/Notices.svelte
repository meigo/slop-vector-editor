<script lang="ts">
  import { X } from "@lucide/svelte";
  import { app, dismissNotice } from "../state/appState.svelte";
</script>

<div
  class={[
    "pointer-events-none fixed bottom-10 z-40 flex max-w-sm flex-col gap-2",
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
