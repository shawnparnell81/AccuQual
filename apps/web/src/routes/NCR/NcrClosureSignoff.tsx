import { useState } from "react";
import { getFormLayout } from "../../components/forms/layouts";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { useFormSign } from "../../components/forms/formSign";
import { layoutSignatureBlocks } from "../../components/forms/signatureRequired";
import { NCR_CLOSURE_CERTIFY, closureRoleLabel, isNotRequiredMark, missingClosureSignatures } from "../../lib/ncrDocument";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useToast } from "../../components/shared/ToastProvider";
import { apiClient } from "../../api/client";

type Row = Record<string, unknown>;

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.map((row) => ({ ...(row as Row) })) : [];
}

/**
 * Closure signatures for NCR. Row 0 is the required Quality Manager sign-off
 * (needs ncr.closure_signoff permission, never Not required). Other rows can be
 * marked Not required with PIN + "I certify" via SignatureStamp.
 */
export function NcrClosureSignoff({
  data,
  canEdit,
  onChange,
  onPreview,
  ncrId,
}: {
  data: Record<string, unknown>;
  canEdit: boolean;
  onChange: (name: string, value: unknown) => void;
  onPreview: (name: string, value: unknown) => void;
  ncrId: number;
}) {
  const sign = useFormSign();
  const toast = useToast();
  const layout = getFormLayout("ncr");
  const blocks = layout ? layoutSignatureBlocks(layout).filter((block) => block.path.startsWith("closureApprovals.")) : [];
  const missing = missingClosureSignatures(data);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  if (blocks.length === 0) return null;

  function writeStamp(path: string, stamp: string, signedOn?: string) {
    const index = Number(path.split(".")[1]);
    const rows = rowsOf(data.closureApprovals);
    while (rows.length <= index) rows.push({});
    const current = rows[index] ?? {};
    rows[index] = { ...current, signature: stamp, ...(signedOn && !current.date ? { date: signedOn } : {}) };
    onPreview("closureApprovals", rows);
  }

  async function handleNotRequired(blockPath: string, pin: string, certified: boolean, reason?: string) {
    setBusy(blockPath);
    try {
      const { data: result } = await apiClient.post(`/forms/ncr/${ncrId}/mark-not-required`, {
        path: blockPath,
        pin,
        certified,
        description: "Mark closure row Not required",
        ...(reason ? { reason } : {}),
      });
      writeStamp(blockPath, result.mark, result.signedOn);
    } catch (err) {
      // Rethrow so SignatureStamp shows the error inline and keeps the tick.
      throw err;
    } finally {
      setBusy(null);
    }
  }

  async function handleClearNotRequired(blockPath: string, pin: string, certified: boolean) {
    setBusy(blockPath);
    try {
      await apiClient.post(`/forms/ncr/${ncrId}/clear-not-required`, {
        path: blockPath,
        pin,
        certified,
        description: "Clear Not required mark",
      });
      writeStamp(blockPath, "", "");
    } catch (err) {
      // Rethrow so SignatureStamp shows the error inline and keeps the tick.
      throw err;
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" data-testid="ncr-closure-checklist">
      <div>
        <h2 className="text-sm font-medium">Closure signatures</h2>
        <p className="text-xs text-muted-foreground">Required roles sign before this NCR can close. Mark a role Not required when that approval does not apply.</p>
      </div>
      {missing.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-destructive">
          {missing.map((item) => (
            <li key={item.path}>Still needed: {item.label}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Every required signature is on this NCR.</p>
      )}
      <ul className="flex flex-col gap-3">
        {blocks.map((block) => {
          const index = Number(block.path.split(".")[1]);
          const row = rowsOf(data.closureApprovals)[index] ?? {};
          const label = closureRoleLabel(block.label);
          const sig = typeof row.signature === "string" ? row.signature : "";
          const isMarked = isNotRequiredMark(sig);
          const isRow0 = index === 0;
          return (
            <li key={block.path} className="border-t border-border pt-3">
              <p className="mb-1 text-sm font-medium">{label}</p>
              <SignatureStamp
                value={sig}
                certify={NCR_CLOSURE_CERTIFY}
                disabled={!canEdit || !sign || busy === block.path}
                onSign={async (pin: string, certified: boolean) => {
                  if (!sign) return;
                  try {
                    const result = await sign({ path: block.path, description: NCR_CLOSURE_CERTIFY, pin, certified });
                    writeStamp(block.path, result.stamp, result.signedOn);
                  } catch (err) {
                    // Rethrow so SignatureStamp shows the error inline and keeps the tick.
                    throw err;
                  }
                }}
              />
              {!isRow0 && !sig && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Or mark Not required (requires PIN + I certify):</p>
                  <input
                    type="text"
                    placeholder="Reason (optional)"
                    maxLength={500}
                    value={reasons[block.path] ?? ""}
                    onChange={(e) => setReasons((prev) => ({ ...prev, [block.path]: e.target.value }))}
                    disabled={!canEdit || busy === block.path}
                    className="mb-1 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                  />
                  <SignatureStamp
                    value=""
                    certify="I certify this approval is not required for closure."
                    disabled={!canEdit || busy === block.path}
                    onSign={(pin, certified) => handleNotRequired(block.path, pin, certified, reasons[block.path]?.trim() || undefined)}
                  />
                </div>
              )}
              {!isRow0 && isMarked && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Clear the Not required mark (requires PIN + I certify):</p>
                  <SignatureStamp
                    value=""
                    certify="I certify clearing this Not required mark."
                    disabled={!canEdit || busy === block.path}
                    onSign={(pin, certified) => handleClearNotRequired(block.path, pin, certified)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
