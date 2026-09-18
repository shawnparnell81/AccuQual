import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { apiRouter } from "./routes/index.js";
import { apiRateLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { env } from "./config/env.js";
import { checkReadiness } from "./modules/monitoring/healthMonitor.js";
import { asyncHandler } from "./utils/asyncHandler.js";

// Inspection Report SAAS-03/SEC-02/R04: cors() with no options accepts every
// origin, which is fine for a throwaway prototype and wrong for a
// JWT-bearing multi-tenant API. ALLOWED_ORIGINS is env-driven so each
// environment (dev/staging/prod) lists only its own real frontend origin(s).
const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header (curl, server-to-server, same-origin) — allow;
        // browsers always send it for cross-origin requests, which is the
        // case this allowlist actually needs to police.
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin "${origin}" is not allowed by CORS`));
      },
      // B2 fix: the refresh token now travels as an httpOnly cookie
      // (auth.controller.ts) instead of a JSON body field the frontend has
      // to store itself — the browser only attaches/reads it on a
      // credentialed request, and only for an origin this allowlist above
      // already accepts.
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "5mb" }));
  app.use(requestLogger);
  app.use(apiRateLimiter);

  // Render's own healthCheckPath (see render.yaml) — a real readiness check,
  // not a bare liveness ping. 503 only when the database (the one
  // dependency this app's real deployment always provisions) is
  // unreachable; see healthMonitor.ts's own comment on why Redis is
  // reported but never gates the HTTP status here.
  app.get(
    "/health",
    asyncHandler(async (_req, res) => {
      const report = await checkReadiness();
      res.status(report.status === "critical" ? 503 : 200).json({ service: "accuqual-api", ...report });
    })
  );

  app.use("/", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
