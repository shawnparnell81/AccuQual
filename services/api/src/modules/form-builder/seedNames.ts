/**
 * Which existing role titles receive the Form Builder permission the first
 * time it is seeded. Request checks read the stored permission. They do not
 * call this.
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

export function roleNameGetsFormBuilderSeed(roleName: string | null | undefined): boolean {
  const name = roleName?.trim();
  if (!name) return false;
  const key = name.toLowerCase();
  if (key === "quality_manager") return true;
  const tokens = tokensOf(name);
  const has = (word: string) => tokens.includes(word);
  const engineer = tokens.some((token) => token === "engineer" || token === "engineers");
  if (has("quality") && has("manager")) return true;
  if (has("manager") && (has("engineering") || engineer)) return true;
  if (engineer) return true;
  if (tokens.length === 1 && tokens[0] === "quality") return true;
  if (startsWithVicePresident(name) && (has("quality") || has("engineering") || engineer)) return true;
  return false;
}

export const FORM_BUILDER_SEED_ROLE_NAMES = [
  "Quality Manager",
  "Engineering Manager",
  "Engineers",
  "Quality",
  "VP of Quality and Engineering",
  "Product Engineers",
] as const;
