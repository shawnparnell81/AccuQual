import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { onboardingProgress } from "../../drizzle/schema/onboarding.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";

const VALID_STATUSES = ["not_started", "in_progress", "completed"];

/** GET /onboarding/progress — this user's own checklist state across every module they've touched so far. Not crudFactory-based: rows are keyed by (tenantId, userId, moduleKey), not a single numeric id. */
export const listOnboardingProgressHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req.db!.select().from(onboardingProgress).where(and(eq(onboardingProgress.tenantId, req.tenantId!), eq(onboardingProgress.userId, req.user!.id)));
  res.json(rows);
});

/** PATCH /onboarding/progress/:moduleKey — upserts this user's own status for one module; a user can only ever write their own row (userId always comes from req.user, never the request body). */
export const updateOnboardingProgressHandler = asyncHandler(async (req: Request, res: Response) => {
  const moduleKey = req.params.moduleKey;
  const { status } = req.body as { status: string };
  if (!moduleKey) throw AppError.badRequest("moduleKey is required");
  if (!VALID_STATUSES.includes(status)) throw AppError.badRequest(`status must be one of: ${VALID_STATUSES.join(", ")}`);

  const [existing] = await req
    .db!.select()
    .from(onboardingProgress)
    .where(and(eq(onboardingProgress.tenantId, req.tenantId!), eq(onboardingProgress.userId, req.user!.id), eq(onboardingProgress.moduleKey, moduleKey)));

  if (existing) {
    const [updated] = await req.db!.update(onboardingProgress).set({ status, updatedAt: new Date() }).where(eq(onboardingProgress.id, existing.id)).returning();
    res.json(updated);
    return;
  }

  const [created] = await req
    .db!.insert(onboardingProgress)
    .values({ tenantId: req.tenantId!, userId: req.user!.id, moduleKey, status })
    .returning();
  res.status(201).json(created);
});
