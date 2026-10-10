import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ignorableApiKey, keyOnFileSentence } from "../src/modules/company/aiConfigKey.js";

const src = join(dirname(fileURLToPath(import.meta.url)), "../src");

describe("which client values must not replace a stored AI key", () => {
  it.each([undefined, null, "", "   ", "••••", "••••ABCD", "****ABCD", "[redacted]", "REDACTED", "Leave blank to keep the current key", "sk-…"])(
    "ignores %j",
    (value) => {
      expect(ignorableApiKey(value)).toBe(true);
    },
  );

  it("keeps a real provider key as a new value", () => {
    expect(ignorableApiKey("sk-ant-api03-test-key-ABCD")).toBe(false);
  });
});

describe("key on file sentence", () => {
  it("names who saved it and the UTC date", () => {
    expect(keyOnFileSentence("ABCD", "Pat Admin", new Date("2026-01-15T12:00:00.000Z"))).toBe(
      "Key on file (ends in …ABCD), saved by Pat Admin on Jan 15, 2026",
    );
  });

  it("omits the byline when the save was never recorded", () => {
    expect(keyOnFileSentence("ABCD", null, null)).toBe("Key on file (ends in …ABCD)");
  });
});

describe("nothing in the repo resets company.ai_config", () => {
  function sqlFiles(dir: string): string[] {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => join(dir, name));
  }

  it("migrations and post-migrate scripts never assign ai_config", () => {
    const files = [...sqlFiles(join(src, "drizzle/migrations")), ...sqlFiles(join(src, "drizzle/post-migrate"))];
    const assignments = files.filter((file) => /ai_config\s*=/i.test(readFileSync(file, "utf8")));
    expect(assignments).toEqual([]);
  });

  it("seed and company bootstrap do not write an AI key", () => {
    for (const file of ["db/seed.ts", "db/provisionCompany.ts", "db/seedDemoStory.ts"]) {
      const text = readFileSync(join(src, file), "utf8");
      expect(text, file).not.toMatch(/ai_config|aiConfig/);
    }
  });
});
