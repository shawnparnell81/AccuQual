import type { Request } from "express";
import { z } from "zod";
import type { Db } from "../../lib/requestDb.js";
import { recordAuditTrail, resolveUserNames } from "../audit-trail/audit-trail.service.js";
import { getFormLayout } from "../forms/layouts/index.js";
import type { FormLayout } from "../forms/layouts/types.js";

/** Stored on the filled record. Missing means Required Yes. */
export const SIGNATURE_REQUIRED_KEY = "_signatureRequired";

/** Printed and shown when a block is marked No and has no stamp. */
export const NOT_REQUIRED_LABEL = "Not required";

export type SignatureChoice = "yes" | "no";

/** Accepted on a filled record. Omitted means Required Yes. */
export const signatureRequiredField = z.record(z.string().min(1).max(80), z.enum(["yes", "no"])).optional();

export interface SignatureBlock {
  path: string;
  label: string;
}

export interface SignatureRequiredChange {
  path: string;
  label: string;
  from: SignatureChoice;
  to: SignatureChoice;
}

const pendingAudit = new WeakMap<Request, SignatureRequiredChange[]>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function showsRequiredControl(blockCount: number): boolean {
  return blockCount > 1;
}

export function layoutSignatureBlocks(layout: FormLayout): SignatureBlock[] {
  const blocks: SignatureBlock[] = [];
  for (const section of layout.sections) {
    for (const block of section.blocks) {
      if (block.type === "row") {
        for (const field of block.fields) {
          if (field.kind === "signature") blocks.push({ path: field.name, label: field.label.replace(/:$/, "").trim() });
        }
        continue;
      }
      if (block.type !== "table") continue;
      const columns = block.columns.filter((column) => column.kind === "signature");
      if (columns.length === 0) continue;
      const rows = block.fixedRowLabels ?? [];
      if (rows.length === 0) {
        for (const column of columns) blocks.push({ path: `${block.name}.0.${column.key}`, label: column.label.replace(/:$/, "").trim() });
        continue;
      }
      rows.forEach((row, index) => {
        for (const column of columns) {
          blocks.push({ path: `${block.name}.${index}.${column.key}`, label: `${row} ${column.label}`.replace(/:$/, "").trim() });
        }
      });
    }
  }
  return blocks;
}

/**
 * Signature blocks the app already renders. A form with one block is listed
 * so callers can see it does not get the Required control. Sales feasibility
 * is stored and not rendered, so it is not here. Approve and reject on a
 * first article write one quality signature. CSA and fuel-pump workflow
 * decisions write one stamp.
 */
export const RECORD_SIGNATURE_BLOCKS: Record<string, SignatureBlock[]> = {
  "iso:audit_summary": [
    { path: "leadAuditorSignature", label: "Lead auditor signature" },
    { path: "managementSignature", label: "Management signature" },
    { path: "auditeeSignature1", label: "Auditee signature 1" },
    { path: "auditeeSignature2", label: "Auditee signature 2" },
    { path: "auditeeSignature3", label: "Auditee signature 3" },
    { path: "auditeeSignature4", label: "Auditee signature 4" },
  ],
  "iso:salt_spray": [
    { path: "testedSignature", label: "Tested by signature" },
    { path: "approvedSignature", label: "Approved by signature" },
  ],
  "iso:prototype_strut": [{ path: "engineeringSignoffSignature", label: "Engineering sign-off" }],
  "iso:scar_request": [{ path: "managerSignature", label: "Manager signature" }],
  "iso:engineering_change": [
    { path: "managerSignature", label: "Engineering or quality manager signature" },
    { path: "supplierRepSignature", label: "Supplier representative signature" },
  ],
  "iso:drawing_change": [
    { path: "managerSignature", label: "Engineering or quality manager signature" },
    { path: "supplierRepSignature", label: "Supplier representative signature" },
  ],
  "iso:process_change": [
    { path: "managerSignature", label: "Engineering or quality manager signature" },
    { path: "supplierRepSignature", label: "Supplier representative signature" },
  ],
  "iso:document_change": [
    { path: "managerSignature", label: "Engineering or quality manager signature" },
    { path: "supplierRepSignature", label: "Supplier representative signature" },
  ],
  "validation:fuel_injector": [
    { path: "authorizedSignature", label: "Authorized signature" },
    { path: "furtherSignature", label: "Further review signature" },
  ],
  "validation:brake_wear": [
    { path: "authorizedSignature", label: "Authorized signature" },
    { path: "furtherSignature", label: "Further review signature" },
  ],
  "validation:gas_lift": [
    { path: "authorizedSignature", label: "Authorized signature" },
    { path: "furtherSignature", label: "Further review signature" },
  ],
  "validation:air_strut": [{ path: "authorizedSignature", label: "Authorized signature" }],
  "validation:air_spring": [{ path: "authorizedSignature", label: "Authorized signature" }],
  "validation:air_compressor": [{ path: "authorizedSignature", label: "Authorized signature" }],
  "validation:electric_lift": [{ path: "authorizedSignature", label: "Authorized signature" }],
  "validation:coil_spring": [{ path: "authorizedSignature", label: "Authorized signature" }],
  scar: [
    { path: "supplierRepSignature", label: "Supplier representative signature" },
    { path: "qualityEngineerSignature", label: "Quality engineer signature" },
  ],
  quality_inspection: [
    { path: "inspectorSignature", label: "Inspector signature" },
    { path: "qaLeadSignature", label: "QA lead signature" },
  ],
  dcr: [
    { path: "requesterApprovalSignature", label: "Requester approval signature" },
    { path: "vpApprovalSignature", label: "VP of Engineering and Quality Assurance signature" },
  ],
  crar: [
    { path: "preparedSignature", label: "Prepared by signature" },
    { path: "approvedSignature", label: "Approved by signature" },
  ],
  feasibility: [
    { path: "engineeringSignoffSignature", label: "Engineering signature" },
    { path: "qualitySignoffSignature", label: "Quality assurance signature" },
    { path: "manufacturingSignoffSignature", label: "Manufacturing signature" },
    { path: "purchasingSignoffSignature", label: "Supply chain signature" },
  ],
  work_order: [
    { path: "operatorSignature", label: "Operator signature" },
    { path: "inspectorSignature", label: "Inspector signature" },
  ],
};

export function signatureBlocksFor(key: string): SignatureBlock[] {
  if (key.startsWith("form:")) {
    const layout = getFormLayout(key.slice("form:".length));
    return layout ? layoutSignatureBlocks(layout) : [];
  }
  return RECORD_SIGNATURE_BLOCKS[key] ?? [];
}

export function readRequiredMap(source: unknown): Record<string, SignatureChoice> {
  if (!isRecord(source)) return {};
  if (SIGNATURE_REQUIRED_KEY in source) return normalizeRequiredMap(source[SIGNATURE_REQUIRED_KEY]);
  if ("signatureRequired" in source) return normalizeRequiredMap(source.signatureRequired);
  return {};
}

export function normalizeRequiredMap(raw: unknown): Record<string, SignatureChoice> {
  if (!isRecord(raw)) return {};
  const out: Record<string, SignatureChoice> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== "string" || key.length === 0 || key.length > 80) continue;
    if (value === "no" || value === "No") out[key] = "no";
    else if (value === "yes" || value === "Yes") out[key] = "yes";
  }
  return out;
}

function pathAllowed(path: string, blocks: SignatureBlock[], allowPath?: (path: string) => boolean): boolean {
  return blocks.some((block) => block.path === path) || allowPath?.(path) === true;
}

/** A single-signature form ignores a stored No. An unknown path stays required. */
export function signatureRequired(source: unknown, path: string, blocks: SignatureBlock[], allowPath?: (path: string) => boolean): boolean {
  if (!showsRequiredControl(blocks.length) && !allowPath?.(path)) return true;
  if (!pathAllowed(path, blocks, allowPath)) return true;
  return readRequiredMap(source)[path] !== "no";
}

export function signaturePdfValue(source: unknown, path: string, value: unknown, blocks?: SignatureBlock[], allowPath?: (path: string) => boolean): string {
  const text = typeof value === "string" ? value.trim() : value == null || value === "" ? "" : String(value).trim();
  if (text) return text;
  if (readRequiredMap(source)[path] !== "no") return "";
  if (blocks && signatureRequired(source, path, blocks, allowPath)) return "";
  return NOT_REQUIRED_LABEL;
}

export function sanitizeRequiredMap(raw: unknown, blocks: SignatureBlock[], allowPath?: (path: string) => boolean): Record<string, SignatureChoice> {
  if (!showsRequiredControl(blocks.length) && !allowPath) return {};
  const out: Record<string, SignatureChoice> = {};
  for (const [path, choice] of Object.entries(normalizeRequiredMap(raw))) {
    if (pathAllowed(path, blocks, allowPath)) out[path] = choice;
  }
  return out;
}

/** Keeps the choice inside the filled JSON. Drops it on a one-signature form. */
export function withSanitizedRequired(data: Record<string, unknown>, blocks: SignatureBlock[], allowPath?: (path: string) => boolean): Record<string, unknown> {
  const map = sanitizeRequiredMap(data[SIGNATURE_REQUIRED_KEY], blocks, allowPath);
  const had = SIGNATURE_REQUIRED_KEY in data;
  if (!showsRequiredControl(blocks.length) && !allowPath) {
    if (!had) return data;
    const next = { ...data };
    delete next[SIGNATURE_REQUIRED_KEY];
    return next;
  }
  if (!had && Object.keys(map).length === 0) return data;
  return { ...data, [SIGNATURE_REQUIRED_KEY]: map };
}

/** Merges a column patch into the stored map. A partial patch keeps the other blocks. */
export function mergeSignatureRequiredColumn(
  previous: unknown,
  incoming: unknown,
  blocks: SignatureBlock[],
  allowPath?: (path: string) => boolean,
): { map: Record<string, SignatureChoice>; changes: SignatureRequiredChange[] } {
  const merged = readRequiredMap(previous);
  for (const [path, choice] of Object.entries(normalizeRequiredMap(incoming))) {
    if (pathAllowed(path, blocks, allowPath)) merged[path] = choice;
  }
  const map = sanitizeRequiredMap(merged, blocks, allowPath);
  return { map, changes: diffSignatureRequired(previous, { signatureRequired: map }, blocks, allowPath) };
}

/** Writes the column when the request includes it, and records a real change. */
export async function assignSignatureRequired(
  db: Db,
  input: {
    entityType: string;
    entityId: number;
    performedBy?: number;
    previous: unknown;
    body: Record<string, unknown>;
    blocks: SignatureBlock[];
    allowPath?: (path: string) => boolean;
  },
): Promise<void> {
  if (!("signatureRequired" in input.body)) return;
  const { map, changes } = mergeSignatureRequiredColumn(input.previous, input.body.signatureRequired, input.blocks, input.allowPath);
  input.body.signatureRequired = map;
  await writeSignatureRequiredAudit(db, {
    entityType: input.entityType,
    entityId: input.entityId,
    performedBy: input.performedBy,
    changes,
  });
}

export function workOrderSignaturePath(path: string): boolean {
  return /^op:\d+$/.test(path);
}

export function choiceOf(source: unknown, path: string): SignatureChoice {
  return readRequiredMap(source)[path] === "no" ? "no" : "yes";
}

export function diffSignatureRequired(previous: unknown, next: unknown, blocks: SignatureBlock[], allowPath?: (path: string) => boolean): SignatureRequiredChange[] {
  const before = readRequiredMap(previous);
  const after = readRequiredMap(next);
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: SignatureRequiredChange[] = [];
  for (const path of paths) {
    if (!pathAllowed(path, blocks, allowPath)) continue;
    const from: SignatureChoice = before[path] === "no" ? "no" : "yes";
    const to: SignatureChoice = after[path] === "no" ? "no" : "yes";
    if (from === to) continue;
    const known = blocks.find((block) => block.path === path);
    changes.push({ path, label: known?.label ?? path, from, to });
  }
  return changes;
}

export function describeSignatureRequired(label: string, to: SignatureChoice): string {
  return to === "no" ? `Marked ${label} as not required.` : `Marked ${label} as required.`;
}

export function rememberSignatureRequiredAudit(req: Request, changes: SignatureRequiredChange[]): void {
  if (changes.length === 0) return;
  const existing = pendingAudit.get(req) ?? [];
  pendingAudit.set(req, [...existing, ...changes]);
}

export async function flushSignatureRequiredAudit(req: Request, entityType: string, entityId: number): Promise<void> {
  const changes = pendingAudit.get(req) ?? [];
  pendingAudit.delete(req);
  if (!req.db || changes.length === 0 || !Number.isInteger(entityId) || entityId < 1) return;
  await writeSignatureRequiredAudit(req.db, { entityType, entityId, performedBy: req.user?.id, changes });
}

export async function writeSignatureRequiredAudit(
  db: Db,
  input: { entityType: string; entityId: number; performedBy?: number; changes: SignatureRequiredChange[] },
): Promise<void> {
  if (input.changes.length === 0) return;
  const names = await resolveUserNames(db, [input.performedBy]);
  const who = input.performedBy ? names.get(input.performedBy) ?? "Unknown" : "System";
  const when = new Date().toISOString();
  for (const change of input.changes) {
    await recordAuditTrail(db, {
      entityType: input.entityType,
      entityId: input.entityId,
      action: "update",
      changes: {
        action: "signature_required",
        who,
        what: change.label,
        when,
        description: describeSignatureRequired(change.label, change.to),
        field: change.path,
        from: change.from,
        to: change.to,
      },
      performedBy: input.performedBy,
    });
  }
}
