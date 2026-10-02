/**
 * Who may edit and remove rows on a Master List by default.
 * Mirrors apps/web/src/lib/masterListAccess.ts.
 * Administrator, Quality Manager, Engineering, and VP of Engineering and Quality.
 * Owner stays included with Administrator.
 */
export function canMaintainMasterList(user: { roleName?: string | null; department?: string | null } | null | undefined): boolean {
  if (!user) return false;
  const roleName = user.roleName?.trim() ?? "";
  const key = roleName.toLowerCase();
  if (key === "owner" || key === "admin" || key === "quality_manager") return true;
  if (user.department === "engineering") return true;
  if (!roleName) return false;
  const tokens = roleName
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const has = (word: string) => tokens.includes(word);
  const engineer = tokens.some((token) => token === "engineer" || token === "engineers" || token === "engineering");
  if (has("quality") && has("manager")) return true;
  if (engineer) return true;
  const vp = /^vp([^a-z0-9]|$)/.test(key) || /^vice[\s_-]*president([^a-z0-9]|$)/.test(key);
  return vp && engineer && has("quality");
}

/**
 * Writes used by the Master Document List and Master Equipment List.
 * Other document and equipment routes keep their own gates.
 */
export function isMasterListWrite(baseUrl: string, method: string, path: string): boolean {
  if (baseUrl === "/documents") {
    return (method === "PATCH" && path === "/master-list/rows") || (method === "DELETE" && /^\/\d+$/.test(path));
  }
  if (baseUrl === "/equipment") {
    if (method === "POST" && (path === "/" || path === "")) return true;
    if ((method === "PATCH" || method === "DELETE") && /^\/\d+$/.test(path)) return true;
    if (method === "POST" && /^\/\d+\/(status|calibration)$/.test(path)) return true;
  }
  return false;
}

/**
 * Draft and file edits on one document. Used only after the row is confirmed
 * to be a Master Tool List file. Review and publish stay on the reviewer check.
 * Deleting the file is already a master-list write.
 */
export function isMasterToolListEditPath(method: string, path: string): boolean {
  if (method === "POST" && (path === "/" || path === "")) return true;
  if (method === "PATCH" && /^\/\d+$/.test(path)) return true;
  if (method === "POST" && /^\/\d+\/(?:draft|review|rollback)$/.test(path)) return true;
  if ((method === "PUT" || method === "DELETE") && /^\/\d+\/versions\/\d+$/.test(path)) return true;
  if (method === "PATCH" && /^\/\d+\/draft\/\d+$/.test(path)) return true;
  if (method === "POST" && /^\/\d+\/draft\/\d+\/review$/.test(path)) return true;
  if (method === "POST" && /^\/\d+\/version\/\d+\/rollback$/.test(path)) return true;
  if (method === "POST" && /^\/\d+\/version\/\d+\/attachments$/.test(path)) return true;
  if (method === "DELETE" && /^\/\d+\/version\/\d+\/attachments\/\d+$/.test(path)) return true;
  return false;
}
