/**
 * Prints a form's layout one row at a time: each cell with its kind (the app's reading of it), text or formula, and merges. Use it
 * to see what a form looks like as data before writing its module.
 *
 *   npx tsx scripts/dump-validation-layout.ts <type>        e.g. shock, electric_lift
 */
import { REGISTRY } from "../src/lib/validation-forms/registry.ts";
import { columnLetters, parseAddr } from "../src/lib/validation-forms/engine.ts";

const type = process.argv[2];
const module = type ? REGISTRY[type] : undefined;
if (!module) {
  console.error(`Usage: npx tsx scripts/dump-validation-layout.ts <type>\nTypes: ${Object.keys(REGISTRY).join(", ")}`);
  process.exit(1);
}
const { layout } = module.def;
console.log(`${module.def.docId} Rev ${module.def.revision}  sheet "${layout.sheet}"  ${columnLetters(layout.maxCol)}${layout.maxRow}`);
console.log(`columns: ${layout.cols.map((w, i) => `${columnLetters(i + 1)}=${w.toFixed(1)}`).join(" ")}`);
console.log(`merges: ${layout.merges.join(" ")}`);
const rows = new Map<number, string[]>();
for (const [at, cell] of Object.entries(layout.cells)) {
  const pos = parseAddr(at)!;
  const kind = module.kinds[at];
  if (!kind || kind === "spacer") continue;
  const text = module.formulas[at] != null ? `=${module.formulas[at]}` : cell.v != null ? JSON.stringify(cell.v) : "";
  const list = layout.lists[at] ? ` {${layout.lists[at]!.join("|")}}` : "";
  const entry = `${at}[${kind}]${text ? ` ${text}` : ""}${list}`;
  rows.set(pos.row, [...(rows.get(pos.row) ?? []), entry]);
}
for (const row of [...rows.keys()].sort((a, b) => a - b)) console.log(`${row}: ${rows.get(row)!.join("  |  ")}`);
