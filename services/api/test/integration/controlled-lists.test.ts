import { ensureTestCompany } from "../helpers/company.js";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
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
      .send({ sheets: [{ name: "Internal Documents", cells: { B4: { v: `Supplier CAR ${suffix}` } } }] });
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
    const engineering = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Engineering Logs");
    const livingEng = folders.find((folder) => folder.parentId === engineering?.id && folder.linkedPath === "/documents/engineering-request-log");
    expect(livingEng?.name).toBe("LST-ENG-001");
    expect(folders.some((folder) => folder.name === "LST-ENG-001" && folder.parentId !== engineering?.id)).toBe(false);
    const [nestedEng] = await db
      .insert(documentFolders)
      .values({ name: "LST-ENG-001", parentId: livingEng!.id, linkedPath: "/documents/engineering-request-log" })
      .returning();
    const flattened = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    expect(flattened.status).toBe(200);
    const flatFolders = flattened.body as { id: number; name: string; parentId: number | null; linkedPath?: string | null }[];
    expect(flatFolders.some((folder) => folder.id === nestedEng!.id)).toBe(false);
    expect(flatFolders.filter((folder) => folder.linkedPath === "/documents/engineering-request-log")).toEqual([
      expect.objectContaining({ id: livingEng!.id, name: "LST-ENG-001", parentId: engineering?.id }),
    ]);
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
    const ecr = await request(app).get("/controlled-lists/lst-eng-001").set("Authorization", `Bearer ${token}`);
    expect(ecr.status).toBe(200);
    expect(ecr.body.title).toBe("LST-ENG-001");
    expect(ecr.body.revision).toBe("A");
    expect(ecr.body.sheets.map((sheet: { name: string }) => sheet.name)).toEqual(["LST-ENG-001 - ECR Tracker - Rev"]);
    expect(ecr.body.sheets[0].cells.A1.v).toBe("ENGINEERING REQUEST CHANGE LOG");
    expect(ecr.body.sheets[0].cells.D2.v).toBe("A");
    expect(ecr.body.sheets[0].cells.E2.v).toBe("Location: X:\\ISO Compliance Documents\\12_Engineering_Logs");
    expect(ecr.body.sheets[0].cells.A6.v).toBe("ECR-2026-001");
    expect(ecr.body.sheets[0].cells.A55.v).toBe("ECR-2026-050");
    const [ecrCopy] = await db.insert(documents).values({ title: "ENGINEERING REQUEST CHANGE LOG", status: "approved" }).returning();
    const [ecrUpload] = await db
      .insert(documentFolders)
      .values({ name: "LST-ENG-001.xlsx", parentId: engineering!.id, documentId: ecrCopy!.id, pdfPath: null })
      .returning();
    const [ecrBlank] = await db.insert(documentFolders).values({ name: "ECR Tracker", parentId: blanks!.id }).returning();
    await db.insert(controlledFormTemplates).values({
      formKey: `lst-eng-blank-${suffix}`,
      formId: "LST-ENG-001",
      title: "ENGINEERING REQUEST CHANGE LOG",
      subjectRoute: "/change",
    });
    const filedEng = await request(app).get("/controlled-lists/lst-eng-001").set("Authorization", `Bearer ${token}`);
    expect(filedEng.status).toBe(200);
    expect(filedEng.body.revision).toBe("A");
    expect(await db.select().from(documents).where(eq(documents.id, ecrCopy!.id))).toEqual([]);
    expect(await db.select().from(documentFolders).where(eq(documentFolders.id, ecrUpload!.id))).toEqual([]);
    expect(await db.select().from(documentFolders).where(eq(documentFolders.id, ecrBlank!.id))).toEqual([]);
    expect(await db.select().from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, `lst-eng-blank-${suffix}`))).toEqual([]);
    expect(await db.select().from(controlledLists).where(eq(controlledLists.listKey, "lst-eng-001"))).toHaveLength(1);
    const ecrAgain = await request(app).get("/controlled-lists/lst-eng-001").set("Authorization", `Bearer ${token}`);
    expect(ecrAgain.body.sheets[0].cells.A6.v).toBe("ECR-2026-001");
    expect(await db.select().from(controlledLists).where(eq(controlledLists.listKey, "lst-eng-001"))).toHaveLength(1);
    const ecrFile = await request(app)
      .get("/controlled-lists/lst-eng-001/xlsx")
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(ecrFile.status).toBe(200);
    expect(String(ecrFile.headers["content-disposition"] ?? "")).toContain("LST-ENG-001.xlsx");
    const ecrBook = new ExcelJS.Workbook();
    await ecrBook.xlsx.load(ecrFile.body as Buffer);
    const ecrSheet = ecrBook.getWorksheet("LST-ENG-001 - ECR Tracker - Rev");
    expect(JSON.stringify(ecrSheet?.conditionalFormattings ?? [])).toContain("Pending");
    expect(JSON.stringify(ecrSheet?.dataValidations.model ?? {})).toContain("Approved");
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
    expect(titles).not.toContain("Internal Audit Schedule");
    expect(titles).not.toContain("LST-GEN-002");
    expect(titles).not.toContain("ENGINEERING REQUEST CHANGE LOG");
    expect(titles).not.toContain("ECR Tracker");
    expect(titles).toContain("Engineering Change Request");
  });

  it("files the internal audit schedule once under Management System and replaces an uploaded copy", async () => {
    const opened = await request(app).get("/controlled-lists/lst-gen-002").set("Authorization", `Bearer ${token}`);
    expect(opened.status).toBe(200);
    expect(opened.body.title).toBe("LST-GEN-002");
    expect(opened.body.docId).toBe("LST-GEN-002");
    expect(opened.body.revision).toBe("A");
    expect(opened.body.landscape).toBe(false);
    expect(opened.body.sheets.map((sheet: { name: string }) => sheet.name)).toEqual(["LST-GEN-002 - Internal Audit Sc"]);
    expect(opened.body.sheets[0].cells.A1.v).toBe("INTERNAL AUDIT SCHEDULE");
    expect(opened.body.sheets[0].cells.D2.v).toBe("A");
    expect(opened.body.sheets[0].cells.B3.v).toBe("2026-07-14");
    expect(opened.body.sheets[0].cells.F3.v).toBe("Ron Wertz & Maxwell Tollefson");
    expect(opened.body.sheets[0].cells.A6.v).toBe("H1 - 2027");
    expect(await db.select().from(controlledLists).where(eq(controlledLists.listKey, "lst-gen-002"))).toHaveLength(1);

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    const folders = tree.body as { id: number; name: string; parentId: number | null; linkedPath?: string | null }[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance Documents");
    const management = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Management System");
    const blanks = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Blank Forms Templates");
    const audits = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Audits");
    expect(management?.id).toBeTruthy();
    const filed = folders.filter((folder) => folder.linkedPath === "/documents/internal-audit-schedule");
    expect(filed).toEqual([expect.objectContaining({ name: "LST-GEN-002", parentId: management?.id })]);
    expect(folders.some((folder) => folder.name === "LST-GEN-002" && folder.parentId !== management?.id)).toBe(false);
    expect(folders.find((folder) => folder.parentId === audits?.id && folder.name === "Internal Audit Schedule")).toBeTruthy();

    const again = await request(app).get("/controlled-lists/lst-gen-002").set("Authorization", `Bearer ${token}`);
    expect(again.body.id).toBe(opened.body.id);
    expect(again.body.revision).toBe("A");
    expect(await db.select().from(controlledLists).where(eq(controlledLists.listKey, "lst-gen-002"))).toHaveLength(1);
    const filedAgain = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    const filedFolders = filedAgain.body as { name: string; parentId: number | null; linkedPath?: string | null }[];
    expect(filedFolders.filter((folder) => folder.linkedPath === "/documents/internal-audit-schedule")).toHaveLength(1);

    const [copy] = await db.insert(documents).values({ title: "Internal Audit Schedule", status: "approved" }).returning();
    const [upload] = await db
      .insert(documentFolders)
      .values({ name: "Internal Audit Schedule.xlsx", parentId: management!.id, documentId: copy!.id, pdfPath: null })
      .returning();
    const [blankNode] = await db.insert(documentFolders).values({ name: "LST-GEN-002", parentId: blanks!.id }).returning();
    await db.insert(controlledFormTemplates).values({
      formKey: `lst-gen-002-blank-${suffix}`,
      formId: "LST-GEN-002",
      title: "Internal Audit Schedule",
      subjectRoute: "/documents/internal-audit-schedule",
    });

    const saved = await request(app)
      .put("/controlled-lists/lst-gen-002")
      .set("Authorization", `Bearer ${token}`)
      .send({ sheets: [{ name: "LST-GEN-002 - Internal Audit Sc", cells: { E6: { v: `Complete ${suffix}` } } }] });
    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe("A");
    expect(saved.body.sheets[0].cells.E6.v).toBe(`Complete ${suffix}`);
    expect(saved.body.sheets[0].cells.D2.v).toBe("A");
    expect(saved.body.sheets[0].cells.A6.v).toBe("H1 - 2027");
    const auditsTrail = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "ControlledList"), eq(auditTrail.entityId, opened.body.id)));
    const entry = auditsTrail.find((row) => String((row.changes as { summary?: string } | null)?.summary ?? "").includes(`Complete ${suffix}`));
    expect(entry?.performedBy).toBeTruthy();
    expect(entry?.createdAt).toBeInstanceOf(Date);
    expect(String((entry?.changes as { summary?: string } | null)?.summary ?? "")).toContain("changed");

    expect(await db.select().from(documents).where(eq(documents.id, copy!.id))).toEqual([]);
    expect(await db.select().from(documentFolders).where(eq(documentFolders.id, upload!.id))).toEqual([]);
    expect(await db.select().from(documentFolders).where(eq(documentFolders.id, blankNode!.id))).toEqual([]);
    expect(await db.select().from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, `lst-gen-002-blank-${suffix}`))).toEqual([]);
    const after = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    const afterFolders = after.body as { name: string; parentId: number | null; linkedPath?: string | null }[];
    expect(afterFolders.filter((folder) => folder.linkedPath === "/documents/internal-audit-schedule")).toHaveLength(1);
    expect(afterFolders.find((folder) => folder.parentId === audits?.id && folder.name === "Internal Audit Schedule")).toBeTruthy();

    const file = await request(app)
      .get("/controlled-lists/lst-gen-002/xlsx")
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(String(file.headers["content-disposition"])).toContain("LST-GEN-002.xlsx");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(file.body as Buffer);
    const ws = book.getWorksheet("LST-GEN-002 - Internal Audit Sc");
    expect(ws?.getCell("A1").value).toBe("INTERNAL AUDIT SCHEDULE");
    expect(ws?.getCell("D2").value).toBe("A");
    expect(ws?.getCell("F3").value).toBe("Ron Wertz & Maxwell Tollefson");
    expect(ws?.getCell("E6").value).toBe(`Complete ${suffix}`);
    expect((ws?.getCell("B3").value as Date).toISOString().slice(0, 10)).toBe("2026-07-14");
    expect(ws?.pageSetup.orientation).toBe("portrait");
    expect(ws?.model.merges ?? []).toEqual(expect.arrayContaining(["A1:H1"]));
  });

  it("edits, inserts, and deletes seeded rows, and treats columns as a structure change", async () => {
    const engName = "LST-ENG-001 - ECR Tracker - Rev";
    const opened = await request(app).get("/controlled-lists/lst-eng-001").set("Authorization", `Bearer ${token}`);
    expect(opened.status).toBe(200);
    // Quality's department grant for form_builder is edit, same rule as Form Builder.
    expect(opened.body.canEditStructure).toBe(true);
    expect(opened.body.dataStart[engName]).toBe(6);
    expect(opened.body.sheets[0].cells.H2.v).toBe("Maxwell Tollefson");
    expect(opened.body.revision).toBe("A");

    const saved = await request(app)
      .put("/controlled-lists/lst-eng-001")
      .set("Authorization", `Bearer ${token}`)
      .send({ sheets: [{ name: engName, cells: { F6: { v: `Height ${suffix}` }, H2: { v: `Ada ${suffix}` }, A1: { v: "ENGINEERING REQUEST CHANGE LOG" } } }] });
    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe("A");
    expect(saved.body.sheets[0].cells.F6.v).toBe(`Height ${suffix}`);
    expect(saved.body.sheets[0].cells.H2.v).toBe(`Ada ${suffix}`);
    expect(saved.body.sheets[0].cells.A6.v).toBe("ECR-2026-001");
    expect(saved.body.sheets[0].cells.D2.v).toBe("A");

    const inserted = await request(app)
      .post("/controlled-lists/lst-eng-001/rows")
      .set("Authorization", `Bearer ${token}`)
      .send({ sheet: engName, op: "insert", row: 6, place: "above" });
    expect(inserted.status).toBe(200);
    expect(inserted.body.revision).toBe("A");
    expect(inserted.body.sheets[0].cells.A6).toBeUndefined();
    expect(inserted.body.sheets[0].cells.A7.v).toBe("ECR-2026-001");
    expect(inserted.body.sheets[0].cells.F7.v).toBe(`Height ${suffix}`);
    expect(JSON.stringify(inserted.body.sheets[0].cells)).not.toContain("ECR-2026-051");

    const removed = await request(app)
      .post("/controlled-lists/lst-eng-001/rows")
      .set("Authorization", `Bearer ${token}`)
      .send({ sheet: engName, op: "delete", rows: [6] });
    expect(removed.status).toBe(200);
    expect(removed.body.sheets[0].cells.A6.v).toBe("ECR-2026-001");
    expect(removed.body.sheets[0].cells.F6.v).toBe(`Height ${suffix}`);

    const audits = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "ControlledList"), eq(auditTrail.entityId, opened.body.id)));
    const editAudit = audits.find((row) => String((row.changes as { summary?: string } | null)?.summary ?? "").includes(`Ada ${suffix}`));
    expect(String((editAudit?.changes as { summary?: string } | null)?.summary ?? "")).toContain("Maxwell Tollefson");
    expect(String((editAudit?.changes as { summary?: string } | null)?.summary ?? "")).toContain("changed");
    const deleteAudit = audits.find((row) => String((row.changes as { summary?: string } | null)?.summary ?? "").includes("deleted"));
    expect(String((deleteAudit?.changes as { summary?: string } | null)?.summary ?? "")).toContain("row 6");

    const file = await request(app)
      .get("/controlled-lists/lst-eng-001/xlsx")
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(file.body as Buffer);
    const ws = book.getWorksheet(engName);
    expect(ws?.getCell("H2").value).toBe(`Ada ${suffix}`);
    expect(ws?.getCell("F6").value).toBe(`Height ${suffix}`);
    expect(ws?.getCell("A6").value).toBe("ECR-2026-001");

    const schedule = await request(app)
      .put("/controlled-lists/lst-gen-002")
      .set("Authorization", `Bearer ${token}`)
      .send({ sheets: [{ name: "LST-GEN-002 - Internal Audit Sc", cells: { F3: { v: `Owner ${suffix}` }, A1: { v: "INTERNAL AUDIT SCHEDULE" } } }] });
    expect(schedule.status).toBe(200);
    expect(schedule.body.revision).toBe("A");
    expect(schedule.body.sheets[0].cells.F3.v).toBe(`Owner ${suffix}`);
    expect(schedule.body.sheets[0].cells.D2.v).toBe("A");

    const ncr = await request(app)
      .put("/controlled-lists/lst-ncr-001")
      .set("Authorization", `Bearer ${token}`)
      .send({ sheets: [{ name: "LST-NCR-001 - NCR", cells: { D5: { v: `Defect ${suffix}` } } }] });
    expect(ncr.status).toBe(200);
    expect(ncr.body.revision).toBe("G");
    expect(ncr.body.sheets[0].cells.D5.v).toBe(`Defect ${suffix}`);
    expect(ncr.body.sheets[0].cells.A5.v).toBe("NCR-2026-001");
    expect(ncr.body.sheets[0].cells.B2.v).toBe("Rev: E");
    const ncrInsert = await request(app)
      .post("/controlled-lists/lst-ncr-001/rows")
      .set("Authorization", `Bearer ${token}`)
      .send({ sheet: "LST-NCR-001 - NCR", op: "insert", row: 5, place: "below" });
    expect(ncrInsert.status).toBe(200);
    expect(ncrInsert.body.sheets[0].cells.A5.v).toBe("NCR-2026-001");
    expect(ncrInsert.body.sheets[0].cells.A6).toBeUndefined();
    const ncrDelete = await request(app)
      .post("/controlled-lists/lst-ncr-001/rows")
      .set("Authorization", `Bearer ${token}`)
      .send({ sheet: "LST-NCR-001 - NCR", op: "delete", rows: [6] });
    expect(ncrDelete.status).toBe(200);
    expect(ncrDelete.body.sheets[0].cells.A5.v).toBe("NCR-2026-001");
    expect(ncrDelete.body.sheets[0].cells.D5.v).toBe(`Defect ${suffix}`);

    await db.insert(roles).values({ name: `list-reader-${suffix}`, description: "No structure edits", hierarchyLevel: 80, isProtected: false, permissions: [] });
    const [reader] = await db.insert(users).values({ email: `list-reader-${suffix}@test.local`, name: "List Reader", passwordHash: "unused" }).returning();
    const readerToken = signAccessToken({ sub: String(reader!.id), roleId: null, roleName: `list-reader-${suffix}`, department: "production" });
    const readerView = await request(app).get("/controlled-lists/lst-eng-001").set("Authorization", `Bearer ${readerToken}`);
    expect(readerView.status).toBe(200);
    expect(readerView.body.canEditStructure).toBe(false);
    const denied = await request(app)
      .post("/controlled-lists/lst-eng-001/columns")
      .set("Authorization", `Bearer ${readerToken}`)
      .send({ sheet: engName, op: "rename", col: "A", name: "Request" });
    expect(denied.status).toBe(403);
    expect((await request(app).get("/controlled-lists/lst-eng-001").set("Authorization", `Bearer ${token}`)).body.sheets[0].cells.A5.v).toBe("ECR Number");

    await db
      .update(departmentPermissions)
      .set({ accessLevel: "none" })
      .where(and(eq(departmentPermissions.departmentName, "quality"), eq(departmentPermissions.moduleName, "form_builder")));
    const qualityDenied = await request(app)
      .post("/controlled-lists/lst-eng-001/columns")
      .set("Authorization", `Bearer ${token}`)
      .send({ sheet: engName, op: "rename", col: "A", name: "Request" });
    expect(qualityDenied.status).toBe(403);
    expect((await request(app).get("/controlled-lists/lst-eng-001").set("Authorization", `Bearer ${token}`)).body.canEditStructure).toBe(false);

    await db.insert(roles).values({ name: `list-builder-${suffix}`, description: "Builds forms", hierarchyLevel: 70, isProtected: false, permissions: ["form_builder"] });
    const [builder] = await db.insert(users).values({ email: `list-builder-${suffix}@test.local`, name: "List Builder", passwordHash: "unused" }).returning();
    const builderToken = signAccessToken({ sub: String(builder!.id), roleId: null, roleName: `list-builder-${suffix}`, department: "quality" });
    const renamed = await request(app)
      .post("/controlled-lists/lst-eng-001/columns")
      .set("Authorization", `Bearer ${builderToken}`)
      .send({ sheet: engName, op: "rename", col: "A", name: `Request ${suffix}` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.canEditStructure).toBe(true);
    expect(renamed.body.revision).toBe("B");
    expect(renamed.body.sheets[0].cells.A5.v).toBe(`Request ${suffix}`);
    expect(renamed.body.sheets[0].cells.D2.v).toBe("B");
    expect(renamed.body.sheets[0].cells.A6.v).toBe("ECR-2026-001");
    expect(renamed.body.sheets[0].cells.H2.v).toBe(`Ada ${suffix}`);
    const structureAudit = (await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "ControlledList"), eq(auditTrail.entityId, opened.body.id)))).find((row) =>
      String((row.changes as { summary?: string } | null)?.summary ?? "").includes(`Request ${suffix}`),
    );
    expect(String((structureAudit?.changes as { summary?: string } | null)?.summary ?? "")).toContain("Revision moved from A to B");
  });
});
