import { getFormLayout } from "../../components/forms/layouts";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { useFormSign } from "../../components/forms/formSign";
import { SIGNATURE_REQUIRED_KEY, choiceOf, layoutSignatureBlocks, withChoice, type SignatureChoice } from "../../components/forms/signatureRequired";
import { NCR_CLOSURE_CERTIFY, closureRoleLabel, missingClosureSignatures } from "../../lib/ncrDocument";

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
}: {
  data: Record<string, unknown>;
  canEdit: boolean;
  onChange: (name: string, value: unknown) => void;
  onPreview: (name: string, value: unknown) => void;
}) {
  const sign = useFormSign();
  const layout = getFormLayout("ncr");
  const blocks = layout ? layoutSignatureBlocks(layout).filter((block) => block.path.startsWith("closureApprovals.")) : [];
  const missing = missingClosureSignatures(data);
  if (blocks.length === 0) return null;

  function writeStamp(path: string, stamp: string, signedOn?: string) {
    const index = Number(path.split(".")[1]);
    const rows = rowsOf(data.closureApprovals);
    while (rows.length <= index) rows.push({});
    const current = rows[index] ?? {};
    rows[index] = { ...current, signature: stamp, ...(signedOn && !current.date ? { date: signedOn } : {}) };
    onPreview("closureApprovals", rows);
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
          return (
            <li key={block.path} className="border-t border-border pt-3">
              <p className="mb-1 text-sm font-medium">{label}</p>
              <SignatureStamp
                value={typeof row.signature === "string" ? row.signature : ""}
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
