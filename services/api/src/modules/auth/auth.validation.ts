import { z } from "zod";
import { PASSWORD_MAX_LENGTH, passwordSchema } from "../../utils/passwordPolicy.js";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Accepted so an older sign-in page does not fail. It no longer changes how long the session lasts.
  rememberMe: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});

const fourDigitPin = z.string().regex(/^\d{4}$/, "Enter a 4-digit PIN.");

export const setSignaturePinSchema = z.object({
  pin: fourDigitPin,
  confirmPin: fourDigitPin,
});

export const changeSignaturePinSchema = z.object({
  currentPin: fourDigitPin,
  pin: fourDigitPin,
  confirmPin: fourDigitPin,
});

export const signatureStampSchema = z.object({
  pin: fourDigitPin,
  certified: z.literal(true),
});

const mfaToken = z.string().min(20).max(2000);
const mfaCode = z.string().min(6).max(20);

export const mfaVerifySchema = z.object({ mfaToken, code: mfaCode, rememberMe: z.boolean().optional(), trustDevice: z.boolean().optional() });
export const mfaEnrollStartSchema = z.object({ mfaToken });
export const mfaEnrollConfirmSchema = z.object({ mfaToken, code: mfaCode, rememberMe: z.boolean().optional(), trustDevice: z.boolean().optional() });
export const mfaEnableSchema = z.object({ code: mfaCode });
export const mfaReverifySchema = z.object({ password: z.string().min(1).max(200), code: mfaCode });
