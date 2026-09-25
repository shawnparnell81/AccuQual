import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { listOnboardingProgressHandler, updateOnboardingProgressHandler } from "./onboarding.controller.js";
import { onboardingAiGenerateHandler } from "./onboarding.ai.js";

const updateProgressSchema = z.object({ status: z.enum(["not_started", "in_progress", "completed"]) });

export const onboardingRouter = Router();
// No department gate at all — onboarding must work for any user in any
// department, same reasoning as POST /ai/assistant. Every row is scoped to
// req.user.id (never a body-supplied userId), so there's nothing to guard
// beyond being a real authenticated user of this tenant.
onboardingRouter.use(requireAuth, withDb);

onboardingRouter.post("/ai-generate", onboardingAiGenerateHandler);
onboardingRouter.get("/progress", listOnboardingProgressHandler);
onboardingRouter.patch("/progress/:moduleKey", validate(updateProgressSchema), updateOnboardingProgressHandler);
