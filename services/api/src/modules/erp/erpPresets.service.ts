import { and, eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { erpConnectorPresets, type ErpConnectorPreset, type ErpPresetMappingConfig, type ErpPresetVersionEntry } from "../../drizzle/schema/erpPresets.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

const VERSION_HISTORY_CAP = 20;

// Preset-loading cache for the mapping engine's per-sync-run lookups
// (erpMappingEngine.ts calls getActivePresetCached once per enabled module
// per trigger, not per record). Explicitly invalidated on every mutation
// below; the TTL is a safety net only, in case a future write path forgets
// to invalidate or this process runs alongside another instance — this app
// deploys as a single api container today (see docker-compose.yml), so a
// short in-memory TTL is a reasonable trade rather than a real distributed
// cache (Redis) for a lookup this infrequent (manual-trigger-only sync, see
// settings.erpSync.ts's own "no background scheduler" comment).
const ACTIVE_PRESET_CACHE_TTL_MS = 60_000;
const activePresetCache = new Map<string, { preset: ErpConnectorPreset | null; cachedAt: number }>();

function cacheKey(module: string): string {
  return module;
}

export function invalidatePresetCache(module: string): void {
  activePresetCache.delete(cacheKey(module));
}

/** Built-in (AccuQual-provided) presets plus the company's own, never soft-deleted. */
export async function listPresets(db: Db, filters: { vendor?: string; module?: string }) {
  const conditions = [eq(erpConnectorPresets.isDeleted, false)];
  if (filters.vendor) conditions.push(eq(erpConnectorPresets.vendor, filters.vendor));
  if (filters.module) conditions.push(eq(erpConnectorPresets.module, filters.module));
  return db.select().from(erpConnectorPresets).where(and(...conditions));
}

/** Global presets are visible to every tenant read-only; a tenant's own row must actually belong to them. */
export async function getPreset(db: Db, id: number): Promise<ErpConnectorPreset> {
  const [row] = await db
    .select()
    .from(erpConnectorPresets)
    .where(and(eq(erpConnectorPresets.id, id), eq(erpConnectorPresets.isDeleted, false)));
  if (!row) throw AppError.notFound("ERP preset");
  return row;
}

/** Only an editable row — used before any mutation (built-in presets are never edited/deleted/activated directly, only cloned). */
async function getOwnedPreset(db: Db, id: number): Promise<ErpConnectorPreset> {
  const [row] = await db.select().from(erpConnectorPresets).where(and(eq(erpConnectorPresets.id, id), eq(erpConnectorPresets.isBuiltin, false), eq(erpConnectorPresets.isDeleted, false)));
  if (!row) throw AppError.notFound("ERP preset");
  return row;
}

export async function createPreset(
  db: Db,
  input: { vendor: string; module: string; name: string; description?: string; direction: string; mappingConfig?: ErpPresetMappingConfig },
  createdBy: number | undefined
): Promise<ErpConnectorPreset> {
  const [created] = await db
    .insert(erpConnectorPresets)
    .values({
      vendor: input.vendor,
      module: input.module,
      name: input.name,
      description: input.description,
      direction: input.direction,
      mappingConfig: input.mappingConfig ?? { fieldMappings: [], triggers: [], validationRules: [] },
      version: 1,
      versionHistory: [],
      createdBy,
    })
    .returning();
  await recordAuditTrail(db, { entityType: "ErpConnectorPreset", entityId: created!.id, action: "create", performedBy: createdBy });
  return created!;
}

/**
 * Clones a global (or another tenant's, though that path is never reachable
 * from the UI) preset into a real tenant-owned row the tenant can then edit
 * — "Customize" in the list UI. Starts a fresh version history, same as any
 * other create.
 */
export async function clonePreset(db: Db, sourceId: number, createdBy: number | undefined): Promise<ErpConnectorPreset> {
  const source = await getPreset(db, sourceId);
  return createPreset(
    db,
    { vendor: source.vendor, module: source.module, name: `${source.name} (Custom)`, description: source.description ?? undefined, direction: source.direction, mappingConfig: source.mappingConfig },
    createdBy
  );
}

/**
 * Version bump only when mappingConfig actually changes — same content-diff
 * check as workflow.controller.ts's updateHandler (definitionChanged), not
 * a bump on every save (a rename/description edit isn't a new "version" of
 * the mapping itself).
 */
export async function updatePreset(
  db: Db,
  id: number,
  patch: { name?: string; description?: string; direction?: string; mappingConfig?: ErpPresetMappingConfig },
  updatedBy: number | undefined
): Promise<ErpConnectorPreset> {
  const existing = await getOwnedPreset(db, id);
  const mappingChanged = patch.mappingConfig !== undefined && JSON.stringify(patch.mappingConfig) !== JSON.stringify(existing.mappingConfig);

  const values: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if (mappingChanged) {
    const historyEntry: ErpPresetVersionEntry = { version: existing.version, mappingConfig: existing.mappingConfig, updatedAt: new Date().toISOString(), updatedBy: updatedBy ?? null };
    values.version = existing.version + 1;
    values.versionHistory = [...(existing.versionHistory ?? []), historyEntry].slice(-VERSION_HISTORY_CAP);
  }

  const [updated] = await db.update(erpConnectorPresets).set(values).where(and(eq(erpConnectorPresets.id, id))).returning();
  await recordAuditTrail(db, {
    entityType: "ErpConnectorPreset",
    entityId: id,
    action: "update",
    changes: { fieldsChanged: Object.keys(patch), newVersion: mappingChanged ? values.version : existing.version },
    performedBy: updatedBy,
  });
  invalidatePresetCache(existing.module);
  return updated!;
}

export async function softDeletePreset(db: Db, id: number, performedBy: number | undefined): Promise<void> {
  const existing = await getOwnedPreset(db, id);
  await db.update(erpConnectorPresets).set({ isDeleted: true, isActive: false, updatedAt: new Date() }).where(and(eq(erpConnectorPresets.id, id)));
  await recordAuditTrail(db, { entityType: "ErpConnectorPreset", entityId: id, action: "delete", performedBy });
  invalidatePresetCache(existing.module);
}

/**
 * Exactly one active preset per (tenantId, module) — enforced here rather
 * than a DB constraint, same "app-enforced activation" convention
 * workflowDefinitions.isActive already uses. No explicit db.transaction()
 * needed: every request already runs inside one Postgres transaction (see
 * tenantScope.ts's withDb, same convention erp.service.ts's own
 * comment documents). Publishes the app's
 * real, universal 4-field workflow-event shape (tenantId/module/event/
 * entityId — confirmed against ~30 existing publishEvent call sites) so a
 * tenant can optionally react to a preset activation from their own
 * Workflow Builder, same as any other module event; with no such workflow
 * authored yet, this is a real, structurally-consumed event that simply has
 * no matching definition to trigger — not a no-op by design.
 */
export async function activatePreset(db: Db, id: number, performedBy: number | undefined): Promise<ErpConnectorPreset> {
  const target = await getOwnedPreset(db, id);
  await db
    .update(erpConnectorPresets)
    .set({ isActive: false })
    .where(and(eq(erpConnectorPresets.module, target.module), eq(erpConnectorPresets.isActive, true)));
  await db.update(erpConnectorPresets).set({ isActive: true }).where(and(eq(erpConnectorPresets.id, id)));
  await recordAuditTrail(db, { entityType: "ErpConnectorPreset", entityId: id, action: "status_change", changes: { subAction: "activated", module: target.module }, performedBy });
  await publishEvent(WORKFLOW_STREAM, { module: target.module, event: "erp_preset_activated", entityId: id });
  invalidatePresetCache(target.module);
  return { ...target, isActive: true };
}

export async function getActivePreset(db: Db, module: string): Promise<ErpConnectorPreset | null> {
  const [row] = await db.select().from(erpConnectorPresets).where(and(eq(erpConnectorPresets.module, module), eq(erpConnectorPresets.isActive, true), eq(erpConnectorPresets.isDeleted, false)));
  return row ?? null;
}

/** Cached wrapper around getActivePreset — see activePresetCache's own comment. Used by erpMappingEngine.ts's buildErpPayload, not by the CRUD endpoints (those always want the true current row). */
export async function getActivePresetCached(db: Db, module: string): Promise<ErpConnectorPreset | null> {
  const key = cacheKey(module);
  const cached = activePresetCache.get(key);
  if (cached && Date.now() - cached.cachedAt < ACTIVE_PRESET_CACHE_TTL_MS) {
    return cached.preset;
  }
  const preset = await getActivePreset(db, module);
  activePresetCache.set(key, { preset, cachedAt: Date.now() });
  return preset;
}
