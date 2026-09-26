import winston from "winston";
import { env } from "../config/env.js";
import { getRequestContext } from "../modules/monitoring/requestContext.js";

// Stamps every log line written while handling a request with that request's id (and company/user once known), so one
// reference finds everything that happened — see modules/monitoring/requestContext.ts.
const withRequestContext = winston.format((info) => {
  const ctx = getRequestContext();
  if (ctx) {
    info.requestId ??= ctx.requestId;
    if (ctx.userId !== undefined) info.userId ??= ctx.userId;
  }
  return info;
});

export const logger = winston.createLogger({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    withRequestContext(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    env.NODE_ENV === "production" ? winston.format.json() : winston.format.simple()
  ),
  defaultMeta: { service: "accuqual-api" },
  transports: [new winston.transports.Console()],
});
