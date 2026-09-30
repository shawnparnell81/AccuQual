const SECRET_USER_KEYS = ["passwordHash", "pinHash", "pinFailedCount", "pinLockedUntil", "mfaSecretEncrypted", "mfaLastUsedStep"] as const;

/** Drops password and PIN material before a user row is sent to a browser, including an administrator's. */
export function omitUserSecrets<T extends object>(row: T): Omit<T, (typeof SECRET_USER_KEYS)[number]> {
  const copy = { ...row } as Record<string, unknown>;
  for (const key of SECRET_USER_KEYS) delete copy[key];
  return copy as Omit<T, (typeof SECRET_USER_KEYS)[number]>;
}
