import { z } from "zod";
import { passwordSchema } from "../../utils/passwordPolicy.js";
import { VISIBLE_DEPARTMENTS } from "../../middleware/departmentAccess.js";

// Departments an admin can assign. sales_and_marketing stays a stored value on
// existing users; it is not a choice for new assignments.
export const departmentSchema = z.enum(VISIBLE_DEPARTMENTS as [string, ...string[]]);

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

/** In-app path only. Rejects protocol-relative and parent-directory paths. */
export function isShortcutPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..") || path.includes("\\") || path.includes("?")) return false;
  return /^\/[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(path);
}

/** Saved list-view search filters — a body of `{ [pageKey]: view[] }`, merge-patched one page key at a time (see updateMySavedViews). Each page key is capped at 20 saved views; a page id itself is just a short caller-chosen slug like "ncr-list". */
export const updateMySavedViewsSchema = z.record(
  z.string().trim().min(1).max(60),
  z.array(z.object({ label: z.string().trim().min(1).max(60), searchText: z.string().max(200) })).max(20)
);

/** One person's sidebar: hidden shared items, plus shortcuts they pinned. Replaces the whole preference. */
export const updateMySidebarShortcutsSchema = z.object({
  hidden: z.array(z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9:_-]+$/)).max(200),
  pinned: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9:_-]+$/),
        label: z.string().trim().min(1).max(80),
        path: z.string().trim().max(120).refine(isShortcutPath, "must be an in-app path"),
      }),
    )
    .max(40),
});
