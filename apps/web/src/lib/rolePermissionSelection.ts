/** Assignable role permissions. Each key is stored on the role. A role name does not grant one. */
export const ROLE_PERMISSION_GROUPS: {
  id: string;
  label: string;
  permissions: { key: string; label: string; hint?: string }[];
}[] = [
  {
    id: "data",
    label: "Data",
    permissions: [
      {
        key: "import_data",
        label: "Can import data",
        hint: "Owner and Administrator can always import, even if this is turned off.",
      },
      {
        key: "import.ai_mapping",
        label: "Can use AI-suggested import mapping",
        hint: "When importing a Word, Excel or CSV file, ask AI to suggest values for fields the automatic match left empty. Every suggestion must be accepted by hand.",
      },
    ],
  },
  {
    id: "documents",
    label: "Documents",
    permissions: [
      {
        key: "restore_archived_documents",
        label: "Can restore archived documents",
        hint: "Returns a document from Obsolete / Archive. The permission is stored on the role.",
      },
    ],
  },
  {
    id: "forms",
    label: "Forms",
    permissions: [
      {
        key: "form_builder",
        label: "Can build forms",
        hint: "Creating a form and editing its structure, including adding, renaming, or removing columns on a living controlled list. Filling a published copy does not use this. Owner and Administrator can always build forms.",
      },
      {
        key: "ncr.closure_signoff",
        label: "Can sign NCR closure sign-off",
        hint: "Sign the required Quality Manager row on NCR closure. Stored on the role; a role name does not grant it.",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    permissions: [
      {
        key: "quality_report.delete",
        label: "Can delete monthly quality reports",
        hint: "Delete a month's Monthly Quality Report (typed text, supplier data, NCR table rows and pictures) after entering their own PIN. Live data from other modules is not touched.",
      },
      {
        key: "quality_report.verify",
        label: "Can verify monthly quality reports",
        hint: "Mark a month's Monthly Quality Report as verified. This deletes that month's raw imported source rows and keeps only its monthly totals for later trends. It cannot be undone.",
      },
    ],
  },
  {
    id: "labels",
    label: "Labels and scanning",
    permissions: [
      {
        key: "labels.print",
        label: "Can print labels",
        hint: "Print barcode labels, such as the sample tags on an FAI record. Also needs read access to the record the label is for.",
      },
      {
        key: "fai.scan",
        label: "Can scan to find FAI",
        hint: "Scan to find also looks up FAI & AQL plans and records by part number, and sample tags by their code. Opening what it finds still needs the FAI view permission.",
      },
    ],
  },
  {
    id: "fai",
    label: "FAI & Inspection",
    permissions: [
      { key: "fai.view", label: "Can view FAI & Inspection", hint: "See the FAI & Inspection module, dashboard, plans, sources and records." },
      { key: "fai.create", label: "Can create FAI records", hint: "Create new FAI / inspection records." },
      { key: "fai.edit", label: "Can edit FAI records", hint: "Edit draft FAI records and enter inspection results." },
      { key: "fai.delete", label: "Can delete FAI records", hint: "Delete FAI records (confirmation required, audit-logged)." },
      { key: "fai.signoff", label: "Can sign off FAIs", hint: "Sign FAI records pass/fail and manually change approved source status. Stored on the role; a role name does not grant it." },
      { key: "fai.plans.manage", label: "Can manage inspection plans", hint: "Create and edit inspection plans and their characteristics." },
      { key: "fai.sources.manage", label: "Can manage approved sources", hint: "Add, edit and delete approved sources on FAI & AQL. Changing a source status still needs sign-off permission." },
      { key: "fai.schedule.manage", label: "Can manage FAI scheduling", hint: "Edit the annual random-pull rules, and generate and approve a pick list. Plan repeat intervals are still covered by \"Can manage inspection plans\"." },
      { key: "fai.notifications.manage", label: "Can manage FAI email distribution lists", hint: "Create, edit, and delete the email distribution lists for FAI events and the weekly summary." },
      { key: "fai.reports.view", label: "Can open FAI reports", hint: "Open and download the AQL Lot, Source Qualification, Random Pull Compliance, and Supplier FAI Performance reports." },
    ],
  },
  {
    id: "folders",
    label: "Folders",
    permissions: [
      { key: "folders.rename", label: "Can rename folders" },
      {
        key: "folders.delete",
        label: "Can delete folders",
        hint: "An administrator assigns these on the role. They are not tied to a job title. A folder with saved forms asks where to move them before it is deleted.",
      },
    ],
  },
  {
    id: "plants",
    label: "Plants",
    permissions: [
      {
        key: "plants.delete",
        label: "Can delete plants",
        hint: "Removes a plant from every list. Records keep the plant name. This follows the permission on the role, not the role's name.",
      },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    permissions: [
      {
        key: "login_history",
        label: "Can view login history",
        hint: "Who signed in, when, from where, and on what device. An administrator assigns this on the role. Owner and Administrator start with it.",
      },
      {
        key: "sites.view_all",
        label: "View all sites",
        hint: "Shows every plant, including All sites in the header. People without this only see plants they are assigned to.",
      },
      {
        key: "executive.dashboard",
        label: "Executive dashboard",
        hint: "Opens the executive dashboard after sign-in. Viewing does not grant permission to edit records.",
      },
      {
        key: "roles.manage",
        label: "Can manage roles",
        hint: "Delete and restore roles, including built-in ones. Owner and Administrator start with this. It is stored on the role.",
      },
    ],
  },
];

export const ALL_PERMISSIONS_CONFIRM = "This gives the role every permission, including admin settings. Continue?";

export function allRolePermissionKeys(): string[] {
  return ROLE_PERMISSION_GROUPS.flatMap((group) => group.permissions.map((item) => item.key));
}

export function rolePermissionLabel(key: string): string {
  for (const group of ROLE_PERMISSION_GROUPS) {
    const found = group.permissions.find((item) => item.key === key);
    if (found) return found.label;
  }
  return key;
}

export type PermissionCheckState = "all" | "none" | "partial";

/** Checked, unchecked, or indeterminate for a set of permission keys. */
export function permissionCheckState(selected: readonly string[], keys: readonly string[]): PermissionCheckState {
  const have = keys.filter((key) => selected.includes(key)).length;
  if (have === 0 || keys.length === 0) return "none";
  if (have === keys.length) return "all";
  return "partial";
}

/** Turns a group of keys on or off and leaves every other stored key alone. */
export function setPermissionKeys(selected: readonly string[], keys: readonly string[], on: boolean): string[] {
  const keySet = new Set(keys);
  const kept = selected.filter((key) => !keySet.has(key));
  return on ? [...kept, ...keys] : kept;
}
