import ExcelJS from "exceljs";
import { LISTS, type ListKey } from "./logic.js";
import { excelSerial, formulaSerial, type StoredCell, type StoredSheet } from "./math.js";

const THIN = { style: "thin" as const, color: { argb: "FF000000" } };
const MEDIUM = { style: "medium" as const, color: { argb: "FF000000" } };

function borderFrom(box: string): Partial<ExcelJS.Borders> {
  const style = (code: string | undefined) => (code === "m" ? MEDIUM : code === "-" ? undefined : THIN);
  return { left: style(box[0]), right: style(box[1]), top: style(box[2]), bottom: style(box[3]) };
}

function cellValue(sheet: StoredSheet, cell: StoredCell): ExcelJS.CellValue {
  if (cell.f) {
    const serial = formulaSerial(sheet, cell.f);
    return serial == null ? { formula: cell.f } : { formula: cell.f, result: serial };
  }
  if (typeof cell.v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cell.v)) return excelSerial(cell.v);
  return cell.v ?? null;
}

function writeSheet(book: ExcelJS.Workbook, sheet: StoredSheet, listKey: ListKey) {
  const ws = book.addWorksheet(sheet.name, {
    pageSetup: {
      orientation: LISTS[listKey].landscape ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  sheet.colWidths.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });
  for (const [key, height] of Object.entries(sheet.rowHeights)) {
    const row = ws.getRow(Number(key));
    row.height = height;
  }
  for (let row = 1; row <= sheet.maxRow; row += 1) {
    for (let col = 1; col <= sheet.maxCol; col += 1) {
      const addr = ws.getCell(row, col).address;
      const source = sheet.cells[addr];
      const target = ws.getCell(addr);
      if (source) {
        target.value = cellValue(sheet, source);
        if (source.nf) target.numFmt = source.nf;
        if (source.comment) target.note = source.comment;
      }
      const size = source?.size ?? 11;
      const spec = LISTS[listKey];
      target.font = {
        name: source?.font ?? "Aptos Narrow",
        size,
        bold: Boolean(source?.bold),
        color: source?.color ? { argb: source.color } : undefined,
      };
      const horizontal = source?.align === "general" ? undefined : ((source?.align as ExcelJS.Alignment["horizontal"]) ?? (spec.centered || size >= 22 ? "center" : undefined));
      target.alignment = {
        horizontal,
        vertical: "middle",
        wrapText: Boolean(source?.wrap),
      };
      const box = sheet.boxes?.[addr];
      const edge = !box && !spec.centered && size >= 22 ? MEDIUM : THIN;
      target.border = box ? borderFrom(box) : { top: edge, left: THIN, bottom: THIN, right: THIN };
    }
  }
  const validations = ws as ExcelJS.Worksheet & { dataValidations: { add: (address: string, validation: ExcelJS.DataValidation) => void } };
  for (const list of sheet.lists ?? []) {
    const ref = `${list.c1}${list.r1}:${list.c2}${list.r2}`;
    validations.dataValidations.add(ref, {
      type: "list",
      allowBlank: true,
      formulae: [`"${list.options.join(",")}"`],
    });
  }
  for (const merge of sheet.merges) {
    if (!ws.getCell(merge.split(":")[0] ?? "A1")) continue;
    ws.mergeCells(merge);
  }
  if (listKey === "lst-eqp-001") {
    const last = Math.max(sheet.maxRow, 6);
    ws.addConditionalFormatting({
      ref: `I6:I${last}`,
      rules: [
        {
          type: "expression",
          formulae: ["AND(ISNUMBER(I6),I6>=TODAY(),I6<=TODAY()+30)"],
          priority: 1,
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFFF00" } } },
        },
        {
          type: "expression",
          formulae: ["AND(ISNUMBER(I6),I6<TODAY())"],
          priority: 2,
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFF5050" } } },
        },
      ],
    });
  }
  return ws;
}

export async function buildListWorkbook(listKey: ListKey, sheets: StoredSheet[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "AccuQual";
  for (const sheet of sheets) writeSheet(book, sheet, listKey);
  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function workbookFileName(listKey: ListKey): string {
  return LISTS[listKey].fileName ?? `${LISTS[listKey].docId} ${LISTS[listKey].title}.xlsx`;
}
