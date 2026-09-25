import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db/index.js";
import { billingEvents, tenantSubscriptions, tenants, type TenantSubscription } from "../../drizzle/schema/index.js";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { recordAuditTrailStandalone } from "../audit-trail/audit-trail.service.js";
import { PURCHASABLE_PLANS, planForPriceId, priceIdFor, type PlanId } from "./plans.js";

let client: Stripe | null = null;
/** The Stripe client, or null when billing isn't set up (no secret key). */
export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  client ??= new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) throw AppError.badRequest("Billing isn't set up yet. Ask your AccuQual administrator to add the Stripe keys.");
  return stripe;
}

/** Stripe's subscription statuses folded into the handful this app shows. */
export function mapStripeStatus(status: string): "incomplete" | "trialing" | "active" | "past_due" | "canceled" {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    default:
      return "incomplete";
  }
}

export async function getSubscription(tenantId: number): Promise<TenantSubscription | null> {
  const [row] = await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId));
  return row ?? null;
}

/** What the Billing page shows: the company's plan and status, plus which plans can be bought right now. */
export async function describeBilling(tenantId: number) {
  const row = await getSubscription(tenantId);
  return {
    billingEnabled: !!getStripe(),
    subscription: row
      ? {
          plan: row.plan,
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          trialEndsAt: row.trialEndsAt,
          hasStripeCustomer: !!row.stripeCustomerId,
        }
      : null,
    availablePlans: PURCHASABLE_PLANS.filter((plan) => !!priceIdFor(plan)),
  };
}

/** A company already paying (or in a trial or a payment problem) manages that subscription in Stripe's portal; only a company with no live subscription starts a new one here. */
function hasLiveSubscription(row: TenantSubscription | null): boolean {
  return !!row && !!row.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(row.status);
}

export async function createCheckoutSession(tenantId: number, adminEmail: string, plan: PlanId): Promise<string> {
  const stripe = requireStripe();
  const priceId = priceIdFor(plan);
  if (!priceId) throw AppError.badRequest("That plan can't be bought yet: its price hasn't been set up.");
  const existing = await getSubscription(tenantId);
  if (existing?.status === "complimentary") throw AppError.badRequest("This company has a complimentary plan and isn't billed.");
  if (hasLiveSubscription(existing)) throw AppError.badRequest("This company already has a subscription. Use Manage billing to change it.");

  const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({ name: tenant?.name, email: adminEmail, metadata: { tenantId: String(tenantId) } });
    customerId = customer.id;
    await db
      .insert(tenantSubscriptions)
      .values({ tenantId, plan, status: "incomplete", stripeCustomerId: customerId })
      .onConflictDoUpdate({ target: tenantSubscriptions.tenantId, set: { stripeCustomerId: customerId, updatedAt: new Date() } });
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: String(tenantId),
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { tenantId: String(tenantId), plan } },
    success_url: `${env.FRONTEND_URL}/admin/billing?checkout=success`,
    cancel_url: `${env.FRONTEND_URL}/admin/billing?checkout=canceled`,
  });
  if (!session.url) throw AppError.badRequest("Stripe didn't return a checkout address. Please try again.");
  return session.url;
}

export async function createPortalSession(tenantId: number): Promise<string> {
  const stripe = requireStripe();
  const existing = await getSubscription(tenantId);
  if (!existing?.stripeCustomerId) throw AppError.badRequest("There's no billing account to manage yet. Choose a plan first.");
  const session = await stripe.billingPortal.sessions.create({ customer: existing.stripeCustomerId, return_url: `${env.FRONTEND_URL}/admin/billing` });
  return session.url;
}

// ---------------------------------------------------------------------------
// Webhook: Stripe tells us what happened; the stored row is only ever changed here.
// ---------------------------------------------------------------------------

/** Verifies the signature on the raw request body and returns the event. Throws on a missing/incorrect signature. */
export function verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
  const stripe = requireStripe();
  if (!env.STRIPE_WEBHOOK_SECRET) throw AppError.badRequest("Billing webhook isn't set up.");
  if (!signature) throw AppError.badRequest("Missing Stripe signature.");
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw AppError.badRequest("Invalid Stripe signature.");
  }
}

/** Which company a Stripe subscription belongs to: the id we stamped on it at checkout, else the customer we created. */
async function tenantIdForSubscription(sub: Stripe.Subscription): Promise<number | null> {
  const stamped = Number(sub.metadata?.tenantId);
  if (Number.isInteger(stamped) && stamped > 0) return stamped;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const [row] = await db.select({ tenantId: tenantSubscriptions.tenantId }).from(tenantSubscriptions).where(eq(tenantSubscriptions.stripeCustomerId, customerId));
  return row?.tenantId ?? null;
}

/** End of the paid period. Newer Stripe API versions keep it on the subscription's items rather than the subscription itself. */
function periodEnd(sub: Stripe.Subscription): Date | null {
  const seconds = (sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return seconds ? new Date(seconds * 1000) : null;
}

/** Copies a Stripe subscription onto the company's row. Returns the company id, or null when it can't be matched to one. */
export async function applySubscription(sub: Stripe.Subscription): Promise<number | null> {
  const tenantId = await tenantIdForSubscription(sub);
  if (!tenantId) {
    logger.warn("Stripe subscription doesn't match any company", { subscriptionId: sub.id });
    return null;
  }
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const [current] = await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId));
  // A complimentary company is never billed or overwritten by Stripe.
  if (current?.status === "complimentary") return tenantId;

  const plan = planForPriceId(sub.items?.data?.[0]?.price?.id) ?? (PURCHASABLE_PLANS.find((p) => p === sub.metadata?.plan) as PlanId | undefined) ?? (current?.plan as PlanId | undefined);
  if (!plan) {
    logger.warn("Stripe subscription has a price this app doesn't know", { subscriptionId: sub.id });
    return tenantId;
  }
  const values = {
    plan,
    status: mapStripeStatus(sub.status),
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: periodEnd(sub),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    updatedAt: new Date(),
  };
  const [saved] = await db
    .insert(tenantSubscriptions)
    .values({ tenantId, ...values })
    .onConflictDoUpdate({ target: tenantSubscriptions.tenantId, set: values })
    .returning();
  if (!current || current.plan !== values.plan || current.status !== values.status) {
    await recordAuditTrailStandalone(pool, {
      tenantId,
      entityType: "Billing",
      entityId: saved!.id,
      action: "update",
      changes: { plan: { from: current?.plan ?? null, to: values.plan }, status: { from: current?.status ?? null, to: values.status }, source: "stripe" },
    });
  }
  return tenantId;
}

/** Handles one verified Stripe event. Safe to call twice with the same event: the second call does nothing. */
export async function handleStripeEvent(event: Stripe.Event): Promise<{ handled: boolean; duplicate: boolean }> {
  const inserted = await db.insert(billingEvents).values({ stripeEventId: event.id, type: event.type }).onConflictDoNothing().returning({ id: billingEvents.id });
  if (inserted.length === 0) return { handled: false, duplicate: true };

  let tenantId: number | null = null;
  let handled = true;
  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        tenantId = await applySubscription(event.data.object as Stripe.Subscription);
        break;
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (subId) tenantId = await applySubscription(await requireStripe().subscriptions.retrieve(subId));
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          const [row] = await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.stripeCustomerId, customerId));
          if (row && row.status !== "complimentary") {
            await db.update(tenantSubscriptions).set({ status: "past_due", updatedAt: new Date() }).where(eq(tenantSubscriptions.id, row.id));
            tenantId = row.tenantId;
            await recordAuditTrailStandalone(pool, { tenantId: row.tenantId, entityType: "Billing", entityId: row.id, action: "update", changes: { status: { from: row.status, to: "past_due" }, source: "stripe" } });
          }
        }
        break;
      }
      default:
        handled = false;
    }
  } catch (err) {
    // Forget the event so Stripe's retry gets a fresh attempt instead of being swallowed as a duplicate.
    await db.delete(billingEvents).where(eq(billingEvents.stripeEventId, event.id));
    throw err;
  }
  if (tenantId) await db.update(billingEvents).set({ tenantId }).where(eq(billingEvents.stripeEventId, event.id));
  return { handled, duplicate: false };
}
