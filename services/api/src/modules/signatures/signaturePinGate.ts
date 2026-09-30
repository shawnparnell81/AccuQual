/** Routes still available after sign-in when a signature PIN has not been set. */
export const PIN_SETUP_PATHS = new Set(["/auth/signature-pin", "/auth/logout", "/auth/me", "/auth/change-password"]);

/** True when a signed-in person must set a PIN before using the rest of the app. */
export function missingPinBlocks(pinSet: boolean, path: string, enforce: boolean): boolean {
  if (!enforce || pinSet) return false;
  return !PIN_SETUP_PATHS.has(path);
}
