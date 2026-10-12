/** Pure distribution-list matching, separated out so it's testable without a database. */

export interface FaiEventContext {
  eventType: "awaiting_signoff" | "passed" | "failed" | "due_reminder" | "random_pull_approved";
  siteId: number | null;
  productFamily: string | null;
  triggerReason: string | null;
}

export interface FaiListFilter {
  matchSiteId: number | null;
  matchProductFamily: string | null;
  matchTriggerReason: string | null;
  matchEventTypes: string[];
}

/** A list hears about an event only if every filter it has SET matches. An unset filter (null, or an empty event-types array) matches anything on that axis. */
export function listMatchesEvent(list: FaiListFilter, ctx: FaiEventContext): boolean {
  if (list.matchEventTypes.length > 0 && !list.matchEventTypes.includes(ctx.eventType)) return false;
  if (list.matchSiteId != null && list.matchSiteId !== ctx.siteId) return false;
  if (list.matchProductFamily && list.matchProductFamily !== ctx.productFamily) return false;
  if (list.matchTriggerReason && list.matchTriggerReason !== ctx.triggerReason) return false;
  return true;
}
