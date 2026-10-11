import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { TEST_PIN, setTestPin } from "../helpers/signaturePin.js";

let app: ReturnType<typeof createApp>;
const suffix = "closesign";
const userIds: number[] = [];
let operatorToken: string;
let operatorUserId: number;
let managerToken: string;
let managerUserId: number;

async function makeUser(department: string, roleName = "operator") {
  const [user] = await db
    .insert(users)
    .values({ email: `ncr-close-${department}-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  userIds.push(user!.id);
  return { token: signAccessToken({ sub: String(user!.id), roleId: null, roleName, department }), userId: user!.id };
}

async function createNcr(token: string): Promise<number> {
  const res = await request(app).post("/ncr").set("Authorization", `Bearer ${token}`).send({ title: "Closure sign-off test", severity: "high" });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function closeNcr(id: number, token: string) {
  // Advance through workflow to allow close
  const t = `Bearer ${token}`;
  await request(app).post(`/ncr/${id}/containment`).set("Authorization", t).send({ containment: "Held" });
  await request(app).post(`/ncr/${id}/root-cause`).set("Authorization", t).send({ rootCause: "Wear" });
  await request(app).post(`/ncr/${id}/disposition-step`).set("Authorization", t).send({ note: "Scrap" });
  await request(app).post(`/ncr/${id}/corrective-action`).set("Authorization", t).send({ correctiveAction: "Fixed" });
  await request(app).post(`/ncr/${id}/verify`).set("Authorization", t).send({ verification: "OK" });
}

describe("NCR closure sign-off", () => {
  beforeAll(async () => {
    app = createApp();
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const op = await makeUser("quality", "operator");
    operatorToken = op.token;
    operatorUserId = op.userId;
    const mgr = await makeUser("quality", "quality_manager");
    managerToken = mgr.token;
    managerUserId = mgr.userId;
    await setTestPin(operatorUserId);
    await setTestPin(managerUserId);
  });

  afterAll(async () => {
    if (userIds.length) await db.delete(users).where(eq(users.id, userIds[0]!)).catch(() => {});
    await pool.end().catch(() => {});
  });

  it("sign row 0 without ncr.closure_signoff → 403 and audits permission_denied", async () => {
    const id = await createNcr(operatorToken);
    const res = await request(app)
      .post(`/forms/ncr/${id}/sign`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ pin: TEST_PIN, certified: true, path: "closureApprovals.0.signature", description: "QM sign-off" });
    expect(res.status).toBe(403);
    const audits = await db.select().from(auditTrail).where(eq(auditTrail.entityId, id));
    const denied = audits.find((a) => a.action === "permission_denied");
    expect(denied).toBeTruthy();
  });

  it("sign row 0 with ncr.closure_signoff → 200", async () => {
    const id = await createNcr(managerToken);
    const res = await request(app)
      .post(`/forms/ncr/${id}/sign`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ pin: TEST_PIN, certified: true, path: "closureApprovals.0.signature", description: "QM sign-off" });
    expect(res.status).toBe(200);
  });

  it("mark row 0 Not required → 400", async () => {
    const id = await createNcr(managerToken);
    const res = await request(app)
      .post(`/forms/ncr/${id}/mark-not-required`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ pin: TEST_PIN, certified: true, path: "closureApprovals.0.signature", description: "Mark Not required" });
    expect(res.status).toBe(400);
  });

  it("mark a signed row → 400", async () => {
    const id = await createNcr(managerToken);
    // Sign row 1 first
    const signed = await request(app)
      .post(`/forms/ncr/${id}/sign`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ pin: TEST_PIN, certified: true, path: "closureApprovals.1.signature", description: "Row 1 sign" });
    expect(signed.status).toBe(200);
    // Try to mark it Not required
    const res = await request(app)
      .post(`/forms/ncr/${id}/mark-not-required`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ pin: TEST_PIN, certified: true, path: "closureApprovals.1.signature", description: "Mark Not required" });
    expect(res.status).toBe(400);
  });

  it("clear a real signature → 400", async () => {
    const id = await createNcr(managerToken);
    const signed = await request(app)
      .post(`/forms/ncr/${id}/sign`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ pin: TEST_PIN, certified: true, path: "closureApprovals.1.signature", description: "Row 1 sign" });
    expect(signed.status).toBe(200);
    const res = await request(app)
      .post(`/forms/ncr/${id}/clear-not-required`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ pin: TEST_PIN, certified: true, path: "closureApprovals.1.signature", description: "Clear" });
    expect(res.status).toBe(400);
  });

  it("wrong PIN → 400", async () => {
    const id = await createNcr(managerToken);
    const res = await request(app)
      .post(`/forms/ncr/${id}/sign`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ pin: "0000", certified: true, path: "closureApprovals.0.signature", description: "QM sign-off" });
    expect(res.status).toBe(400);
  });

  it("close succeeds with row 0 signed and rows 1-3 marked Not required", async () => {
    const id = await createNcr(managerToken);
    await closeNcr(id, managerToken);
    // Sign row 0
    const signed = await request(app)
      .post(`/forms/ncr/${id}/sign`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ pin: TEST_PIN, certified: true, path: "closureApprovals.0.signature", description: "QM sign-off" });
    expect(signed.status).toBe(200);
    // Mark rows 1-3 Not required
    for (const idx of [1, 2, 3]) {
      const marked = await request(app)
        .post(`/forms/ncr/${id}/mark-not-required`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ pin: TEST_PIN, certified: true, path: `closureApprovals.${idx}.signature`, description: "Mark Not required", reason: "Not applicable" });
      expect(marked.status).toBe(200);
    }
    const closed = await request(app).post(`/ncr/${id}/close`).set("Authorization", `Bearer ${managerToken}`);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
  });

  it("sign/mark/clear after close → 400", async () => {
    const id = await createNcr(managerToken);
    await closeNcr(id, managerToken);
    // Sign row 0 and mark others to allow close
    await request(app).post(`/forms/ncr/${id}/sign`).set("Authorization", `Bearer ${managerToken}`).send({ pin: TEST_PIN, certified: true, path: "closureApprovals.0.signature", description: "QM" });
    for (const idx of [1, 2, 3]) {
      await request(app).post(`/forms/ncr/${id}/mark-not-required`).set("Authorization", `Bearer ${managerToken}`).send({ pin: TEST_PIN, certified: true, path: `closureApprovals.${idx}.signature`, description: "Mark" });
    }
    const closed = await request(app).post(`/ncr/${id}/close`).set("Authorization", `Bearer ${managerToken}`);
    expect(closed.status).toBe(200);

    // Try to sign after close
    const signAfter = await request(app)
      .post(`/forms/ncr/${id}/sign`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ pin: TEST_PIN, certified: true, path: "closureApprovals.1.signature", description: "Late sign" });
    expect(signAfter.status).toBe(400);

    // Try to mark after close
    const markAfter = await request(app)
      .post(`/forms/ncr/${id}/mark-not-required`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ pin: TEST_PIN, certified: true, path: "closureApprovals.2.signature", description: "Late mark" });
    expect(markAfter.status).toBe(400);
  });
});
