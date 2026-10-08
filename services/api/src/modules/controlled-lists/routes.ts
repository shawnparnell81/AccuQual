import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { downloadControlledListHandler, getControlledListHandler, locationControlledListHandler, rowsControlledListHandler, saveControlledListHandler } from "./controller.js";

export const controlledListsRouter = Router();

controlledListsRouter.use(requireAuth, withDb);
controlledListsRouter.get("/:key/xlsx", downloadControlledListHandler);
controlledListsRouter.post("/:key/rows", rowsControlledListHandler);
controlledListsRouter.post("/:key/location", locationControlledListHandler);
controlledListsRouter.get("/:key", getControlledListHandler);
controlledListsRouter.put("/:key", saveControlledListHandler);
