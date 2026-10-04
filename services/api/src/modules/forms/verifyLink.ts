import { env } from "../../config/env.js";

/** Authenticated page that checks one stored export. The id is the exp_<uuid> already printed on the PDF. */
export function verifyUrlFor(exportId: string): string {
  const base = env.FRONTEND_URL.replace(/\/$/, "");
  return `${base}/verify/${encodeURIComponent(exportId)}`;
}
