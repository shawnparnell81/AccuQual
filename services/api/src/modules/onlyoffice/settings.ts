import { env } from "../../config/env.js";

export interface OnlyOfficeSettings {
  /** Origin the browser loads the editor script from. */
  publicUrl: string;
  /** Origin the API uses when fetching a file the document server just saved. */
  internalUrl: string;
  /** Origin the document server uses to reach this API (file download and save callback). */
  apiBaseUrl: string;
  jwtSecret: string;
}

/** Unset URL or secret means the editor is off. The rest of the app keeps working. */
export function onlyOfficeSettings(): OnlyOfficeSettings | null {
  const publicUrl = env.ONLYOFFICE_URL?.replace(/\/$/, "");
  const secret = env.ONLYOFFICE_JWT_SECRET;
  if (!publicUrl || !secret) return null;
  const internalUrl = (env.ONLYOFFICE_INTERNAL_URL ?? publicUrl).replace(/\/$/, "");
  const apiBaseUrl = (env.ONLYOFFICE_API_BASE_URL ?? env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, "");
  return { publicUrl, internalUrl, apiBaseUrl, jwtSecret: secret };
}
