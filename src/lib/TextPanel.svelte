<script lang="ts">
  import type { PathShape } from "../doc/document";
  import { addFontFile, setTitleFont, setTitleOpts, setTitleText } from "../state/appState.svelte";
  import { fontAvailable, fontChoices } from "../text/font";
  import NumberField from "./NumberField.svelte";

  /** Spec (M10) §6. Typing happens here rather than on the canvas so the iPad keyboard never
   *  covers the artwork, and so this reuses the panel machinery instead of inventing a caret. */
  let { title }: { title: PathShape } = $props();

  const meta = $derived(title.text!);
  const ready = $derived(fontAvailable(meta.font));
  const missing = $derived(
    `Change the text — the font "${meta.font}" isn't available. Add it with “Add a font…”.`,
  );
  const choices = $derived(fontChoices());

  let picker: HTMLInputElement | null = $state(null);

  const ALIGNS = [
    { v: "left", label: "Align left" },
    { v: "center", label: "Align centre" },
    { v: "right", label: "Align right" },
  ] as const;
</script>

<div class="flex flex-col gap-2 border-t border-line pt-3">
  <span class="section-title">Text</span>

  <input
    class="field"
    aria-label="Title text"
    value={meta.text}
    aria-disabled={!ready}
    title={ready ? "Change the text" : missing}
    onchange={async (e) => {
      if (!ready) return;
      const el = e.currentTarget;
      await setTitleText(el.value);
      // A refusal — an unshaped script, or an empty string — leaves the title alone, so put the
      // field back to what the title actually says rather than leaving the rejected text in it.
      el.value = meta.text;
    }}
  />

  <div class="flex items-center gap-2">
    <select
      class="field min-w-0 flex-1"
      aria-label="Font"
      aria-disabled={!ready}
      title={ready ? "Change the font" : missing}
      value={meta.font}
      onchange={(e) => void setTitleFont(e.currentTarget.value)}
    >
      {#each choices as c (c.id)}
        <option value={c.id}>{c.label}</option>
      {/each}
      {#if !choices.some((c) => c.id === meta.font)}
        <option value={meta.font}>{meta.font} (not loaded)</option>
      {/if}
    </select>
    <button class="btn" title="Add a font from a file" onclick={() => picker?.click()}>
      Add a font…
    </button>
    <input
      bind:this={picker}
      type="file"
      accept=".ttf,.otf,.woff"
      class="hidden"
      aria-hidden="true"
      tabindex="-1"
      onchange={(e) => {
        const f = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (f) void addFontFile(f);
      }}
    />
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <NumberField
      label="Size"
      value={meta.size}
      min={1}
      onchange={(v) => void setTitleOpts({ size: v })}
    />
    <NumberField
      label="Spacing"
      value={meta.letterSpacing}
      onchange={(v) => void setTitleOpts({ letterSpacing: v })}
    />
  </div>

  <div class="flex items-center gap-1">
    {#each ALIGNS as a (a.v)}
      <button
        class={["btn flex-1", meta.align === a.v && "ui-on"]}
        aria-pressed={meta.align === a.v}
        title={a.label}
        onclick={() => void setTitleOpts({ align: a.v })}
      >
        {a.v === "left" ? "⇤" : a.v === "center" ? "⇔" : "⇥"}
      </button>
    {/each}
  </div>
</div>
