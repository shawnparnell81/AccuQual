// One-off Phase 0 data repair: CAPA #5 (tenant 1) had its Root Cause Summary
// saved as the raw AI-stub JSON object — see llm-gateway.ts's STUB_SIGNATURE
// and capa.validation.ts's rejectAiStubText, the guardrails added so this
// can't happen again. This script finds every CAPA row still carrying that
// signature in rootCause/actionPlan/preventiveAction (should be exactly the
// one already-known row, but scans all three fields and every tenant rather
// than assuming), clears the corrupted field back to its normal "not yet
// documented" empty state, and records a real audit trail entry against the
// standalone pool (matching recordAuditTrailStandalone's own convention for
// writes that happen outside a request transaction) so the correction
// itself is traceable, not a silent UPDATE.
import { pool } from "../src/db/index.js";
import { recordAuditTrailStandalone } from "../src/modules/audit-trail/audit-trail.service.js";
import { STUB_SIGNATURE } from "../src/modules/ai/llm-gateway.js";

const FIELDS = ["root_cause", "action_plan", "preventive_action"] as const;

async function main() {
  let repaired = 0;
  for (const field of FIELDS) {
    const { rows } = await pool.query<{ id: number; tenant_id: number }>(
      `SELECT id, tenant_id FROM capa WHERE ${field} LIKE $1`,
      [`%${STUB_SIGNATURE}%`]
    );
    for (const row of rows) {
      await pool.query(`UPDATE capa SET ${field} = NULL WHERE id = $1`, [row.id]);
      await recordAuditTrailStandalone(pool, {
        tenantId: row.tenant_id,
        entityType: "CAPA",
        entityId: row.id,
        action: "update",
        changes: {
          subAction: "data_repair",
          reason: "Phase 0 fix: field contained the raw AI-stub payload instead of real content — see the CAPA data-integrity guardrail.",
          fieldCleared: field,
        },
      });
      repaired++;
      console.log(`Repaired CAPA #${row.id} (tenant ${row.tenant_id}): cleared ${field}`);
    }
  }
  console.log(repaired === 0 ? "No corrupted CAPA records found." : `Done — ${repaired} field(s) repaired.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
