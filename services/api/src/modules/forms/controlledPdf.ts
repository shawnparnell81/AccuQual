import { createHash, randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Chrome shared by every controlled PDF: logo stays with the form renderer,
 * and this module owns the footer, watermark, page numbers, and export identity.
 * Classification and watermark text come only from a status the record already has.
 */

export interface ApprovalLine {
  name: string;
  role: string;
  action: string;
  at: string;
  status: string;
}

export interface AuditLine {
  who: string;
  action: string;
  at: string;
  reason: string;
}

export interface AttachmentLine {
  name: string;
  type: string;
  size: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface ControlledPdfFrame {
  sourceModule: string;
  recordNumber: string;
  revision: string;
  generatedAt: Date;
  generatedBy: string;
  exportId: string;
  status?: string | null;
  formNumber?: string | null;
  approvals?: ApprovalLine[];
  audit?: AuditLine[];
  attachments?: AttachmentLine[];
}

const WATERMARKS: Record<string, string> = {
  draft: "DRAFT",
  obsolete: "OBSOLETE",
  superseded: "SUPERSEDED",
  uncontrolled: "UNCONTROLLED COPY",
  "uncontrolled copy": "UNCONTROLLED COPY",
};

export function watermarkForStatus(status: string | null | undefined): string | null {
  const key = (status ?? "").trim().toLowerCase();
  return WATERMARKS[key] ?? null;
}

export function classificationForStatus(status: string | null | undefined): string {
  return watermarkForStatus(status) ?? "";
}

export function newExportId(): string {
  return `exp_${randomUUID()}`;
}

export function emptyFrame(partial: Partial<ControlledPdfFrame> & Pick<ControlledPdfFrame, "sourceModule" | "generatedBy">): ControlledPdfFrame {
  return {
    sourceModule: partial.sourceModule,
    recordNumber: partial.recordNumber ?? "",
    revision: partial.revision ?? "",
    generatedAt: partial.generatedAt ?? new Date(),
    generatedBy: partial.generatedBy,
    exportId: partial.exportId ?? newExportId(),
    status: partial.status ?? null,
    formNumber: partial.formNumber ?? null,
    approvals: partial.approvals ?? [],
    audit: partial.audit ?? [],
    attachments: partial.attachments ?? [],
  };
}

export function exportTrace(bytes: Uint8Array, frame: ControlledPdfFrame) {
  return {
    exportId: frame.exportId,
    sourceModule: frame.sourceModule,
    recordNumber: frame.recordNumber,
    revision: frame.revision,
    generatedAt: frame.generatedAt.toISOString(),
    generatedBy: frame.generatedBy,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
    mime: "application/pdf",
    renderer: "accuqual-form-layout",
  };
}

export function auditReason(changes: unknown): string {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return "";
  const record = changes as Record<string, unknown>;
  for (const key of ["reason", "note", "message", "rejection_reason"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() && !looksSensitive(value)) return value.trim().slice(0, 240);
  }
  return "";
}

function looksSensitive(value: string): boolean {
  return /password|token|secret|session|stack|\/attachments\/|Bearer /i.test(value);
}

export function approvalPhrase(status: string): string {
  return /^approv/i.test(status) ? "Electronically Approved" : status;
}

const FOOTER = 36;

export function drawWatermark(page: PDFPage, font: PDFFont, text: string | null) {
  if (!text) return;
  const width = page.getWidth();
  const height = page.getHeight();
  page.drawText(text, {
    x: width * 0.18,
    y: height * 0.42,
    size: Math.min(42, width / (text.length * 0.55)),
    font,
    color: rgb(0.78, 0.78, 0.78),
    rotate: degrees(32),
  });
}

export function drawRunningHeader(page: PDFPage, font: PDFFont, bold: PDFFont, frame: ControlledPdfFrame) {
  const width = page.getWidth();
  const top = page.getHeight() - 28;
  const title = [frame.formNumber, frame.sourceModule, frame.recordNumber].filter(Boolean).join("  ·  ");
  page.drawText(clip(title || frame.sourceModule, 90), { x: 40, y: top, size: 9, font: bold, color: rgb(0.11, 0.23, 0.36) });
  const status = frame.status?.trim();
  if (status) page.drawText(clip(status, 24), { x: width - 120, y: top, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawLine({ start: { x: 40, y: top - 6 }, end: { x: width - 40, y: top - 6 }, thickness: 0.4, color: rgb(0.7, 0.75, 0.8) });
}

export function stampFooters(doc: PDFDocument, font: PDFFont, frame: ControlledPdfFrame) {
  const pages = doc.getPages();
  const total = pages.length;
  const classification = classificationForStatus(frame.status);
  const when = frame.generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  pages.forEach((page, index) => {
    const width = page.getWidth();
    const y = 22;
    page.drawLine({ start: { x: 40, y: 34 }, end: { x: width - 40, y: 34 }, thickness: 0.4, color: rgb(0.7, 0.75, 0.8) });
    const left = [frame.recordNumber, frame.revision ? `Rev ${frame.revision}` : "", classification].filter(Boolean).join("   ");
    page.drawText(clip(left, 70), { x: 40, y, size: 8, font, color: rgb(0.25, 0.25, 0.25) });
    const right = `${when}   ${clip(frame.generatedBy, 28)}   ${frame.exportId}   ${index + 1} of ${total}`;
    const size = 8;
    const textWidth = font.widthOfTextAtSize(right, size);
    page.drawText(right, { x: Math.max(40, width - 40 - textWidth), y, size, font, color: rgb(0.25, 0.25, 0.25) });
  });
}

export function applyPdfIdentity(doc: PDFDocument, frame: ControlledPdfFrame) {
  const title = [frame.sourceModule, frame.recordNumber].filter(Boolean).join(" ");
  doc.setTitle(title || frame.sourceModule);
  doc.setAuthor(frame.generatedBy);
  doc.setSubject(frame.sourceModule);
  doc.setKeywords([frame.recordNumber, frame.revision ? `Rev ${frame.revision}` : "", frame.exportId].filter(Boolean));
  doc.setCreator("AccuQual");
  doc.setProducer("AccuQual");
  doc.setCreationDate(frame.generatedAt);
  doc.setModificationDate(frame.generatedAt);
}

export function headerClearance(frame: ControlledPdfFrame | null): number {
  return frame ? 64 : 40;
}

export function footerClearance(frame: ControlledPdfFrame | null): number {
  return frame ? 40 + FOOTER : 40;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3)}...`;
}

function decodeHexPdfString(hex: string): string {
  const digits = hex.replace(/\s+/g, "");
  if (digits.length < 2 || digits.length % 2 !== 0) return "";
  let out = "";
  for (let i = 0; i < digits.length; i += 2) {
    const code = Number.parseInt(digits.slice(i, i + 2), 16);
    out += code >= 32 && code <= 126 ? String.fromCharCode(code) : " ";
  }
  return out.trim();
}

function decodeLiteralPdfString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (next) out += next;
    i += 1;
  }
  return out.trim();
}

/** Drawn strings from page content. Image streams are skipped so logo bytes are not treated as text. */
function textFromContentStream(content: string): string {
  if (!/\/[A-Za-z0-9-]+\s+[\d.]+\s+Tf/.test(content) || !/\bTj\b|\bTJ\b/.test(content)) return "";
  const parts: string[] = [];
  for (const match of content.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
    const decoded = decodeHexPdfString(match[1] ?? "");
    if (decoded) parts.push(decoded);
  }
  for (const match of content.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
    const decoded = decodeLiteralPdfString(match[0].slice(1, -1));
    if (decoded) parts.push(decoded);
  }
  return parts.join("\n");
}

/** Pulls drawn text out of a finished PDF so tests can see entered values. */
export async function pdfVisibleText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of("Subtype"));
    if (subtype instanceof PDFName && subtype.asString() === "/Image") continue;
    const filter = obj.dict.get(PDFName.of("Filter"));
    const raw = obj.getContents();
    let decoded = raw;
    const filterName = filter instanceof PDFName ? filter.asString() : "";
    if (filterName === "/FlateDecode") {
      try {
        decoded = inflateSync(Buffer.from(raw));
      } catch {
        decoded = raw;
      }
    }
    const text = textFromContentStream(Buffer.from(decoded).toString("latin1"));
    if (text) parts.push(text);
  }
  return parts.join("\n");
}
