import { ensureTestCompany } from "../helpers/company.js";
// Deletes a user-created record, writes a snapshot to the audit trail, and removes its files.
import { access } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { attachments } from "../../src/drizzle/schema/attachments.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { eightD } from "../../src/drizzle/schema/eightD.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { quarantineRecords } from "../../src/drizzle/schema/quarantine.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

let creator: { id: number; token: string };
let otherQuality: { id: number; token: string };
let production: { id: number; token: string };
let qualityManager: { id: number; token: string };
let admin: { id: number; token: string };

async function makeUser(roleName: string, department: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `record-delete-${roleName}-${department}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  return { id: user!.id, token: signAccessToken({ sub: String(user!.id), roleId: null, roleName, department }) };
}

describe("record delete", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    creator = await makeUser("operator", "quality");
    otherQuality = await makeUser("operator", "quality");
    production = await makeUser("operator", "production");
    qualityManager = await makeUser("quality_manager", "quality");
    admin = await makeUser("admin", "quality");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("refuses a low role that did not create the record, and a department with no access", async () => {
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${creator.token}`).send({ title: "Keep me" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const other = await request(app).delete(`/ncr/${id}`).set("Authorization", `Bearer ${otherQuality.token}`);
    expect(other.status).toBe(403);

    const blocked = await request(app).delete(`/ncr/${id}`).set("Authorization", `Bearer ${production.token}`);
    expect(blocked.status).toBe(403);

    const stillThere = await request(app).get(`/ncr/${id}`).set("Authorization", `Bearer ${creator.token}`);
    expect(stillThere.status).toBe(200);
  });

  it("lets the record owner delete their own NCR", async () => {
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${creator.token}`).send({ title: "Mine to delete" });
    expect(created.status).toBe(201);
    const res = await request(app).delete(`/ncr/${created.body.id}`).set("Authorization", `Bearer ${creator.token}`);
    expect(res.status).toBe(204);
  });

  it("deletes an NCR, writes a snapshot, removes the file, and leaves linked records in place", async () => {
    const title = `Bent flange ${suffix}`;
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${creator.token}`).send({ title });
    expect(created.status).toBe(201);
    const ncrId = created.body.id as number;

    const kept = await request(app).post("/ncr").set("Authorization", `Bearer ${creator.token}`).send({ title: "Leave this NCR" });
    expect(kept.status).toBe(201);

    const uploaded = await request(app)
      .post("/attachments")
      .set("Authorization", `Bearer ${creator.token}`)
      .field("entityType", "ncr")
      .field("entityId", String(ncrId))
      .attach("file", PNG, "bent-flange.png");
    expect(uploaded.status).toBe(201);
    const filePath = uploaded.body.filePath as string;
    expect(filePath).toBeTruthy();
    await access(filePath);

    const report = await request(app).post("/8d").set("Authorization", `Bearer ${creator.token}`).send({ ncrId });
    expect(report.status).toBe(201);
    const eightDId = report.body.id as number;

    const held = await request(app)
      .post(`/ncr/${ncrId}/quarantine-items`)
      .set("Authorization", `Bearer ${creator.token}`)
      .send({ partNumber: "PN-DEL", quantity: 2 });
    expect(held.status).toBe(201);
    const sourcedId = held.body.id as number;

    const [linkedOnly] = await db
      .insert(quarantineRecords)
      .values({
        itemType: "other",
        itemLabel: "Held elsewhere",
        quantity: "1",
        originalQuantity: "1",
        reason: "Not opened from this NCR",
        sourceType: "manual",
        ncrId,
        createdBy: creator.id,
      })
      .returning();

    const removed = await request(app).delete(`/ncr/${ncrId}`).set("Authorization", `Bearer ${qualityManager.token}`);
    expect(removed.status).toBe(204);

    const gone = await request(app).get(`/ncr/${ncrId}`).set("Authorization", `Bearer ${qualityManager.token}`);
    expect(gone.status).toBe(404);
    const survivor = await request(app).get(`/ncr/${kept.body.id}`).set("Authorization", `Bearer ${creator.token}`);
    expect(survivor.status).toBe(200);

    const [fileRow] = await db.select().from(attachments).where(eq(attachments.id, uploaded.body.id));
    expect(fileRow).toBeUndefined();
    await expect(access(filePath)).rejects.toThrow();

    const [reportRow] = await db.select().from(eightD).where(eq(eightD.id, eightDId));
    expect(reportRow).toBeTruthy();
    expect(reportRow!.ncrId).toBeNull();

    const [sourced] = await db.select().from(quarantineRecords).where(eq(quarantineRecords.id, sourcedId));
    expect(sourced).toBeUndefined();
    const [keptHold] = await db.select().from(quarantineRecords).where(eq(quarantineRecords.id, linkedOnly!.id));
    expect(keptHold).toBeTruthy();
    expect(keptHold!.ncrId).toBeNull();

    const [entry] = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "NCR"), eq(auditTrail.entityId, ncrId), eq(auditTrail.action, "delete")));
    expect(entry).toBeTruthy();
    expect(entry!.performedBy).toBe(qualityManager.id);
    expect(entry!.createdAt).toBeTruthy();
    const changes = entry!.changes as { summary: string; title: string; recordNumber: string; snapshot: { title: string }; attachmentFileNames: string[] };
    expect(changes.summary).toBe(`Deleted NCR #${ncrId} "${title}"`);
    expect(changes.title).toBe(title);
    expect(changes.recordNumber).toBe(String(ncrId));
    expect(changes.snapshot.title).toBe(title);
    expect(changes.attachmentFileNames).toEqual(["bent-flange.png"]);

    await db.insert(auditTrail).values({
      entityType: "User",
      entityId: admin.id,
      action: "status_change",
      changes: { action: "password_changed" },
      performedBy: admin.id,
    });

    const managerLog = await request(app).get("/audit-trail").set("Authorization", `Bearer ${qualityManager.token}`);
    expect(managerLog.status).toBe(200);
    const managerRows = managerLog.body as { entityType: string; entityId: number; changes?: { summary?: string; action?: string } }[];
    expect(managerRows.some((row) => row.changes?.summary === changes.summary)).toBe(true);
    expect(managerRows.some((row) => row.entityType === "User" && row.entityId === admin.id)).toBe(false);

    const creatorLog = await request(app).get("/audit-trail").set("Authorization", `Bearer ${creator.token}`);
    expect(creatorLog.status).toBe(200);
    expect((creatorLog.body as { changes?: { summary?: string } }[]).some((row) => row.changes?.summary === changes.summary)).toBe(true);

    const productionLog = await request(app).get("/audit-trail").set("Authorization", `Bearer ${production.token}`);
    expect(productionLog.status).toBe(200);
    expect((productionLog.body as { changes?: { summary?: string } }[]).some((row) => row.changes?.summary === changes.summary)).toBe(false);

    const log = await request(app).get("/audit-trail").set("Authorization", `Bearer ${admin.token}`);
    expect(log.status).toBe(200);
    const adminRows = log.body as { entityType: string; entityId: number; changes?: { summary?: string; action?: string } }[];
    expect(adminRows.some((row) => row.changes?.summary === changes.summary)).toBe(true);
    expect(adminRows.some((row) => row.entityType === "User" && row.entityId === admin.id && row.changes?.action === "password_changed")).toBe(true);

    const [still] = await db.select({ id: ncr.id }).from(ncr).where(eq(ncr.id, kept.body.id));
    expect(still).toBeTruthy();
  });

  it("deletes a validation report and names the part number in the audit line", async () => {
    const created = await request(app)
      .post("/validation-reports")
      .set("Authorization", `Bearer ${creator.token}`)
      .send({ data: { cells: { B6: "CSA-VAL-9" } } });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const denied = await request(app).delete(`/validation-reports/${id}`).set("Authorization", `Bearer ${creator.token}`);
    expect(denied.status).toBe(403);

    const removed = await request(app).delete(`/validation-reports/${id}`).set("Authorization", `Bearer ${qualityManager.token}`);
    expect(removed.status).toBe(204);

    const [entry] = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "Validation Report"), eq(auditTrail.entityId, id), eq(auditTrail.action, "delete")));
    expect(entry!.performedBy).toBe(qualityManager.id);
    expect((entry!.changes as { summary: string; attachmentFileNames: string[] }).summary).toBe(`Deleted CSA VALIDATION REPORT #${id} "CSA-VAL-9"`);
    expect((entry!.changes as { attachmentFileNames: string[] }).attachmentFileNames).toEqual([]);
  });

  it("deletes a fuel pump validation and names it in the audit line", async () => {
    const created = await request(app)
      .post("/validation-reports")
      .set("Authorization", `Bearer ${creator.token}`)
      .send({ data: { formType: "fuel_pump", cells: { B6: "FP-200" } } });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const removed = await request(app).delete(`/validation-reports/${id}`).set("Authorization", `Bearer ${qualityManager.token}`);
    expect(removed.status).toBe(204);

    const [entry] = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "Validation Report"), eq(auditTrail.entityId, id), eq(auditTrail.action, "delete")));
    expect((entry!.changes as { summary: string }).summary).toBe(`Deleted FUEL PUMP VALIDATION DOCUMENT #${id} "FP-200"`);

    const csa = await request(app).post("/validation-reports").set("Authorization", `Bearer ${creator.token}`).send({ data: { formType: "csa", cells: { B6: "CSA-KEEP" } } });
    expect(csa.status).toBe(201);
    const still = await request(app).get(`/validation-reports/${csa.body.id}`).set("Authorization", `Bearer ${creator.token}`);
    expect(still.status).toBe(200);
    expect(still.body.data.formType).toBe("csa");
  });
});
