/** Who can do what, based on the system role name stored on the user. */

export const IMPORT_DATA_PERMISSION = "import_data";

/** Owner and Administrator can do everything an admin route allows. */
export const FULL_ACCESS_ROLES = new Set(["admin", "owner"]);

/**
 * Can approve quality work (publish, review, override a failed calibration, release quarantine).
 * President and Vice President sit with the quality manager: they can view broadly and approve.
 */
export const REVIEWER_ROLES = new Set(["admin", "owner", "quality_manager", "president", "vice_president"]);

/** See every module at least as read, even with no department grant. Not full edit. */
export const BROAD_VIEW_ROLES = new Set(["president", "vice_president"]);

export function isFullAccessRole(roleName: string | null | undefined): boolean {
  return roleName != null && FULL_ACCESS_ROLES.has(roleName);
}

export function isReviewerRole(roleName: string | null | undefined): boolean {
  return roleName != null && REVIEWER_ROLES.has(roleName);
}

export function isBroadViewRole(roleName: string | null | undefined): boolean {
  return roleName != null && BROAD_VIEW_ROLES.has(roleName);
}

export function roleHasImportPermission(roleName: string | null | undefined, permissions: readonly string[] | null | undefined): boolean {
  if (isFullAccessRole(roleName)) return true;
  return (permissions ?? []).includes(IMPORT_DATA_PERMISSION);
}
