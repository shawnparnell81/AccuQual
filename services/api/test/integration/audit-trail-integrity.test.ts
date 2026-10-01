import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test.
// Audit-trail integrity: field-level old/new values written by the
// audit_row_change() trigger (who, from, to), credentials never stored,
// history entries carrying their field changes, deactivation being audited,
// and the app role being unable to rewrite or delete history.
import type { Request, Response } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { complaints } from "../../src/drizzle/schema/complaints.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { refreshTokens } from "../../src/drizzle/schema/refreshTokens.js";
import { withDb, withTableOwner, type Db } from "../../src/lib/requestDb.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let companyAId: number;

let adminId: number;
let adminToken: string;
const roleIds: number[] = [];
const userIds: number[] = [];
const auth = () => ({ Authorization: `Bearer ${adminToken}` });

function permissionDenied(err: unknown): boolean {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  return /permission denied/i.test(parts.join(" "));
}

/** One withDb transaction, the same path a signed-in request uses. */
function runInWithDb(userId: number, fn: (tx: Db) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = {
      user: { id: userId, roleId: null, roleName: "admin", department: null, supplierId: null },
    } as Request;
    const res = {
      statusCode: 200,
      json() {
        setTimeout(resolve, 30);
        return res;
      },
      send() {
        setTimeout(resolve, 30);
        return res;
      },
      on() {
        return res;
      },
    } as unknown as Response;
    withDb(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }
      fn(req.db!).then(
        () => {
          res.json(undefined);
        },
        (error: unknown) => {
          res.statusCode = 500;
          res.json(undefined);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  });
}

async function asAppRole<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE accuqual_app");
    return await fn((sql, params) => client.query(sql, params));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

describe("Audit trail integrity (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const a = await ensureTestCompany();
    
    companyAId = a!.id;
    
    const [admin] = await db.insert(users).values({ email: `audit-int-admin-${suffix}@test.local`, passwordHash: "unused" }).returning();
    adminId = admin!.id;
    userIds.push(adminId);
    adminToken = await signAccessToken({ sub: String(adminId), roleId: null, roleName: "admin", department: null });
    const inserted = await db.insert(roles).values([{ name: `audit-int-r1-${suffix}` }, { name: `audit-int-r2-${suffix}` }]).returning();
    roleIds.push(...inserted.map((r) => r.id));
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  describe("field-level old/new values", () => {
    it("an edit records what changed from and to, and who did it", async () => {
      const created = await request(app).post("/complaints").set(auth()).send({ description: "Original wording", severity: "low" });
      const id = created.body.id as number;
      const edit = await request(app).patch(`/complaints/${id}`).set(auth()).send({ description: "Corrected wording", severity: "high" });
      expect(edit.status).toBe(200);

      const rows = await db.select().from(auditRowChanges).where(and(eq(auditRowChanges.tableName, "complaints"), eq(auditRowChanges.rowId, id), eq(auditRowChanges.op, "UPDATE")));
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
      const [target] = await db.insert(users).values({ email: `audit-int-target-${suffix}@test.local`, passwordHash: "unused", roleId: roleIds[0] }).returning();
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
      const res = await request(app).post("/users").set(auth()).send({ email: `audit-int-newuser-${suffix}@test.local`, password: "CorrectHorse9!", name: "New Person", roleId: roleIds[0] });
      expect(res.status).toBe(201);
      userIds.push(res.body.id);

      const [row] = await db.select().from(auditRowChanges).where(and(eq(auditRowChanges.tableName, "users"), eq(auditRowChanges.rowId, res.body.id), eq(auditRowChanges.op, "INSERT")));
      expect(row!.changes.password_hash).toEqual({ to: "[redacted]" });
      expect(JSON.stringify(row!.changes)).not.toContain("$2"); // no bcrypt hash anywhere
      expect(JSON.stringify(row!.changes)).not.toContain("CorrectHorse9!");
    });

    it("company secret blobs (AI key, ERP webhook secret) never reach the log, but ordinary company edits still do", async () => {
      await pool.query(`UPDATE company SET ai_config = '{"apiKeyEncrypted":"TOP-SECRET-VALUE"}'::jsonb WHERE id = $1`, [companyAId]);
      await pool.query(`UPDATE company SET name = $2 WHERE id = $1`, [companyAId, `Audit Int A renamed ${suffix}`]);

      const rows = await db.select().from(auditRowChanges).where(and(eq(auditRowChanges.tableName, "company"), eq(auditRowChanges.rowId, companyAId)));
      expect(JSON.stringify(rows)).not.toContain("TOP-SECRET-VALUE");
      expect(rows.some((r) => (r.changes.name as { to?: string } | undefined)?.to === `Audit Int A renamed ${suffix}`)).toBe(true);
      expect(rows.every((r) => !("ai_config" in r.changes))).toBe(true);
    });
  });

  describe("removing a user", () => {
    it("erases an account that already has a sign-in session", async () => {
      const [target] = await db.insert(users).values({ email: `audit-int-session-${suffix}@test.local`, passwordHash: "unused", name: "Has Session" }).returning();
      await db.insert(refreshTokens).values({ userId: target!.id, jti: `jti-${suffix}`, expiresAt: new Date(Date.now() + 60_000) });

      const res = await request(app).delete(`/users/${target!.id}`).set(auth());
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe("deleted");
      expect(await db.select().from(refreshTokens).where(eq(refreshTokens.userId, target!.id))).toHaveLength(0);
    });

    it("the app role cannot see refresh tokens; the owner switch inside the request can delete them", async () => {
      const [target] = await db.insert(users).values({ email: `audit-int-token-${suffix}@test.local`, passwordHash: "unused" }).returning();
      userIds.push(target!.id);
      await db.insert(refreshTokens).values({ userId: target!.id, jti: `jti-keep-${suffix}`, expiresAt: new Date(Date.now() + 60_000) });

      await runInWithDb(adminId, async (tx) => {
        const hidden = await tx.execute(sql`DELETE FROM refresh_tokens WHERE user_id = ${target!.id}`);
        expect(hidden.rowCount).toBe(0);
        await withTableOwner(async () => {
          await tx.delete(refreshTokens).where(eq(refreshTokens.userId, target!.id));
        });
        const who = await tx.execute(sql`SELECT current_user AS u`);
        expect((who.rows[0] as { u: string }).u).toBe("accuqual_app");
      });

      expect(await db.select().from(refreshTokens).where(eq(refreshTokens.userId, target!.id))).toHaveLength(0);
    });

    it("erases an account with no records and logs the delete", async () => {
      const [target] = await db.insert(users).values({ email: `audit-int-leaver-${suffix}@test.local`, passwordHash: "unused", name: "No History" }).returning();

      const res = await request(app).delete(`/users/${target!.id}`).set(auth());
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe("deleted");
      expect(await db.select().from(users).where(eq(users.id, target!.id))).toHaveLength(0);

      const entries = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "User"), eq(auditTrail.entityId, target!.id)));
      expect(entries.some((e) => e.action === "delete" && e.performedBy === adminId)).toBe(true);
    });

    it("turns off an account that already appears in the audit log and keeps the name", async () => {
      const [target] = await db.insert(users).values({ email: `audit-int-historian-${suffix}@test.local`, passwordHash: "unused", name: "Has History" }).returning();
      userIds.push(target!.id);
      await db.insert(auditTrail).values({ entityType: "NCR", entityId: 1, action: "create", performedBy: target!.id });

      const res = await request(app).delete(`/users/${target!.id}`).set(auth());
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe("deactivated");

      const [still] = await db.select().from(users).where(eq(users.id, target!.id));
      expect(still).toMatchObject({ isActive: false, name: "Has History" });

      const entries = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "User"), eq(auditTrail.entityId, target!.id)));
      expect(entries.some((e) => e.action === "status_change" && (e.changes as { action?: string } | null)?.action === "deactivate" && e.performedBy === adminId)).toBe(true);

      const [rowChange] = await db.select().from(auditRowChanges).where(and(eq(auditRowChanges.tableName, "users"), eq(auditRowChanges.rowId, target!.id), eq(auditRowChanges.op, "UPDATE")));
      expect(rowChange!.changes.is_active).toEqual({ from: true, to: false });
    });
  });

  describe("history cannot be rewritten by the app role", () => {
    it("a signed-in request runs as accuqual_app and cannot UPDATE or DELETE audit_trail", async () => {
      await runInWithDb(adminId, async (tx) => {
        const who = await tx.execute(sql`SELECT current_user AS u`);
        expect((who.rows[0] as { u: string }).u).toBe("accuqual_app");
        await tx.execute(sql`SELECT count(*)::int AS n FROM audit_trail`);
      });

      await expect(runInWithDb(adminId, (tx) => tx.execute(sql`UPDATE audit_trail SET action = 'tampered'`))).rejects.toSatisfy(permissionDenied);
      await expect(runInWithDb(adminId, (tx) => tx.execute(sql`DELETE FROM audit_trail`))).rejects.toSatisfy(permissionDenied);
    });

    it("cannot UPDATE or DELETE audit_trail, but can read it and append to it", async () => {
      await request(app).post("/complaints").set(auth()).send({ description: "Seed an audit entry" });

      await expect(asAppRole((q) => q("UPDATE audit_trail SET action = 'tampered'"))).rejects.toThrow(/permission denied/i);
      await expect(asAppRole((q) => q("DELETE FROM audit_trail"))).rejects.toThrow(/permission denied/i);

      const readable = await asAppRole(async (q) => Number((await q("SELECT count(*)::int AS n FROM audit_trail")).rows[0]!.n));
      expect(readable).toBeGreaterThan(0);

      const appended = await asAppRole(async (q) => (await q("INSERT INTO audit_trail (entity_type, entity_id, action) VALUES ('X', 1, 'create')")).rowCount);
      expect(appended).toBe(1);
    });

    it("cannot write to audit_row_changes at all — rows only arrive through the trigger", async () => {
      await expect(asAppRole((q) => q("INSERT INTO audit_row_changes (table_name, op, changes) VALUES ('ncr', 'UPDATE', '{}'::jsonb)"))).rejects.toThrow(/permission denied/i);
      await expect(asAppRole((q) => q("UPDATE audit_row_changes SET op = 'INSERT'"))).rejects.toThrow(/permission denied/i);
      await expect(asAppRole((q) => q("DELETE FROM audit_row_changes"))).rejects.toThrow(/permission denied/i);
      // ...but it can read them.
      await expect(asAppRole((q) => q("SELECT count(*) FROM audit_row_changes"))).resolves.toBeTruthy();
    });
  });
});
