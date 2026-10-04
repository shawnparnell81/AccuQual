/**
 * TLS settings for a hosted Postgres connection.
 *
 * Local and CI hosts speak plaintext. Everywhere else the socket is TLS.
 * Production verifies the server certificate and refuses to boot unless
 * `DATABASE_SSL_CA` is a PEM. Development and test still connect to a remote
 * host without a CA, accepting any certificate, so a local checkout is not
 * stranded. A PEM always turns verification on.
 *
 * When verification is on, `sslmode` and the other ssl* query params are
 * stripped from the URL. node-postgres copies the parsed URL over the `ssl`
 * object, which would drop the CA or `rejectUnauthorized`.
 */

export const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);

const SSL_QUERY_KEYS = ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert"];

export function normalizeDatabaseSslCa(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  value = value.replace(/\\n/g, "\n").trim();
  return value.length > 0 ? value : undefined;
}

export function isPemCertificate(value: string): boolean {
  return value.includes("-----BEGIN CERTIFICATE-----") && value.includes("-----END CERTIFICATE-----");
}

export function stripSslModeParams(connectionString: string): string {
  const q = connectionString.indexOf("?");
  if (q < 0) return connectionString;
  const params = new URLSearchParams(connectionString.slice(q + 1));
  for (const key of SSL_QUERY_KEYS) params.delete(key);
  const rest = params.toString();
  return rest ? `${connectionString.slice(0, q)}?${rest}` : connectionString.slice(0, q);
}

export interface PostgresSslOptions {
  rejectUnauthorized: boolean;
  ca?: string;
}

/** `undefined` means do not use TLS (local/CI). */
export function postgresSsl(hostname: string, caRaw: string | undefined, nodeEnv = process.env.NODE_ENV): PostgresSslOptions | undefined {
  if (LOCAL_DB_HOSTS.has(hostname)) return undefined;
  const ca = normalizeDatabaseSslCa(caRaw);
  if (ca && isPemCertificate(ca)) return { ca, rejectUnauthorized: true };
  if (nodeEnv === "production") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

/** Pool settings. The connection string is rewritten when the certificate will be verified. */
export function postgresConnectionConfig(connectionString: string, caRaw: string | undefined, nodeEnv = process.env.NODE_ENV): {
  connectionString: string;
  ssl: PostgresSslOptions | undefined;
} {
  const hostname = new URL(connectionString).hostname;
  const ca = normalizeDatabaseSslCa(caRaw);
  const verified = Boolean(ca && isPemCertificate(ca));
  const productionRemote = nodeEnv === "production" && !LOCAL_DB_HOSTS.has(hostname);
  return {
    connectionString: verified || productionRemote ? stripSslModeParams(connectionString) : connectionString,
    ssl: postgresSsl(hostname, caRaw, nodeEnv),
  };
}

export function databaseSslBootProblem(input: {
  nodeEnv: string;
  databaseUrl: string;
  caRaw: string | undefined;
  requireCa: boolean;
}): { fatal: boolean; message: string } | null {
  // Production always requires the CA. The flag stays so older environment files still load.
  void input.requireCa;
  let hostname: string;
  try {
    hostname = new URL(input.databaseUrl).hostname;
  } catch {
    return null;
  }

  const ca = normalizeDatabaseSslCa(input.caRaw);
  if (ca && !isPemCertificate(ca)) {
    return {
      fatal: true,
      message:
        "DATABASE_SSL_CA is set but is not a PEM certificate. Paste the full certificate, including the -----BEGIN CERTIFICATE----- and -----END CERTIFICATE----- lines. Newlines may be real line breaks or the two characters \\n.",
    };
  }

  if (input.nodeEnv !== "production" || LOCAL_DB_HOSTS.has(hostname) || ca) return null;

  const how =
    "Where to get the certificate: Render Dashboard → your Postgres database → Connect (or the Info page) and copy the host. " +
    "External connections use a Render-managed TLS certificate; Render does not publish a separate CA file. From a machine that can reach that host, run " +
    "`openssl s_client -starttls postgres -connect HOST:5432 -showcerts </dev/null` and paste one PEM block (BEGIN CERTIFICATE through END CERTIFICATE) into DATABASE_SSL_CA on accuqual-api. " +
    "Internal Render connections use a self-signed certificate and Render does not support verify-full on them (https://render.com/docs/postgresql-creating-connecting); capture that certificate the same way from the accuqual-api Shell if you use the internal URL. " +
    "Supabase: Project Settings → Database → SSL configuration, download the CA. " +
    "Set DATABASE_SSL_CA on accuqual-api before the next production start. The API will not boot until that value is a PEM.";

  return {
    fatal: true,
    message: `Refusing to start: NODE_ENV=production and DATABASE_SSL_CA is not set. ${how}`,
  };
}
