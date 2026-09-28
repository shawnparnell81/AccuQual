import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { validate } from "../../middleware/validate.js";
import {
  createNcrSchema,
  updateNcrSchema,
  assignNcrSchema,
  containmentNcrSchema,
  rootCauseNcrSchema,
  correctiveActionNcrSchema,
  bulkUpdateNcrSchema,
  addNcrQuarantineItemSchema,
  completeNcrDispositionSchema,
} from "./ncr.validation.js";
import { deleteRecordHandler } from "../records/recordDeletion.js";
import {
  baseHandlers,
  listHandler,
  repeatsHandler,
  assignHandler,
  containmentHandler,
  rootCauseHandler,
  correctiveActionHandler,
  closeHandler,
  listNcrQuarantineItemsHandler,
  addNcrQuarantineItemHandler,
  completeNcrDispositionHandler,
} from "./ncr.controller.js";

export const ncrRouter = Router();
// Turns on PERMISSION_MATRIX.ncr (quality: edit) — previously unenforced.
ncrRouter.use(requireAuth, withDb, withSiteContext, requireDepartmentAccess("ncr"));

ncrRouter.get("/", listHandler);
ncrRouter.post("/", validate(createNcrSchema), baseHandlers.create);
// Bulk actions pilot (see crudFactory.ts's bulkUpdate) — "bulk" must be registered before the ":id" param route
// below, or a request to PATCH /ncr/bulk would be read as :id="bulk" instead of reaching this handler.
ncrRouter.patch("/bulk", validate(bulkUpdateNcrSchema), baseHandlers.bulkUpdate);
ncrRouter.get("/:id/repeats", repeatsHandler);
ncrRouter.get("/:id", baseHandlers.getOne);
ncrRouter.patch("/:id", validate(updateNcrSchema), baseHandlers.update);
ncrRouter.delete("/:id", deleteRecordHandler("ncr"));

ncrRouter.post("/:id/assign", validate(assignNcrSchema), assignHandler);
ncrRouter.post("/:id/containment", validate(containmentNcrSchema), containmentHandler);
ncrRouter.post("/:id/root-cause", validate(rootCauseNcrSchema), rootCauseHandler);
ncrRouter.post("/:id/corrective-action", validate(correctiveActionNcrSchema), correctiveActionHandler);
ncrRouter.post("/:id/close", closeHandler);
ncrRouter.get("/:id/quarantine-items", listNcrQuarantineItemsHandler);
ncrRouter.post("/:id/quarantine-items", validate(addNcrQuarantineItemSchema), addNcrQuarantineItemHandler);
ncrRouter.post("/:id/disposition", validate(completeNcrDispositionSchema), completeNcrDispositionHandler);
