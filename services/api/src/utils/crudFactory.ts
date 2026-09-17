import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { asyncHandler } from "./asyncHandler.js";
import { AppError } from "./appError.js";
import { recordAuditTrail } from "../modules/audit-trail/audit-trail.service.js";
import { publishEvent, AI_STREAM } from "../lib/eventBus.js";
import type { TenantDb } from "../lib/tenantScope.js";

interface CrudOptions {
  entityName: string;
  idColumn: string; // e.g. "id"
  softDelete?: boolean; // if true, DELETE sets isDeleted instead of removing the row
  /**
   * Phase 2 NCR unified-data-model fix: optional side effects run inside the
   * same request (after the row is written, before the response is sent) —
   * added so ncr.controller.ts can keep the official NCR document (a
   * separate form_data row, see ncr.formSync.ts) in sync with the bare
   * row's own fields without every other crudFactory caller needing to
   * know or care. Errors here propagate like anything else in an
   * asyncHandler — same "let it throw" rule the audit trail already
   * follows (see audit-trail.service.ts's recordAuditTrail comment), not
   * swallowed.
   */
  afterCreate?: (created: Record<string, unknown>, req: Request) => Promise<void>;
  afterUpdate?: (updated: Record<string, unknown>, req: Request) => Promise<void>;
}

/**
 * Defense in depth: every module's Zod validation schema already omits these
 * fields (so Zod's default "strip unknown keys" behavior removes them before
 * the request ever reaches here) — but a route that forgets to add a
 * `validate(...)` middleware would otherwise let a client's request body
 * silently reassign a row's tenant via `.set({...req.body})`. Never trust
 * these fields from the client, validated or not.
 */
const CLIENT_OWNED_FIELD_BLOCKLIST = ["id", "tenantId", "createdAt", "createdBy"];

/**
 * Phase 11 performance pass — this generic `list` had NO limit at all
 * (confirmed: 13 modules' list endpoints, and DashboardPage.tsx's own
 * `.useList()` calls, all fetch every row of every tenant-scoped table with
 * no bound). A real pagination rewrite (new query params, a paginated
 * response envelope) would be a breaking change to every `useList()` caller
 * across the frontend — out of scope for a polish phase per "do not modify
 * architecture from earlier phases." This is a non-breaking safety net
 * instead: the response shape stays a plain array exactly as before, just
 * capped so a tenant that accumulates unusually many rows on one table
 * can't turn one dashboard load into an unbounded query. High enough that
 * no real list page hits it under normal use.
 */
const LIST_SAFETY_LIMIT = 2000;

export function stripClientOwnedFields(body: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...body };
  for (const field of CLIENT_OWNED_FIELD_BLOCKLIST) delete clean[field];
  return clean;
}

/**
 * Generates standard list/get/create/update/remove handlers bound to a Drizzle table.
 * Every operation is scoped to `req.tenantId` (set by lib/tenantScope.ts, which must
 * run before these handlers) — this is AccuQual's primary, always-active tenant
 * isolation guarantee; RLS (rls-policies.sql) is the second, DB-level layer.
 * Bespoke per-module actions (assign, close, approve, ...) live in that module's
 * own controller and are composed alongside these, and must apply the same
 * `req.tenantId` predicate manually.
 *
 * Deliberately loosely typed (`db` used as `any` internally): a generic factory that
 * has to work across every module's table shape can't carry each table's exact column
 * types through without per-call generics defeating the point of sharing this code.
 * Callers get full typing back from `table.$inferSelect` / `$inferInsert` at rest/rest.
 */
export function crudFactory(table: PgTable, options: CrudOptions) {
  const untypedDbOf = (db: TenantDb) =>
    db as unknown as {
      select: () => { from: (t: unknown) => { where: (w: unknown) => { limit: (n: number) => Promise<unknown[]> } & Promise<unknown[]> } & Promise<unknown[]> };
      insert: (t: unknown) => { values: (v: unknown) => { returning: () => Promise<unknown[]> } };
      update: (t: unknown) => { set: (v: unknown) => { where: (w: unknown) => { returning: () => Promise<unknown[]> } } };
      delete: (t: unknown) => { where: (w: unknown) => { returning: () => Promise<unknown[]> } };
    };
  const idCol = (table as unknown as Record<string, unknown>)[options.idColumn];
  const tenantCol = (table as unknown as Record<string, unknown>).tenantId;

  function requireTenantDb(req: Request): { db: ReturnType<typeof untypedDbOf>; tenantId: number } {
    if (!req.db || req.tenantId === undefined) throw AppError.unauthorized("Missing tenant context");
    return { db: untypedDbOf(req.db), tenantId: req.tenantId };
  }

  const list = asyncHandler(async (req: Request, res: Response) => {
    const { db, tenantId } = requireTenantDb(req);
    const rows = await db.select().from(table).where(eq(tenantCol as never, tenantId)).limit(LIST_SAFETY_LIMIT);
    res.json(rows);
  });

  const getOne = asyncHandler(async (req: Request, res: Response) => {
    const { db, tenantId } = requireTenantDb(req);
    const id = Number(req.params.id);
    const rows = await db.select().from(table).where(and(eq(idCol as never, id), eq(tenantCol as never, tenantId)));
    const row = rows[0];
    if (!row) throw AppError.notFound(options.entityName);
    res.json(row);
  });

  const create = asyncHandler(async (req: Request, res: Response) => {
    const { db, tenantId } = requireTenantDb(req);
    const [created] = await db
      .insert(table)
      .values({ ...stripClientOwnedFields(req.body), tenantId, createdBy: req.user?.id })
      .returning();
    const createdId = (created as { id: number }).id;
    await recordAuditTrail(req.db!, {
      tenantId,
      entityType: options.entityName,
      entityId: createdId,
      action: "create",
      changes: req.body,
      performedBy: req.user?.id,
    });
    // Queues the record for semantic embedding (see AI Engine Spec §2 "Embedding Engine")
    // so it becomes retrievable by the AI pipelines' similarity search.
    await publishEvent(AI_STREAM, {
      job: "embed",
      tenantId,
      entityType: options.entityName,
      entityId: createdId,
      content: JSON.stringify(req.body),
    });
    if (options.afterCreate) await options.afterCreate(created as Record<string, unknown>, req);
    res.status(201).json(created);
  });

  const update = asyncHandler(async (req: Request, res: Response) => {
    const { db, tenantId } = requireTenantDb(req);
    const id = Number(req.params.id);
    const [updated] = await db
      .update(table)
      .set({ ...stripClientOwnedFields(req.body), updatedAt: new Date() })
      .where(and(eq(idCol as never, id), eq(tenantCol as never, tenantId)))
      .returning();
    if (!updated) throw AppError.notFound(options.entityName);
    await recordAuditTrail(req.db!, {
      tenantId,
      entityType: options.entityName,
      entityId: id,
      action: "update",
      changes: req.body,
      performedBy: req.user?.id,
    });
    if (options.afterUpdate) await options.afterUpdate(updated as Record<string, unknown>, req);
    res.json(updated);
  });

  const remove = asyncHandler(async (req: Request, res: Response) => {
    const { db, tenantId } = requireTenantDb(req);
    const id = Number(req.params.id);
    const tenantPredicate = and(eq(idCol as never, id), eq(tenantCol as never, tenantId));
    if (options.softDelete) {
      const [updated] = await db.update(table).set({ isDeleted: true }).where(tenantPredicate).returning();
      if (!updated) throw AppError.notFound(options.entityName);
    } else {
      const deleted = await db.delete(table).where(tenantPredicate).returning();
      if (deleted.length === 0) throw AppError.notFound(options.entityName);
    }
    await recordAuditTrail(req.db!, {
      tenantId,
      entityType: options.entityName,
      entityId: id,
      action: "delete",
      performedBy: req.user?.id,
    });
    res.status(204).send();
  });

  return { list, getOne, create, update, remove };
}
