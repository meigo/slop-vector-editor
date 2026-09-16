<script lang="ts">
  import { Copy, Trash2 } from "@lucide/svelte";
  import type { Node, RectShape } from "../doc/document";
  import { findTopLevel } from "../doc/tree";
  import { isIdentity } from "../geom/mat";
  import {
    app,
    convertSelectionToPath,
    deleteSelection,
    duplicateSelection,
    flattenSelection,
    setPolygonPrefs,
    setSelectionRectRadius,
  } from "../state/appState.svelte";
  import { TOOLS } from "../tools/registry";
  import NumberField from "./NumberField.svelte";

  const nodes = $derived(
    app.selection
      .map((id) => findTopLevel(app.doc, id)?.node)
      .filter((n): n is Node => n !== undefined),
  );
  const canConvert = $derived(nodes.some((n) => n.kind === "rect" || n.kind === "ellipse"));
  const canFlatten = $derived(nodes.some((n) => n.kind === "path" && !isIdentity(n.transform)));
  const rects = $derived(nodes.filter((n): n is RectShape => n.kind === "rect"));
  const onlyRects = $derived(rects.length > 0 && rects.length === nodes.length);
  const radius = $derived(
    onlyRects && rects.every((r) => r.rx === rects[0].rx) ? rects[0].rx : null,
  );
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
    <label class="flex items-center gap-1">
      <input
        type="checkbox"
        checked={poly.star}
        onchange={(e) => setPolygonPrefs({ star: e.currentTarget.checked })}
      />
      Star
    </label>
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
    <button class="btn gap-1" onclick={deleteSelection}><Trash2 size={14} /> Delete</button>
    <button class="btn gap-1" onclick={duplicateSelection}><Copy size={14} /> Duplicate</button>
    {#if canConvert}
      <button class="btn" onclick={convertSelectionToPath}>Convert to path</button>
    {/if}
    {#if canFlatten}
      <button class="btn" onclick={flattenSelection}>Flatten transform</button>
    {/if}
    {#if onlyRects}
      <NumberField label="Radius" value={radius} min={0} onchange={setSelectionRectRadius} />
    {/if}
  {:else}
    <span class="truncate text-muted">{TOOLS[app.toolId].hint}</span>
  {/if}
</div>
