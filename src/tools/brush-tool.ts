import { brushStyle } from "../brush/commit";
import { brushOutline } from "../brush/outline";
import { pathSmoothRadius, ropeLength, Steadier, type StrokePoint } from "../brush/smoothing";
import type { Paint } from "../doc/document";
import { blockMessage, layerBlock } from "../doc/layers";
import { loadPaper } from "../geom/paper";
import type { Vec } from "../geom/vec";
import { screenToDoc } from "../state/viewport";
import type { Tool, ToolContext } from "./tool";

/** The Brush tool (spec M21 §2, §3, §5): steadies the pointer in screen space, outlines the
 *  stroke in document space — each point through the view at the moment it was accepted, so a
 *  wheel pan or zoom mid-stroke keeps the ink under the pen (spec §3) — previews it in the overlay and
 *  hands the finished outline to the store. Like the pen's draft (invariant 33), a stroke in
 *  progress never enters the document. */
export function createBrushTool(): Tool {
  let steadier: Steadier | null = null;
  let pen = false; // pointerType === "pen" for this stroke
  // `steadier.points` mapped to document space through the view current when each was accepted.
  // The steadier only appends, so after every call its new tail is mapped and appended here.
  let docPoints: StrokePoint[] = [];

  const settings = (ctx: ToolContext) => ctx.prefs().brush;
  const toPoint = (e: { screen: Vec; pressure: number; time: number }): StrokePoint => ({
    x: e.screen.x,
    y: e.screen.y,
    pressure: pen ? e.pressure : 0.5,
    timestamp: e.time,
  });
  const accept = (ctx: ToolContext) => {
    const v = ctx.view();
    const pts = steadier!.points;
    for (let i = docPoints.length; i < pts.length; i++)
      docPoints.push({ ...pts[i], ...screenToDoc(v, pts[i]) });
  };
  const outline = (ctx: ToolContext, last: boolean): Vec[] => {
    const b = settings(ctx);
    const v = ctx.view();
    return brushOutline(docPoints, {
      size: b.size,
      pressureRange: pen ? b.pressure : 1,
      taper: b.taper,
      smoothRadius: pathSmoothRadius(b.smooth, v.zoom),
      last,
    });
  };
  const show = (ctx: ToolContext, live: Vec[] | null, cursor: { at: Vec; r: number } | null) => {
    const st = brushStyle(ctx.prefs().style);
    // brushStyle always paints with a flat `Paint` (Task 4), never a gradient.
    ctx.setOverlay({ kind: "brush", fill: st.fill as Paint, opacity: st.opacity, live, cursor });
  };
  const end = (ctx: ToolContext) => {
    steadier = null;
    docPoints = [];
    // Null, not an empty brush overlay: a tool switch may already have cleared the slot, and the
    // next hover brings the size cursor back.
    ctx.setOverlay(null);
  };

  return {
    id: "brush",
    hint: "Drag to paint · pressure sets the width with a Pencil · Esc discards the stroke",
    cursor: "crosshair",
    activate() {
      // Warm Paper's lazy chunk so the first stroke's simplify doesn't wait on the network.
      void loadPaper().catch(() => {});
    },
    down(ctx, e) {
      const block = layerBlock(ctx.doc(), ctx.currentLayerId());
      if (block) {
        ctx.notify("info", blockMessage(block, "draw"));
        return;
      }
      pen = e.pointerType === "pen";
      steadier = new Steadier(ropeLength(settings(ctx).stream / 100));
      docPoints = [];
      steadier.start(toPoint(e));
      accept(ctx);
      show(ctx, outline(ctx, false), null);
    },
    move(ctx, e) {
      if (!steadier) return;
      for (const s of e.samples ?? [e]) steadier.move(toPoint(s));
      accept(ctx);
      show(ctx, outline(ctx, false), null);
    },
    up(ctx, e) {
      if (!steadier) return;
      steadier.finish(toPoint(e));
      accept(ctx);
      const o = outline(ctx, true);
      end(ctx);
      if (o.length >= 3) ctx.commitBrushStroke(o);
    },
    cancel(ctx) {
      if (steadier) end(ctx);
    },
    busy: () => steadier !== null,
    keydown(ctx, key) {
      if (key !== "escape" || !steadier) return false;
      end(ctx);
      return true;
    },
    discard(ctx) {
      if (steadier) end(ctx);
    },
    hover(ctx, e) {
      show(ctx, null, { at: e.doc, r: settings(ctx).size / 2 });
    },
  };
}
