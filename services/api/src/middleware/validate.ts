import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

type Target = "body" | "query" | "params";

/** Validates & replaces `req[target]` with the parsed (and defaulted/coerced) Zod result. */
export const validate = (schema: ZodSchema, target: Target = "body") => {
  return (req: Request, _res: Response, next: NextFunction) => {
    req[target] = schema.parse(req[target]);
    next();
  };
};
