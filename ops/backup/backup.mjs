#!/usr/bin/env node
/**
 * AccuQual off-platform database backup.
 *
 *   node backup.mjs backup                         take, encrypt, upload and prune a backup
 *   node backup.mjs fetch [latest|<key>] --out D   download + decrypt + integrity-check a backup into directory D
 *   node backup.mjs list                           show the backups in storage
 *
 * What a backup is: ONE pg_dump of the `public` and `drizzle` schemas taken from a single exported snapshot, plus a
 * manifest of exact row counts taken from that SAME snapshot, tarred and encrypted (AES-256, key derived from
 * BACKUP_PASSPHRASE) before it leaves this process. The storage provider only ever sees ciphertext.
 * Decrypting without this tool:
 *   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in X.tar.enc -out X.tar && tar -xf X.tar
 *
 * Zero npm dependencies on purpose: it runs inside ops/backup/Dockerfile next to pg_dump 17, openssl and the aws CLI.
 * Configuration is environment only (see docs/operations/backup-and-restore.md); nothing secret is ever printed.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const NAME_PATTERN = /^accuqual-\d{8}T\d{6}Z\.tar\.enc$/;
export const TIERS = ["daily", "weekly", "monthly"];
const DEFAULT_KEEP = { daily: 14, weekly: 8, monthly: 12 };
const PBKDF2_ITER = "600000";

// ---------- pure helpers (unit-tested) ----------

/** 20260920T150000Z */
export function stampFor(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

export function backupName(date) {
  return `accuqual-${stampFor(date)}.tar.enc`;
}

/** Every backup is a "daily"; Sundays (UTC) are also kept as a "weekly", and the 1st of the month as a "monthly". */
export function tiersFor(date) {
  const tiers = ["daily"];
  if (date.getUTCDay() === 0) tiers.push("weekly");
  if (date.getUTCDate() === 1) tiers.push("monthly");
  return tiers;
}

/**
 * Which stored objects to delete so that only the newest `keep` remain. Only names this tool wrote (NAME_PATTERN) are
 * ever considered; anything else in the bucket is left alone. The newest backup can never be selected.
 */
export function selectPrunable(keys, keep) {
  const n = Math.max(1, Number.isFinite(keep) ? Math.floor(keep) : 1);
  const mine = keys.filter((k) => NAME_PATTERN.test(k.split("/").pop() ?? "")).sort((a, b) => (a.split("/").pop() < b.split("/").pop() ? 1 : -1));
  return mine.slice(n);
}

export function newestKey(keys) {
  const mine = keys.filter((k) => NAME_PATTERN.test(k.split("/").pop() ?? "")).sort((a, b) => (a.split("/").pop() < b.split("/").pop() ? 1 : -1));
  return mine[0] ?? null;
}

/** Scrubs secrets from any text before it is printed or thrown. */
export function makeRedactor(secrets) {
  const list = secrets.filter((s) => typeof s === "string" && s.length >= 4).sort((a, b) => b.length - a.length);
  return (text) => list.reduce((t, s) => t.split(s).join("***"), String(text));
}

export function passwordOf(databaseUrl) {
  try {
    return decodeURIComponent(new URL(databaseUrl).password);
  } catch {
    return "";
  }
}

// ---------- configuration ----------

function readConfig(env = process.env) {
  const need = (k) => {
    if (!env[k]) throw new Error(`${k} is not set`);
    return env[k];
  };
  const keep = {
    daily: Number(env.BACKUP_KEEP_DAILY ?? DEFAULT_KEEP.daily),
    weekly: Number(env.BACKUP_KEEP_WEEKLY ?? DEFAULT_KEEP.weekly),
    monthly: Number(env.BACKUP_KEEP_MONTHLY ?? DEFAULT_KEEP.monthly),
  };
  return {
    passphrase: need("BACKUP_PASSPHRASE"),
    databaseUrl: env.BACKUP_DATABASE_URL,
    bucket: env.BACKUP_S3_BUCKET,
    endpoint: env.BACKUP_S3_ENDPOINT,
    localDir: env.BACKUP_LOCAL_DIR,
    prefix: (env.BACKUP_PREFIX ?? "accuqual/").replace(/^\/+/, "").replace(/([^/])$/, "$1/"),
    keep,
    heartbeat: env.BACKUP_HEARTBEAT_URL,
    minTables: Number(env.BACKUP_MIN_TABLES ?? 20),
    minDumpBytes: Number(env.BACKUP_MIN_DUMP_BYTES ?? 50_000),
  };
}

// ---------- storage: S3-compatible (aws CLI) or a local directory ----------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}: ${(r.stderr || r.stdout || "").trim().slice(0, 600)}`);
  return r.stdout;
}

export function makeStore(cfg) {
  if (cfg.bucket) {
    const base = cfg.endpoint ? ["--endpoint-url", cfg.endpoint] : [];
    const s3 = (args) => run("aws", [...args, ...base]);
    return {
      describe: `bucket ${cfg.bucket}`,
      put: (key, file) => s3(["s3", "cp", file, `s3://${cfg.bucket}/${key}`, "--only-show-errors"]),
      get: (key, file) => s3(["s3", "cp", `s3://${cfg.bucket}/${key}`, file, "--only-show-errors"]),
      size: (key) => Number(s3(["s3api", "head-object", "--bucket", cfg.bucket, "--key", key, "--query", "ContentLength", "--output", "text"]).trim()),
      list: (prefix) => {
        const out = s3(["s3api", "list-objects-v2", "--bucket", cfg.bucket, "--prefix", prefix, "--query", "Contents[].Key", "--output", "json"]).trim();
        const parsed = out && out !== "null" ? JSON.parse(out) : [];
        return Array.isArray(parsed) ? parsed : [];
      },
      remove: (key) => s3(["s3api", "delete-object", "--bucket", cfg.bucket, "--key", key]),
    };
  }
  if (cfg.localDir) {
    const at = (key) => path.join(cfg.localDir, key);
    return {
      describe: `directory ${cfg.localDir}`,
      put: (key, file) => {
        fs.mkdirSync(path.dirname(at(key)), { recursive: true });
        fs.copyFileSync(file, at(key));
      },
      get: (key, file) => fs.copyFileSync(at(key), file),
      size: (key) => fs.statSync(at(key)).size,
      list: (prefix) => {
        const dir = path.join(cfg.localDir, prefix);
        return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => prefix + f) : [];
      },
      remove: (key) => fs.rmSync(at(key), { force: true }),
    };
  }
  throw new Error("No storage configured: set BACKUP_S3_BUCKET (S3-compatible) or BACKUP_LOCAL_DIR");
}

// ---------- crypto ----------

function sha256File(file) {
  const h = createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function encrypt(inFile, outFile, passphrase) {
  run("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", PBKDF2_ITER, "-salt", "-pass", "env:BACKUP_PASSPHRASE", "-in", inFile, "-out", outFile], { env: { ...process.env, BACKUP_PASSPHRASE: passphrase } });
}

function decrypt(inFile, outFile, passphrase) {
  run("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", PBKDF2_ITER, "-pass", "env:BACKUP_PASSPHRASE", "-in", inFile, "-out", outFile], { env: { ...process.env, BACKUP_PASSPHRASE: passphrase } });
}

// ---------- one consistent snapshot: psql session that stays open while pg_dump reads the same snapshot ----------

function openSession(url, redact) {
  const child = spawn("psql", [url, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  let waiter = null;
  let closed = false;
  const settle = () => {
    const i = out.indexOf("__END__\n");
    if (i >= 0 && waiter) {
      const w = waiter;
      waiter = null;
      const text = out.slice(0, i);
      out = out.slice(i + "__END__\n".length);
      w.resolve(text);
    }
  };
  child.stdout.on("data", (d) => {
    out += d;
    settle();
  });
  child.stderr.on("data", (d) => (err += d));
  child.on("error", (e) => waiter?.reject(new Error(`psql: ${e.message}`)));
  child.on("exit", (code) => {
    closed = true;
    if (waiter) waiter.reject(new Error(`psql stopped (${code}): ${redact(err).trim().slice(0, 600)}`));
  });
  return {
    query: (sql) =>
      new Promise((resolve, reject) => {
        if (closed) return reject(new Error("psql session is closed"));
        waiter = { resolve, reject };
        child.stdin.write(`${sql}\n\\echo __END__\n`);
      }),
    close: () => {
      try {
        child.stdin.end("\\q\n");
      } catch {
        /* already closed */
      }
    },
  };
}

const COUNT_TABLES_SQL = `SELECT table_name || E'\\t' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1;`;

// Same definitions as CATALOG_QUERIES in services/api/src/db/verifyRestore.ts (the restore check compares against these).
const CATALOG_SQL = `
SELECT 'tables' || E'\\t' || count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
UNION ALL SELECT 'columns' || E'\\t' || count(*) FROM information_schema.columns WHERE table_schema = 'public'
UNION ALL SELECT 'indexes' || E'\\t' || count(*) FROM pg_indexes WHERE schemaname = 'public'
UNION ALL SELECT 'constraints' || E'\\t' || count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'
UNION ALL SELECT 'triggers' || E'\\t' || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal
UNION ALL SELECT 'functions' || E'\\t' || count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
UNION ALL SELECT 'sequences' || E'\\t' || count(*) FROM information_schema.sequences WHERE sequence_schema = 'public'
UNION ALL SELECT 'rlsPolicies' || E'\\t' || count(*) FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'rlsEnabledTables' || E'\\t' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;`;

const parsePairs = (text) =>
  Object.fromEntries(
    text
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [k, v] = l.split("\t");
        return [k, Number(v)];
      }),
  );

// ---------- commands ----------

async function pingHeartbeat(url, suffix = "") {
  if (!url) return;
  try {
    await fetch(url.replace(/\/+$/, "") + suffix, { method: "POST", signal: AbortSignal.timeout(10_000) });
  } catch {
    /* monitoring must never fail the backup */
  }
}

async function takeBackup(cfg, redact, now = new Date()) {
  if (!cfg.databaseUrl) throw new Error("BACKUP_DATABASE_URL is not set");
  const store = makeStore(cfg);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "aq-backup-"));
  const dumpFile = path.join(work, "accuqual.dump");
  const started = Date.now();
  try {
    // 1. Export a snapshot and keep the transaction open; count rows inside it.
    const session = openSession(cfg.databaseUrl, redact);
    let snapshot;
    let counts;
    let catalog;
    let migrations;
    let serverVersion;
    try {
      await session.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");
      snapshot = (await session.query("SELECT pg_export_snapshot();")).trim();
      if (!/^[0-9A-Fa-f-]+$/.test(snapshot)) throw new Error("could not export a database snapshot");

      // 2. Dump exactly that snapshot (public = the application, drizzle = migration history; see the runbook for why both).
      const dumpArgs = [`--dbname=${cfg.databaseUrl}`, `--snapshot=${snapshot}`, "--format=custom", "--schema=public", "--schema=drizzle", "--no-owner", "--no-privileges", `--file=${dumpFile}`];
      await new Promise((resolve, reject) => {
        const p = spawn("pg_dump", dumpArgs, { stdio: ["ignore", "ignore", "pipe"] });
        let e = "";
        p.stderr.on("data", (d) => (e += d));
        p.on("error", (er) => reject(new Error(`pg_dump: ${er.message}`)));
        p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`pg_dump exited ${c}: ${redact(e).trim().slice(0, 600)}`))));
      });

      counts = parsePairs(await session.query(COUNT_TABLES_SQL));
      catalog = parsePairs(await session.query(CATALOG_SQL));
      migrations = Number((await session.query("SELECT count(*) FROM drizzle.__drizzle_migrations;")).trim());
      serverVersion = (await session.query("SHOW server_version;")).trim();
      await session.query("COMMIT;");
    } finally {
      session.close();
    }

    // 3. Refuse to store something that is obviously not the application database (wrong URL, empty database).
    const tableCount = Object.keys(counts).length;
    const dumpBytes = fs.statSync(dumpFile).size;
    if (tableCount < cfg.minTables) throw new Error(`the database has only ${tableCount} tables (expected at least ${cfg.minTables}); refusing to store it as a backup`);
    if (dumpBytes < cfg.minDumpBytes) throw new Error(`the dump is only ${dumpBytes} bytes (expected at least ${cfg.minDumpBytes}); refusing to store it as a backup`);
    const list = run("pg_restore", ["--list", dumpFile]);
    if (!/ SCHEMA - drizzle /.test(list) || !/TABLE DATA public /.test(list)) throw new Error("the dump does not contain both the public and drizzle schemas");

    // 4. Manifest + bundle + encrypt.
    const manifest = {
      format: 1,
      createdAt: now.toISOString(),
      serverVersion,
      pgDump: run("pg_dump", ["--version"]).trim(),
      dumpBytes,
      dumpSha256: sha256File(dumpFile),
      migrations,
      catalog,
      tables: counts,
      totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    };
    fs.writeFileSync(path.join(work, "manifest.json"), JSON.stringify(manifest, null, 2));
    const tarFile = path.join(work, "bundle.tar");
    run("tar", ["-cf", tarFile, "-C", work, "accuqual.dump", "manifest.json"]);
    const encFile = path.join(work, "bundle.tar.enc");
    encrypt(tarFile, encFile, cfg.passphrase);

    // 5. Prove the ciphertext decrypts back to exactly what we bundled, before anything is uploaded.
    const checkFile = path.join(work, "roundtrip.tar");
    decrypt(encFile, checkFile, cfg.passphrase);
    if (sha256File(checkFile) !== sha256File(tarFile)) throw new Error("encryption round-trip check failed");
    fs.rmSync(checkFile);
    fs.rmSync(tarFile);
    const encBytes = fs.statSync(encFile).size;

    // 6. Upload to each tier, then confirm the stored size.
    const name = backupName(now);
    const tiers = tiersFor(now);
    for (const tier of tiers) {
      const key = `${cfg.prefix}${tier}/${name}`;
      store.put(key, encFile);
      const stored = store.size(key);
      if (stored !== encBytes) throw new Error(`stored object ${tier}/${name} is ${stored} bytes, expected ${encBytes}`);
    }

    // 7. Prune each tier to its retention. A prune failure is reported but does not undo a good backup.
    const pruned = [];
    const warnings = [];
    for (const tier of TIERS) {
      try {
        const keys = store.list(`${cfg.prefix}${tier}/`);
        for (const key of selectPrunable(keys, cfg.keep[tier])) {
          store.remove(key);
          pruned.push(key);
        }
      } catch (e) {
        warnings.push(`could not prune ${tier}: ${redact(e.message)}`);
      }
    }

    return { name, tiers, storage: store.describe, tables: tableCount, totalRows: manifest.totalRows, dumpBytes, encryptedBytes: encBytes, migrations, pruned: pruned.length, warnings, seconds: Math.round((Date.now() - started) / 1000) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function fetchBackup(cfg, target, outDir, tier = "daily") {
  const store = makeStore(cfg);
  const key = !target || target === "latest" ? newestKey(store.list(`${cfg.prefix}${tier}/`)) : target;
  if (!key) throw new Error(`no backups found under ${cfg.prefix}${tier}/`);
  fs.mkdirSync(outDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "aq-fetch-"));
  try {
    const enc = path.join(work, "bundle.tar.enc");
    store.get(key, enc);
    const tarFile = path.join(work, "bundle.tar");
    try {
      decrypt(enc, tarFile, cfg.passphrase);
      run("tar", ["-xf", tarFile, "-C", outDir]);
    } catch {
      throw new Error("could not decrypt the backup — wrong BACKUP_PASSPHRASE, or the file is damaged");
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    const actual = sha256File(path.join(outDir, "accuqual.dump"));
    if (actual !== manifest.dumpSha256) throw new Error("integrity check failed: the dump does not match its manifest checksum");
    return { key, createdAt: manifest.createdAt, tables: Object.keys(manifest.tables).length, totalRows: manifest.totalRows, migrations: manifest.migrations };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main(argv) {
  const [command, ...rest] = argv;
  const cfg0 = (() => {
    try {
      return readConfig();
    } catch (e) {
      console.error(`Configuration error: ${e.message}`);
      process.exit(2);
    }
  })();
  const redact = makeRedactor([cfg0.passphrase, passwordOf(cfg0.databaseUrl ?? ""), process.env.AWS_SECRET_ACCESS_KEY, process.env.AWS_ACCESS_KEY_ID]);
  try {
    if (command === "backup") {
      await pingHeartbeat(cfg0.heartbeat, "/start");
      const result = await takeBackup(cfg0, redact);
      await pingHeartbeat(cfg0.heartbeat);
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      if (result.warnings.length) console.error(`WARNING: ${result.warnings.join("; ")}`);
    } else if (command === "fetch") {
      const outIdx = rest.indexOf("--out");
      const tierIdx = rest.indexOf("--tier");
      if (outIdx < 0) throw new Error("fetch needs --out <directory>");
      const target = rest[0] && !rest[0].startsWith("--") ? rest[0] : "latest";
      console.log(JSON.stringify({ ok: true, ...fetchBackup(cfg0, target, rest[outIdx + 1], tierIdx >= 0 ? rest[tierIdx + 1] : "daily") }, null, 2));
    } else if (command === "list") {
      const store = makeStore(cfg0);
      for (const tier of TIERS) console.log(`${tier}:`, store.list(`${cfg0.prefix}${tier}/`).filter((k) => NAME_PATTERN.test(k.split("/").pop() ?? "")).sort().reverse().join("\n  ") || "(none)");
    } else {
      console.error("usage: backup.mjs backup | fetch [latest|<key>] --out <dir> [--tier daily|weekly|monthly] | list");
      process.exit(2);
    }
  } catch (e) {
    if (command === "backup") await pingHeartbeat(cfg0.heartbeat, "/fail");
    console.error(`FAILED: ${redact(e.message)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
