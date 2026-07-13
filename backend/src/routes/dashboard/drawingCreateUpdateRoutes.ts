import express from "express";
import type { DrawingRouteContext } from "./drawingRouteContext";
import { registerDrawingCreateRoute } from "./drawingCreateRoute";
import { registerDrawingUpdateRoute } from "./drawingUpdateRoute";

export const registerDrawingCreateUpdateRoutes = (
  app: express.Express,
  context: DrawingRouteContext,
) => {
  registerDrawingCreateRoute(app, context);
  registerDrawingUpdateRoute(app, context);
};
