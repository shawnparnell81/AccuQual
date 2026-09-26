import { ensureTestCompany } from "../helpers/company.js";
// Quarantined items are opened from an NCR and leave the active list when that NCR's disposition is completed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;

async function makeUser(department: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `ncr-quar-${department}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

describe("NCR quarantined items", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("the supplier portal and the setup wizard are no longer mounted", async () => {
    expect((await request(app).get("/supplier-portal/scorecard")).status).toBe(404);
    expect((await request(app).get("/onboarding/progress")).status).toBe(404);
  });

  it("engineering cannot add a quarantined item to an NCR", async () => {
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: "Blocked quarantine" });
    expect(created.status).toBe(201);
    const res = await request(app)
      .post(`/ncr/${created.body.id}/quarantine-items`)
      .set("Authorization", `Bearer ${engineeringToken}`)
      .send({ partNumber: "PN-1", quantity: 1 });
    expect(res.status).toBe(403);
  });

  it("adds items from the NCR, lists them as active, then releases them when disposition is completed", async () => {
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: "Quarantine from NCR", severity: "high" });
    expect(created.status).toBe(201);
    const ncrId = created.body.id as number;

    const withSerial = await request(app)
      .post(`/ncr/${ncrId}/quarantine-items`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ partNumber: "PN-100", quantity: 4, serialNumber: "SN-9" });
    expect(withSerial.status).toBe(201);
    expect(withSerial.body.partNumber).toBe("PN-100");
    expect(withSerial.body.serialNumber).toBe("SN-9");
    expect(withSerial.body.ncrId).toBe(ncrId);
    expect(withSerial.body.quarantinedAt).toBeTruthy();

    const plain = await request(app)
      .post(`/ncr/${ncrId}/quarantine-items`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ partNumber: "PN-200", quantity: 2 });
    expect(plain.status).toBe(201);
    expect(plain.body.serialNumber).toBeNull();

    const active = await request(app).get("/quarantine/items?view=active").set("Authorization", `Bearer ${qualityToken}`);
    expect(active.status).toBe(200);
    const activeIds = (active.body as { ncrId: number; partNumber: string }[]).filter((row) => row.ncrId === ncrId).map((row) => row.partNumber);
    expect(activeIds.sort()).toEqual(["PN-100", "PN-200"]);

    const releasedEarly = await request(app).post(`/ncr/${ncrId}/disposition`).set("Authorization", `Bearer ${qualityToken}`).send({ disposition: "scrap" });
    expect(releasedEarly.status).toBe(200);
    expect(releasedEarly.body.items).toHaveLength(2);

    const stillActive = await request(app).get(`/quarantine/items?view=active&ncrId=${ncrId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(stillActive.body).toEqual([]);

    const history = await request(app).get(`/quarantine/items?view=released&ncrId=${ncrId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(2);
    for (const row of history.body as { disposition: string; releasedAt: string; quantity: string; ncrId: number }[]) {
      expect(row.disposition).toBe("scrapped");
      expect(row.releasedAt).toBeTruthy();
      expect(row.ncrId).toBe(ncrId);
      expect(Number(row.quantity)).toBeGreaterThan(0);
    }

    const again = await request(app).post(`/ncr/${ncrId}/disposition`).set("Authorization", `Bearer ${qualityToken}`).send({ disposition: "use_as_is" });
    expect(again.status).toBe(400);

    const audits = await db.select().from(auditTrail).where(eq(auditTrail.entityId, ncrId));
    expect(audits.some((row) => row.entityType === "NCR" && (row.changes as { event?: string } | null)?.event === "ncr_quarantine_released")).toBe(true);
    const itemAudits = await db.select().from(auditTrail).where(eq(auditTrail.entityId, withSerial.body.id as number));
    expect(itemAudits.some((row) => row.entityType === "Quarantine" && row.action === "create")).toBe(true);
    expect(itemAudits.some((row) => row.entityType === "Quarantine" && row.action === "status_change")).toBe(true);
  });

  it("refuses a quarantined item with no part number or a zero quantity", async () => {
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: "Bad item" });
    const blank = await request(app)
      .post(`/ncr/${created.body.id}/quarantine-items`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ partNumber: "  ", quantity: 1 });
    expect(blank.status).toBe(400);
    const zero = await request(app)
      .post(`/ncr/${created.body.id}/quarantine-items`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ partNumber: "PN-0", quantity: 0 });
    expect(zero.status).toBe(400);
  });
});
