import rateLimit from "express-rate-limit";

const DEVICE_INGEST_PATH = "/digital-twin/device-ingest";

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  // Devices are throttled by the two dedicated limiters below instead: a
  // whole plant's sensors usually share one public IP, so the per-IP budget
  // meant for people would cut them off almost immediately.
  skip: (req) => req.path.startsWith(DEVICE_INGEST_PATH),
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "TooManyRequests", message: "Too many auth attempts, try again later" },
});

/** Per device (the id half of X-Device-Key): 120 readings/minute, i.e. one every 500 ms. */
export const deviceIngestRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `device:${req.header("x-device-key")?.split(".")[0] ?? req.ip}`,
  message: { error: "TooManyRequests", message: "Device is sending readings too fast" },
});

/** Per IP, generous enough for a plant full of devices behind one address — this one mainly bounds unauthenticated guessing. */
export const deviceIngestIpRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3000,
  standardHeaders: true,
  legacyHeaders: false,
});
