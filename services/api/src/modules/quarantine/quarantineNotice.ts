/**
 * FRM-NCR-002 (quarantine notice) → a real quarantine_records row.
 * The sheet can show location lines before they are saved. This module is
 * what writes the hold, and the quarantine list reads only those rows.
 */

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { quarantineInventory, quarantineRecords, quarantineResolutions } from "../../drizzle/schema/quarantine.js";
import { logger } from "../../utils/logger.js";
import { createQuarantine, DEFAULT_LOCATION, updateQuarantine } from "./quarantine.service.js";

export const QUARANTINE_NOTICE_SOURCE = "frm-ncr-002";

const QTY_ROWS = [17, 18, 19, 20, 21] as const;

export interface NoticeLocation {
  location: string;
  quantity: number;
}

export interface NoticeHold {
  partNumber: string;
  quantity: number;
  lotNumber: string | null;
  reason: string;
  locations: NoticeLocation[];
}

function cellText(cells: Record<string, unknown>, addr: string): string {
  const value = cells[addr];
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim();
  return "";
}

function cellQty(cells: Record<string, unknown>, addr: string): number {
  const value = cells[addr];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

/** Enough to place a hold: a part number and a quantity above zero. Otherwise the notice is still a draft. */
export function noticeHoldFromCells(cells: Record<string, unknown> | null | undefined): NoticeHold | null {
  if (!cells) return null;
  const partNumber = cellText(cells, "B6").slice(0, 200);
  const locations: NoticeLocation[] = [];
  for (const row of QTY_ROWS) {
    const quantity = cellQty(cells, `B${row}`);
    if (!(quantity > 0)) continue;
    const named = cellText(cells, `A${row}`).slice(0, 120);
    locations.push({ location: named || DEFAULT_LOCATION, quantity });
  }
  const quantity = locations.reduce((sum, line) => sum + line.quantity, 0);
  if (!partNumber || !(quantity > 0)) return null;
  const described = cellText(cells, "B11");
  const reason = (described.length >= 5 ? described : `Quarantine notice for ${partNumber}. ${described}`.trim()).slice(0, 2000);
  const lot = cellText(cells, "B7");
  return {
    partNumber,
    quantity,
    lotNumber: lot ? lot.slice(0, 120) : null,
    reason,
    locations,
  };
}

function formCells(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const cells = (data as { cells?: unknown }).cells;
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) return {};
  return cells as Record<string, unknown>;
}

async function replaceLocations(db: Db, quarantineId: number, locations: NoticeLocation[]) {
  await db.delete(quarantineInventory).where(eq(quarantineInventory.quarantineId, quarantineId));
  await db.insert(quarantineInventory).values(
    locations.map((line) => ({ quarantineId, location: line.location, quantity: String(line.quantity) })),
  );
}

/**
 * Creates the hold for this notice, or updates the open one.
 * A draft (no part or no quantity) does not create a hold. A database
 * failure is logged and rethrown so the notice save rolls back with it.
 */
export async function syncQuarantineNotice(db: Db, formId: number, data: unknown, actor?: number): Promise<number | null> {
  const hold = noticeHoldFromCells(formCells(data));
  const [open] = await db
    .select()
    .from(quarantineRecords)
    .where(and(eq(quarantineRecords.sourceType, QUARANTINE_NOTICE_SOURCE), eq(quarantineRecords.sourceId, formId), eq(quarantineRecords.status, "quarantined")))
    .orderBy(desc(quarantineRecords.id))
    .limit(1);

  if (!hold) {
    if (open) {
      logger.warn("FRM-NCR-002 no longer has a part number and quantity. The open quarantine hold was left in place.", {
        formId,
        quarantineId: open.id,
      });
    } else {
      logger.info("FRM-NCR-002 saved without a quarantine hold: part number or quantity is still blank.", { formId });
    }
    return open?.id ?? null;
  }

  const metadata = {
    partNumber: hold.partNumber,
    ...(hold.lotNumber ? { lotNumber: hold.lotNumber } : {}),
    isoFormId: formId,
    formKey: "frm-ncr-002",
  };

  try {
    if (!open) {
      const created = await createQuarantine(
        db,
        {
          itemType: "other",
          itemLabel: hold.partNumber,
          quantity: hold.quantity,
          location: hold.locations[0]?.location,
          reasonCategory: "nonconforming_material",
          reason: hold.reason,
          sourceType: QUARANTINE_NOTICE_SOURCE,
          sourceId: formId,
          metadata,
        },
        actor,
      );
      if (hold.lotNumber) {
        await db.update(quarantineRecords).set({ lotNumber: hold.lotNumber }).where(eq(quarantineRecords.id, created.id));
      }
      await replaceLocations(db, created.id, hold.locations);
      return created.id;
    }

    const [released] = await db.select({ id: quarantineResolutions.id }).from(quarantineResolutions).where(eq(quarantineResolutions.quarantineId, open.id)).limit(1);
    if (released) {
      logger.warn("FRM-NCR-002 was saved again after part of its hold was already released. The hold was not rewritten.", {
        formId,
        quarantineId: open.id,
      });
      return open.id;
    }

    await updateQuarantine(db, open.id, { reason: hold.reason, reasonCategory: "nonconforming_material", metadata }, actor);
    await db
      .update(quarantineRecords)
      .set({
        itemLabel: hold.partNumber,
        quantity: String(hold.quantity),
        originalQuantity: String(hold.quantity),
        lotNumber: hold.lotNumber,
        updatedAt: new Date(),
      })
      .where(eq(quarantineRecords.id, open.id));
    await replaceLocations(db, open.id, hold.locations);
    return open.id;
  } catch (err) {
    logger.error("FRM-NCR-002 quarantine hold was not saved", { formId, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
