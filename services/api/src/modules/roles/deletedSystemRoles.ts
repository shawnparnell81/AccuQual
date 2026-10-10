import type { RoleSeed } from "./roleHierarchy.js";

/** A built-in role an administrator has removed. The role row stays so a later seed does not create it again. */
export interface DeletedSystemRole {
  name: string;
  deletedAt: string;
  deletedBy: number | null;
  reason: string | null;
}

export function deletedRoleNames(list: readonly DeletedSystemRole[] | undefined): Set<string> {
  return new Set((list ?? []).map((row) => row.name));
}

export function withDeletedRole(list: readonly DeletedSystemRole[] | undefined, entry: DeletedSystemRole): DeletedSystemRole[] {
  return [...(list ?? []).filter((row) => row.name !== entry.name), entry];
}

export function withoutDeletedRole(list: readonly DeletedSystemRole[] | undefined, name: string): DeletedSystemRole[] {
  return (list ?? []).filter((row) => row.name !== name);
}

/** Seeds that are not already stored and were not removed by an administrator. */
export function systemRolesToInsert<T extends { name: string }>(seeds: readonly T[], existingNames: readonly string[], deletedNames: readonly string[]): T[] {
  const skip = new Set([...existingNames, ...deletedNames]);
  return seeds.filter((role) => !skip.has(role.name));
}

export function seedForDeletedRole(name: string, seeds: readonly RoleSeed[]): RoleSeed | undefined {
  return seeds.find((role) => role.name === name);
}
