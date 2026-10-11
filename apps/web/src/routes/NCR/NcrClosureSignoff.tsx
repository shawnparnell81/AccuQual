import { useState } from "react";
import { getFormLayout } from "../../components/forms/layouts";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { useFormSign } from "../../components/forms/formSign";
import { SIGNATURE_REQUIRED_KEY, choiceOf, layoutSignatureBlocks, withChoice, type SignatureChoice } from "../../components/forms/signatureRequired";
import { NCR_CLOSURE_CERTIFY, closureRoleLabel, isNotRequiredMark, missingClosureSignatures } from "../../lib/ncrDocument";
import { Modal } from "../../components/modals/Modal";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";

type Row = Record<string, unknown>;

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.map((row) => ({ ...(row as Row) })) : [];
}

/**
 * Closure roles come from the NCR form. Required Yes/No is the permission on each role.
 * Each required role signs with the same PIN and "I certify" stamp as the rest of the forms.
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
  const toast = useToast();
  const sign = useFormSign();
  const layout = getFormLayout("ncr");
  const blocks = layout ? layoutSignatureBlocks(layout).filter((block) => block.path.startsWith("closureApprovals.")) : [];
  const missing = missingClosureSignatures(data);
  const [notRequiredPath, setNotRequiredPath] = useState<string | null>(null);
  const [notRequiredReason, setNotRequiredReason] = useState("");
  if (blocks.length === 0) return null;

  function writeStamp(path: string, stamp: string, signedOn?: string) {
    const index = Number(path.split(".")[1]);
    const rows = rowsOf(data.closureApprovals);
    while (rows.length <= index) rows.push({});
    const current = rows[index] ?? {};
    rows[index] = { ...current, signature: stamp, ...(signedOn && !current.date ? { date: signedOn } : {}) };
    onPreview("closureApprovals", rows);
  }

  async function handleMarkNotRequired(pin: string) {
    if (!notRequiredPath) return;
    try {
      const response = await apiClient.post(`/forms/ncr/${ncrId}/mark-not-required`, {
        pin,
        certified: true,
        path: notRequiredPath,
        reason: notRequiredReason.trim() || undefined,
      });
      const { mark } = response.data as { mark: string };
      writeStamp(notRequiredPath, mark);
      setNotRequiredPath(null);
      setNotRequiredReason("");
      toast.success("Marked as not required.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to mark as not required.";
      toast.error(message);
      throw err;
    }
  }

  async function handleClearNotRequired(path: string, pin: string) {
    try {
      await apiClient.post(`/forms/ncr/${ncrId}/clear-not-required`, {
        pin,
        certified: true,
        path,
      });
      // Clear the signature field
      const index = Number(path.split(".")[1]);
      const rows = rowsOf(data.closureApprovals);
      if (rows[index]) {
        const { notRequiredReason, ...rest } = rows[index] as Row;
        rows[index] = { ...rest, signature: "" };
        onPreview("closureApprovals", rows);
      }
      toast.success("Not-required mark cleared.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to clear.";
      toast.error(message);
      throw err;
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
          const signature = typeof row.signature === "string" ? row.signature : "";
          const isMarked = isNotRequiredMark(signature);
          const isQualityManager = index === 0;
          return (
            <li key={block.path} className="border-t border-border pt-3">
              <p className="mb-1 text-sm font-medium">{label}</p>
              {isMarked ? (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">{signature}</p>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        const pin = window.prompt("Enter your 4-digit PIN to clear this mark:");
                        if (pin && /^\d{4}$/.test(pin)) {
                          void handleClearNotRequired(block.path, pin);
                        } else if (pin) {
                          toast.error("Enter a 4-digit PIN.");
                        }
                      }}
                      className="text-xs text-destructive hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <SignatureStamp
                    value={signature}
                    certify={NCR_CLOSURE_CERTIFY}
                    disabled={!canEdit || !sign}
                    requirement={{
                      value: choiceOf(data, block.path),
                      disabled: !canEdit,
                      onChange: (next: SignatureChoice) => onChange(SIGNATURE_REQUIRED_KEY, withChoice(data, block.path, next)),
                    }}
                    onSign={async (pin) => {
                      if (!sign) return;
                      const result = await sign({ path: block.path, description: NCR_CLOSURE_CERTIFY, pin });
                      writeStamp(block.path, result.stamp, result.signedOn);
                    }}
                  />
                  {!isQualityManager && canEdit && !signature && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNotRequiredPath(block.path);
                            setNotRequiredReason("");
                          }
                        }}
                        className="h-3.5 w-3.5"
                      />
                      Not required for this NCR
                    </label>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <Modal title="Mark as Not Required" isOpen={!!notRequiredPath} onClose={() => setNotRequiredPath(null)}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Your PIN signature is required. Your name and the date/time will be recorded.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Reason (optional)</span>
            <input
              type="text"
              value={notRequiredReason}
              onChange={(e) => setNotRequiredReason(e.target.value)}
              placeholder="Why is this signature not needed?"
              className="rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              maxLength={500}
            />
          </label>
          <SignatureStamp
            certify="I certify that this signature is not required for this NCR."
            onSign={handleMarkNotRequired}
          />
        </div>
      </Modal>
    </section>
  );
}
