<script lang="ts">
  let {
    label,
    value,
    min = -Infinity,
    max = Infinity,
    suffix = "",
    onchange,
  }: {
    label: string;
    value: number | null;
    min?: number;
    max?: number;
    suffix?: string;
    onchange: (v: number) => void;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let initial = "";
  const shown = $derived(
    editing ? draft : value === null ? "" : String(Math.round(value * 100) / 100),
  );

  function commit() {
    editing = false;
    if (draft === initial) return;
    const v = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(v)) return;
    onchange(Math.min(max, Math.max(min, v)));
  }
</script>

<!-- Two grid cells, not a flex box: the label and the field each belong to a column shared with
     every other row in the panel (see `.field-grid`). The unit sits INSIDE the field rather than in
     a third column — a column would end every numeric row short of the panel's right edge while a
     full-width control (a button, a select, the align row) ran to it, and the two right edges read
     as a step. `pointer-events-none` so a click on the unit still lands in the input, and the
     input's right padding is what keeps the digits off it. -->
<label class="field-row text-xs whitespace-nowrap">
  <span class="text-muted">{label}</span>
  <span class="relative block w-full min-w-0">
    <input
      class={["field w-full min-w-0 tabular-nums", suffix && "pr-6"]}
      type="text"
      inputmode="decimal"
      value={shown}
      placeholder={value === null ? "–" : ""}
      onfocus={(e) => {
        draft = e.currentTarget.value;
        initial = draft;
        editing = true;
      }}
      oninput={(e) => (draft = e.currentTarget.value)}
      onkeydown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          editing = false;
          e.currentTarget.blur();
        }
      }}
      onblur={() => {
        if (editing) commit();
      }}
    />
    {#if suffix}
      <span
        class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-muted"
        aria-hidden="true">{suffix}</span
      >
    {/if}
  </span>
</label>
