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

<!-- Three grid cells, not a flex box: the label, the field and the unit each belong to a column
     shared with every other row in the panel (see `.field-grid`). The empty spans matter — a row
     with no label or no unit still needs its cells, or the columns shift. -->
<label class="field-row text-xs whitespace-nowrap">
  <span class="text-muted">{label}</span>
  <input
    class="field w-full min-w-0 tabular-nums"
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
  <span class="text-muted">{suffix}</span>
</label>
