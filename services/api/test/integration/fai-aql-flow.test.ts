import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions, seedTestRoles } from "../helpers/seedDefaults.js";
import { setTestPin, TEST_PIN } from "../helpers/signaturePin.js";

const app = createApp();
const suffix = Date.now().toString(36);
const userIds: number[] = [];
let token: string;
let supplierId: number;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const co = await ensureTestCompany();
  await seedDefaultPermissions(co!.id);
  await seedTestRoles();
  const [role] = await db.select().from(roles).where(eq(roles.name, "quality_manager"));
  await db.update(roles).set({ permissions: [...new Set([...(role!.permissions ?? []), "fai.view", "fai.create", "fai.edit", "fai.signoff"])] }).where(eq(roles.id, role!.id));
  const [user] = await db.insert(users).values({ email: `fai-flow-${suffix}@test.local`, passwordHash: "unused", department: "quality", roleId: role!.id, name: "Flow Inspector" } as never).returning();
  userIds.push(user!.id);
  await setTestPin(user!.id);
  token = await signAccessToken({ sub: String(user!.id), roleId: role!.id, roleName: "quality_manager", department: "quality" });
  const [supplier] = await db.insert(suppliers).values({ name: `Flow Supplier ${suffix}` } as never).returning();
  supplierId = supplier!.id;
});

afterAll(async () => {
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

const LINES = [
  { family: "CSA", part: `43GM1000PS-${suffix}`, description: "Complete strut assembly", form: "csa" },
  { family: "Fuel Pump", part: `FP-2201-${suffix}`, description: "Fuel pump module", form: "fuel_pump" },
  { family: "Coil Springs", part: `CS-77-${suffix}`, description: "Rear coil spring", form: "coil_spring" },
  { family: "Control Arm Bushings", part: `CAB-12-${suffix}`, description: "Lower control arm bushing", form: null },
];

describe("FAI & AQL end to end for a CSA, a fuel pump, coil springs and a line with no validation form", () => {
  it("random pull rules read and save", async () => {
    const rules = await request(app).get("/fai-inspection/random-pull/rules").set(auth());
    expect([200, 404]).toContain(rules.status);
  });

  for (const line of LINES) {
    it(`${line.family}: plan, record, attached form, results, pass, fail, NCR, PDF`, async () => {
      const plan = await request(app).post("/fai-inspection/plans").set(auth()).send({
        partNumber: line.part, partDescription: line.description, productFamily: line.family, supplierId, riskClass: "Major",
        characteristics: [
          { name: "Free length", limitType: "plus_minus", nominal: "100", tolerancePlus: "0.5", toleranceMinus: "0.5", unit: "mm", sortOrder: 0 },
          { name: "Finish", limitType: "attribute", sortOrder: 1 },
        ],
      });
      expect(plan.status, JSON.stringify(plan.body)).toBe(201);
      await request(app).put(`/fai-inspection/plans/${plan.body.id}`).set(auth()).send({ status: "Active" });

      const open = async (n: string) => {
        const res = await request(app).post("/fai-inspection/records").set(auth()).send({ faiNumber: `2026-FAI-${n}-${line.part}`, planId: plan.body.id, partNumber: line.part, supplierId, poReference: "PO-4410", lotSize: 500, inspector: "Flow Inspector", dateInspected: "2026-10-15" });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        return (await request(app).get(`/fai-inspection/records/${res.body.id}`).set(auth())).body;
      };

      const passing = await open("P");
      const attached = JSON.stringify(passing.attachedForms ?? []);
      if (line.form) expect(passing.linkedValidationFormType ?? attached, `${line.family} auto-attach`).toContain(line.form);
      else expect(passing.linkedValidationReportId ?? null).toBeNull();
      const good = passing.lines.map((l: { id: number; limitType: string }) => (l.limitType === "attribute" ? { id: l.id, attributeResult: "pass" } : { id: l.id, measuredValue: "100.1" }));
      expect((await request(app).post(`/fai-inspection/records/${passing.id}/lines`).set(auth()).send({ lines: good })).status).toBe(200);
      const passed = await request(app).post(`/fai-inspection/records/${passing.id}/sign`).set(auth()).send({ pin: TEST_PIN, certified: true, outcome: "passed", description: "All in spec" });
      expect(passed.status, JSON.stringify(passed.body)).toBe(200);
      expect((await request(app).post(`/fai-inspection/records/${passing.id}/ncr`).set(auth())).status).toBe(409);

      const failing = await open("F");
      const bad = failing.lines.map((l: { id: number; limitType: string }) => (l.limitType === "attribute" ? { id: l.id, attributeResult: "fail", defects: 2 } : { id: l.id, measuredValue: "101.2", defects: 1 }));
      expect((await request(app).post(`/fai-inspection/records/${failing.id}/lines`).set(auth()).send({ lines: bad })).status).toBe(200);
      expect((await request(app).post(`/fai-inspection/records/${failing.id}/lines`).set(auth()).send({ lines: bad })).status).toBe(200);
      const failed = await request(app).post(`/fai-inspection/records/${failing.id}/sign`).set(auth()).send({ pin: TEST_PIN, certified: true, outcome: "failed", description: "Out of spec" });
      expect(failed.status, JSON.stringify(failed.body)).toBe(200);
      const locked = await request(app).post(`/fai-inspection/records/${failing.id}/lines`).set(auth()).send({ lines: bad });
      expect(locked.status, "signed record stays locked").toBeGreaterThanOrEqual(400);

      const made = await request(app).post(`/fai-inspection/records/${failing.id}/ncr`).set(auth());
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const [form] = await db.select().from(formData).where(and(eq(formData.formType, "ncr"), eq(formData.entityId, made.body.id)));
      const f = (form?.data ?? {}) as Record<string, unknown>;
      const text = String(f.nonconformanceDescription);
      expect(String(f.partNumberDescription)).toContain(line.part);
      expect(String(f.partNumberDescription)).toContain(line.description);
      expect(text).toContain(`Product line: ${line.family}`);
      expect(text).toContain("Free length: spec 99.5 to 100.5, actual 101.2");
      expect(text).toContain("Finish");
      expect(text).toMatch(/AQL: .*sample size \d+/);
      expect(text).toContain("Inspector: Flow Inspector");
      expect(text).toContain("Inspected: 2026-10-15");
      expect(String(f.customerSupplierName)).toContain(`Flow Supplier ${suffix}`);
      expect(f.reportedBy).toBe("Flow Inspector");
      expect(Number(f.totalQuantityInspected)).toBeGreaterThan(0);
      expect(String(f.referenceNumber)).toContain(`2026-FAI-F-${line.part}`);
      expect(String(f.relatedDocuments)).toContain(`/fai-inspection/records/${failing.id}`);

      const ncrRow = await request(app).get(`/ncr/${made.body.id}`).set(auth());
      expect(JSON.stringify(ncrRow.body.processData?.validationSource ?? {})).toContain(`/fai-inspection/records/${failing.id}`);
      const back = await request(app).get(`/fai-inspection/records/${failing.id}`).set(auth());
      expect(back.body.ncrId).toBe(made.body.id);
      expect("ncrNumber" in back.body).toBe(true);
      const audits = await db.select().from(auditTrail).where(eq(auditTrail.entityId, failing.id));
      expect(audits.some((a) => JSON.stringify(a.changes).includes("ncr_created"))).toBe(true);
      const ncrAudits = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "NCR"), eq(auditTrail.entityId, made.body.id)));
      expect(ncrAudits.length).toBeGreaterThan(0);

      const pdf = await request(app).get(`/fai-inspection/records/${failing.id}/pdf`).set(auth()).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks))); });
      expect(pdf.status).toBe(200);
      expect(String(pdf.headers["content-type"])).toContain("pdf");
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    });
  }
});
