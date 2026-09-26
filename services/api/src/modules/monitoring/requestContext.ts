import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Per-request context that follows the request through every await, so any log
 * line written anywhere while handling it — a controller, a service, a database
 * helper — carries the same request id (and, once known, the user)
 * without each call site passing them along. `X-Request-Id` on the response,
 * `requestId` in the error body and in every log line and Sentry event are the
 * same value: a user quoting the reference from an error message is enough to
 * find everything that happened.
 */
export interface RequestContext {
  requestId: string;
  userId?: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = (): RequestContext | undefined => storage.getStore();
export const getRequestId = (): string | undefined => storage.getStore()?.requestId;

/** Adds what became known mid-request (the authenticated user). No-op outside a request. */
export function enrichRequestContext(patch: Partial<Omit<RequestContext, "requestId">>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

// A caller-supplied id is honoured only when it is short and boring, so it can't be used to inject log lines or headers.
const SAFE_ID = /^[A-Za-z0-9_.-]{8,64}$/;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", requestId);
  storage.run({ requestId }, next);
}
