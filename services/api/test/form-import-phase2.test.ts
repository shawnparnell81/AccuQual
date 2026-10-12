import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { auditTrail } from "../src/drizzle/schema/auditTrail.js";
import { importMappings } from "../src/drizzle/schema/importMappings.js";
import { qualityEngineeringReports } from "../src/drizzle/schema/qualityEngineeringReport.js";
import { users } from "../src/drizzle/schema/users.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { ensureTestCompany } from "./helpers/company.js";
import { seedDefaultPermissions } from "./helpers/seedDefaults.js";
import { extractFile } from "../src/modules/form-import/extract.js";
import { proposeMonthlyQuality, toSupplierData } from "../src/modules/form-import/reportTargets/monthlyQuality.js";
import { officePackage } from "../src/modules/form-builder/docx.js";
import { mergeUploadNarrative, emptyNarrative } from "../src/modules/quality-engineering-report/model.js";
import { parseSupplierFile } from "../src/modules/quality-engineering-report/supplierParse.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const docxPath = join(fixturesDir, "monthly-quality-report-september-2026.docx");
const csvPath = join(fixturesDir, "quality-engineering-supplier-september-2026.csv");

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let qualityToken: string;
let noAccessToken: string;

async function makeUser(department: string | null, label: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `import-phase2-${label}-${suffix}@test.local`, passwordHash: "unused" })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

function paragraphXml(style: string | undefined, text: string): string {
  const props = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${props}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

/** A tiny synthetic docx with the same labels as the real fixture but different values and order. */
function reorderedDocx(): Buffer {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphXml("Title", "Monthly Quality Report - October 2026")}
    ${paragraphXml("Heading2", "6.7 - Recalls")}
    ${paragraphXml(undefined, "A different recall note entirely")}
    ${paragraphXml("Heading2", "6.1 Executive Summary")}
    ${paragraphXml(undefined, "Status of Department: Red")}
  </w:body>
</w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  return officePackage([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes) },
    { name: "_rels/.rels", data: Buffer.from(rels) },
    { name: "word/document.xml", data: Buffer.from(document) },
  ]);
}

describe("import from file phase 2: report targets + saved mappings", () => {
  beforeAll(async () => {
    const company = await ensureTestCompany();
    await seedDefaultPermissions(company!.id);
    qualityToken = await makeUser("quality", "quality");
    noAccessToken = await makeUser(null, "none");
  });

  it("lists the Monthly Quality Report as an import target", async () => {
    const res = await request(app).get("/form-import/targets").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    const target = res.body.targets.find((t: { ref: string }) => t.ref === "report:monthly-quality");
    expect(target).toBeTruthy();
    expect(target.title).toBe("Monthly Quality Report");
  });

  describe("ACCEPTANCE: the real September report", () => {
    it("round-trips to exactly the same SupplierData parseSupplierFile produces", async () => {
      const docx = readFileSync(docxPath);
      const extracted = await extractFile(docx, "monthly-quality-report-september-2026.docx");
      const { proposals } = proposeMonthlyQuality(extracted);
      const values = Object.fromEntries(proposals.map((p) => [p.key, p.value]));
      const mine = toSupplierData(values, 2026);

      const csv = readFileSync(csvPath);
      const expected = (await parseSupplierFile(csv, "x.csv", 2026)).data;
      expect(mine).toEqual(expected);

      const n1 = mergeUploadNarrative(emptyNarrative(), mine, true);
      const n2 = mergeUploadNarrative(emptyNarrative(), expected, true);
      expect(n1).toEqual(n2);
      expect(n1.departmentStatus).toBe("yellow");
      expect(n1.fitment).toHaveLength(1);
      expect(n1.productInfo).toHaveLength(2);
    });
  });

  it("does not write to the database while extracting or proposing", async () => {
    const docx = readFileSync(docxPath);
    const before = await db.select().from(qualityEngineeringReports);
    const extractRes = await request(app).post("/form-import/extract").set("Authorization", `Bearer ${qualityToken}`).attach("file", docx, "x.docx");
    await request(app)
      .post("/form-import/propose")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ targetRef: "report:monthly-quality", extracted: extractRes.body.extracted });
    const after = await db.select().from(qualityEngineeringReports);
    expect(after).toHaveLength(before.length);
  });

  it("confirms one quality_engineering_reports row and one audit row; denies a user without engineering access", async () => {
    const docx = readFileSync(docxPath);
    const extractRes = await request(app).post("/form-import/extract").set("Authorization", `Bearer ${qualityToken}`).attach("file", docx, "x.docx");
    const proposeRes = await request(app)
      .post("/form-import/propose")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ targetRef: "report:monthly-quality", extracted: extractRes.body.extracted });
    expect(proposeRes.status).toBe(200);
    const values = Object.fromEntries(proposeRes.body.proposals.map((p: { key: string; value: unknown }) => [p.key, p.value]));

    const denied = await request(app)
      .post("/form-import/confirm")
      .set("Authorization", `Bearer ${noAccessToken}`)
      .send({ targetRef: "report:monthly-quality", fileName: "x.docx", year: 2026, month: 9, values });
    expect(denied.status).toBe(403);

    const confirmRes = await request(app)
      .post("/form-import/confirm")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ targetRef: "report:monthly-quality", fileName: "monthly-quality-report-september-2026.docx", year: 2026, month: 9, replaceNotes: true, values, edited: 0 });
    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body.openPath).toBe("/reporting");

    const rows = await db.select().from(qualityEngineeringReports).where(and(eq(qualityEngineeringReports.year, 2026), eq(qualityEngineeringReports.month, 9)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.uploadFileName).toBe("monthly-quality-report-september-2026.docx");

    const auditRows = await db
      .select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityType, "QualityEngineeringReport"), eq(auditTrail.entityId, rows[0]!.id), eq(auditTrail.action, "update")));
    expect(auditRows).toHaveLength(1);
    const summary = (auditRows[0]!.changes as { summary?: string }).summary ?? "";
    expect(summary).toContain("September 2026");
    expect(summary).toContain("monthly-quality-report-september-2026.docx");
    expect(summary).not.toMatch(/#\d+|\bid[: ]\d+/i);
  });

  describe("saved mappings", () => {
    it("applies a saved mapping to a reordered, revalued second file and reports reason 'saved mapping'", async () => {
      const docx = readFileSync(docxPath);
      const extractRes = await request(app).post("/form-import/extract").set("Authorization", `Bearer ${qualityToken}`).attach("file", docx, "x.docx");

      const saved = await request(app)
        .post("/form-import/mappings")
        .set("Authorization", `Bearer ${qualityToken}`)
        .send({
          targetRef: "report:monthly-quality",
          fileKind: "docx",
          name: `Standard layout ${suffix}`,
          entries: {
            "executive.department_status": { rule: "label", source: "Status of Department" },
            "notes.recalls": { rule: "heading", source: "Recalls" },
          },
        });
      expect(saved.status).toBe(201);
      expect(Object.values(saved.body.entries as Record<string, unknown>).every((entry) => !("value" in (entry as object)))).toBe(true);

      const secondExtractRes = await request(app).post("/form-import/extract").set("Authorization", `Bearer ${qualityToken}`).attach("file", reorderedDocx(), "y.docx");
      const proposeRes = await request(app)
        .post("/form-import/propose")
        .set("Authorization", `Bearer ${qualityToken}`)
        .send({ targetRef: "report:monthly-quality", extracted: secondExtractRes.body.extracted });
      expect(proposeRes.status).toBe(200);
      const byKey = new Map(proposeRes.body.proposals.map((p: { key: string; value: unknown; reason: string }) => [p.key, p]));
      expect((byKey.get("executive.department_status") as { value: unknown; reason: string }).value).toBe("red");
      expect((byKey.get("executive.department_status") as { value: unknown; reason: string }).reason).toBe("saved mapping");
      expect((byKey.get("notes.recalls") as { value: unknown; reason: string }).value).toBe("A different recall note entirely");
      expect((byKey.get("notes.recalls") as { value: unknown; reason: string }).reason).toBe("saved mapping");

      // Unchanged against the original docx too.
      const firstProposeAgain = await request(app)
        .post("/form-import/propose")
        .set("Authorization", `Bearer ${qualityToken}`)
        .send({ targetRef: "report:monthly-quality", extracted: extractRes.body.extracted });
      const byKeyFirst = new Map(firstProposeAgain.body.proposals.map((p: { key: string; reason: string }) => [p.key, p]));
      expect((byKeyFirst.get("executive.department_status") as { reason: string }).reason).toBe("saved mapping");

      const renamed = await request(app)
        .patch(`/form-import/mappings/${saved.body.id}`)
        .set("Authorization", `Bearer ${qualityToken}`)
        .send({ name: `Renamed layout ${suffix}` });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe(`Renamed layout ${suffix}`);

      const deleted = await request(app).delete(`/form-import/mappings/${saved.body.id}`).set("Authorization", `Bearer ${qualityToken}`);
      expect(deleted.status).toBe(204);

      const auditRows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "ImportMapping"), eq(auditTrail.entityId, saved.body.id)));
      expect(auditRows.map((row) => row.action).sort()).toEqual(["create", "delete", "update"]);
      expect(auditRows).toHaveLength(3);
    });

    it("rejects a duplicate mapping name for the same target and file kind", async () => {
      const name = `Dup layout ${suffix}`;
      const first = await request(app)
        .post("/form-import/mappings")
        .set("Authorization", `Bearer ${qualityToken}`)
        .send({ targetRef: "report:monthly-quality", fileKind: "docx", name, entries: { "notes.recalls": { rule: "heading", source: "Recalls" } } });
      expect(first.status).toBe(201);
      const second = await request(app)
        .post("/form-import/mappings")
        .set("Authorization", `Bearer ${qualityToken}`)
        .send({ targetRef: "report:monthly-quality", fileKind: "docx", name, entries: {} });
      expect(second.status).toBe(409);
      await db.delete(importMappings).where(eq(importMappings.id, first.body.id));
    });
  });
});
