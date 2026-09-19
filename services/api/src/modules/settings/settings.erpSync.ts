import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { decryptSecret } from "../tenant/crypto.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { logger } from "../../utils/logger.js";
import { assertSafeWebhookUrl } from "../../utils/ssrfGuard.js";
import { env } from "../../config/env.js";
import { loadTenantForSettings, getErpSyncSettings, type ErpSyncSettings } from "./settings.service.js";

const MAX_HISTORY_ENTRIES = 20;
const MAX_RETRIES_CAP = 5; // a hard ceiling on retryPolicy.maxRetries — this runs synchronously inside one HTTP request, not a background job
const MAX_BACKOFF_SECONDS_CAP = 10;

export interface SyncHistoryEntry {
  at: string;
  status: "success" | "failed" | "skipped";
  modules: string[];
  message?: string;
}

export interface SyncResult {
  status: SyncHistoryEntry["status"];
  message: string;
  attempts: number;
  history: SyncHistoryEntry[];
}

/**
 * Real HTTP delivery with an HMAC-SHA256 signature (X-AccuQual-Signature,
 * same "hex" convention as the AI config's own secret handling) when a
 * secret is configured — a real webhook contract another system can verify
 * against, not a fabricated call. No fake success: a missing webhookUrl is
 * reported as "skipped", never silently reported as sent.
 *
 * There is no background scheduler in this app (see tenants.erpSyncSettings'
 * own schema comment) — `schedule` is stored config for a future worker to
 * read; today a sync only actually runs when this function is called, i.e.
 * from POST /settings/erp-sync/trigger.
 */
export async function triggerErpSync(db: TenantDb, tenantId: number, performedBy: number | undefined): Promise<SyncResult> {
  const tenant = await loadTenantForSettings(db, tenantId);
  const config = getErpSyncSettings(tenant);
  const modules = config.modulesEnabled ?? [];

  let entry: SyncHistoryEntry;
  let attempts = 0;

  if (!config.webhookUrl) {
    entry = { at: new Date().toISOString(), status: "skipped", modules, message: "No webhook URL configured — nothing to sync." };
  } else {
    const payload = JSON.stringify({ tenantId, direction: config.direction ?? "push", modules, triggeredAt: new Date().toISOString() });
    const maxRetries = Math.min(config.retryPolicy?.maxRetries ?? 0, MAX_RETRIES_CAP);
    const backoffSeconds = Math.min(config.retryPolicy?.backoffSeconds ?? 0, MAX_BACKOFF_SECONDS_CAP);

    let lastError: string | undefined;
    let delivered = false;
    // Security-audit finding (S2, high): a tenant-configured webhookUrl was
    // fetched server-side with no validation against internal/private
    // targets (e.g. the 169.254.169.254 cloud metadata endpoint) — checked
    // once before the retry loop, same "reject the config" treatment as an
    // unreachable/erroring webhook, so it still flows through the normal
    // history/audit-trail recording below rather than a divergent early exit.
    // Production-only, same "relax outside production" convention as this
    // app's cookie secure/sameSite flags and DATABASE_SSL_CA requirement
    // (config/env.ts) — settings-module.test.ts's own webhook-delivery test
    // deliberately posts to a real local 127.0.0.1 test server over http.
    if (env.NODE_ENV === "production") {
      try {
        await assertSafeWebhookUrl(config.webhookUrl);
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Webhook URL failed validation";
        logger.error("ERP sync webhook rejected — unsafe target", { tenantId, message: lastError });
      }
    }
    for (attempts = 1; attempts <= maxRetries + 1 && !delivered && !lastError; attempts++) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (config.webhookSecretEncrypted) {
          const secret = decryptSecret(config.webhookSecretEncrypted);
          headers["X-AccuQual-Signature"] = createHmac("sha256", secret).update(payload).digest("hex");
        }
        const res = await fetch(config.webhookUrl, { method: "POST", headers, body: payload });
        if (res.ok) {
          delivered = true;
        } else {
          lastError = `Webhook responded ${res.status}`;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Unknown error calling webhook";
      }
      if (!delivered && attempts <= maxRetries && backoffSeconds > 0) {
        await new Promise((r) => setTimeout(r, backoffSeconds * 1000));
      }
    }
    attempts = Math.min(attempts, maxRetries + 1);

    entry = delivered
      ? { at: new Date().toISOString(), status: "success", modules, message: `Delivered to webhook after ${attempts} attempt(s).` }
      : { at: new Date().toISOString(), status: "failed", modules, message: lastError ?? "Webhook delivery failed." };

    if (!delivered) logger.error("ERP sync webhook delivery failed", { tenantId, attempts, lastError });
  }

  const history = [entry, ...(config.statusHistory ?? [])].slice(0, MAX_HISTORY_ENTRIES);
  const merged: ErpSyncSettings = { ...config, statusHistory: history };
  await db.update(tenants).set({ erpSyncSettings: merged }).where(eq(tenants.id, tenantId));

  await recordAuditTrail(db, {
    tenantId,
    entityType: "ErpSyncSettings",
    entityId: tenantId,
    action: "status_change",
    changes: { subAction: "sync_triggered", status: entry.status, modules, message: entry.message },
    performedBy,
  });

  return { status: entry.status, message: entry.message ?? "", attempts, history };
}
