/**
 * Same rule as services/api/src/modules/company/digitalTwinFlag.ts.
 * Unset means off. Only an explicit true shows Digital Twin.
 */
export function digitalTwinEnabled(flag: boolean | null | undefined): boolean {
  return flag === true;
}

export function isDigitalTwinNavKey(key: string | undefined): boolean {
  return key === "digital-twin" || key === "digital_twin" || key === "admin-digital-twin";
}

/** /digital-twin and the admin setup route, including a saved pin that points there. */
export function isDigitalTwinPath(path: string | undefined | null): boolean {
  if (!path) return false;
  const pathname = path.split("?")[0]?.split("#")[0] ?? "";
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return normalized === "/digital-twin" || normalized.startsWith("/digital-twin/") || normalized === "/admin/digital-twin" || normalized.startsWith("/admin/digital-twin/");
}

/** The one menu check. True when this row must stay out of the UI. */
export function hideDigitalTwinTarget(flag: boolean | null | undefined, target: { key?: string; path?: string }): boolean {
  if (digitalTwinEnabled(flag)) return false;
  return isDigitalTwinNavKey(target.key) || isDigitalTwinPath(target.path);
}
