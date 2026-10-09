import type { Request, Response } from "express";
import { AppError } from "../../utils/appError.js";

/**
 * One in-process renewal per person. Several tabs, or a page of requests that
 * all discover an expired access token at once, used to each rotate the
 * refresh cookie. The second rotation looked like theft and the extra calls
 * tripped the renewal rate limit. Callers that arrive while a renewal is
 * already running wait for that result instead of starting another one.
 */

interface Slot {
  promise: Promise<unknown>;
  complete: (value: unknown) => void;
  fail: (reason: unknown) => void;
}

export interface RefreshCoordination {
  leader: boolean;
  promise: Promise<unknown>;
  markAccepted: () => void;
  complete: (value: unknown) => void;
  fail: (reason: unknown) => void;
}

const flights = new Map<string, Slot>();
const byRequest = new WeakMap<Request, RefreshCoordination>();

function openFlight(key: string): Slot {
  let settled = false;
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A renewal that fails with nobody waiting must not surface as an unhandled rejection.
  promise.catch(() => undefined);
  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    if (flights.get(key)?.promise === promise) flights.delete(key);
    fn();
  };
  const slot: Slot = {
    promise,
    complete: (value) => finish(() => resolve(value)),
    fail: (reason) => finish(() => reject(reason)),
  };
  flights.set(key, slot);
  return slot;
}

/**
 * Reserves the in-flight renewal synchronously, before any await, so the next
 * request in this process joins it instead of spending another rate-limit slot.
 * The leader's response listener fails the waiters if the rate limiter answers
 * by itself and the handler never runs.
 */
export function registerRefreshFlight(req: Request, res: Response, key: string): "leader" | "follower" {
  const existing = flights.get(key);
  if (existing) {
    byRequest.set(req, {
      leader: false,
      promise: existing.promise,
      markAccepted: () => undefined,
      complete: () => undefined,
      fail: () => undefined,
    });
    return "follower";
  }

  const slot = openFlight(key);
  let accepted = false;
  byRequest.set(req, {
    leader: true,
    promise: slot.promise,
    markAccepted: () => {
      accepted = true;
    },
    complete: slot.complete,
    fail: slot.fail,
  });
  res.on("finish", () => {
    if (!accepted) slot.fail(new AppError("Too many session renewals, try again shortly", 429));
  });
  return "leader";
}

export function getRefreshCoordination(req: Request): RefreshCoordination | undefined {
  return byRequest.get(req);
}

/** Followers receive the leader's result. The leader runs `work` once. */
export async function withSharedRefresh<T>(req: Request, work: () => Promise<T>): Promise<T> {
  const coord = byRequest.get(req);
  if (!coord) return work();
  if (!coord.leader) return coord.promise as Promise<T>;
  coord.markAccepted();
  try {
    const value = await work();
    coord.complete(value);
    return value;
  } catch (err) {
    coord.fail(err);
    throw err;
  }
}
