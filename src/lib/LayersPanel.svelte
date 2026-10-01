<script lang="ts">
  import { tick } from "svelte";
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
    deleteSelection,
    deselectAll,
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
  import {
    autoScrollStep,
    ghostTop,
    pastThreshold,
    ROW_PX,
    shiftedRowIds,
  } from "./layer-drag-visual";
  import { dropTarget, type Drag, type Drop, type RowBox } from "./layer-drop";
  import { trashAction } from "./layer-trash";
  import { revealScrollTop } from "./reveal";

  /** Spec (M3a) §5. Collapsed layers and the rename draft are panel-local, never saved. */
  const collapsed = $state<Record<string, boolean>>({});
  let editing = $state<{ kind: "layer" | "node"; id: string } | null>(null);
  let draft = $state("");
  let lastTap: Tap | null = null;
  let list = $state<HTMLElement | null>(null);
  /** A press on a grip; `live` once it has travelled past the threshold and become a drag. Rows,
   *  the grab offset and the content height are measured then, once (`layer-drag-visual.ts`). */
  let dragging: {
    drag: Drag;
    pointerId: number;
    row: HTMLElement;
    label: string;
    startX: number;
    startY: number;
    clientY: number;
    live: boolean;
    boxes: RowBox[];
    grab: number;
    contentHeight: number;
  } | null = null;
  let drop = $state<Drop | null>(null);
  /** The floating copy of the grabbed row, in content coordinates. */
  let ghost = $state<{ top: number; label: string; pad: string; count: number } | null>(null);
  /** Rows slid down to open the gap, and the rows being dragged (dimmed in place). */
  let shifted = $state.raw<Set<string>>(new Set());
  let dimmed = $state.raw<Set<string>>(new Set());
  /** The layer or group a node drop lands in, outlined. */
  const dropInto = $derived(drop?.kind === "node" ? drop.parentId : null);
  let scrollFrame = 0;

  const layers = $derived([...app.doc.layers].reverse());
  const current = $derived(app.doc.layers.find((l) => l.id === app.currentLayerId) ?? null);
  const trash = $derived(trashAction(app.selection.length, app.doc.layers.length));
  const selected = $derived(new Set(app.selection));

  /** Properties sits below this panel and opens when something is selected, shrinking this list
   *  from the bottom — so a row selected low in the list, here or on the canvas, would end up under
   *  its header. Scroll it back into view once the layout has settled, nearest edge only, so a
   *  visible row never moves (spec 2026-09-26 §4). `scrollTop` directly, never `scrollIntoView`,
   *  which would also scroll the drawer and the page. */
  $effect(() => {
    const id = app.selection.at(-1);
    const el = list;
    if (id === undefined || !el) return;
    void tick().then(() => {
      const row = el.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
      if (!row) return;
      const view = el.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const top = r.top - view.top + el.scrollTop;
      const next = revealScrollTop(el.scrollTop, el.clientHeight, top, top + r.height);
      if (next !== el.scrollTop) el.scrollTop = next;
    });
  });

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

  /** Every rendered row, in the list's content coordinates. */
  function rows(): RowBox[] {
    if (!list) return [];
    const off = list.scrollTop - list.getBoundingClientRect().top;
    return [...list.querySelectorAll<HTMLElement>("[data-row-id]")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        kind: el.dataset.rowKind === "layer" ? "layer" : "node",
        id: el.dataset.rowId ?? "",
        top: r.top + off,
        bottom: r.bottom + off,
      };
    });
  }

  function startDrag(e: PointerEvent, drag: Drag, label: string) {
    if (e.button !== 0) return;
    const row = (e.currentTarget as Element | null)?.closest<HTMLElement>("[data-row-id]");
    if (!row) return;
    e.preventDefault();
    try {
      if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience; moves still arrive while the pointer stays on the grip.
    }
    dragging = {
      drag,
      pointerId: e.pointerId,
      row,
      label,
      startX: e.clientX,
      startY: e.clientY,
      clientY: e.clientY,
      live: false,
      boxes: [],
      grab: 0,
      contentHeight: 0,
    };
    drop = null;
  }

  /** The press became a drag: measure the rows once — sliding rows must not move the targets
   *  they are measured against — dim what moves, lift the copy and start the edge scroll. */
  function lift(d: NonNullable<typeof dragging>) {
    if (!list) return;
    d.live = true;
    d.boxes = rows();
    d.grab = d.startY - d.row.getBoundingClientRect().top;
    d.contentHeight = list.scrollHeight;
    // A dragged row carries what is drawn inside it: a layer its objects, a group its children.
    const ids = d.drag.kind === "layer" ? [d.drag.id] : d.drag.ids;
    const moving = new Set<string>();
    for (const id of ids) {
      const el = list.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.closest("li");
      el?.querySelectorAll<HTMLElement>("[data-row-id]").forEach((r) => {
        if (r.dataset.rowId) moving.add(r.dataset.rowId);
      });
    }
    dimmed = moving;
    ghost = {
      top: 0,
      label: d.label,
      pad: d.row.style.paddingLeft,
      count: d.drag.kind === "node" ? d.drag.ids.length : 1,
    };
    document.documentElement.classList.add("layer-dragging");
    scrollFrame = requestAnimationFrame(edgeScroll);
  }

  function update(d: NonNullable<typeof dragging>) {
    if (!list || !ghost) return;
    const y = d.clientY - list.getBoundingClientRect().top + list.scrollTop;
    drop = dropTarget(app.doc, d.boxes, y, d.drag);
    shifted = shiftedRowIds(d.boxes, drop?.line ?? null);
    ghost = { ...ghost, top: ghostTop(y, d.grab, d.contentHeight) };
    document.documentElement.classList.toggle("layer-drop-refused", drop === null);
  }

  /** Near the list's top or bottom edge, scroll it — once a frame while the drag lasts. */
  function edgeScroll() {
    const d = dragging;
    if (!d) return;
    // The panel collapsed under the drag: nothing left to drop on.
    if (!list) return finishDrag();
    const view = list.getBoundingClientRect();
    const step = autoScrollStep(d.clientY, view.top, view.bottom);
    const max = Math.max(d.contentHeight - list.clientHeight, 0);
    const next = Math.min(Math.max(list.scrollTop + step, 0), max);
    if (next !== list.scrollTop) {
      list.scrollTop = next;
      update(d);
    }
    scrollFrame = requestAnimationFrame(edgeScroll);
  }

  // The cursor classes sit on <html>, outside this component: never leave them behind.
  $effect(() => () => finishDrag());

  /** Puts everything back as it was before the press. */
  function finishDrag() {
    cancelAnimationFrame(scrollFrame);
    dragging = null;
    drop = null;
    ghost = null;
    shifted = new Set();
    dimmed = new Set();
    document.documentElement.classList.remove("layer-dragging", "layer-drop-refused");
  }

  function moveDrag(e: PointerEvent) {
    const d = dragging;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientY = e.clientY;
    if (!d.live) {
      if (!pastThreshold(e.clientX - d.startX, e.clientY - d.startY)) return;
      lift(d);
    }
    update(d);
  }

  function endDrag(e: PointerEvent, apply: boolean) {
    const d = dragging;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientY = e.clientY;
    // A press that never became a drag lands nothing.
    if (apply && d.live) update(d);
    const target = apply && d.live ? drop : null;
    const drag = d.drag;
    finishDrag();
    if (!target) return;
    if (drag.kind === "layer" && target.kind === "layer") moveLayerTo(drag.id, target.index);
    else if (drag.kind === "node" && target.kind === "node") {
      moveNodesTo(drag.ids, target.parentId, target.index);
    }
  }

  /** A row's slide, while a drag is open: the gap opens and closes smoothly, and at the drop the
   *  rows jump straight to their new order rather than animating back from the gap. */
  const slide = (id: string) => (shifted.has(id) ? `translateY(${ROW_PX}px)` : null);
  const slideTransition = $derived(ghost ? "transform 150ms ease" : null);

  /** Dragging a selected row moves the whole selection; any other row moves on its own. */
  const nodeDrag = (id: string): Drag => ({
    kind: "node",
    ids: selected.has(id) ? app.selection : [id],
  });

  /** Row geometry, shared with slop-animator and slop-paint: every row starts 8px in, and each
   *  level indents by one grip slot plus its gap (14 + 4px), so a child's grip sits exactly under
   *  its parent's chevron. The state toggles sit in fixed 20px columns at a 6px right inset —
   *  whatever the row's kind or depth — so the eyes and locks make straight columns. An "off" toggle
   *  (hidden, locked) is warn-coloured so it stands out in a column of muted icons. */
  const rowPad = (depth: number) => `padding-left: ${8 + 18 * depth}px`;
  const toggleClass = (off: boolean) => [
    "flex h-8 w-5 shrink-0 items-center justify-center rounded",
    off ? "text-warn" : "text-muted hover:text-text",
  ];
</script>

<svelte:window
  onkeydowncapture={(e) => {
    if (e.key !== "Escape" || !dragging) return;
    finishDrag();
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
        "flex h-8 items-center gap-1 pr-[6px]",
        isSelected && "ui-selected",
        blocked && "text-muted",
        dimmed.has(node.id) && "opacity-40",
        dropInto === node.id && "ui-drop-target",
      ]}
      style={rowPad(depth)}
      style:transform={slide(node.id)}
      style:transition={slideTransition}
      title={nodeBlockedTitle(node, layer, inherited)}
    >
      <button
        type="button"
        tabindex="-1"
        class="flex h-8 w-3.5 shrink-0 cursor-grab items-center justify-center text-muted"
        style="touch-action: none"
        aria-label="Drag “{rowLabel(node)}”"
        title="Drag to move “{rowLabel(node)}”"
        onpointerdown={(e) => {
          if (!blocked) startDrag(e, nodeDrag(node.id), rowLabel(node));
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
          class="flex h-8 w-3.5 shrink-0 items-center justify-center text-muted"
          aria-label={open ? `Collapse “${rowLabel(node)}”` : `Expand “${rowLabel(node)}”`}
          title={open ? `Collapse “${rowLabel(node)}”` : `Expand “${rowLabel(node)}”`}
          aria-expanded={open}
          onclick={() => (collapsed[node.id] = open)}
        >
          {#if open}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
        </button>
      {:else}
        <span class="w-3.5 shrink-0"></span>
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
          title={blocked
            ? `${nodeBlockedTitle(node, layer, inherited) ?? "Inside a hidden or locked group"} — double-click to rename`
            : `Select “${rowLabel(node)}” — double-click to rename`}
          onclick={(e) => {
            if (editing) return;
            if (!blocked) selectFromPanel(node.id, e.shiftKey || e.metaKey || e.ctrlKey);
          }}
          onpointerup={(e) => tapName("node", node.id, node.name ?? "", e)}
        >
          {rowLabel(node)}
        </button>
      {/if}
      <!-- Spec M9 §6: these two stay live while the row is blocked — a hidden or locked node
           cannot be selected, so its own row is the only way back. -->
      <button
        type="button"
        class={toggleClass(isLocked(node))}
        aria-label={isLocked(node) ? `Unlock “${rowLabel(node)}”` : `Lock “${rowLabel(node)}”`}
        title={isLocked(node) ? `Unlock “${rowLabel(node)}”` : `Lock “${rowLabel(node)}”`}
        onclick={() => toggleNodeLocked(node.id)}
      >
        {#if isLocked(node)}<Lock size={14} />{:else}<LockOpen size={14} />{/if}
      </button>
      <button
        type="button"
        class={toggleClass(isHidden(node))}
        aria-label={isHidden(node) ? `Show “${rowLabel(node)}”` : `Hide “${rowLabel(node)}”`}
        title={isHidden(node) ? `Show “${rowLabel(node)}”` : `Hide “${rowLabel(node)}”`}
        onclick={() => toggleNodeVisible(node.id)}
      >
        {#if isHidden(node)}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
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
        label={trash === "selection" ? "Delete selection" : "Delete layer"}
        title={trash === "selection"
          ? // With nodes picked in the Node tool, ⌫ deletes those nodes, not the object (review L16).
            app.toolId === "node" && app.nodeSel.length > 0
            ? "Delete the selected object — ⌫ deletes just the selected nodes"
            : "Delete selection (⌫)"
          : current
            ? `Delete layer “${current.name}”`
            : "Delete layer"}
        icon={Trash2}
        disabled={trash === "disabled"}
        disabledTitle="Delete layer — it is the only layer"
        onclick={() =>
          reveal(() => (trash === "selection" ? deleteSelection() : void deleteCurrentLayer()))}
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
              class={[
                "flex h-8 items-center gap-1 pr-[6px]",
                isCurrent && "ui-selected-tint",
                dimmed.has(layer.id) && "opacity-40",
                dropInto === layer.id && "ui-drop-target",
              ]}
              style={rowPad(0)}
              style:transform={slide(layer.id)}
              style:transition={slideTransition}
            >
              <button
                type="button"
                tabindex="-1"
                class="flex h-8 w-3.5 shrink-0 cursor-grab items-center justify-center text-muted"
                style="touch-action: none"
                aria-label="Drag “{layer.name}”"
                title="Drag to move “{layer.name}”"
                onpointerdown={(e) => startDrag(e, { kind: "layer", id: layer.id }, layer.name)}
                onpointermove={moveDrag}
                onpointerup={(e) => endDrag(e, true)}
                onpointercancel={(e) => endDrag(e, false)}
                onlostpointercapture={(e) => endDrag(e, false)}
              >
                <GripVertical size={14} />
              </button>
              <button
                type="button"
                class="flex h-8 w-3.5 shrink-0 items-center justify-center text-muted"
                aria-label={open ? `Collapse “${layer.name}”` : `Expand “${layer.name}”`}
                title={open ? `Collapse “${layer.name}”` : `Expand “${layer.name}”`}
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
                  onclick={() => {
                    // Clicking a layer targets the layer itself, so the trash then deletes it
                    // rather than whatever object was still selected elsewhere.
                    deselectAll();
                    setCurrentLayer(layer.id);
                  }}
                  onpointerup={(e) => tapName("layer", layer.id, layer.name, e)}
                >
                  {layer.name}
                </button>
              {/if}
              <button
                type="button"
                class={toggleClass(layer.locked)}
                aria-label={layer.locked ? `Unlock “${layer.name}”` : `Lock “${layer.name}”`}
                title={layer.locked ? `Unlock “${layer.name}”` : `Lock “${layer.name}”`}
                onclick={() => toggleLayerLocked(layer.id)}
              >
                {#if layer.locked}<Lock size={14} />{:else}<LockOpen size={14} />{/if}
              </button>
              <button
                type="button"
                class={toggleClass(!layer.visible)}
                aria-label={layer.visible ? `Hide “${layer.name}”` : `Show “${layer.name}”`}
                title={layer.visible ? `Hide “${layer.name}”` : `Show “${layer.name}”`}
                onclick={() => toggleLayerVisible(layer.id)}
              >
                {#if layer.visible}<Eye size={14} />{:else}<EyeOff size={14} />{/if}
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
      {#if ghost}
        <!-- The grabbed row, following the pointer (2026-10-01). With several objects selected
             it carries their count. -->
        <div
          data-drag-ghost
          class="pointer-events-none absolute inset-x-0 z-10 flex h-8 items-center gap-1 border-y border-accent bg-raised pr-[6px] shadow-lg"
          style="top: {ghost.top}px; padding-left: {ghost.pad}"
        >
          <span class="flex w-3.5 shrink-0 justify-center text-muted"
            ><GripVertical size={14} /></span
          >
          <span class="w-3.5 shrink-0"></span>
          <span class="min-w-0 flex-1 truncate">{ghost.label}</span>
          {#if ghost.count > 1}
            <span class="rounded bg-accent px-1.5 text-[10px] text-accent-text">{ghost.count}</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>
