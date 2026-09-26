// Phase 1 task 2: remove the leftover manual/exploratory test SKUs found in
// the real demo company's Inventory list (TEST-CHANGED-COUNT, REORDER-TEST,
// FALLBACK-TEST, PERF-TEST — id 6/7/8/9). Unlike the 26 automated-test
// companies (scripts/cleanup-test-companies.ts), these live inside the ONE real
// company this app keeps, and two of them are referenced by otherwise-normal-
// looking demo records: PO #1 ("Q3 restock", status "received") has its one
// line item pointing at PERF-TEST, and Work Order #53 (cancelled) points at
// REORDER-TEST. Deleting those two items would cascade into deleting that
// PO's line item / that work order too, turning "one badly-named SKU" into
// "a broken-looking purchase order" — worse for a demo, not better. So:
//   - TEST-CHANGED-COUNT (id 6) and FALLBACK-TEST (id 8) have zero real
//     order/work-order references (checked directly, not assumed) — deleted
//     outright, along with their few inventory_alerts/reorder_requests rows.
//   - REORDER-TEST (id 7) and PERF-TEST (id 9) are RENAMED to realistic
//     hardware SKUs instead, matching this company's existing naming
//     convention (NUT-M8, WASHER-M8, BOLT-M8-20) — the PO and work order
//     that reference them stay completely intact.
import { pool } from "../src/db/index.js";

const DELETE_ITEM_IDS = [6, 8]; // TEST-CHANGED-COUNT, FALLBACK-TEST — no real order/work-order references
const RENAMES: { id: number; sku: string; description: string }[] = [
  { id: 7, sku: "WASHER-M10", description: "M10 flat washer" }, // was REORDER-TEST — referenced by Work Order #53
  { id: 9, sku: "SCREW-M6-25", description: "M6x25 socket head cap screw" }, // was PERF-TEST — referenced by PO #1's line item
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const id of DELETE_ITEM_IDS) {
      const alerts = await client.query("DELETE FROM inventory_alerts WHERE item_id = $1", [id]);
      const reorders = await client.query("DELETE FROM inventory_reorder_requests WHERE item_id = $1", [id]);
      const movements = await client.query("DELETE FROM inventory_movements WHERE item_id = $1", [id]);
      const stock = await client.query("DELETE FROM inventory_stock WHERE item_id = $1", [id]);
      const item = await client.query("DELETE FROM inventory_items WHERE id = $1 RETURNING sku", [id]);
      console.log(
        `Deleted item #${id} (${item.rows[0]?.sku ?? "already gone"}) — ` +
          `${alerts.rowCount ?? 0} alert(s), ${reorders.rowCount ?? 0} reorder request(s), ${movements.rowCount ?? 0} movement(s), ${stock.rowCount ?? 0} stock row(s)`
      );
    }

    for (const r of RENAMES) {
      const before = await client.query("SELECT sku FROM inventory_items WHERE id = $1", [r.id]);
      await client.query("UPDATE inventory_items SET sku = $1, description = $2 WHERE id = $3", [r.sku, r.description, r.id]);
      console.log(`Renamed item #${r.id}: ${before.rows[0]?.sku} -> ${r.sku} ("${r.description}")`);
    }

    await client.query("COMMIT");
    console.log("\nDone.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
