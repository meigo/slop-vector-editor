# slop-vector-editor — milestone 9 design: per-object visibility and lock

Date: 2026-09-19. Status: approved in brainstorming. Follows M8
(`2026-09-19-m8-sidebar-split-design.md`).

Layers can be hidden and locked; the shapes and groups inside them cannot. This milestone gives
every node the same two flags — and, in doing so, fixes a silent data loss that is the more urgent
half of the work.

## 1. The bug this also fixes

`parse.ts` drops any element whose computed `display` is `none`:

```ts
const p = props(el);
if (p.display === "none") return null;
```

Measured against a five-element file:

| In the file | What happens today |
| --- | --- |
| a plain `<rect>` | kept |
| `display="none"` | **silently deleted** |
| `style="display:none"` | **silently deleted** |
| `visibility="hidden"` | kept, and **silently made visible** |
| `<g display="none">…</g>` | the **whole subtree silently deleted** |

`ParseResult.dropped` comes back **empty** in every case, so the notice that exists to tell the user
what an import lost says nothing.

Open a file with a hidden layer of construction guides, save it, and that work is gone. Invariant 10
exists to stop exactly this — a lossy re-export overwriting someone's original — and this walks
round it, because the loss happens during the parse rather than at save time. A file that loses
content on open is not one we may keep a Save-in-place handle for either, and today we might.

The model has nowhere to put a hidden shape, so the fix and the feature are the same change.

## 2. Scope

In:

- `hidden` and `locked` on every `Shape` and `Group` (§3);
- the SVG round-trip both ways, and **keeping** hidden content on import (§4);
- hidden and locked nodes dropping out of what can be selected, hit, marqueed and snapped to (§5);
- an eye and a lock on every shape and group row in the Layers panel (§6).

Out:

- **Per-object opacity.** `Style.opacity` already exists on shapes and `Group.opacity` on groups.
- **Isolate, or "hide everything else".** A selection-driven command over these flags, worth having
  and not this milestone.
- **Shortcuts.** Illustrator binds ⌘3/⌘2; M6 decided against inventing chords for menu-reachable
  commands and that still holds.
- **A `visibility="visible"` child inside a hidden parent.** SVG lets a descendant override an
  inherited `visibility`; `display:none` cannot be overridden that way. Our model has one flag per
  node and no inheritance override, so such a child is imported hidden with its parent. It is
  reported in `dropped` as `nested visibility override` rather than changed silently (§4).

## 3. The model

`ShapeBase` and `Group` each gain two optional flags:

```ts
/** Absent means normal. Only a node that is actually hidden or locked carries the flag. */
hidden?: true;
locked?: true;
```

**Why optional, when `Layer` carries `visible: boolean` and `locked: boolean` outright.** There are a
handful of layers and they are always drawn in the panel, so a layer paying for both booleans costs
nothing. Nodes are different on three counts: a document can hold thousands, **136 places in this
repo build a node literal** (20 in `src/`, 116 in tests), and an absent flag is one representation
of "normal" rather than two. That last point is the one that matters for invariant 1: with
`hidden?: true`, "not hidden" is exactly `undefined`, so an edit that hides an already-hidden node
can return the **same reference** without having to decide whether `false` and `undefined` are the
same document. The polarity differs from `Layer.visible` deliberately — the flag exists only in its
`true` state, so it has to be named for that state.

Nothing reads the fields directly. `src/doc/document.ts` exports the two predicates everything else
uses:

```ts
export const isHidden = (n: Node): boolean => n.hidden === true;
export const isLocked = (n: Node): boolean => n.locked === true;
```

**Turning a flag off deletes the key**, so a node that has been hidden and shown again is
structurally identical to one that never was — and therefore saves byte-identically, which is what
invariant 1's "an edit that changes nothing returns the SAME reference" protects at the document
level and the writer's 6-decimal rounding protects at the file level.

Both flags are ordinary document data: saved, and undoable, exactly as a layer's are.

## 4. The round-trip

**Writing** (`src/svg/attrs.ts`, which canvas and export share — invariant 3): a hidden node gets
`display="none"`, a locked one `data-sv-locked=""`. This is the pair `attrs.ts` already writes for
layers, so nothing new is invented and an old reader sees a file it understands.

Because the canvas renders through the same function, **a hidden node is hidden on canvas for
free** — the browser honours `display="none"`. Hit-testing is geometric and does not go through the
DOM, so it needs the explicit rule in §5; nothing else does.

**Reading** (`src/svg/parse.ts`):

- `display:none`, from an attribute or from a `style` attribute, becomes `hidden: true` instead of
  dropping the element. This is the data-loss fix.
- `visibility="hidden"` also becomes `hidden: true`. Today it is ignored, which silently reveals
  content the author had hidden.
- A descendant carrying `visibility="visible"` under a node we are hiding is reported in `dropped`
  as `nested visibility override`: we cannot represent it, and the user should know the file will
  not look the same.
- `data-sv-locked`, and Inkscape's `sodipodi:insensitive="true"`, become `locked: true` — the same
  two spellings the layer reader already accepts.

A hidden **group** keeps its children rather than dropping the subtree. Invariant 27 still holds:
the group is not empty, so nothing removes it.

`ParseResult.native` and the Save-in-place rule (invariant 10) are unaffected, and one consequence
is worth stating: a file that previously lost its hidden content on open now round-trips, so it
keeps its handle where it deserves to.

## 5. What a hidden or locked node may take part in

The rule is the one layers already follow, extended down the tree: **a node is out of reach if it is
hidden or locked, or if any ancestor is** — including its layer.

The places that must agree:

- `selectableIds` (`src/doc/tree.ts`) — the rule's home;
- `hitTest` and `marqueeSelect` (`src/geom/hit.ts`);
- `pruneSelection`, so hiding or locking a selected node deselects it as a matter of course rather
  than as a special case;
- `collectTargets` (`src/geom/snap.ts`) — **hidden only**. Snapping already includes locked layers
  on purpose ("you can align to what you can't edit", `snap.ts`), so a locked node stays a target
  and only a hidden one stops being one;
- `selectFromPanel`, via the panel's existing `blocked` flag (§6).

**Invariant 37 is the hazard here.** It records that `hitTest` and `marqueeSelect` re-implement
`selectableIds`' rule inline, which is how the three drift apart. This milestone adds a clause to
that rule in three places at once, so the reach test must be extracted into **one exported
predicate** — `reachable(doc, id, enteredGroupId)` or an equivalent the three share — rather than
copied a third time. If the milestone does nothing else structural, it should do this.

An **invalid entered group must keep falling through** to the top-level rule, which is what all
three functions do today — `selectableIds` returns early only when the group is valid. A group that
has just been hidden or locked is exactly that case, so the fall-through is what stops the canvas
going dead when it happens.

**A locked node cannot be selected at all**, which is Illustrator's behaviour and the behaviour a
locked *layer* already has here. That deliberately avoids a worse design: a node that can be
selected but that every edit has to refuse, which would mean auditing every store action and would
leave Delete as a hole. The way back is the row's own lock button (§6), never a selection.

## 6. The Layers panel

Every shape and group row gains an eye and a lock, at the right of the row, **always visible** —
matching the layer rows directly above them, and working on a touch device, which has no hover to
reveal anything.

- The icons are the ones layer rows already use: `Eye`/`EyeOff`, `Lock`/`LockOpen`.
- Titles are action phrases and double as status-bar hints (invariant 24): `Hide “Rectangle”`,
  `Show “Rectangle”`, `Lock “Rectangle”`, `Unlock “Rectangle”`.
- A blocked row already greys its name, refuses the drag, refuses selection and explains itself in
  its title; `LayersPanel.svelte` passes `blocked` down through its recursive `nodeRow` snippet, so
  a hidden or locked node makes every descendant row blocked too. The wording generalises from
  `Layer “X” is hidden` to name whichever ancestor is responsible.
- **A blocked row's own eye and lock stay live.** That is the only way back, and it is what a locked
  layer's lock button already does.

The row is 32px and already holds a grip, a chevron and a name that truncates at depth. Two 20px
icons take about 56px of a 240px column. That is the cost of the choice made in brainstorming, and
the names are the thing that gives way.

## 7. Architecture

- **`src/doc/document.ts`** — the two optional fields and the two predicates (§3).
- **`src/doc/tree.ts`** — the shared `reachable` predicate (§5), and `selectableIds` in terms of it.
- **`src/doc/edits.ts`** — `setNodeHidden(doc, ids, hidden)` and `setNodeLocked(doc, ids, locked)`,
  pure, returning the same reference when nothing changes, deleting the key when turning off.
- **`src/geom/hit.ts`** and **`src/geom/snap.ts`** — use `reachable` instead of their inline rules.
- **`src/svg/attrs.ts`**, **`src/svg/parse.ts`** — the round-trip (§4).
- **`src/state/appState.svelte.ts`** — `toggleNodeVisible(id)` / `toggleNodeLocked(id)`, each
  cancelling the active gesture first (invariant 15) and committing one undo step.
- **`src/lib/LayersPanel.svelte`** — the two buttons per row and the generalised blocked rule (§6).

## 8. Testing

- **Unit (Vitest, node):**
  - the round-trip: a hidden rect, a locked rect, a hidden group with visible children, and a file
    using each of `display="none"`, `style="display:none"`, `visibility="hidden"` and
    `sodipodi:insensitive` — all kept, with the right flags, and `dropped` reporting the nested
    visibility override and nothing else;
  - our own export reloading identically, including that show-then-hide-then-show is byte-identical
    to never having touched it;
  - `setNodeHidden`/`setNodeLocked`: the same reference for a no-op, the key deleted when turning
    off, and several ids at once;
  - `reachable` and `selectableIds`: a hidden node, a locked node, a visible node inside a hidden
    group, and the same inside an entered group;
  - `hitTest` and `marqueeSelect` skipping a hidden and a locked node — the tests that stop the
    three rules drifting apart;
  - `pruneSelection` dropping a node that has just been hidden or locked.
- **Build:** 0 errors, 0 warnings; lint and format clean.
- **Browser (controller, port 5196, screenshots):** hiding a shape from its row and seeing it leave
  the canvas; clicking where it was and hitting nothing; a marquee over it selecting nothing; the
  row greyed with its eye still live; locking, then failing to select it on canvas and unlocking it
  from the row; hiding a group hiding its children and greying their rows; undo restoring each; save
  and reload preserving both flags; opening a foreign file with hidden content and seeing it kept
  rather than deleted; no console errors.

## 9. Owed

The iPad pass owed since M5 now also covers two more 20px targets on every layer row, which is the
part of §6 most likely to be wrong on a device and cannot be judged here.
