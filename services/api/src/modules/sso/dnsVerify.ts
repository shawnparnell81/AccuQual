import { promises as dns } from "node:dns";

/** Prefix of the TXT record a company publishes to prove it controls an email domain: `_accuqual-verify.<domain>` = `accuqual-verify=<token>`. */
export const VERIFY_RECORD_PREFIX = "_accuqual-verify";

/** All TXT strings at a DNS name (an unresolvable name is simply "no records"). A separate module so tests can stand in for real DNS. */
export async function lookupTxt(name: string): Promise<string[]> {
  try {
    return (await dns.resolveTxt(name)).map((parts) => parts.join(""));
  } catch {
    return [];
  }
}
