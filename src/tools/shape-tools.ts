import type { Doc, Shape, Style } from "../doc/document";
import { addShape } from "../doc/edits";
import { targetLayerId } from "../doc/tree";
import { boxFromPoints, type Box } from "../geom/box";
import { IDENTITY } from "../geom/mat";
import { linePath, polygonPath, starPath } from "../geom/shapes";
import type { Vec } from "../geom/vec";
import type { Prefs } from "../persist/preferences";
import { movedEnough, type Tool, type ToolContext, type ToolEvent } from "./tool";
import type { Mods, ToolId } from "./types";

export const SNAP_45 = Math.PI / 4;

export function dragBox(a: Vec, b: Vec, mods: Mods): Box {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (mods.shift) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * s;
    dy = (dy < 0 ? -1 : 1) * s;
  }
  const far = { x: a.x + dx, y: a.y + dy };
  const near = mods.alt ? { x: a.x - dx, y: a.y - dy } : a;
  return boxFromPoints([near, far])!;
}

export function snapLineEnd(a: Vec, b: Vec): Vec {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / SNAP_45) * SNAP_45;
  return { x: a.x + len * Math.cos(angle), y: a.y + len * Math.sin(angle) };
}

/** A line is only its stroke: no fill, and a black stroke if the default style has none. */
export function lineStyle(style: Style): Style {
  return { ...style, fill: null, stroke: style.stroke ?? { color: "#000000", opacity: 1 } };
}

type Build = (a: Vec, b: Vec, mods: Mods, prefs: Prefs) => Shape | null;

type Active = { start: ToolEvent; layerId: string; base: Doc; createdId: string | null };

function createDragTool(id: ToolId, hint: string, build: Build): Tool {
  let active: Active | null = null;

  function update(ctx: ToolContext, e: ToolEvent): void {
    if (!active) return;
    const shape = movedEnough(active.start.screen, e.screen)
      ? build(active.start.doc, e.doc, e.mods, ctx.prefs())
      : null;
    if (!shape) {
      ctx.commit(active.base);
      active.createdId = null;
      return;
    }
    const r = addShape(active.base, active.layerId, shape);
    ctx.commit(r.doc);
    active.createdId = r.id;
  }

  return {
    id,
    hint,
    cursor: "crosshair",
    down(ctx, e) {
      const layerId = targetLayerId(ctx.doc());
      if (!layerId) {
        ctx.notify("info", "Every layer is hidden or locked — there is nowhere to draw.");
        return;
      }
      ctx.beginGesture();
      active = { start: e, layerId, base: ctx.doc(), createdId: null };
    },
    move(ctx, e) {
      update(ctx, e);
    },
    up(ctx, e) {
      if (!active) return;
      update(ctx, e);
      if (active.createdId) ctx.setSelection([active.createdId]);
      ctx.endGesture();
      active = null;
    },
    cancel(ctx) {
      if (!active) return;
      ctx.commit(active.base);
      ctx.endGesture();
      active = null;
    },
  };
}

const base = { id: "", transform: IDENTITY } as const;

export function createRectTool(): Tool {
  return createDragTool(
    "rect",
    "Drag to draw a rectangle · Shift: square · Alt: from centre",
    (a, b, mods, prefs) => {
      const box = dragBox(a, b, mods);
      if (box.w === 0 || box.h === 0) return null;
      return {
        ...base,
        kind: "rect",
        style: prefs.style,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        rx: 0,
      };
    },
  );
}

export function createEllipseTool(): Tool {
  return createDragTool(
    "ellipse",
    "Drag to draw an ellipse · Shift: circle · Alt: from centre",
    (a, b, mods, prefs) => {
      const box = dragBox(a, b, mods);
      if (box.w === 0 || box.h === 0) return null;
      return {
        ...base,
        kind: "ellipse",
        style: prefs.style,
        cx: box.x + box.w / 2,
        cy: box.y + box.h / 2,
        rx: box.w / 2,
        ry: box.h / 2,
      };
    },
  );
}

export function createLineTool(): Tool {
  return createDragTool("line", "Drag to draw a line · Shift: 45° steps", (a, b, mods, prefs) => {
    const end = mods.shift ? snapLineEnd(a, b) : b;
    if (end.x === a.x && end.y === a.y) return null;
    return { ...base, kind: "path", style: lineStyle(prefs.style), subpaths: [linePath(a, end)] };
  });
}

export function createPolygonTool(): Tool {
  return createDragTool(
    "polygon",
    "Drag from the centre to draw a polygon or star · Shift: upright",
    (a, b, mods, prefs) => {
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      if (r === 0) return null;
      const rotation = mods.shift ? -Math.PI / 2 : Math.atan2(b.y - a.y, b.x - a.x);
      const { sides, star, innerRatio } = prefs.polygon;
      const sp = star
        ? starPath(a, r, innerRatio, sides, rotation)
        : polygonPath(a, r, sides, rotation);
      return { ...base, kind: "path", style: prefs.style, subpaths: [sp] };
    },
  );
}

/** Panning is routed before tools see the pointer; the hand tool only supplies a cursor and hint. */
export function createHandTool(): Tool {
  return {
    id: "hand",
    hint: "Drag to pan · pinch or ⌘/Ctrl + wheel to zoom",
    cursor: "grab",
    down() {},
    move() {},
    up() {},
    cancel() {},
  };
}
