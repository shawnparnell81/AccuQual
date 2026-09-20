import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM script with no type declarations (it runs standalone inside ops/backup/Dockerfile)
import { backupName, makeRedactor, makeStore, NAME_PATTERN, newestKey, passwordOf, selectPrunable, stampFor, tiersFor } from "../../../ops/backup/backup.mjs";

const name = (d: string) => `accuqual/daily/${backupName(new Date(d))}`;

describe("backup naming and tiers", () => {
  it("names backups by UTC timestamp so alphabetical order is chronological", () => {
    expect(stampFor(new Date("2026-09-20T21:57:29.544Z"))).toBe("20260920T215729Z");
    expect(backupName(new Date("2026-09-20T21:57:29Z"))).toBe("accuqual-20260920T215729Z.tar.enc");
    expect(NAME_PATTERN.test(backupName(new Date()))).toBe(true);
    expect(name("2026-01-02T00:00:00Z") < name("2026-01-10T00:00:00Z")).toBe(true);
  });

  it("keeps every backup as a daily, Sundays as a weekly, and the 1st as a monthly", () => {
    expect(tiersFor(new Date("2026-09-22T07:23:00Z"))).toEqual(["daily"]); // Tuesday
    expect(tiersFor(new Date("2026-09-20T07:23:00Z"))).toEqual(["daily", "weekly"]); // Sunday
    expect(tiersFor(new Date("2026-09-01T07:23:00Z"))).toEqual(["daily", "monthly"]); // Tuesday the 1st
    expect(tiersFor(new Date("2026-11-01T07:23:00Z"))).toEqual(["daily", "weekly", "monthly"]); // Sunday the 1st
  });
});

describe("retention", () => {
  const keys = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"].map((d) => name(`${d}T07:00:00Z`));

  it("deletes only the oldest, keeping the newest N", () => {
    expect(selectPrunable(keys, 2)).toEqual([name("2026-09-03T07:00:00Z"), name("2026-09-02T07:00:00Z"), name("2026-09-01T07:00:00Z")]);
    expect(selectPrunable(keys, 5)).toEqual([]);
    expect(selectPrunable(keys, 50)).toEqual([]);
  });

  it("can never delete the newest backup, whatever the setting", () => {
    for (const bad of [0, -3, Number.NaN, 0.4]) expect(selectPrunable(keys, bad)).not.toContain(name("2026-09-05T07:00:00Z"));
    expect(selectPrunable(keys, 0)).toHaveLength(4);
  });

  it("never touches objects it did not write", () => {
    const foreign = ["accuqual/daily/notes-do-not-delete.txt", "accuqual/daily/accuqual-20260905T070000Z.tar.enc.partial", "accuqual/daily/"];
    expect(selectPrunable([...foreign, ...keys], 1)).not.toEqual(expect.arrayContaining(foreign));
    expect(selectPrunable([...foreign, ...keys], 1).every((k: string) => keys.includes(k))).toBe(true);
    expect(newestKey([...foreign, ...keys])).toBe(name("2026-09-05T07:00:00Z"));
    expect(newestKey(foreign)).toBeNull();
  });
});

describe("secret redaction", () => {
  it("removes every secret from text that might be printed", () => {
    const redact = makeRedactor(["hunter2-passphrase", "s3cr3tPassw0rd"]);
    expect(redact("pg_dump: password authentication failed for s3cr3tPassw0rd; key hunter2-passphrase")).toBe("pg_dump: password authentication failed for ***; key ***");
  });

  it("ignores empty or tiny values rather than blanking every character", () => {
    expect(makeRedactor(["", "ab", undefined as unknown as string])("abc abc")).toBe("abc abc");
  });

  it("extracts the password from a database URL, including encoded characters", () => {
    expect(passwordOf("postgresql://postgres.abc:p%40ss%2Fword@aws-0.pooler.supabase.com:5432/postgres")).toBe("p@ss/word");
    expect(passwordOf("not a url")).toBe("");
  });
});

describe("local-directory store", () => {
  it("puts, lists, sizes, fetches and removes objects", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aq-store-"));
    try {
      const store = makeStore({ localDir: dir });
      const src = path.join(dir, "src.bin");
      fs.writeFileSync(src, "encrypted-bytes");
      const key = "accuqual/daily/accuqual-20260920T000000Z.tar.enc";
      store.put(key, src);
      expect(store.list("accuqual/daily/")).toEqual([key]);
      expect(store.size(key)).toBe(15);
      const back = path.join(dir, "back.bin");
      store.get(key, back);
      expect(fs.readFileSync(back, "utf8")).toBe("encrypted-bytes");
      store.remove(key);
      expect(store.list("accuqual/daily/")).toEqual([]);
      expect(store.list("accuqual/weekly/")).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to run with no storage configured, instead of silently backing up nowhere", () => {
    expect(() => makeStore({})).toThrow(/No storage configured/);
  });
});
