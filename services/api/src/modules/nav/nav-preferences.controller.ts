import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { navHiddenItems } from "../../drizzle/schema/navPreferences.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/**
 * Which built-in nav items (departments and their items — see navConfig.ts
 * on the web side) this tenant has hidden. The catalog itself is fixed code
 * on the frontend; this is just the on/off state layered over it, so "add it
 * back" is always available (nothing is ever deleted from the catalog).
 */
export const listHidden = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req.db!.select({ scope: navHiddenItems.scope }).from(navHiddenItems).where(eq(navHiddenItems.tenantId, req.tenantId!));
  res.json(rows.map((r) => r.scope));
});

// Full-System Audit finding L8 — scope validation used to be a hand-rolled
// `if (!scope) throw ...` inline; now enforced by validate(navScopeSchema)
// in nav.routes.ts before either handler runs. tenantId still comes only
// from req.tenantId (the caller's own JWT), never from req.body.
export const hideItem = asyncHandler(async (req: Request, res: Response) => {
  const { scope } = req.body as { scope: string };
  await req.db!.insert(navHiddenItems).values({ tenantId: req.tenantId!, scope }).onConflictDoNothing();
  res.status(201).json({ scope });
});

export const showItem = asyncHandler(async (req: Request, res: Response) => {
  const { scope } = req.body as { scope: string };
  await req.db!.delete(navHiddenItems).where(and(eq(navHiddenItems.tenantId, req.tenantId!), eq(navHiddenItems.scope, scope)));
  res.status(204).send();
});
