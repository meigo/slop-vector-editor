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

<label class="flex items-center gap-1 text-xs">
  {#if label}<span class="text-muted">{label}</span>{/if}
  <input
    class="field w-16 tabular-nums"
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
  {#if suffix}<span class="text-muted">{suffix}</span>{/if}
</label>
