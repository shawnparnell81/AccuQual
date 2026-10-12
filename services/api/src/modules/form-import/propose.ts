import { matchScore } from "./formImport.match.js";
import type { ExtractedBlock, ExtractedFile } from "./extract.js";
import type { TargetField } from "./targets.js";

export interface Proposal {
  key: string;
  label: string;
  value: string | string[][] | null;
  source: string | null;
  score: number;
  reason: string;
}

const THRESHOLD = 0.8;
const LABEL_LINE = /^\s*([^:]{2,80}):\s*(.+)$/;

function scoreAgainst(text: string, field: Pick<TargetField, "key" | "label" | "aliases">): number {
  return matchScore(text, { key: field.key, label: field.label, group: "", aliases: field.aliases ?? [], valueType: "text" });
}

function stripLeadingNumber(text: string): string {
  return text.replace(/^\s*\d+(?:\.\d+)*\s*[-–—:.]?\s*/, "").trim();
}

interface ParaLine {
  text: string;
  section: string | null;
}

function paraLines(file: ExtractedFile): ParaLine[] {
  const lines: ParaLine[] = [];
  for (const block of file.blocks) {
    if (block.kind !== "para") continue;
    for (const line of block.text.split("\n")) {
      if (line.trim()) lines.push({ text: line.trim(), section: block.section });
    }
  }
  return lines;
}

function sourceFor(section: string | null, snippet: string): string {
  return section ? `${section} > '${snippet}'` : `'${snippet}'`;
}

export function proposeValues(file: ExtractedFile, fields: TargetField[]): Proposal[] {
  const lines = paraLines(file);
  const usedLines = new Set<number>();
  const headings = file.blocks.filter((block): block is Extract<ExtractedBlock, { kind: "heading" }> => block.kind === "heading");
  const usedHeadings = new Set<number>();
  const tables = file.blocks.filter((block): block is Extract<ExtractedBlock, { kind: "table" }> => block.kind === "table");
  const usedTables = new Set<number>();

  function tryLabelValue(field: TargetField): Proposal | null {
    let best: { index: number; label: string; value: string; score: number } | null = null;
    lines.forEach((line, index) => {
      if (usedLines.has(index)) return;
      const match = LABEL_LINE.exec(line.text);
      if (!match) return;
      const score = scoreAgainst(match[1]!.trim(), field);
      if (score < THRESHOLD) return;
      if (!best || score > best.score) best = { index, label: match[1]!.trim(), value: match[2]!.trim(), score };
    });
    if (!best) return null;
    const chosen = best as { index: number; label: string; value: string; score: number };
    usedLines.add(chosen.index);
    return {
      key: field.key,
      label: field.label,
      value: chosen.value,
      source: sourceFor(lines[chosen.index]!.section, `${chosen.label}:`),
      score: chosen.score,
      reason: "Label match",
    };
  }

  function tryHeadingSection(field: TargetField): Proposal | null {
    let best: { index: number; score: number } | null = null;
    headings.forEach((heading, index) => {
      if (usedHeadings.has(index)) return;
      const score = scoreAgainst(stripLeadingNumber(heading.text), field);
      if (score < THRESHOLD) return;
      if (!best || score > best.score) best = { index, score };
    });
    if (!best) return null;
    const chosen = best as { index: number; score: number };
    const heading = headings[chosen.index]!;
    usedHeadings.add(chosen.index);
    const underHeading = file.blocks.filter((block): block is Extract<ExtractedBlock, { kind: "para" }> => block.kind === "para" && block.section === heading.text);
    const value = underHeading.map((block) => block.text).join("\n\n");
    return { key: field.key, label: field.label, value: value || null, source: heading.text, score: chosen.score, reason: "Heading match" };
  }

  function tryTableRow(field: TargetField): Proposal | null {
    let best: { tableIndex: number; rowLabel: string; colLabel: string; value: string; score: number } | null = null;
    tables.forEach((table, tableIndex) => {
      if (usedTables.has(tableIndex)) return;
      const header = table.rows[0] ?? [];
      table.rows.slice(1).forEach((row) => {
        const rowLabel = (row[0] ?? "").trim();
        if (!rowLabel) return;
        const score = scoreAgainst(rowLabel, field);
        if (score < THRESHOLD) return;
        let colIndex = row.length - 1;
        while (colIndex > 0 && !(row[colIndex] ?? "").trim()) colIndex -= 1;
        const value = (row[colIndex] ?? "").trim();
        if (!value) return;
        if (!best || score > best.score) {
          best = { tableIndex, rowLabel, colLabel: header[colIndex] ?? `column ${colIndex + 1}`, value, score };
        }
      });
    });
    if (!best) return null;
    const chosen = best as { tableIndex: number; rowLabel: string; colLabel: string; value: string; score: number };
    return {
      key: field.key,
      label: field.label,
      value: chosen.value,
      source: tables[chosen.tableIndex]!.section,
      score: chosen.score,
      reason: `row '${chosen.rowLabel}', column '${chosen.colLabel}'`,
    };
  }

  function tryTableField(field: TargetField): Proposal {
    const columns = field.columns ?? [];
    for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
      if (usedTables.has(tableIndex)) continue;
      const table = tables[tableIndex]!;
      const header = table.rows[0] ?? [];
      const colMap: number[] = [];
      let allMatch = columns.length > 0;
      for (const column of columns) {
        let bestIdx = -1;
        let bestScore = 0;
        header.forEach((cell, idx) => {
          const score = scoreAgainst(cell, { key: column.id, label: column.label });
          if (score > bestScore) {
            bestScore = score;
            bestIdx = idx;
          }
        });
        if (bestScore < THRESHOLD) {
          allMatch = false;
          break;
        }
        colMap.push(bestIdx);
      }
      if (!allMatch) continue;
      usedTables.add(tableIndex);
      const bodyRows = table.rows.slice(1).filter((row) => (row[0] ?? "").trim().toLowerCase() !== "total");
      const value = bodyRows.map((row) => colMap.map((idx) => (row[idx] ?? "").trim()));
      return { key: field.key, label: field.label, value, source: table.section, score: 1, reason: "Table match" };
    }
    return { key: field.key, label: field.label, value: null, source: null, score: 0, reason: "no match" };
  }

  function tryXlsxNamed(field: TargetField): Proposal | null {
    for (const sheet of file.sheets) {
      for (const [name, value] of Object.entries(sheet.named)) {
        if (scoreAgainst(name, field) >= THRESHOLD) {
          return { key: field.key, label: field.label, value, source: `named cell '${name}'`, score: 1, reason: `Named cell "${name}"` };
        }
      }
      const entries = Object.entries(sheet.cells);
      for (const [address, text] of entries) {
        if (scoreAgainst(text, field) < THRESHOLD) continue;
        const match = /^([A-Z]+)(\d+)$/.exec(address);
        if (!match) continue;
        const col = match[1]!.split("").reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
        const rightAddress = `${columnLetterOf(col + 1)}${match[2]}`;
        const right = sheet.cells[rightAddress];
        if (right) return { key: field.key, label: field.label, value: right, source: `adjacent to '${text}'`, score: 1, reason: `Adjacent to "${text}"` };
      }
    }
    return null;
  }

  function columnLetterOf(col: number): string {
    let n = col;
    let out = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  return fields.map((field) => {
    if (field.type === "table") return tryTableField(field);
    return tryLabelValue(field) ?? tryHeadingSection(field) ?? tryTableRow(field) ?? tryXlsxNamed(field) ?? {
      key: field.key,
      label: field.label,
      value: null,
      source: null,
      score: 0,
      reason: "no match",
    };
  });
}
