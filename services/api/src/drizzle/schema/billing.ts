import { pgTable, serial, text, integer, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * One row per company that has started paying (or been given a plan by hand). A company with no row simply has no plan yet.
 *
 * Deliberately NOT a row-level-security table: Stripe's webhook has no logged-in tenant, it knows a company only by its Stripe
 * customer id, so the webhook has to look rows up across tenants. Every tenant-facing read and write goes through
 * billing.service.ts, which always filters by the caller's tenant id (the same arrangement the tenants table itself uses).
 */
export const tenantSubscriptions = pgTable(
  "tenant_subscriptions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    /** foundation | operations | enterprise | complimentary (given by hand, never billed) */
    plan: text("plan").notNull(),
    /** none | incomplete | trialing | active | past_due | canceled | complimentary */
    status: text("status").notNull().default("incomplete"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    trialEndsAt: timestamp("trial_ends_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    tenantUnique: uniqueIndex("tenant_subscriptions_tenant_uidx").on(t.tenantId),
    customerIdx: uniqueIndex("tenant_subscriptions_customer_uidx").on(t.stripeCustomerId),
  })
);

/** Every Stripe event already handled. Stripe re-sends events, so the id is the idempotency key: a repeat is acknowledged and ignored. */
export const billingEvents = pgTable("billing_events", {
  id: serial("id").primaryKey(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  type: text("type").notNull(),
  tenantId: integer("tenant_id"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});

export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;
