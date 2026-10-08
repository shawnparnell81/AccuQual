import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Security-audit finding (low): search had zero test coverage — search.
// controller.ts's canRead() department gate and its WHERE
// clauses were both entirely unexercised. This is exactly the kind of
// cross-module aggregation endpoint most likely to regress into a
// leak during a refactor.
//
// Search matches the number the user typed, plus title, part number, document
// title, revision, and equipment name or serial. A blank number is not the
// database id. The response is `{ results: [...] }`, not a bare array.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { rma } from "../../src/drizzle/schema/rma.js";
import { eightD } from "../../src/drizzle/schema/eightD.js";
import { complaints } from "../../src/drizzle/schema/complaints.js";
import { changeRequests } from "../../src/drizzle/schema/change.js";
import { riskAssessments } from "../../src/drizzle/schema/risk.js";
import { ppapPackages } from "../../src/drizzle/schema/ppap.js";
import { documents } from "../../src/drizzle/schema/documents.js";
import { equipment } from "../../src/drizzle/schema/calibration.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();
let companyId: number;

let ncrId: number;
let blankNcrId: number;
let rmaId: number;
let eightDId: number;
let complaintId: number;
let changeId: number;
let riskId: number;
let ppapId: number;
let documentId: number;
let equipmentId: number;
const documentTitle = `Search Doc ${suffix}`;
const gageName = `Search Gage ${suffix}`;
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;


describe("Search (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    
    
    await seedDefaultPermissions(companyId);
    

    const [qualityUser] = await db.insert(users).values({ email: `search-quality-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(qualityUser!.id);
    qualityToken = signAccessToken({ sub: String(qualityUser!.id), roleId: null, roleName: "operator", department: "quality" });

    // ncr's own default permission entry is quality-only — engineering has zero rows for it.
    const [engineeringUser] = await db.insert(users).values({ email: `search-engineering-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(engineeringUser!.id);
    engineeringToken = signAccessToken({ sub: String(engineeringUser!.id), roleId: null, roleName: "operator", department: "engineering" });

    
    
    

    const [created] = await db.insert(ncr).values({ title: "Search test NCR", recordNumber: `QNCR-${suffix}` }).returning();
    ncrId = created!.id;
    const [blankNcr] = await db.insert(ncr).values({ title: "Bent flange only" }).returning();
    blankNcrId = blankNcr!.id;

    const [supplier] = await db.insert(suppliers).values({ name: `Search Test Supplier ${suffix}` }).returning();
    const [rmaRow] = await db.insert(rma).values({ rmaNumber: `RMA-${suffix}`, supplierId: supplier!.id }).returning();
    rmaId = rmaRow!.id;
    const [eightDRow] = await db.insert(eightD).values({ recordNumber: `EIGHT-${suffix}` }).returning();
    eightDId = eightDRow!.id;
    const [complaintRow] = await db.insert(complaints).values({ description: `Search test complaint ${suffix}` }).returning();
    complaintId = complaintRow!.id;
    const [changeRow] = await db.insert(changeRequests).values({ title: `Search test change ${suffix}`, recordNumber: `CHG-${suffix}` }).returning();
    changeId = changeRow!.id;
    const [riskRow] = await db.insert(riskAssessments).values({ title: `Search test risk ${suffix}`, recordNumber: `RISK-${suffix}` }).returning();
    riskId = riskRow!.id;
    const [ppapRow] = await db.insert(ppapPackages).values({ partNumber: `PN-SEARCH-${suffix}`, recordNumber: `PPAP-${suffix}` }).returning();
    ppapId = ppapRow!.id;
    const [documentRow] = await db.insert(documents).values({ title: documentTitle, revisionCode: `REV-${suffix}` }).returning();
    documentId = documentRow!.id;
    const [equipmentRow] = await db.insert(equipment).values({ name: gageName, serialNumber: `SER-${suffix}` }).returning();
    equipmentId = equipmentRow!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("quality (real ncr access) finds the NCR by the number the user typed", async () => {
    const res = await request(app).get(`/search`).query({ q: `QNCR-${suffix}` }).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { type: string; id: number }) => r.type === "NCR" && r.id === ncrId)).toBe(true);
    const byId = await request(app).get(`/search`).query({ q: String(blankNcrId) }).set("Authorization", `Bearer ${qualityToken}`);
    expect(byId.body.results.some((r: { type: string; id: number }) => r.type === "NCR" && r.id === blankNcrId)).toBe(false);
    const blank = byId.body.results.find((r: { type: string; id: number }) => r.id === blankNcrId);
    expect(blank).toBeUndefined();
  });

  it("engineering (zero access to ncr) never sees the NCR in results — the category is skipped, not filtered after the fact", async () => {
    const res = await request(app).get(`/search`).query({ q: `QNCR-${suffix}` }).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { type: string }) => r.type === "NCR")).toBe(false);
  });

  ;

  it("an empty query returns an empty result set instead of erroring", async () => {
    const res = await request(app).get("/search?q=").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  // RMA/8D/Complaint/Change/Risk/PPAP — one found case per type, by the user-entered number.
  it("finds an RMA (quality has edit access) by the number the user typed", async () => {
    const res = await request(app).get(`/search`).query({ q: `RMA-${suffix}` }).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.body.results.some((r: { type: string; id: number }) => r.type === "RMA" && r.id === rmaId)).toBe(true);
  });

  it("finds an 8D (quality has edit access)", async () => {
    const res = await request(app).get(`/search`).query({ q: `EIGHT-${suffix}` }).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.body.results.some((r: { type: string; id: number }) => r.type === "8D" && r.id === eightDId)).toBe(true);
  });

  it("does not return a Complaint result — complaints redirect to NCR and are not a search type", async () => {
    const res = await request(app).get(`/search?q=${complaintId}`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.body.results.some((r: { type: string }) => r.type === "Complaint")).toBe(false);
  });

  it("finds a Change request (engineering has edit access)", async () => {
    const res = await request(app).get(`/search`).query({ q: `CHG-${suffix}` }).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.body.results.some((r: { type: string; id: number }) => r.type === "Change" && r.id === changeId)).toBe(true);
  });

  it("finds a Risk assessment (engineering has edit access)", async () => {
    const res = await request(app).get(`/search`).query({ q: `RISK-${suffix}` }).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.body.results.some((r: { type: string; id: number }) => r.type === "Risk" && r.id === riskId)).toBe(true);
  });

  it("finds a PPAP package (engineering has edit access)", async () => {
    const res = await request(app).get(`/search`).query({ q: `PPAP-${suffix}` }).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.body.results.some((r: { type: string; id: number }) => r.type === "PPAP" && r.id === ppapId)).toBe(true);
  });

  it("finds a document by title and a gage by name, not only by numeric id", async () => {
    const byTitle = await request(app).get("/search").query({ q: documentTitle }).set("Authorization", `Bearer ${qualityToken}`);
    expect(byTitle.status).toBe(200);
    expect(byTitle.body.results.some((r: { type: string; id: number }) => r.type === "Document" && r.id === documentId)).toBe(true);

    const byGage = await request(app).get("/search").query({ q: gageName }).set("Authorization", `Bearer ${qualityToken}`);
    expect(byGage.body.results.some((r: { type: string; id: number }) => r.type === "Calibration" && r.id === equipmentId)).toBe(true);
  });

  it("quality (zero access to ppap) never sees the PPAP package — same skip-the-category behavior as NCR/engineering above", async () => {
    const res = await request(app).get(`/search?q=${ppapId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.body.results.some((r: { type: string }) => r.type === "PPAP")).toBe(false);
  });

  ;
});
