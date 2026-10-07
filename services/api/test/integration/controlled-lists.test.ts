import { ensureTestCompany } from "../helpers/company.js";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { documents } from "../../src/drizzle/schema/documents.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { controlledFormTemplates } from "../../src/drizzle/schema/controlledForms.js";
import { controlledLists } from "../../src/drizzle/schema/controlledLists.js";
import { equipment } from "../../src/drizzle/schema/calibration.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let token: string;

describe("living controlled lists API", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db
      .insert(users)
      .values({ email: `controlled-lists-${suffix}@test.local`, name: "Shawn", passwordHash: "unused" })
      .returning();
    token = signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department: "quality" });
  });

  it("saves a data edit without changing Rev, downloads formulas, and removes the old copies once", async () => {
    const opened = await request(app).get("/controlled-lists/lst-gen-001").set("Authorization", `Bearer ${token}`);
    expect(opened.status).toBe(200);
    expect(opened.body.revision).toBe("B");
    expect(opened.body.sheets.map((sheet: { name: string }) => sheet.name)).toEqual(["Internal Documents", "External Documents"]);
    const internal = opened.body.sheets[0];
    expect(internal.cells.A4.v).toBe("FRM-CAR-001");
    expect(JSON.stringify(internal.cells)).not.toContain("FRM-TST-001");
    expect(JSON.stringify(internal.cells)).not.toContain("FRM-TST-002");

    const saved = await request(app)
      .put("/controlled-lists/lst-gen-001")
      .set("Authorization", `Bearer ${token}`)
      .send({ sheets: [{ name: "Internal Documents", cells: { B4: { v: `Supplier CAR ${suffix}` }, D2: { v: "Z" } } }] });
    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe("B");
    expect(saved.body.sheets[0].cells.B4.v).toBe(`Supplier CAR ${suffix}`);
    expect(saved.body.sheets[0].cells.D2.v).toBe("B");

    const again = await request(app).get("/controlled-lists/lst-gen-001").set("Authorization", `Bearer ${token}`);
    expect(again.body.sheets[0].cells.B4.v).toBe(`Supplier CAR ${suffix}`);
    expect(again.body.revision).toBe("B");

    const audits = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "ControlledList"), eq(auditTrail.entityId, opened.body.id)));
    expect(audits.some((row) => String((row.changes as { summary?: string } | null)?.summary ?? "").includes(`Supplier CAR ${suffix}`))).toBe(true);

    const file = await request(app)
      .get("/controlled-lists/lst-eqp-001/xlsx")
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("spreadsheetml");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(file.body as Buffer);
    const ws = book.getWorksheet("LST-EQP-001 - Master Equipment ");
    expect(ws?.getCell("I6").value).toMatchObject({ formula: "H6+(G6*30)" });
    expect(ws?.model.merges ?? []).toEqual(expect.arrayContaining(["A1:J1"]));
    expect(ws?.pageSetup.orientation).toBe("landscape");

    const scope = await request(app).get("/controlled-lists/lst-gen-003").set("Authorization", `Bearer ${token}`);
    expect(scope.status).toBe(200);
    expect(scope.body.revision).toBe("A");
    expect(scope.body.sheets[0].cells.A1.v).toBe("SCOPE OF LABORATORY ACTIVITIES");
    expect(scope.body.sheets[0].cells.D2.v).toBe("A");

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    expect(tree.status).toBe(200);
    const folders = tree.body as { id: number; name: string; parentId: number | null; linkedPath?: string | null }[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents");
    const manual = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Quality Manual");
    const blanks = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Blank Forms Templates");
    expect(manual?.id).toBeTruthy();
    expect(blanks?.id).toBeTruthy();
    expect(folders.find((folder) => folder.parentId === manual?.id && folder.linkedPath === "/documents/master-list")?.name).toBe("Master Document List");
    expect(folders.find((folder) => folder.parentId === manual?.id && folder.linkedPath === "/calibration/master-list")?.name).toBe("Master Equipment List");
    expect(folders.find((folder) => folder.parentId === manual?.id && folder.linkedPath === "/documents/laboratory-scope")?.name).toBe("Scope of Laboratory Activities");
    const projects = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Test Data Projects");
    expect(folders.find((folder) => folder.parentId === projects?.id && folder.linkedPath === "/documents/development-log")?.name).toBe("LST-DEV-001");
    const logs = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Quality Logs");
    expect(folders.find((folder) => folder.parentId === logs?.id && folder.linkedPath === "/documents/nonconformance-log")?.name).toBe("LST-NCR-001");
    expect(folders.some((folder) => folder.name === "LST-NCR-001" && folder.parentId !== logs?.id)).toBe(false);
    expect(folders.some((folder) => folder.parentId != null && folder.parentId !== projects?.id && folder.linkedPath === "/documents/development-log")).toBe(false);

    const [oldCopy] = await db.insert(documents).values({ title: "Master Equipment List", status: "approved" }).returning();
    const [unrelated] = await db.insert(documents).values({ title: `Torque procedure ${suffix}`, status: "approved" }).returning();
    const [upload] = await db
      .insert(documentFolders)
      .values({ name: "Master Equipment List.xlsx", parentId: manual!.id, documentId: oldCopy!.id, pdfPath: null })
      .returning();
    const [blankNode] = await db.insert(documentFolders).values({ name: "Scope of Laboratory Activities", parentId: blanks!.id }).returning();
    const [filled] = await db.insert(documentFolders).values({ name: "Master Equipment List", parentId: manual!.id, linkedPath: "/calibration/88001" }).returning();
    await db.insert(controlledFormTemplates).values({
      formKey: `lst-blank-${suffix}`,
      formId: "LST-GEN-003",
      title: "Scope of Laboratory Activities",
      subjectRoute: "/documents/laboratory-scope",
    });
    await db.insert(equipment).values({ name: `Bench ${suffix}`, serialNumber: "SN", location: "Lab", metadata: { assetId: `ASSET-${suffix}` } });
    const [devCopy] = await db.insert(documents).values({ title: "Development Log", status: "approved" }).returning();
    const [devUpload] = await db
      .insert(documentFolders)
      .values({ name: "Development Log.xlsx", parentId: projects!.id, documentId: devCopy!.id, pdfPath: null })
      .returning();
    const [devBlank] = await db.insert(documentFolders).values({ name: "LST-DEV-001", parentId: blanks!.id }).returning();

    const cleaned = await request(app).get("/controlled-lists/lst-eqp-001").set("Authorization", `Bearer ${token}`);
    expect(cleaned.status).toBe(200);
    expect(cleaned.body.revision).toBe("A");
    const cells = cleaned.body.sheets[0].cells as Record<string, { v?: string; f?: string }>;
    const assetAddr = Object.entries(cells).find(([, cell]) => cell.v === `ASSET-${suffix}`)?.[0];
    expect(assetAddr).toMatch(/^A\d+$/);
    const assetRow = assetAddr!.slice(1);
    expect(cells[`I${assetRow}`]?.f).toBe(`H${assetRow}+(G${assetRow}*30)`);

    expect(await db.select().from(documents).where(eq(documents.id, oldCopy!.id))).toEqual([]);
    expect(await db.select().from(documents).where(eq(documents.id, unrelated!.id))).toHaveLength(1);
    expect(await db.select().from(documentFolders).where(eq(documentFolders.id, upload!.id))).toEqual([]);
    expect(await db.select().from(documentFolders).where(eq(documentFolders.id, blankNode!.id))).toEqual([]);
    expect(await db.select().from(documentFolders).where(eq(documentFolders.id, filled!.id))).toHaveLength(1);
    expect(await db.select().from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, `lst-blank-${suffix}`))).toEqual([]);
    expect(await db.select().from(documents).where(eq(documents.id, devCopy!.id))).toEqual([]);
    expect(await db.select().from(documentFolders).where(eq(documentFolders.id, devUpload!.id))).toEqual([]);
    expect(await db.select().from(documentFolders).where(eq(documentFolders.id, devBlank!.id))).toEqual([]);
    const log = await request(app).get("/controlled-lists/lst-dev-001").set("Authorization", `Bearer ${token}`);
    expect(log.status).toBe(200);
    expect(log.body.title).toBe("LST-DEV-001");
    expect(log.body.revision).toBe("B");
    expect(log.body.sheets[0].cells.A1.v).toBe("DEVELOPMENT LOG (REGISTER)");
    expect(log.body.sheets[0].cells.C2.v).toBe("Location: X:\\ISO Compliance Documents\\06_Test_Data_Projects");
    const ncr = await request(app).get("/controlled-lists/lst-ncr-001").set("Authorization", `Bearer ${token}`);
    expect(ncr.status).toBe(200);
    expect(ncr.body.title).toBe("LST-NCR-001");
    expect(ncr.body.revision).toBe("G");
    expect(ncr.body.sheets.map((sheet: { name: string }) => sheet.name)).toEqual(["LST-NCR-001 - NCR", "LST-NCR-001 - QTN", "LST-NCR-001 - CAR", "LST-NCR-001 - RPN"]);
    expect(ncr.body.sheets[0].cells.B2.v).toBe("Rev: E");
    expect(ncr.body.sheets[1].cells.B2.v).toBe("Rev: F");
    expect(ncr.body.sheets[2].cells.B2.v).toBe("Rev: E");
    expect(ncr.body.sheets[3].cells.B2.v).toBe("Rev: E");
    expect(ncr.body.sheets[0].cells.C2.v).toBe("Location: X:\\ISO Compliance Documents\\07_Quality_Logs");
    const filed = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    const filedFolders = filed.body as { name: string; parentId: number | null; linkedPath?: string | null }[];
    const filedProjects = filedFolders.find((folder) => folder.parentId === iso?.id && folder.name === "Test Data Projects");
    expect(filedFolders.find((folder) => folder.parentId === filedProjects?.id && folder.linkedPath === "/documents/development-log")?.name).toBe("LST-DEV-001");
    expect(await db.select().from(controlledLists).where(eq(controlledLists.listKey, "lst-eqp-001"))).toHaveLength(1);

    const second = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    expect(second.status).toBe(200);
    expect(await db.select().from(documents).where(eq(documents.id, unrelated!.id))).toHaveLength(1);
    expect(await db.select().from(documentFolders).where(eq(documentFolders.id, filled!.id))).toHaveLength(1);

    const blanksApi = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    const titles = (blanksApi.body.templates as { title: string; formKey: string }[]).map((form) => form.title);
    expect(titles).not.toContain("Master Equipment List");
    expect(titles).not.toContain("Master Document List");
    expect(titles).not.toContain("Scope of Laboratory Activities");
    expect(titles).toContain("NON-CONFORMANCE REPORT (NCR)");
    expect(titles).toContain("Nonconformance Report");
    expect(titles).not.toContain("Non-Conformance Log");
  });
});
