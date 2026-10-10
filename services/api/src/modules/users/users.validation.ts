import { z } from "zod";
import { passwordSchema } from "../../utils/passwordPolicy.js";
import { VISIBLE_DEPARTMENTS } from "../../middleware/departmentAccess.js";

// Departments an admin can assign. sales_and_marketing stays a stored value on
// existing users; it is not a choice for new assignments.
export const departmentSchema = z.enum(VISIBLE_DEPARTMENTS as [string, ...string[]]);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value ? value : value === "" ? null : value));

const hireDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a hire date like 2026-04-02.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
  }, "That hire date isn't a real calendar day.")
  .nullable()
  .optional();

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "temporary"] as const;
export const SHIFTS = ["day", "evening", "night", "rotating"] as const;

/** Fields the new-team-member wizard adds. All optional so the original create call still works. */
export const teamMemberFields = {
  preferredName: optionalText(80),
  jobTitle: optionalText(120),
  phone: optionalText(40),
  employeeId: optionalText(40),
  hireDate,
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
  shift: z.enum(SHIFTS).nullable().optional(),
  siteLocation: optionalText(120),
  bio: optionalText(500),
  avatarAttachmentId: z.number().int().positive().nullable().optional(),
  requireMfa: z.boolean().optional(),
  siteIds: z.array(z.number().int().positive()).max(50).optional(),
  allSites: z.boolean().optional(),
  trainingCourseIds: z.array(z.number().int().positive()).max(100).optional(),
  documentIds: z.array(z.number().int().positive()).max(100).optional(),
  permissionRoleIds: z.array(z.number().int().positive()).max(20).optional(),
};

export const createUserSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  password: passwordSchema,
  name: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  roleId: z.number().int().optional(),
  department: departmentSchema.nullable().optional(),
  managerId: z.number().int().positive().nullable().optional(),
  ...teamMemberFields,
});

export const temporaryPasswordSchema = z.object({
  password: passwordSchema,
});

export const deleteUserSchema = z.object({
  replacementUserId: z.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().email().optional(),
  roleId: z.number().int().nullable().optional(),
  department: departmentSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  managerId: z.number().int().positive().nullable().optional(),
  ...teamMemberFields,
});

/** Photo and contact details a person may change on their own profile. */
export const updateMyProfileSchema = z.object({
  preferredName: optionalText(80),
  phone: optionalText(40),
  siteLocation: optionalText(120),
  bio: optionalText(500),
  avatarAttachmentId: z.number().int().positive().nullable().optional(),
});

/** The full account list in display order. movedUserId is the person the administrator moved. */
export const updateUserDisplayOrderSchema = z.object({
  userIds: z.array(z.number().int().positive()).max(5000),
  movedUserId: z.number().int().positive().optional(),
});

/** A user's own theme override — see users.themePreferences. "" clears a color back to following the company/default theme, same convention as company.validation.ts's updateBrandingSchema. */
export const updateMyThemeSchema = z.object({
  mode: z.enum(["light", "dark", "system"]).optional(),
  scheme: z.enum(["classic", "dma"]).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color like #1a2b3c")
    .optional()
    .or(z.literal("")),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color like #1a2b3c")
    .optional()
    .or(z.literal("")),
});

/** What's new: the changelog version string being marked seen — matches apps/web/src/data/changelog.ts's own version format (a plain dated tag, not semver), so kept as a general-purpose short string rather than a strict semver regex. */
export const updateMyChangelogSeenSchema = z.object({
  version: z.string().trim().min(1).max(40),
});

/** In-app path only. Rejects protocol-relative and parent-directory paths. A Documents folder may add ?folder= or ?name=. */
export function isShortcutPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..") || path.includes("\\") || path.includes("#")) return false;
  const queryAt = path.indexOf("?");
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const query = queryAt === -1 ? "" : path.slice(queryAt + 1);
  if (query.includes("?") || pathname.length > 200) return false;
  if (!/^\/[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(pathname)) return false;
  if (!query) return true;
  if (pathname !== "/documents/folders") return false;
  return /^(folder=\d+|name=[A-Za-z0-9._~%-]{1,120})$/.test(query);
}

const sidebarKey = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9:_-]+$/);

export type SidebarPlacementInput = { key: string; children?: SidebarPlacementInput[] };

export const sidebarPlacementSchema: z.ZodType<SidebarPlacementInput> = z.lazy(() =>
  z.object({
    key: sidebarKey,
    children: z.array(sidebarPlacementSchema).max(80).optional(),
  }),
);

const layoutIds = z.array(z.string().trim().min(1).max(40)).max(30);

/** One person's home and dashboard sections. Replaces that person's layout only. */
export const updateMyWorkspaceLayoutSchema = z.object({
  home: z.object({ order: layoutIds, hidden: layoutIds }).optional(),
  dashboard: z.object({ order: layoutIds, hidden: layoutIds }).optional(),
  waitingOnMe: z
    .object({
      sort: z.enum(["due", "module", "status"]),
      group: z.enum(["none", "module", "status"]),
      module: z.string().trim().min(1).max(40),
      timing: z.enum(["all", "late", "due"]),
    })
    .optional(),
});

/** Saved list-view search filters — a body of `{ [pageKey]: view[] }`, merge-patched one page key at a time (see updateMySavedViews). Each page key is capped at 20 saved views; a page id itself is just a short caller-chosen slug like "ncr-list". */
export const updateMySavedViewsSchema = z.record(
  z.string().trim().min(1).max(60),
  z.array(z.object({ label: z.string().trim().min(1).max(60), searchText: z.string().max(200) })).max(20)
);

/** One person's sidebar. Replaces the whole preference. layout null means the built-in menu. */
export const updateMySidebarShortcutsSchema = z.object({
  hidden: z.array(sidebarKey).max(200),
  pinned: z
    .array(
      z.object({
        key: sidebarKey,
        label: z.string().trim().min(1).max(80),
        path: z.string().trim().min(1).max(240).refine(isShortcutPath, "must be an in-app path"),
      }),
    )
    .max(40),
  layout: z.array(sidebarPlacementSchema).max(80).nullable().optional(),
  menuEdition: z.number().int().min(0).max(20).optional(),
  groups: z
    .array(
      z.object({
        key: z.string().trim().regex(/^group:[A-Za-z0-9_-]{1,60}$/),
        label: z.string().trim().min(1).max(40),
      }),
    )
    .max(20)
    .optional(),
});
