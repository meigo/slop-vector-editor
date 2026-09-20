<script lang="ts">
  import {
    Circle,
    Hand,
    MousePointer2,
    Pentagon,
    PenTool,
    Slash,
    SplinePointer,
    Square,
    Type,
  } from "@lucide/svelte";
  import { app, setTool } from "../state/appState.svelte";
  import type { ToolId } from "../tools/types";

  const TOOL_BUTTONS: { id: ToolId; label: string; key: string; icon: typeof Square }[] = [
    { id: "select", label: "Select", key: "V", icon: MousePointer2 },
    { id: "node", label: "Edit nodes", key: "N", icon: SplinePointer },
    { id: "rect", label: "Rectangle", key: "R", icon: Square },
    { id: "ellipse", label: "Ellipse", key: "E", icon: Circle },
    { id: "line", label: "Line", key: "L", icon: Slash },
    { id: "polygon", label: "Polygon / star", key: "Y", icon: Pentagon },
    { id: "pen", label: "Pen", key: "P", icon: PenTool },
    { id: "text", label: "Text", key: "T", icon: Type },
    { id: "hand", label: "Hand", key: "H", icon: Hand },
  ];
</script>

<nav
  class="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2"
  aria-label="Tools"
>
  {#each TOOL_BUTTONS as t (t.id)}
    <button
      class={["icon-btn", app.toolId === t.id && "ui-on"]}
      title="{t.label} ({t.key})"
      aria-label={t.label}
      aria-pressed={app.toolId === t.id}
      onclick={() => setTool(t.id)}
    >
      <t.icon size={18} />
    </button>
  {/each}
</nav>
