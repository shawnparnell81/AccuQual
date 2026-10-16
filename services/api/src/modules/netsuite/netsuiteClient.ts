/**
 * Read-only HTTP client for NetSuite's REST web services.
 *
 * AccuQual never creates, changes or deletes anything in NetSuite. That rule is
 * enforced here, below every caller: assertReadOnlyRequest() refuses any request
 * other than
 *   - POST to the OAuth 2.0 token endpoint (signing in),
 *   - GET under /services/rest/record/v1/ (reading records and metadata),
 *   - POST to /services/rest/query/v1/suiteql with a single SELECT statement.
 * SuiteQL is NetSuite's read-only query language; the SELECT check is a second lock.
 */
import { accountDomain, buildClientAssertion, keyFingerprint, type KeyAlgorithmChoice, type SigningAlgorithm } from "./netsuiteAuth.js";

export const TOKEN_PATH = "/services/rest/auth/oauth2/v1/token";
export const SUITEQL_PATH = "/services/rest/query/v1/suiteql";
export const RECORD_PREFIX = "/services/rest/record/v1/";

export class NetSuiteReadOnlyError extends Error {
  readonly code = "read_only_blocked";
  constructor(message: string) {
    super(message);
    this.name = "NetSuiteReadOnlyError";
  }
}

const WRITE_WORDS = /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|exec|execute|call|commit|rollback)\b/i;

/** True only for one SELECT (or WITH ... SELECT) statement. */
export function isSelectOnly(sql: string): boolean {
  const text = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .trim()
    .replace(/;\s*$/, "");
  if (!text || text.includes(";")) return false;
  if (!/^(select|with)\b/i.test(text)) return false;
  return !WRITE_WORDS.test(text);
}

export function assertReadOnlyRequest(method: string, path: string, body?: unknown): void {
  const m = method.toUpperCase();
  const p = path.split("?")[0] ?? "";
  if (p.includes("..") || /%2e/i.test(p)) throw new NetSuiteReadOnlyError("Blocked: that NetSuite address isn't allowed.");
  if (m === "POST" && p === TOKEN_PATH) return;
  if (m === "GET" && p.startsWith(RECORD_PREFIX)) return;
  if (m === "POST" && p === SUITEQL_PATH) {
    const q = (body as { q?: unknown } | undefined)?.q;
    if (typeof q === "string" && isSelectOnly(q)) return;
    throw new NetSuiteReadOnlyError("Blocked: AccuQual only runs read-only SELECT queries in NetSuite.");
  }
  throw new NetSuiteReadOnlyError(`Blocked: AccuQual is read-only in NetSuite, so ${m} ${p} is not allowed.`);
}

/** Strips anything secret-looking from text before it is shown, stored or logged. */
export function redactSecrets(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted key]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[redacted token]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/("?(?:access_token|client_assertion|refresh_token)"?\s*[:=]\s*"?)[^"&,\s}]+/gi, "$1[redacted]");
}

export interface NetSuiteCredentials {
  accountId: string;
  clientId: string;
  certificateId: string;
  privateKeyPem: string;
  algorithm?: KeyAlgorithmChoice;
}

export interface NetSuiteClientOptions {
  /** Replaces https://<account domain> (local fake server in tests only). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface NetSuiteFailure {
  ok: false;
  code: string;
  title: string;
  guidance: string;
  status?: number;
  detail?: string;
}

/** Access tokens in memory only, never in the database. Keyed by connection, not by token. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearNetSuiteTokenCache(): void {
  tokenCache.clear();
}

export class NetSuiteHttpError extends Error {
  constructor(public readonly failure: NetSuiteFailure) {
    super(failure.title);
    this.name = "NetSuiteHttpError";
  }
}

export class NetSuiteClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  algorithm: SigningAlgorithm | null = null;

  constructor(private readonly creds: NetSuiteCredentials, opts: NetSuiteClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? `https://${accountDomain(creds.accountId)}`).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private cacheKey(): string {
    const c = this.creds;
    return [this.baseUrl, c.accountId, c.clientId, c.certificateId, keyFingerprint(c.privateKeyPem)].join("|");
  }

  private async send(method: string, path: string, init: { headers?: Record<string, string>; body?: string; jsonBody?: unknown }): Promise<Response> {
    assertReadOnlyRequest(method, path, init.jsonBody);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: init.headers,
        body: init.jsonBody !== undefined ? JSON.stringify(init.jsonBody) : init.body,
        signal: controller.signal,
        redirect: "error",
      });
    } catch (err) {
      throw new NetSuiteHttpError(mapNetworkError(err));
    } finally {
      clearTimeout(timer);
    }
  }

  async getAccessToken(force = false): Promise<string> {
    const key = this.cacheKey();
    const cached = tokenCache.get(key);
    if (!force && cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
    const { assertion, algorithm } = buildClientAssertion(this.creds);
    this.algorithm = algorithm;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    }).toString();
    const res = await this.send("POST", TOKEN_PATH, { headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body });
    const text = await res.text();
    if (!res.ok) throw new NetSuiteHttpError(mapNetSuiteError(res.status, text, res.headers.get("date"), "token"));
    let json: { access_token?: string; expires_in?: number };
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
    if (!json.access_token) throw new NetSuiteHttpError(mapNetSuiteError(res.status, text, null, "token"));
    const ttl = Math.min(Number(json.expires_in) || 3600, 3600) * 1000;
    tokenCache.set(key, { token: json.access_token, expiresAt: Date.now() + ttl });
    return json.access_token;
  }

  private async authed(method: "GET" | "POST", path: string, jsonBody?: unknown): Promise<unknown> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
      headers.Prefer = "transient";
    }
    const res = await this.send(method, path, { headers, jsonBody });
    const text = await res.text();
    if (res.status === 401) tokenCache.delete(this.cacheKey());
    if (!res.ok) throw new NetSuiteHttpError(mapNetSuiteError(res.status, text, res.headers.get("date"), "rest"));
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  get(path: string): Promise<unknown> {
    return this.authed("GET", path);
  }

  suiteql(q: string): Promise<unknown> {
    return this.authed("POST", `${SUITEQL_PATH}?limit=1`, { q });
  }
}

function errorParts(body: string): { error: string; description: string } {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const details = Array.isArray(j["o:errorDetails"]) ? (j["o:errorDetails"] as { detail?: string; "o:errorCode"?: string }[]) : [];
    return {
      error: String(j.error ?? details[0]?.["o:errorCode"] ?? j.title ?? ""),
      description: String(j.error_description ?? details[0]?.detail ?? j.detail ?? ""),
    };
  } catch {
    return { error: "", description: body.slice(0, 300) };
  }
}

const CLOCK_SKEW_LIMIT_MS = 2 * 60_000;

/** Turns NetSuite's reply into plain guidance. The raw detail is redacted and kept short. */
export function mapNetSuiteError(status: number, body: string, serverDate: string | null, stage: "token" | "rest", now = Date.now()): NetSuiteFailure {
  const { error, description } = errorParts(body);
  const detail = redactSecrets([error, description].filter(Boolean).join(": ")).slice(0, 300) || `HTTP ${status}`;
  const base = { ok: false as const, status, detail };
  const skew = serverDate ? Math.abs(Date.parse(serverDate) - now) : 0;
  const text = `${error} ${description}`.toLowerCase();

  if (skew > CLOCK_SKEW_LIMIT_MS || /\b(iat|exp|clock|not yet valid|expired? jwt|token.*(future|expired))\b/.test(text)) {
    return { ...base, code: "clock_skew", title: "Server clock is off", guidance: "NetSuite rejected the sign-in time. Check that this server's clock is correct, then test again." };
  }
  if (stage === "token") {
    if (error === "invalid_client" || (/client/.test(text) && status === 401)) {
      return { ...base, code: "invalid_client", title: "NetSuite didn't accept the Client ID", guidance: "Check the Client ID from the integration record, and that the integration is Enabled with Client Credentials (Machine to Machine) turned on." };
    }
    if (error === "unauthorized_client") {
      return { ...base, code: "unauthorized_client", title: "Machine-to-machine sign-in isn't turned on", guidance: "On the integration record, turn on Client Credentials (Machine to Machine) Grant under OAuth 2.0, then save." };
    }
    if (error === "invalid_scope") {
      return { ...base, code: "invalid_scope", title: "Scopes not allowed", guidance: "On the integration record, tick both REST Web Services and RESTlets scopes." };
    }
    if (error === "invalid_grant" || error === "invalid_request" || status === 400) {
      return { ...base, code: "invalid_grant", title: "NetSuite didn't accept the certificate", guidance: "Check the Certificate ID, that the private key belongs to the certificate uploaded in OAuth 2.0 Client Credentials Setup, that the certificate hasn't expired or been revoked, and that the mapping's role includes Log in using OAuth 2.0 Access Tokens." };
    }
    if (status === 404) {
      return { ...base, code: "wrong_account", title: "Account ID not found", guidance: "NetSuite has no sign-in address for that account ID. Copy it from Setup > Company > Company Information (Account ID) in NetSuite. Sandbox IDs end in _SB1." };
    }
  }
  if (status === 401) {
    return { ...base, code: "unauthorized", title: "Signed in, but the request wasn't authorized", guidance: "Check that the mapped role has REST Web Services and Log in using OAuth 2.0 Access Tokens permissions, and that REST Web Services is enabled under Setup > Company > Enable Features > SuiteCloud." };
  }
  if (status === 403) {
    return { ...base, code: "no_permission", title: "No permission", guidance: "The mapped NetSuite role can't read this. Ask the NetSuite developer to give that role View access to the record." };
  }
  if (status === 404) {
    return { ...base, code: "not_found", title: "Not found", guidance: "NetSuite has no record type with that ID. Check the record type ID (for example customrecord_fai)." };
  }
  if (status === 429) {
    return { ...base, code: "rate_limited", title: "NetSuite is busy", guidance: "NetSuite asked us to slow down. Wait a minute and test again." };
  }
  if (status >= 500) {
    return { ...base, code: "netsuite_unavailable", title: "NetSuite had a problem", guidance: "NetSuite returned a server error. Try again in a few minutes; if it continues, check status.netsuite.com." };
  }
  return { ...base, code: "netsuite_error", title: "NetSuite returned an error", guidance: "See the detail below and share it with the NetSuite developer." };
}

export function mapNetworkError(err: unknown): NetSuiteFailure {
  const e = err as { name?: string; code?: string; cause?: { code?: string } };
  const code = e?.cause?.code ?? e?.code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { ok: false, code: "wrong_account", title: "Account ID not found", guidance: "The NetSuite address for this account ID doesn't exist. Check the account ID; sandbox IDs end in _SB1.", detail: code };
  }
  if (e?.name === "AbortError" || e?.name === "TimeoutError") {
    return { ok: false, code: "timeout", title: "NetSuite didn't answer in time", guidance: "Check this server's internet access, then test again.", detail: "timeout" };
  }
  if (code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return { ok: false, code: "network", title: "Secure connection failed", guidance: "The secure connection to NetSuite couldn't be checked. Test again later.", detail: code };
  }
  return { ok: false, code: "network", title: "Couldn't reach NetSuite", guidance: "This server couldn't connect to NetSuite. Check its internet access and test again.", detail: redactSecrets(String(code || e?.name || "network error")) };
}
