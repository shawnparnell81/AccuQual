import { displayNameForRole } from "../roles/roleHierarchy.js";

/** Compare a stored step title with the role an admin assigned. Underscores and spaces are the same word. */
export function roleTitleMatches(roleName: string | null | undefined, target: string): boolean {
  if (!roleName || !target.trim()) return false;
  const norm = (value: string) => value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const want = norm(target);
  if (norm(roleName) === want) return true;
  return norm(displayNameForRole({ name: roleName })) === want;
}

/**
 * Management approval waits until every stored title has approved.
 * One title, "any", a rejection, or a full-access admin finishes the step now.
 */
export function nextApprovalState(input: {
  decision: "approved" | "rejected";
  titles: string[];
  approvalMode?: string | null;
  roleName: string | null;
  fullAccess: boolean;
  alreadyApproved: string[];
}): { waiting: boolean; approvedTitles: string[] } {
  if (input.decision === "rejected" || input.fullAccess || input.titles.length <= 1 || input.approvalMode === "any") {
    return { waiting: false, approvedTitles: input.titles };
  }
  const approved = [...input.alreadyApproved];
  const mine = input.titles.find((title) => roleTitleMatches(input.roleName, title));
  if (mine && !approved.some((item) => roleTitleMatches(item, mine))) approved.push(mine);
  const remaining = input.titles.filter((title) => !approved.some((item) => roleTitleMatches(item, title)));
  return { waiting: remaining.length > 0, approvedTitles: approved };
}

export function titlesFromConfig(config: Record<string, unknown> | null | undefined): string[] {
  if (!config) return [];
  const titles: string[] = [];
  if (typeof config.assignee === "string" && config.assignee.trim()) titles.push(config.assignee.trim());
  if (Array.isArray(config.assignees)) {
    for (const item of config.assignees) {
      if (typeof item === "string" && item.trim()) titles.push(item.trim());
    }
  }
  return titles;
}
