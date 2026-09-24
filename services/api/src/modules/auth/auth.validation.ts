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
  rememberMe: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

const mfaToken = z.string().min(20).max(2000);
const mfaCode = z.string().min(6).max(20);

export const mfaVerifySchema = z.object({ mfaToken, code: mfaCode, rememberMe: z.boolean().optional() });
export const mfaEnrollStartSchema = z.object({ mfaToken });
export const mfaEnrollConfirmSchema = z.object({ mfaToken, code: mfaCode, rememberMe: z.boolean().optional() });
export const mfaEnableSchema = z.object({ code: mfaCode });
export const mfaReverifySchema = z.object({ password: z.string().min(1).max(200), code: mfaCode });
