import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { authRateLimiter } from "../../middleware/rateLimit.js";
import { registerSchema, loginSchema, refreshSchema } from "./auth.validation.js";
import { registerHandler, loginHandler, refreshHandler, logoutHandler, meHandler } from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", authRateLimiter, validate(registerSchema), registerHandler);
authRouter.post("/login", authRateLimiter, validate(loginSchema), loginHandler);
authRouter.post("/refresh", authRateLimiter, validate(refreshSchema), refreshHandler);
authRouter.post("/logout", requireAuth, logoutHandler);
authRouter.get("/me", requireAuth, meHandler);
