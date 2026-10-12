import { eq } from "drizzle-orm";
import { builtForms } from "../../drizzle/schema/builtForms.js";
import type { Db } from "../../lib/requestDb.js";
import { canFillBuiltForm } from "../form-builder/access.js";
import { formBuilderAccess } from "../form-builder/service.js";
import { engineeringAccess } from "../quality-engineering-report/livePull.js";
import { FORM_IMPORT_TEMPLATES, type FormImportTemplate } from "./formImport.templates.js";

export type TargetFieldType = "text" | "multiline" | "number" | "date" | "table" | "checkbox" | "yesno" | "dropdown";

export interface TargetField {
  key: string;
  label: string;
  group: string;
  type: TargetFieldType;
  columns?: { id: string; label: string }[];
  options?: string[];
  aliases?: string[];
}

export interface ImportTarget {
  ref: string;
  title: string;
  formNumber: string | null;
  revision: string | null;
}

interface TargetActor {
  id: number;
  roleName: string | null;
  department: string | null;
}

export async function listImportTargets(db: Db, actor: TargetActor): Promise<ImportTarget[]> {
  const access = await formBuilderAccess(db, actor);
  const targets: ImportTarget[] = [];
  if (canFillBuiltForm(access)) {
    const rows = await db.select().from(builtForms).where(eq(builtForms.status, "published"));
    for (const row of rows) {
      if (row.publishedStructure == null) continue;
      targets.push({ ref: `built:${row.id}`, title: row.title, formNumber: row.formNumber, revision: row.revision });
    }
  }
  for (const template of FORM_IMPORT_TEMPLATES) {
    targets.push({ ref: `frm:${template.key}`, title: template.title, formNumber: template.printedId, revision: "" });
  }
  const engineering = await engineeringAccess(db, actor);
  if (engineering.canRead) {
    targets.push({ ref: "report:monthly-quality", title: "Monthly Quality Report", formNumber: null, revision: null });
  }
  return targets;
}

interface FieldsStructure {
  kind: "fields";
  sections: { id: string; title: string }[];
  fields: {
    id: string;
    type: string;
    label: string;
    sectionId: string;
    columns?: { id: string; label: string }[];
    options?: string[];
  }[];
}

interface GridCellLike {
  value: string;
  locked: boolean;
}

interface GridStructure {
  kind: "grid";
  sheets: { name: string; cells: (GridCellLike | null)[][] }[];
}

interface DocumentStructure {
  kind: "document";
  html: string;
}

const SKIPPED_FIELD_TYPES = new Set(["signature", "photo", "folderPath"]);

function fieldType(type: string): TargetFieldType {
  if (type === "multiline" || type === "number" || type === "date" || type === "table" || type === "checkbox" || type === "yesno" || type === "dropdown") return type;
  return "text";
}

function fieldsFromFields(structure: FieldsStructure): TargetField[] {
  const sections = new Map(structure.sections.map((section) => [section.id, section.title]));
  const fields: TargetField[] = [];
  for (const field of structure.fields) {
    if (SKIPPED_FIELD_TYPES.has(field.type)) continue;
    fields.push({
      key: field.id,
      label: field.label,
      group: sections.get(field.sectionId) ?? "General",
      type: fieldType(field.type),
      columns: field.columns,
      options: field.options,
    });
  }
  return fields;
}

function columnLetter(col: number): string {
  let n = col;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function fieldsFromGrid(structure: GridStructure): TargetField[] {
  const fields: TargetField[] = [];
  structure.sheets.forEach((sheet, sheetIndex) => {
    sheet.cells.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (!cell || cell.locked) return;
        let label = "";
        for (let c = colIndex - 1; c >= 0; c -= 1) {
          const candidate = row[c];
          if (candidate && candidate.value.trim()) {
            label = candidate.value.trim();
            break;
          }
        }
        if (!label) {
          for (let r = rowIndex - 1; r >= 0; r -= 1) {
            const candidate = sheet.cells[r]?.[colIndex];
            if (candidate && candidate.value.trim()) {
              label = candidate.value.trim();
              break;
            }
          }
        }
        if (!label) return;
        const key = `${sheetIndex}!${columnLetter(colIndex + 1)}${rowIndex + 1}`;
        fields.push({ key, label, group: sheet.name, type: "text" });
      });
    });
  });
  return fields;
}

const INLINE_FIELD = /<span class="fb-inline-field"[^>]*data-fill-field="([^"]*)"[^>]*data-label="([^"]*)"/g;

function fieldsFromDocument(structure: DocumentStructure): TargetField[] {
  const fields: TargetField[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(INLINE_FIELD.source, "g");
  while ((match = pattern.exec(structure.html))) {
    const key = match[1] ?? "";
    const label = match[2] ?? "";
    if (!key || !label) continue;
    fields.push({ key, label, group: "Document", type: "text" });
  }
  return fields;
}

export function targetFields(structure: unknown): TargetField[] {
  if (!structure || typeof structure !== "object") return [];
  const kind = (structure as { kind?: unknown }).kind;
  if (kind === "fields") return fieldsFromFields(structure as FieldsStructure);
  if (kind === "grid") return fieldsFromGrid(structure as GridStructure);
  if (kind === "document") return fieldsFromDocument(structure as DocumentStructure);
  return [];
}

function frmValueType(valueType: FormImportTemplate["fields"][number]["valueType"]): TargetFieldType {
  if (valueType === "number") return "number";
  if (valueType === "date") return "date";
  if (valueType === "boolean") return "checkbox";
  return "text";
}

export function targetFieldsForFrm(template: FormImportTemplate): TargetField[] {
  return template.fields.map((field) => ({
    key: field.key,
    label: field.label,
    group: field.group,
    type: frmValueType(field.valueType),
    aliases: field.aliases,
  }));
}
