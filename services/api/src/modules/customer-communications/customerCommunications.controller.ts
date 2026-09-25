import { crudFactory } from "../../utils/crudFactory.js";
import { customerCommunications } from "../../drizzle/schema/customerCommunications.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

/**
 * Plain crudFactory (same convention as complaints.routes.ts's own
 * `crudFactory(complaints, {...})` usage) — list/getOne/update/delete need
 * no bespoke behavior. `create` already gets a real audit_trail row and an
 * AI-embedding job queued for free from crudFactory itself (see
 * crudFactory.ts's own `create` handler); `afterCreate` is the same
 * extension point ncr.controller.ts already uses to layer real, module-
 * specific side effects on top without hand-rolling insert/audit-trail
 * logic a second time.
 */
export const baseHandlers = crudFactory(customerCommunications, {
  entityName: "CustomerCommunication",
  idColumn: "id",
  afterCreate: async (created, req) => {
    const row = created as { id: number; customerId: number };
    // Real Workflow Engine trigger — same {tenantId, module, event, entityId}
    // shape every other Layer-2 module's own publishEvent call already uses
    // (see documents.controller.ts's approveHandler for the same pattern),
    // not a bespoke "communication.created" payload shape the engine has no
    // matcher for.
    await publishEvent(WORKFLOW_STREAM, {
      module: "customer_communications",
      event: "created",
      entityId: row.id,
    });
  },
});
