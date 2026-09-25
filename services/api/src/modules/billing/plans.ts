import { env } from "../../config/env.js";

export type PlanId = "foundation" | "operations" | "enterprise";
/** Plans a person can buy. "complimentary" also exists as a stored plan (given by hand, never billed) but is never offered. */
export const PURCHASABLE_PLANS: PlanId[] = ["foundation", "operations", "enterprise"];

export interface PlanDefinition {
  id: PlanId;
  name: string;
  summary: string;
  features: string[];
}

/**
 * What each plan is meant to include. Prices are NOT here: they live in Stripe, and a plan can be bought only once its
 * STRIPE_PRICE_* id is set. Nothing in the app is gated by plan yet: these lists describe the tiers so the Billing page and
 * the sales page say the same thing.
 */
export const PLANS: PlanDefinition[] = [
  {
    id: "foundation",
    name: "Foundation",
    summary: "Core quality records for one team.",
    features: ["Nonconformances, corrective actions and 8D", "Controlled documents and training", "Roles, permissions and audit trail", "Data export"],
  },
  {
    id: "operations",
    name: "Operations",
    summary: "The full shop-floor and supplier picture.",
    features: ["Everything in Foundation", "Supplier quality, receiving and inventory", "Work orders, calibration and audits", "AI assist and workflow rules"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    summary: "Many plants, one company.",
    features: ["Everything in Operations", "Multiple plants and single sign-on", "Digital twin device ingest", "Help onboarding your team"],
  },
];

export function priceIdFor(plan: PlanId): string | undefined {
  return { foundation: env.STRIPE_PRICE_FOUNDATION, operations: env.STRIPE_PRICE_OPERATIONS, enterprise: env.STRIPE_PRICE_ENTERPRISE }[plan] || undefined;
}

/** The plan a Stripe price id belongs to, or null for a price this app doesn't know. */
export function planForPriceId(priceId: string | undefined | null): PlanId | null {
  if (!priceId) return null;
  return PURCHASABLE_PLANS.find((plan) => priceIdFor(plan) === priceId) ?? null;
}
