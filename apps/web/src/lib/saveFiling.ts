/** Plain Save files nothing. A record locks on Save only after it has been filed. */
export function saveShouldLock(filed: boolean): boolean {
  return filed;
}

export function filedToast(folder: string): string {
  const name = folder.trim() || "the folder";
  return `Filed to ${name} and locked`;
}
