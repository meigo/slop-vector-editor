<script lang="ts">
  import { onMount } from "svelte";
  import {
    addGoogleFamily,
    app,
    previewGoogleFamily,
    selectedTitle,
  } from "../state/appState.svelte";
  import {
    CATEGORIES,
    googleFontId,
    loadCatalogue,
    searchFamilies,
    type GoogleFamily,
  } from "../text/google-catalogue";
  import { previewOutline } from "../text/preview";
  import Modal from "./Modal.svelte";
  import ToggleButton from "./ToggleButton.svelte";

  /** Spec M20 §6, §7: every family's licence is shown, in the list and again under the preview. */
  const LICENCE_NAME: Record<GoogleFamily["license"], string> = {
    "OFL-1.1": "SIL Open Font License 1.1",
    "Apache-2.0": "Apache License 2.0",
    "UFL-1.0": "Ubuntu Font Licence 1.0",
  };

  type Preview =
    | { kind: "loading" }
    | { kind: "ready"; outline: ReturnType<typeof previewOutline> }
    | { kind: "error"; text: string };

  let all = $state.raw<readonly GoogleFamily[] | null>(null);
  let catalogueError = $state(false);
  let query = $state("");
  let category = $state<string | null>(null);
  let picked = $state.raw<GoogleFamily | null>(null);
  let preview = $state.raw<Preview | null>(null);
  let adding = $state(false);
  let addError = $state<string | null>(null);

  const shown = $derived(all ? searchFamilies(all, query, category) : []);

  function fetchCatalogue() {
    catalogueError = false;
    loadCatalogue().then(
      (list) => (all = list),
      () => (catalogueError = true),
    );
  }

  onMount(fetchCatalogue);

  function close() {
    app.dialog = null;
  }

  /** Only the newest pick may land: a slow download for an earlier pick must not overwrite the
   *  preview of the family now highlighted. */
  let pickSeq = 0;

  async function pick(f: GoogleFamily) {
    if (adding) return;
    picked = f;
    addError = null;
    preview = { kind: "loading" };
    const seq = ++pickSeq;
    const r = await previewGoogleFamily(f);
    if (seq !== pickSeq) return;
    preview =
      "font" in r
        ? { kind: "ready", outline: previewOutline(r.font, f.family) }
        : { kind: "error", text: r.error };
  }

  /** Closes only when the family is in AND the selected title now uses it (or nothing was
   *  selected, so it became the font for new titles). Anything else leaves the dialog open with
   *  the reason — the notice that the store raised for it. */
  async function add() {
    const f = picked;
    if (!f || adding) return;
    adding = true;
    addError = null;
    const before = new Set(app.notices);
    const ok = await addGoogleFamily(f);
    adding = false;
    const t = selectedTitle();
    if (ok && (!t || t.text?.font === googleFontId(f))) {
      close();
      return;
    }
    const raised = app.notices.filter((n) => !before.has(n)).at(-1);
    addError =
      raised?.text ??
      (ok
        ? `${f.family} was added, but the title couldn't switch to it.`
        : `${f.family} couldn't be added.`);
  }

  const addReason = $derived(
    adding
      ? `Adding ${picked?.family ?? "the font"}…`
      : picked
        ? null
        : "Add — pick a family first",
  );
</script>

<Modal title="Add from Google Fonts" onclose={close}>
  <input
    class="field w-full"
    type="search"
    placeholder="Search families"
    aria-label="Search Google Fonts"
    title="Search families by name"
    bind:value={query}
  />

  <div class="mt-2 flex flex-wrap gap-1">
    {#each CATEGORIES as c (c.label)}
      <ToggleButton
        label={c.label}
        value={category === c.id}
        title={c.id === null ? "Show every category" : `Show only ${c.label} families`}
        onchange={() => (category = c.id)}
      />
    {/each}
  </div>

  <div
    class="mt-2 h-48 overflow-y-auto overscroll-contain rounded border border-line bg-ground py-1"
    role="listbox"
    aria-label="Google Fonts families"
  >
    {#if catalogueError}
      <div class="flex flex-col items-start gap-2 px-3 py-2 text-xs">
        <span class="text-danger">The font list couldn't be loaded.</span>
        <button class="btn" title="Load the font list again" onclick={fetchCatalogue}>
          Try again
        </button>
      </div>
    {:else if all === null}
      <p class="px-3 py-2 text-xs text-muted">Loading the font list…</p>
    {:else if shown.length === 0}
      <p class="px-3 py-2 text-xs text-muted">No families match.</p>
    {:else}
      {#each shown as f (f.id)}
        <button
          class={["menu-item min-h-(--ctl-h) gap-2", picked?.id === f.id && "ui-selected"]}
          role="option"
          aria-selected={picked?.id === f.id}
          title={`Preview ${f.family}`}
          onclick={() => void pick(f)}
        >
          <span class="min-w-0 truncate">{f.family}</span>
          <span class="kbd shrink-0">{f.license}</span>
        </button>
      {/each}
    {/if}
  </div>

  <!-- A fixed height, so the dialog doesn't grow and shrink under the pointer as picks land. -->
  <div
    class="mt-2 flex h-28 flex-col justify-center gap-1 overflow-hidden rounded border border-line px-3 py-2 text-xs"
    aria-live="polite"
  >
    {#if !picked}
      <p class="text-muted">Pick a family to preview it.</p>
    {:else if preview?.kind === "loading"}
      <p class="text-muted">Downloading {picked.family}…</p>
    {:else if preview?.kind === "error"}
      <p class="text-danger">{preview.text}</p>
    {:else if preview?.kind === "ready"}
      {#if preview.outline}
        {@const b = preview.outline.box}
        <svg
          class="max-h-16 max-w-full self-start"
          viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
          width={b.w}
          height={b.h}
          role="img"
          aria-label={`${picked.family} preview`}
        >
          <path d={preview.outline.d} fill="currentColor" />
        </svg>
      {:else}
        <p class="text-muted">{picked.family} has no letters for the sample.</p>
      {/if}
      <p class="text-muted">{LICENCE_NAME[picked.license]}</p>
    {/if}
  </div>

  {#if addError}
    <p class="mt-2 text-xs text-danger">{addError}</p>
  {/if}

  {#snippet actions()}
    <button class="btn" title="Close without adding (Esc)" onclick={close}>Cancel</button>
    <button
      class="btn btn-primary aria-disabled:cursor-default aria-disabled:opacity-50"
      aria-disabled={addReason !== null}
      title={addReason ?? `Add ${picked?.family} and use it`}
      onclick={() => void add()}
    >
      {adding ? "Adding…" : "Add"}
    </button>
  {/snippet}
</Modal>
