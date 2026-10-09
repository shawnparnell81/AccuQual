import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { validationReports } from "../../src/drizzle/schema/validationReport.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { and, desc, eq } from "drizzle-orm";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";

const app = createApp();
const suffix = Date.now();

let qualityToken: string;
let productionToken: string;

async function makeUser(department: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `val-report-${department}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

describe("validation reports", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    qualityToken = await makeUser("quality");
    productionToken = await makeUser("production");
  });

  it("stores the filled cells and returns them", async () => {
    const created = await request(app).post("/validation-reports").set("Authorization", `Bearer ${qualityToken}`).send({ data: { cells: { B6: "CSA-100", D12: 10 } } });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const saved = await request(app)
      .patch(`/validation-reports/${id}`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ data: { cells: { B6: "CSA-100", D12: 8, E12: 10 } } });
    expect(saved.status).toBe(200);
    expect(saved.body.data.cells.D12).toBe(8);

    const again = await request(app).get(`/validation-reports/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(again.status).toBe(200);
    expect(again.body.data.cells.B6).toBe("CSA-100");
    expect(again.body.data.cells.E12).toBe(10);

    await db.delete(validationReports).where(eq(validationReports.id, id));
  });

  it("stores a fuel pump form on the same record", async () => {
    const created = await request(app)
      .post("/validation-reports")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ data: { formType: "fuel_pump", cells: { B6: "FP-200", G13: 50 } } });
    expect(created.status).toBe(201);
    expect(created.body.data.formType).toBe("fuel_pump");
    expect(created.body.data.cells.B6).toBe("FP-200");
    const id = created.body.id as number;

    const saved = await request(app)
      .patch(`/validation-reports/${id}`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ data: { formType: "fuel_pump", cells: { B6: "FP-201", G13: 40 } } });
    expect(saved.status).toBe(200);
    expect(saved.body.data.formType).toBe("fuel_pump");
    expect(saved.body.data.cells.G13).toBe(40);

    await db.delete(validationReports).where(eq(validationReports.id, id));
  });

  it("production can read a validation report and cannot change it", async () => {
    const created = await request(app).post("/validation-reports").set("Authorization", `Bearer ${qualityToken}`).send({});
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const read = await request(app).get(`/validation-reports/${id}`).set("Authorization", `Bearer ${productionToken}`);
    expect(read.status).toBe(200);

    const write = await request(app).patch(`/validation-reports/${id}`).set("Authorization", `Bearer ${productionToken}`).send({ data: { cells: { B6: "nope" } } });
    expect(write.status).toBe(403);

    const create = await request(app).post("/validation-reports").set("Authorization", `Bearer ${productionToken}`).send({});
    expect(create.status).toBe(403);

    await db.delete(validationReports).where(eq(validationReports.id, id));
  });

  it("saves a typed Report No. without the sheet body and writes an audit line", async () => {
    const created = await request(app).post("/validation-reports").set("Authorization", `Bearer ${qualityToken}`).send({ data: { formType: "csa", cells: { B6: "CSA-100" } } });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const saved = await request(app).patch(`/validation-reports/${id}`).set("Authorization", `Bearer ${qualityToken}`).send({ recordNumber: "TEST-1008-03" });
    expect(saved.status).toBe(200);
    expect(saved.body.recordNumber).toBe("TEST-1008-03");

    const again = await request(app).get(`/validation-reports/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(again.status).toBe(200);
    expect(again.body.recordNumber).toBe("TEST-1008-03");

    const rows = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "Validation Report"), eq(auditTrail.entityId, id), eq(auditTrail.action, "update")))
      .orderBy(desc(auditTrail.createdAt));
    const changes = rows.find((row) => (row.changes as { numberEdit?: unknown } | null)?.numberEdit)?.changes as {
      numberEdit?: { label?: string; from?: string; to?: string };
    } | null;
    expect(changes?.numberEdit).toEqual({ label: "Report No.", from: "", to: "TEST-1008-03" });

    await db.delete(validationReports).where(eq(validationReports.id, id));
  });
});
