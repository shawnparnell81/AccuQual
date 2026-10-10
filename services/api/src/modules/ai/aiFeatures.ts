import type { NextFunction, Request, Response } from "express";
import { company } from "../../drizzle/schema/company.js";
import { AppError } from "../../utils/appError.js";

/** Shown on every refused AI request. Does not mention a key or any secret. */
export const AI_FEATURES_DISABLED_MESSAGE =
  "AI-assisted features are turned off for this company. An admin can turn them on from Admin → AI Settings.";

/** Unset means On. Only an explicit false turns AI off for the company. */
export function aiFeaturesEnabled(config: { featuresEnabled?: boolean } | null | undefined): boolean {
  return config?.featuresEnabled !== false;
}

export type AiKeySource = "company" | "server" | "both" | "none";

/** Which key is present. The values themselves are never included. */
export function aiKeySource(
  config: { apiKeyEncrypted?: string } | null | undefined,
  envKeys: { anthropic?: string; openai?: string },
): AiKeySource {
  const companyKey = Boolean(config?.apiKeyEncrypted);
  const serverKey = Boolean(envKeys.anthropic || envKeys.openai);
  if (companyKey && serverKey) return "both";
  if (companyKey) return "company";
  if (serverKey) return "server";
  return "none";
}

/** Throws when this company has turned AI-assisted features off. */
export async function assertAiFeaturesEnabled(db: NonNullable<Request["db"]>) {
  const [co] = await db.select({ aiConfig: company.aiConfig }).from(company);
  if (!co) throw AppError.notFound("Company");
  if (!aiFeaturesEnabled(co.aiConfig)) throw AppError.forbidden(AI_FEATURES_DISABLED_MESSAGE);
}

/** Blocks AI generation when the company has turned AI-assisted features off. Must run after withDb. */
export async function requireAiFeatures(req: Request, _res: Response, next: NextFunction) {
  try {
    await assertAiFeaturesEnabled(req.db!);
    next();
  } catch (err) {
    next(err);
  }
}
