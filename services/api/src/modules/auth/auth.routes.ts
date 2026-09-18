import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { authRateLimiter } from "../../middleware/rateLimit.js";
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from "./auth.validation.js";
import { registerHandler, loginHandler, refreshHandler, logoutHandler, meHandler, forgotPasswordHandler, resetPasswordHandler } from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", authRateLimiter, validate(registerSchema), registerHandler);
authRouter.post("/login", authRateLimiter, validate(loginSchema), loginHandler);
// No body to validate — the refresh token now arrives as the httpOnly
// accuqual_rt cookie (see auth.controller.ts), not a request field.
authRouter.post("/refresh", authRateLimiter, refreshHandler);
authRouter.post("/logout", requireAuth, logoutHandler);
authRouter.get("/me", requireAuth, meHandler);
// Same rate limiter as login/register — this is the one other unauthenticated,
// email-driven endpoint an attacker could otherwise hammer to enumerate
// accounts or spam reset emails.
authRouter.post("/forgot-password", authRateLimiter, validate(forgotPasswordSchema), forgotPasswordHandler);
authRouter.post("/reset-password", authRateLimiter, validate(resetPasswordSchema), resetPasswordHandler);
