import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/appError.js";
import { logger } from "../utils/logger.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "ValidationError",
      message: "Request failed validation",
      details: err.flatten(),
    });
  }

  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error(err.message, { stack: err.stack });
    }
    return res.status(err.statusCode).json({
      error: err.name,
      message: err.message,
      details: err.details,
    });
  }

  logger.error("Unhandled error", { message: err?.message, stack: err?.stack, path: req.path });
  return res.status(500).json({
    error: "InternalServerError",
    message: "An unexpected error occurred",
  });
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: "NotFound", message: `No route for ${req.method} ${req.path}` });
};
