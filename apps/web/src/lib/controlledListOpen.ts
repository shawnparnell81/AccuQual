/**
 * When a click or a key opens a Master list cell for typing.
 * Lists over 200 rows draw each cell as a plain button until it is opened, so these rules
 * decide whether a click on the cell (blank or not, text or padding) or a typed key opens it.
 */

/** A click anywhere in an editable, non-formula cell opens it. A click inside an open field is left to the field. */
export function clickOpensCell(cell: { editable: boolean; formula: boolean }, click: { targetTag: string; shiftKey: boolean }): boolean {
  if (!cell.editable || cell.formula || click.shiftKey) return false;
  return !["INPUT", "TEXTAREA", "SELECT"].includes(click.targetTag.toUpperCase());
}

/** A printable key typed on a closed cell opens it. Text cells keep the key as the first typed character. */
export function keyOpensCell(key: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, cell: { choices: boolean; date: boolean }): { open: boolean; seed?: string } {
  if (key.key === "F2") return { open: true };
  if (key.key.length !== 1 || key.ctrlKey || key.metaKey || key.altKey) return { open: false };
  return cell.choices || cell.date ? { open: true } : { open: true, seed: key.key };
}
