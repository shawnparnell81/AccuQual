import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { auditTrail } from "../src/drizzle/schema/auditTrail.js";
import { builtFormFills, builtForms } from "../src/drizzle/schema/builtForms.js";
import { users } from "../src/drizzle/schema/users.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { ensureTestCompany } from "./helpers/company.js";
import { seedDefaultPermissions } from "./helpers/seedDefaults.js";
import { extractFile } from "../src/modules/form-import/extract.js";
import { proposeValues } from "../src/modules/form-import/propose.js";
import { targetFields } from "../src/modules/form-import/targets.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const docxPath = join(fixturesDir, "monthly-quality-report-september-2026.docx");

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let qualityToken: string;
let noAccessToken: string;

async function makeUser(department: string | null, label: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `generic-import-${label}-${suffix}@test.local`, passwordHash: "unused" })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

const TOP_PARTS_ROWS = [
  ["A30059", "Precision Fuel Pump", "10"],
  ["A33220", "Precision Fuel Pump", "9"],
  ["A60076", "Precision Fuel Pump", "9"],
  ["A30378", "Precision Fuel Pump", "7"],
  ["A47104", "Precision Fuel Pump", "5"],
  ["A33007", "Precision Fuel Pump", "5"],
  ["A30110", "Precision Fuel Pump", "5"],
  ["A46087", "Precision Fuel Pump", "5"],
  ["43GM1000PS", "Precision Fuel Pump", "5"],
  ["A30523", "Precision Fuel Pump", "5"],
];

const FAI_ROWS = [
  ["Fuel & Lift Supports", "358", "211", "129", "18"],
  ["CSAs & Shocks", "46", "15", "31", "0"],
  ["Brake Wear Sensors", "3", "3", "0", "0"],
];

const RCA_TEXT =
  "Vehicle-Specific Failure Mode: Precision Fuel Pumps (A30059, A33220, A60076, A30378) and Complete Strut Assemblies (CSAs) represent the highest return volume. Claim comments for September frequently cite fuel pumps failing to build pressure immediately after installation, incorrect fuel level sender readings, and CSAs making squeaking or clunking noises over bumps, indicating potential bearing tolerances or mount friction.\n\n" +
  "Early Life Failure: The median time for failure remained low at 42.0 days in September (compared to 41.0 days in August). This indicates a continuing pattern of out-of-box defects or installer misdiagnoses that require close supplier and technical monitoring.";

const RECOMMENDATION_TEXT =
  "Vendor Quality Audit: Initiate internal audits on bearing tolerances for Complete Strut Assemblies and pressure regulator calibration / float arm rheostats for the Precision fuel pump line.\n\n" +
  "Installation Verification: With the median lifespan holding near 42.0 days, expand technical support outreach to stores and installers regarding wiring harness pinouts and pre-installation tank cleaning to rule out external contamination or improper electrical hookups.";

const REPORT_FIELDS = [
  { id: "status", label: "Status of Department", sectionId: "s1", type: "text" as const },
  { id: "achievement", label: "Primary Achievement", sectionId: "s1", type: "multiline" as const },
  { id: "totalClaims", label: "Total Claims", sectionId: "s1", type: "text" as const },
  { id: "totalAlerts", label: "Total Product Alerts", sectionId: "s1", type: "text" as const },
  { id: "open", label: "Open", sectionId: "s1", type: "text" as const },
  { id: "hours", label: "Hours Spent Investigating", sectionId: "s1", type: "text" as const },
  { id: "avgClose", label: "Avg time to close", sectionId: "s1", type: "text" as const },
  { id: "rca", label: "Root Cause Analysis", sectionId: "s1", type: "multiline" as const },
  { id: "recommendation", label: "Recommendation", sectionId: "s1", type: "multiline" as const },
  { id: "quarantine", label: "Quarantine", sectionId: "s1", type: "multiline" as const },
  { id: "recalls", label: "Recalls", sectionId: "s1", type: "multiline" as const },
  {
    id: "topParts",
    label: "Top Returning Parts",
    sectionId: "s1",
    type: "table" as const,
    columns: [
      { id: "part", label: "Part Number" },
      { id: "desc", label: "Description / Application" },
      { id: "claims", label: "Total Claims" },
    ],
  },
  {
    id: "fai",
    label: "First Article Verifications",
    sectionId: "s1",
    type: "table" as const,
    columns: [
      { id: "cat", label: "Product Category" },
      { id: "completed", label: "Total Completed" },
      { id: "passed", label: "Passed" },
      { id: "failed", label: "Failed" },
      { id: "dev", label: "Passed w/ Deviation" },
    ],
  },
  { id: "sig", label: "Signature", sectionId: "s1", type: "signature" as const },
];

const REPORT_STRUCTURE = { kind: "fields", sections: [{ id: "s1", title: "Report" }], fields: REPORT_FIELDS };

async function createPublishedFieldsForm(title: string) {
  const [row] = await db
    .insert(builtForms)
    .values({ kind: "fields", title, formNumber: null, revision: "A", status: "published", structure: REPORT_STRUCTURE, publishedStructure: REPORT_STRUCTURE })
    .returning();
  return row!;
}

describe("generic import from file", () => {
  beforeAll(async () => {
    const company = await ensureTestCompany();
    await seedDefaultPermissions(company!.id);
    qualityToken = await makeUser("quality", "quality");
    noAccessToken = await makeUser(null, "none");
  });

  it("extracts structure from the real September report", async () => {
    const buffer = readFileSync(docxPath);
    const res = await request(app).post("/form-import/extract").set("Authorization", `Bearer ${qualityToken}`).attach("file", buffer, "monthly-quality-report-september-2026.docx");
    expect(res.status).toBe(200);
    const extracted = res.body.extracted;
    expect(extracted.title).toBe("Monthly Quality Report - September 2026");
    expect(extracted.images).toBe(4);
    const tables = extracted.blocks.filter((block: { kind: string }) => block.kind === "table");
    expect(tables).toHaveLength(6);
    expect(tables.map((table: { rows: string[][] }) => table.rows[0]![0])).toEqual(["Metric", "Financial Category", "Warranty Metric", "Part Number", "Product Category", "NCR Number"]);
    const headings = extracted.blocks.filter((block: { kind: string }) => block.kind === "heading").map((block: { text: string }) => block.text);
    expect(headings.some((text: string) => text.startsWith("6.1 Executive Summary"))).toBe(true);
    expect(headings.some((text: string) => text.includes("6.13"))).toBe(true);
  });

  it("does not write to the database while extracting or proposing", async () => {
    const buffer = readFileSync(docxPath);
    const countsBefore = await Promise.all([db.select().from(builtFormFills), db.select().from(auditTrail)]);
    const extractRes = await request(app).post("/form-import/extract").set("Authorization", `Bearer ${qualityToken}`).attach("file", buffer, "monthly-quality-report-september-2026.docx");
    const form = await createPublishedFieldsForm(`Safety check ${suffix}`);
    await request(app)
      .post("/form-import/propose")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ targetRef: `built:${form.id}`, extracted: extractRes.body.extracted });
    const countsAfter = await Promise.all([db.select().from(builtFormFills), db.select().from(auditTrail)]);
    expect(countsAfter[0]).toHaveLength(countsBefore[0].length);
    expect(countsAfter[1]).toHaveLength(countsBefore[1].length);
  });

  it("rejects a renamed file whose contents don't match", async () => {
    const res = await request(app)
      .post("/form-import/extract")
      .set("Authorization", `Bearer ${qualityToken}`)
      .attach("file", Buffer.from("MZ\x90\x00not really a docx"), "evil.docx");
    expect(res.status).toBe(400);
  });

  describe("ACCEPTANCE: the real September monthly report", () => {
    it("proposes exact values and saves a filled copy without touching the template", async () => {
      const form = await createPublishedFieldsForm(`Monthly Quality Report ${suffix}`);

      const buffer = readFileSync(docxPath);
      const extractRes = await request(app).post("/form-import/extract").set("Authorization", `Bearer ${qualityToken}`).attach("file", buffer, "monthly-quality-report-september-2026.docx");
      expect(extractRes.status).toBe(200);

      const proposeRes = await request(app)
        .post("/form-import/propose")
        .set("Authorization", `Bearer ${qualityToken}`)
        .send({ targetRef: `built:${form.id}`, extracted: extractRes.body.extracted });
      expect(proposeRes.status).toBe(200);

      const fieldKeys = proposeRes.body.fields.map((field: { key: string }) => field.key);
      expect(fieldKeys).not.toContain("sig");

      const byKey = Object.fromEntries(proposeRes.body.proposals.map((p: { key: string; value: unknown }) => [p.key, p.value]));
      expect(byKey.status).toBe("Yellow");
      expect(byKey.achievement).toBe("Closed out 23 O'Reilly Product Alerts with an average resolution speed of 2.45 days; processed 217 claims through initial review.");
      expect(byKey.totalClaims).toBe("461 (Raw Export) / 220 (Tracker Processed)");
      expect(byKey.totalAlerts).toBe("28");
      expect(byKey.open).toBe("8");
      expect(byKey.hours).toBe("19.50");
      expect(byKey.avgClose).toBe("2.45 days");
      expect(byKey.rca).toBe(RCA_TEXT);
      expect(byKey.recommendation).toBe(RECOMMENDATION_TEXT);
      expect(byKey.recalls).toBe("No new recalls");
      expect(byKey.topParts).toEqual(TOP_PARTS_ROWS);
      expect(byKey.fai).toEqual(FAI_ROWS);

      const beforeForm = (await db.select().from(builtForms).where(eq(builtForms.id, form.id)))[0]!;

      const confirmRes = await request(app)
        .post("/form-import/confirm")
        .set("Authorization", `Bearer ${qualityToken}`)
        .send({
          targetRef: `built:${form.id}`,
          fileName: "monthly-quality-report-september-2026.docx",
          title: "September Monthly Quality Report",
          values: byKey,
          edited: 0,
        });
      expect(confirmRes.status).toBe(201);
      expect(confirmRes.body.openPath).toMatch(/^\/form-builder\/fills\/\d+$/);
      const fillId = Number(confirmRes.body.openPath.split("/").pop());

      const [fill] = await db.select().from(builtFormFills).where(eq(builtFormFills.id, fillId));
      expect(fill?.answers).toEqual(byKey);
      expect(fill?.recordNumber ?? null).toBeNull();

      const afterForm = (await db.select().from(builtForms).where(eq(builtForms.id, form.id)))[0]!;
      expect(afterForm.revision).toBe(beforeForm.revision);
      expect(afterForm.structure).toEqual(beforeForm.structure);
      expect(afterForm.updatedAt?.getTime() ?? null).toBe(beforeForm.updatedAt?.getTime() ?? null);

      const auditRows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "BuiltFormFill"), eq(auditTrail.entityId, fillId), eq(auditTrail.action, "create")));
      expect(auditRows).toHaveLength(1);
      const summary = (auditRows[0]!.changes as { summary?: string }).summary ?? "";
      expect(summary).toContain("monthly-quality-report-september-2026.docx");
      expect(summary).toContain(form.title);
      expect(summary).toContain("Rev");
      expect(summary).not.toMatch(/#\d+|\bid[: ]\d+/i);
    });
  });

  it("maps a grid target's label cell to the right scalar value", async () => {
    const extracted = await extractFile(readFileSync(docxPath), "monthly-quality-report-september-2026.docx");
    const gridStructure = {
      kind: "grid",
      sheets: [{ name: "Sheet1", cells: [[{ value: "Total Claims", locked: true }, { value: "", locked: false }]] }],
    };
    const fields = targetFields(gridStructure);
    expect(fields).toEqual([{ key: "0!B1", label: "Total Claims", group: "Sheet1", type: "text" }]);
    const proposals = proposeValues(extracted, fields);
    expect(proposals[0]!.value).toBe("461 (Raw Export) / 220 (Tracker Processed)");
  });

  it("maps a document target's inline field to the matching heading section", async () => {
    const extracted = await extractFile(readFileSync(docxPath), "monthly-quality-report-september-2026.docx");
    const docStructure = { kind: "document", html: '<p>Notes: <span class="fb-inline-field" data-fill-field="f1" data-label="Recalls">Recalls</span></p>' };
    const fields = targetFields(docStructure);
    expect(fields).toEqual([{ key: "f1", label: "Recalls", group: "Document", type: "text" }]);
    const proposals = proposeValues(extracted, fields);
    expect(proposals[0]!.value).toBe("No new recalls");
  });

  it("maps xlsx named cells and adjacent label/value pairs; keeps N/A as written; leaves unmatched fields null", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data");
    sheet.getCell("B1").value = 500;
    workbook.definedNames.add("Data!$B$1", "TotalClaims");
    sheet.getCell("A5").value = "Supplier";
    sheet.getCell("B5").value = "Acme";
    sheet.getCell("A6").value = "Status";
    sheet.getCell("B6").value = "N/A";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const extracted = await extractFile(buffer, "data.xlsx");
    const fields = [
      { key: "totalClaims", label: "Total Claims", group: "General", type: "text" as const },
      { key: "supplier", label: "Supplier", group: "General", type: "text" as const },
      { key: "status", label: "Status", group: "General", type: "text" as const },
      { key: "nothing", label: "Nothing Like This Anywhere", group: "General", type: "text" as const },
    ];
    const proposals = proposeValues(extracted, fields);
    const byKey = Object.fromEntries(proposals.map((p) => [p.key, p.value]));
    expect(byKey.totalClaims).toBe("500");
    expect(byKey.supplier).toBe("Acme");
    expect(byKey.status).toBe("N/A");
    expect(byKey.nothing).toBeNull();
    const nothingProposal = proposals.find((p) => p.key === "nothing")!;
    expect(nothingProposal.reason).toBe("no match");
  });

  it("maps a csv's header row onto a table-type field", async () => {
    const csv = "Part Number,Description,Total Claims\nA1,Widget,10\nA2,Gadget,5\n";
    const extracted = await extractFile(Buffer.from(csv), "parts.csv");
    const fields = [
      {
        key: "items",
        label: "Items",
        group: "General",
        type: "table" as const,
        columns: [
          { id: "part", label: "Part Number" },
          { id: "desc", label: "Description" },
          { id: "claims", label: "Total Claims" },
        ],
      },
    ];
    const proposals = proposeValues(extracted, fields);
    expect(proposals[0]!.value).toEqual([
      ["A1", "Widget", "10"],
      ["A2", "Gadget", "5"],
    ]);
  });

  it("rejects an unknown field key on confirm", async () => {
    const form = await createPublishedFieldsForm(`Unknown key check ${suffix}`);
    const res = await request(app)
      .post("/form-import/confirm")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ targetRef: `built:${form.id}`, fileName: "x.docx", values: { notAField: "x" } });
    expect(res.status).toBe(400);
  });

  it("denies a user without fill access", async () => {
    const form = await createPublishedFieldsForm(`No access check ${suffix}`);
    const res = await request(app)
      .post("/form-import/confirm")
      .set("Authorization", `Bearer ${noAccessToken}`)
      .send({ targetRef: `built:${form.id}`, fileName: "x.docx", values: {} });
    expect(res.status).toBe(403);
  });
});
