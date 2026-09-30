import { createHash } from "node:crypto";
import { BLANK_8D_BOOL_KEYS, BLANK_8D_LABELS, BLANK_8D_STRING_KEYS, BLANK_8D_TITLE } from "../eight-d/blank8dForm.js";
import { createChangeItemSchema, createReviewSchema, updateDocumentChangeRequestSchema } from "../document-change-requests/documentChangeRequests.validation.js";
import { updateFeasibilitySchema, updateSignoffSchema } from "../feasibility/feasibility.validation.js";
import { getQmsFormDefinition, QMS_FORM_DEFINITIONS, type QmsFormDefinition } from "../qms-forms/qmsFormDefinitions.js";
import { FORM_TYPES } from "./forms.validation.js";
import { FORM_LAYOUTS, getFormLayout } from "./layouts/index.js";
import type { Block, FormLayout, TableColumn } from "./layouts/types.js";

/** Stored on a filled instance. Answer saves must not replace it. */
export const TEMPLATE_STAMP_KEY = "_formTemplate";

export interface TemplateStamp {
  version: number;
  revision: string;
  structureHash: string;
}

/**
 * Forms whose master definition lives in the web sheet, not in an API layout.
 * The letter is the published template revision. The web structure test is what
 * forces that letter to move when the sheet changes.
 */
export const FIXED_TEMPLATE_REVISIONS: Record<string, { version: number; revision: string }> = {
  "iso:internal_audit": { version: 1, revision: "A" },
  "iso:ncr_report": { version: 3, revision: "C" },
  "iso:quarantine_notice": { version: 1, revision: "A" },
  "iso:concession": { version: 1, revision: "A" },
  "iso:competency_training": { version: 1, revision: "A" },
  "iso:cross_training": { version: 1, revision: "A" },
  "iso:psw": { version: 1, revision: "A" },
  "iso:turtle_diagram": { version: 1, revision: "A" },
  "iso:quality_alert": { version: 1, revision: "A" },
  "iso:first_article": { version: 1, revision: "A" },
  "iso:customer_scorecard": { version: 1, revision: "A" },
  "iso:failure_effectiveness": { version: 1, revision: "A" },
  "validation:csa": { version: 3, revision: "C" },
  "validation:fuel_pump": { version: 3, revision: "C" },
  "validation:air_strut": { version: 1, revision: "A" },
  "validation:air_spring": { version: 1, revision: "A" },
  "validation:fuel_injector": { version: 1, revision: "B" },
  "validation:brake_wear": { version: 1, revision: "A" },
  "iso:audit_summary": { version: 1, revision: "A" },
  "iso:visitor_log": { version: 1, revision: "A" },
  "iso:monthly_engineering": { version: 1, revision: "A" },
};

export function structureHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function columnShape(column: TableColumn) {
  return {
    key: column.key,
    kind: column.kind,
    formula: column.formula ?? null,
    options: column.options ?? null,
    min: column.min ?? null,
    max: column.max ?? null,
  };
}

function blockShape(block: Block): unknown {
  if (block.type === "row") {
    return {
      type: "row",
      fields: block.fields.map((field) => ({ kind: field.kind, name: field.name, options: field.options ?? null })),
    };
  }
  if (block.type === "textarea" || block.type === "yesno") return { type: block.type, name: block.name };
  return {
    type: "table",
    name: block.name,
    addableRows: block.addableRows === true,
    minRows: block.minRows ?? null,
    fixedRowLabels: block.fixedRowLabels ?? null,
    columns: block.columns.map(columnShape),
  };
}

export function layoutStructure(layout: FormLayout) {
  return {
    formType: layout.formType,
    title: layout.title,
    sections: layout.sections.map((section) => ({
      number: section.number,
      title: section.title,
      blocks: section.blocks.map(blockShape),
    })),
  };
}

function qmsStructure(definition: QmsFormDefinition) {
  return {
    formType: definition.formType,
    title: definition.title,
    subtitle: definition.subtitle,
    sections: definition.sections.map((section) => ({
      key: section.key,
      label: section.label,
      columns: section.columns.map((column) => ({ key: column.key, label: column.label })),
    })),
  };
}

function eightDStructure() {
  return {
    formType: "eight_d",
    title: BLANK_8D_TITLE,
    labels: BLANK_8D_LABELS,
    fields: [...BLANK_8D_STRING_KEYS],
    checks: [...BLANK_8D_BOOL_KEYS],
  };
}

function sortedKeys(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape).sort();
}

function feasibilityStructure() {
  return {
    form: "feasibility",
    title: "Contract & Project Feasibility Review",
    fields: sortedKeys(updateFeasibilitySchema),
    signoff: sortedKeys(updateSignoffSchema),
  };
}

function dcrStructure() {
  return {
    form: "dcr",
    title: "Document Change Request",
    header: sortedKeys(updateDocumentChangeRequestSchema),
    items: sortedKeys(createChangeItemSchema),
    reviews: sortedKeys(createReviewSchema),
  };
}

/** Every API-owned master whose hash must match the recorded catalog. */
export function hashedTemplateKeys(): string[] {
  const formTypes = new Set<string>(FORM_TYPES);
  for (const formType of Object.keys(FORM_LAYOUTS)) formTypes.add(formType);
  const keys = [...formTypes].sort().map((formType) => `form:${formType}`);
  for (const definition of QMS_FORM_DEFINITIONS) keys.push(`qms:${definition.formType}`);
  keys.push("dcr", "feasibility");
  return keys;
}

export function liveStructureHash(key: string): string {
  if (key.startsWith("form:")) {
    const formType = key.slice("form:".length);
    const layout = getFormLayout(formType);
    if (layout) return structureHash(layoutStructure(layout));
    if (formType === "eight_d") return structureHash(eightDStructure());
    return structureHash({ formType, sections: [] as unknown[] });
  }
  if (key.startsWith("qms:")) {
    const definition = getQmsFormDefinition(key.slice("qms:".length));
    if (!definition) throw new Error(`No QMS form definition for ${key}`);
    return structureHash(qmsStructure(definition));
  }
  if (key === "feasibility") return structureHash(feasibilityStructure());
  if (key === "dcr") return structureHash(dcrStructure());
  throw new Error(`No structure hash for ${key}`);
}

export function formTemplateKeys(): string[] {
  return [...hashedTemplateKeys(), ...Object.keys(FIXED_TEMPLATE_REVISIONS)].sort();
}

/** Next revision after a real structure change. The same hash keeps the current revision. */
export function bumpRevision(current: TemplateStamp, structureHashValue: string): TemplateStamp {
  if (current.structureHash === structureHashValue) return { ...current, structureHash: structureHashValue };
  return { version: current.version + 1, revision: nextRevision(current.revision), structureHash: structureHashValue };
}

export function nextRevision(revision: string): string {
  const text = revision.trim();
  if (/^[A-Z]+$/i.test(text)) return lettersFromRank(rankFromLetters(text.toUpperCase()) + 1);
  const dotted = /^(\d+)\.(\d+)$/.exec(text);
  if (dotted) return `${dotted[1]}.${Number(dotted[2]) + 1}`;
  const trailing = /^(.*?)(\d+)$/.exec(text);
  if (trailing?.[1] !== undefined && trailing[2] !== undefined) return `${trailing[1]}${Number(trailing[2]) + 1}`;
  return "B";
}

function rankFromLetters(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function lettersFromRank(n: number): string {
  let out = "";
  let x = Math.max(1, n);
  while (x > 0) {
    const r = (x - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}
