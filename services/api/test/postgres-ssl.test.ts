import { describe, expect, it } from "vitest";
import { databaseSslBootProblem, isPemCertificate, normalizeDatabaseSslCa, postgresConnectionConfig, postgresSsl, stripSslModeParams } from "../src/db/ssl.js";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

describe("database TLS CA", () => {
  it("turns escaped newlines into a PEM and ignores wrapping quotes", () => {
    const raw = `"-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----"`;
    const pem = normalizeDatabaseSslCa(raw);
    expect(pem).toBe(PEM);
    expect(isPemCertificate(pem!)).toBe(true);
  });

  it("does not use TLS for local hosts, and verifies when a PEM is set", () => {
    expect(postgresSsl("localhost", PEM)).toBeUndefined();
    expect(postgresSsl("127.0.0.1", undefined)).toBeUndefined();
    expect(postgresSsl("postgres", undefined)).toBeUndefined();
    expect(postgresSsl("dpg-example.oregon-postgres.render.com", undefined)).toEqual({ rejectUnauthorized: false });
    expect(postgresSsl("aws-0-us-east-1.pooler.supabase.com", `"${PEM.replace(/\n/g, "\\n")}"`)).toEqual({
      ca: PEM,
      rejectUnauthorized: true,
    });
  });

  it("strips sslmode only when a PEM is verified, so an existing URL is left alone", () => {
    expect(stripSslModeParams("postgres://u:p@host:5432/db?sslmode=require")).toBe("postgres://u:p@host:5432/db");
    expect(stripSslModeParams("postgres://u:p@host/db?sslmode=require&application_name=accuqual")).toBe(
      "postgres://u:p@host/db?application_name=accuqual",
    );
    const url = "postgres://u:p@dpg-example.oregon-postgres.render.com/db?sslmode=require";
    expect(postgresConnectionConfig(url, undefined).connectionString).toBe(url);
    expect(postgresConnectionConfig(url, PEM).connectionString).toBe("postgres://u:p@dpg-example.oregon-postgres.render.com/db");
    expect(postgresConnectionConfig(url, PEM).ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it("refuses production boot only when the explicit flag is on and the CA is missing", () => {
    const remote = "postgres://u:p@dpg-example.oregon-postgres.render.com/db";
    expect(databaseSslBootProblem({ nodeEnv: "production", databaseUrl: remote, caRaw: undefined, requireCa: false })?.fatal).toBe(false);
    expect(databaseSslBootProblem({ nodeEnv: "production", databaseUrl: remote, caRaw: undefined, requireCa: true })?.fatal).toBe(true);
    expect(databaseSslBootProblem({ nodeEnv: "production", databaseUrl: remote, caRaw: PEM, requireCa: true })).toBeNull();
    expect(databaseSslBootProblem({ nodeEnv: "test", databaseUrl: remote, caRaw: undefined, requireCa: true })).toBeNull();
    expect(databaseSslBootProblem({ nodeEnv: "production", databaseUrl: "postgres://u:p@localhost/db", caRaw: undefined, requireCa: true })).toBeNull();
    expect(databaseSslBootProblem({ nodeEnv: "production", databaseUrl: remote, caRaw: "not-a-cert", requireCa: false })?.fatal).toBe(true);
  });
});
