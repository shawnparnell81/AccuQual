/**
 * Mirrors services/api roleHierarchy.canMaintainMasterList.
 * Edit and remove on every master list use this. Filling a form does not.
 */
function tokensOf(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function startsWithVicePresident(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  return /^vp([^a-z0-9]|$)/.test(trimmed) || /^vice[\s_-]*president([^a-z0-9]|$)/.test(trimmed);
}

export function canMaintainMasterList(user: { roleName?: string | null; department?: string | null } | null | undefined): boolean {
  if (!user) return false;
  const roleName = user.roleName?.trim() ?? "";
  if (roleName === "owner" || roleName === "admin") return true;
  if (user.department === "engineering") return true;
  if (!roleName) return false;
  const key = roleName.toLowerCase();
  if (key === "quality_manager" || key === "vice_president" || key === "admin" || key === "administrator") return true;
  const tokens = tokensOf(roleName);
  const has = (word: string) => tokens.includes(word);
  const engineer = tokens.some((token) => token === "engineer" || token === "engineers" || token === "engineering");
  if (has("admin") || has("administrator")) return true;
  if (has("quality") && has("manager")) return true;
  if (engineer) return true;
  if (startsWithVicePresident(roleName) && (has("quality") || has("engineering") || tokens.some((token) => token === "engineer" || token === "engineers"))) return true;
  return false;
}
