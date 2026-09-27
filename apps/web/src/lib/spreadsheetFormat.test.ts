import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cssColor, excelSerialToDate, formatDateValue, formatNumberValue, isDateFormat, parseCsv, textOnFill } from "./spreadsheetFormat.ts";

describe("spreadsheet colors", () => {
  it("reads an argb color and drops a fully transparent one", () => {
    assert.equal(cssColor({ argb: "FF1F4E79" }), "#1f4e79");
    assert.equal(cssColor({ argb: "001F4E79" }), undefined);
  });

  it("uses the Office theme palette when the file stored a theme index", () => {
    assert.equal(cssColor({ theme: 4 }), "#4472c4");
    assert.equal(textOnFill("#1f4e79"), "#ffffff");
    assert.equal(textOnFill("#fff2cc"), "#1a1a1a");
  });
});

describe("spreadsheet number formats", () => {
  it("applies decimals, thousands separators, percents, and currency", () => {
    assert.equal(formatNumberValue(1234.5, "#,##0.00"), "1,234.50");
    assert.equal(formatNumberValue(0.125, "0.0%"), "12.5%");
    assert.equal(formatNumberValue(42, "$#,##0"), "$42");
    assert.equal(formatNumberValue(3, "General"), "3");
  });

  it("formats Excel dates from a serial number", () => {
    assert.equal(isDateFormat("mm/dd/yyyy"), true);
    assert.equal(isDateFormat("#,##0.00"), false);
    const date = excelSerialToDate(44927);
    assert.equal(formatDateValue(date, "yyyy-mm-dd"), "2023-01-01");
    assert.equal(formatDateValue(date, "mm/dd/yyyy"), "01/01/2023");
  });
});

describe("csv", () => {
  it("keeps quoted commas and escaped quotes", () => {
    const rows = parseCsv('Name,Score\r\n"Widget, A","He said ""hi"""\n');
    assert.deepEqual(rows, [
      ["Name", "Score"],
      ["Widget, A", 'He said "hi"'],
    ]);
  });
});
