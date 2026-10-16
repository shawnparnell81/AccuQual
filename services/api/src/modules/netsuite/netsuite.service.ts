import { desc, eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { company, type NetSuiteConnectionStored, type NetSuiteModuleKey } from "../../drizzle/schema/company.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { users } from "../../drizzle/schema/users.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { encryptSecret, tryDecryptSecret } from "../company/crypto.js";
import { loadCompanyForSettings, getErpSyncSettings } from "../settings/settings.service.js";
import { AppError } from "../../utils/appError.js";
import {
  accountDomain,
  accountEnvironment,
  ENVIRONMENT_LABELS,
  NetSuiteSetupError,
  normalizeAccountId,
  parsePrivateKey,
  resolveAlgorithm,
  summarizeCertificate,
  type CertificateSummary,
  type KeyAlgorithmChoice,
  SIGNING_ALGORITHMS,
} from "./netsuiteAuth.js";
import { clearNetSuiteTokenCache, NetSuiteClient, NetSuiteHttpError, NetSuiteReadOnlyError, redactSecrets, RECORD_PREFIX, type NetSuiteClientOptions } from "./netsuiteClient.js";

export const NETSUITE_AUDIT_ENTITY = "NetSuiteConnection";
export const MODULE_KEYS: readonly NetSuiteModuleKey[] = ["fai", "productAlert", "inventory"];
export const MODULE_LABELS: Record<NetSuiteModuleKey, string> = { fai: "FAI", productAlert: "Product Alert", inventory: "Inventory (lookup only)" };
/** Inventory lookups default to NetSuite's standard Location record. FAI and Product Alert are DMA custom records, so they start blank. */
const DEFAULT_RECORD_TYPES: Record<NetSuiteModuleKey, string> = { fai: "", productAlert: "", inventory: "location" };
export const RECORD_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;

/** Test-only: point the client at a local fake NetSuite. Ignored on any hosted or production server. */
function clientOptions(): NetSuiteClientOptions {
  const override = process.env.NETSUITE_API_BASE_URL_OVERRIDE;
  if (override && process.env.NODE_ENV !== "production" && !process.env.RENDER) return { baseUrl: override };
  return {};
}

function stored(co: Awaited<ReturnType<typeof loadCompanyForSettings>>): NetSuiteConnectionStored {
  return getErpSyncSettings(co).netsuite ?? {};
}

async function saveStored(db: Db, coId: number, current: ReturnType<typeof getErpSyncSettings>, next: NetSuiteConnectionStored | undefined) {
  const merged = { ...current };
  if (next) merged.netsuite = next;
  else delete merged.netsuite;
  await db.update(company).set({ erpSyncSettings: merged }).where(eq(company.id, coId));
}

type AuditEvent = "update" | "key_replaced" | "module_enabled" | "module_disabled" | "remove" | "connection_test" | "module_check";
const AUDIT_ACTION = { update: "update", key_replaced: "update", module_enabled: "status_change", module_disabled: "status_change", remove: "delete", connection_test: "status_change", module_check: "status_change" } as const;

/** ISO-style record: who (performedBy), when (created_at), what (event) and a plain description. Never holds a key, token or secret. */
function audit(db: Db, event: AuditEvent, performedBy: number | undefined, description: string, extra: Record<string, unknown> = {}) {
  return recordAuditTrail(db, { entityType: NETSUITE_AUDIT_ENTITY, entityId: 1, action: AUDIT_ACTION[event], changes: { event, description: redactSecrets(description), ...extra }, performedBy });
}

function moduleView(ns: NetSuiteConnectionStored) {
  return MODULE_KEYS.map((key) => {
    const m = ns.modules?.[key] ?? {};
    return {
      key,
      label: MODULE_LABELS[key],
      recordType: m.recordType ?? DEFAULT_RECORD_TYPES[key],
      enabled: m.enabled ?? false,
      lastCheck: ns.moduleChecks?.[key] ?? null,
    };
  });
}

export async function getNetSuiteView(db: Db) {
  const co = await loadCompanyForSettings(db);
  const ns = stored(co);
  let environment: string | null = null;
  let domain: string | null = null;
  if (ns.accountId) {
    try {
      environment = ENVIRONMENT_LABELS[accountEnvironment(ns.accountId)];
      domain = accountDomain(ns.accountId);
    } catch {
      /* shown as not set */
    }
  }
  const key = ns.privateKeyEncrypted ? tryDecryptSecret(ns.privateKeyEncrypted) : null;
  let detectedAlgorithm: string | null = null;
  if (key?.ok) {
    try {
      detectedAlgorithm = resolveAlgorithm(parsePrivateKey(key.plaintext), (ns.keyAlgorithm as KeyAlgorithmChoice) ?? "auto");
    } catch {
      detectedAlgorithm = null;
    }
  }
  let certificate: CertificateSummary | null = null;
  if (ns.publicCertificatePem) {
    try {
      certificate = summarizeCertificate(ns.publicCertificatePem, key?.ok ? key.plaintext : null);
    } catch {
      certificate = null;
    }
  }
  const history = await db
    .select({ id: auditTrail.id, action: auditTrail.action, changes: auditTrail.changes, createdAt: auditTrail.createdAt, userName: users.name, userEmail: users.email })
    .from(auditTrail)
    .leftJoin(users, eq(users.id, auditTrail.performedBy))
    .where(eq(auditTrail.entityType, NETSUITE_AUDIT_ENTITY))
    .orderBy(desc(auditTrail.id))
    .limit(25);

  return {
    accountId: ns.accountId ?? null,
    environment,
    domain,
    clientId: ns.clientId ?? null,
    certificateId: ns.certificateId ?? null,
    keyAlgorithm: ns.keyAlgorithm ?? "auto",
    hasPrivateKey: Boolean(ns.privateKeyEncrypted),
    privateKeyReadable: key ? key.ok : null,
    detectedAlgorithm,
    certificate,
    configured: Boolean(ns.accountId && ns.clientId && ns.certificateId && ns.privateKeyEncrypted),
    lastTest: ns.lastTest ?? null,
    modules: moduleView(ns),
    history: history.map((h) => ({
      id: h.id,
      action: String((h.changes as { event?: unknown } | null)?.event ?? h.action),
      description: String((h.changes as { description?: unknown } | null)?.description ?? h.action),
      at: h.createdAt?.toISOString() ?? null,
      by: h.userName || h.userEmail || "System",
    })),
  };
}

export interface SaveNetSuiteInput {
  accountId?: string;
  clientId?: string;
  certificateId?: string;
  keyAlgorithm?: KeyAlgorithmChoice;
  privateKey?: string;
  publicCertificate?: string;
  modules?: Partial<Record<NetSuiteModuleKey, { recordType?: string; enabled?: boolean }>>;
}

function setupError(err: unknown): never {
  if (err instanceof NetSuiteSetupError) throw AppError.badRequest(err.message);
  throw err;
}

export async function saveNetSuite(db: Db, input: SaveNetSuiteInput, userId?: number) {
  const co = await loadCompanyForSettings(db);
  const current = getErpSyncSettings(co);
  const prev = current.netsuite ?? {};
  const next: NetSuiteConnectionStored = { ...prev, modules: { ...(prev.modules ?? {}) } };
  const changed: string[] = [];
  const notes: string[] = [];

  try {
    if (input.accountId !== undefined) {
      const id = input.accountId.trim() ? normalizeAccountId(input.accountId) : undefined;
      if (id !== prev.accountId) changed.push("Account ID");
      next.accountId = id;
    }
    for (const [field, label] of [["clientId", "Client ID"], ["certificateId", "Certificate ID"]] as const) {
      const v = input[field];
      if (v === undefined) continue;
      const t = v.trim() || undefined;
      if (t !== prev[field]) changed.push(label);
      next[field] = t;
    }
    if (input.keyAlgorithm !== undefined) {
      if (input.keyAlgorithm !== "auto" && !SIGNING_ALGORITHMS.includes(input.keyAlgorithm)) throw new NetSuiteSetupError("bad_alg", "Unknown key type.");
      if (input.keyAlgorithm !== (prev.keyAlgorithm ?? "auto")) changed.push("Key type");
      next.keyAlgorithm = input.keyAlgorithm;
    }
    let keyPlain: string | null = null;
    if (input.privateKey !== undefined && input.privateKey.trim()) {
      const parsed = parsePrivateKey(input.privateKey);
      resolveAlgorithm(parsed, (next.keyAlgorithm as KeyAlgorithmChoice) ?? "auto");
      keyPlain = input.privateKey.trim();
      next.privateKeyEncrypted = encryptSecret(keyPlain);
      notes.push(prev.privateKeyEncrypted ? "Private key replaced" : "Private key saved");
    } else if (next.privateKeyEncrypted && input.keyAlgorithm !== undefined) {
      const k = tryDecryptSecret(next.privateKeyEncrypted);
      if (k.ok) resolveAlgorithm(parsePrivateKey(k.plaintext), (next.keyAlgorithm as KeyAlgorithmChoice) ?? "auto");
    }
    if (input.publicCertificate !== undefined) {
      const pem = input.publicCertificate.trim();
      if (pem) {
        if (!keyPlain && next.privateKeyEncrypted) {
          const k = tryDecryptSecret(next.privateKeyEncrypted);
          keyPlain = k.ok ? k.plaintext : null;
        }
        const summary = summarizeCertificate(pem, keyPlain);
        if (summary.matchesPrivateKey === false) throw new NetSuiteSetupError("cert_mismatch", "This public certificate doesn't match the saved private key. Paste the public.pem made with the same key.");
        if (pem !== prev.publicCertificatePem) changed.push("Public certificate");
        next.publicCertificatePem = pem;
      } else if (prev.publicCertificatePem) {
        changed.push("Public certificate removed");
        delete next.publicCertificatePem;
      }
    }
  } catch (err) {
    setupError(err);
  }

  for (const key of MODULE_KEYS) {
    const m = input.modules?.[key];
    if (!m) continue;
    const before = prev.modules?.[key] ?? {};
    const after = { ...before };
    if (m.recordType !== undefined) {
      const rt = m.recordType.trim();
      if (rt && !RECORD_TYPE_PATTERN.test(rt)) throw AppError.badRequest(`${MODULE_LABELS[key]}: the record type ID can only use letters, numbers and underscores (for example customrecord_fai).`);
      if (rt !== (before.recordType ?? DEFAULT_RECORD_TYPES[key])) changed.push(`${MODULE_LABELS[key]} record type (${rt || "blank"})`);
      after.recordType = rt;
      if (next.moduleChecks?.[key] && rt !== (before.recordType ?? DEFAULT_RECORD_TYPES[key])) {
        next.moduleChecks = { ...next.moduleChecks };
        delete next.moduleChecks[key];
      }
    }
    if (m.enabled !== undefined && m.enabled !== (before.enabled ?? false)) {
      after.enabled = m.enabled;
      await audit(db, m.enabled ? "module_enabled" : "module_disabled", userId, `${MODULE_LABELS[key]} ${m.enabled ? "turned on" : "turned off"} for NetSuite`, { module: key });
    }
    next.modules![key] = after;
  }

  const credentialChanged = changed.some((c) => ["Account ID", "Client ID", "Certificate ID", "Key type"].includes(c)) || notes.length > 0;
  if (credentialChanged) {
    clearNetSuiteTokenCache();
    delete next.lastTest;
  }
  await saveStored(db, co.id, current, next);

  if (changed.length || notes.length) {
    await audit(db, notes.some((n) => n.includes("replaced")) ? "key_replaced" : "update", userId, `NetSuite connection settings saved: ${[...changed, ...notes].join(", ")}`, {
      fieldsChanged: changed,
      privateKeyChanged: notes.length > 0,
    });
  }
  return getNetSuiteView(db);
}

export async function removeNetSuite(db: Db, userId?: number) {
  const co = await loadCompanyForSettings(db);
  const current = getErpSyncSettings(co);
  clearNetSuiteTokenCache();
  const had = Boolean(current.netsuite);
  await saveStored(db, co.id, current, undefined);
  if (had) await audit(db, "remove", userId, "NetSuite connection removed (account details, private key and certificate deleted from AccuQual)");
  return getNetSuiteView(db);
}

function loadClient(ns: NetSuiteConnectionStored): NetSuiteClient | { missing: string[] } {
  const missing: string[] = [];
  if (!ns.accountId) missing.push("Account ID");
  if (!ns.clientId) missing.push("Client ID");
  if (!ns.certificateId) missing.push("Certificate ID");
  if (!ns.privateKeyEncrypted) missing.push("Private key");
  if (missing.length) return { missing };
  const key = tryDecryptSecret(ns.privateKeyEncrypted!);
  if (!key.ok) return { missing: ["Private key (can't be read with this server's encryption key; enter it again)"] };
  return new NetSuiteClient(
    { accountId: ns.accountId!, clientId: ns.clientId!, certificateId: ns.certificateId!, privateKeyPem: key.plaintext, algorithm: (ns.keyAlgorithm as KeyAlgorithmChoice) ?? "auto" },
    clientOptions(),
  );
}

function failureOf(err: unknown) {
  if (err instanceof NetSuiteHttpError) return err.failure;
  if (err instanceof NetSuiteSetupError) return { ok: false as const, code: err.code, title: "Settings need attention", guidance: err.message };
  if (err instanceof NetSuiteReadOnlyError) return { ok: false as const, code: err.code, title: "Blocked", guidance: err.message };
  return { ok: false as const, code: "unexpected", title: "Something went wrong", guidance: "The test couldn't finish. Try again.", detail: redactSecrets(String((err as Error)?.message ?? err)).slice(0, 200) };
}

export async function testNetSuiteConnection(db: Db, userId?: number) {
  const co = await loadCompanyForSettings(db);
  const current = getErpSyncSettings(co);
  const ns = current.netsuite ?? {};
  const at = new Date().toISOString();
  const environment = ns.accountId ? ENVIRONMENT_LABELS[accountEnvironment(ns.accountId)] : undefined;
  const client = loadClient(ns);
  const started = Date.now();
  let result: { ok: boolean; code: string; title: string; guidance: string; detail?: string; durationMs: number; at: string; accountId?: string; environment?: string; algorithm?: string | null };

  if (!(client instanceof NetSuiteClient)) {
    result = { ok: false, code: "not_configured", title: "Not set up yet", guidance: `Enter and save: ${client.missing.join(", ")}.`, durationMs: 0, at };
  } else {
    try {
      await client.getAccessToken(true);
      await client.get(`${RECORD_PREFIX}metadata-catalog`);
      result = { ok: true, code: "connected", title: "Connected", guidance: "AccuQual signed in to NetSuite and read one record list. Nothing was changed in NetSuite.", durationMs: Date.now() - started, at, accountId: ns.accountId, environment, algorithm: client.algorithm };
    } catch (err) {
      const f = failureOf(err);
      result = { ...f, ok: false, durationMs: Date.now() - started, at, accountId: ns.accountId, environment };
    }
  }

  const message = result.ok ? `Connected to ${ns.accountId} (${environment}) in ${result.durationMs} ms` : `${result.title}. ${result.guidance}${result.detail ? ` NetSuite said: ${result.detail}` : ""}`;
  ns.lastTest = { at, ok: result.ok, code: result.code, status: result.ok ? "success" : "failed", message, durationMs: result.durationMs, environment };
  await saveStored(db, co.id, current, { ...ns });
  await audit(db, "connection_test", userId, `NetSuite connection test ${result.ok ? "passed" : "failed"}: ${message}`, { result: result.ok ? "success" : "failed", code: result.code, durationMs: result.durationMs });
  return result;
}

export type ModuleCheckStatus = "reachable" | "not_configured" | "no_permission" | "not_found" | "error";

export async function checkNetSuiteModule(db: Db, moduleKey: NetSuiteModuleKey, userId?: number) {
  const co = await loadCompanyForSettings(db);
  const current = getErpSyncSettings(co);
  const ns = current.netsuite ?? {};
  const recordType = ns.modules?.[moduleKey]?.recordType ?? DEFAULT_RECORD_TYPES[moduleKey];
  const at = new Date().toISOString();
  const started = Date.now();
  let status: ModuleCheckStatus;
  let message: string;
  const client = loadClient(ns);

  if (!recordType) {
    status = "not_configured";
    message = "Enter the NetSuite record type ID first (the NetSuite developer gives you this).";
  } else if (!(client instanceof NetSuiteClient)) {
    status = "not_configured";
    message = `Finish the connection first: ${client.missing.join(", ")}.`;
  } else {
    try {
      await client.get(`${RECORD_PREFIX}${encodeURIComponent(recordType)}?limit=1`);
      status = "reachable";
      message = `AccuQual can read ${recordType} in NetSuite.`;
    } catch (err) {
      const f = failureOf(err);
      status = f.code === "no_permission" || f.code === "unauthorized" ? "no_permission" : f.code === "not_found" ? "not_found" : "error";
      message = `${f.title}. ${f.guidance}`;
    }
  }
  const durationMs = Date.now() - started;
  const check = { at, status, message, durationMs };
  await saveStored(db, co.id, current, { ...ns, moduleChecks: { ...(ns.moduleChecks ?? {}), [moduleKey]: check } });
  await audit(db, "module_check", userId, `NetSuite ${MODULE_LABELS[moduleKey]} access check: ${status.replace("_", " ")}${recordType ? ` (${recordType})` : ""}`, { module: moduleKey, status });
  return { module: moduleKey, recordType, ...check };
}
