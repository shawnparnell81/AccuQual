// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Billing: who may see it, what the page reports, and Stripe's webhook (signature, idempotency, plan/status sync,
// complimentary companies never overwritten, one company never seeing another's subscription). Stripe itself is never
// called: webhook events are signed locally with the same secret the app verifies against.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_billing_suite";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_billing_suite";
  process.env.STRIPE_PRICE_FOUNDATION = "price_foundation_test";
  process.env.STRIPE_PRICE_OPERATIONS = "price_operations_test";
  delete process.env.STRIPE_PRICE_ENTERPRISE;
});

import Stripe from "stripe";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { billingEvents, tenantSubscriptions } from "../../src/drizzle/schema/billing.js";
import { refreshTokens } from "../../src/drizzle/schema/refreshTokens.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();
const CSRF = { "X-AccuQual-Csrf": "1" };
const auth = (token: string) => ({ Authorization: `Bearer ${token}`, ...CSRF });
const stripe = new Stripe("sk_test_billing_suite");

let tenantA: number;
let tenantB: number;
let adminA: string;
let adminB: string;
let operatorA: string;
const userIds: number[] = [];
let eventCounter = 0;

function subscriptionEvent(type: string, tenantId: number, opts: { status?: string; price?: string; customer?: string; id?: string } = {}) {
  const eventId = `evt_billing_${suffix}_${++eventCounter}`;
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    type,
    data: {
      object: {
        id: opts.id ?? `sub_billing_${suffix}_${tenantId}`,
        object: "subscription",
        customer: opts.customer ?? `cus_billing_${suffix}_${tenantId}`,
        status: opts.status ?? "active",
        cancel_at_period_end: false,
        trial_end: null,
        metadata: { tenantId: String(tenantId) },
        items: { data: [{ price: { id: opts.price ?? "price_operations_test" }, current_period_end: 1893456000 }] },
      },
    },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_billing_suite" });
  return { eventId, payload, header };
}

async function send(ev: { payload: string; header: string }) {
  return request(app).post("/billing/webhook").set("Content-Type", "application/json").set("Stripe-Signature", ev.header).send(ev.payload);
}

async function makeTenant(label: string) {
  const [t] = await db.insert(tenants).values({ name: `Billing ${label} ${suffix}`, code: `billing-${label}-${suffix}` }).returning();
  await seedDefaultPermissions(t!.id);
  return t!.id;
}

describe("Billing (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    tenantA = await makeTenant("a");
    tenantB = await makeTenant("b");
    const [a] = await db.insert(users).values({ tenantId: tenantA, email: `billing-admin-a-${suffix}@test.local`, passwordHash: "unused" }).returning();
    const [b] = await db.insert(users).values({ tenantId: tenantB, email: `billing-admin-b-${suffix}@test.local`, passwordHash: "unused" }).returning();
    const [o] = await db.insert(users).values({ tenantId: tenantA, email: `billing-op-a-${suffix}@test.local`, passwordHash: "unused", department: "production" }).returning();
    userIds.push(a!.id, b!.id, o!.id);
    adminA = await signAccessToken({ sub: String(a!.id), tenantId: tenantA, roleId: null, roleName: "admin", department: null });
    adminB = await signAccessToken({ sub: String(b!.id), tenantId: tenantB, roleId: null, roleName: "admin", department: null });
    operatorA = await signAccessToken({ sub: String(o!.id), tenantId: tenantA, roleId: null, roleName: "operator", department: "production" });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    const ids = [tenantA, tenantB];
    await db.delete(billingEvents).where(inArray(billingEvents.tenantId, ids));
    await db.delete(billingEvents).where(eq(billingEvents.type, "customer.subscription.created"));
    await db.delete(tenantSubscriptions).where(inArray(tenantSubscriptions.tenantId, ids));
    await db.delete(auditRowChanges).where(inArray(auditRowChanges.tenantId, ids));
    await db.delete(auditTrail).where(inArray(auditTrail.tenantId, ids));
    if (userIds.length) await db.delete(refreshTokens).where(inArray(refreshTokens.userId, userIds));
    await db.delete(users).where(inArray(users.tenantId, ids));
    await db.delete(departmentPermissions).where(inArray(departmentPermissions.tenantId, ids));
    await db.delete(tenants).where(inArray(tenants.id, ids));
    await pool.end();
  });

  it("is for admins only", async () => {
    expect((await request(app).get("/billing")).status).toBe(401);
    expect((await request(app).get("/billing").set(auth(operatorA))).status).toBe(403);
    expect((await request(app).post("/billing/portal").set(auth(operatorA))).status).toBe(403);
  });

  it("reports no plan yet, that billing is on, and only the plans that have a price", async () => {
    const res = await request(app).get("/billing").set(auth(adminA));
    expect(res.status).toBe(200);
    expect(res.body.billingEnabled).toBe(true);
    expect(res.body.subscription).toBeNull();
    expect(res.body.availablePlans).toEqual(["foundation", "operations"]);
    expect(res.body.plans.map((p: { id: string }) => p.id)).toEqual(["foundation", "operations", "enterprise"]);
  });

  it("refuses to start checkout for a plan with no price, and to open the portal before there is a billing account", async () => {
    const enterprise = await request(app).post("/billing/checkout").set(auth(adminA)).send({ plan: "enterprise" });
    expect(enterprise.status).toBe(400);
    expect(enterprise.body.message).toMatch(/price/i);
    expect((await request(app).post("/billing/checkout").set(auth(adminA)).send({ plan: "platinum" })).status).toBe(400);
    const portal = await request(app).post("/billing/portal").set(auth(adminA));
    expect(portal.status).toBe(400);
    expect(portal.body.message).toMatch(/choose a plan/i);
  });

  it("rejects a webhook with a bad or missing signature, and changes nothing", async () => {
    const ev = subscriptionEvent("customer.subscription.created", tenantA);
    const bad = await request(app).post("/billing/webhook").set("Content-Type", "application/json").set("Stripe-Signature", "t=1,v1=deadbeef").send(ev.payload);
    expect(bad.status).toBe(400);
    const none = await request(app).post("/billing/webhook").set("Content-Type", "application/json").send(ev.payload);
    expect(none.status).toBe(400);
    expect(await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantA))).toHaveLength(0);
  });

  it("turns a subscription event into the company's plan and status, with an audit entry", async () => {
    const res = await send(subscriptionEvent("customer.subscription.created", tenantA, { status: "active", price: "price_operations_test" }));
    expect(res.status).toBe(200);
    const [row] = await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantA));
    expect(row).toMatchObject({ plan: "operations", status: "active", cancelAtPeriodEnd: false });
    expect(row!.currentPeriodEnd?.getTime()).toBe(1893456000 * 1000);
    const page = await request(app).get("/billing").set(auth(adminA));
    expect(page.body.subscription).toMatchObject({ plan: "operations", status: "active" });
    const audit = await db.select().from(auditTrail).where(eq(auditTrail.tenantId, tenantA));
    expect(audit.some((a) => a.entityType === "Billing")).toBe(true);
  });

  it("ignores a repeated event instead of applying it twice", async () => {
    const ev = subscriptionEvent("customer.subscription.updated", tenantA, { status: "past_due" });
    expect((await send(ev)).status).toBe(200);
    expect((await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantA)))[0]!.status).toBe("past_due");
    // The company recovers; then Stripe re-sends the OLD past_due event. It must not undo the recovery.
    await send(subscriptionEvent("customer.subscription.updated", tenantA, { status: "active" }));
    expect((await send(ev)).status).toBe(200);
    expect((await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantA)))[0]!.status).toBe("active");
    expect(await db.select().from(billingEvents).where(eq(billingEvents.stripeEventId, ev.eventId))).toHaveLength(1);
  });

  it("marks a cancelled subscription cancelled, and follows a plan change", async () => {
    await send(subscriptionEvent("customer.subscription.updated", tenantA, { status: "active", price: "price_foundation_test" }));
    expect((await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantA)))[0]!.plan).toBe("foundation");
    await send(subscriptionEvent("customer.subscription.deleted", tenantA, { status: "canceled", price: "price_foundation_test" }));
    expect((await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantA)))[0]!.status).toBe("canceled");
  });

  it("never lets one company see another's subscription", async () => {
    const b = await request(app).get("/billing").set(auth(adminB));
    expect(b.body.subscription).toBeNull();
    await send(subscriptionEvent("customer.subscription.created", tenantB, { status: "trialing", price: "price_foundation_test" }));
    const a = await request(app).get("/billing").set(auth(adminA));
    const b2 = await request(app).get("/billing").set(auth(adminB));
    expect(a.body.subscription.status).toBe("canceled");
    expect(b2.body.subscription).toMatchObject({ plan: "foundation", status: "trialing" });
  });

  it("does not let Stripe overwrite a complimentary company", async () => {
    const [comp] = await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantB));
    await db.update(tenantSubscriptions).set({ plan: "complimentary", status: "complimentary" }).where(eq(tenantSubscriptions.id, comp!.id));
    await send(subscriptionEvent("customer.subscription.updated", tenantB, { status: "canceled" }));
    expect((await db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantB)))[0]).toMatchObject({ plan: "complimentary", status: "complimentary" });
    const checkout = await request(app).post("/billing/checkout").set(auth(adminB)).send({ plan: "foundation" });
    expect(checkout.status).toBe(400);
    expect(checkout.body.message).toMatch(/complimentary/i);
  });
});
