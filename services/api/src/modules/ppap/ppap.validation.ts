import { z } from "zod";

export const createPpapSchema = z.object({
  partNumber: z.string().min(1),
  partName: z.string().optional(),
  customer: z.string().optional(),
});
