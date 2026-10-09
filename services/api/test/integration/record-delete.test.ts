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
import { quarantineRecords, quarantineResolutions } from "../../src/drizzle/schema/quarantine.js";
import { csaFaiRecords } from "../../src/drizzle/schema/csaFai.js";
import { fuelPumpFaiRecords } from "../../src/drizzle/schema/fuelPumpFai.js";
import { faiInspectionPlans, faiPlanRevisions, faiRecords } from "../../src/drizzle/schema/faiSourceControl.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { pdfExports } from "../../src/drizzle/schema/pdfExports.js";
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

  it("refuses a department without the NCR grant, and allows one that has it", async () => {
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${creator.token}`).send({ title: "Keep me" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const blocked = await request(app).delete(`/ncr/${id}`).set("Authorization", `Bearer ${production.token}`);
    expect(blocked.status).toBe(403);

    const stillThere = await request(app).get(`/ncr/${id}`).set("Authorization", `Bearer ${creator.token}`);
    expect(stillThere.status).toBe(200);

    const other = await request(app).delete(`/ncr/${id}`).set("Authorization", `Bearer ${otherQuality.token}`);
    expect(other.status).toBe(204);
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
    expect(changes.summary).toBe(`Deleted NCR "${title}"`);
    expect(changes.title).toBe(title);
    expect(changes.recordNumber).toBe("");
    expect(changes.recordNumber).not.toBe(String(ncrId));
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

    const denied = await request(app).delete(`/validation-reports/${id}`).set("Authorization", `Bearer ${production.token}`);
    expect(denied.status).toBe(403);

    const removed = await request(app).delete(`/validation-reports/${id}`).set("Authorization", `Bearer ${qualityManager.token}`);
    expect(removed.status).toBe(204);

    const [entry] = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "Validation Report"), eq(auditTrail.entityId, id), eq(auditTrail.action, "delete")));
    expect(entry!.performedBy).toBe(qualityManager.id);
    expect((entry!.changes as { summary: string; attachmentFileNames: string[] }).summary).toBe(`Deleted CSA VALIDATION REPORT "CSA-VAL-9"`);
    expect((entry!.changes as { recordNumber: string }).recordNumber).not.toBe(String(id));
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
    expect((entry!.changes as { summary: string }).summary).toBe(`Deleted FUEL PUMP VALIDATION DOCUMENT "FP-200"`);
    expect((entry!.changes as { recordNumber: string }).recordNumber).not.toBe(String(id));

    const csa = await request(app).post("/validation-reports").set("Authorization", `Bearer ${creator.token}`).send({ data: { formType: "csa", cells: { B6: "CSA-KEEP" } } });
    expect(csa.status).toBe(201);
    const still = await request(app).get(`/validation-reports/${csa.body.id}`).set("Authorization", `Bearer ${creator.token}`);
    expect(still.status).toBe(200);
    expect(still.body.data.formType).toBe("csa");
  });

  it("deletes an NCR after its quarantine items have a decision, and keeps that decision", async () => {
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${creator.token}`).send({ title: `Dispositioned ${suffix}` });
    expect(created.status).toBe(201);
    const ncrId = created.body.id as number;

    const held = await request(app)
      .post(`/ncr/${ncrId}/quarantine-items`)
      .set("Authorization", `Bearer ${creator.token}`)
      .send({ partNumber: "PN-DECIDED", quantity: 1 });
    expect(held.status).toBe(201);
    const quarantineId = held.body.id as number;

    const disposition = await request(app).post(`/ncr/${ncrId}/disposition`).set("Authorization", `Bearer ${creator.token}`).send({ disposition: "scrap" });
    expect(disposition.status).toBe(200);

    const [decisionBefore] = await db.select().from(quarantineResolutions).where(eq(quarantineResolutions.quarantineId, quarantineId));
    expect(decisionBefore).toBeTruthy();

    await db.insert(pdfExports).values({
      exportId: `exp_${suffix}-ncr-${ncrId}`,
      sourceModule: "ncr",
      entityType: "ncr",
      entityId: ncrId,
      sha256: "abc",
      fileSize: 4,
      renderer: "test",
      filePath: `/tmp/ncr-${ncrId}-export.pdf`,
      generatedAt: new Date(),
    });

    const removed = await request(app).delete(`/ncr/${ncrId}`).set("Authorization", `Bearer ${qualityManager.token}`);
    expect(removed.status).toBe(204);

    const gone = await request(app).get(`/ncr/${ncrId}`).set("Authorization", `Bearer ${qualityManager.token}`);
    expect(gone.status).toBe(404);

    const [keptHold] = await db.select().from(quarantineRecords).where(eq(quarantineRecords.id, quarantineId));
    expect(keptHold).toBeTruthy();
    expect(keptHold!.ncrId).toBeNull();
    const [decision] = await db.select().from(quarantineResolutions).where(eq(quarantineResolutions.quarantineId, quarantineId));
    expect(decision).toBeTruthy();
    expect(decision!.id).toBe(decisionBefore!.id);

    const exportsLeft = await db.select().from(pdfExports).where(and(eq(pdfExports.entityType, "ncr"), eq(pdfExports.entityId, ncrId)));
    expect(exportsLeft).toEqual([]);
  });

  it("clears first-article links and still deletes the NCR", async () => {
    const created = await request(app).post("/ncr").set("Authorization", `Bearer ${creator.token}`).send({ title: `Linked FAI ${suffix}` });
    expect(created.status).toBe(201);
    const ncrId = created.body.id as number;
    const opened = new Date();

    const [csa] = await db
      .insert(csaFaiRecords)
      .values({
        number: `CSA-${suffix}-${ncrId}`,
        partNumber: "CSA-1",
        partDescription: "Strut",
        supplierName: "Titan",
        supplierPartNumber: "T-1",
        sampleLotNumber: "L1",
        vehicleYear: "2026",
        vehicleMake: "Acme",
        vehicleModel: "Line",
        position: "FL",
        inspectorName: "Shawn",
        dateOpened: opened,
        status: "open",
        stage: "open",
        productFamily: "strut",
        packet: {},
        ncrId,
      })
      .returning();

    const [pump] = await db
      .insert(fuelPumpFaiRecords)
      .values({
        faiNumber: `FP-${suffix}-${ncrId}`,
        partNumber: "FP-1",
        supplier: "Titan",
        sampleLotNumber: "L2",
        application: "pump",
        inspector: "Shawn",
        dateOpened: opened,
        status: "open",
        workflowStage: "open",
        packet: {},
        linkedNcr: ncrId,
      })
      .returning();

    const [supplier] = await db.insert(suppliers).values({ name: `FAI supplier ${suffix}-${ncrId}` }).returning();
    const [plan] = await db.insert(faiInspectionPlans).values({ name: `Plan ${suffix}-${ncrId}`, scope: "part", partNumber: "FAI-1" }).returning();
    const [revision] = await db
      .insert(faiPlanRevisions)
      .values({ planId: plan!.id, revision: 1, cadenceMonths: 6, scope: "part", partNumber: "FAI-1" })
      .returning();
    const [fai] = await db
      .insert(faiRecords)
      .values({
        number: `FAI-${suffix}-${ncrId}`,
        planId: plan!.id,
        revisionId: revision!.id,
        planRevision: 1,
        partNumber: "FAI-1",
        supplierId: supplier!.id,
        supplierName: supplier!.name,
        ncrId,
      })
      .returning();

    const removed = await request(app).delete(`/ncr/${ncrId}`).set("Authorization", `Bearer ${qualityManager.token}`);
    expect(removed.status).toBe(204);

    const [csaRow] = await db.select().from(csaFaiRecords).where(eq(csaFaiRecords.id, csa!.id));
    expect(csaRow!.ncrId).toBeNull();
    const [pumpRow] = await db.select().from(fuelPumpFaiRecords).where(eq(fuelPumpFaiRecords.id, pump!.id));
    expect(pumpRow!.linkedNcr).toBeNull();
    const [faiRow] = await db.select().from(faiRecords).where(eq(faiRecords.id, fai!.id));
    expect(faiRow!.ncrId).toBeNull();
  });

  it("refuses to delete a quarantine record that already has a decision", async () => {
    const [hold] = await db
      .insert(quarantineRecords)
      .values({
        itemType: "other",
        itemLabel: "Decided hold",
        quantity: "0",
        originalQuantity: "1",
        reason: "Already decided",
        status: "released",
        createdBy: creator.id,
      })
      .returning();
    await db.insert(quarantineResolutions).values({
      quarantineId: hold!.id,
      action: "release",
      disposition: "use_as_is",
      quantity: "1",
      notes: "Released after inspection",
      resolvedBy: qualityManager.id,
    });

    const removed = await request(app).delete(`/quarantine/${hold!.id}`).set("Authorization", `Bearer ${qualityManager.token}`);
    expect(removed.status).toBe(409);
    expect(removed.body.message).toMatch(/decision on file/i);
    expect(removed.body.message).not.toMatch(/unexpected error/i);

    const [still] = await db.select().from(quarantineRecords).where(eq(quarantineRecords.id, hold!.id));
    expect(still).toBeTruthy();
    const [decision] = await db.select().from(quarantineResolutions).where(eq(quarantineResolutions.quarantineId, hold!.id));
    expect(decision).toBeTruthy();
  });
});
