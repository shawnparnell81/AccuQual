import { useCurrentUser } from "./useAuth";
import { useEffectivePermissions } from "./useEffectivePermissions";
import { findNavLeaf, type AccessLevel, type Department } from "../components/layout/navConfig";

/**
 * Client-side mirror of what the backend's requireDepartmentAccess actually
 * enforces for a module — reuses navConfig.ts's NAV_STRUCTURE access maps
 * (the same object TopNav.tsx uses to build the dropdowns) rather than a
 * second, parallel permission matrix. This is for hiding/disabling actions
 * the user can't perform; the backend remains the real gate.
 *
 * `navKey` must be a key that's actually wired in navConfig.ts AND on the
 * matching backend router (ncr, capa, di, audit, calibration, suppliers).
 * Deliberately not used for documents/training — see the Phase 6 summary on
 * why those two aren't gated: the "documents"/"training" leaves exist in
 * navConfig.ts with an empty `access: {}`, which would read as "no
 * department has access" here even though the backend leaves both wide open
 * on purpose. Passing either of those keys always resolves to "edit" so a
 * future gate change on the backend doesn't get silently pre-empted by a
 * frontend guard nobody meant to add.
 */
const UNGATED_MODULES = new Set(["documents", "training"]);

export function useWorkflowAccessLevel(navKey: string): AccessLevel {
  const user = useCurrentUser();
  const { effective, isLoading } = useEffectivePermissions();
  if (UNGATED_MODULES.has(navKey)) return "edit";

  const isBypass = user?.roleName === "admin" || user?.roleName === "platform_admin";
  // admin/platform_admin bypass the matrix entirely, same as
  // requireDepartmentAccess — checked BEFORE the "no nav leaf" fallback
  // below, since a real permission key can exist (and be used for a live
  // check, e.g. rma_log_status/rma_log_linkage/crar_workflow) without ever
  // having its own navConfig.ts NavLeaf entry. Checking bypass first here
  // is what makes admin actually bypass those sub-permission checks too,
  // not just the ones with a real nav page.
  if (isBypass) return "edit";

  // Prefer the live, DB-driven level (GET /permissions/effective — see the
  // Roles & Permissions module) the moment it's loaded; navConfig.ts's own
  // static `access` map is only the pre-fetch fallback, so a page doesn't
  // flash every button as hidden for a moment on first load.
  if (!isLoading && effective && navKey in effective) return effective[navKey] as AccessLevel;

  const leaf = findNavLeaf(navKey);
  if (!leaf) return "none";
  const department = user?.department as Department | null | undefined;
  return (department && leaf.access[department]) || "none";
}

/** Convenience for the common case: can this user perform a write action (a transition) on this module at all? */
export function useCanEditWorkflow(navKey: string): boolean {
  return useWorkflowAccessLevel(navKey) === "edit";
}
