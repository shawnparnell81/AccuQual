// tsc emits JavaScript only. The Quality / Engineering sample CSV is read at
// runtime from beside the compiled service (service.ts samplePath). Render
// runs dist/, so leave the file out and Download sample CSV 500s.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fileName = "quality-engineering-supplier-august-2026.csv";
const fromDir = join(apiRoot, "src/modules/quality-engineering-report/sample");
const fromFile = join(fromDir, fileName);
if (!existsSync(fromFile)) {
  console.error(`Quality engineering sample CSV is missing: ${fromFile}`);
  process.exit(1);
}

const toDir = join(apiRoot, "dist/modules/quality-engineering-report/sample");
rmSync(toDir, { recursive: true, force: true });
mkdirSync(dirname(toDir), { recursive: true });
cpSync(fromDir, toDir, { recursive: true });
