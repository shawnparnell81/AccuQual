import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import {
  createHandler,
  deleteHandler,
  exportDocxHandler,
  fileFillHandler,
  getFillHandler,
  getHandler,
  importDocxHandler,
  listHandler,
  openFillHandler,
  publishHandler,
  revisionsHandler,
  saveFillHandler,
  saveHandler,
  signFillHandler,
} from "./controller.js";

export const formBuilderRouter = Router();
formBuilderRouter.use(requireAuth, withDb);

formBuilderRouter.get("/", listHandler);
formBuilderRouter.post("/", createHandler);
formBuilderRouter.post("/import-docx", importDocxHandler);
formBuilderRouter.get("/fills/:fillId", getFillHandler);
formBuilderRouter.patch("/fills/:fillId", saveFillHandler);
formBuilderRouter.post("/fills/:fillId/file", fileFillHandler);
formBuilderRouter.post("/fills/:fillId/sign", signFillHandler);
formBuilderRouter.get("/:id/docx", exportDocxHandler);
formBuilderRouter.get("/:id/revisions", revisionsHandler);
formBuilderRouter.post("/:id/publish", publishHandler);
formBuilderRouter.post("/:id/fills", openFillHandler);
formBuilderRouter.get("/:id", getHandler);
formBuilderRouter.patch("/:id", saveHandler);
formBuilderRouter.delete("/:id", deleteHandler);
