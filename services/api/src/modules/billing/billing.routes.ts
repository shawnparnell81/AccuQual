import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import { users } from "../../drizzle/schema/index.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { createCheckoutSession, createPortalSession, describeBilling, handleStripeEvent, verifyWebhook } from "./billing.service.js";
import { PLANS, PURCHASABLE_PLANS } from "./plans.js";

/**
 * A company's own billing: what plan it is on, starting a subscription, and reaching Stripe's customer portal (card,
 * invoices, cancel). Admin accounts only. Payment details never touch this app: Stripe's hosted pages collect and store them.
 */
export const billingRouter = Router();
billingRouter.use(requireAuth, requireRole("admin"));

function tenantOf(req: Request): number {
  const tenantId = req.user?.tenantId;
  if (!tenantId) throw AppError.forbidden("Billing belongs to a company account.");
  return tenantId;
}

billingRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ ...(await describeBilling(tenantOf(req))), plans: PLANS });
  })
);

const checkoutSchema = z.object({ plan: z.enum(PURCHASABLE_PLANS as [string, ...string[]]) });

billingRouter.post(
  "/checkout",
  validate(checkoutSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, req.user!.id));
    const url = await createCheckoutSession(tenantOf(req), me?.email ?? "", req.body.plan);
    res.json({ url });
  })
);

billingRouter.post(
  "/portal",
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ url: await createPortalSession(tenantOf(req)) });
  })
);

/**
 * Stripe calls this, not a browser. It is authenticated by Stripe's signature on the raw request body, so app.ts mounts it
 * before the JSON parser (which would change the bytes the signature covers) and it carries no session.
 */
export const billingWebhookHandler = asyncHandler(async (req: Request, res: Response) => {
  const event = verifyWebhook(req.body as Buffer, req.headers["stripe-signature"] as string | undefined);
  const result = await handleStripeEvent(event);
  logger.info("Stripe event received", { type: event.type, handled: result.handled, duplicate: result.duplicate });
  res.json({ received: true });
});
