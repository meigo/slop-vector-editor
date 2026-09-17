import { rowLabel } from "../doc/layers";
import { findNode } from "../doc/tree";
import { hitTest } from "../geom/hit";
import { pointerTolerance, type Tool, type ToolContext, type ToolEvent } from "./tool";

/** Spec (M4a) §6. Editing one path's nodes; everything happens in that path's own space. */
export function createNodeTool(): Tool {
  return {
    id: "node",
    hint: "Click a path to edit its nodes",
    cursor: "default",

    down(ctx, e) {
      pickTarget(ctx, e);
    },
    move() {},
    up() {},
    cancel() {},
  };
}

/** Clicking away from the current target: pick a new path, refuse a live shape, or clear.
 *  Empty space keeps an existing target (only its node selection clears) so a marquee can still
 *  start inside it; with no target, empty space clears the top-level selection instead. */
function pickTarget(ctx: ToolContext, e: ToolEvent): void {
  const doc = ctx.doc();
  const hit = hitTest(
    doc,
    e.doc,
    pointerTolerance(e.pointerType) / ctx.view().zoom,
    ctx.enteredGroupId(),
  );
  if (!hit) {
    if (ctx.nodeTarget() !== null) {
      ctx.setNodeSel([]);
    } else {
      ctx.setSelection([]);
    }
    return;
  }
  const found = findNode(doc, hit.nodeId);
  const node = found?.node;
  if (!node) return;
  ctx.setSelection([node.id]);
  if (node.kind === "path") {
    ctx.setNodeTarget(node.id);
    return;
  }
  ctx.setNodeTarget(null);
  if (node.kind !== "group") {
    ctx.notify(
      "info",
      `“${rowLabel(node)}” is a live shape — use Convert to path to edit its nodes.`,
    );
  }
}
