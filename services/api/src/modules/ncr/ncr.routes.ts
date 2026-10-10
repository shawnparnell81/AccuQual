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
  dispositionStepNcrSchema,
  verifyNcrSchema,
  ncrStepDocumentsSchema,
  bulkUpdateNcrSchema,
  addNcrQuarantineItemSchema,
  completeNcrDispositionSchema,
} from "./ncr.validation.js";
import { deleteRecordHandler } from "../records/recordDeletion.js";
import { clearReportingCache } from "../reporting/reporting.service.js";
import { beginNcrEdit } from "../forms/moduleBeginEdit.js";
import {
  baseHandlers,
  listHandler,
  repeatsHandler,
  assignHandler,
  containmentHandler,
  rootCauseHandler,
  correctiveActionHandler,
  closeHandler,
  dispositionStepHandler,
  verifyHandler,
  presentNcrWorkflow,
  processMetricsHandler,
  rejectLockedNcr,
  rejectCloseWhileQuarantineOnHold,
  listNcrQuarantineItemsHandler,
  addNcrQuarantineItemHandler,
  completeNcrDispositionHandler,
  setNcrStepDocumentsHandler,
} from "./ncr.controller.js";

export const ncrRouter = Router();
// Turns on PERMISSION_MATRIX.ncr (quality: edit) — previously unenforced.
ncrRouter.use(requireAuth, withDb, withSiteContext, requireDepartmentAccess("ncr"), presentNcrWorkflow);
ncrRouter.use((req, res, next) => {
  res.on("finish", () => {
    if (req.method !== "GET" && req.method !== "HEAD" && res.statusCode < 400) clearReportingCache();
  });
  next();
});

ncrRouter.get("/", listHandler);
ncrRouter.get("/process-metrics", processMetricsHandler);
ncrRouter.post("/", validate(createNcrSchema), baseHandlers.create);
// Bulk actions pilot (see crudFactory.ts's bulkUpdate) — "bulk" must be registered before the ":id" param route
// below, or a request to PATCH /ncr/bulk would be read as :id="bulk" instead of reaching this handler.
ncrRouter.patch("/bulk", validate(bulkUpdateNcrSchema), rejectLockedNcr, rejectCloseWhileQuarantineOnHold, baseHandlers.bulkUpdate);
ncrRouter.get("/:id/repeats", repeatsHandler);
ncrRouter.get("/:id", baseHandlers.getOne);
ncrRouter.patch("/:id", validate(updateNcrSchema), rejectLockedNcr, rejectCloseWhileQuarantineOnHold, baseHandlers.update);
ncrRouter.post("/:id/begin-edit", beginNcrEdit);
ncrRouter.delete("/:id", rejectLockedNcr, deleteRecordHandler("ncr"));

ncrRouter.post("/:id/assign", rejectLockedNcr, validate(assignNcrSchema), assignHandler);
ncrRouter.post("/:id/containment", rejectLockedNcr, validate(containmentNcrSchema), containmentHandler);
ncrRouter.post("/:id/root-cause", rejectLockedNcr, validate(rootCauseNcrSchema), rootCauseHandler);
ncrRouter.post("/:id/corrective-action", rejectLockedNcr, validate(correctiveActionNcrSchema), correctiveActionHandler);
ncrRouter.post("/:id/disposition-step", rejectLockedNcr, validate(dispositionStepNcrSchema), dispositionStepHandler);
ncrRouter.post("/:id/verify", rejectLockedNcr, validate(verifyNcrSchema), verifyHandler);
ncrRouter.put("/:id/step-documents", rejectLockedNcr, validate(ncrStepDocumentsSchema), setNcrStepDocumentsHandler);
ncrRouter.post("/:id/close", rejectLockedNcr, closeHandler);
ncrRouter.get("/:id/quarantine-items", listNcrQuarantineItemsHandler);
ncrRouter.post("/:id/quarantine-items", rejectLockedNcr, validate(addNcrQuarantineItemSchema), addNcrQuarantineItemHandler);
ncrRouter.post("/:id/disposition", rejectLockedNcr, validate(completeNcrDispositionSchema), completeNcrDispositionHandler);
