/**
 * Template defaults are the baseline. A first save that still holds them is not a user edit.
 * Values copied from the Excel blanks. Wording is not changed here.
 */

const CSA: Record<string, string | number | boolean> = {
  G2: "Maxwell Tollefson",
  B8: "Shawn Parnell",
  B12: 10,
  C12: "=",
  C13: 7,
  C14: 7,
  C15: 5,
  C16: 10,
  B18: 25,
  C18: "≤",
  C22: 0.5,
  C36: 5,
  C37: 2.5,
  C39: 0.1,
  C40: 5,
  B41: 80,
  C41: "≤",
  B45: 25,
  C45: "≤",
  C46: 2,
};

const FUEL_PARAMETERS = [
  "Bottom to lid height ",
  "Compressed height ",
  "Lid thickness diameter ",
  "Lid diameter ",
  "Mounting diameter ",
  "Float upper limit height from bottom of pump ",
  "Float arm lower limit height from bottom of pump ",
  "Supply line 1 diameter ",
  "Additional line 1 diameter ",
  "Additional line 2 diameter ",
];

function fuelDefaults(): Record<string, string | number | boolean> {
  const cells: Record<string, string | number | boolean> = {
    F2: "2026-06-02",
    H2: "Maxwell Tollefson",
    B8: "Shawn Parnell",
    B29: "[Input Pressure Value From Drawing Here]",
  };
  FUEL_PARAMETERS.forEach((name, index) => {
    cells[`A${index + 13}`] = name;
  });
  return cells;
}

const BY_FORM: Record<string, Record<string, string | number | boolean>> = {
  csa: CSA,
  fuel_pump: fuelDefaults(),
};

function same(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") return left === right;
  return String(left ?? "") === String(right ?? "");
}

export function isTemplateDefault(formType: string | undefined, key: string, value: unknown): boolean {
  const table = BY_FORM[formType && formType in BY_FORM ? formType : "csa"];
  if (!table || !(key in table)) return false;
  return same(table[key], value);
}

/** Blank to a template default, or blank to an unchecked box, is not a user change. */
export function baselineOnly(formType: string | undefined, key: string, from: unknown, to: unknown): boolean {
  const fromBlank = from == null || from === "";
  if (fromBlank && to === false) return true;
  if (!fromBlank && !isTemplateDefault(formType, key, from)) return false;
  return isTemplateDefault(formType, key, to);
}
