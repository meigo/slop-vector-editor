import type { Doc } from "../doc/document";
import { duplicateNodes, rotateNodes, translateNodes } from "../doc/edits";
import { droppedTitle, resizeNodes } from "../doc/resize";
import { ancestorIds, findNode } from "../doc/tree";
import { boxFromPoints, type Box } from "../geom/box";
import { hitTest, marqueeSelect } from "../geom/hit";
import { isDoubleTap, type Tap } from "../input/double-tap";
import {
  collectTargets,
  hasGuides,
  NO_GUIDES,
  SNAP_PX,
  snapBox,
  snapPoint,
  type Axes,
  type Guides,
  type SnapTargets,
} from "../geom/snap";
import type { Vec } from "../geom/vec";
import {
  docToFrame,
  frameCenter,
  frameResizeMap,
  selectionBounds,
  selectionFrame,
  type Frame,
} from "./frame";
import {
  dragHandle,
  handleAt,
  handleFramePoint,
  handleSize,
  rotateDelta,
  type Handle,
  type ResizeHandle,
} from "./gizmo";
import { SNAP_45 } from "./shape-tools";
import { movedEnough, pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

type Common = { start: ToolEvent; startSelection: readonly string[] };
type Pending = Common & {
  kind: "pending";
  hitId: string | null;
  handle: Handle | null;
  frame: Frame | null;
  toggleOnUp: boolean;
  collapseOnUp: boolean;
  /** A double tap on a path or group, applied in `up` only if the gesture never dragged. */
  secondTap: "path" | "group" | null;
};
type MoveMode = Common & {
  kind: "move";
  original: Doc;
  base: Doc;
  ids: readonly string[];
  /** Set when the drag duplicated with Alt: the selection the copies were made from. */
  duplicatedFrom: readonly string[] | null;
  bounds: Box | null;
  targets: SnapTargets | null;
  /** The last committed translation. */
  last: Vec;
};
type Mode =
  | Pending
  | (Common & { kind: "marquee"; base: readonly string[] })
  | MoveMode
  | (Common & {
      kind: "resize";
      original: Doc;
      ids: readonly string[];
      frame: Frame;
      handle: ResizeHandle;
      /** Handle point minus the press point, in frame coordinates. */
      grab: Vec;
      targets: SnapTargets | null;
    })
  | (Common & { kind: "rotate"; original: Doc; ids: readonly string[]; frame: Frame; centre: Vec });

const ALL_AXES: Axes = { x: true, y: true };
const NO_AXES: Axes = { x: false, y: false };
/** A rotate-then-unrotate can leave the frame angle at ~1e-17 instead of exactly 0. */
const FRAME_ANGLE_EPS = 1e-9;
/** Tolerance for "the Alt-drag ended back at the start": snapping can leave a float residue
 *  instead of an exact 0 (see `up`). */
const BACK_AT_START_EPS = 1e-9;

function constrain(dx: number, dy: number): [number, number, Axes] {
  const angle = Math.round(Math.atan2(dy, dx) / SNAP_45) * SNAP_45;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const along = dx * c + dy * s;
  const horizontal = Math.abs(s) < 1e-9;
  const vertical = Math.abs(c) < 1e-9;
  const axes = horizontal ? { x: true, y: false } : vertical ? { x: false, y: true } : NO_AXES;
  // cos/sin of a right-angle multiple can leave a ~1e-17 residue instead of exactly 0; a
  // horizontal/vertical constraint must zero the other axis exactly, not approximately.
  return [vertical ? 0 : along * c, horizontal ? 0 : along * s, axes];
}

const threshold = (ctx: ToolContext) => SNAP_PX / ctx.view().zoom;

function showGuides(ctx: ToolContext, guides: Guides): void {
  ctx.setOverlay(hasGuides(guides) ? { kind: "guides", ...guides } : null);
}

function startDrag(ctx: ToolContext, p: Pending): Mode {
  const doc = ctx.doc();
  const ids = ctx.selection();
  const snapping = ctx.snapEnabled();
  const common = { start: p.start, startSelection: p.startSelection };
  if (p.handle && p.frame) {
    ctx.beginGesture();
    if (p.handle === "rotate") {
      return {
        ...common,
        kind: "rotate",
        original: doc,
        ids,
        frame: p.frame,
        centre: frameCenter(p.frame),
      };
    }
    const pressed = docToFrame(p.frame, p.start.doc);
    const at = handleFramePoint(p.handle, p.frame.box);
    const grab = { x: at.x - pressed.x, y: at.y - pressed.y };
    const targets =
      snapping && Math.abs(p.frame.angle) < FRAME_ANGLE_EPS
        ? collectTargets(doc, [...ids, ...ids.flatMap((id) => ancestorIds(doc, id))])
        : null;
    return {
      ...common,
      kind: "resize",
      original: doc,
      ids,
      frame: p.frame,
      handle: p.handle,
      grab,
      targets,
    };
  }
  if (p.hitId) {
    ctx.beginGesture();
    let base = doc;
    let moveIds = ids;
    let duplicatedFrom: readonly string[] | null = null;
    if (p.start.mods.alt) {
      const dup = duplicateNodes(doc, ids, 0, 0);
      base = dup.doc;
      moveIds = dup.ids;
      duplicatedFrom = ids;
      ctx.commit(base);
      ctx.setSelection(moveIds);
    }
    return {
      ...common,
      kind: "move",
      original: doc,
      base,
      ids: moveIds,
      duplicatedFrom,
      bounds: selectionBounds(base, moveIds),
      targets: snapping
        ? collectTargets(base, [...moveIds, ...moveIds.flatMap((id) => ancestorIds(base, id))])
        : null,
      last: { x: 0, y: 0 },
    };
  }
  return { ...common, kind: "marquee", base: p.start.mods.shift ? ids : [] };
}

function drag(ctx: ToolContext, m: Mode, e: ToolEvent): void {
  switch (m.kind) {
    case "pending":
      return;
    case "move": {
      let dx = e.doc.x - m.start.doc.x;
      let dy = e.doc.y - m.start.doc.y;
      let axes = ALL_AXES;
      if (e.mods.shift) [dx, dy, axes] = constrain(dx, dy);
      let guides = NO_GUIDES;
      if (m.targets && m.bounds) {
        const moved = { ...m.bounds, x: m.bounds.x + dx, y: m.bounds.y + dy };
        const s = snapBox(moved, m.targets, threshold(ctx), axes);
        dx += s.dx;
        dy += s.dy;
        guides = s.guides;
      }
      showGuides(ctx, guides);
      m.last = { x: dx, y: dy };
      ctx.commit(translateNodes(m.base, m.ids, dx, dy));
      return;
    }
    case "resize": {
      const p = docToFrame(m.frame, e.doc);
      let target = { x: p.x + m.grab.x, y: p.y + m.grab.y };
      let guides = NO_GUIDES;
      if (m.targets) {
        const axes = {
          x: m.handle.includes("e") || m.handle.includes("w"),
          y: m.handle.includes("n") || m.handle.includes("s"),
        };
        const s = snapPoint(target, m.targets, threshold(ctx), axes);
        target = s.p;
        guides = s.guides;
      }
      showGuides(ctx, guides);
      const box = dragHandle(m.handle, m.frame.box, target, e.mods);
      ctx.commit(resizeNodes(m.original, m.ids, frameResizeMap(m.frame.angle, m.frame.box, box)));
      return;
    }
    case "rotate": {
      const d = rotateDelta(m.centre, m.start.doc, e.doc, m.frame.angle, e.mods.shift);
      ctx.commit(rotateNodes(m.original, m.ids, d, m.centre));
      return;
    }
    case "marquee": {
      const box = boxFromPoints([m.start.doc, e.doc])!;
      ctx.setOverlay({ kind: "marquee", box });
      const inside = marqueeSelect(ctx.doc(), box, ctx.enteredGroupId()).filter(
        (id) => !m.base.includes(id),
      );
      ctx.setSelection([...m.base, ...inside]);
      return;
    }
  }
}

export function createSelectTool(): Tool {
  let mode: Mode | null = null;
  let lastTap: Tap | null = null;

  function cancelMode(ctx: ToolContext): void {
    const m = mode;
    mode = null;
    if (!m) return;
    if (m.kind === "move" || m.kind === "resize" || m.kind === "rotate") {
      ctx.commit(m.original);
      ctx.endGesture();
    }
    ctx.setOverlay(null);
    ctx.setSelection(m.startSelection);
  }

  return {
    id: "select",
    hint: "Click to select · drag to move · Shift: add · drag empty space to select an area",
    cursor: "default",

    down(ctx, e) {
      cancelMode(ctx);
      const sel = ctx.selection();
      const doc = ctx.doc();
      const view = ctx.view();
      const frame = sel.length > 0 ? selectionFrame(doc, sel) : null;
      const handle = frame ? handleAt(frame, view, e.screen, handleSize(e.pointerType)) : null;
      let hitId: string | null = null;
      let toggleOnUp = false;
      let collapseOnUp = false;
      let secondTap: "path" | "group" | null = null;
      if (!handle) {
        const entered = ctx.enteredGroupId();
        const tol = pointerTolerance(e.pointerType) / view.zoom;
        hitId = hitTest(doc, e.doc, tol, entered)?.nodeId ?? null;
        // A double tap steps inside a group (spec M3b §3.2) or hands a path to the node tool
        // (spec M4a §6). `lastTap` is recorded in `up`, and the action itself is applied there
        // too, only when the gesture stayed a click, so a click followed within the double-tap
        // window by a drag on the same object still drags instead of being swallowed.
        const second = hitId !== null && isDoubleTap(lastTap, { id: hitId, time: e.time });
        if (second) lastTap = null;
        const kind = second && hitId !== null ? findNode(doc, hitId)?.node.kind : undefined;
        if (kind === "path" || kind === "group") {
          secondTap = kind;
        } else {
          // A click outside the entered group leaves it, then selects as usual.
          if (entered !== null && hitId !== null && hitId !== entered) {
            if (!ancestorIds(doc, hitId).includes(entered)) ctx.setEnteredGroup(null);
          }
          if (hitId && !sel.includes(hitId))
            ctx.setSelection(e.mods.shift ? [...sel, hitId] : [hitId]);
          else if (hitId && e.mods.shift) toggleOnUp = true;
          else if (hitId && sel.length > 1) collapseOnUp = true;
        }
      }
      mode = {
        kind: "pending",
        start: e,
        startSelection: sel,
        hitId,
        handle,
        frame,
        toggleOnUp,
        collapseOnUp,
        secondTap,
      };
    },

    move(ctx, e) {
      if (!mode) return;
      if (mode.kind === "pending") {
        if (!movedEnough(mode.start.screen, e.screen)) return;
        mode = startDrag(ctx, mode);
      }
      drag(ctx, mode, e);
    },

    up(ctx, e) {
      const m = mode;
      mode = null;
      if (!m) return;
      if (m.kind === "pending") {
        if (m.handle) return;
        if (m.hitId !== null) lastTap = { id: m.hitId, time: e.time };
        // The gesture stayed a click (never dragged): apply a pending double tap now.
        if (m.secondTap === "path" && m.hitId !== null) {
          ctx.setNodeTarget(m.hitId);
          ctx.setSelection([m.hitId]);
          ctx.setTool("node");
          return;
        }
        if (m.secondTap === "group" && m.hitId !== null) {
          const tol = pointerTolerance(e.pointerType) / ctx.view().zoom;
          ctx.setEnteredGroup(m.hitId);
          const inner = hitTest(ctx.doc(), e.doc, tol, m.hitId);
          ctx.setSelection(inner ? [inner.nodeId] : []);
          return;
        }
        if (m.hitId && m.toggleOnUp) {
          const id = m.hitId;
          ctx.setSelection(ctx.selection().filter((s) => s !== id));
        } else if (m.hitId && m.collapseOnUp) {
          ctx.setSelection([m.hitId]);
          // Clicking nothing clears the selection — unless Shift is *held*, where the click is part
          // of an add-to-selection gesture and a miss should not wipe the user's work. A latched
          // Shift is not that: it is a mode left on, and on a keyboard-less device there is no way
          // to let go, so it must not make deselecting impossible.
        } else if (!m.hitId && (!m.start.mods.shift || m.start.mods.shiftLatched)) {
          ctx.setEnteredGroup(null);
          ctx.setSelection([]);
        }
        return;
      }
      drag(ctx, m, e);
      ctx.setOverlay(null);
      if (m.kind === "marquee") return;
      // Once per drag, not per move: a non-uniform resize silently turns a title into an ordinary
      // path (spec M10e §7), and that is the one thing about a resize the user cannot see happen.
      // Note this is the COMMON case, not the exotic one — `dragHandle` only constrains the
      // proportions when Shift is held, so a plain corner drag stretches and costs the text.
      if (m.kind === "resize" && droppedTitle(m.original, ctx.doc(), m.ids)) {
        ctx.notify(
          "info",
          "Resized out of proportion, so the text is no longer editable — undo and hold Shift to keep it.",
        );
      }
      if (
        m.kind === "move" &&
        m.duplicatedFrom &&
        Math.abs(m.last.x) < BACK_AT_START_EPS &&
        Math.abs(m.last.y) < BACK_AT_START_EPS
      ) {
        // Alt-dragged back to the start: drop the copies rather than stacking a hidden duplicate.
        // Snapping can leave a sub-1e-9 float residue instead of an exact 0 (e.g. a fractional
        // origin whose bounds don't cancel cleanly), so this compares with a tolerance rather
        // than `=== 0`.
        ctx.commit(m.original);
        ctx.setSelection(m.duplicatedFrom);
      }
      ctx.endGesture();
    },

    cancel(ctx) {
      cancelMode(ctx);
    },
  };
}
