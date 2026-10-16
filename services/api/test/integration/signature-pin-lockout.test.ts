import { ensureTestCompany } from "../helpers/company.js";
// Each wrong signature PIN counts once, the fifth in a row locks signing, a correct PIN resets the count,
// the lock is in the audit trail, and only an administrator can unlock it from the users screen.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();
const PIN = "2468";
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let signerId: number;
let signerToken: string;
let adminToken: string;
let otherToken: string;
let scarId: number;

async function ensureRole(name: string): Promise<number> {
  const [existing] = await db.select().from(roles).where(eq(roles.name, name));
  if (existing) return existing.id;
  const [created] = await db.insert(roles).values({ name }).onConflictDoNothing().returning();
  return created ? created.id : (await db.select().from(roles).where(eq(roles.name, name)))[0]!.id;
}

async function count(): Promise<number> {
  const [row] = await db.select({ c: users.pinFailedCount }).from(users).where(eq(users.id, signerId));
  return row!.c;
}

const sign = (pin: string) =>
  request(app).post(`/scar-forms/${scarId}/sign`).set(bearer(signerToken)).send({ field: "supplierRep", pin, certified: true });

describe("signature PIN lockout", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const adminRoleId = await ensureRole("admin");
    const [signer] = await db
      .insert(users)
      .values({ email: `pin-lock-${suffix}@test.local`, passwordHash: "unused", name: "Pin Signer", department: "production", pinHash: await bcrypt.hash(PIN, 4) })
      .returning();
    const [admin] = await db
      .insert(users)
      .values({ email: `pin-lock-admin-${suffix}@test.local`, passwordHash: "unused", name: "Lock Admin", roleId: adminRoleId })
      .returning();
    const [other] = await db
      .insert(users)
      .values({ email: `pin-lock-other-${suffix}@test.local`, passwordHash: "unused", name: "Other Operator", department: "production", pinHash: await bcrypt.hash(PIN, 4) })
      .returning();
    signerId = signer!.id;
    signerToken = signAccessToken({ sub: String(signerId), roleId: null, roleName: "operator", department: "production" });
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: adminRoleId, roleName: "admin", department: null });
    otherToken = signAccessToken({ sub: String(other!.id), roleId: null, roleName: "operator", department: "production" });
    const created = await request(app).post("/scar-forms").set(bearer(signerToken)).send({ scarNumber: `SCAR-LOCK-${suffix}`, supplierName: "Acme Metals" });
    expect(created.status).toBe(201);
    scarId = created.body.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("answers a wrong PIN with 403, not 401, so the browser does not renew the session and send it again", async () => {
    const wrong = await sign("1111");
    expect(wrong.status).toBe(403);
    expect(wrong.body.message).toMatch(/not correct\. 4 tries left/);
    expect(await count()).toBe(1);
  });

  it("counts a double submit, a repeat, and two overlapping checks of the same wrong PIN once", async () => {
    const [a, b] = await Promise.all([sign("2222"), sign("2222")]);
    expect([a.status, b.status]).toEqual([403, 403]);
    expect(await count()).toBe(2);
    expect((await sign("2222")).status).toBe(403);
    expect(await count()).toBe(2);
  });

  it("a correct PIN resets the count", async () => {
    // Another person's correct PIN does not touch this person's count.
    expect(await count()).toBe(2);
    const fine = await request(app).post("/auth/signature-pin/change").set(bearer(otherToken)).send({ currentPin: PIN, pin: "1212", confirmPin: "1212" });
    expect(fine.status).toBe(200);
    expect(await count()).toBe(2);
    await db.update(users).set({ pinFailedCount: 2 }).where(eq(users.id, signerId));
    const change = await request(app).post("/auth/signature-pin/change").set(bearer(signerToken)).send({ currentPin: PIN, pin: PIN, confirmPin: PIN });
    expect(change.status).toBe(400); // same PIN refused before any check
    const ok = await request(app).post("/auth/signature-pin/change").set(bearer(signerToken)).send({ currentPin: PIN, pin: "8642", confirmPin: "8642" });
    expect(ok.status).toBe(200);
    expect(await count()).toBe(0);
    await db.update(users).set({ pinHash: await bcrypt.hash(PIN, 4) }).where(eq(users.id, signerId));
  });

  it("locks on the fifth wrong PIN in a row, refuses even the right PIN, and writes who/what/when/description", async () => {
    for (const [i, pin] of ["3331", "3332", "3333", "3334"].entries()) {
      const res = await sign(pin);
      expect(res.status).toBe(403);
      expect(await count()).toBe(i + 1);
    }
    const fifth = await sign("3335");
    expect(fifth.status).toBe(423);
    expect(fifth.body.message).toMatch(/locked after 5 incorrect tries/);
    expect(await count()).toBe(5);

    const right = await sign(PIN);
    expect(right.status).toBe(423);
    expect(await count()).toBe(5);

    const audits = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "User"), eq(auditTrail.entityId, signerId)));
    const locks = audits.filter((row) => (row.changes as { action?: string } | null)?.action === "signature_pin_locked");
    expect(locks).toHaveLength(1);
    expect(locks[0]!.changes).toMatchObject({ who: "Pin Signer", what: "Signature PIN" });
    expect((locks[0]!.changes as { when: string }).when).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((locks[0]!.changes as { description: string }).description).toMatch(/5 incorrect PINs/);
    expect(JSON.stringify(locks[0]!.changes)).not.toContain(PIN);
  });

  it("shows the lock to an administrator only, and a non-administrator cannot unlock", async () => {
    const list = await request(app).get("/users").set(bearer(adminToken));
    expect(list.status).toBe(200);
    const row = (list.body as { id: number; pinLocked?: boolean; pinFailedCount?: number }[]).find((u) => u.id === signerId);
    expect(row?.pinLocked).toBe(true);
    expect(row?.pinFailedCount).toBeUndefined();

    const asOperator = await request(app).get("/users").set(bearer(otherToken));
    if (asOperator.status === 200) {
      const seen = (asOperator.body as { id: number; pinLocked?: boolean }[]).find((u) => u.id === signerId);
      expect(seen?.pinLocked).toBeUndefined();
    }
    const denied = await request(app).post(`/users/${signerId}/unlock`).set(bearer(otherToken));
    expect(denied.status).toBe(403);
    expect(await count()).toBe(5);
  });

  it("an administrator unlocks it from the users screen, the unlock is audited, and signing works again", async () => {
    const unlock = await request(app).post(`/users/${signerId}/unlock`).set(bearer(adminToken));
    expect(unlock.status).toBe(204);
    expect(await count()).toBe(0);
    const audits = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "User"), eq(auditTrail.entityId, signerId)));
    const unlocked = audits.find((r) => (r.changes as { action?: string } | null)?.action === "account_unlocked");
    expect(unlocked?.changes).toMatchObject({ pinUnlocked: true, who: "Lock Admin" });
    expect((unlocked!.changes as { description: string }).description).toMatch(/unlocked the signature PIN for Pin Signer/);

    const signed = await sign(PIN);
    expect(signed.status).toBe(200);
    expect(signed.body.supplierRepSignature.startsWith("Pin Signer — ")).toBe(true);
  });
});
