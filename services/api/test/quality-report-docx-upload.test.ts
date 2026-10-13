import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { ensureTestCompany } from "./helpers/company.js";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { users } from "../src/drizzle/schema/users.js";
import { auditTrail } from "../src/drizzle/schema/auditTrail.js";
import { qualityEngineeringReports } from "../src/drizzle/schema/qualityEngineeringReport.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { seedDefaultPermissions } from "./helpers/seedDefaults.js";
import { parseSupplierFile } from "../src/modules/quality-engineering-report/supplierParse.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const docx = readFileSync(join(fixturesDir, "monthly-quality-report-september-2026.docx"));
const csv = readFileSync(join(fixturesDir, "quality-engineering-supplier-september-2026.csv"));

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const YEAR = 2026;
const MONTH = 11; // not September, so this never collides with the Import from file tests
let qualityToken: string;
let noAccessToken: string;
const userIds: number[] = [];

async function makeUser(department: string | null, label: string) {
  const [user] = await db.insert(users).values({ email: `qr-docx-${label}-${suffix}@test.local`, passwordHash: "unused", name: `Report Tester ${label}` }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

const upload = (token: string, file: Buffer, name: string, extra: Record<string, string> = {}) =>
  request(app)
    .post("/reports/engineering/upload")
    .set("Authorization", `Bearer ${token}`)
    .field("year", String(YEAR))
    .field("month", String(MONTH))
    .field("replaceNotes", extra.replaceNotes ?? "false")
    .attach("file", file, name);

beforeAll(async () => {
  const co = await ensureTestCompany();
  await seedDefaultPermissions(co!.id);
  qualityToken = await makeUser("quality", "quality");
  noAccessToken = await makeUser(null, "none");
  await db.delete(qualityEngineeringReports).where(and(eq(qualityEngineeringReports.year, YEAR), eq(qualityEngineeringReports.month, MONTH)));
});

afterAll(async () => {
  await db.delete(qualityEngineeringReports).where(and(eq(qualityEngineeringReports.year, YEAR), eq(qualityEngineeringReports.month, MONTH)));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

describe("Monthly Quality Report supplier upload accepts a Word file", () => {
  it("fills trend tables, top parts, FAI categories and narrative the same way the CSV does", async () => {
    const res = await upload(qualityToken, docx, "monthly-quality-report-september-2026.docx", { replaceNotes: "true" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.report).toBeTruthy();

    const [row] = await db.select().from(qualityEngineeringReports).where(and(eq(qualityEngineeringReports.year, YEAR), eq(qualityEngineeringReports.month, MONTH)));
    expect(row!.uploadFileName).toBe("monthly-quality-report-september-2026.docx");
    const saved = row!.supplierData as any;
    const expected = (await parseSupplierFile(csv, "x.csv", YEAR)).data as any;

    expect(saved.monthlyMetrics.length).toBeGreaterThan(0);
    expect(saved.financials.length).toBeGreaterThan(0);
    expect(saved.topParts.length).toBeGreaterThan(0);
    expect(saved.faiCategories.length).toBeGreaterThan(0);
    expect(saved).toEqual(expected);

    const narrative = res.body.report.narrative;
    expect(narrative.departmentStatus).toBe("yellow");
    expect(narrative.fitment).toHaveLength(1);
    expect(narrative.productInfo).toHaveLength(2);
    expect(narrative.primaryAchievement.trim()).not.toBe("");
  });

  it("keeps typed narrative unless replace is ticked", async () => {
    await upload(qualityToken, docx, "a.docx", { replaceNotes: "true" });
    // Overwrite one narrative field by hand, then upload again without replace.
    const typed = await request(app)
      .put("/reports/engineering")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ year: YEAR, month: MONTH, narrative: { ...(await upload(qualityToken, docx, "a.docx", { replaceNotes: "true" })).body.report.narrative, primaryAchievement: "Typed by hand" } });
    expect(typed.status).toBe(200);

    const kept = await upload(qualityToken, docx, "b.docx", { replaceNotes: "false" });
    expect(kept.status).toBe(200);
    expect(kept.body.report.narrative.primaryAchievement).toBe("Typed by hand");

    const replaced = await upload(qualityToken, docx, "c.docx", { replaceNotes: "true" });
    expect(replaced.body.report.narrative.primaryAchievement).not.toBe("Typed by hand");
  });

  it("audit-logs the upload with who, what and when in plain words", async () => {
    await upload(qualityToken, docx, "audited-supplier-file.docx");
    const [row] = await db.select().from(qualityEngineeringReports).where(and(eq(qualityEngineeringReports.year, YEAR), eq(qualityEngineeringReports.month, MONTH)));
    const entries = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "QualityEngineeringReport"), eq(auditTrail.entityId, row!.id)));
    const entry = entries.filter((e) => JSON.stringify(e.changes).includes("audited-supplier-file.docx")).pop();
    expect(entry).toBeTruthy();
    expect(entry!.performedBy).not.toBeNull();
    const summary = String((entry!.changes as any).summary);
    expect(summary).toContain("Monthly Quality Report for November 2026");
    expect(summary).not.toMatch(/\b\d{5,}\b/);
  });

  it("still accepts the CSV, and refuses a user without edit access or a mislabeled file", async () => {
    const asCsv = await upload(qualityToken, csv, "supplier.csv");
    expect(asCsv.status).toBe(200);
    const denied = await upload(noAccessToken, docx, "x.docx");
    expect(denied.status).toBe(403);
    const fake = await upload(qualityToken, Buffer.from("not a word file"), "fake.docx");
    expect(fake.status).toBe(400);
    const other = await upload(qualityToken, Buffer.from("hello"), "notes.txt");
    expect(other.status).toBe(400);
  });
});
