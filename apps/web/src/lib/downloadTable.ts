type ExcelModule = typeof import("exceljs");

/** Downloads a simple workbook. `fills` use 1-based rows including the header row. */
export async function downloadXlsx(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number>>,
  fills: Array<{ row: number; col: number; argb: string }> = [],
): Promise<void> {
  const loaded = (await import("exceljs")) as ExcelModule & { default?: ExcelModule };
  const ExcelJS = loaded.default ?? loaded;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("List");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  const header = sheet.getRow(1);
  header.font = { bold: true };
  for (const fill of fills) {
    const cell = sheet.getRow(fill.row).getCell(fill.col);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill.argb } };
    cell.font = { color: { argb: "FF1A1A1A" } };
  }
  const buffer = await book.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const TONE_ARGB = { red: "FFFF5050", yellow: "FFFFE566", green: "FF70AD47" } as const;
