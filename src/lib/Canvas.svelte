<script lang="ts">
  import { untrack } from "svelte";
  import { hitTest } from "../geom/hit";
  import type { Vec } from "../geom/vec";
  import { routePointerDown } from "../input/route";
  import {
    app,
    cancelActiveGesture,
    dockMods,
    fitArtboard,
    registerGestureCancel,
    setSelection,
    setView,
    setViewportSize,
  } from "../state/appState.svelte";
  import { panBy, pinch, screenToDoc, wheelView, zoomAt } from "../state/viewport";
  import { storeContext } from "../tools/context";
  import { TOOLS } from "../tools/registry";
  import { pointerTolerance, type Tool, type ToolEvent } from "../tools/tool";
  import NodeView from "./NodeView.svelte";
  import Overlay from "./Overlay.svelte";

  let { oncursor }: { oncursor: (p: Vec | null) => void } = $props();

  type Gesture =
    | { kind: "tool"; pointerId: number; tool: Tool }
    | { kind: "pan"; pointerId: number }
    | { kind: "pinch" };

  let host: HTMLDivElement;
  let width = $state(0);
  let height = $state(0);
  let gesture = $state.raw<Gesture | null>(null);
  /** Once a Pencil has touched the canvas, fingers only navigate (spec §5). */
  let pencilSeen = false;
  /** Active pointers in canvas-local px. A plain Map: nothing renders from it. */
  const pointers = new Map<number, Vec>();
  /** Each active pointer's `pointerType`, alongside `pointers`. */
  const pointerTypes = new Map<number, string>();

  const ready = $derived(width > 0 && height > 0);
  const view = $derived(app.view);
  const artboard = $derived(app.doc.artboard);

  /** How strongly art outside the artboard is muted. The ground is near-black, so the scrim is
   *  invisible over empty canvas and shows only where artwork crosses the boundary — which is
   *  exactly when it is wanted. */
  const SCRIM_OPACITY = 0.6;

  /** Everything outside the artboard, as one path with the artboard punched out of it.
   *
   *  Art outside the artboard is dimmed rather than hidden: it stays visible, selectable and
   *  draggable, but the root's `viewBox` clips it out of both the saved SVG and the PNG, and
   *  nothing else on screen says so. This is canvas chrome — it never reaches `svg/attrs.ts`,
   *  the serializer or an export, so invariant 3's single-renderer rule is untouched.
   *
   *  Drawn in **screen** space, outside the zoom group, because the artboard's on-screen rect is
   *  four numbers this component already has. In document space the outer rectangle would have to
   *  cover the viewport at `MIN_ZOOM` — a 100 000-unit span before any margin — and that magic
   *  number would quietly stop working the day the zoom range widened.
   *
   *  `evenodd` makes the inner rectangle a hole whichever way each is wound, so there is no
   *  direction bookkeeping; an artboard entirely off-screen or larger than the viewport needs no
   *  special case, because the hole simply falls outside or covers everything. */
  const scrimPath = $derived.by(() => {
    const bw = artboard.w * view.zoom;
    const bh = artboard.h * view.zoom;
    const outer = `M0 0H${width}V${height}H0Z`;
    const hole = `M${view.x} ${view.y}H${view.x + bw}V${view.y + bh}H${view.x}Z`;
    return `${outer} ${hole}`;
  });
  const cursor = $derived(
    gesture?.kind === "pan"
      ? "grabbing"
      : app.spaceHeld || app.toolId === "hand"
        ? "grab"
        : TOOLS[app.toolId].cursor,
  );

  $effect(() => {
    setViewportSize(width, height);
  });

  // Fit when the canvas first gets a size and whenever a document is replaced.
  $effect(() => {
    void app.fitNonce;
    if (ready) untrack(fitArtboard);
  });

  // Switching tools mid-gesture cancels the running gesture.
  $effect(() => {
    void app.toolId;
    untrack(() => {
      if (gesture?.kind === "tool") {
        gesture.tool.cancel(storeContext);
        gesture = null;
        registerGestureCancel(null);
      }
    });
  });

  /** True while a pen or mouse gesture is running: a finger arriving now is a palm (spec M5 §2). */
  function penGestureActive(): boolean {
    if (!gesture || gesture.kind === "pinch") return false;
    const t = pointerTypes.get(gesture.pointerId);
    return t === "pen" || t === "mouse";
  }

  function local(e: { clientX: number; clientY: number }): Vec {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function toolEvent(e: PointerEvent): ToolEvent {
    const screen = local(e);
    const dock = dockMods();
    return {
      doc: screenToDoc(app.view, screen),
      screen,
      pointerType: e.pointerType,
      time: e.timeStamp,
      mods: {
        shift: e.shiftKey || dock.shift,
        alt: e.altKey || dock.alt,
        shiftLatched: !e.shiftKey && dock.shift,
      },
    };
  }

  function onpointerdown(e: PointerEvent) {
    app.contextMenu = null;
    if (e.pointerType === "pen") pencilSeen = true;
    let activeTouches = 0;
    for (const t of pointerTypes.values()) if (t === "touch") activeTouches++;
    const route = routePointerDown({
      pointerType: e.pointerType,
      button: e.button,
      activePointers: pointers.size,
      activeTouches,
      spaceHeld: app.spaceHeld,
      tool: app.toolId,
      pencilSeen,
      penActive: penGestureActive(),
    });
    if (route === "ignore") return;
    // Only routed pointers set the handle size (a stray palm must not); right-click counts as mouse.
    app.lastPointerType = e.pointerType;
    if (route === "menu") return;
    // A Pencil that took over from fingers: their pan or pinch stops here. Both only moved the
    // view, so there is nothing to roll back, and the fingers stay down but do nothing until they
    // lift (`gesture` no longer names them). The test is on the tracked pointers, not on
    // `gesture`: a gesture can already be null while fingers are still down (a tool drag cancelled
    // from the store, e.g. by tapping Undo mid-drag), and those fingers must be forgotten too. The
    // new pointer is not tracked yet at this line, and routing only lets a pointer through with
    // others already down via the Pencil takeover, so this states the takeover condition directly.
    if (pointers.size > 0 && route !== "pinch") {
      if (gesture?.kind === "tool") {
        gesture.tool.cancel(storeContext);
        registerGestureCancel(null);
      }
      gesture = null;
      // Forget the pointers that were superseded. They are still physically down, but they must
      // stop counting toward activeTouches — otherwise a finger arriving after the Pencil lifts
      // re-anchors a pinch on their last-known position, which froze when the gesture ended.
      // `endPointer` ignores an untracked pointer, so their eventual pointerup is harmless.
      pointers.clear();
      pointerTypes.clear();
    }
    // No native text selection or drag; keep keyboard shortcuts working after a click here.
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    try {
      host.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is no longer active (e.g. a synthetic event); tracking still works.
    }
    pointers.set(e.pointerId, local(e));
    pointerTypes.set(e.pointerId, e.pointerType);
    if (route === "pinch") {
      if (gesture?.kind === "tool") {
        gesture.tool.cancel(storeContext);
        registerGestureCancel(null);
      }
      gesture = { kind: "pinch" };
      return;
    }
    if (route === "pan") {
      gesture = { kind: "pan", pointerId: e.pointerId };
      return;
    }
    const tool = TOOLS[app.toolId];
    gesture = { kind: "tool", pointerId: e.pointerId, tool };
    tool.down(storeContext, toolEvent(e));
    registerGestureCancel(() => {
      if (gesture?.kind === "tool") {
        gesture.tool.cancel(storeContext);
        gesture = null;
      }
    });
  }

  function onpointermove(e: PointerEvent) {
    const p = local(e);
    oncursor(screenToDoc(app.view, p));
    if (!gesture) TOOLS[app.toolId].hover?.(storeContext, toolEvent(e));
    // A tracked pointer keeps its position current even when no gesture owns it. Otherwise a
    // finger whose gesture was cancelled from the store freezes at its last coordinate, and the
    // next finger to land anchors a pinch on that stale point, jumping the view.
    const prev = pointers.get(e.pointerId);
    if (prev !== undefined) pointers.set(e.pointerId, p);
    if (!prev || !gesture) return;
    if (gesture.kind === "pinch") {
      // Pinch with the first two pointers; any further finger is ignored.
      const [idA, idB] = [...pointers.keys()];
      if (idB !== undefined && (e.pointerId === idA || e.pointerId === idB)) {
        const other = pointers.get(e.pointerId === idA ? idB : idA)!;
        setView(pinch(app.view, prev, other, p, other));
      }
    } else if (gesture.pointerId === e.pointerId) {
      if (gesture.kind === "pan") setView(panBy(app.view, p.x - prev.x, p.y - prev.y));
      else gesture.tool.move(storeContext, toolEvent(e));
    }
  }

  function endPointer(e: PointerEvent, cancelled: boolean) {
    if (!pointers.has(e.pointerId)) return;
    const g = gesture;
    if (g && g.kind !== "pinch" && g.pointerId === e.pointerId) {
      if (g.kind === "tool") {
        if (cancelled) g.tool.cancel(storeContext);
        else g.tool.up(storeContext, toolEvent(e));
        registerGestureCancel(null);
      }
      gesture = null;
    }
    pointers.delete(e.pointerId);
    pointerTypes.delete(e.pointerId);
    if (pointers.size === 0) gesture = null;
  }

  function oncontextmenu(e: MouseEvent) {
    e.preventDefault();
    if (app.lastPointerType !== "mouse") return;
    if (app.toolId !== "select" && app.toolId !== "node") return;
    cancelActiveGesture();
    if (app.toolId === "select") {
      const p = screenToDoc(app.view, local(e));
      const hit = hitTest(
        app.doc,
        p,
        pointerTolerance("mouse") / app.view.zoom,
        app.enteredGroupId,
      );
      if (hit && !app.selection.includes(hit.nodeId)) setSelection([hit.nodeId]);
    }
    app.contextMenu = { x: e.clientX, y: e.clientY };
  }

  $effect(() => {
    // Non-passive so preventDefault stops page scroll / browser zoom.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView(wheelView(app.view, e, local(e)));
    };
    // Safari desktop reports trackpad pinch as proprietary gesture events, not ctrl+wheel.
    // On iPad the same events accompany touch pinches, which the pointer path already handles.
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (pointers.size > 0) return;
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      setView(zoomAt(app.view, local(g), g.scale / lastScale));
      lastScale = g.scale;
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("gesturestart", onGestureStart);
    host.addEventListener("gesturechange", onGestureChange);
    return () => {
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("gesturestart", onGestureStart);
      host.removeEventListener("gesturechange", onGestureChange);
    };
  });
</script>

<div
  bind:this={host}
  bind:clientWidth={width}
  bind:clientHeight={height}
  class="relative size-full overflow-hidden bg-ground select-none"
  style="touch-action: none; cursor: {cursor}"
  role="application"
  aria-label="Drawing canvas"
  {onpointerdown}
  {onpointermove}
  onpointerup={(e) => endPointer(e, false)}
  onpointercancel={(e) => endPointer(e, true)}
  onlostpointercapture={(e) => {
    if (e.target === host) endPointer(e, true);
  }}
  {oncontextmenu}
  onpointerleave={() => {
    if (pointers.size === 0) oncursor(null);
  }}
>
  <svg class="absolute inset-0" {width} {height}>
    <defs>
      <pattern id="sv-checker" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="#ffffff" />
        <rect width="8" height="8" fill="#d4d4d8" />
        <rect x="8" y="8" width="8" height="8" fill="#d4d4d8" />
      </pattern>
    </defs>
    <g transform="matrix({view.zoom} 0 0 {view.zoom} {view.x} {view.y})">
      <rect x="0" y="0" width={artboard.w} height={artboard.h} fill="url(#sv-checker)" />
      {#if artboard.background}
        <rect
          x="0"
          y="0"
          width={artboard.w}
          height={artboard.h}
          fill={artboard.background.color}
          fill-opacity={artboard.background.opacity}
        />
      {/if}
      {#each app.doc.layers as layer (layer.id)}
        {#if layer.visible}
          <g>
            {#each layer.children as node (node.id)}
              <NodeView {node} />
            {/each}
          </g>
        {/if}
      {/each}
      <rect
        x="0"
        y="0"
        width={artboard.w}
        height={artboard.h}
        fill="none"
        stroke="#000000"
        stroke-opacity="0.35"
        vector-effect="non-scaling-stroke"
        pointer-events="none"
      />
    </g>
    <path
      d={scrimPath}
      fill-rule="evenodd"
      fill="var(--color-ground)"
      fill-opacity={SCRIM_OPACITY}
      pointer-events="none"
    />
    <Overlay />
  </svg>
</div>
