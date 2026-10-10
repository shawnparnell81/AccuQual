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

function same(left: unknown, right: unknown): boolean {
  return String(left ?? "") === String(right ?? "");
}

/** A blank cell becoming its Excel default is not something the user changed. */
export function baselineCell(formType: string | undefined, key: string, from: unknown, to: unknown): boolean {
  const fromBlank = from == null || from === "";
  if (fromBlank && to === false) return true;
  const table = formType === "fuel_pump" ? null : CSA;
  if (!table || !(key in table)) return false;
  return (fromBlank || same(from, table[key])) && same(to, table[key]);
}
