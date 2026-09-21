// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Tenant data export: who may ask (admins, re-confirming their password / two-step code), the short-lived single-use
// download link, what is in the ZIP (every table, both formats, uploaded files), what is NEVER in it (credentials,
// other tenants' rows, files from outside the tenant's storage folder), and that every export is audited.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import AdmZip from "adm-zip";
import jwt from "jsonwebtoken";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { attachments } from "../../src/drizzle/schema/attachments.js";
import { iotDevices } from "../../src/drizzle/schema/digitalTwin.js";
import { ssoConnections } from "../../src/drizzle/schema/sso.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { refreshTokens } from "../../src/drizzle/schema/refreshTokens.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { encryptSecret } from "../../src/modules/tenant/crypto.js";
import { totpAt, totpCounter } from "../../src/utils/totp.js";
import { env } from "../../src/config/env.js";
import { describeExport, resolveTenantFile, tenantStorageRoot } from "../../src/modules/data-export/dataExport.service.js";
import { SECRET_COLUMN, NOT_SECRET_COLUMNS, isWithheldColumn } from "../../src/modules/data-export/exportPlan.js";
import { resetDataExportState } from "../../src/modules/data-export/dataExport.routes.js";

const app = createApp();
const suffix = Date.now();
const PASSWORD = "violet-lantern-quarry-88";
const HASH_MARKER = "HASH-MARKER-must-never-leave";
const API_KEY_MARKER = "AI-KEY-MARKER-must-never-leave";
const SSO_SECRET_MARKER = "SSO-SECRET-MARKER-must-never-leave";
const DEVICE_HASH_MARKER = "DEVICE-HASH-MARKER-must-never-leave";
const B_MARKER = "TENANT-B-ROW-MARKER";

let tenantA: number;
let tenantB: number;
let adminRoleId: number;
const userIds: number[] = [];
const createdFiles: string[] = [];
let admin: { id: number; email: string; token: string };
let worker: { id: number; token: string };
let mfaAdmin: { id: number; email: string; token: string; secret: string };

async function makeUser(tenant: number, label: string, roleId: number | null, roleName: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const email = `export-${label}-${suffix}@test.local`;
  const [u] = await db.insert(users).values({ tenantId: tenant, email, passwordHash: await bcrypt.hash(PASSWORD, 4), roleId, ...extra }).returning();
  userIds.push(u!.id);
  return { id: u!.id, email, token: await signAccessToken({ sub: String(u!.id), tenantId: tenant, roleId, roleName, department: null }) };
}
const as = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });

async function putFile(tenant: number, rel: string, content: string): Promise<string> {
  const full = path.join(tenantStorageRoot(tenant), rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
  createdFiles.push(full);
  return full;
}

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

async function requestExport(who: { token: string }, body: Record<string, unknown> = {}) {
  return request(app).post("/data-export/requests").set(as(who)).send({ password: PASSWORD, ...body });
}
async function downloadZip(url: string) {
  const res = await request(app).get(url).buffer(true).parse(binary);
  return { res, zip: res.status === 200 ? new AdmZip(res.body as Buffer) : null };
}
const entryText = (zip: AdmZip, name: string) => zip.readAsText(zip.getEntry(name)!);
const lines = (zip: AdmZip, name: string) => entryText(zip, name).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
const events = async () => (await db.select().from(auditTrail).where(and(eq(auditTrail.tenantId, tenantA), eq(auditTrail.entityType, "Tenant")))).map((r) => (r.changes as { event?: string } | null)?.event);

describe("Tenant data export (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [a] = await db.insert(tenants).values({ name: `Export A ${suffix}`, code: `export-a-${suffix}`, aiConfig: { provider: "anthropic", apiKeyEncrypted: API_KEY_MARKER, modelName: "claude-haiku-4-5" } }).returning();
    const [b] = await db.insert(tenants).values({ name: `Export B ${suffix}`, code: `export-b-${suffix}` }).returning();
    tenantA = a!.id;
    tenantB = b!.id;
    const [existing] = await db.select().from(roles).where(eq(roles.name, "admin"));
    adminRoleId = existing ? existing.id : (await db.insert(roles).values({ name: "admin" }).onConflictDoNothing().returning())[0]?.id ?? (await db.select().from(roles).where(eq(roles.name, "admin")))[0]!.id;

    admin = await makeUser(tenantA, "admin", adminRoleId, "admin", { passwordHash: await bcrypt.hash(PASSWORD, 4) });
    worker = await makeUser(tenantA, "worker", null, "operator");
    const secret = "JBSWY3DPEHPK3PXP";
    const m = await makeUser(tenantA, "mfa-admin", adminRoleId, "admin", { mfaEnabled: true, mfaSecretEncrypted: encryptSecret(secret) });
    mfaAdmin = { ...m, secret };
    // A stored value that would run as a formula if opened in a spreadsheet.
    await db.insert(suppliers).values([{ tenantId: tenantA, name: "Acme Fasteners" }, { tenantId: tenantA, name: '=HYPERLINK("http://evil.example","click")' }, { tenantId: tenantB, name: B_MARKER }]);
    await db.insert(iotDevices).values({ tenantId: tenantA, deviceId: `press-${suffix}`, apiKeyHash: DEVICE_HASH_MARKER });
    await db.insert(ssoConnections).values({ tenantId: tenantA, issuer: "https://idp.example", clientId: "c", clientSecretEncrypted: SSO_SECRET_MARKER });

    const inside = await putFile(tenantA, `attachments/${suffix}-report.txt`, "an uploaded NCR photo, pretend");
    const otherTenantFile = await putFile(tenantB, `attachments/${suffix}-secret.txt`, "TENANT B PRIVATE FILE");
    await db.insert(attachments).values([
      { tenantId: tenantA, fileName: "report.txt", filePath: inside, entityType: "ncr", entityId: 1 },
      { tenantId: tenantA, fileName: "stolen.txt", filePath: otherTenantFile }, // another tenant's file, referenced by a row of ours
      { tenantId: tenantA, fileName: "hosts", filePath: "/etc/hosts" }, // outside storage entirely
      { tenantId: tenantA, fileName: "traversal", filePath: path.join(tenantStorageRoot(tenantA), "..", "..", "..", "package.json") },
      { tenantId: tenantA, fileName: "gone.txt", filePath: path.join(tenantStorageRoot(tenantA), "attachments", "deleted-long-ago.txt") },
    ]);
    await db.insert(attachments).values({ tenantId: tenantB, fileName: "b.txt", filePath: otherTenantFile });
  });

  beforeEach(() => resetDataExportState());

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    for (const t of [tenantA, tenantB]) {
      await db.delete(auditRowChanges).where(eq(auditRowChanges.tenantId, t));
      await db.delete(auditTrail).where(eq(auditTrail.tenantId, t));
      await db.delete(attachments).where(eq(attachments.tenantId, t));
      await db.delete(suppliers).where(eq(suppliers.tenantId, t));
      await db.delete(iotDevices).where(eq(iotDevices.tenantId, t));
      await db.delete(ssoConnections).where(eq(ssoConnections.tenantId, t));
    }
    await db.delete(refreshTokens).where(inArray(refreshTokens.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    for (const t of [tenantA, tenantB]) {
      await db.delete(tenants).where(eq(tenants.id, t));
      await db.delete(auditRowChanges).where(eq(auditRowChanges.tenantId, t));
    }
    for (const f of createdFiles) await rm(f, { force: true });
    await pool.end();
  });

  describe("who may export", () => {
    it("refuses everyone who is not an admin, and anyone not signed in", async () => {
      expect((await request(app).get("/data-export/contents")).status).toBe(401);
      expect((await request(app).get("/data-export/contents").set(as(worker))).status).toBe(403);
      expect((await requestExport(worker)).status).toBe(403);
    });

    it("an admin must re-confirm their password; a wrong one is refused and counts toward the lockout", async () => {
      expect((await request(app).post("/data-export/requests").set(as(admin)).send({})).status).toBe(400);
      const wrong = await requestExport(admin, { password: "not-the-password-123" });
      expect(wrong.status).toBe(401);
      const [row] = await db.select().from(users).where(eq(users.id, admin.id));
      expect(row!.failedLoginCount).toBeGreaterThan(0);
      await db.update(users).set({ failedLoginCount: 0, firstFailedLoginAt: null }).where(eq(users.id, admin.id));
      expect((await requestExport(admin)).status).toBe(200);
    });

    it("an admin who uses two-step sign-in must also supply a current code", async () => {
      expect((await requestExport(mfaAdmin)).status).toBe(401);
      expect((await requestExport(mfaAdmin, { code: "000000" })).status).toBe(401);
      const ok = await requestExport(mfaAdmin, { code: totpAt(mfaAdmin.secret, totpCounter()) });
      expect(ok.status).toBe(200);
      await db.update(users).set({ failedLoginCount: 0, firstFailedLoginAt: null, lockedUntil: null }).where(eq(users.id, mfaAdmin.id));
    });

    it("allows only three requests an hour per organization", async () => {
      for (let i = 0; i < 3; i++) expect((await requestExport(admin)).status).toBe(200);
      const fourth = await requestExport(admin);
      expect(fourth.status).toBe(429);
    });
  });

  describe("the download link", () => {
    it("works once, then never again", async () => {
      const { body } = await requestExport(admin);
      expect(body.downloadUrl).toMatch(/^\/data-export\/download\?token=/);
      const first = await downloadZip(body.downloadUrl);
      expect(first.res.status).toBe(200);
      expect(first.res.headers["content-type"]).toBe("application/zip");
      expect(first.res.headers["content-disposition"]).toMatch(/attachment; filename="accuqual-export-\d{4}-\d{2}-\d{2}\.zip"/);
      expect(first.res.headers["cache-control"]).toBe("no-store");
      const second = await request(app).get(body.downloadUrl);
      expect(second.status).toBe(401);
      expect(second.body.message).toMatch(/already used/);
    });

    it("refuses an expired, forged, or missing token", async () => {
      expect((await request(app).get("/data-export/download")).status).toBe(401);
      expect((await request(app).get("/data-export/download?token=garbage")).status).toBe(401);
      const forged = jwt.sign({ sub: String(admin.id), tid: tenantA, fmt: "json", files: true, jti: "x" }, "some-other-secret", { expiresIn: 60 });
      expect((await request(app).get(`/data-export/download?token=${forged}`)).status).toBe(401);
      const expired = jwt.sign({ sub: String(admin.id), tid: tenantA, fmt: "json", files: true, jti: "y" }, `${env.JWT_ACCESS_SECRET}:data-export`, { expiresIn: -10 });
      expect((await request(app).get(`/data-export/download?token=${expired}`)).status).toBe(401);
    });

    it("is refused if the account lost its admin rights after asking", async () => {
      const temp = await makeUser(tenantA, "temp-admin", adminRoleId, "admin");
      const { body } = await requestExport(temp);
      await db.update(users).set({ roleId: null }).where(eq(users.id, temp.id));
      expect((await request(app).get(body.downloadUrl)).status).toBe(403);
    });
  });

  describe("what is in the archive", () => {
    it("holds a manifest, a README and one file per table, with this organization's records", async () => {
      const { body } = await requestExport(admin, { format: "json" });
      const { zip } = await downloadZip(body.downloadUrl);
      const names = zip!.getEntries().map((e) => e.entryName);
      expect(names).toEqual(expect.arrayContaining(["README.txt", "manifest.json", "data/suppliers.jsonl", "data/users.jsonl", "data/tenants.jsonl", "data/audit_trail.jsonl"]));

      const manifest = JSON.parse(entryText(zip!, "manifest.json"));
      expect(manifest).toMatchObject({ format: "json", tenant: { id: tenantA }, exportedBy: { id: admin.id, email: admin.email }, includeFiles: true });
      expect(manifest.tables.length).toBeGreaterThan(80);
      expect(manifest.excludedTables.map((t: { table: string }) => t.table)).toContain("ai_embeddings");
      expect(manifest.tables.find((t: { name: string }) => t.name === "suppliers")).toMatchObject({ rows: 2, truncated: false });

      const supplierNames = lines(zip!, "data/suppliers.jsonl").map((r) => r.name);
      expect(supplierNames).toContain("Acme Fasteners");
      expect(supplierNames).not.toContain(B_MARKER);
      const tenantRow = lines(zip!, "data/tenants.jsonl");
      expect(tenantRow).toHaveLength(1);
      expect(tenantRow[0]).toMatchObject({ id: tenantA, name: `Export A ${suffix}` });
      expect(lines(zip!, "data/users.jsonl").map((u) => u.email)).toContain(admin.email);
    });

    it("never contains another organization's rows or files, or any credential", async () => {
      const { body } = await requestExport(admin, { format: "json" });
      const { zip } = await downloadZip(body.downloadUrl);
      const everything = zip!.getEntries().map((e) => e.getData().toString("utf8")).join("\n");
      for (const marker of [B_MARKER, "TENANT B PRIVATE FILE", HASH_MARKER, API_KEY_MARKER, SSO_SECRET_MARKER, DEVICE_HASH_MARKER]) {
        expect(everything, marker).not.toContain(marker);
      }
      // The withheld COLUMNS are named only in the manifest (which says what was left out) — never present as data.
      const data = zip!.getEntries().filter((e) => e.entryName.startsWith("data/")).map((e) => e.getData().toString("utf8")).join(String.fromCharCode(10));
      for (const column of ["password_hash", "mfa_secret_encrypted", "client_secret_encrypted", "api_key_hash", "apiKeyEncrypted"]) expect(data, column).not.toContain(column);
      expect(everything).not.toMatch(/\$2[aby]\$\d\d\$/); // no bcrypt hash of any user
      // ... while the withheld columns are named in the manifest, so nothing disappears silently.
      const manifest = JSON.parse(entryText(zip!, "manifest.json"));
      const omitted = (t: string) => manifest.tables.find((x: { name: string }) => x.name === t).omittedColumns as string[];
      expect(omitted("users")).toEqual(expect.arrayContaining(["password_hash", "mfa_secret_encrypted", "token_version"]));
      expect(omitted("sso_connections")).toContain("client_secret_encrypted");
      expect(omitted("iot_devices")).toContain("api_key_hash");
      // Non-secret settings on the same tenant row survive.
      expect(lines(zip!, "data/tenants.jsonl")[0]!.ai_config).toMatchObject({ provider: "anthropic", modelName: "claude-haiku-4-5" });
      expect(lines(zip!, "data/tenants.jsonl")[0]!.ai_config).not.toHaveProperty("apiKeyEncrypted");
    });

    it("includes the organization's own uploaded files, and lists — never reads — anything outside its storage folder", async () => {
      const { body } = await requestExport(admin, { includeFiles: true });
      const { zip } = await downloadZip(body.downloadUrl);
      const fileEntries = zip!.getEntries().filter((e) => e.entryName.startsWith("files/attachments/"));
      expect(fileEntries).toHaveLength(1);
      expect(fileEntries[0]!.getData().toString()).toBe("an uploaded NCR photo, pretend");

      const manifest = JSON.parse(entryText(zip!, "manifest.json"));
      expect(manifest.files.included).toBe(1);
      const skipped = manifest.files.skipped.map((s: { path: string; reason: string }) => s.reason);
      expect(skipped.filter((r: string) => /not one of this organization/.test(r))).toHaveLength(3); // other tenant's file, /etc/hosts, ../../ traversal
      expect(skipped.some((r: string) => /no longer in storage/.test(r))).toBe(true);
    });

    it("leaves files out when asked", async () => {
      const { body } = await requestExport(admin, { includeFiles: false });
      const { zip } = await downloadZip(body.downloadUrl);
      expect(zip!.getEntries().some((e) => e.entryName.startsWith("files/"))).toBe(false);
      expect(JSON.parse(entryText(zip!, "manifest.json")).files).toMatchObject({ included: 0 });
    });

    it("can be produced as CSV, with formula-looking values defused", async () => {
      const { body } = await requestExport(admin, { format: "csv", includeFiles: false });
      const { zip } = await downloadZip(body.downloadUrl);
      const csv = entryText(zip!, "data/suppliers.csv");
      const [header, ...rows] = csv.trim().split("\n");
      expect(header).toContain("name");
      expect(rows.join("\n")).toContain("Acme Fasteners");
      // A stored =HYPERLINK(...) would execute when opened in a spreadsheet; it is prefixed so it is shown as text.
      expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
      expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
      expect(zip!.getEntry("data/suppliers.jsonl")).toBeNull();
    });
  });

  describe("transparency and the audit trail", () => {
    it("shows what would be exported, with counts, and what is left out and why", async () => {
      const res = await request(app).get("/data-export/contents").set(as(admin));
      expect(res.status).toBe(200);
      expect(res.body.tables.find((t: { table: string }) => t.table === "suppliers")).toMatchObject({ rows: 2 });
      expect(res.body.tables.find((t: { table: string }) => t.table === "users").omittedColumns).toContain("password_hash");
      expect(res.body.excluded[0]).toMatchObject({ table: "ai_embeddings" });
      expect(res.body.totalRows).toBeGreaterThan(5);
      // Other tenants' rows are not even counted.
      expect((await describeExport(tenantB)).tables.find((t) => t.table === "suppliers")!.rows).toBe(1);
    });

    it("records who asked, and when it completed, with row and file counts", async () => {
      const auditRows = async () => (await db.select().from(auditTrail).where(and(eq(auditTrail.tenantId, tenantA), eq(auditTrail.entityType, "Tenant")))).map((r) => ({ id: r.id, performedBy: r.performedBy, changes: r.changes as { event?: string; format?: string; files?: number } }));
      // Earlier tests in this file exported too and do not wait for their completion entries, which can land late; so only entries newer
      // than THIS request, in THIS export's format and file count, are this export's.
      const newest = Math.max(0, ...(await auditRows()).map((r) => r.id));
      const { body } = await requestExport(admin, { format: "json" });
      await downloadZip(body.downloadUrl);
      const mine = async () => (await auditRows()).filter((r) => r.id > newest && r.changes.event === "data_export_completed" && r.changes.format === "json" && r.changes.files === 1)[0];
      // The completion entry is written just after the last byte is sent, so wait for it rather than assuming how long that takes.
      let done = await mine();
      for (let i = 0; i < 50 && !done; i++) {
        await new Promise((r) => setTimeout(r, 100));
        done = await mine();
      }
      expect(done, "this export's completion entry").toBeDefined();
      expect((await auditRows()).some((r) => r.id > newest && r.changes.event === "data_export_requested")).toBe(true);
      expect(done!.performedBy).toBe(admin.id);
      expect(done!.changes).toMatchObject({ format: "json", files: 1 });
    });
  });

  describe("safety rules that must keep holding as the schema grows", () => {
    it("withholds every column whose name looks like a credential, in every table — including ones added later", async () => {
      const { rows } = await pool.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id')`,
      );
      const risky = rows.filter((r) => SECRET_COLUMN.test(r.column_name) && !NOT_SECRET_COLUMNS.has(r.column_name));
      expect(risky.length).toBeGreaterThan(0);
      for (const r of risky) expect(isWithheldColumn(r.column_name), `${r.table_name}.${r.column_name}`).toBe(true);
    });

    it("only ever resolves files inside the organization's own storage folder", () => {
      const root = tenantStorageRoot(tenantA);
      expect(resolveTenantFile(tenantA, path.join(root, "attachments", "a.pdf"))).toBe(path.join(root, "attachments", "a.pdf"));
      expect(resolveTenantFile(tenantA, `tenants/${tenantA}/attachments/a.pdf`)).toBe(path.join(root, "attachments", "a.pdf"));
      expect(resolveTenantFile(tenantA, path.join(tenantStorageRoot(tenantB), "attachments", "a.pdf"))).toBeNull();
      expect(resolveTenantFile(tenantA, "/etc/passwd")).toBeNull();
      expect(resolveTenantFile(tenantA, `tenants/${tenantA}/../${tenantB}/attachments/a.pdf`)).toBeNull();
      expect(resolveTenantFile(tenantA, `${root}-evil/a.pdf`)).toBeNull(); // a sibling folder that merely shares the prefix
    });
  });
});
