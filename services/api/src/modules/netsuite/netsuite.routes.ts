import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { SIGNING_ALGORITHMS } from "./netsuiteAuth.js";
import { checkNetSuiteModule, getNetSuiteView, removeNetSuite, saveNetSuite, testNetSuiteConnection, MODULE_KEYS } from "./netsuite.service.js";
import type { NetSuiteModuleKey } from "../../drizzle/schema/company.js";

const moduleSchema = z.object({ recordType: z.string().max(100).optional(), enabled: z.boolean().optional() }).strict();

export const saveNetSuiteSchema = z
  .object({
    accountId: z.string().max(40).optional(),
    clientId: z.string().max(200).optional(),
    certificateId: z.string().max(200).optional(),
    keyAlgorithm: z.enum(["auto", ...SIGNING_ALGORITHMS]).optional(),
    // Plaintext only inside this request; encrypted before it is stored.
    privateKey: z.string().max(20_000).optional(),
    publicCertificate: z.string().max(20_000).optional(),
    modules: z.object({ fai: moduleSchema.optional(), productAlert: moduleSchema.optional(), inventory: moduleSchema.optional() }).strict().optional(),
  })
  .strict();

/**
 * Settings → ERP / NetSuite. Mounted by settings.routes.ts behind the existing
 * Admin console permission, so every route here is Admin only on the server.
 * Read-only toward NetSuite: see netsuiteClient.ts.
 */
export const netsuiteRouter = Router();

netsuiteRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getNetSuiteView(req.db!));
  }),
);

netsuiteRouter.post(
  "/",
  validate(saveNetSuiteSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await saveNetSuite(req.db!, req.body, req.user?.id));
  }),
);

netsuiteRouter.delete(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await removeNetSuite(req.db!, req.user?.id));
  }),
);

netsuiteRouter.post(
  "/test",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await testNetSuiteConnection(req.db!, req.user?.id));
  }),
);

netsuiteRouter.post(
  "/modules/:module/check",
  asyncHandler(async (req: Request, res: Response) => {
    const key = req.params.module as NetSuiteModuleKey;
    if (!MODULE_KEYS.includes(key)) {
      res.status(404).json({ error: "Unknown module" });
      return;
    }
    res.json(await checkNetSuiteModule(req.db!, key, req.user?.id));
  }),
);
