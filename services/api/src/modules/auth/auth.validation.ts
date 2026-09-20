import { z } from "zod";
import { passwordSchema } from "../../utils/passwordPolicy.js";

export const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  name: z.string().min(1).optional(),
  // Every regular user joins an existing tenant — tenants themselves are
  // provisioned via the platform-admin API (see modules/platform), not by
  // self-serve signup. See docs/... AccuQual Tenant Onboarding Flow Spec.
  tenantCode: z.string().min(1),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
