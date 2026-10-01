import { createHash } from "node:crypto";

/** Company sign-in and sign-out rows. Admin-only: see ACCOUNT_ENTITY_TYPES. */
export const SIGN_IN_ENTITY_TYPE = "SignIn";

export interface SignInClient {
  ip?: string | null;
  userAgent?: string | null;
}

/** SHA-256 hex. Empty values are omitted so the row never stores a blank or the raw address. */
export function hashAuditValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return createHash("sha256").update(trimmed).digest("hex");
}

export function signInAuditChanges(input: {
  action: "login" | "logout";
  method: string;
  client?: SignInClient;
}): Record<string, string> {
  const ipHash = hashAuditValue(input.client?.ip);
  const userAgentHash = hashAuditValue(input.client?.userAgent);
  return {
    action: input.action,
    method: input.method,
    ...(ipHash ? { ipHash } : {}),
    ...(userAgentHash ? { userAgentHash } : {}),
  };
}
