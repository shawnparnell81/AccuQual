import { and, asc, desc, eq, ilike, or, gt } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import {
  quarantineRecords,
  quarantineInventory,
  quarantineResolutions,
  ENFORCED_ITEM_TYPES,
  type QuarantineRecord,
  type QuarantineItemType,
  type QuarantineReasonCategory,
} from "../../drizzle/schema/quarantine.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { inventoryLots } from "../../drizzle/schema/inventoryLots.js";
import { erpReceivingLineItems, erpPoLineItems } from "../../drizzle/schema/erp.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { notifyDepartment } from "../notifications/notification.service.js";
import { holdableUnits, liftHold, placeHold, removeHeldStock, type HoldTarget } from "../inventory/inventoryHolds.service.js";

/**
 * Quarantine rules, in one place. A hold puts some quantity of something out of use until a person decides what happens to it:
 * RELEASE it (use as is, reworked, sorted) or REMOVE it (scrapped, returned to the supplier). Decisions can cover part of the
 * quantity; the record closes when none is left on hold. Holds on inventory lots and items are enforced by the inventory system
 * itself; other kinds (finished goods, work in process, equipment, other) are records people are expected to honour, and are marked
 * "not enforced". The module keeps its own tables and writes nothing outside them except the inventory hold counters.
 */

export const RELEASE_DISPOSITIONS = ["use_as_is", "reworked", "sorted"] as const;
export const DESTROY_DISPOSITIONS = ["scrapped", "returned_to_supplier", "other"] as const;
export const DEFAULT_LOCATION = "Quarantine area";
const MIN_TEXT = 5;
const DAY_MS = 86_400_000;

export interface CreateInput {
  itemType: QuarantineItemType;
  itemId?: number;
  itemLabel?: string;
  quantity: number;
  unit?: string;
  location?: string;
  reasonCategory?: QuarantineReasonCategory;
  reason: string;
  ncrId?: number;
  sourceType?: string;
  sourceId?: number;
  metadata?: Record<string, unknown>;
}

interface Resolved {
  label: string;
  unit: string | null;
  lotNumber: string | null;
  target: HoldTarget | null;
  itemId: number | null;
}

/** Works out what is being held: its name, and (for inventory) what the inventory system must protect. */
async function resolveTarget(db: Db, input: CreateInput): Promise<Resolved> {
  if (input.itemType === "inventory_lot") {
    if (!input.itemId) throw AppError.badRequest("Choose the lot to put on hold.");
    const [lot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.id, input.itemId)));
    if (!lot) throw AppError.notFound("Inventory lot");
    const [item] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, lot.itemId)));
    return { label: `${item?.sku ?? `Item #${lot.itemId}`} — lot ${lot.lotNumber}${lot.serialNumber ? ` / serial ${lot.serialNumber}` : ""}`, unit: item?.unitOfMeasure ?? null, lotNumber: lot.lotNumber, target: { itemId: lot.itemId, lotId: lot.id }, itemId: lot.id };
  }
  if (input.itemType === "inventory_item") {
    if (!input.itemId) throw AppError.badRequest("Choose the inventory item to put on hold.");
    const [item] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, input.itemId)));
    if (!item) throw AppError.notFound("Inventory item");
    return { label: `${item.sku}${item.description ? ` — ${item.description}` : ""}`, unit: item.unitOfMeasure ?? null, lotNumber: null, target: { itemId: item.id }, itemId: item.id };
  }
  if (!input.itemLabel?.trim()) throw AppError.badRequest("Say what is being held (a name or description).");
  return { label: input.itemLabel.trim().slice(0, 200), unit: null, lotNumber: null, target: null, itemId: input.itemId ?? null };
}

function targetOf(record: QuarantineRecord): HoldTarget | null {
  return record.enforced ? ((record.metadata as { target?: HoldTarget }).target ?? null) : null;
}

async function emit(event: string, id: number, extra: Record<string, unknown> = {}) {
  await publishEvent(WORKFLOW_STREAM, { module: "quarantine", event, entityId: id, ...extra });
}

const ageDays = (r: QuarantineRecord, now = new Date()) => (r.createdAt ? Math.floor((now.getTime() - r.createdAt.getTime()) / DAY_MS) : 0);

// ---- Create ---------------------------------------------------------------------------------------------------------------------------------------

export async function createQuarantine(db: Db, input: CreateInput, actor?: number): Promise<QuarantineRecord> {
  if (!(input.quantity > 0)) throw AppError.badRequest("The quantity on hold must be more than zero.");
  if (input.reason.trim().length < MIN_TEXT) throw AppError.badRequest(`Say why it is on hold (at least ${MIN_TEXT} characters).`);
  const resolved = await resolveTarget(db, input);
  const enforced = ENFORCED_ITEM_TYPES.includes(input.itemType) && resolved.target !== null;

  if (input.ncrId !== undefined) {
    const [n] = await db.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, input.ncrId), eq(ncr.isDeleted, false)));
    if (!n) throw AppError.badRequest("That NCR doesn't exist in this organization.");
  }
  if (enforced) {
    const available = await holdableUnits(db, resolved.target!);
    if (input.quantity > available) throw AppError.badRequest(`Only ${available} unit(s) can be put on hold${input.itemType === "inventory_lot" ? " from that lot" : ""}: the rest are already held or used.`);
  }

  const [record] = await db
    .insert(quarantineRecords)
    .values({
      itemType: input.itemType,
      itemId: resolved.itemId,
      itemLabel: resolved.label,
      lotNumber: resolved.lotNumber,
      quantity: String(input.quantity),
      originalQuantity: String(input.quantity),
      unit: input.unit ?? resolved.unit,
      reasonCategory: input.reasonCategory ?? "other",
      reason: input.reason.trim(),
      enforced,
      sourceType: input.sourceType ?? "manual",
      sourceId: input.sourceId,
      ncrId: input.ncrId,
      metadata: { ...(input.metadata ?? {}), ...(enforced ? { target: resolved.target } : {}) },
      createdBy: actor,
    })
    .returning();
  if (!record) throw new AppError("Failed to create the quarantine record", 500);

  if (enforced) await placeHold(db, resolved.target!, input.quantity, { quarantineId: record.id }, actor);
  await db.insert(quarantineInventory).values({ quarantineId: record.id, location: input.location?.trim() || DEFAULT_LOCATION, quantity: String(input.quantity) });
  await recordAuditTrail(db, { entityType: "Quarantine", entityId: record.id, action: "create", changes: { event: "quarantine_created", itemType: input.itemType, item: resolved.label, quantity: input.quantity, reasonCategory: record.reasonCategory, reason: record.reason, enforced, sourceType: record.sourceType, ncrId: input.ncrId }, performedBy: actor });
  await emit("created", record.id, { itemType: input.itemType, enforced });
  await notifyDepartment(db, { department: "quality", subject: `Quarantine hold: ${resolved.label}`, body: `${input.quantity}${resolved.unit ? ` ${resolved.unit}` : ""} of ${resolved.label} put on hold (${record.reasonCategory.replace(/_/g, " ")}): ${record.reason}${enforced ? "" : " (this hold is a record only — the system cannot stop this item being used)"}`, relatedEntityType: "Quarantine", relatedEntityId: record.id }).catch((err) => logger.error("Quarantine notice failed", { err: String(err) }));
  return record;
}

// ---- Read -----------------------------------------------------------------------------------------------------------------------------------------

export async function getQuarantine(db: Db, id: number) {
  const [record] = await db.select().from(quarantineRecords).where(and(eq(quarantineRecords.id, id)));
  if (!record) throw AppError.notFound("Quarantine record");
  const inventory = await db.select().from(quarantineInventory).where(and(eq(quarantineInventory.quarantineId, id))).orderBy(asc(quarantineInventory.id));
  const resolutions = await db.select().from(quarantineResolutions).where(and(eq(quarantineResolutions.quarantineId, id))).orderBy(asc(quarantineResolutions.id));
  return { ...record, ageDays: ageDays(record), inventory, resolutions };
}

export interface ListFilters {
  status?: string;
  itemType?: string;
  q?: string;
  olderThanDays?: number;
}

export async function listQuarantine(db: Db, filters: ListFilters = {}) {
  const conditions = [];
  if (filters.status) conditions.push(eq(quarantineRecords.status, filters.status as QuarantineRecord["status"]));
  if (filters.itemType) conditions.push(eq(quarantineRecords.itemType, filters.itemType as QuarantineItemType));
  if (filters.q) {
    const like = `%${filters.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(quarantineRecords.itemLabel, like), ilike(quarantineRecords.reason, like), ilike(quarantineRecords.lotNumber, like))!);
  }
  const rows = await db.select().from(quarantineRecords).where(and(...conditions)).orderBy(desc(quarantineRecords.createdAt), desc(quarantineRecords.id));
  const now = new Date();
  const out = rows.map((r) => ({ ...r, ageDays: r.status === "quarantined" ? ageDays(r, now) : 0 }));
  return filters.olderThanDays ? out.filter((r) => r.status === "quarantined" && r.ageDays >= filters.olderThanDays!) : out;
}

/** The dashboard numbers: what is on hold, how long it has been there, and how much of it the system actually enforces. */
export async function summary(db: Db) {
  const open = await db.select().from(quarantineRecords).where(and(eq(quarantineRecords.status, "quarantined")));
  const now = new Date();
  const byReason: Record<string, number> = {};
  for (const r of open) byReason[r.reasonCategory] = (byReason[r.reasonCategory] ?? 0) + 1;
  const ages = open.map((r) => ageDays(r, now));
  return {
    openHolds: open.length,
    enforcedHolds: open.filter((r) => r.enforced).length,
    notEnforcedHolds: open.filter((r) => !r.enforced).length,
    olderThan7Days: ages.filter((a) => a >= 7).length,
    olderThan30Days: ages.filter((a) => a >= 30).length,
    oldestDays: ages.length ? Math.max(...ages) : 0,
    byReason,
  };
}

/** GET /quarantine/inventory — what is physically where: every location with held quantity, and totals per location. */
export async function listInventory(db: Db, location?: string) {
  const conditions = [eq(quarantineRecords.status, "quarantined"), gt(quarantineInventory.quantity, "0")];
  if (location) conditions.push(eq(quarantineInventory.location, location));
  const rows = await db
    .select({
      id: quarantineInventory.id,
      quarantineId: quarantineInventory.quarantineId,
      location: quarantineInventory.location,
      quantity: quarantineInventory.quantity,
      itemLabel: quarantineRecords.itemLabel,
      itemType: quarantineRecords.itemType,
      unit: quarantineRecords.unit,
      reasonCategory: quarantineRecords.reasonCategory,
      enforced: quarantineRecords.enforced,
      createdAt: quarantineRecords.createdAt,
    })
    .from(quarantineInventory)
    .innerJoin(quarantineRecords, eq(quarantineRecords.id, quarantineInventory.quarantineId))
    .where(and(...conditions))
    .orderBy(asc(quarantineInventory.location), desc(quarantineRecords.createdAt));
  const totals = new Map<string, { location: string; lines: number; quantity: number }>();
  for (const r of rows) {
    const t = totals.get(r.location) ?? { location: r.location, lines: 0, quantity: 0 };
    t.lines += 1;
    t.quantity += Number(r.quantity);
    totals.set(r.location, t);
  }
  return { rows, byLocation: [...totals.values()] };
}

// ---- Change ---------------------------------------------------------------------------------------------------------------------------------------

export async function updateQuarantine(db: Db, id: number, patch: { reason?: string; reasonCategory?: QuarantineReasonCategory; ncrId?: number | null; metadata?: Record<string, unknown> }, actor?: number): Promise<QuarantineRecord> {
  const [record] = await db.select().from(quarantineRecords).where(and(eq(quarantineRecords.id, id)));
  if (!record) throw AppError.notFound("Quarantine record");
  if (record.status !== "quarantined") throw new AppError("A closed quarantine record can't be changed — it is part of the history.", 409);
  if (patch.reason !== undefined && patch.reason.trim().length < MIN_TEXT) throw AppError.badRequest(`The reason needs at least ${MIN_TEXT} characters.`);
  if (patch.ncrId) {
    const [n] = await db.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, patch.ncrId), eq(ncr.isDeleted, false)));
    if (!n) throw AppError.badRequest("That NCR doesn't exist in this organization.");
  }
  const [updated] = await db
    .update(quarantineRecords)
    .set({
      ...(patch.reason !== undefined ? { reason: patch.reason.trim() } : {}),
      ...(patch.reasonCategory !== undefined ? { reasonCategory: patch.reasonCategory } : {}),
      ...(patch.ncrId !== undefined ? { ncrId: patch.ncrId } : {}),
      // metadata is merged, and the enforcement target the system stored is never something a caller can overwrite.
      ...(patch.metadata !== undefined ? { metadata: { ...patch.metadata, ...((record.metadata as { target?: HoldTarget }).target ? { target: (record.metadata as { target?: HoldTarget }).target } : {}) } } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(quarantineRecords.id, id)))
    .returning();
  await recordAuditTrail(db, { entityType: "Quarantine", entityId: id, action: "update", changes: { event: "quarantine_updated", ...patch }, performedBy: actor });
  return updated!;
}

/** Moves held quantity between locations (a bin to the quarantine cage). The total on hold does not change. */
export async function relocate(db: Db, id: number, input: { fromLocation: string; toLocation: string; quantity: number }, actor?: number) {
  const [record] = await db.select().from(quarantineRecords).where(and(eq(quarantineRecords.id, id)));
  if (!record) throw AppError.notFound("Quarantine record");
  if (record.status !== "quarantined") throw new AppError("Only held material can be moved.", 409);
  const from = input.fromLocation.trim();
  const to = input.toLocation.trim();
  if (!to || from === to) throw AppError.badRequest("Choose a different place to move it to.");
  const rows = await db.select().from(quarantineInventory).where(and(eq(quarantineInventory.quarantineId, id)));
  const source = rows.find((r) => r.location === from);
  if (!source || Number(source.quantity) < input.quantity) throw AppError.badRequest(`There aren't ${input.quantity} unit(s) at "${from}" to move.`);
  const left = Number(source.quantity) - input.quantity;
  if (left === 0) await db.delete(quarantineInventory).where(eq(quarantineInventory.id, source.id));
  else await db.update(quarantineInventory).set({ quantity: String(left), updatedAt: new Date() }).where(eq(quarantineInventory.id, source.id));
  const dest = rows.find((r) => r.location === to);
  if (dest) await db.update(quarantineInventory).set({ quantity: String(Number(dest.quantity) + input.quantity), updatedAt: new Date() }).where(eq(quarantineInventory.id, dest.id));
  else await db.insert(quarantineInventory).values({ quarantineId: id, location: to, quantity: String(input.quantity) });
  await recordAuditTrail(db, { entityType: "Quarantine", entityId: id, action: "update", changes: { event: "quarantine_moved", from, to, quantity: input.quantity }, performedBy: actor });
}

// ---- Decide ---------------------------------------------------------------------------------------------------------------------------------------

export interface ResolveInput {
  quantity?: number;
  disposition: string;
  notes: string;
}

export interface ResolveActor {
  id: number;
  roleName: string | null;
  /** Receiving acceptance is itself the quality decision, so it may resolve a hold the same person opened. */
  skipFourEyes?: boolean;
}

async function reduceInventoryRows(db: Db, id: number, quantity: number) {
  const rows = await db.select().from(quarantineInventory).where(and(eq(quarantineInventory.quarantineId, id))).orderBy(asc(quarantineInventory.id));
  let remaining = quantity;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(Number(row.quantity), remaining);
    const left = Number(row.quantity) - take;
    if (left <= 0) await db.delete(quarantineInventory).where(eq(quarantineInventory.id, row.id));
    else await db.update(quarantineInventory).set({ quantity: String(left), updatedAt: new Date() }).where(eq(quarantineInventory.id, row.id));
    remaining -= take;
  }
}

/** Release (back into use) or destroy (removed from stock) some or all of what is on hold. */
export async function resolveQuarantine(db: Db, id: number, action: "release" | "destroy", input: ResolveInput, actor: ResolveActor): Promise<QuarantineRecord> {
  const [record] = await db.select().from(quarantineRecords).where(and(eq(quarantineRecords.id, id)));
  if (!record) throw AppError.notFound("Quarantine record");
  if (record.status !== "quarantined") throw new AppError("This hold is already closed.", 409);

  const allowed: readonly string[] = action === "release" ? RELEASE_DISPOSITIONS : DESTROY_DISPOSITIONS;
  if (!allowed.includes(input.disposition)) throw AppError.badRequest(`A ${action} needs a disposition: ${allowed.join(", ")}.`);
  if (input.notes.trim().length < MIN_TEXT) throw AppError.badRequest(`Record why (at least ${MIN_TEXT} characters): a decision on held material is part of the history.`);
  const held = Number(record.quantity);
  const quantity = input.quantity ?? held;
  if (!(quantity > 0) || quantity > held) throw AppError.badRequest(`Choose a quantity between 0 and ${held}.`);

  // Four eyes: whoever put material on hold does not also decide what happens to it (an admin excepted, and that is recorded).
  const isAdmin = actor.roleName === "admin" || actor.roleName === "platform_admin";
  const selfDecision = record.createdBy === actor.id;
  if (selfDecision && !isAdmin && !actor.skipFourEyes) throw AppError.forbidden("You put this on hold, so someone else has to decide what happens to it.");

  // A system-triggered decision (no signed-in user) is recorded without a person rather than with a made-up one.
  const actorId = actor.id > 0 ? actor.id : undefined;
  const target = targetOf(record);
  if (target) {
    if (action === "release") await liftHold(db, target, quantity, { quarantineId: id, reason: `Released: ${input.disposition}` }, actorId);
    else await removeHeldStock(db, target, quantity, { movementType: input.disposition === "returned_to_supplier" ? "return" : "scrap", reason: `Quarantine #${id} ${input.disposition.replace(/_/g, " ")}`, quarantineId: id }, actorId);
  }
  await reduceInventoryRows(db, id, quantity);
  await db.insert(quarantineResolutions).values({ quarantineId: id, action, disposition: input.disposition, quantity: String(quantity), notes: input.notes.trim(), resolvedBy: actorId });

  const remaining = held - quantity;
  const past = await db.select().from(quarantineResolutions).where(and(eq(quarantineResolutions.quarantineId, id), eq(quarantineResolutions.action, "release")));
  const closed = remaining === 0;
  const finalStatus = closed ? (past.length > 0 ? "released" : "destroyed") : "quarantined";
  const [updated] = await db
    .update(quarantineRecords)
    .set({ quantity: String(remaining), status: finalStatus, updatedAt: new Date(), ...(closed ? { closedBy: actorId, ...(finalStatus === "released" ? { releasedAt: new Date() } : { destroyedAt: new Date() }) } : {}) })
    .where(and(eq(quarantineRecords.id, id)))
    .returning();
  await recordAuditTrail(db, {
    entityType: "Quarantine",
    entityId: id,
    action: "status_change",
    changes: { event: action === "release" ? "quarantine_released" : "quarantine_destroyed", disposition: input.disposition, quantity, remaining, closed, finalStatus, notes: input.notes.trim(), ...(selfDecision ? { selfDecided: true } : {}) },
    performedBy: actorId,
  });
  await emit(action === "release" ? "released" : "destroyed", id, { quantity, closed });
  return updated!;
}

// ---- Receiving ------------------------------------------------------------------------------------------------------------------------------------

/**
 * A receiving line moved to "quarantined": put the received stock on hold (idempotent — a second call returns the open hold).
 * Holds what is actually still in stock; if some was already used the shortfall is recorded, and if none is left the hold is a
 * record only.
 */
export async function openFromReceivingLine(db: Db, lineItemId: number, actor?: number): Promise<QuarantineRecord | null> {
  const [existing] = await db.select().from(quarantineRecords).where(and(eq(quarantineRecords.sourceType, "receiving_line_item"), eq(quarantineRecords.sourceId, lineItemId), eq(quarantineRecords.status, "quarantined")));
  if (existing) return existing;
  const [line] = await db.select().from(erpReceivingLineItems).where(and(eq(erpReceivingLineItems.id, lineItemId)));
  if (!line) return null;
  const [poLine] = await db.select().from(erpPoLineItems).where(and(eq(erpPoLineItems.id, line.poLineItemId)));
  const [lot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.receivingLineItemId, lineItemId)));

  const base = { reasonCategory: "nonconforming_material" as const, reason: "Quarantined at receiving inspection.", sourceType: "receiving_line_item", sourceId: lineItemId, metadata: { receivingLineItemId: lineItemId } };
  const wanted = line.quantityReceived;
  const target: HoldTarget | null = lot ? { itemId: lot.itemId, lotId: lot.id } : poLine ? { itemId: poLine.itemId } : null;
  if (target) {
    const available = await holdableUnits(db, target);
    const qty = Math.min(wanted, available);
    if (qty > 0) {
      return createQuarantine(db, { ...base, itemType: lot ? "inventory_lot" : "inventory_item", itemId: lot ? lot.id : poLine!.itemId, quantity: qty, metadata: { ...base.metadata, ...(qty < wanted ? { shortfall: wanted - qty, note: `${wanted - qty} of the ${wanted} received unit(s) were no longer in stock and could not be held.` } : {}) } }, actor);
    }
  }
  return createQuarantine(db, { ...base, itemType: "other", itemLabel: `Receiving line #${lineItemId}${line.lotNumber ? ` — lot ${line.lotNumber}` : ""}`, quantity: wanted, metadata: { ...base.metadata, note: "No stock was available to hold, so this is a record only." } }, actor);
}

/** A receiving line left "quarantined": accepted releases the hold as use-as-is; rejected leaves it held for a disposition (return or scrap). */
export async function resolveFromReceivingLine(db: Db, lineItemId: number, outcome: "accepted" | "rejected", actor: ResolveActor): Promise<void> {
  const [record] = await db.select().from(quarantineRecords).where(and(eq(quarantineRecords.sourceType, "receiving_line_item"), eq(quarantineRecords.sourceId, lineItemId), eq(quarantineRecords.status, "quarantined")));
  if (!record) return;
  if (outcome === "accepted") {
    await resolveQuarantine(db, record.id, "release", { disposition: "use_as_is", notes: "Accepted at receiving inspection." }, { ...actor, skipFourEyes: true });
    return;
  }
  await recordAuditTrail(db, { entityType: "Quarantine", entityId: record.id, action: "update", changes: { event: "receiving_rejected", note: "Rejected at receiving inspection; still on hold until it is returned to the supplier or scrapped." }, performedBy: actor.id > 0 ? actor.id : undefined });
}

export async function linkNcrFromReceiving(db: Db, quarantineId: number, ncrId: number) {
  await db.update(quarantineRecords).set({ ncrId, updatedAt: new Date() }).where(and(eq(quarantineRecords.id, quarantineId)));
}
