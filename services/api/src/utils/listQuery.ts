/** Shared bound for list endpoints. High enough that a normal register still fits; low enough that one page can't pull an unbounded table. */
export const LIST_SAFETY_LIMIT = 2000;

/**
 * `limit` and `offset` are optional. When either is present the handler should
 * also send `X-Total-Count` so the caller can page. Missing values keep the
 * safety cap and start at the first row, which is what every existing list
 * already did.
 */
export function parseLimitOffset(query: Record<string, unknown>): { limit: number; offset: number; paginated: boolean } {
  const paginated = query.limit != null || query.offset != null;
  const requestedLimit = query.limit != null && query.limit !== "" ? Number(query.limit) : LIST_SAFETY_LIMIT;
  const limit = Number.isInteger(requestedLimit) ? Math.min(LIST_SAFETY_LIMIT, Math.max(1, requestedLimit)) : LIST_SAFETY_LIMIT;
  const requestedOffset = query.offset != null && query.offset !== "" ? Number(query.offset) : 0;
  const offset = Number.isInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;
  return { limit, offset, paginated };
}
