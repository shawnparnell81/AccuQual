import { z } from "zod";

// z.coerce.number() rather than z.number(): the quick-create/quick-action
// forms these schemas validate send values from plain HTML number inputs
// (always strings on the wire), same as any generic form body — coercing
// here means the frontend doesn't have to remember to parseFloat every
// numeric field before every request.
export const createItemSchema = z.object({
  sku: z.string().min(1),
  description: z.string().optional(),
  itemType: z.enum(["raw_material", "wip", "finished_good"]).default("raw_material"),
  unitOfMeasure: z.string().optional(),
  defaultSupplierId: z.coerce.number().int().optional(),
  minLevel: z.coerce.number().min(0).default(0),
  maxLevel: z.coerce.number().min(0).optional(),
  reorderQuantity: z.coerce.number().min(0).optional(),
  leadTimeDays: z.coerce.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export const updateItemSchema = z.object({
  sku: z.string().min(1).optional(),
  description: z.string().optional(),
  itemType: z.enum(["raw_material", "wip", "finished_good"]).optional(),
  unitOfMeasure: z.string().optional(),
  defaultSupplierId: z.coerce.number().int().nullable().optional(),
  minLevel: z.coerce.number().min(0).optional(),
  maxLevel: z.coerce.number().min(0).nullable().optional(),
  reorderQuantity: z.coerce.number().min(0).nullable().optional(),
  leadTimeDays: z.coerce.number().int().min(0).nullable().optional(),
  notes: z.string().optional(),
  active: z.boolean().optional(),
});

/**
 * referenceType/referenceId are free-form manual tags, not validated
 * against any enum or foreign key — there's no Production Work Order
 * module (or anything else) to look them up against, so any user allowed
 * to log this movement can put whatever real-world reference they have on
 * it ("production_log" / "PL-2024-001", "batch" / "Batch 17", etc.).
 */
const referenceFields = {
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
};

/** Deactivation ("active: false") is admin-only — checked in the controller, not here. */
export const movementSchema = z
  .object({
    movementType: z.enum(["receive", "consume", "produce", "scrap", "transfer"]),
    quantity: z.coerce.number().positive(),
    fromLocation: z.string().optional(),
    toLocation: z.string().optional(),
    reason: z.string().optional(),
    ...referenceFields,
  })
  .refine((v) => v.movementType !== "transfer" || (v.fromLocation && v.toLocation), {
    message: "transfer requires both fromLocation and toLocation",
    path: ["toLocation"],
  })
  .refine((v) => v.movementType !== "scrap" || !!v.reason?.trim(), {
    message: "scrap requires a reason",
    path: ["reason"],
  });

export const adjustSchema = z.object({
  quantity: z.coerce.number().refine((v) => v !== 0, "quantity delta cannot be 0"), // signed delta, unlike movementSchema's positive magnitude
  location: z.string().optional(),
  reason: z.string().min(1),
  ...referenceFields,
});

export const checkMinMaxSchema = z.object({
  itemId: z.coerce.number().int().optional(), // omit to recompute every item for the tenant
});

export const reorderRequestNotesSchema = z.object({
  notes: z.string().max(2000), // may be empty, to clear a note
});
