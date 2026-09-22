// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// In-app notification bell: GET/PATCH /notifications/me — self-only, matched by the caller's own email as
// notification_log.recipient (req.user carries no email claim, so this proves the service really resolves it fresh
// from `users`, not from anything client-supplied). Also proves the admin-only /notifications/retry-failed route
// still works unaffected by mounting the self-service router first.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let userAId: number;
let userBId: number;
let adminId: number;
let emailA: string;
let tokenA: string;
let tokenB: string;
let adminToken: string;

async function makeUser(label: string, roleName = "operator") {
  const email = `notif-${label}-${suffix}@test.local`;
  const [user] = await db.insert(users).values({ tenantId, email, passwordHash: "unused" }).returning();
  const token = await signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department: null });
  return { id: user!.id, email, token };
}

describe("In-app notifications (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Notif Test ${suffix}`, code: `notif-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    const a = await makeUser("a");
    const b = await makeUser("b");
    const admin = await makeUser("admin", "admin");
    userAId = a.id;
    userBId = b.id;
    adminId = admin.id;
    emailA = a.email;
    tokenA = a.token;
    tokenB = b.token;
    adminToken = admin.token;

    await db.insert(notificationLog).values([
      { tenantId, channel: "email", recipient: emailA, subject: "Training due", body: "1 item needs attention", status: "sent" },
      { tenantId, channel: "email", recipient: emailA, subject: "Older one", body: "already read", status: "sent", readAt: new Date(Date.now() - 60_000) },
      { tenantId, channel: "email", recipient: b.email, subject: "Not yours", body: "belongs to user B", status: "sent" },
    ]);
  });

  afterAll(async () => {
    await db.delete(notificationLog).where(eq(notificationLog.tenantId, tenantId));
    await db.delete(users).where(eq(users.id, userAId));
    await db.delete(users).where(eq(users.id, userBId));
    await db.delete(users).where(eq(users.id, adminId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("returns only the caller's own notifications, newest first, with an unread count", async () => {
    const res = await request(app).get("/notifications/me").set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(2);
    expect(res.body.notifications.every((n: { subject: string }) => n.subject !== "Not yours")).toBe(true);
    expect(res.body.unreadCount).toBe(1);
  });

  it("a different user in the same tenant sees none of user A's notifications", async () => {
    const res = await request(app).get("/notifications/me").set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].subject).toBe("Not yours");
  });

  it("marking one of the caller's own notifications read updates the unread count", async () => {
    const list = await request(app).get("/notifications/me").set("Authorization", `Bearer ${tokenA}`);
    const unread = list.body.notifications.find((n: { readAt: string | null }) => n.readAt === null);

    const mark = await request(app).patch(`/notifications/${unread.id}/read`).set("Authorization", `Bearer ${tokenA}`);
    expect(mark.status).toBe(204);

    const after = await request(app).get("/notifications/me").set("Authorization", `Bearer ${tokenA}`);
    expect(after.body.unreadCount).toBe(0);
  });

  it("cannot mark another user's notification read — 404s instead of leaking that it exists", async () => {
    const listB = await request(app).get("/notifications/me").set("Authorization", `Bearer ${tokenB}`);
    const bNotificationId = listB.body.notifications[0].id;

    const res = await request(app).patch(`/notifications/${bNotificationId}/read`).set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });

  it("rejects a non-numeric id as a bad request", async () => {
    const res = await request(app).patch("/notifications/not-a-number/read").set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(400);
  });

  it("the admin-only retry-failed route still works, unaffected by the self-service router being mounted first", async () => {
    const admin = await request(app).post("/notifications/retry-failed").set("Authorization", `Bearer ${adminToken}`);
    expect(admin.status).toBe(200);
    const nonAdmin = await request(app).post("/notifications/retry-failed").set("Authorization", `Bearer ${tokenA}`);
    expect(nonAdmin.status).toBe(403);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/notifications/me")).status).toBe(401);
  });
});
