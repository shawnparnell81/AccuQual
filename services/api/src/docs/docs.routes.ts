import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { buildOpenApiDocument } from "./openapi.js";

// Admin-only, same gating pattern as system-health.routes.ts. Consumed by
// AdminApiDocsPage.tsx via apiClient (Bearer header attached the same way
// as every other admin fetch) — not a raw swagger-ui-express HTML page,
// because requireAuth only ever recognizes the Authorization header, and a
// plain browser navigation to a server-rendered docs page has no way to
// attach it. Rendering the same Swagger UI as a React component inside the
// already-authenticated SPA gets the identical interactive result and
// actually works with this app's real auth model.
export const docsRouter = Router();
docsRouter.use(requireAuth, requireRole("admin"));
docsRouter.get("/openapi.json", (_req, res) => {
  res.json(buildOpenApiDocument());
});
