import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let adminToken: string;
let ownerToken: string;
let operatorToken: string;
let execToken: string;
let greerId: number;
let wellmanId: number;

interface Figure {
  label: string;
  value: number;
  bucket: string;
}
interface Widget {
  id: string;
  figures: Figure[];
}
interface Column {
  siteId: number | null;
  siteName: string;
  widgets: Widget[];
}

function openCount(columns: Column[], siteName: string, widgetId: string): number {
  const column = columns.find((item) => item.siteName === siteName);
  const widget = column?.widgets.find((item) => item.id === widgetId);
  return widget?.figures.find((figure) => figure.bucket === "open")?.value ?? -1;
}

describe("executive dashboard", () => {
  beforeAll(async () => {
    await ensureTestCompany();
    const [admin] = await db.insert(users).values({ email: `exec-admin-${suffix}@test.local`, passwordHash: "unused", name: "Exec Admin" }).returning();
    const [owner] = await db.insert(users).values({ email: `exec-owner-${suffix}@test.local`, passwordHash: "unused", name: "Exec Owner" }).returning();
    const [operator] = await db.insert(users).values({ email: `exec-op-${suffix}@test.local`, passwordHash: "unused", name: "Greer Operator", department: "quality" }).returning();
    const [exec] = await db.insert(users).values({ email: `exec-viewer-${suffix}@test.local`, passwordHash: "unused", name: "Executive Viewer", department: null }).returning();
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: null, roleName: "admin", department: null });
    ownerToken = signAccessToken({ sub: String(owner!.id), roleId: null, roleName: "owner", department: null });
    operatorToken = signAccessToken({ sub: String(operator!.id), roleId: null, roleName: "operator", department: "quality" });
    execToken = signAccessToken({ sub: String(exec!.id), roleId: null, roleName: "executive", department: null });

    const greer = await request(app).post("/sites").set("Authorization", `Bearer ${adminToken}`).send({ name: "Greer", code: "greer" });
    const wellman = await request(app).post("/sites").set("Authorization", `Bearer ${adminToken}`).send({ name: "Wellman", code: "wellman" });
    expect(greer.status).toBe(201);
    expect(wellman.status).toBe(201);
    greerId = greer.body.id as number;
    wellmanId = wellman.body.id as number;

    const onGreer = await request(app).put(`/sites/${greerId}/members`).set("Authorization", `Bearer ${adminToken}`).send({ userIds: [operator!.id] });
    expect(onGreer.status).toBe(200);
    const context = await request(app).get("/sites").set("Authorization", `Bearer ${adminToken}`);
    const main = (context.body.sites as { id: number; isDefault: boolean }[]).find((site) => site.isDefault);
    expect(main).toBeTruthy();
    const keepMain = await request(app).put(`/sites/${main!.id}/members`).set("Authorization", `Bearer ${adminToken}`).send({ userIds: [admin!.id, owner!.id, exec!.id] });
    expect(keepMain.status).toBe(200);

    const ncr = await request(app)
      .post("/ncr")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("X-AccuQual-Site", String(greerId))
      .send({ title: "Greer scratch", severity: "low" });
    expect(ncr.status).toBe(201);
    expect(ncr.body.siteId).toBe(greerId);

    await db.execute(sql`INSERT INTO complaints (description, status, record_number, customer_name) VALUES ('Unassigned complaint', 'open', 'CMP-UNASSIGNED', 'Acme')`);
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("refuses the dashboard to someone without the executive permission", async () => {
    const res = await request(app).get("/executive").set("Authorization", `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("You don't have access to the executive dashboard.");
  });

  it("lets Owner and Administrator open the dashboard from the permission on the role", async () => {
    const admin = await request(app).get("/executive").set("Authorization", `Bearer ${adminToken}`);
    const owner = await request(app).get("/executive").set("Authorization", `Bearer ${ownerToken}`);
    expect(admin.status).toBe(200);
    expect(owner.status).toBe(200);
    const sites = await request(app).get("/sites").set("Authorization", `Bearer ${adminToken}`);
    expect(sites.body.canViewAllSites).toBe(true);
    expect(sites.body.executiveDashboard).toBe(true);

    const [adminRole] = await db.select().from(roles).where(eq(roles.name, "admin"));
    const original = adminRole!.permissions ?? [];
    await db.update(roles).set({ permissions: original.filter((permission) => permission !== "executive.dashboard" && permission !== "sites.view_all") }).where(eq(roles.name, "admin"));
    try {
      const blocked = await request(app).get("/executive").set("Authorization", `Bearer ${adminToken}`);
      expect(blocked.status).toBe(403);
      expect(blocked.body.message).toBe("You don't have access to the executive dashboard.");
      const narrowed = await request(app).get("/sites").set("Authorization", `Bearer ${adminToken}`);
      expect(narrowed.body.canViewAllSites).toBe(false);
    } finally {
      await db.update(roles).set({ permissions: original }).where(eq(roles.name, "admin"));
    }
  });

  it("limits a person to their assigned plants and refuses All sites", async () => {
    const sites = await request(app).get("/sites").set("Authorization", `Bearer ${operatorToken}`);
    expect(sites.status).toBe(200);
    expect(sites.body.sites.map((site: { name: string }) => site.name)).toEqual(["Greer"]);
    expect(sites.body.canViewAllSites).toBe(false);
    const all = await request(app).post("/sites/current").set("Authorization", `Bearer ${operatorToken}`).send({ scope: "all" });
    expect(all.status).toBe(403);
  });

  it("counts a Greer NCR only in Greer and shows an unassigned complaint", async () => {
    const res = await request(app).get("/executive").set("Authorization", `Bearer ${execToken}`);
    expect(res.status).toBe(200);
    const names = (res.body.columns as Column[]).map((column) => column.siteName);
    expect(names).toContain("Greer");
    expect(names).toContain("Wellman");
    expect(names.indexOf("Greer")).toBeLessThan(names.indexOf("Wellman"));
    expect(openCount(res.body.columns, "Greer", "open_ncrs")).toBeGreaterThanOrEqual(1);
    expect(openCount(res.body.columns, "Wellman", "open_ncrs")).toBe(0);
    expect(names).toContain("Unassigned");
    expect(openCount(res.body.columns, "Unassigned", "complaints")).toBeGreaterThanOrEqual(1);
    expect(res.body.customized).toBe(false);
    expect(res.body.layout.widgets).toHaveLength(7);

    const greer = (res.body.columns as Column[]).find((column) => column.siteName === "Greer");
    const drill = await request(app)
      .get("/executive/records")
      .query({ kind: "open_ncrs", bucket: "open", dateRange: "90d", siteId: greer?.siteId })
      .set("Authorization", `Bearer ${execToken}`);
    expect(drill.status).toBe(200);
    expect(drill.body.rows.length).toBeGreaterThan(0);
    expect(drill.body.rows[0]).not.toHaveProperty("id");
    expect(drill.body.rows[0].recordNumber === "—" || typeof drill.body.rows[0].recordNumber === "string").toBe(true);
  });

  it("saves a personal layout and resets to the default", async () => {
    const custom = { version: 1, widgets: [{ id: "warranty", kind: "warranty", metric: "count", dateRange: "30d" }] };
    const saved = await request(app).put("/executive/layout").set("Authorization", `Bearer ${execToken}`).send(custom);
    expect(saved.status).toBe(200);
    expect(saved.body.customized).toBe(true);
    expect(saved.body.layout.widgets).toEqual(custom.widgets);
    const again = await request(app).get("/executive").set("Authorization", `Bearer ${execToken}`);
    expect(again.body.layout.widgets).toEqual(custom.widgets);
    const reset = await request(app).delete("/executive/layout").set("Authorization", `Bearer ${execToken}`);
    expect(reset.status).toBe(200);
    expect(reset.body.customized).toBe(false);
    expect(reset.body.layout.widgets).toHaveLength(7);
  });

  it("does not let an executive with no department edit records", async () => {
    const res = await request(app).post("/ncr").set("Authorization", `Bearer ${execToken}`).send({ title: "Should stay closed", severity: "low" });
    expect(res.status).toBe(403);
  });
});
