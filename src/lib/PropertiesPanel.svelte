<script lang="ts">
  import { DEFAULT_STYLE, type LineCap, type LineJoin, type Paint } from "../doc/document";
  import { app, applyGeometry, setSelectionStyle } from "../state/appState.svelte";
  import {
    selectionGeometry,
    selectionStyles,
    summarizeStyles,
    type Field,
    type GeometryField,
  } from "../state/properties";
  import NumberField from "./NumberField.svelte";
  import PaintField from "./PaintField.svelte";

  // The default style always has both paints.
  const FILL_FALLBACK: Paint = DEFAULT_STYLE.fill!;
  const STROKE_FALLBACK: Paint = DEFAULT_STYLE.stroke!;
  const GEOMETRY: { field: GeometryField; label: string; min?: number; suffix?: string }[] = [
    { field: "x", label: "X" },
    { field: "y", label: "Y" },
    { field: "w", label: "W", min: 0.01 },
    { field: "h", label: "H", min: 0.01 },
    { field: "r", label: "R", suffix: "°" },
  ];

  const hasSelection = $derived(app.selection.length > 0);
  const summary = $derived(
    summarizeStyles(hasSelection ? selectionStyles(app.doc, app.selection) : [app.prefs.style]),
  );
  const geometry = $derived(hasSelection ? selectionGeometry(app.doc, app.selection) : null);
  const value = <T,>(f: Field<T>): T | null => (f.mixed ? null : f.value);
</script>

<aside
  class="flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-panel p-3 text-xs"
  aria-label="Properties"
>
  <h2 class="section-title">
    {hasSelection ? "Selection" : "Defaults for new shapes"}
  </h2>

  {#if summary}
    <PaintField
      label="Fill"
      field={summary.fill}
      present={summary.fillOn}
      fallback={app.prefs.style.fill ?? FILL_FALLBACK}
      onchange={(p) => setSelectionStyle({ fill: p })}
    />
    <PaintField
      label="Stroke"
      field={summary.stroke}
      present={summary.strokeOn}
      fallback={app.prefs.style.stroke ?? STROKE_FALLBACK}
      onchange={(p) => setSelectionStyle({ stroke: p })}
    />
    <div class="flex flex-wrap items-center gap-2">
      <NumberField
        label="Width"
        value={value(summary.strokeWidth)}
        min={0}
        max={1000}
        onchange={(v) => setSelectionStyle({ strokeWidth: v })}
      />
      <label class="flex items-center gap-1">
        <span class="text-muted">Cap</span>
        <select
          class="field"
          value={value(summary.cap) ?? ""}
          onchange={(e) => setSelectionStyle({ cap: e.currentTarget.value as LineCap })}
        >
          <option value="" disabled>mixed</option>
          <option value="butt">butt</option>
          <option value="round">round</option>
          <option value="square">square</option>
        </select>
      </label>
      <label class="flex items-center gap-1">
        <span class="text-muted">Join</span>
        <select
          class="field"
          value={value(summary.join) ?? ""}
          onchange={(e) => setSelectionStyle({ join: e.currentTarget.value as LineJoin })}
        >
          <option value="" disabled>mixed</option>
          <option value="miter">miter</option>
          <option value="round">round</option>
          <option value="bevel">bevel</option>
        </select>
      </label>
    </div>
    <NumberField
      label="Opacity"
      value={summary.opacity.mixed ? null : Math.round(summary.opacity.value * 100)}
      min={0}
      max={100}
      suffix="%"
      onchange={(v) => setSelectionStyle({ opacity: v / 100 })}
    />
  {/if}

  {#if geometry}
    <div class="flex flex-col gap-2 border-t border-line pt-3">
      <span class="section-title">Geometry</span>
      <div class="grid grid-cols-2 gap-2">
        {#each GEOMETRY as g (g.field)}
          <NumberField
            label={g.label}
            value={geometry[g.field]}
            min={g.min}
            suffix={g.suffix}
            onchange={(v) => applyGeometry(g.field, v)}
          />
        {/each}
      </div>
    </div>
  {/if}
</aside>
