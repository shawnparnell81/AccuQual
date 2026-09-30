import { ensureTestCompany } from "../helpers/company.js";
// A signature PIN is stored as a bcrypt hash. A wrong PIN does not stamp the
// form. A correct PIN writes the person's display name and an audit row.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { scarForms } from "../../src/drizzle/schema/scarForms.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();
const PIN = "1357";

let userId: number;
let token: string;
let scarId: number;

describe("signature PIN on a form (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db
      .insert(users)
      .values({ email: `pin-sign-${suffix}@test.local`, passwordHash: "unused", name: "Shawn Parnell", department: "production" })
      .returning();
    userId = user!.id;
    token = signAccessToken({ sub: String(userId), roleId: null, roleName: "operator", department: "production" });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("stores a hash, and the session says the PIN is set without returning it", async () => {
    const set = await request(app).post("/auth/signature-pin").set("Authorization", `Bearer ${token}`).send({ pin: PIN, confirmPin: PIN });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ pinSet: true });
    expect(JSON.stringify(set.body)).not.toContain(PIN);

    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.pinSet).toBe(true);
    expect(me.body.pinHash).toBeUndefined();
    expect(JSON.stringify(me.body)).not.toContain(PIN);

    const [row] = await db.select({ pinHash: users.pinHash }).from(users).where(eq(users.id, userId));
    expect(row?.pinHash).toBeTruthy();
    expect(row!.pinHash).not.toBe(PIN);
    expect(await bcrypt.compare(PIN, row!.pinHash!)).toBe(true);
  });

  it("rejects a wrong PIN and does not stamp the signature", async () => {
    const created = await request(app).post("/scar-forms").set("Authorization", `Bearer ${token}`).send({ scarNumber: `SCAR-PIN-${suffix}`, supplierName: "Acme Metals" });
    expect(created.status).toBe(201);
    scarId = created.body.id;

    const wrong = await request(app).post(`/scar-forms/${scarId}/sign`).set("Authorization", `Bearer ${token}`).send({ field: "supplierRep", pin: "0000", certified: true });
    expect(wrong.status).toBe(401);

    const [row] = await db.select().from(scarForms).where(eq(scarForms.id, scarId));
    expect(row?.supplierRepSignature).toBeNull();
  });

  it("stamps the display name and records who, what, when, and the certification", async () => {
    const signed = await request(app).post(`/scar-forms/${scarId}/sign`).set("Authorization", `Bearer ${token}`).send({ field: "supplierRep", pin: PIN, certified: true });
    expect(signed.status).toBe(200);
    expect(signed.body.supplierRepSignature.startsWith("Shawn Parnell — ")).toBe(true);
    expect(signed.body.supplierRepDate).toBeTruthy();
    expect(JSON.stringify(signed.body)).not.toContain(PIN);

    const audits = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "ScarForm"), eq(auditTrail.entityId, scarId)));
    const stamp = audits.find((row) => (row.changes as { action?: string } | null)?.action === "signature");
    expect(stamp?.performedBy).toBe(userId);
    expect(stamp?.changes).toMatchObject({
      who: "Shawn Parnell",
      what: "supplierRepSignature",
      description: "I certify that this supplier response is accurate.",
    });
    expect(JSON.stringify(stamp?.changes)).not.toContain(PIN);
  });
});
