import type { Doc } from "../doc/document";
import { duplicateNodes, rotateNodes, translateNodes } from "../doc/edits";
import { resizeNodes } from "../doc/resize";
import { boxFromPoints } from "../geom/box";
import { hitTest, marqueeSelect } from "../geom/hit";
import type { Vec } from "../geom/vec";
import { docToFrame, frameCenter, frameResizeMap, selectionFrame, type Frame } from "./frame";
import {
  dragHandle,
  handleAt,
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
};
type Mode =
  | Pending
  | (Common & { kind: "marquee"; base: readonly string[] })
  | (Common & { kind: "move"; original: Doc; base: Doc; ids: readonly string[] })
  | (Common & {
      kind: "resize";
      original: Doc;
      ids: readonly string[];
      frame: Frame;
      handle: ResizeHandle;
    })
  | (Common & { kind: "rotate"; original: Doc; ids: readonly string[]; frame: Frame; centre: Vec });

function constrain(dx: number, dy: number): [number, number] {
  const angle = Math.round(Math.atan2(dy, dx) / SNAP_45) * SNAP_45;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const along = dx * c + dy * s;
  return [along * c, along * s];
}

function startDrag(ctx: ToolContext, p: Pending): Mode {
  const doc = ctx.doc();
  const ids = ctx.selection();
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
    return { ...common, kind: "resize", original: doc, ids, frame: p.frame, handle: p.handle };
  }
  if (p.hitId) {
    ctx.beginGesture();
    if (p.start.mods.alt) {
      const dup = duplicateNodes(doc, ids, 0, 0);
      ctx.commit(dup.doc);
      ctx.setSelection(dup.ids);
      return { ...common, kind: "move", original: doc, base: dup.doc, ids: dup.ids };
    }
    return { ...common, kind: "move", original: doc, base: doc, ids };
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
      if (e.mods.shift) [dx, dy] = constrain(dx, dy);
      ctx.commit(translateNodes(m.base, m.ids, dx, dy));
      return;
    }
    case "resize": {
      const box = dragHandle(m.handle, m.frame.box, docToFrame(m.frame, e.doc), e.mods);
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
      const inside = marqueeSelect(ctx.doc(), box).filter((id) => !m.base.includes(id));
      ctx.setSelection([...m.base, ...inside]);
      return;
    }
  }
}

export function createSelectTool(): Tool {
  let mode: Mode | null = null;

  return {
    id: "select",
    hint: "Click to select · drag to move · Shift: add · drag empty space to select an area",
    cursor: "default",

    down(ctx, e) {
      const sel = ctx.selection();
      const doc = ctx.doc();
      const view = ctx.view();
      const frame = sel.length > 0 ? selectionFrame(doc, sel) : null;
      const handle = frame ? handleAt(frame, view, e.screen, handleSize(e.pointerType)) : null;
      let hitId: string | null = null;
      let toggleOnUp = false;
      if (!handle) {
        hitId = hitTest(doc, e.doc, pointerTolerance(e.pointerType) / view.zoom)?.nodeId ?? null;
        if (hitId && !sel.includes(hitId))
          ctx.setSelection(e.mods.shift ? [...sel, hitId] : [hitId]);
        else if (hitId && e.mods.shift) toggleOnUp = true;
      }
      mode = { kind: "pending", start: e, startSelection: sel, hitId, handle, frame, toggleOnUp };
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
        if (m.hitId && m.toggleOnUp) {
          const id = m.hitId;
          ctx.setSelection(ctx.selection().filter((s) => s !== id));
        } else if (!m.hitId && !m.start.mods.shift) {
          ctx.setSelection([]);
        }
        return;
      }
      drag(ctx, m, e);
      if (m.kind === "marquee") ctx.setOverlay(null);
      else ctx.endGesture();
    },

    cancel(ctx) {
      const m = mode;
      mode = null;
      if (!m) return;
      if (m.kind === "move" || m.kind === "resize" || m.kind === "rotate") {
        ctx.commit(m.original);
        ctx.endGesture();
      }
      ctx.setOverlay(null);
      ctx.setSelection(m.startSelection);
    },
  };
}
