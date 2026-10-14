import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { and, eq, inArray, like } from "drizzle-orm";
import { ensureTestCompany } from "./helpers/company.js";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { users } from "../src/drizzle/schema/users.js";
import { roles } from "../src/drizzle/schema/roles.js";
import { auditTrail } from "../src/drizzle/schema/auditTrail.js";
import { qualityEngineeringReports } from "../src/drizzle/schema/qualityEngineeringReport.js";
import { monthlySourceMonths, monthlySourceRows, monthlySourceUploads } from "../src/drizzle/schema/monthlySourceRows.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { seedDefaultPermissions, seedTestRoles } from "./helpers/seedDefaults.js";
import { setTestPin, TEST_PIN } from "./helpers/signaturePin.js";
import { parseSourceWorkbook } from "../src/modules/quality-engineering-report/sourceParse.js";
import { mergeSourceFigures, sourceMonthFigures } from "../src/modules/quality-engineering-report/sourceReport.js";
import { emptySupplierData } from "../src/modules/quality-engineering-report/model.js";
import { updateRoleSchema } from "../src/modules/roles/roles.validation.js";

// Months far from any real report so this suite never touches other data.
const YEAR = 2031;
const MONTHS = ["2031-01", "2031-02", "2031-03"];
const VERIFY = "quality_report.verify";
const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const userIds: number[] = [];
let editorToken: string;
let plainToken: string;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** A product-alert workbook laid out like DMA's (title rows above the header) plus an NCR log tab. */
async function workbook(alerts: [number, string, number, string, number | null][], ncrs: [string, string, string][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const pa = book.addWorksheet("Oreilly");
  pa.addRow(["O'Reilly product alerts"]);
  pa.addRow(["Product Alert#", "Date Received", "SKU", "Store #", "Engineer", "Issue", "Diagnosis", "Resolution", "Time Spent Investigating (hours)", "Status", "Date Completed", "Time for completion (days)"]);
  for (const [id, date, hours, status, days] of alerts) pa.addRow([id, d(date), "A1", 1, "JH", "x", "", "", hours, status, null, days]);
  pa.addRow([999999, d("1773-01-01"), "junk", 1, "", "", "", "", 5, "Final", null, 1]);
  const ncr = book.addWorksheet("LST-NCR-001 - NCR");
  ncr.addRow(["LST-NCR-001"]);
  ncr.addRow([]);
  ncr.addRow([]);
  ncr.addRow(["NCR Number", "Date Opened", "Part Number", "Description of Defect", "Supplier / Origin", "Disposition (Scrap, Rework, Use-As-Is)", "Cost ($)", "Time Spent (Hr)", "Related CAR #", "Related RPN#", "Status"]);
  for (const [number, date, status] of ncrs) ncr.addRow([number, d(date), "CS1", "Out of spec", "APM", "Use-As-Is", 0, null, "None", "None", status]);
  book.addWorksheet("Stats").addRow(["ignored", 1]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

const FIRST = await workbook(
  [
    [9100001, "2031-01-05", 1.5, "Final", 2],
    [9100002, "2031-01-20", 2, "Open", null],
    [9100003, "2031-03-02", 1, "Final", 4],
  ],
  [
    ["NCR-2031-001", "2031-01-07", "Closed"],
    ["NCR-2031-002", "2031-03-09", "Open"],
  ],
);

async function makeUser(roleName: string, label: string) {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, roleName));
  const [user] = await db
    .insert(users)
    .values({ email: `msrc-${label}-${suffix}@test.local`, passwordHash: "unused", department: "quality", roleId: role?.id ?? null, name: `Source Tester ${label}` })
    .returning();
  userIds.push(user!.id);
  await setTestPin(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department: "quality" });
}

async function wipe() {
  await db.delete(monthlySourceRows).where(inArray(monthlySourceRows.month, MONTHS));
  await db.delete(monthlySourceMonths).where(inArray(monthlySourceMonths.month, MONTHS));
  await db.delete(monthlySourceUploads).where(like(monthlySourceUploads.fileName, `msrc-%`));
  await db.delete(qualityEngineeringReports).where(eq(qualityEngineeringReports.year, YEAR));
}

const send = (path: string, token: string, file: Buffer, name = `msrc-${suffix}.xlsx`) => request(app).post(path).set(bearer(token)).attach("file", file, name);
const report = (token: string, month: number) => request(app).get("/reports/engineering").query({ year: YEAR, month }).set(bearer(token));
const rowsIn = (month: string) => db.select().from(monthlySourceRows).where(eq(monthlySourceRows.month, month));

beforeAll(async () => {
  const co = await ensureTestCompany();
  await seedDefaultPermissions(co!.id);
  await seedTestRoles();
  const [lead] = await db.select().from(roles).where(eq(roles.name, "lead"));
  if (lead) await db.update(roles).set({ permissions: [...new Set([...(lead.permissions ?? []), VERIFY])] }).where(eq(roles.id, lead.id));
  const [operator] = await db.select().from(roles).where(eq(roles.name, "operator"));
  if (operator) await db.update(roles).set({ permissions: (operator.permissions ?? []).filter((item) => item !== VERIFY) }).where(eq(roles.id, operator.id));
  editorToken = await makeUser("lead", "editor");
  plainToken = await makeUser("operator", "plain");
  await wipe();
});

afterAll(async () => {
  await wipe();
  const [lead] = await db.select().from(roles).where(eq(roles.name, "lead"));
  if (lead) await db.update(roles).set({ permissions: (lead.permissions ?? []).filter((item) => item !== VERIFY) }).where(eq(roles.id, lead.id));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

describe("monthly source parser", () => {
  it("recognizes each tab by its header row, files rows by their own date and skips junk dates", async () => {
    const parsed = await parseSourceWorkbook(FIRST, "anything.xlsx");
    expect(parsed.sheets.map((sheet) => [sheet.sheet, sheet.kind])).toEqual([
      ["Oreilly", "product_alerts"],
      ["LST-NCR-001 - NCR", "ncr"],
      ["Stats", null],
    ]);
    expect(parsed.sheets[0]!.undated).toBe(1);
    const alerts = parsed.rows.filter((row) => row.source === "product_alerts");
    expect(alerts.map((row) => row.month)).toEqual(["2031-01", "2031-01", "2031-03"]);
    expect(alerts[0]!.rowKey).toBe("9100001");
  });

  it("refuses a workbook with no recognized header", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("x").addRow(["a", "b"]);
    await expect(parseSourceWorkbook(Buffer.from(await book.xlsx.writeBuffer()), "x.xlsx")).rejects.toThrow(/No monthly source rows/);
  });
});

describe("no carry-forward", () => {
  const rows = [
    { source: "product_alerts", month: "2031-01", data: { product_alert: 1, time_spent_investigating_hours: 2, status: "Final", time_for_completion_days: 3, __date: "2031-01-02" } },
    { source: "product_alerts", month: "2031-03", data: { product_alert: 2, time_spent_investigating_hours: 1, status: "Open", __date: "2031-03-02" } },
  ];
  const spans = new Map([["product_alerts", { first: "2031-01", last: "2031-03" }]]);
  it("a month inside the file's span with no rows reads zero, never the previous month's figures", () => {
    const feb = sourceMonthFigures(rows, MONTHS.slice(0, 2), "2031-02", spans);
    expect(feb.supplier.productAlerts).toEqual({ total: 0, open: 0, hoursSpent: 0, avgDaysToClose: null });
    expect(feb.supplier.monthlyMetrics.find((row) => row.month === "2031-01")?.totalProductAlerts).toBe(1);
    expect(feb.supplier.monthlyMetrics.find((row) => row.month === "2031-02")?.totalProductAlerts).toBe(0);
  });
  it("a month outside every file's span stays blank, and the uploaded report keeps its own figures", () => {
    const later = sourceMonthFigures(rows, ["2031-06"], "2031-06", spans);
    expect(later.supplier.productAlerts).toBeNull();
    expect(later.supplier.monthlyMetrics).toEqual([]);
    const merged = mergeSourceFigures({ ...emptySupplierData(), productAlerts: { total: 28, open: 8, hoursSpent: null, avgDaysToClose: 2.45 } }, sourceMonthFigures(rows, ["2031-01"], "2031-01", spans).supplier);
    expect(merged.productAlerts).toEqual({ total: 28, open: 8, hoursSpent: 2, avgDaysToClose: 2.45 });
  });
});

describe("monthly source import", () => {
  it("previews without writing, then stores rows per month with an audit entry", async () => {
    const preview = await send("/reports/engineering/sources/preview", editorToken, FIRST);
    expect(preview.status).toBe(200);
    expect(preview.body.added).toBe(5);
    expect(await rowsIn("2031-01")).toHaveLength(0);

    const commit = await send("/reports/engineering/sources", editorToken, FIRST);
    expect(commit.status).toBe(200);
    expect((await rowsIn("2031-01")).length).toBe(3);
    expect((await rowsIn("2031-03")).length).toBe(2);
    const [entry] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "MonthlySourceUpload"), eq(auditTrail.entityId, commit.body.uploadId)));
    expect(String((entry!.changes as { summary: string }).summary)).toMatch(/5 added, 0 updated, 0 removed/);
  });

  it("a re-upload updates by row key and replaces the months it covers, never duplicating", async () => {
    const second = await workbook(
      [
        [9100001, "2031-01-05", 3, "Final", 2],
        [9100003, "2031-03-02", 1, "Final", 4],
      ],
      [["NCR-2031-001", "2031-01-07", "Closed"]],
    );
    const commit = await send("/reports/engineering/sources", editorToken, second);
    expect(commit.status).toBe(200);
    expect(commit.body.removed).toBe(1);
    const jan = await rowsIn("2031-01");
    expect(jan.filter((row) => row.source === "product_alerts").map((row) => row.rowKey)).toEqual(["9100001"]);
    expect(jan.find((row) => row.rowKey === "9100001")!.data.time_spent_investigating_hours).toBe(3);
    // March's NCR was not in this file's NCR months, so it stays.
    expect((await rowsIn("2031-03")).map((row) => row.source).sort()).toEqual(["ncr", "product_alerts"]);
  });

  it("builds a month only from its own rows: February is zero, not January carried forward", async () => {
    const feb = await report(editorToken, 2);
    expect(feb.status).toBe(200);
    expect(feb.body.productAlerts.total).toBe(0);
    expect(feb.body.sections.ncrTableRows).toEqual([]);
    expect(feb.body.charts.claimsReturns).toEqual([]);
    const jan = await report(editorToken, 1);
    expect(jan.body.productAlerts.total).toBe(1);
    expect(jan.body.sections.ncrTableRows.map((row: { ncrNumber: string }) => row.ncrNumber)).toEqual(["NCR-2031-001"]);
    expect(jan.body.live.ncr).toMatchObject({ status: "ok", data: { total: 1, open: 0, closed: 1 } });
  });
});

describe("verify a month", () => {
  it("is a role permission and needs a saved report and the person's PIN", async () => {
    expect(updateRoleSchema.safeParse({ permissions: [VERIFY] }).success).toBe(true);
    expect((await request(app).get("/permissions/effective").set(bearer(editorToken))).body[VERIFY]).toBe("edit");
    expect((await request(app).get("/permissions/effective").set(bearer(plainToken))).body[VERIFY]).toBe("none");
    const verify = (token: string, body: object) => request(app).post("/reports/engineering/verify").query({ year: YEAR, month: 1 }).set(bearer(token)).send(body);
    expect((await verify(editorToken, { pin: TEST_PIN })).status).toBe(400);
    await db.insert(qualityEngineeringReports).values({ year: YEAR, month: 1, narrative: {}, supplierData: {} });
    expect((await verify(plainToken, { pin: TEST_PIN })).status).toBe(403);
    expect((await verify(editorToken, {})).status).toBe(400);
    expect((await rowsIn("2031-01")).length).toBe(2);
  });

  it("deletes only that month's raw rows, keeps its totals for later trends, and audit-logs it", async () => {
    const res = await request(app).post("/reports/engineering/verify").query({ year: YEAR, month: 1 }).set(bearer(editorToken)).send({ pin: TEST_PIN });
    expect(res.status).toBe(200);
    expect(res.body.verification.verifiedAt).toBeTruthy();
    expect(await rowsIn("2031-01")).toHaveLength(0);
    expect((await rowsIn("2031-03")).length).toBe(2);
    const [kept] = await db.select().from(monthlySourceMonths).where(eq(monthlySourceMonths.month, "2031-01"));
    expect((kept!.figures as { rowCounts: Record<string, number> }).rowCounts).toEqual({ ncr: 1, product_alerts: 1 });
    // January still shows in its own report and in March's trend, from the kept totals.
    expect(res.body.productAlerts.total).toBe(1);
    expect(res.body.sections.ncrTableRows).toHaveLength(1);
    const mar = await report(editorToken, 3);
    const janIndex = mar.body.tables.months.findIndex((item: { key: string }) => item.key === "2031-01");
    expect(mar.body.tables.metrics.totalProductAlerts[janIndex]).toBe(1);
    const [row] = await db.select().from(qualityEngineeringReports).where(and(eq(qualityEngineeringReports.year, YEAR), eq(qualityEngineeringReports.month, 1)));
    const entries = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "QualityEngineeringReport"), eq(auditTrail.entityId, row!.id)));
    const text = entries.map((entry) => String((entry.changes as { summary?: string }).summary)).join(" ");
    expect(text).toMatch(/verified the January 2031 report and deleted its raw source data \(2 source rows: 1 ncr, 1 product alerts/);
    expect((await request(app).post("/reports/engineering/verify").query({ year: YEAR, month: 1 }).set(bearer(editorToken)).send({ pin: TEST_PIN })).status).toBe(400);
  });

  it("a later upload skips rows dated in a verified month", async () => {
    const preview = await send("/reports/engineering/sources/preview", editorToken, FIRST);
    expect(preview.body.skippedVerified).toEqual([{ month: "2031-01", rows: 3 }]);
    await send("/reports/engineering/sources", editorToken, FIRST);
    expect(await rowsIn("2031-01")).toHaveLength(0);
  });

  it("drops an upload's record once every month it covered is verified", async () => {
    expect((await db.select().from(monthlySourceUploads).where(like(monthlySourceUploads.fileName, `msrc-${suffix}%`))).length).toBeGreaterThan(0);
    await db.insert(qualityEngineeringReports).values({ year: YEAR, month: 3, narrative: {}, supplierData: {} });
    const res = await request(app).post("/reports/engineering/verify").query({ year: YEAR, month: 3 }).set(bearer(editorToken)).send({ pin: TEST_PIN });
    expect(res.status).toBe(200);
    expect(await rowsIn("2031-03")).toHaveLength(0);
    expect(await db.select().from(monthlySourceUploads).where(like(monthlySourceUploads.fileName, `msrc-${suffix}%`))).toHaveLength(0);
  });
});
