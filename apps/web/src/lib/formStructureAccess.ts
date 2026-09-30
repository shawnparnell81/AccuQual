/**
 * Mirrors services/api roleHierarchy.canEditFormStructure.
 * Filling a form does not use this. Owner and Administrator stay included.
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

export function canEditFormStructure(user: { roleName?: string | null } | null | undefined): boolean {
  const roleName = user?.roleName?.trim();
  if (!roleName) return false;
  const key = roleName.toLowerCase();
  if (key === "owner" || key === "admin" || key === "quality_manager" || key === "vice_president") return true;
  const tokens = tokensOf(roleName);
  const has = (word: string) => tokens.includes(word);
  const engineer = tokens.some((token) => token === "engineer" || token === "engineers");
  if (has("quality") && has("manager")) return true;
  if (has("manager") && (has("engineering") || engineer)) return true;
  if (engineer) return true;
  if (tokens.length === 1 && tokens[0] === "quality") return true;
  if (startsWithVicePresident(roleName) && (has("quality") || has("engineering") || engineer)) return true;
  return false;
}
