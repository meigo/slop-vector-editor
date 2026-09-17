<script lang="ts">
  import { ClipboardPaste, Copy, CopyPlus, Scissors, Trash2 } from "@lucide/svelte";
  import type { Node, RectShape } from "../doc/document";
  import { findTopLevel } from "../doc/tree";
  import {
    app,
    convertSelectionToPath,
    copyToSystem,
    cutToSystem,
    deleteSelection,
    duplicateSelection,
    flattenSelection,
    pasteFromClipboard,
    setPolygonPrefs,
    setSelectionPolygon,
    setSelectionRectRadius,
  } from "../state/appState.svelte";
  import { selectionActions, summarizePolygons } from "../state/properties";
  import { TOOLS } from "../tools/registry";
  import NumberField from "./NumberField.svelte";
  import ToggleButton from "./ToggleButton.svelte";

  const nodes = $derived(
    app.selection
      .map((id) => findTopLevel(app.doc, id)?.node)
      .filter((n): n is Node => n !== undefined),
  );
  const actions = $derived(selectionActions(app.doc, app.selection));
  const rects = $derived(nodes.filter((n): n is RectShape => n.kind === "rect"));
  const onlyRects = $derived(rects.length > 0 && rects.length === nodes.length);
  const radius = $derived(
    onlyRects && rects.every((r) => r.rx === rects[0].rx) ? rects[0].rx : null,
  );
  const polygons = $derived(summarizePolygons(app.doc, app.selection));
  const poly = $derived(app.prefs.polygon);
</script>

<div
  class="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-panel px-3 text-xs"
>
  {#if app.toolId === "polygon"}
    <NumberField
      label="Sides"
      value={poly.sides}
      min={3}
      max={32}
      onchange={(v) => setPolygonPrefs({ sides: Math.round(v) })}
    />
    <ToggleButton label="Star" value={poly.star} onchange={(star) => setPolygonPrefs({ star })} />
    {#if poly.star}
      <NumberField
        label="Inner"
        value={Math.round(poly.innerRatio * 100)}
        min={10}
        max={95}
        suffix="%"
        onchange={(v) => setPolygonPrefs({ innerRatio: v / 100 })}
      />
    {/if}
  {:else if app.selection.length > 0}
    <span class="text-muted">{app.selection.length} selected</span>
    <button class="btn gap-1" onclick={cutToSystem}><Scissors size={14} /> Cut</button>
    <button class="btn gap-1" onclick={copyToSystem}><Copy size={14} /> Copy</button>
    <button class="btn gap-1" onclick={() => void pasteFromClipboard()}>
      <ClipboardPaste size={14} /> Paste
    </button>
    <button class="btn gap-1" onclick={duplicateSelection}>
      <CopyPlus size={14} /> Duplicate
    </button>
    <button class="btn gap-1" onclick={deleteSelection}><Trash2 size={14} /> Delete</button>
    {#if actions.canConvert}
      <button class="btn" onclick={convertSelectionToPath}>Convert to path</button>
    {/if}
    {#if actions.canFlatten}
      <button class="btn" onclick={flattenSelection}>Flatten transform</button>
    {/if}
    {#if onlyRects}
      <NumberField label="Radius" value={radius} min={0} onchange={setSelectionRectRadius} />
    {/if}
    {#if polygons}
      <NumberField
        label="Sides"
        value={polygons.sides}
        min={3}
        max={32}
        onchange={(v) => setSelectionPolygon({ sides: Math.round(v) })}
      />
      <ToggleButton
        label="Star"
        value={polygons.star}
        onchange={(star) => setSelectionPolygon({ star })}
      />
      {#if polygons.anyStar}
        <NumberField
          label="Inner"
          value={polygons.innerRatio === null ? null : Math.round(polygons.innerRatio * 100)}
          min={10}
          max={95}
          suffix="%"
          onchange={(v) => setSelectionPolygon({ innerRatio: v / 100 })}
        />
      {/if}
    {/if}
  {:else}
    {#if app.toolId === "select"}
      <button class="btn gap-1" onclick={() => void pasteFromClipboard()}>
        <ClipboardPaste size={14} /> Paste
      </button>
    {/if}
    <span class="truncate text-muted">{TOOLS[app.toolId].hint}</span>
  {/if}
</div>
