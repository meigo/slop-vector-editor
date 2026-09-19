<script lang="ts">
  import { DEFAULT_STYLE, type LineCap, type LineJoin, type Paint } from "../doc/document";
  import {
    app,
    beginDocGesture,
    endDocGesture,
    applyGeometry,
    moveSelectedNodes,
    setPolygonPrefs,
    setSelectedNodeType,
    setSelectionOpacity,
    setSelectionPolygon,
    setSelectionRectRadius,
    setSelectionStyle,
  } from "../state/appState.svelte";
  import {
    selectedNodeSummary,
    selectionGeometry,
    selectionOpacity,
    selectionStyles,
    summarizePolygons,
    summarizeRects,
    summarizeStyles,
    type Field,
    type GeometryField,
  } from "../state/properties";
  import NumberField from "./NumberField.svelte";
  import PanelHeader from "./PanelHeader.svelte";
  import TextPanel from "./TextPanel.svelte";
  import { selectedTitle } from "../state/appState.svelte";
  import FieldSection from "./FieldSection.svelte";
  import PaintField from "./PaintField.svelte";
  import ToggleButton from "./ToggleButton.svelte";

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
  const NODE_TYPES = [
    { type: "corner" as const, label: "Corner" },
    { type: "smooth" as const, label: "Smooth" },
    { type: "symmetric" as const, label: "Symmetric" },
  ];
  const nodeSummary = $derived(
    app.toolId === "node" && selectedNodeSummary(app.doc, app.nodeTarget, app.nodeSel),
  );

  const hasSelection = $derived(app.selection.length > 0);
  const opacity = $derived(selectionOpacity(app.doc, app.selection));
  const opacityValue = $derived.by(() => {
    const field = opacity ?? summary?.opacity;
    if (!field) return null;
    return field.mixed ? null : Math.round(field.value * 100);
  });
  const summary = $derived(
    summarizeStyles(hasSelection ? selectionStyles(app.doc, app.selection) : [app.prefs.style]),
  );
  const geometry = $derived(hasSelection ? selectionGeometry(app.doc, app.selection) : null);
  const rects = $derived(hasSelection ? summarizeRects(app.doc, app.selection) : null);
  const polygons = $derived(hasSelection ? summarizePolygons(app.doc, app.selection) : null);
  const poly = $derived(app.prefs.polygon);
  /** Spec M10 §6: the Text section appears for a single selected title. */
  const title = $derived(selectedTitle());
  const value = <T,>(f: Field<T>): T | null => (f.mixed ? null : f.value);

  let { expanded, ontoggle, flex }: { expanded: boolean; ontoggle: () => void; flex: string } =
    $props();
</script>

<section class="flex min-h-0 flex-col" style:flex aria-label="Properties">
  <PanelHeader
    title="Properties"
    open={expanded}
    {ontoggle}
    showTitle="Show the properties"
    hideTitle="Hide the properties"
  />
  {#if expanded}
    <div
      class="field-grid min-h-0 flex-1 content-start overflow-y-auto overscroll-contain p-3 text-xs"
    >
      <h2 class="section-title field-full">
        {hasSelection ? "Selection" : "Defaults for new shapes"}
      </h2>

      <!-- Spec M10 §6: first, not last. Placing a title is immediately followed by typing it, and
           this panel scrolls — below the paint and geometry sections it sat under the fold. -->
      {#if title}
        <TextPanel {title} />
      {/if}

      {#if summary}
        <div class="field-full">
          <PaintField
            label="Fill"
            field={summary.fill}
            present={summary.fillOn}
            fallback={app.prefs.style.fill ?? FILL_FALLBACK}
            onchange={(p) => setSelectionStyle({ fill: p })}
            onlivestart={beginDocGesture}
            onliveend={endDocGesture}
          />
        </div>
        <div class="field-full">
          <PaintField
            label="Stroke"
            field={summary.stroke}
            present={summary.strokeOn}
            fallback={app.prefs.style.stroke ?? STROKE_FALLBACK}
            onchange={(p) => setSelectionStyle({ stroke: p })}
            onlivestart={beginDocGesture}
            onliveend={endDocGesture}
          />
        </div>
        <NumberField
          label="Width"
          value={value(summary.strokeWidth)}
          min={0}
          max={1000}
          onchange={(v) => setSelectionStyle({ strokeWidth: v })}
        />
        <label class="field-row">
          <span class="text-muted">Cap</span>
          <select
            class="field w-full min-w-0"
            value={value(summary.cap) ?? ""}
            onchange={(e) => setSelectionStyle({ cap: e.currentTarget.value as LineCap })}
          >
            <option value="" disabled>mixed</option>
            <option value="butt">butt</option>
            <option value="round">round</option>
            <option value="square">square</option>
          </select>
        </label>
        <label class="field-row">
          <span class="text-muted">Join</span>
          <select
            class="field w-full min-w-0"
            value={value(summary.join) ?? ""}
            onchange={(e) => setSelectionStyle({ join: e.currentTarget.value as LineJoin })}
          >
            <option value="" disabled>mixed</option>
            <option value="miter">miter</option>
            <option value="round">round</option>
            <option value="bevel">bevel</option>
          </select>
        </label>
        <NumberField
          label="Opacity"
          value={opacityValue}
          min={0}
          max={100}
          suffix="%"
          onchange={(v) => setSelectionOpacity(v / 100)}
        />
      {/if}

      {#if rects || polygons}
        <FieldSection id="shape" title="Shape">
          {#if rects}
            <NumberField
              label="Radius"
              value={rects.radius}
              min={0}
              onchange={setSelectionRectRadius}
            />
          {/if}
          {#if polygons}
            <NumberField
              label="Sides"
              value={polygons.sides}
              min={3}
              max={32}
              onchange={(v) => setSelectionPolygon({ sides: Math.round(v) })}
            />
            <div class="field-full">
              <ToggleButton
                label="Star"
                value={polygons.star}
                onchange={(star) => setSelectionPolygon({ star })}
              />
            </div>
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
        </FieldSection>
      {/if}

      {#if !hasSelection || app.toolId === "polygon"}
        <FieldSection id="newPolygons" title="New polygons">
          <NumberField
            label="Sides"
            value={poly.sides}
            min={3}
            max={32}
            onchange={(v) => setPolygonPrefs({ sides: Math.round(v) })}
          />
          <div class="field-full">
            <ToggleButton
              label="Star"
              value={poly.star}
              onchange={(star) => setPolygonPrefs({ star })}
            />
          </div>
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
        </FieldSection>
      {/if}

      {#if nodeSummary}
        <FieldSection id="node" title="Node">
          <div class="field-full flex gap-1">
            {#each NODE_TYPES as t (t.type)}
              <ToggleButton
                value={nodeSummary.type === "mixed" ? "mixed" : nodeSummary.type === t.type}
                label={t.label}
                onchange={() => setSelectedNodeType(t.type)}
              />
            {/each}
          </div>
          {#if nodeSummary.point}
            {@const pt = nodeSummary.point}
            <NumberField label="X" value={pt.x} onchange={(v) => moveSelectedNodes(v - pt.x, 0)} />
            <NumberField label="Y" value={pt.y} onchange={(v) => moveSelectedNodes(0, v - pt.y)} />
          {/if}
        </FieldSection>
      {/if}

      {#if geometry}
        <FieldSection id="geometry" title="Geometry">
          {#each GEOMETRY as g (g.field)}
            <NumberField
              label={g.label}
              value={geometry[g.field]}
              min={g.min}
              suffix={g.suffix}
              onchange={(v) => applyGeometry(g.field, v)}
            />
          {/each}
        </FieldSection>
      {/if}
    </div>
  {/if}
</section>
