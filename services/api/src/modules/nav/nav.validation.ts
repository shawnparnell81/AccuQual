import { z } from "zod";

// Full-System Audit finding L8 — hideItem/showItem had no Zod schema at
// all, just a hand-rolled `if (!scope) throw ...` inside each handler.
// tenantId is deliberately NOT a field here — it always comes from
// req.tenantId (set by withTenantDb from the caller's own JWT via
// nav.routes.ts), never from the client body.
export const navScopeSchema = z.object({
  scope: z.string().min(1),
});
