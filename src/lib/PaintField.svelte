<script lang="ts">
  import { isGradient, type Fill, type Paint } from "../doc/document";
  import type { StopEnd } from "../doc/paint-edit";
  import type { Field } from "../state/properties";
  import MidpointRow from "./MidpointRow.svelte";
  import PaintRow from "./PaintRow.svelte";
  import ToggleButton from "./ToggleButton.svelte";

  const STOPS: readonly StopEnd[] = ["start", "end"];

  let {
    label,
    field,
    present,
    fallback,
    kind,
    stops,
    picked,
    mid = null,
    onchange,
    onkind,
    onstop,
    onmid,
    onlivestart,
    onliveend,
  }: {
    label: string;
    field: Field<Fill | null>;
    present: Field<boolean>;
    fallback: Paint;
    /** null = nothing selected — the Linear/Radial toggles are a no-op, and say why
     *  (invariant 24). */
    kind: Field<"flat" | "linear" | "radial"> | null;
    stops: { start: Field<Paint>; end: Field<Paint> } | null;
    /** The stop picked on the canvas (spec M15 §7). */
    picked: StopEnd | null;
    /** Spec M17 §5: null when not every paint is a gradient (then there are no stop rows either). */
    mid?: Field<number> | null;
    onchange: (p: Paint | null) => void;
    onkind: (k: "flat" | "linear" | "radial") => void;
    onstop: (stop: StopEnd, p: Paint) => void;
    onmid?: (mid: number) => void;
    /** Brackets a live drag of the swatch so the whole drag is one undo step. The caller owns the
     *  document gesture; this component stays presentational and never touches the store. */
    onlivestart?: () => void;
    onliveend?: () => void;
  } = $props();

  // A gradient's own row comes from `stops`, not `field`.
  const paint = $derived(field.mixed || isGradient(field.value) ? null : field.value);
</script>

<div class="flex flex-col gap-1">
  <div class="flex items-center justify-between">
    <span class="section-title">{label}</span>
    <ToggleButton
      label="On"
      ariaLabel={`${label} on`}
      value={present.mixed ? "mixed" : present.value}
      onchange={(on) => onchange(on ? (paint ?? fallback) : null)}
    />
  </div>
  {#if present.mixed || present.value}
    <div class="flex gap-1">
      <ToggleButton
        label="Flat"
        ariaLabel={`${label} flat`}
        value={kind === null ? true : kind.mixed ? "mixed" : kind.value === "flat"}
        onchange={() => onkind("flat")}
      />
      <!-- Spec M15 §6, M16 §5: with nothing selected the panel edits the defaults for new shapes,
           which stay flat — so Linear/Radial say why they do nothing instead of disappearing
           (invariant 24). -->
      <ToggleButton
        label="Linear"
        ariaLabel={`${label} linear gradient`}
        value={kind === null ? false : kind.mixed ? "mixed" : kind.value === "linear"}
        disabled={kind === null}
        title={kind === null ? "Linear gradient — select an object first" : "Linear gradient"}
        onchange={() => kind !== null && onkind("linear")}
      />
      <ToggleButton
        label="Radial"
        ariaLabel={`${label} radial gradient`}
        value={kind === null ? false : kind.mixed ? "mixed" : kind.value === "radial"}
        disabled={kind === null}
        title={kind === null ? "Radial gradient — select an object first" : "Radial gradient"}
        onchange={() => kind !== null && onkind("radial")}
      />
    </div>
  {/if}
  {#if paint}
    <PaintRow {label} {paint} onchange={(p) => onchange(p)} {onlivestart} {onliveend} />
  {:else if stops}
    {#each STOPS as stop (stop)}
      {@const f = stops[stop]}
      {#if stop === "end" && mid && onmid}
        <MidpointRow {label} {mid} {onmid} {onlivestart} {onliveend} />
      {/if}
      {#if !f.mixed}
        <div class="flex items-center gap-2">
          <span class="w-9 shrink-0 text-muted">{stop === "start" ? "Start" : "End"}</span>
          <PaintRow
            label={`${label} ${stop}`}
            paint={f.value}
            selected={picked === stop}
            onchange={(p) => onstop(stop, p)}
            {onlivestart}
            {onliveend}
          />
        </div>
      {/if}
    {/each}
  {/if}
</div>
