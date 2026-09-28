<script lang="ts">
  import type { Field } from "../state/properties";
  import NumberField from "./NumberField.svelte";
  import ToggleButton from "./ToggleButton.svelte";

  let {
    label,
    mid,
    onmid,
    auto,
    onauto,
    onlivestart,
    onliveend,
  }: {
    /** Accessible name prefix, e.g. "Fill". */
    label: string;
    mid: Field<number>;
    onmid: (mid: number) => void;
    /** Spec M18 §4: whether the middle stop is the computed mix. */
    auto: Field<boolean>;
    onauto: (auto: boolean) => void;
    /** Brackets a slider drag so the whole drag is one undo step (invariant 42). The caller owns
     *  the document gesture; this component never touches the store. */
    onlivestart?: () => void;
    onliveend?: () => void;
  } = $props();

  const pct = $derived(mid.mixed ? null : Math.round(mid.value * 100));
  let live = $state(false);

  function startLive() {
    if (live) return;
    live = true;
    onlivestart?.();
  }

  /** Every way a drag can end: `change`, `blur` (no `change` fires when nothing moved) and
   *  destruction (clearing the selection removes this row mid-drag). */
  function endLive() {
    if (!live) return;
    live = false;
    onliveend?.();
  }

  $effect(() => () => endLive());
</script>

<!-- Spec M17 §5: where the two colours mix 50/50. The slider is the app's first range input:
     `touch-action: none` so iPadOS reads a drag on it as a drag, not a scroll (invariant 6),
     `--ctl-h` high like every other control (invariant 23), and the raised field look
     (`rounded border border-line bg-raised`, as `PaintRow`'s `type="color"` input composes it —
     a range input has no `.field` styling of its own to fall back on). -->
<div class="flex items-center gap-2" title="Midpoint — where the middle stop sits">
  <span class="w-9 shrink-0 text-muted">Mid</span>
  <input
    type="range"
    min="1"
    max="99"
    step="1"
    class="min-w-0 flex-1 cursor-pointer rounded border border-line bg-raised"
    style="height: var(--ctl-h); touch-action: none"
    aria-label="{label} midpoint"
    value={pct ?? 50}
    oninput={(e) => {
      startLive();
      onmid(Number(e.currentTarget.value) / 100);
    }}
    onchange={endLive}
    onblur={endLive}
  />
  <!-- `NumberField`'s root is `display: contents`; this wrapper is the flex item it sizes
       against, as in PaintRow. -->
  <div class="w-12 shrink-0">
    <NumberField
      {onlivestart}
      {onliveend}
      label=""
      value={pct}
      min={1}
      max={99}
      suffix="%"
      onchange={(v) => onmid(Math.round(v) / 100)}
    />
  </div>
  <!-- Spec M18 §4: Auto = the middle stop is the computed mix. Pressing it on drops any custom
       colour; off seeds the mix, so the artwork doesn't change until a colour is picked. -->
  <ToggleButton
    label="Auto"
    ariaLabel="{label} middle colour automatic"
    title="Middle colour — Auto mixes Start and End; off keeps a colour of its own"
    value={auto.mixed ? "mixed" : auto.value}
    onchange={() => onauto(auto.mixed ? true : !auto.value)}
  />
</div>
