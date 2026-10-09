import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import {
  createDocumentChangeRequestSchema,
  updateDocumentChangeRequestSchema,
  createChangeItemSchema,
  updateChangeItemSchema,
  createReviewSchema,
  updateReviewSchema,
  signDocumentChangeRequestSchema,
} from "./documentChangeRequests.validation.js";
import {
  listDcrHandler,
  createDcrHandler,
  getDcrHandler,
  updateDcrHandler,
  signDcrHandler,
  deleteDcrHandler,
  createChangeItemHandler,
  updateChangeItemHandler,
  deleteChangeItemHandler,
  createReviewHandler,
  updateReviewHandler,
  deleteReviewHandler,
} from "./documentChangeRequests.controller.js";
import { beginDcrEdit } from "../forms/moduleBeginEdit.js";

export const documentChangeRequestsRouter = Router();
// Deliberately not gated with requireDepartmentAccess — same convention as
// Document Control itself (documents.routes.ts's own comment): every
// authenticated company user may raise/edit one.
documentChangeRequestsRouter.use(requireAuth, withDb);

documentChangeRequestsRouter.get("/", listDcrHandler);
documentChangeRequestsRouter.post("/", validate(createDocumentChangeRequestSchema), createDcrHandler);
documentChangeRequestsRouter.get("/:id", getDcrHandler);
documentChangeRequestsRouter.patch("/:id", validate(updateDocumentChangeRequestSchema), updateDcrHandler);
documentChangeRequestsRouter.post("/:id/sign", validate(signDocumentChangeRequestSchema), signDcrHandler);
documentChangeRequestsRouter.post("/:id/begin-edit", beginDcrEdit);
documentChangeRequestsRouter.delete("/:id", deleteDcrHandler);

documentChangeRequestsRouter.post("/:id/items", validate(createChangeItemSchema), createChangeItemHandler);
documentChangeRequestsRouter.patch("/:id/items/:itemId", validate(updateChangeItemSchema), updateChangeItemHandler);
documentChangeRequestsRouter.delete("/:id/items/:itemId", deleteChangeItemHandler);

documentChangeRequestsRouter.post("/:id/reviews", validate(createReviewSchema), createReviewHandler);
documentChangeRequestsRouter.patch("/:id/reviews/:reviewId", validate(updateReviewSchema), updateReviewHandler);
documentChangeRequestsRouter.delete("/:id/reviews/:reviewId", deleteReviewHandler);
