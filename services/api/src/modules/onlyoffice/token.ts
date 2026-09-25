import jwt from "jsonwebtoken";
import { AppError } from "../../utils/appError.js";

/** Separates our own file/callback links from the document server's config JWT, which is signed with the same secret. */
export type OfficeTokenPurpose = "oo-file" | "oo-callback";

const FILE_TOKEN_SECONDS = 15 * 60;
const CALLBACK_TOKEN_SECONDS = 12 * 60 * 60;

export interface OfficeFileClaims {
  userId: number;
  documentId: number;
  versionId: number;
  fileId: number;
}

export interface OfficeCallbackClaims extends OfficeFileClaims {
  key: string;
}

export function signOfficeToken(secret: string, purpose: OfficeTokenPurpose, claims: Record<string, unknown>): string {
  const expiresIn = purpose === "oo-file" ? FILE_TOKEN_SECONDS : CALLBACK_TOKEN_SECONDS;
  return jwt.sign({ ...claims, purpose }, secret, { algorithm: "HS256", expiresIn });
}

export function verifyOfficeToken(secret: string, purpose: OfficeTokenPurpose, token: string): Record<string, unknown> {
  let payload: unknown;
  try {
    payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    throw AppError.unauthorized("This editor link has expired. Open the file again.");
  }
  if (!payload || typeof payload !== "object" || (payload as { purpose?: unknown }).purpose !== purpose) {
    throw AppError.unauthorized("This editor link is not valid.");
  }
  return payload as Record<string, unknown>;
}

function claimId(payload: Record<string, unknown>, key: string): number {
  const n = Number(payload[key]);
  if (!Number.isInteger(n) || n < 1) throw AppError.unauthorized("This editor link is not valid.");
  return n;
}

export function readFileClaims(payload: Record<string, unknown>): OfficeFileClaims {
  return {
    userId: claimId(payload, "userId"),
    documentId: claimId(payload, "documentId"),
    versionId: claimId(payload, "versionId"),
    fileId: claimId(payload, "fileId"),
  };
}

export function readCallbackClaims(payload: Record<string, unknown>): OfficeCallbackClaims {
  const key = payload.key;
  if (typeof key !== "string" || key.length < 1 || key.length > 128) throw AppError.unauthorized("This editor link is not valid.");
  return { ...readFileClaims(payload), key };
}

/** The document server signs its callback body with the shared secret. Unsigned bodies are ignored. */
export function verifyDocumentServerPayload(secret: string, token: string): Record<string, unknown> {
  let payload: unknown;
  try {
    payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    throw AppError.unauthorized("Document server signature was rejected.");
  }
  if (!payload || typeof payload !== "object") throw AppError.unauthorized("Document server signature was rejected.");
  const record = payload as Record<string, unknown>;
  const inner = record.payload && typeof record.payload === "object" ? (record.payload as Record<string, unknown>) : record;
  return inner;
}

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}
