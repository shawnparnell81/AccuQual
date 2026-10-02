import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { controlledFormTemplates } from "../../src/drizzle/schema/controlledForms.js";
import { documents } from "../../src/drizzle/schema/documents.js";
import { formFilings } from "../../src/drizzle/schema/formFilings.js";
import { users } from "../../src/drizzle/schema/users.js";
import { validationReports } from "../../src/drizzle/schema/validationReport.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { ensureTestCompany } from "../helpers/company.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let qualityToken: string;
let productionToken: string;

async function makeUser(department: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `form-import-${department}-${suffix}@test.local`, passwordHash: "unused" })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

async function masterFile() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("List");
  sheet.mergeCells("A1:D1");
  sheet.getCell("A1").value = "Imported register";
  sheet.getCell("A1").font = { bold: true };
  for (const [index, text] of ["Document Title", "Current Rev", "Location / Folder", "Document ID"].entries()) {
    const header = sheet.getCell(2, index + 1);
    header.value = text;
    header.font = { bold: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  }
  sheet.getCell("A3").value = `Imported WI ${suffix}`;
  sheet.getCell("B3").value = { formula: '"Rev "&"C"', result: "Rev C" };
  sheet.getCell("C3").value = "Quality Lab";
  sheet.getCell("D3").value = "LST-GEN-001";
  sheet.getCell("A4").value = `Second WI ${suffix}`;
  sheet.getCell("B4").value = "Rev A";
  sheet.getCell("C4").value = "Engineering";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("form spreadsheet import", () => {
  beforeAll(async () => {
    const company = await ensureTestCompany();
    await seedDefaultPermissions(company!.id);
    qualityToken = await makeUser("quality");
    productionToken = await makeUser("production");
  });

  it("lists the two live templates without inventing numbers", async () => {
    const listed = await request(app).get("/form-import/templates").set("Authorization", `Bearer ${qualityToken}`);
    expect(listed.status).toBe(200);
    const keys = listed.body.templates.map((template: { key: string }) => template.key);
    expect(keys).toEqual(["lst-gen-001", "frm-val-001"]);
    const csa = listed.body.templates.find((template: { key: string }) => template.key === "frm-val-001");
    const [stored] = await db.select().from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, "frm-val-001"));
    expect(csa.templateId).toBe(stored?.id);
    expect(csa.formId).toBe(stored?.formId ?? "");
    expect(csa.fields.some((field: { key: string }) => field.key === "B6")).toBe(true);
    expect(csa.fields.some((field: { key: string }) => field.key.startsWith("FRM-DEV"))).toBe(false);
  });

  it("imports a master-list spreadsheet as draft documents and leaves template numbers alone", async () => {
    const file = await masterFile();
    const inspected = await request(app)
      .post("/form-import/inspect")
      .set("Authorization", `Bearer ${qualityToken}`)
      .field("templateKey", "lst-gen-001")
      .attach("file", file, "master.xlsx");
    expect(inspected.status).toBe(200);
    expect(inspected.body.records).toHaveLength(2);
    const mapping = Object.fromEntries(inspected.body.mapping.map((entry: { fieldKey: string; columnIndex: number | null }) => [entry.fieldKey, entry.columnIndex]));
    expect(mapping.title).toBe(0);

    const preview = await request(app).post("/form-import/preview").set("Authorization", `Bearer ${qualityToken}`).send({
      templateKey: "lst-gen-001",
      columns: inspected.body.columns,
      records: inspected.body.records,
      mapping,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.rows[0].action).toBe("skip");
    expect(preview.body.rows[1].action).toBe("create");

    const imported = await request(app).post("/form-import/execute").set("Authorization", `Bearer ${qualityToken}`).send({
      templateKey: "lst-gen-001",
      columns: inspected.body.columns,
      records: inspected.body.records,
      mapping,
    });
    expect(imported.status).toBe(201);
    expect(imported.body.created).toHaveLength(1);
    expect(imported.body.skipped).toHaveLength(1);
    const created = imported.body.created[0];
    expect(created.href).toBe(`/documents/${created.id}`);
    expect(created.label).toContain("DOC-");
    expect(created.label).not.toMatch(/LST-|FRM-/);

    const [doc] = await db.select().from(documents).where(eq(documents.id, created.id));
    expect(doc?.title).toBe(`Second WI ${suffix}`);
    expect(doc?.category).toBe("Engineering");
    expect(doc?.status).toBe("draft");
    expect(doc?.revisionCode ?? null).toBeNull();

    const [audit] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Document"), eq(auditTrail.entityId, created.id), eq(auditTrail.action, "create")));
    expect(audit?.action).toBe("create");

    const updated = await request(app).post("/form-import/execute").set("Authorization", `Bearer ${qualityToken}`).send({
      templateKey: "lst-gen-001",
      columns: [
        { index: 0, header: "Document Title" },
        { index: 1, header: "Current Rev" },
        { index: 2, header: "Location / Folder" },
        { index: 3, header: "Document ID" },
      ],
      records: [{ rowNumber: 8, cells: [`Renamed WI ${suffix}`, "Rev D", "Metrology", `DOC-${created.id}`] }],
      mapping: { title: 0, revision: 1, location: 2, documentId: 3, notes: null },
    });
    expect(updated.status).toBe(201);
    expect(updated.body.updated).toEqual([expect.objectContaining({ id: created.id, href: `/documents/${created.id}` })]);
    const [renamed] = await db.select().from(documents).where(eq(documents.id, created.id));
    expect(renamed?.title).toBe(`Renamed WI ${suffix}`);
    expect(renamed?.category).toBe("Metrology");
    expect(renamed?.status).toBe("draft");

    const denied = await request(app).post("/form-import/execute").set("Authorization", `Bearer ${productionToken}`).send({
      templateKey: "lst-gen-001",
      columns: inspected.body.columns,
      records: inspected.body.records,
      mapping,
    });
    expect(denied.status).toBe(403);

    await db.delete(documents).where(eq(documents.id, created.id));
  });

  it("imports a filled CSA sheet onto frm-val-001 and snapshots the existing form number", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Test Report");
    sheet.getCell("A6").value = "DMA Part Number:";
    sheet.getCell("B6").value = `CSA-${suffix}`;
    sheet.mergeCells("B6:D6");
    sheet.getCell("E6").value = "Drawing Number:";
    sheet.getCell("F6").value = "DWG-100";
    sheet.getCell("A11").value = "Criteria";
    sheet.getCell("B11").value = "Nominal";
    sheet.getCell("C11").value = "Tolorences";
    sheet.getCell("D11").value = "Sample 1";
    sheet.getCell("E11").value = "Sample 2";
    for (const column of ["A", "B", "C", "D", "E"]) {
      sheet.getCell(`${column}11`).font = { bold: true };
      sheet.getCell(`${column}11`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E3F0" } };
    }
    sheet.getCell("A12").value = "Hardwear Grade";
    sheet.getCell("B12").value = 10;
    sheet.getCell("C12").value = "=";
    sheet.getCell("D12").value = { formula: "B12", result: 10 };
    sheet.getCell("E12").value = 10;
    const file = Buffer.from(await workbook.xlsx.writeBuffer());

    const inspected = await request(app)
      .post("/form-import/inspect")
      .set("Authorization", `Bearer ${qualityToken}`)
      .field("templateKey", "frm-val-001")
      .attach("file", file, "csa.xlsx");
    expect(inspected.status).toBe(200);
    expect(inspected.body.mode).toBe("record");
    const mapping = Object.fromEntries(inspected.body.mapping.map((entry: { fieldKey: string; columnIndex: number | null }) => [entry.fieldKey, entry.columnIndex]));
    expect(mapping.B6).toBeTypeOf("number");
    expect(mapping.D12).toBeTypeOf("number");

    const imported = await request(app).post("/form-import/execute").set("Authorization", `Bearer ${qualityToken}`).send({
      templateKey: "frm-val-001",
      columns: inspected.body.columns,
      records: inspected.body.records,
      mapping,
    });
    expect(imported.status).toBe(201);
    expect(imported.body.created).toHaveLength(1);
    const created = imported.body.created[0];
    expect(created.href).toBe(`/validation-reports/${created.id}`);

    const [report] = await db.select().from(validationReports).where(eq(validationReports.id, created.id));
    const data = report?.data as { formType?: string; cells?: Record<string, unknown> };
    expect(data.formType).toBe("csa");
    expect(data.cells?.B6).toBe(`CSA-${suffix}`);
    expect(data.cells?.F6).toBe("DWG-100");
    expect(data.cells?.D12).toBe(10);
    expect(data.cells?.C12).toBe("=");

    const [filing] = await db.select().from(formFilings).where(and(eq(formFilings.formKey, "frm-val-001"), eq(formFilings.recordId, created.id)));
    const [template] = await db.select().from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, "frm-val-001"));
    expect(filing?.formKey).toBe("frm-val-001");
    expect(filing?.formNumber).toBe(template?.formId ?? "");

    const [audit] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Validation Report"), eq(auditTrail.entityId, created.id), eq(auditTrail.action, "create")));
    expect(audit?.action).toBe("create");

    await db.delete(formFilings).where(eq(formFilings.recordId, created.id));
    await db.delete(validationReports).where(eq(validationReports.id, created.id));
  });
});
