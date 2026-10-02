import { ensureTestCompany } from "../helpers/company.js";
import { setTestPin, TEST_PIN } from "../helpers/signaturePin.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { company } from "../../src/drizzle/schema/company.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { defaultEcrLabels } from "../../src/modules/change-requests/ecrTemplate.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

let qualityToken: string;
let engineeringToken: string;
let productionToken: string;
let managerToken: string;
let managerId: number;
let engineerId: number;

describe("engineering change request", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [quality] = await db.insert(users).values({ email: `ecr-q-${suffix}@test.local`, passwordHash: "unused", name: "Quality Staff" }).returning();
    const [engineering] = await db.insert(users).values({ email: `ecr-e-${suffix}@test.local`, passwordHash: "unused", name: "Erin Engineer" }).returning();
    const [production] = await db.insert(users).values({ email: `ecr-p-${suffix}@test.local`, passwordHash: "unused", name: "Pat Production" }).returning();
    const [manager] = await db.insert(users).values({ email: `ecr-m-${suffix}@test.local`, passwordHash: "unused", name: "Quinn Manager" }).returning();
    engineerId = engineering!.id;
    managerId = manager!.id;
    await setTestPin(engineerId);
    await setTestPin(managerId);
    qualityToken = signAccessToken({ sub: String(quality!.id), roleId: null, roleName: "operator", department: "quality" });
    engineeringToken = signAccessToken({ sub: String(engineering!.id), roleId: null, roleName: "Engineer", department: "engineering" });
    productionToken = signAccessToken({ sub: String(production!.id), roleId: null, roleName: "operator", department: "production" });
    managerToken = signAccessToken({ sub: String(manager!.id), roleId: null, roleName: "quality_manager", department: "quality" });
  });

  it("walks request, both reviews, approval, implementation, and close, and records the audit", async () => {
    const denied = await request(app).post("/iso-quality-forms").set("Authorization", `Bearer ${productionToken}`).send({ formType: "engineering_change", data: { cells: {} } });
    expect(denied.status).toBe(403);

    const created = await request(app).post("/iso-quality-forms").set("Authorization", `Bearer ${qualityToken}`).send({ formType: "engineering_change", data: { cells: { D5: "Shawn Parnell", B6: "123" } } });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    expect(created.body.data.workflow.status).toBe("request");
    expect(created.body.data._formTemplate.revision).toBe("B");

    const opened = await request(app).get(`/iso-quality-forms/${id}`).set("Authorization", `Bearer ${productionToken}`);
    expect(opened.status).toBe(200);

    const view = await request(app).get(`/iso-quality-forms/${id}/workflow`).set("Authorization", `Bearer ${qualityToken}`);
    expect(view.status).toBe(200);
    expect(view.body.actions).toEqual(["submit"]);
    expect(view.body.revision).toBe("B");

    const wrongReview = await request(app).post(`/iso-quality-forms/${id}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ action: "engineering_review" });
    expect(wrongReview.status).toBe(403);

    const submitted = await request(app).post(`/iso-quality-forms/${id}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ action: "submit" });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.workflow.status).toBe("review");
    expect(submitted.body.data.templateLabels.partNumbers).toBe("Part Number(s) Affected:");

    const engineeringReview = await request(app).post(`/iso-quality-forms/${id}/transition`).set("Authorization", `Bearer ${engineeringToken}`).send({ action: "engineering_review" });
    expect(engineeringReview.status).toBe(200);
    const qualityReview = await request(app).post(`/iso-quality-forms/${id}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ action: "quality_review" });
    expect(qualityReview.status).toBe(200);

    const early = await request(app).post(`/iso-quality-forms/${id}/transition`).set("Authorization", `Bearer ${managerToken}`).send({ action: "approve" });
    expect(early.status).toBe(403);

    const staffSign = await request(app).post(`/iso-quality-forms/${id}/sign`).set("Authorization", `Bearer ${qualityToken}`).send({ field: "managerSignature", pin: TEST_PIN, certified: true });
    expect(staffSign.status).toBe(403);
    const signed = await request(app).post(`/iso-quality-forms/${id}/sign`).set("Authorization", `Bearer ${managerToken}`).send({ field: "managerSignature", pin: TEST_PIN, certified: true });
    expect(signed.status).toBe(200);
    expect(signed.body.data.managerSignature).toContain("Quinn Manager");

    const approved = await request(app).post(`/iso-quality-forms/${id}/transition`).set("Authorization", `Bearer ${managerToken}`).send({ action: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.data.workflow.status).toBe("approved");

    const frozen = await request(app).patch(`/iso-quality-forms/${id}`).set("Authorization", `Bearer ${qualityToken}`).send({ data: { cells: { B6: "999", D5: "Shawn Parnell" } } });
    expect(frozen.status).toBe(400);

    const started = await request(app).post(`/iso-quality-forms/${id}/transition`).set("Authorization", `Bearer ${engineeringToken}`).send({ action: "implement" });
    expect(started.status).toBe(200);
    const verified = await request(app).patch(`/iso-quality-forms/${id}`).set("Authorization", `Bearer ${engineeringToken}`).send({ data: { cells: { B6: "123", D5: "Shawn Parnell", B31: "YES" } } });
    expect(verified.status).toBe(200);
    const closed = await request(app).post(`/iso-quality-forms/${id}/transition`).set("Authorization", `Bearer ${managerToken}`).send({ action: "close" });
    expect(closed.status).toBe(200);
    expect(closed.body.data.workflow.status).toBe("closed");

    const history = await request(app).get(`/workflow/history/iso_forms/${id}`).set("Authorization", `Bearer ${productionToken}`);
    expect(history.status).toBe(200);
    const summaries = history.body.map((row: { changes?: { summary?: string } }) => row.changes?.summary);
    expect(summaries).toContain("Submitted the engineering change request for review.");
    expect(summaries).toContain("Approved the engineering change request.");
    expect(summaries).toContain("Closed the engineering change request.");

    const rows = await db.select().from(auditTrail).where(eq(auditTrail.entityId, id));
    expect(rows.some((row) => row.entityType === "ISO form" && JSON.stringify(row.changes).includes("Recorded the engineering review."))).toBe(true);
  });

  it("requires a structure-edit role and a PIN, and bumps the revision only when a label changes", async () => {
    try {
      const blocked = await request(app).post("/iso-quality-forms/structure/engineering-change/unlock").set("Authorization", `Bearer ${qualityToken}`).send({ pin: TEST_PIN, certified: true });
      expect(blocked.status).toBe(403);

      const missing = await request(app).post("/iso-quality-forms/structure/engineering-change/unlock").set("Authorization", `Bearer ${engineeringToken}`).send({ pin: "0000", certified: true });
      expect(missing.status).toBe(401);

      const unlocked = await request(app).post("/iso-quality-forms/structure/engineering-change/unlock").set("Authorization", `Bearer ${engineeringToken}`).send({ pin: TEST_PIN, certified: true });
      expect(unlocked.status).toBe(200);

      const same = await request(app).put("/iso-quality-forms/structure/engineering-change").set("Authorization", `Bearer ${engineeringToken}`).send({ pin: TEST_PIN, certified: true, labels: defaultEcrLabels() });
      expect(same.status).toBe(200);
      expect(same.body.revision).toBe("B");
      expect(same.body.version).toBe(2);

      const labels = defaultEcrLabels();
      labels.job = "Job or project:";
      const changed = await request(app).put("/iso-quality-forms/structure/engineering-change").set("Authorization", `Bearer ${engineeringToken}`).send({ pin: TEST_PIN, certified: true, labels });
      expect(changed.status).toBe(200);
      expect(changed.body.revision).toBe("C");
      expect(changed.body.version).toBe(3);
      expect(changed.body.lastChange.who).toBe("Erin Engineer");
      expect(changed.body.lastChange.description).toContain("Rev B");
      expect(changed.body.lastChange.description).toContain("Rev C");
    } finally {
      const [co] = await db.select().from(company).limit(1);
      if (co) {
        const profile = { ...(co.profile ?? {}) };
        delete profile.ecrTemplate;
        await db.update(company).set({ profile }).where(eq(company.id, co.id));
      }
    }
    const restored = await request(app).get("/iso-quality-forms/structure/engineering-change").set("Authorization", `Bearer ${qualityToken}`);
    expect(restored.body.revision).toBe("B");
  });

  it("files a drawing change request on the shared stages", async () => {
    const created = await request(app).post("/iso-quality-forms").set("Authorization", `Bearer ${qualityToken}`).send({ formType: "drawing_change", data: { cells: { B6: "DWG-14", D5: "Shawn Parnell" } } });
    expect(created.status).toBe(201);
    expect(created.body.data.workflow.status).toBe("request");
    expect(created.body.data._formTemplate.revision).toBe("A");
    const id = created.body.id as number;

    const submitted = await request(app).post(`/iso-quality-forms/${id}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ action: "submit" });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.workflow.status).toBe("review");
    expect(submitted.body.data.templateLabels.partNumbers).toBe("Drawing Number:");

    const history = await request(app).get(`/workflow/history/iso_forms/${id}`).set("Authorization", `Bearer ${productionToken}`);
    expect(history.status).toBe(200);
    const summaries = history.body.map((row: { changes?: { summary?: string; who?: string; what?: string; when?: string; description?: string } }) => row.changes);
    expect(summaries).toContainEqual(expect.objectContaining({
      summary: "Submitted the drawing change request for review.",
      who: "Quality Staff",
      what: "Submitted the drawing change request for review.",
    }));

    const master = await request(app).get("/iso-quality-forms/structure/drawing-change").set("Authorization", `Bearer ${qualityToken}`);
    expect(master.status).toBe(200);
    expect(master.body.revision).toBe("A");
    expect(master.body.labels.implemented).toBe("Was the new revision released?");

    const processMaster = await request(app).get("/iso-quality-forms/structure/process-change").set("Authorization", `Bearer ${qualityToken}`);
    expect(processMaster.body.labels.partNumbers).toBe("Process Name:");
    const documentMaster = await request(app).get("/iso-quality-forms/structure/document-change").set("Authorization", `Bearer ${qualityToken}`);
    expect(documentMaster.body.labels.section4).toBe("SECTION 4: OLD REVISION DISPOSITION");
    const missing = await request(app).get("/iso-quality-forms/structure/not-a-change").set("Authorization", `Bearer ${qualityToken}`);
    expect(missing.status).toBe(404);
  });
});
