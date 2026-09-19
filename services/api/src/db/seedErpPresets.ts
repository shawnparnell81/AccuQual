import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "./index.js";
import { erpConnectorPresets, type ErpPresetMappingConfig } from "../drizzle/schema/erpPresets.js";
import { logger } from "../utils/logger.js";

/**
 * ERP Connector Presets v1 — 4 global (tenantId null) starter presets, real
 * researched field names, 2 vendors x 2 modules (the only two modules the
 * mapping engine has real per-record data wired for — see
 * erpMappingEngine.ts). Safe to re-run: checks by (vendor, module, name)
 * before inserting, same "safe to re-run" convention as db/seed.ts.
 */

const supplierMapping: ErpPresetMappingConfig = {
  fieldMappings: [
    { source: "name", target: "NAME1", required: true },
    { source: "contactEmail", target: "SMTP_ADDR" },
    { source: "status", target: "SPERR", transform: { kind: "statusMap", map: { active: "", probation: "X", disqualified: "X" } } },
  ],
  triggers: [{ on: "create" }, { on: "update" }],
  validationRules: [{ field: "name", required: true, type: "string" }],
};

const sapSupplierPreset = {
  vendor: "sap",
  module: "suppliers",
  name: "SAP Vendor Master",
  description: "Maps AccuQual suppliers to SAP MM vendor master fields (LFA1) — LIFNR is assigned by SAP on create, not mapped from AccuQual.",
  direction: "push",
  mappingConfig: supplierMapping,
};

const netsuiteSupplierPreset = {
  vendor: "netsuite",
  module: "suppliers",
  name: "NetSuite Vendor Record",
  description: "Maps AccuQual suppliers to a NetSuite vendor record.",
  direction: "push",
  mappingConfig: {
    fieldMappings: [
      { source: "name", target: "companyname", required: true },
      { source: "contactEmail", target: "email" },
      { source: "status", target: "isinactive", transform: { kind: "statusMap", map: { active: "F", probation: "F", disqualified: "T" } } },
    ],
    triggers: [{ on: "create" }, { on: "update" }],
    validationRules: [{ field: "name", required: true, type: "string" }],
  } satisfies ErpPresetMappingConfig,
};

const sapPurchaseOrderPreset = {
  vendor: "sap",
  module: "purchaseOrders",
  name: "SAP Purchase Order",
  description: "Maps AccuQual purchase orders to SAP MM PO header fields (EKKO) — EBELN is assigned by SAP on create, not mapped from AccuQual.",
  direction: "push",
  mappingConfig: {
    fieldMappings: [
      { source: "supplierId", target: "LIFNR", required: true },
      { source: "createdAt", target: "BEDAT", transform: { kind: "dateFormat", from: "ISO", to: "YYYYMMDD" } },
      { source: "status", target: "PO_STATUS", transform: { kind: "codeMap", map: { draft: "D", sent: "S", cancelled: "C" }, default: "D" } },
    ],
    triggers: [{ on: "create" }, { on: "statusChange" }],
    validationRules: [{ field: "supplierId", required: true, type: "number" }],
  } satisfies ErpPresetMappingConfig,
};

const netsuitePurchaseOrderPreset = {
  vendor: "netsuite",
  module: "purchaseOrders",
  name: "NetSuite Purchase Order",
  description: "Maps AccuQual purchase orders to a NetSuite purchase order transaction.",
  direction: "push",
  mappingConfig: {
    fieldMappings: [
      { source: "supplierId", target: "entity", required: true },
      { source: "createdAt", target: "trandate", transform: { kind: "dateFormat", from: "ISO", to: "MM/DD/YYYY" } },
      { source: "status", target: "orderstatus", transform: { kind: "codeMap", map: { draft: "pendingApproval", sent: "pendingReceipt", cancelled: "cancelled" }, default: "pendingApproval" } },
    ],
    triggers: [{ on: "create" }, { on: "statusChange" }],
    validationRules: [{ field: "supplierId", required: true, type: "number" }],
  } satisfies ErpPresetMappingConfig,
};

const GLOBAL_PRESETS = [sapSupplierPreset, netsuiteSupplierPreset, sapPurchaseOrderPreset, netsuitePurchaseOrderPreset];

async function main() {
  logger.info("Seeding ERP Connector Presets (global)...");
  for (const preset of GLOBAL_PRESETS) {
    const [existing] = await db
      .select()
      .from(erpConnectorPresets)
      .where(and(isNull(erpConnectorPresets.tenantId), eq(erpConnectorPresets.vendor, preset.vendor), eq(erpConnectorPresets.module, preset.module), eq(erpConnectorPresets.name, preset.name)));
    if (existing) {
      logger.info(`Already seeded: ${preset.vendor} / ${preset.module} / "${preset.name}"`);
      continue;
    }
    await db.insert(erpConnectorPresets).values({ tenantId: null, ...preset, version: 1, versionHistory: [] });
    logger.info(`Seeded: ${preset.vendor} / ${preset.module} / "${preset.name}"`);
  }
  logger.info("ERP Connector Presets seed complete.");
  await pool.end();
}

main().catch((err) => {
  logger.error("ERP Connector Presets seed failed", err);
  process.exit(1);
});
