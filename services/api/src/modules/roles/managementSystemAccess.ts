/**
 * Who may create, edit, or void Management System forms.
 * Administrator, VP of Engineering and Quality, and President (a seeded role).
 * CEO is included only when that person's role is already a CEO role.
 * Owner stays with Administrator. Viewing approved content is unchanged.
 */
export function canMaintainManagementSystem(user: { roleName?: string | null } | null | undefined): boolean {
  if (!user?.roleName) return false;
  const roleName = user.roleName.trim();
  const key = roleName.toLowerCase();
  if (key === "admin" || key === "owner" || key === "president") return true;
  const tokens = roleName
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const has = (word: string) => tokens.includes(word);
  if (has("ceo")) return true;
  const engineer = tokens.some((token) => token === "engineer" || token === "engineers" || token === "engineering");
  const vp = has("vp") || (has("vice") && has("president"));
  return vp && engineer && has("quality");
}
