import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dockerfile = readFileSync(join(repoRoot, "apps/web/Dockerfile"), "utf8");

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

function specifiers(source: string): string[] {
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!);
}

function resolveModule(fromFile: string, spec: string): string | null {
  const base = spec.startsWith(".")
    ? resolve(dirname(fromFile), spec)
    : spec.includes("services/api/")
      ? join(repoRoot, spec.slice(spec.indexOf("services/api/")))
      : null;
  if (!base) return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx")];
  return (
    candidates.find((candidate) => {
      try {
        return statSync(candidate).isFile();
      } catch {
        return false;
      }
    }) ?? null
  );
}

describe("web image shared modules", () => {
  it("copies every API file the web build imports, including what those files import", () => {
    const pending = walk(join(repoRoot, "apps/web/src"));
    const shared = new Set<string>();
    const seen = new Set<string>();
    while (pending.length > 0) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const repoPath = relative(repoRoot, file);
      if (repoPath.startsWith("services/api/")) shared.add(repoPath);
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        const next = resolveModule(file, spec);
        if (next && relative(repoRoot, next).startsWith("services/api/")) pending.push(next);
      }
    }
    assert.ok(shared.has("services/api/src/utils/passFail.ts"));
    assert.ok(shared.has("services/api/src/modules/fai/fai.logic.ts"));
    assert.ok(shared.has("services/api/src/modules/roles/roleAccess.ts"));
    for (const file of shared) {
      const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(dockerfile, new RegExp(`COPY ${escaped} `), `${file} is imported by the web build and must be copied into apps/web/Dockerfile`);
    }
  });
});
