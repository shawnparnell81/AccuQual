import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useAuthStore } from "../../store/authStore";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { getQmsFormDefinition, isRetiredQmsFormType } from "./qmsFormDefinitions";
import type { QmsForm, QmsFormRow, QmsFormStatus } from "../../api/types";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { PictureBoundText } from "../../components/forms/PictureText";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import type { SignatureChoice } from "../../components/forms/signatureRequired";
import { BrandMark } from "../../components/brand/DmaLogo";

const qmsFormHooks = createResourceHooks<QmsForm>("qms-forms");
const STATUSES: QmsFormStatus[] = ["draft", "active", "obsolete"];

/**
 * The generic QMS Simple Form record page — one real, editable, printable
 * page reused by all 35 "ACCUQUAL Forms" batch form types sharing the
 * generic header + named table sections + comments shape (see
 * qmsFormDefinitions.ts). Styled with the app's own theme tokens
 * (bg-card/border-border/etc.) rather than a one-off custom color scheme —
 * unlike the Work Order traveler/Document Change Request, which were
 * confirmed exceptions before this batch's own explicit "follow the color
 * scheme of the app" instruction.
 */
export function QmsFormRecordPage() {
  const { formType, id } = useParams();
  const formId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const logoUrl = useAuthStore((s) => s.company?.branding?.logoUrl);
  const definition = getQmsFormDefinition(formType!);

  const { data: record, isLoading, isError } = qmsFormHooks.useOne(formId);

  const queryClient = useQueryClient();

  const patchHeader = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiClient.patch(`/qms-forms/${formId}`, body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qms-forms", formId] }),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update.")),
  });

  const addRow = useMutation({
    mutationFn: async (sectionKey: string) => (await apiClient.post(`/qms-forms/${formId}/rows`, { sectionKey })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qms-forms", formId] }),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that row.")),
  });
  const patchRow = useMutation({
    mutationFn: async ({ rowId, data }: { rowId: number; data: Record<string, string> }) => (await apiClient.patch(`/qms-forms/${formId}/rows/${rowId}`, { data })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qms-forms", formId] }),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update that row.")),
  });
  const deleteRow = useMutation({
    mutationFn: async (rowId: number) => apiClient.delete(`/qms-forms/${formId}/rows/${rowId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qms-forms", formId] }),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove that row.")),
  });
  const signRow = useMutation({
    mutationFn: async ({ rowId, pin }: { rowId: number; pin: string }) =>
      (await apiClient.post(`/qms-forms/${formId}/rows/${rowId}/sign`, { pin, certified: true })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qms-forms", formId] }),
  });

  if (!definition) return <p className="text-sm text-destructive">Unknown form type "{formType}".</p>;
  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !record) return <LoadingPlaceholder />;

  const rowsBySection = (sectionKey: string) => (record.rows ?? []).filter((r) => r.sectionKey === sectionKey);
  const retired = isRetiredQmsFormType(formType);
  const backTo = retired ? "/documents/master-list" : `/qms-forms/${formType}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <button onClick={() => navigate(backTo)} className="text-sm text-muted-foreground hover:text-foreground">
          {retired ? "← Master Document List" : "← Back to list"}
        </button>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
          <DeleteRecordButton resource="qms-forms" id={formId} kind={definition.title} title={record.formNo} ownerIds={[record.createdBy]} navigateTo={backTo} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 print:border-black print:bg-white print:text-black">
        <div className="aq-doc-head flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 print:border-black">
          <div className="flex items-center gap-3">
            <BrandMark logoUrl={logoUrl} />
            <div>
              <h1 className="text-xl font-semibold uppercase tracking-wide">{definition.title}</h1>
              <p className="text-xs text-muted-foreground print:text-black">{definition.subtitle}</p>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground print:text-black">
            <div>FORM NO.</div>
            <div className="text-lg font-semibold text-foreground print:text-black">#{record.id}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <HeaderField label="Form No." value={record.formNo} onSave={(v) => patchHeader.mutate({ formNo: v || null })} />
          <HeaderField label="Revision" value={record.revision || "A"} readOnly />
          <HeaderField label="Effective Date" type="date" value={record.effectiveDate ? record.effectiveDate.slice(0, 10) : ""} onSave={(v) => patchHeader.mutate({ effectiveDate: v || null })} />
          <HeaderField label="Prepared By" value={record.preparedBy} onSave={(v) => patchHeader.mutate({ preparedBy: v || null })} />
          <HeaderField label="Approved By" value={record.approvedBy} onSave={(v) => patchHeader.mutate({ approvedBy: v || null })} />
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">Status</span>
            <div className="flex flex-wrap gap-3 pt-1">
              {STATUSES.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm capitalize">
                  <input type="checkbox" checked={record.status === s} onChange={() => patchHeader.mutate({ status: s })} className="print:accent-black" />
                  {s}
                </label>
              ))}
            </div>
          </div>
        </div>

        {definition.sections.map((section) => (
          <div key={section.key} className="mt-6">
            <h2 className="mb-2 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black">
              {section.label}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="bg-foreground text-background print:bg-black print:text-white">
                    {section.columns.map((col) => (
                      <th key={col.key} className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">
                        {col.label}
                      </th>
                    ))}
                    <th className="w-8 border border-border print:hidden" />
                  </tr>
                </thead>
                <tbody>
                  {rowsBySection(section.key).length === 0 && (
                    <tr>
                      <td colSpan={section.columns.length + 1} className="border border-border px-2 py-2 text-center text-muted-foreground print:border-black">
                        No rows yet.
                      </td>
                    </tr>
                  )}
                  {rowsBySection(section.key).map((row) => (
                    <QmsRow key={row.id} row={row} columns={section.columns} showRequired={section.columns.some((column) => column.key === "signature") && rowsBySection(section.key).length > 1} onPatch={(data) => patchRow.mutate({ rowId: row.id, data })} onDelete={() => deleteRow.mutate(row.id)} onSign={(pin) => signRow.mutateAsync({ rowId: row.id, pin })} />
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={() => addRow.mutate(section.key)} disabled={addRow.isPending} className="mt-2 rounded-md border border-dashed border-primary px-3 py-1.5 text-xs text-primary hover:bg-primary/10 print:hidden">
              + Add Row
            </button>
          </div>
        ))}

        <div className="mt-6">
          <h2 className="mb-2 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black">
            Additional Comments / Attachments
          </h2>
          <PictureBoundText
            className="w-full rounded-md border border-border bg-background p-2 text-sm print:border-black print:bg-white print:text-black"
            rows={3}
            allowInsert={false}
            saved={record.additionalComments ?? ""}
            entityType="qms_forms"
            entityId={formId}
            onSave={(value) => patchHeader.mutate({ additionalComments: value || null })}
          />
        </div>
      </div>

      <div className="print:hidden">
        <WorkflowHistoryPanel moduleName="qms_forms" recordId={formId} />
      </div>
    </div>
  );
}

function HeaderField({ label, value, onSave, type = "text", readOnly = false }: { label: string; value: string | null | undefined; onSave?: (v: string) => void; type?: string; readOnly?: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">{label}</span>
      <input
        type={type}
        defaultValue={value ?? ""}
        readOnly={readOnly}
        onBlur={(e) => !readOnly && onSave && e.target.value !== (value ?? "") && onSave(e.target.value)}
        className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary read-only:bg-muted print:border-black print:bg-white print:text-black"
      />
    </label>
  );
}

function QmsRow({
  row,
  columns,
  showRequired,
  onPatch,
  onDelete,
  onSign,
}: {
  row: QmsFormRow;
  columns: { key: string; label: string }[];
  showRequired: boolean;
  onPatch: (data: Record<string, string>) => void;
  onDelete: () => void;
  onSign: (pin: string) => Promise<unknown>;
}) {
  return (
    <tr>
      {columns.map((col) => (
        <td key={col.key} className="border border-border p-0 print:border-black">
          {col.key === "signature" ? (
            <SignatureStamp
              value={row.data.signature ?? ""}
              certify="I certify that this entry is accurate and complete."
              variant="sheet"
              requirement={
                showRequired
                  ? {
                      value: row.data.signatureRequired === "no" ? "no" : "yes",
                      onChange: (next: SignatureChoice) => onPatch({ ...row.data, signatureRequired: next }),
                    }
                  : undefined
              }
              onSign={onSign}
            />
          ) : (
            <input
              defaultValue={row.data[col.key] ?? ""}
              onBlur={(e) => e.target.value !== (row.data[col.key] ?? "") && onPatch({ ...row.data, [col.key]: e.target.value })}
              className="w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary print:text-black"
            />
          )}
        </td>
      ))}
      <td className="border border-border text-center print:hidden">
        <button onClick={onDelete} title="Remove row" className="px-1 text-muted-foreground hover:text-destructive">
          ✕
        </button>
      </td>
    </tr>
  );
}
