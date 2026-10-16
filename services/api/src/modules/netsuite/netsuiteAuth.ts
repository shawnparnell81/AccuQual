/**
 * NetSuite OAuth 2.0 client credentials (machine-to-machine) sign-in.
 *
 * Follows Oracle's NetSuite Help Center:
 * - "POST Request to the Token Endpoint and the Access Token Response"
 *   (docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_162755359851.html):
 *   grant_type=client_credentials, client_assertion_type=
 *   urn:ietf:params:oauth:client-assertion-type:jwt-bearer, client_assertion=<JWT>,
 *   sent form-encoded to https://<account>.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token.
 *   The access token is valid for 60 minutes (expires_in 3600).
 * - "The Request Token Structure" (section_162790605110.html): header typ=JWT,
 *   alg PS256/PS384/PS512/ES256/ES384/ES512, kid=Certificate ID; payload iss=Client ID,
 *   scope (restlets, rest_webservices, suite_analytics, comma separated), aud=token
 *   endpoint, iat, and exp less than 60 minutes after iat.
 * - "Certificate Conditions" (subsect_162755332391.html): x.509 PEM, RSA keys
 *   3072 to 4096 bits signed with RSA-PSS, EC keys on P-256, P-384 or P-521,
 *   maximum validity two years.
 */
import { constants, createPrivateKey, createHash, sign as signData, X509Certificate, type KeyObject } from "node:crypto";

export const SIGNING_ALGORITHMS = ["ES256", "ES384", "ES512", "PS256", "PS384", "PS512"] as const;
export type SigningAlgorithm = (typeof SIGNING_ALGORITHMS)[number];
export type KeyAlgorithmChoice = "auto" | SigningAlgorithm;

export const NETSUITE_SCOPE = "restlets,rest_webservices";
/** Seconds the client assertion is valid. NetSuite rejects anything 60 minutes or longer. */
export const ASSERTION_LIFETIME_SECONDS = 5 * 60;

/** 1234567, 1234567_SB1, TSTDRV1234567, 1234567_RP. Letters, digits and one or more _ or - separated parts. */
export const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/;

export class NetSuiteSetupError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "NetSuiteSetupError";
  }
}

export function normalizeAccountId(raw: string): string {
  const id = raw.trim().toUpperCase().replace(/-/g, "_");
  if (!id || id.length > 40 || !ACCOUNT_ID_PATTERN.test(id)) {
    throw new NetSuiteSetupError("bad_account_id", "The account ID should look like 1234567 or 1234567_SB1 (letters, numbers and an underscore only).");
  }
  return id;
}

/** NetSuite's account-specific host: account ID lower-cased with _ changed to -. */
export function accountDomain(accountId: string): string {
  return `${normalizeAccountId(accountId).toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com`;
}

export function tokenEndpoint(accountId: string): string {
  return `https://${accountDomain(accountId)}/services/rest/auth/oauth2/v1/token`;
}

export type NetSuiteEnvironment = "sandbox" | "release_preview" | "production";

export function accountEnvironment(accountId: string): NetSuiteEnvironment {
  const id = normalizeAccountId(accountId);
  if (/_SB\d*$/.test(id)) return "sandbox";
  if (/_RP\d*$/.test(id)) return "release_preview";
  return "production";
}

export const ENVIRONMENT_LABELS: Record<NetSuiteEnvironment, string> = {
  sandbox: "Sandbox",
  release_preview: "Release Preview",
  production: "Production",
};

export function parsePrivateKey(pem: string): KeyObject {
  const text = pem.trim();
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    throw new NetSuiteSetupError("bad_private_key", "Paste the whole private key, including the -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines.");
  }
  if (/ENCRYPTED PRIVATE KEY|Proc-Type: 4,ENCRYPTED/.test(text)) {
    throw new NetSuiteSetupError("bad_private_key", "This private key is password protected. Create the key with -nodes (no password) as shown in the setup guide.");
  }
  try {
    return createPrivateKey({ key: text, format: "pem" });
  } catch {
    throw new NetSuiteSetupError("bad_private_key", "That private key couldn't be read. Check that it was copied in full.");
  }
}

const CURVE_ALGORITHM: Record<string, SigningAlgorithm> = { prime256v1: "ES256", secp384r1: "ES384", secp521r1: "ES512" };

/** Picks the signing algorithm for a key, or checks the one the admin chose fits it. */
export function resolveAlgorithm(key: KeyObject, choice: KeyAlgorithmChoice = "auto"): SigningAlgorithm {
  const type = key.asymmetricKeyType;
  if (type === "ec") {
    const curve = key.asymmetricKeyDetails?.namedCurve ?? "";
    const alg = CURVE_ALGORITHM[curve];
    if (!alg) throw new NetSuiteSetupError("unsupported_key", "NetSuite accepts EC keys on P-256, P-384 or P-521 only.");
    if (choice !== "auto" && choice !== alg) {
      throw new NetSuiteSetupError("key_type_mismatch", `This EC key needs ${alg}. Choose ${alg} or Detect automatically.`);
    }
    return alg;
  }
  if (type === "rsa" || type === "rsa-pss") {
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits < 3072 || bits > 4096) {
      throw new NetSuiteSetupError("unsupported_key", `NetSuite needs an RSA key of 3072 to 4096 bits. This one is ${bits} bits.`);
    }
    if (choice === "auto") return "PS256";
    if (!choice.startsWith("PS")) throw new NetSuiteSetupError("key_type_mismatch", "This is an RSA key. Choose PS256, PS384, PS512 or Detect automatically.");
    return choice;
  }
  throw new NetSuiteSetupError("unsupported_key", "NetSuite accepts EC or RSA keys only.");
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

const HASH: Record<SigningAlgorithm, string> = { ES256: "sha256", ES384: "sha384", ES512: "sha512", PS256: "sha256", PS384: "sha384", PS512: "sha512" };

export function signJwt(signingInput: string, key: KeyObject, alg: SigningAlgorithm): Buffer {
  const data = Buffer.from(signingInput);
  if (alg.startsWith("ES")) return signData(HASH[alg], data, { key, dsaEncoding: "ieee-p1363" });
  return signData(HASH[alg], data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST });
}

export interface ClientAssertionInput {
  accountId: string;
  clientId: string;
  certificateId: string;
  privateKeyPem: string;
  algorithm?: KeyAlgorithmChoice;
  /** Seconds since the epoch; defaults to now. */
  now?: number;
}

export function buildClientAssertion(input: ClientAssertionInput): { assertion: string; algorithm: SigningAlgorithm; expiresAt: number } {
  const clientId = input.clientId.trim();
  const certificateId = input.certificateId.trim();
  if (!clientId) throw new NetSuiteSetupError("missing_client_id", "Enter the Client ID.");
  if (!certificateId) throw new NetSuiteSetupError("missing_certificate_id", "Enter the Certificate ID.");
  const key = parsePrivateKey(input.privateKeyPem);
  const alg = resolveAlgorithm(key, input.algorithm ?? "auto");
  const iat = input.now ?? Math.floor(Date.now() / 1000);
  const exp = iat + ASSERTION_LIFETIME_SECONDS;
  const header = { typ: "JWT", alg, kid: certificateId };
  const payload = { iss: clientId, scope: NETSUITE_SCOPE, aud: tokenEndpoint(input.accountId), iat, exp };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = signJwt(signingInput, key, alg);
  return { assertion: `${signingInput}.${b64url(signature)}`, algorithm: alg, expiresAt: exp };
}

export interface CertificateSummary {
  subject: string;
  validFrom: string;
  validTo: string;
  daysLeft: number;
  /** null when no private key is saved to compare against. */
  matchesPrivateKey: boolean | null;
  fingerprint: string;
}

/** Reads the public certificate only to show its expiry. It is not a secret and never leaves this server for NetSuite. */
export function summarizeCertificate(certPem: string, privateKeyPem?: string | null, now = Date.now()): CertificateSummary {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem.trim());
  } catch {
    throw new NetSuiteSetupError("bad_certificate", "That public certificate couldn't be read. Paste the whole public.pem, including the BEGIN and END CERTIFICATE lines.");
  }
  let matches: boolean | null = null;
  if (privateKeyPem) {
    try {
      matches = cert.checkPrivateKey(createPrivateKey(privateKeyPem));
    } catch {
      matches = false;
    }
  }
  const validTo = new Date(cert.validTo);
  return {
    subject: cert.subject.replace(/\n/g, ", "),
    validFrom: new Date(cert.validFrom).toISOString(),
    validTo: validTo.toISOString(),
    daysLeft: Math.floor((validTo.getTime() - now) / 86_400_000),
    matchesPrivateKey: matches,
    fingerprint: cert.fingerprint256,
  };
}

/** Short, non-reversible id for a saved key, so caches and history can tell keys apart without holding the key. */
export function keyFingerprint(privateKeyPem: string): string {
  return createHash("sha256").update(privateKeyPem.trim()).digest("hex").slice(0, 16);
}
