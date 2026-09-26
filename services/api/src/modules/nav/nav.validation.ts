import { z } from "zod";

// Full-System Audit finding L8 — hideItem/showItem had no Zod schema at
// all, just a hand-rolled `if (!scope) throw ...` inside each handler.

export const navScopeSchema = z.object({
  scope: z.string().min(1),
});
