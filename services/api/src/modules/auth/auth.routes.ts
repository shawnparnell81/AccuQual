import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireCsrfHeader } from "../../middleware/csrf.js";
import { authRateLimiter } from "../../middleware/rateLimit.js";
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, mfaVerifySchema, mfaEnrollStartSchema, mfaEnrollConfirmSchema, mfaEnableSchema, mfaReverifySchema } from "./auth.validation.js";
import { registerHandler, loginHandler, refreshHandler, logoutHandler, meHandler, forgotPasswordHandler, resetPasswordHandler, mfaVerifyHandler, mfaEnrollStartHandler, mfaEnrollConfirmHandler, mfaStatusHandler, mfaSetupHandler, mfaEnableHandler, mfaDisableHandler, mfaRecoveryCodesHandler } from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", authRateLimiter, validate(registerSchema), registerHandler);
authRouter.post("/login", authRateLimiter, validate(loginSchema), loginHandler);
// No body to validate — the refresh token now arrives as the httpOnly
// accuqual_rt cookie (see auth.controller.ts), not a request field.
// requireCsrfHeader (security-audit finding): this is the one endpoint
// authenticated purely by an ambient cookie with no Authorization header
// to also forge, making it the real CSRF exposure in this app.
authRouter.post("/refresh", authRateLimiter, requireCsrfHeader, refreshHandler);
authRouter.post("/logout", requireAuth, logoutHandler);
authRouter.get("/me", requireAuth, meHandler);
// Same rate limiter as login/register — this is the one other unauthenticated,
// email-driven endpoint an attacker could otherwise hammer to enumerate
// accounts or spam reset emails.
authRouter.post("/forgot-password", authRateLimiter, validate(forgotPasswordSchema), forgotPasswordHandler);
authRouter.post("/reset-password", authRateLimiter, validate(resetPasswordSchema), resetPasswordHandler);

// Multi-factor authentication. The first three run mid-sign-in, authenticated
// only by the short-lived challenge token the password step returned; the
// rest are for an already signed-in user managing their own second factor.
authRouter.post("/mfa/verify", authRateLimiter, validate(mfaVerifySchema), mfaVerifyHandler);
authRouter.post("/mfa/enroll/start", authRateLimiter, validate(mfaEnrollStartSchema), mfaEnrollStartHandler);
authRouter.post("/mfa/enroll/confirm", authRateLimiter, validate(mfaEnrollConfirmSchema), mfaEnrollConfirmHandler);
authRouter.get("/mfa/status", requireAuth, mfaStatusHandler);
authRouter.post("/mfa/setup", requireAuth, mfaSetupHandler);
authRouter.post("/mfa/enable", requireAuth, validate(mfaEnableSchema), mfaEnableHandler);
authRouter.post("/mfa/disable", requireAuth, authRateLimiter, validate(mfaReverifySchema), mfaDisableHandler);
authRouter.post("/mfa/recovery-codes", requireAuth, authRateLimiter, validate(mfaReverifySchema), mfaRecoveryCodesHandler);
