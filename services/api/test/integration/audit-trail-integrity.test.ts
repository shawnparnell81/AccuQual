// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Audit-trail integrity: field-level old/new values written by the
// audit_row_change() trigger (who, from, to), credentials never stored,
// history entries carrying their field changes, deactivation being audited,
// and the tenant-scoped app role being unable to rewrite or delete history.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { complaints } from "../../src/drizzle/schema/complaints.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantAId: number;
let tenantBId: number;
let adminId: number;
let adminToken: string;
const roleIds: number[] = [];
const userIds: number[] = [];
const auth = () => ({ Authorization: `Bearer ${adminToken}` });

async function asAppRole<T>(tenantId: number, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE accuqual_app");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [String(tenantId)]);
    return await fn((sql, params) => client.query(sql, params));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

describe("Audit trail integrity (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [a] = await db.insert(tenants).values({ name: `Audit Int A ${suffix}`, code: `audit-int-a-${suffix}` }).returning();
    const [b] = await db.insert(tenants).values({ name: `Audit Int B ${suffix}`, code: `audit-int-b-${suffix}` }).returning();
    tenantAId = a!.id;
    tenantBId = b!.id;
    const [admin] = await db.insert(users).values({ tenantId: tenantAId, email: `audit-int-admin-${suffix}@test.local`, passwordHash: "unused" }).returning();
    adminId = admin!.id;
    userIds.push(adminId);
    adminToken = await signAccessToken({ sub: String(adminId), tenantId: tenantAId, roleId: null, roleName: "admin", department: null });
    const inserted = await db.insert(roles).values([{ name: `audit-int-r1-${suffix}` }, { name: `audit-int-r2-${suffix}` }]).returning();
    roleIds.push(...inserted.map((r) => r.id));
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    for (const tenantId of [tenantAId, tenantBId]) {
      await db.delete(auditRowChanges).where(eq(auditRowChanges.tenantId, tenantId));
      await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
      await db.delete(formData).where(eq(formData.tenantId, tenantId));
      await db.delete(complaints).where(eq(complaints.tenantId, tenantId));
    }
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(roles).where(inArray(roles.id, roleIds));
    await db.delete(tenants).where(eq(tenants.id, tenantAId));
    await db.delete(tenants).where(eq(tenants.id, tenantBId));
    await db.delete(auditRowChanges).where(inArray(auditRowChanges.tenantId, [tenantAId, tenantBId]));
    await pool.end();
  });

  describe("field-level old/new values", () => {
    it("an edit records what changed from and to, and who did it", async () => {
      const created = await request(app).post("/complaints").set(auth()).send({ description: "Original wording", severity: "low" });
      const id = created.body.id as number;
      const edit = await request(app).patch(`/complaints/${id}`).set(auth()).send({ description: "Corrected wording", severity: "high" });
      expect(edit.status).toBe(200);

      const rows = await db.select().from(auditRowChanges).where(and(eq(auditRowChanges.tenantId, tenantAId), eq(auditRowChanges.tableName, "complaints"), eq(auditRowChanges.rowId, id), eq(auditRowChanges.op, "UPDATE")));
      const change = rows.find((r) => r.changes.description);
      expect(change).toBeTruthy();
      expect(change!.changes.description).toEqual({ from: "Original wording", to: "Corrected wording" });
      expect(change!.changes.severity).toEqual({ from: "low", to: "high" });
      expect(change!.actorUserId).toBe(adminId);
      expect(change!.changes).not.toHaveProperty("updated_at"); // noise columns are left out
    });

    it("the history entry carries its own field changes (matched on the shared transaction id)", async () => {
      const created = await request(app).post("/complaints").set(auth()).send({ description: "History before" });
      const id = created.body.id as number;
      await request(app).patch(`/complaints/${id}`).set(auth()).send({ description: "History after" });

      const history = await request(app).get(`/workflow/history/complaints/${id}`).set(auth());
      expect(history.status).toBe(200);
      const updateEntry = history.body.find((e: { action: string; fieldChanges: unknown[] }) => e.action === "update" && e.fieldChanges.length > 0);
      expect(updateEntry).toBeTruthy();
      expect(updateEntry.fieldChanges[0]).toMatchObject({ table: "complaints", op: "UPDATE", changes: { description: { from: "History before", to: "History after" } } });
    });

    it("a user's role change is recorded with the old and new role", async () => {
      const [target] = await db.insert(users).values({ tenantId: tenantAId, email: `audit-int-target-${suffix}@test.local`, passwordHash: "unused", roleId: roleIds[0] }).returning();
      userIds.push(target!.id);

      const res = await request(app).patch(`/users/${target!.id}`).set(auth()).send({ roleId: roleIds[1] });
      expect(res.status).toBe(200);

      const rows = await db.select().from(auditRowChanges).where(and(eq(auditRowChanges.tableName, "users"), eq(auditRowChanges.rowId, target!.id), eq(auditRowChanges.op, "UPDATE")));
      const change = rows.find((r) => r.changes.role_id);
      expect(change!.changes.role_id).toEqual({ from: roleIds[0], to: roleIds[1] });
      expect(change!.actorUserId).toBe(adminId);
    });
  });

  describe("credentials are never stored", () => {
    it("a new user's password hash is logged as [redacted], never as the hash", async () => {
      const res = await request(app).post("/users").set(auth()).send({ email: `audit-int-newuser-${suffix}@test.local`, password: "CorrectHorse9!" });
      expect(res.status).toBe(201);
      userIds.push(res.body.id);

      const [row] = await db.select().from(auditRowChanges).where(and(eq(auditRowChanges.tableName, "users"), eq(auditRowChanges.rowId, res.body.id), eq(auditRowChanges.op, "INSERT")));
      expect(row!.changes.password_hash).toEqual({ to: "[redacted]" });
      expect(JSON.stringify(row!.changes)).not.toContain("$2"); // no bcrypt hash anywhere
      expect(JSON.stringify(row!.changes)).not.toContain("CorrectHorse9!");
    });

    it("tenant secret blobs (AI key, ERP webhook secret) never reach the log, but ordinary tenant edits still do", async () => {
      await pool.query(`UPDATE tenants SET ai_config = '{"apiKeyEncrypted":"TOP-SECRET-VALUE"}'::jsonb WHERE id = $1`, [tenantAId]);
      await pool.query(`UPDATE tenants SET name = $2 WHERE id = $1`, [tenantAId, `Audit Int A renamed ${suffix}`]);

      const rows = await db.select().from(auditRowChanges).where(and(eq(auditRowChanges.tableName, "tenants"), eq(auditRowChanges.rowId, tenantAId)));
      expect(JSON.stringify(rows)).not.toContain("TOP-SECRET-VALUE");
      expect(rows.some((r) => (r.changes.name as { to?: string } | undefined)?.to === `Audit Int A renamed ${suffix}`)).toBe(true);
      expect(rows.every((r) => !("ai_config" in r.changes))).toBe(true);
    });
  });

  describe("deactivating a user", () => {
    it("leaves an audit entry and a field-level is_active change", async () => {
      const [target] = await db.insert(users).values({ tenantId: tenantAId, email: `audit-int-leaver-${suffix}@test.local`, passwordHash: "unused" }).returning();
      userIds.push(target!.id);

      const res = await request(app).delete(`/users/${target!.id}`).set(auth());
      expect(res.status).toBe(204);

      const entries = await db.select().from(auditTrail).where(and(eq(auditTrail.tenantId, tenantAId), eq(auditTrail.entityType, "User"), eq(auditTrail.entityId, target!.id)));
      expect(entries.some((e) => e.action === "status_change" && (e.changes as { action?: string } | null)?.action === "deactivate" && e.performedBy === adminId)).toBe(true);

      const [rowChange] = await db.select().from(auditRowChanges).where(and(eq(auditRowChanges.tableName, "users"), eq(auditRowChanges.rowId, target!.id), eq(auditRowChanges.op, "UPDATE")));
      expect(rowChange!.changes.is_active).toEqual({ from: true, to: false });
    });
  });

  describe("history cannot be rewritten by the app role", () => {
    it("cannot UPDATE or DELETE audit_trail, but can read it and append to its own tenant", async () => {
      await request(app).post("/complaints").set(auth()).send({ description: "Seed an audit entry" });

      await expect(asAppRole(tenantAId, (q) => q("UPDATE audit_trail SET action = 'tampered'"))).rejects.toThrow(/permission denied/i);
      await expect(asAppRole(tenantAId, (q) => q("DELETE FROM audit_trail"))).rejects.toThrow(/permission denied/i);

      const readable = await asAppRole(tenantAId, async (q) => Number((await q("SELECT count(*)::int AS n FROM audit_trail")).rows[0]!.n));
      expect(readable).toBeGreaterThan(0);

      const appended = await asAppRole(tenantAId, async (q) => (await q("INSERT INTO audit_trail (tenant_id, entity_type, entity_id, action) VALUES ($1, 'X', 1, 'create')", [tenantAId])).rowCount);
      expect(appended).toBe(1);
      await expect(asAppRole(tenantAId, (q) => q("INSERT INTO audit_trail (tenant_id, entity_type, entity_id, action) VALUES ($1, 'X', 1, 'create')", [tenantBId]))).rejects.toThrow(/row-level security/i);
    });

    it("cannot write to audit_row_changes at all — rows only arrive through the trigger — and sees only its own tenant's", async () => {
      await expect(asAppRole(tenantAId, (q) => q("INSERT INTO audit_row_changes (tenant_id, table_name, op, changes) VALUES ($1, 'ncr', 'UPDATE', '{}'::jsonb)", [tenantAId]))).rejects.toThrow(/permission denied/i);
      await expect(asAppRole(tenantAId, (q) => q("UPDATE audit_row_changes SET op = 'INSERT'"))).rejects.toThrow(/permission denied/i);
      await expect(asAppRole(tenantAId, (q) => q("DELETE FROM audit_row_changes"))).rejects.toThrow(/permission denied/i);

      await pool.query(`INSERT INTO audit_row_changes (tenant_id, table_name, op, changes) VALUES ($1, 'marker_b', 'INSERT', '{}'::jsonb)`, [tenantBId]);
      const seenByA = await asAppRole(tenantAId, async (q) => Number((await q("SELECT count(*)::int AS n FROM audit_row_changes WHERE table_name = 'marker_b'")).rows[0]!.n));
      const seenByB = await asAppRole(tenantBId, async (q) => Number((await q("SELECT count(*)::int AS n FROM audit_row_changes WHERE table_name = 'marker_b'")).rows[0]!.n));
      expect(seenByA).toBe(0);
      expect(seenByB).toBe(1);
    });
  });
});
