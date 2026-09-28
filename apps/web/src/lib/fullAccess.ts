/** Owner and Administrator. Mirrors the API's full-access roles. */
export function isFullAccessRole(roleName: string | null | undefined): boolean {
  return roleName === "admin" || roleName === "owner";
}
