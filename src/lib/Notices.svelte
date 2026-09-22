<script lang="ts">
  import { X } from "@lucide/svelte";
  import { app, dismissNotice } from "../state/appState.svelte";
</script>

<div
  class={[
    // Clear of the modifier dock, which shares this corner: the status bar (h-7 = 28px plus its
    // 1px border) and the dock's own bottom-3 put the dock's bottom edge 41px above the viewport
    // bottom, and its 50px height puts its top edge at 91px — so 100px leaves a 9px gap above it
    // (spec M5 §4).
    "pointer-events-none fixed bottom-25 z-40 flex max-w-sm flex-col gap-2",
    // Clear of the Properties/Layers column too. Unlike the dock, which is absolute inside
    // <main> and so already narrowed by the docked column, these notices are fixed to the
    // viewport: they must step aside for the column at 900px and up, where it is always present,
    // and below 900px only while the drawer is open.
    app.propertiesOpen ? "right-(--sidebar-inset)" : "right-3 min-[900px]:right-(--sidebar-inset)",
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
