import { EXECUTIVE_DASHBOARD_PERMISSION, FORM_BUILDER_PERMISSION, IMPORT_DATA_PERMISSION, LOGIN_HISTORY_PERMISSION, PLANTS_DELETE_PERMISSION, RESTORE_ARCHIVED_DOCUMENTS, ROLES_MANAGE_PERMISSION, SITES_VIEW_ALL_PERMISSION, isFullAccessRole } from "./roleAccess.js";

/**
 * Organizational ladder. A smaller number is higher and is listed first.
 *
 * 10 Owner
 * 15 Administrator (the existing full-admin role)
 * 20 President
 * 30 Vice President
 * 40 Director
 * 50 Manager (quality manager, and custom manager titles)
 * 60 Supervisor / Lead
 * 70 Engineer / Specialist / Inspector
 * 80 General staff (operator and other day-to-day roles)
 * 90 Read-only / viewer
 * 92 Auditor
 * 95 Supplier (external)
 * 100 Customer (external)
 */
export const LADDER: { level: number; label: string }[] = [
  { level: 10, label: "Owner" },
  { level: 15, label: "Administrator" },
  { level: 20, label: "President" },
  { level: 30, label: "Vice President" },
  { level: 40, label: "Director" },
  { level: 50, label: "Manager" },
  { level: 60, label: "Supervisor / Lead" },
  { level: 70, label: "Engineer / Specialist / Inspector" },
  { level: 80, label: "Staff" },
  { level: 90, label: "Read-only" },
  { level: 92, label: "Auditor" },
  { level: 95, label: "Supplier" },
  { level: 100, label: "Customer" },
];

export interface RoleSeed {
  name: string;
  description: string;
  hierarchyLevel: number;
  isProtected: boolean;
  permissions: string[];
}

/** Built-in roles. Names are what sign-in and the permission checks use, so they stay fixed. */
export const ROLE_SEEDS: RoleSeed[] = [
  { name: "owner", description: "Owner — full access to everything", hierarchyLevel: 10, isProtected: true, permissions: [IMPORT_DATA_PERMISSION, RESTORE_ARCHIVED_DOCUMENTS, PLANTS_DELETE_PERMISSION, LOGIN_HISTORY_PERMISSION, SITES_VIEW_ALL_PERMISSION, EXECUTIVE_DASHBOARD_PERMISSION, ROLES_MANAGE_PERMISSION] },
  { name: "admin", description: "Administrator — full access", hierarchyLevel: 15, isProtected: true, permissions: [IMPORT_DATA_PERMISSION, RESTORE_ARCHIVED_DOCUMENTS, PLANTS_DELETE_PERMISSION, LOGIN_HISTORY_PERMISSION, SITES_VIEW_ALL_PERMISSION, EXECUTIVE_DASHBOARD_PERMISSION, ROLES_MANAGE_PERMISSION] },
  { name: "executive", description: "Executive — view every site and the executive dashboard. Does not grant editing.", hierarchyLevel: 18, isProtected: true, permissions: [SITES_VIEW_ALL_PERMISSION, EXECUTIVE_DASHBOARD_PERMISSION] },
  { name: "president", description: "President — can view the quality system and approve work", hierarchyLevel: 20, isProtected: true, permissions: [] },
  { name: "vice_president", description: "Vice President — can view the quality system and approve work", hierarchyLevel: 30, isProtected: true, permissions: [] },
  { name: "director", description: "Director — can view the quality system and approve work", hierarchyLevel: 40, isProtected: true, permissions: [] },
  { name: "quality_manager", description: "Manages NCR/CAPA/Audits/Suppliers", hierarchyLevel: 50, isProtected: true, permissions: [FORM_BUILDER_PERMISSION] },
  { name: "lead", description: "Lead — supervises day-to-day work", hierarchyLevel: 60, isProtected: true, permissions: [] },
  { name: "operator", description: "Shop-floor / production user", hierarchyLevel: 80, isProtected: true, permissions: [] },
  { name: "staff", description: "Staff — day-to-day work", hierarchyLevel: 80, isProtected: true, permissions: [] },
  { name: "read_only", description: "Read-only — can view records but not change them", hierarchyLevel: 90, isProtected: true, permissions: [] },
  { name: "auditor", description: "Conducts audits and reviews findings", hierarchyLevel: 92, isProtected: true, permissions: [] },
  { name: "supplier", description: "External supplier portal access", hierarchyLevel: 95, isProtected: true, permissions: [] },
  { name: "customer", description: "External customer portal access", hierarchyLevel: 100, isProtected: true, permissions: [] },
];

export const PROTECTED_ROLE_NAMES = new Set(ROLE_SEEDS.map((role) => role.name));

/** Names shown in Users & Roles. The stored name stays the id sign-in checks use. */
const ROLE_DISPLAY_NAMES: Record<string, string> = {
  owner: "Owner",
  admin: "Administrator",
  executive: "Executive",
  president: "President",
  vice_president: "Vice President",
  director: "Director",
  quality_manager: "Quality Manager",
  lead: "Lead",
  staff: "Staff",
  operator: "Operator",
  read_only: "Read-only",
  auditor: "Auditor",
  supplier: "Supplier",
  customer: "Customer",
};

export function displayNameForRole(role: { name: string }): string {
  return ROLE_DISPLAY_NAMES[role.name.trim().toLowerCase()] ?? role.name;
}

/** True when the title itself starts with VP or Vice President. A title that only mentions VP later is not included. */
export function nameStartsWithVicePresident(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  return /^vp([^a-z0-9]|$)/.test(trimmed) || /^vice[\s_-]*president([^a-z0-9]|$)/.test(trimmed);
}

export function roleTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Where a role name sits on the ladder. First matching rule wins. */
export function hierarchyLevelForRoleName(name: string): number {
  const tokens = roleTokens(name);
  const has = (word: string) => tokens.includes(word);
  const adjacent = (left: string, right: string) => tokens.some((token, index) => token === left && tokens[index + 1] === right);

  if (nameStartsWithVicePresident(name)) return 30;
  if (has("president") && !adjacent("vice", "president") && !has("vicepresident")) return 20;
  if (has("owner")) return 10;
  if (has("admin") || has("administrator")) return 15;
  if (has("director")) return 40;
  if (has("manager")) return 50;
  if (has("supervisor") || has("lead")) return 60;
  if (has("engineer") || has("specialist") || has("inspector") || has("technician")) return 70;
  if (has("auditor")) return 92;
  if (has("supplier")) return 95;
  if (has("customer")) return 100;
  if (has("viewer") || has("readonly") || has("guest")) return 90;
  return 80;
}

export function ladderLabel(level: number): string {
  let best = LADDER[0]!;
  for (const step of LADDER) {
    if (Math.abs(step.level - level) < Math.abs(best.level - level)) best = step;
  }
  return best.label;
}

export function roleIsProtected(role: { name: string; isProtected?: boolean | null }): boolean {
  if (role.isProtected) return true;
  return PROTECTED_ROLE_NAMES.has(role.name.trim().toLowerCase());
}

export interface RankedRole {
  id: number;
  hierarchyLevel: number;
}

/**
 * Move a role one place up (higher in the org, smaller rank) or down.
 * Returns the rows to write. Empty when the role is already at that end.
 */
export function moveRank(sorted: RankedRole[], id: number, direction: "up" | "down"): { id: number; hierarchyLevel: number }[] {
  const index = sorted.findIndex((role) => role.id === id);
  const otherIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || otherIndex < 0 || otherIndex >= sorted.length) return [];
  const current = sorted[index]!;
  const other = sorted[otherIndex]!;
  if (current.hierarchyLevel !== other.hierarchyLevel) {
    return [
      { id: current.id, hierarchyLevel: other.hierarchyLevel },
      { id: other.id, hierarchyLevel: current.hierarchyLevel },
    ];
  }
  const next = current.hierarchyLevel + (direction === "up" ? -1 : 1);
  return [{ id: current.id, hierarchyLevel: Math.min(1000, Math.max(1, next)) }];
}

export interface RoleDeletionInput {
  displayName: string;
  userCount: number;
  replacementRoleId?: number | null;
  replacementExists: boolean;
  replacementIsSameRole: boolean;
  replacementIsDeleted: boolean;
  /** This role's permission list includes role management. */
  roleManagesRoles: boolean;
  /** Some other role that is still in use also includes role management. */
  otherRoleManagesRoles: boolean;
  replacementManagesRoles: boolean;
  /** The person deleting is assigned to this role. */
  callerHoldsRole: boolean;
}

export function decideRoleDeletion(input: RoleDeletionInput): { ok: true; reassign: boolean } | { ok: false; status: number; message: string } {
  const replacing = input.replacementRoleId != null && input.replacementRoleId !== 0;
  if (input.userCount > 0 && !replacing) {
    const people = input.userCount === 1 ? "1 person is" : `${input.userCount} people are`;
    return {
      ok: false,
      status: 409,
      message: `${people} assigned to ${input.displayName}. Choose another role for them before deleting it.`,
    };
  }
  if (replacing) {
    if (input.replacementIsSameRole) return { ok: false, status: 400, message: "Choose a different role to move people to." };
    if (!input.replacementExists || input.replacementIsDeleted) return { ok: false, status: 400, message: "That replacement role doesn't exist." };
  }
  const replacementKeepsManagement = replacing && input.replacementManagesRoles;
  if (input.roleManagesRoles && !input.otherRoleManagesRoles && !replacementKeepsManagement) {
    return { ok: false, status: 409, message: "This is the last role that can manage roles. Give that permission to another role first." };
  }
  if (input.callerHoldsRole && !replacementKeepsManagement) {
    return { ok: false, status: 409, message: "You can't remove your own access to manage roles. Move yourself to another role that can manage roles first." };
  }
  return { ok: true, reassign: input.userCount > 0 };
}

/**
 * Who may change a form's structure (layout, fields, formulas — the master
 * that carries VERSION/REV). Filling answers is a different permission.
 *
 * Built-in names: owner, admin, quality_manager, vice_president.
 * Custom titles map onto Quality Manager, Engineering Manager, Engineer,
 * Quality, VP of Quality and Engineering, and Product Engineer.
 */
export function canEditFormStructure(user: { roleName?: string | null } | null | undefined): boolean {
  const roleName = user?.roleName?.trim();
  if (!roleName) return false;
  if (isFullAccessRole(roleName)) return true;
  const key = roleName.toLowerCase();
  if (key === "quality_manager" || key === "vice_president") return true;
  const tokens = roleTokens(roleName);
  const has = (word: string) => tokens.includes(word);
  const engineer = tokens.some((token) => token === "engineer" || token === "engineers");
  if (has("quality") && has("manager")) return true;
  if (has("manager") && (has("engineering") || engineer)) return true;
  if (engineer) return true;
  if (tokens.length === 1 && tokens[0] === "quality") return true;
  if (nameStartsWithVicePresident(roleName) && (has("quality") || has("engineering") || engineer)) return true;
  return false;
}
