/**
 * Who may edit and remove rows on a Master List by default.
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
