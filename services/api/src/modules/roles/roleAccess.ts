/** Who can do what, based on the system role name stored on the user. */

export const IMPORT_DATA_PERMISSION = "import_data";

/** Create forms and edit their structure. Filling a copy does not use this. Owner and Administrator are not listed; they already have full access. */
export const FORM_BUILDER_PERMISSION = "form_builder";
/** Approve or reject a built form's new revision before fillers see it. Granted on the role, never by a role name. */
export const FORM_BUILDER_APPROVE_PERMISSION = "form_builder.approve";

/** Edit the controlled lists: master lists and LST logs. They open read-only; this shows Edit. Granted on the role, never by a role name. */
export const CONTROLLED_LISTS_EDIT_PERMISSION = "controlled_lists.edit";

/** Delete a folder. Assigned on the role. Not implied by a role name. */
export const FOLDERS_DELETE_PERMISSION = "folders.delete";

/** Rename a folder. Assigned on the role. Not implied by a role name. */
export const FOLDERS_RENAME_PERMISSION = "folders.rename";

/** Lets an Owner or Administrator return a document from Obsolete / Archive. Other roles never can. */
export const RESTORE_ARCHIVED_DOCUMENTS = "restore_archived_documents";

/** Delete a plant. Granted on the role, not by matching a role name. */
export const PLANTS_DELETE_PERMISSION = "plants.delete";

/** Open Admin → Login History. Granted on the role. A role name does not grant it. Owner and Administrator start with it. */
export const LOGIN_HISTORY_PERMISSION = "login_history";

/** See every living site, including ones the person is not assigned to, and the All sites choice. */
export const SITES_VIEW_ALL_PERMISSION = "sites.view_all";

/** Open the executive dashboard. Viewing does not grant editing. */
export const EXECUTIVE_DASHBOARD_PERMISSION = "executive.dashboard";

/** Delete and restore roles, including built-in ones. Owner and Administrator start with this. A role name does not grant it. */
export const ROLES_MANAGE_PERMISSION = "roles.manage";

/** Sign the required NCR closure sign-off row (row 0). Stored on the role; a role name does not grant it. */
export const NCR_CLOSURE_SIGNOFF_PERMISSION = "ncr.closure_signoff";

/** FAI & Inspection module permissions. Stored on the role; a role name does not grant them. */
export const FAI_VIEW_PERMISSION = "fai.view";
export const FAI_CREATE_PERMISSION = "fai.create";
export const FAI_EDIT_PERMISSION = "fai.edit";
export const FAI_DELETE_PERMISSION = "fai.delete";
export const FAI_SIGNOFF_PERMISSION = "fai.signoff";
export const FAI_PLANS_MANAGE_PERMISSION = "fai.plans.manage";
/** Phase 2 (scheduling): random-pull rules, generating/approving a pick list. Repeat interval itself stays under fai.plans.manage (it's a plan field, edited through updatePlan). */
export const FAI_SCHEDULE_MANAGE_PERMISSION = "fai.schedule.manage";
/** Phase 3: edit the email distribution lists. */
export const FAI_NOTIFICATIONS_MANAGE_PERMISSION = "fai.notifications.manage";
/** Phase 3: open/download the 4 FAI reports. Separate from fai.view deliberately — this phase's own task list names it as its own permission. */
export const FAI_REPORTS_VIEW_PERMISSION = "fai.reports.view";
/** Add, edit and delete Approved Sources. Changing a source status stays with the signed-off path (fai.signoff). */
export const FAI_SOURCES_MANAGE_PERMISSION = "fai.sources.manage";

/** Delete a month's Monthly Quality Report (text, supplier data, NCR rows and pictures). Granted on the role, never by a role name. */
export const QUALITY_REPORT_DELETE_PERMISSION = "quality_report.delete";

/** Print barcode labels (FAI sample tags). Granted on the role, never by a role name. */
export const LABELS_PRINT_PERMISSION = "labels.print";

/** Use Scan to find on FAI & AQL (part numbers and sample tags). Opening what it finds still needs read access to FAI records. */
export const FAI_SCAN_PERMISSION = "fai.scan";

/** Import from file, Phase 3: ask AI to suggest values for fields the deterministic rules and saved mappings left empty. No role gets it by default — ticked per role on the Roles page. */
export const IMPORT_AI_MAPPING_PERMISSION = "import.ai_mapping";

/** Open the Admin console and use its settings, users, roles, plants and integrations. Granted on the role. Owner and Administrator start with it. */
export const ADMIN_CONSOLE_PERMISSION = "admin_console";

/** See the list of user accounts. Owner, Administrator and Quality Manager start with it. */
export const USERS_LIST_PERMISSION = "users.list";

/** Change the quality reminder and escalation settings. Owner, Administrator and Quality Manager start with it. */
export const QUALITY_AUTOMATION_MANAGE_PERMISSION = "quality_automation.manage";

/** Delete any record, not only your own. Owner, Administrator and Quality Manager start with it. */
export const RECORDS_DELETE_PERMISSION = "records.delete";

/** Change a form's document number. Owner, Administrator and Quality Manager start with it. Engineering can always change it. */
export const FORMS_EDIT_NUMBER_PERMISSION = "forms.edit_number";

/** Receive documents waiting for review in the daily digest and approval reminders. Owner, Administrator, President, Vice President and Quality Manager start with it. */
export const DIGEST_RECEIVE_PERMISSION = "digest.receive";

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

/** True when the role's permission list includes records.delete. */
export function canDeleteAnyRecord(permissions: readonly string[] | null | undefined): boolean {
  return (permissions ?? []).includes(RECORDS_DELETE_PERMISSION);
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

/** True only when the role's permission list includes plants.delete. */
export function roleHasPlantDeletePermission(permissions: readonly string[] | null | undefined): boolean {
  return (permissions ?? []).includes(PLANTS_DELETE_PERMISSION);
}

/** True only when the role's permission list includes login_history. */
export function roleHasLoginHistoryPermission(permissions: readonly string[] | null | undefined): boolean {
  return (permissions ?? []).includes(LOGIN_HISTORY_PERMISSION);
}

/** Owner and Administrator only, and only when the role carries restore_archived_documents. */
export function roleCanRestoreArchivedDocuments(roleName: string | null | undefined, permissions: readonly string[] | null | undefined): boolean {
  if (!isFullAccessRole(roleName)) return false;
  return (permissions ?? []).includes(RESTORE_ARCHIVED_DOCUMENTS);
}
