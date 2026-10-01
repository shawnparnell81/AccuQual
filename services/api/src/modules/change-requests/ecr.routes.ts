import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { getEcrStructure, getEcrWorkflow, saveEcrStructure, transitionEcr, unlockEcrStructure } from "./ecr.controller.js";
import { ecrStructureSaveSchema, ecrStructureUnlockSchema, ecrTransitionSchema } from "./ecr.validation.js";

/** Mounted before the ISO form router so these paths are not caught by /:id. */
export const ecrRouter = Router();

const signedIn = [requireAuth, withDb] as const;

ecrRouter.get("/structure/engineering-change", ...signedIn, getEcrStructure);
ecrRouter.post("/structure/engineering-change/unlock", ...signedIn, validate(ecrStructureUnlockSchema), unlockEcrStructure);
ecrRouter.put("/structure/engineering-change", ...signedIn, validate(ecrStructureSaveSchema), saveEcrStructure);
ecrRouter.get("/:id/workflow", ...signedIn, getEcrWorkflow);
ecrRouter.post("/:id/transition", ...signedIn, validate(ecrTransitionSchema), transitionEcr);
