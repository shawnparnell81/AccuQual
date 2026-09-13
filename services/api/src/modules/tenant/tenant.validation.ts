import { z } from "zod";

export const updateBrandingSchema = z.object({
  logoUrl: z.string().url().optional().or(z.literal("")),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color like #1a2b3c")
    .optional()
    .or(z.literal("")),
  pdfHeader: z.string().max(500).optional().or(z.literal("")),
  pdfFooter: z.string().max(500).optional().or(z.literal("")),
});

/**
 * provider is restricted to the two real, already-integrated providers
 * (see llm-gateway.ts) — not an open string, so this can never store a
 * provider the app has no code path for.
 */
export const updateAiConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai"]).optional(),
  apiKey: z.string().min(1).optional(), // plaintext in the request only — encrypted before it ever touches the database
  modelName: z.string().optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxTokens: z.coerce.number().int().positive().optional(),
  assistantName: z.string().max(80).optional().or(z.literal("")), // "" clears it back to the default label
});
