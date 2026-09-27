/** How a person is named on history, signatures, and audit entries. */
export function formatUserLabel(person: { name: string | null; email: string; isActive: boolean } | undefined, missingId: number): string {
  if (!person) return `Deleted User (ID #${missingId})`;
  const base = person.name?.trim() ? person.name.trim() : person.email;
  return person.isActive ? base : `${base} (inactive)`;
}
