/** Who can do what, based on the system role name stored on the user. */

export const IMPORT_DATA_PERMISSION = "import_data";

/** Create forms and edit their structure. Filling a copy does not use this. Owner and Administrator are not listed; they already have full access. */
export const FORM_BUILDER_PERMISSION = "form_builder";

/** Lets an Owner or Administrator return a document from Obsolete / Archive. Other roles never can. */
export const RESTORE_ARCHIVED_DOCUMENTS = "restore_archived_documents";

/** Owner and Administrator can do everything an admin route allows. */
export const FULL_ACCESS_ROLES = new Set(["admin", "owner"]);

/**
 * Can approve quality work (publish, review, override a failed calibration, release quarantine).
 * President and Vice President sit with the quality manager: they can view broadly and approve.
 */
export const REVIEWER_ROLES = new Set(["admin", "owner", "quality_manager", "president", "vice_president"]);

/** See every module at least as read, even with no department grant. Not full edit. */
export const BROAD_VIEW_ROLES = new Set(["president", "vice_president"]);

/** Who may delete a user-created record even when they did not create it. */
export const RECORD_DELETE_ROLES = new Set(["admin", "owner", "quality_manager"]);

export function isFullAccessRole(roleName: string | null | undefined): boolean {
  return roleName != null && FULL_ACCESS_ROLES.has(roleName);
}

export function canDeleteAnyRecord(roleName: string | null | undefined): boolean {
  return roleName != null && RECORD_DELETE_ROLES.has(roleName);
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

/** Owner and Administrator only, and only when the role carries restore_archived_documents. */
export function roleCanRestoreArchivedDocuments(roleName: string | null | undefined, permissions: readonly string[] | null | undefined): boolean {
  if (!isFullAccessRole(roleName)) return false;
  return (permissions ?? []).includes(RESTORE_ARCHIVED_DOCUMENTS);
}
