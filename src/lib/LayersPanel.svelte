<script lang="ts">
  import {
    ChevronDown,
    ChevronRight,
    Eye,
    EyeOff,
    GripVertical,
    Lock,
    LockOpen,
    Plus,
    Trash2,
  } from "@lucide/svelte";
  import { isHidden, isLocked, type Layer, type Node } from "../doc/document";
  import { rowLabel } from "../doc/layers";
  import {
    addLayerAboveCurrent,
    app,
    deleteCurrentLayer,
    moveLayerTo,
    moveNodesTo,
    renameLayerById,
    renameNodeById,
    selectFromPanel,
    setCurrentLayer,
    toggleLayerLocked,
    toggleLayerVisible,
    toggleNodeLocked,
    toggleNodeVisible,
  } from "../state/appState.svelte";
  import { isDoubleTap, type Tap } from "../input/double-tap";
  import IconButton from "./IconButton.svelte";
  import PanelHeader from "./PanelHeader.svelte";
  import { dropTarget, type Drag, type Drop, type RowBox } from "./layer-drop";

  /** Spec (M3a) §5. Collapsed layers and the rename draft are panel-local, never saved. */
  const collapsed = $state<Record<string, boolean>>({});
  let editing = $state<{ kind: "layer" | "node"; id: string } | null>(null);
  let draft = $state("");
  let lastTap: Tap | null = null;
  let list = $state<HTMLElement | null>(null);
  let dragging: { drag: Drag; pointerId: number } | null = null;
  let drop = $state<Drop | null>(null);
  let lineTop = $state(0);

  const layers = $derived([...app.doc.layers].reverse());
  const current = $derived(app.doc.layers.find((l) => l.id === app.currentLayerId) ?? null);
  const selected = $derived(new Set(app.selection));

  /** Says which thing is responsible, so a greyed row explains itself (invariant 24). */
  const nodeBlockedTitle = (n: Node, l: Layer, inherited: boolean): string | undefined =>
    isHidden(n)
      ? `“${rowLabel(n)}” is hidden`
      : isLocked(n)
        ? `“${rowLabel(n)}” is locked`
        : inherited
          ? blockedTitle(l)
          : undefined;

  const blockedTitle = (l: Layer): string | undefined =>
    !l.visible
      ? `Layer “${l.name}” is hidden`
      : l.locked
        ? `Layer “${l.name}” is locked`
        : undefined;

  let { expanded, ontoggle, flex }: { expanded: boolean; ontoggle: () => void; flex: string } =
    $props();

  /** These two buttons are the only route to adding or deleting a layer — no menu, no shortcut — so
   *  they stay in the header while the panel is collapsed. Opening the panel is what makes the
   *  result visible; without it, New layer would add one with nothing to show for it. */
  function reveal(run: () => void) {
    run();
    if (!expanded) ontoggle();
  }

  const focusSelect = (el: HTMLInputElement) => {
    el.focus();
    el.select();
  };

  /** A second tap on the same name within the double-tap window starts renaming it. */
  function tapName(kind: "layer" | "node", id: string, initial: string, e: PointerEvent) {
    if (e.button !== 0) return;
    const tap = { id, time: e.timeStamp };
    if (isDoubleTap(lastTap, tap)) {
      lastTap = null;
      editing = { kind, id };
      draft = initial;
    } else {
      lastTap = tap;
    }
  }

  function finishRename(commit: boolean) {
    const e = editing;
    editing = null;
    if (!e || !commit) return;
    if (e.kind === "layer") renameLayerById(e.id, draft);
    else renameNodeById(e.id, draft);
  }

  function rows(): RowBox[] {
    if (!list) return [];
    return [...list.querySelectorAll<HTMLElement>("[data-row-id]")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        kind: el.dataset.rowKind === "layer" ? "layer" : "node",
        id: el.dataset.rowId ?? "",
        top: r.top,
        bottom: r.bottom,
      };
    });
  }

  function startDrag(e: PointerEvent, drag: Drag) {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience; moves still arrive while the pointer stays on the grip.
    }
    dragging = { drag, pointerId: e.pointerId };
    drop = null;
  }

  function moveDrag(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragging.pointerId || !list) return;
    drop = dropTarget(app.doc, rows(), e.clientY, dragging.drag);
    if (drop) lineTop = drop.line - list.getBoundingClientRect().top + list.scrollTop;
  }

  function endDrag(e: PointerEvent, apply: boolean) {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    const drag = dragging.drag;
    const target = apply ? dropTarget(app.doc, rows(), e.clientY, drag) : null;
    dragging = null;
    drop = null;
    if (!apply || !target) return;
    if (drag.kind === "layer" && target.kind === "layer") moveLayerTo(drag.id, target.index);
    else if (drag.kind === "node" && target.kind === "node") {
      moveNodesTo(drag.ids, target.parentId, target.index);
    }
  }

  /** Dragging a selected row moves the whole selection; any other row moves on its own. */
  const nodeDrag = (id: string): Drag => ({
    kind: "node",
    ids: selected.has(id) ? app.selection : [id],
  });
</script>

<svelte:window
  onkeydowncapture={(e) => {
    if (e.key !== "Escape" || !dragging) return;
    dragging = null;
    drop = null;
    e.preventDefault();
    e.stopPropagation();
  }}
/>

{#snippet nodeRow(node: Node, layer: Layer, depth: number, inherited: boolean)}
  {@const isSelected = selected.has(node.id)}
  {@const isGroup = node.kind === "group"}
  {@const open = !collapsed[node.id]}
  <!-- `inherited` is the layer's or an ancestor's block; this row adds its own, and passes the
       result down, so a hidden group greys everything inside it. -->
  {@const blocked = inherited || isHidden(node) || isLocked(node)}
  <li>
    <div
      data-row-id={node.id}
      data-row-kind="node"
      class={[
        "flex h-8 items-center gap-0.5 pr-1",
        isSelected && "ui-selected",
        blocked && "text-muted",
      ]}
      style="padding-left: {depth * 20}px"
      title={nodeBlockedTitle(node, layer, inherited)}
    >
      <button
        type="button"
        tabindex="-1"
        class="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-muted"
        style="touch-action: none"
        aria-label="Drag “{rowLabel(node)}”"
        onpointerdown={(e) => {
          if (!blocked) startDrag(e, nodeDrag(node.id));
        }}
        onpointermove={moveDrag}
        onpointerup={(e) => endDrag(e, true)}
        onpointercancel={(e) => endDrag(e, false)}
        onlostpointercapture={(e) => endDrag(e, false)}
      >
        <GripVertical size={14} />
      </button>
      {#if isGroup}
        <button
          type="button"
          class="flex h-8 w-5 shrink-0 items-center justify-center text-muted"
          aria-label={open ? `Collapse “${rowLabel(node)}”` : `Expand “${rowLabel(node)}”`}
          aria-expanded={open}
          onclick={() => (collapsed[node.id] = open)}
        >
          {#if open}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
        </button>
      {:else}
        <span class="w-5 shrink-0"></span>
      {/if}
      {#if editing?.kind === "node" && editing.id === node.id}
        <input
          class="field h-7 min-w-0 flex-1"
          aria-label="Object name"
          placeholder={rowLabel(node)}
          bind:value={draft}
          {@attach focusSelect}
          onkeydown={(e) => {
            if (e.key === "Enter") finishRename(true);
            if (e.key === "Escape") finishRename(false);
          }}
          onblur={() => finishRename(true)}
        />
      {:else}
        <button
          type="button"
          class="h-8 min-w-0 flex-1 truncate text-left"
          title={blocked ? undefined : `Select “${rowLabel(node)}” — double-click to rename`}
          onclick={(e) => {
            if (editing) return;
            if (!blocked) selectFromPanel(node.id, e.shiftKey || e.metaKey || e.ctrlKey);
          }}
          onpointerup={(e) => {
            if (!blocked) tapName("node", node.id, node.name ?? "", e);
          }}
        >
          {rowLabel(node)}
        </button>
      {/if}
      <!-- Spec M9 §6: these two stay live while the row is blocked — a hidden or locked node
           cannot be selected, so its own row is the only way back. -->
      <button
        type="button"
        class="flex h-8 w-5 shrink-0 items-center justify-center text-muted"
        aria-label={isHidden(node) ? `Show “${rowLabel(node)}”` : `Hide “${rowLabel(node)}”`}
        title={isHidden(node) ? `Show “${rowLabel(node)}”` : `Hide “${rowLabel(node)}”`}
        onclick={() => toggleNodeVisible(node.id)}
      >
        {#if isHidden(node)}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
      </button>
      <button
        type="button"
        class="flex h-8 w-5 shrink-0 items-center justify-center text-muted"
        aria-label={isLocked(node) ? `Unlock “${rowLabel(node)}”` : `Lock “${rowLabel(node)}”`}
        title={isLocked(node) ? `Unlock “${rowLabel(node)}”` : `Lock “${rowLabel(node)}”`}
        onclick={() => toggleNodeLocked(node.id)}
      >
        {#if isLocked(node)}<Lock size={14} />{:else}<LockOpen size={14} />{/if}
      </button>
    </div>
    {#if isGroup && open}
      <ul>
        {#each [...node.children].reverse() as child (child.id)}
          {@render nodeRow(child, layer, depth + 1, blocked)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<section class="flex min-h-0 flex-col" style:flex aria-label="Layers">
  <PanelHeader
    title="Layers"
    open={expanded}
    {ontoggle}
    showTitle="Show the layers"
    hideTitle="Hide the layers"
  >
    {#snippet actions()}
      <IconButton
        label="New layer"
        title="New layer"
        icon={Plus}
        onclick={() => reveal(addLayerAboveCurrent)}
      />
      <IconButton
        label="Delete layer"
        title={current ? `Delete layer “${current.name}”` : "Delete layer"}
        icon={Trash2}
        disabled={app.doc.layers.length <= 1}
        disabledTitle="Delete layer — it is the only layer"
        onclick={() => reveal(() => void deleteCurrentLayer())}
      />
    {/snippet}
  </PanelHeader>

  {#if expanded}
    <div
      bind:this={list}
      class="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 text-xs"
    >
      <ul>
        {#each layers as layer (layer.id)}
          {@const isCurrent = layer.id === app.currentLayerId}
          {@const blocked = !layer.visible || layer.locked}
          {@const open = !collapsed[layer.id]}
          <li>
            <div
              data-row-id={layer.id}
              data-row-kind="layer"
              class={["flex h-8 items-center gap-0.5 pr-1", isCurrent && "ui-selected-tint"]}
            >
              <button
                type="button"
                tabindex="-1"
                class="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-muted"
                style="touch-action: none"
                aria-label="Drag “{layer.name}”"
                onpointerdown={(e) => startDrag(e, { kind: "layer", id: layer.id })}
                onpointermove={moveDrag}
                onpointerup={(e) => endDrag(e, true)}
                onpointercancel={(e) => endDrag(e, false)}
                onlostpointercapture={(e) => endDrag(e, false)}
              >
                <GripVertical size={14} />
              </button>
              <button
                type="button"
                class="flex h-8 w-5 shrink-0 items-center justify-center text-muted"
                aria-label={open ? `Collapse “${layer.name}”` : `Expand “${layer.name}”`}
                aria-expanded={open}
                onclick={() => (collapsed[layer.id] = open)}
              >
                {#if open}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
              </button>
              {#if editing?.kind === "layer" && editing.id === layer.id}
                <input
                  class="field h-7 min-w-0 flex-1"
                  aria-label="Layer name"
                  bind:value={draft}
                  {@attach focusSelect}
                  onkeydown={(e) => {
                    if (e.key === "Enter") finishRename(true);
                    if (e.key === "Escape") finishRename(false);
                  }}
                  onblur={() => finishRename(true)}
                />
              {:else}
                <button
                  type="button"
                  class={[
                    "h-8 min-w-0 flex-1 truncate text-left",
                    isCurrent && "font-medium",
                    blocked && "text-muted",
                  ]}
                  title="Make “{layer.name}” current — double-click to rename"
                  onclick={() => setCurrentLayer(layer.id)}
                  onpointerup={(e) => tapName("layer", layer.id, layer.name, e)}
                >
                  {layer.name}
                </button>
              {/if}
              <button
                type="button"
                class="icon-btn"
                aria-label={layer.visible ? `Hide “${layer.name}”` : `Show “${layer.name}”`}
                title={layer.visible ? `Hide “${layer.name}”` : `Show “${layer.name}”`}
                onclick={() => toggleLayerVisible(layer.id)}
              >
                {#if layer.visible}<Eye size={14} />{:else}<EyeOff size={14} />{/if}
              </button>
              <button
                type="button"
                class="icon-btn"
                aria-label={layer.locked ? `Unlock “${layer.name}”` : `Lock “${layer.name}”`}
                title={layer.locked ? `Unlock “${layer.name}”` : `Lock “${layer.name}”`}
                onclick={() => toggleLayerLocked(layer.id)}
              >
                {#if layer.locked}<Lock size={14} />{:else}<LockOpen size={14} />{/if}
              </button>
            </div>

            {#if open}
              <ul>
                {#each [...layer.children].reverse() as node (node.id)}
                  {@render nodeRow(node, layer, 1, blocked)}
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
      {#if drop}
        <div
          class="pointer-events-none absolute inset-x-1 h-0.5 bg-accent"
          style="top: {lineTop - 1}px"
        ></div>
      {/if}
    </div>
  {/if}
</section>
