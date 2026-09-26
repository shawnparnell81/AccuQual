/**
 * Phase 1 hygiene guardrail, shared by every "block obvious test data
 * outside development" check (platform.service.ts's company provisioning,
 * inventory.controller.ts's SKU creation). Phase 0 fixed the real root
 * cause of this class of pollution — the automated test suite now writes
 * into its own isolated database, never this one (see test/setup.ts) — so
 * this is pure defense in depth for the one path that fix can't reach: a
 * human manually creating obviously-test-named data straight into a real
 * environment through the same UI/API a real user would use.
 *
 * Matches the exact naming convention the ~26 cleaned-up test companies and
 * the 4 cleaned-up test SKUs actually used (see scripts/cleanup-test-
 * companies.ts and scripts/cleanup-test-skus.ts) — a "-test-<digits>" suffix
 * (vitest's own company-code convention, always followed by a timestamp) or
 * a bare "TEST"/"PERF-TEST"-style token as a whole word, without being so
 * broad it'd block a real company or part number that happens to contain
 * the word "test" (e.g. "Testori Fasteners", "SCREW-TESTED-M6").
 */
const TEST_DATA_PATTERN = /-test-\d|test company|(^|[-_])(test|perf-test)([-_]|$)/i;

export function isObviousTestName(value: string): boolean {
  return TEST_DATA_PATTERN.test(value);
}
