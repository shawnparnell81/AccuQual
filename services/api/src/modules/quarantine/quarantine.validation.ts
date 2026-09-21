import { z } from "zod";
import { QUARANTINE_ITEM_TYPES, QUARANTINE_REASON_CATEGORIES } from "../../drizzle/schema/quarantine.js";
import { DESTROY_DISPOSITIONS, RELEASE_DISPOSITIONS } from "./quarantine.service.js";

export const createQuarantineSchema = z.object({
  itemType: z.enum(QUARANTINE_ITEM_TYPES),
  // inventory_lot: the lot's id. inventory_item: the item's id. Other kinds: optional reference.
  itemId: z.coerce.number().int().positive().optional(),
  itemLabel: z.string().trim().max(200).optional(),
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().max(30).optional(),
  location: z.string().trim().max(120).optional(),
  reasonCategory: z.enum(QUARANTINE_REASON_CATEGORIES).optional(),
  reason: z.string().trim().min(1).max(2000),
  ncrId: z.coerce.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateQuarantineSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000).optional(),
    reasonCategory: z.enum(QUARANTINE_REASON_CATEGORIES).optional(),
    ncrId: z.coerce.number().int().positive().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const releaseSchema = z.object({
  quantity: z.coerce.number().positive().optional(),
  disposition: z.enum(RELEASE_DISPOSITIONS),
  notes: z.string().trim().min(1).max(4000),
});

export const destroySchema = z.object({
  quantity: z.coerce.number().positive().optional(),
  disposition: z.enum(DESTROY_DISPOSITIONS),
  notes: z.string().trim().min(1).max(4000),
});

export const relocateSchema = z.object({
  fromLocation: z.string().trim().min(1).max(120),
  toLocation: z.string().trim().min(1).max(120),
  quantity: z.coerce.number().positive(),
});
