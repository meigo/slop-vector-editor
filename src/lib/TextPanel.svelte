<script lang="ts">
  import { TextAlignCenter, TextAlignEnd, TextAlignStart } from "@lucide/svelte";
  import type { PathShape } from "../doc/document";
  import {
    addFontFile,
    abandonTitleTyping,
    addGoogleFamily,
    beginUiGesture,
    endTitleTyping,
    finishCharDrag,
    fontsChangedTick,
    startTitleTyping,
    app,
    clearCharOverride,
    rerollTitle,
    setCharOverride,
    setTitleFont,
    setTitleItalic,
    setTitleOpts,
    setTitleWeight,
    setTitleText,
    typeTitleText,
  } from "../state/appState.svelte";
  import { familyHasItalic, familyWeights, fontAvailable, fontChoices } from "../text/font";
  import {
    familyIdOf,
    loadCatalogue,
    weightName,
    type GoogleFamily,
  } from "../text/google-catalogue";
  import ToggleButton from "./ToggleButton.svelte";
  import { charTransform, withOverride } from "../text/random";
  import FieldSection from "./FieldSection.svelte";
  import NumberField from "./NumberField.svelte";

  /** Spec (M10) §6. Typing happens here rather than on the canvas so the iPad keyboard never
   *  covers the artwork, and so this reuses the panel machinery instead of inventing a caret. */
  let { title }: { title: PathShape } = $props();

  type CharT = ReturnType<typeof charTransform>;

  const meta = $derived(title.text!);
  // `fontsChangedTick()` is the tracked dependency: `fontChoices()` and the rest read plain Maps
  // that Svelte cannot see, so without it a font you just added never reaches the list — and a
  // Google family restored from the cache after the panel mounted would still read as missing.
  const ready = $derived((fontsChangedTick(), fontAvailable(meta.font)));
  const choices = $derived((fontsChangedTick(), fontChoices()));
  const weights = $derived.by(() => {
    fontsChangedTick();
    const w = familyWeights(meta.font);
    const current = meta.weight ?? 400;
    // A file from elsewhere can ask for a weight the family doesn't list; show it rather than
    // letting the select fall back to a weight the title isn't in.
    return w.includes(current) ? w : [...w, current].sort((a, b) => a - b);
  });
  const hasItalic = $derived((fontsChangedTick(), familyHasItalic(meta.font)));

  /** A missing `gf:` font that the catalogue knows (spec M20 §6): the panel offers to download it.
   *  The catalogue is only loaded for that case, keyed by font so a stale answer can't land on the
   *  next title. */
  let found = $state.raw<{ font: string; family: GoogleFamily | null } | null>(null);
  $effect(() => {
    const font = meta.font;
    const id = familyIdOf(font);
    if (ready || id === null || found?.font === font) return;
    loadCatalogue().then(
      (all) => (found = { font, family: all.find((f) => f.id === id) ?? null }),
      () => (found = { font, family: null }),
    );
  });
  const missingFamily = $derived(!ready && found?.font === meta.font ? found.family : null);

  const label = $derived(
    choices.find((c) => c.id === meta.font)?.label ?? missingFamily?.family ?? meta.font,
  );
  /** Every control here re-derives geometry, so all of them need the font (spec §5) — not just the
   *  string field. The font picker is the exception: switching to a font you DO have is the way
   *  out, so it stays live and says so. */
  const missing = $derived(
    missingFamily
      ? `Needs the font “${label}”, which isn't downloaded — download it from Google Fonts`
      : `Needs the font “${label}”, which isn't loaded — add it from a file`,
  );

  const weightLabel = (w: number) => {
    const name = weightName(w);
    return name === String(w) ? name : `${name} ${w}`;
  };

  let downloading = $state(false);
  async function download(f: GoogleFamily) {
    if (downloading) return;
    downloading = true;
    try {
      await addGoogleFamily(f);
    } finally {
      downloading = false;
    }
  }

  /** "Add a font…" is a small menu (spec M20 §6). Positioned `fixed` from the button, because the
   *  properties panel scrolls and would clip an absolutely positioned menu at its bottom edge. */
  let addMenuBtn: HTMLButtonElement | null = $state(null);
  let addMenu = $state<{ top?: number; bottom?: number; right: number } | null>(null);

  function openAddMenu() {
    if (addMenu || !addMenuBtn) {
      addMenu = null;
      return;
    }
    const r = addMenuBtn.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    // Two menu items need ~80px; open upwards when the button is too near the bottom.
    addMenu =
      window.innerHeight - r.bottom < 90
        ? { bottom: window.innerHeight - r.top + 4, right }
        : { top: r.bottom + 4, right };
  }

  let picker: HTMLInputElement | null = $state(null);

  /** Typing is a live drag by another name (invariant 41): the whole burst is bracketed in one
   *  document gesture, so undo steps back over the word you typed rather than the letter. The
   *  bracket is the store's, shared with the canvas text session (spec M22 §3). It must close on
   *  every way typing can end — the blur, and destruction of this component, because clearing the
   *  selection removes the panel mid-burst and a gesture left open silently stops recording undo
   *  history for everything after it. `typing` says whether THIS field is in the burst, so an
   *  unmount (Properties collapsed) never closes a bracket the canvas session opened. */
  let typing = false;

  function startTyping() {
    typing = true;
    startTitleTyping();
  }

  function endTyping() {
    if (!typing) return;
    typing = false;
    endTitleTyping();
  }

  // Unmount is the usual end of a burst (the selection changed). Closing the gesture before the
  // outline drain finishes splits the word into extra undo steps, so the store waits for that
  // drain, and closes the bracket only if a newer gesture has not started.
  $effect(() => () => {
    if (!typing) return;
    typing = false;
    abandonTitleTyping();
  });

  /** Spec M10 §6 sketches sliders; this app has no range input anywhere, and `NumberField` is the
   *  control it does have — already styled, already 32px for touch, and it already guards a no-op
   *  change, which invariant 1 needs. */
  const AMOUNTS = [
    { key: "rotate", label: "Rotation", max: 45, suffix: "°" },
    { key: "scale", label: "Scale", max: 50, suffix: "%" },
    { key: "offset", label: "Baseline", max: 50, suffix: "px" },
    { key: "skew", label: "Skew", max: 45, suffix: "°" },
  ] as const;

  /** Scale is stored as a fraction and shown as a percentage. */
  const amountValue = (k: (typeof AMOUNTS)[number]["key"]) =>
    k === "scale" ? Math.round(meta.amounts.scale * 100) : meta.amounts[k];

  const setAmount = (k: (typeof AMOUNTS)[number]["key"], v: number) =>
    void setTitleOpts({ amounts: { ...meta.amounts, [k]: k === "scale" ? v / 100 : v } });

  /** Spec M10 §6. The Randomise block's numbers are **ranges** (±12°); these are **the value**
   *  (−12°) for one character. Same four properties, different quantities — so they never share a
   *  field, and the labels say which is which. */
  const charIndex = $derived(app.charSel);
  const effective = $derived(
    charIndex === null
      ? null
      : withOverride(charTransform(meta.seed, charIndex, meta.amounts), meta.overrides[charIndex]),
  );
  const CHAR_FIELDS = [
    { key: "r", label: "Rotation", suffix: "°", of: (t: CharT) => t.rotate },
    { key: "s", label: "Scale", suffix: "%", of: (t: CharT) => Math.round(t.scale * 100) },
    { key: "dy", label: "Baseline", suffix: "px", of: (t: CharT) => t.dy },
    { key: "k", label: "Skew", suffix: "°", of: (t: CharT) => t.skew },
  ] as const;

  const setChar = (k: (typeof CHAR_FIELDS)[number]["key"], v: number) =>
    void setCharOverride({ [k]: k === "s" ? v / 100 : v });

  /** Alignment is not a position — it decides which edge stays put when the title changes, because
   *  re-typing re-derives the outlines from the anchor. Flush-line icons, not arrows: an arrow says
   *  "move this way", and pressing "right" actually makes the text extend leftwards from a pinned
   *  right edge, so the arrows read as inverted. */
  const ALIGNS = [
    { v: "left", label: "Left edge stays put as the text changes", icon: TextAlignStart },
    { v: "center", label: "Stays centred as the text changes", icon: TextAlignCenter },
    { v: "right", label: "Right edge stays put as the text changes", icon: TextAlignEnd },
  ] as const;
</script>

<FieldSection id="text" title="Text">
  <!-- A textarea, not an input: Return must insert a line break, so it is deliberately NOT
       intercepted. The canvas follows every keystroke (spec M10e §5); `blur` is the commit, and
       the only place a refusal is reported or the field put back. -->
  <textarea
    class="field field-full resize-y py-1 leading-snug"
    rows="2"
    aria-label="Title text"
    value={meta.text}
    aria-disabled={!ready}
    title={ready ? "Change the text" : missing}
    oninput={(e) => {
      if (!ready) return;
      startTyping();
      void typeTitleText(e.currentTarget.value);
    }}
    onblur={async (e) => {
      if (!ready) return;
      const el = e.currentTarget;
      // Commit first, THEN close the gesture: `endDocGesture` records the burst as one undo step,
      // and a commit after it would be a second step of its own.
      await setTitleText(el.value);
      endTyping();
      // A refusal — an unshaped script, a font with no such glyphs, an empty string — leaves the
      // title alone, so put the field back rather than leaving the rejected text in it. Only here:
      // doing it per keystroke would yank the caret back mid-word. The panel may have been
      // destroyed while awaiting, so `isConnected` is checked first.
      if (el.isConnected) el.value = title.text?.text ?? el.value;
    }}></textarea>

  <div class="field-full flex items-center gap-2">
    <select
      class="field min-w-0 flex-1"
      aria-label="Font"
      title="Change the font"
      value={meta.font}
      onchange={async (e) => {
        const el = e.currentTarget;
        await setTitleFont(el.value);
        // Uncontrolled, like the string field: a refused change leaves `meta.font` untouched, so
        // Svelte re-applies nothing and the dropdown would keep showing a font the title isn't in.
        if (el.isConnected) el.value = title.text?.font ?? el.value;
      }}
    >
      {#each choices as c (c.id)}
        <option value={c.id}>{c.label}</option>
      {/each}
      {#if !choices.some((c) => c.id === meta.font)}
        <option value={meta.font}>{label} (not loaded)</option>
      {/if}
    </select>
    <button
      bind:this={addMenuBtn}
      class={["btn", addMenu && "ui-on"]}
      aria-haspopup="menu"
      aria-expanded={addMenu !== null}
      title="Add a font from a file or from Google Fonts"
      onclick={openAddMenu}
    >
      Add a font…
    </button>
    {#if addMenu}
      <button
        class="fixed inset-0 z-40 cursor-default"
        aria-label="Close menu"
        tabindex="-1"
        onclick={() => (addMenu = null)}
      ></button>
      <div
        class="fixed z-50 w-48 rounded border border-line bg-panel py-1 shadow-lg"
        style:top={addMenu.top === undefined ? null : `${addMenu.top}px`}
        style:bottom={addMenu.bottom === undefined ? null : `${addMenu.bottom}px`}
        style:right={`${addMenu.right}px`}
        role="menu"
      >
        <button
          class="menu-item min-h-(--ctl-h)"
          role="menuitem"
          title="Add a .ttf, .otf or .woff font file for this session"
          onclick={() => {
            addMenu = null;
            picker?.click();
          }}
        >
          From a file…
        </button>
        <button
          class="menu-item min-h-(--ctl-h)"
          role="menuitem"
          title="Browse Google Fonts and add a family for good"
          onclick={() => {
            addMenu = null;
            app.dialog = "googleFonts";
          }}
        >
          From Google Fonts…
        </button>
      </div>
    {/if}
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

  {#if missingFamily}
    <div class="field-full">
      <button
        class="btn w-full justify-center"
        aria-disabled={downloading}
        title={downloading ? `Downloading ${missingFamily.family}…` : missing}
        onclick={() => missingFamily && void download(missingFamily)}
      >
        {downloading ? `Downloading ${missingFamily.family}…` : `Download ${missingFamily.family}`}
      </button>
    </div>
  {/if}

  <div class="field-row">
    <span class="text-muted">Weight</span>
    <!-- The whole field column: beside the Italic toggle, a 240px sidebar cut "Regular 400" short. -->
    <select
      class="field w-full min-w-0"
      aria-label="Weight"
      aria-disabled={!ready}
      title={ready ? "Change the weight" : missing}
      value={meta.weight ?? 400}
      onchange={async (e) => {
        const el = e.currentTarget;
        if (ready) await setTitleWeight(Number(el.value));
        // Uncontrolled, like the font picker: a refused change leaves the weight untouched.
        if (el.isConnected) el.value = String(title.text?.weight ?? 400);
      }}
    >
      {#each weights as w (w)}
        <option value={w}>{weightLabel(w)}</option>
      {/each}
    </select>
  </div>

  <div class="field-row">
    <span class="text-muted">Style</span>
    <!-- Refused only for turning italic ON in a family without one: an italic that came in with a
         file must still be switchable off. -->
    <div class="flex">
      <ToggleButton
        label="Italic"
        value={meta.italic === true}
        disabled={!ready || (!hasItalic && meta.italic !== true)}
        title={!ready
          ? missing
          : hasItalic
            ? "Use the italic face"
            : meta.italic === true
              ? `Turn italic off — ${label} has no italic, so it draws upright`
              : `Italic — ${label} has no italic`}
        onchange={(on) => void setTitleItalic(on)}
      />
    </div>
  </div>

  <NumberField
    onlivestart={beginUiGesture}
    onliveend={finishCharDrag}
    label="Size"
    value={meta.size}
    min={1}
    onchange={(v) => ready && void setTitleOpts({ size: v })}
  />
  <NumberField
    onlivestart={beginUiGesture}
    onliveend={finishCharDrag}
    label="Spacing"
    value={meta.letterSpacing}
    onchange={(v) => ready && void setTitleOpts({ letterSpacing: v })}
  />
  <NumberField
    onlivestart={beginUiGesture}
    onliveend={finishCharDrag}
    label="Line height"
    step={0.05}
    value={meta.lineHeight}
    min={0.5}
    max={4}
    suffix="×"
    onchange={(v) => ready && void setTitleOpts({ lineHeight: v })}
  />

  <div class="field-full flex items-center gap-1">
    {#each ALIGNS as a (a.v)}
      <button
        class={["btn flex-1 justify-center", meta.align === a.v && "ui-on"]}
        aria-pressed={meta.align === a.v}
        aria-disabled={!ready}
        title={ready ? a.label : missing}
        onclick={() => ready && void setTitleOpts({ align: a.v })}
      >
        <a.icon size={16} />
      </button>
    {/each}
  </div>
</FieldSection>

<!-- Character and Randomise are alternatives, and neither belongs inside the Text section: picking
     a character replaces the whole-title controls with that character's own. Character is
     deliberately NOT collapsible — it appears only while a character is picked, and a chevron that
     hid the thing the click just selected would be absurd. -->
{#if charIndex !== null && effective}
  <div class="field-full mt-1 flex items-center justify-between">
    <span class="section-title">Character {charIndex + 1}</span>
    <button
      class="btn"
      title="Clear this character's overrides and let the randomiser have it back"
      onclick={() => void clearCharOverride()}
    >
      Reset
    </button>
  </div>
  <p class="field-full text-[11px] text-muted">
    Exact values for this character. The rest of the title is untouched, and these survive a
    re-roll.
  </p>
  {#each CHAR_FIELDS as c (c.key)}
    <NumberField
      onlivestart={beginUiGesture}
      onliveend={finishCharDrag}
      label={c.label}
      value={c.of(effective)}
      suffix={c.suffix}
      onchange={(v) => ready && setChar(c.key, v)}
    />
  {/each}
{:else}
  <FieldSection id="randomise" title="Randomise">
    <!-- The seed moved out of the heading row: a section heading is now a button, and a button
         inside a button is invalid HTML. -->
    <div class="field-full">
      <button
        class="btn w-full justify-center"
        aria-disabled={!ready}
        title={ready ? "Re-roll the randomiser" : missing}
        onclick={() => ready && void rerollTitle()}
      >
        ↻ Seed {meta.seed}
      </button>
    </div>
    {#each AMOUNTS as a (a.key)}
      <NumberField
        onlivestart={beginUiGesture}
        onliveend={finishCharDrag}
        label={a.label}
        value={amountValue(a.key)}
        min={0}
        max={a.max}
        suffix={a.suffix}
        onchange={(v) => ready && setAmount(a.key, v)}
      />
    {/each}
  </FieldSection>
{/if}
