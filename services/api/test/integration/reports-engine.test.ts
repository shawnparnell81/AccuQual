import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { sites } from "../../src/drizzle/schema/sites.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { pdfVisibleText } from "../../src/modules/forms/controlledPdf.js";

const app = createApp();
const suffix = Date.now();

describe("quality reports", () => {
  let adminToken = "";
  let operatorToken = "";
  let siteId = 0;

  beforeAll(async () => {
    await ensureTestCompany();
    const [admin] = await db.insert(users).values({ email: `reports-admin-${suffix}@test.local`, passwordHash: "unused", name: "Report Admin" }).returning();
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: null, roleName: "admin", department: null });
    const [operator] = await db.insert(users).values({ email: `reports-operator-${suffix}@test.local`, passwordHash: "unused", department: "production" }).returning();
    operatorToken = signAccessToken({ sub: String(operator!.id), roleId: null, roleName: "operator", department: "production" });
    const [site] = await db.insert(sites).values({ name: "Dayton", code: `rpt${suffix}`.slice(0, 32), isDefault: false }).returning();
    siteId = site!.id;
    await db.insert(ncr).values({ siteId, title: "Burr on bore", status: "open", severity: "high", createdBy: admin!.id });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("refuses a signed-out caller", async () => {
    const res = await request(app).post("/reports/weekly").send({});
    expect(res.status).toBe(401);
  });

  it("refuses a person who cannot read any report module", async () => {
    const res = await request(app).post("/reports/weekly").set("Authorization", `Bearer ${operatorToken}`).send({ plantId: "all" });
    expect(res.status).toBe(403);
  });

  it("runs a weekly report and exports CSV and JSON", async () => {
    const res = await request(app).post("/reports/weekly").set("Authorization", `Bearer ${adminToken}`).send({ plantId: siteId });
    expect(res.status).toBe(200);
    expect(res.body.header.type).toBe("weekly");
    expect(res.body.header.templateVersion).toBe(2);
    expect(res.body.header.plant).toMatchObject({ id: siteId, name: "Dayton" });
    expect(res.body.header.generatedBy.name).toBe("Report Admin");
    const ncrSection = res.body.sections.find((section: { key: string }) => section.key === "ncr");
    expect(ncrSection.status).toBe("ok");
    expect(ncrSection.summary.opened).toBeGreaterThanOrEqual(1);
    expect(res.body.sections.map((section: { key: string }) => section.key)).not.toContain("training");
    expect(res.body.delivery.pdf.status).toBe("stub");

    const csv = await request(app).get("/reports/export").query({ type: "weekly", format: "csv", plantId: String(siteId) }).set("Authorization", `Bearer ${adminToken}`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("# Weekly quality report");
    expect(csv.text).toContain("# Plant: Dayton");
    expect(csv.text).toContain("ncr,NCR,ok,opened");

    const deniedPdf = await request(app).get("/reports/export").query({ type: "weekly", format: "pdf", plantId: "all" }).set("Authorization", `Bearer ${operatorToken}`);
    expect(deniedPdf.status).toBe(403);

    const pdf = await request(app)
      .get("/reports/export")
      .query({ type: "weekly", format: "pdf", plantId: String(siteId) })
      .set("Authorization", `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(String(pdf.headers["content-type"])).toContain("application/pdf");
    const bytes = pdf.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await pdfVisibleText(bytes);
    expect(text).toContain("Weekly quality report");
    expect(text).toContain("NCR");
    expect(text).toContain("opened");

    const json = await request(app).get("/reports/export").query({ type: "weekly", format: "json", plantId: String(siteId) }).set("Authorization", `Bearer ${adminToken}`);
    expect(json.status).toBe(200);
    expect(json.headers["content-disposition"]).toContain(".json");
    const parsed = JSON.parse(json.text);
    expect(parsed.header.generatedBy.name).toBe("Report Admin");
  });

  it("adds the monthly sections and rejects a custom report without dates", async () => {
    const monthly = await request(app).post("/reports/monthly").set("Authorization", `Bearer ${adminToken}`).send({ plantId: "all" });
    expect(monthly.status).toBe(200);
    expect(monthly.body.sections.map((section: { key: string }) => section.key)).toEqual(expect.arrayContaining(["training", "calibration", "ppap", "workflow_cycle_times", "warranty", "labor_claims"]));

    const adhoc = await request(app).post("/reports/adhoc").set("Authorization", `Bearer ${adminToken}`).send({ plantId: "all" });
    expect(adhoc.status).toBe(400);

    const templates = await request(app).get("/reports/templates").set("Authorization", `Bearer ${adminToken}`);
    expect(templates.status).toBe(200);
    expect(templates.body.version).toBe(2);

    const schedule = await request(app).get("/reports/schedule").set("Authorization", `Bearer ${adminToken}`);
    expect(schedule.status).toBe(200);
    expect(schedule.body.status).toBe("stub");
    expect(schedule.body.enabled).toBe(false);
  });
});
