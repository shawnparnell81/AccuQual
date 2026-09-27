/** HTML input type for a layout field. Text and textarea kinds stay free text. */
export function inputTypeForFieldKind(kind: string): "date" | "number" | "text" {
  if (kind === "date") return "date";
  if (kind === "number") return "number";
  return "text";
}
