import express from "express";
import cors from "cors";
import helmet from "helmet";
import { apiRouter } from "./routes/index.js";
import { apiRateLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { env } from "./config/env.js";

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
    })
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(requestLogger);
  app.use(apiRateLimiter);

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "accuqual-api" }));

  app.use("/", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
