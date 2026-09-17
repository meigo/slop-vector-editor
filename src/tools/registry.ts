import { createNodeTool } from "./node-tool";
import { createSelectTool } from "./select";
import {
  createEllipseTool,
  createHandTool,
  createLineTool,
  createPolygonTool,
  createRectTool,
} from "./shape-tools";
import type { Tool } from "./tool";
import type { ToolId } from "./types";

/** One instance per tool; tools keep their in-progress gesture state in closures. */
export const TOOLS: Readonly<Record<ToolId, Tool>> = {
  select: createSelectTool(),
  rect: createRectTool(),
  ellipse: createEllipseTool(),
  line: createLineTool(),
  polygon: createPolygonTool(),
  node: createNodeTool(),
  hand: createHandTool(),
};
