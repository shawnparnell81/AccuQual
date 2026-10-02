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
let managerToken: string;

async function makeUser(department: string, roleName = "operator") {
  const [user] = await db
    .insert(users)
    .values({ email: `ncr-quar-${department}-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
}

describe("NCR quarantined items", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering");
    managerToken = await makeUser("quality", "quality_manager");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("the setup wizard stays unmounted, and the supplier portal requires a sign-in", async () => {
    expect((await request(app).get("/supplier-portal/scorecard")).status).toBe(401);
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

  it("records with concession or no concession when use as is releases held material", async () => {
    for (const concession of ["with", "none"] as const) {
      const created = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: `Concession ${concession}` });
      expect(created.status).toBe(201);
      const ncrId = created.body.id as number;
      const added = await request(app)
        .post(`/ncr/${ncrId}/quarantine-items`)
        .set("Authorization", `Bearer ${qualityToken}`)
        .send({ partNumber: "PN-UAI", quantity: 1 });
      expect(added.status).toBe(201);

      const released = await request(app).post(`/ncr/${ncrId}/disposition`).set("Authorization", `Bearer ${qualityToken}`).send({ disposition: "use_as_is", concession });
      expect(released.status).toBe(200);
      expect(released.body.disposition).toBe("use_as_is");
      expect(released.body.concession).toBe(concession);
      expect(released.body.items).toHaveLength(1);
      expect(released.body.items[0].disposition).toBe("use_as_is");

      const stillActive = await request(app).get(`/quarantine/items?view=active&ncrId=${ncrId}`).set("Authorization", `Bearer ${qualityToken}`);
      expect(stillActive.body).toEqual([]);

      const audits = await db.select().from(auditTrail).where(eq(auditTrail.entityId, ncrId));
      const change = audits.find((row) => row.entityType === "NCR" && (row.changes as { event?: string } | null)?.event === "ncr_quarantine_released")?.changes as
        | { disposition?: string; concession?: string; dispositionLabel?: string }
        | null;
      expect(change?.disposition).toBe("use_as_is");
      expect(change?.concession).toBe(concession);
      expect(change?.dispositionLabel).toMatch(/concession/);
    }
  });

  async function advanceToFix(ncrId: number) {
    expect((await request(app).post(`/ncr/${ncrId}/containment`).set("Authorization", `Bearer ${qualityToken}`).send({ containment: "Held the parts" })).status).toBe(200);
    expect((await request(app).post(`/ncr/${ncrId}/disposition-step`).set("Authorization", `Bearer ${qualityToken}`).send({ note: "Scrap after the hold is cleared" })).status).toBe(200);
    expect((await request(app).post(`/ncr/${ncrId}/corrective-action`).set("Authorization", `Bearer ${qualityToken}`).send({ correctiveAction: "Replaced the fixture" })).status).toBe(200);
    expect((await request(app).post(`/ncr/${ncrId}/verify`).set("Authorization", `Bearer ${qualityToken}`).send({ verification: "Next lot inspected and accepted" })).status).toBe(200);
  }

  it("keeps an NCR from being released or closed while quarantine disposition is On Hold", async () => {
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: "On hold disposition" });
    expect(created.status).toBe(201);
    const ncrId = created.body.id as number;
    const added = await request(app).post(`/ncr/${ncrId}/quarantine-items`).set("Authorization", `Bearer ${qualityToken}`).send({ partNumber: "PN-HOLD", quantity: 3 });
    expect(added.status).toBe(201);
    const itemId = added.body.id as number;

    const held = await request(app).post(`/ncr/${ncrId}/disposition`).set("Authorization", `Bearer ${qualityToken}`).send({ disposition: "on_hold" });
    expect(held.status).toBe(200);
    expect(held.body.released).toBe(false);
    expect(held.body.disposition).toBe("on_hold");
    expect(held.body.items).toHaveLength(1);
    expect(held.body.items[0].disposition).toBe("on_hold");

    const active = await request(app).get(`/ncr/${ncrId}/quarantine-items`).set("Authorization", `Bearer ${qualityToken}`);
    expect(active.body).toHaveLength(1);
    expect(active.body[0].disposition).toBe("on_hold");
    expect(active.body[0].dispositionLabel).toBe("On Hold");

    const release = await request(app).post(`/ncr/${ncrId}/disposition`).set("Authorization", `Bearer ${qualityToken}`).send({ disposition: "scrap" });
    expect(release.status).toBe(400);
    expect(release.body.message).toMatch(/On Hold/);
    expect(release.body.message).toMatch(/disposition/i);
    expect((await request(app).get(`/quarantine/items?view=active&ncrId=${ncrId}`).set("Authorization", `Bearer ${qualityToken}`)).body).toHaveLength(1);

    const directRelease = await request(app)
      .post(`/quarantine/${itemId}/release`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ disposition: "use_as_is", notes: "Trying to release while On Hold", quantity: 3 });
    expect(directRelease.status).toBe(400);
    expect(directRelease.body.message).toMatch(/On Hold/);

    const directDestroy = await request(app)
      .post(`/quarantine/${itemId}/destroy`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ disposition: "scrapped", notes: "Trying to scrap while On Hold", quantity: 3 });
    expect(directDestroy.status).toBe(400);
    expect(directDestroy.body.message).toMatch(/On Hold/);

    await advanceToFix(ncrId);
    const closed = await request(app).post(`/ncr/${ncrId}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(closed.status).toBe(400);
    expect(closed.body.message).toMatch(/Change the quarantine disposition off On Hold/);

    const patched = await request(app).patch(`/ncr/${ncrId}`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "closed" });
    expect(patched.status).toBe(400);
    expect(patched.body.message).toMatch(/On Hold/);

    const other = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: "Bulk partner" });
    const bulk = await request(app).patch("/ncr/bulk").set("Authorization", `Bearer ${qualityToken}`).send({ ids: [ncrId, other.body.id], patch: { status: "closed" } });
    expect(bulk.status).toBe(400);
    expect(bulk.body.message).toMatch(/On Hold/);
    expect((await request(app).get(`/ncr/${ncrId}`).set("Authorization", `Bearer ${qualityToken}`)).body.status).toBe("verify");
    expect((await request(app).get(`/ncr/${other.body.id}`).set("Authorization", `Bearer ${qualityToken}`)).body.status).toBe("ncr_created");

    const cleared = await request(app).post(`/ncr/${ncrId}/disposition`).set("Authorization", `Bearer ${qualityToken}`).send({ disposition: "scrap", release: false });
    expect(cleared.status).toBe(200);
    expect(cleared.body.released).toBe(false);
    const stillHeld = await request(app).get(`/ncr/${ncrId}/quarantine-items`).set("Authorization", `Bearer ${qualityToken}`);
    expect(stillHeld.body).toHaveLength(1);
    expect(stillHeld.body[0].disposition).toBe("scrap");

    const released = await request(app).post(`/ncr/${ncrId}/disposition`).set("Authorization", `Bearer ${qualityToken}`).send({ disposition: "scrap" });
    expect(released.status).toBe(200);
    expect(released.body.released).toBe(true);
    expect((await request(app).get(`/quarantine/items?view=active&ncrId=${ncrId}`).set("Authorization", `Bearer ${qualityToken}`)).body).toEqual([]);

    const nowClosed = await request(app).post(`/ncr/${ncrId}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(nowClosed.status).toBe(200);
    expect(nowClosed.body.status).toBe("closed");
  });

  it("lets close succeed after disposition leaves On Hold, before the material is released", async () => {
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${qualityToken}`).send({ title: "Close after leaving hold" });
    const ncrId = created.body.id as number;
    expect((await request(app).post(`/ncr/${ncrId}/quarantine-items`).set("Authorization", `Bearer ${qualityToken}`).send({ partNumber: "PN-LATER", quantity: 1 })).status).toBe(201);
    expect((await request(app).post(`/ncr/${ncrId}/disposition`).set("Authorization", `Bearer ${qualityToken}`).send({ disposition: "on_hold", release: false })).status).toBe(200);
    await advanceToFix(ncrId);
    expect((await request(app).post(`/ncr/${ncrId}/close`).set("Authorization", `Bearer ${qualityToken}`)).status).toBe(400);

    expect((await request(app).post(`/ncr/${ncrId}/disposition`).set("Authorization", `Bearer ${qualityToken}`).send({ disposition: "rework", release: false })).status).toBe(200);
    const closed = await request(app).post(`/ncr/${ncrId}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect((await request(app).get(`/quarantine/items?view=active&ncrId=${ncrId}`).set("Authorization", `Bearer ${qualityToken}`)).body).toHaveLength(1);
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
