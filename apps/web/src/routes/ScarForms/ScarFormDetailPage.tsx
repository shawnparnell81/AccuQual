import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useAuthStore } from "../../store/authStore";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { PictureRecordProvider } from "../../components/forms/pictureRecord";
import { PictureText } from "../../components/forms/PictureText";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { choiceOf, withChoice, type SignatureChoice } from "../../components/forms/signatureRequired";
import { usePictureRecord } from "../../components/forms/pictureRecord";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import type { ScarForm, Supplier } from "../../api/types";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { BrandMark } from "../../components/brand/DmaLogo";

const scarHooks = createResourceHooks<ScarForm>("scar-forms");

/** Fixed header, five root-cause fields, and fixed CAPA and sign-off rows. See scarForms.ts. */
export function ScarFormDetailPage() {
  const { id } = useParams();
  const scarId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const logoUrl = useAuthStore((s) => s.company?.branding?.logoUrl);
  const { data: scar, isLoading, isError } = scarHooks.useOne(scarId);
  const queryClient = useQueryClient();
  // a real supplier link (supplierId), added alongside the
  // pre-existing free-text supplierName field so a SCAR can actually
  // surface in that supplier's Supplier Portal / Quality Risk Score
  // factors — see scarForms.ts's own schema comment.
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["suppliers"], queryFn: async () => (await apiClient.get("/suppliers")).data });

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiClient.patch(`/scar-forms/${scarId}`, body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scar-forms", scarId] }),
    onError: (err: unknown) => toast.error(extractErrorMessage(err, "Couldn't update.")),
  });
  const sign = useMutation({
    mutationFn: async ({ field, pin }: { field: "supplierRep" | "qualityEngineer"; pin: string }) =>
      (await apiClient.post(`/scar-forms/${scarId}/sign`, { field, pin, certified: true })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scar-forms", scarId] }),
  });

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !scar) return <LoadingPlaceholder />;

  return (
    <PictureRecordProvider entityType="scar_forms" entityId={scar.id}>
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <button onClick={() => navigate("/scar-forms")} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to list
        </button>
        <div className="flex gap-2">
          <label className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm">
            <input type="checkbox" checked={scar.status === "closed"} onChange={(e) => patch.mutate({ status: e.target.checked ? "closed" : "open" })} />
            Closed
          </label>
          <DeleteRecordButton resource="scar-forms" id={scarId} kind="SCAR" title={scar.scarNumber || scar.partNumberDescription} ownerIds={[scar.createdBy]} navigateTo="/scar-forms" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 print:border-black print:bg-white print:text-black">
        <div className="aq-doc-head flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 print:border-black">
          <div className="flex items-center gap-3">
            <BrandMark logoUrl={logoUrl} />
            <div>
              <h1 className="text-xl font-semibold uppercase tracking-wide">Supplier Corrective Action Request</h1>
              <p className="text-xs text-muted-foreground print:text-black">Quality Management System — SCAR Form</p>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground print:text-black">
            <div>SCAR NO.</div>
            <div className="text-lg font-semibold text-foreground print:text-black">#{scar.id}</div>
          </div>
        </div>

        <Section title="1. Tracking & Supplier Details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SCAR Number" value={scar.scarNumber} onSave={(v) => patch.mutate({ scarNumber: v || null })} />
            <Field label="Date Issued" type="date" value={scar.dateIssued?.slice(0, 10)} onSave={(v) => patch.mutate({ dateIssued: v || null })} />
            <Field label="Supplier Name" value={scar.supplierName} onSave={(v) => patch.mutate({ supplierName: v || null })} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">Linked Supplier Record</span>
              <select
                value={scar.supplierId ?? ""}
                onChange={(e) => patch.mutate({ supplierId: e.target.value ? Number(e.target.value) : null })}
                className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary print:hidden"
              >
                <option value="">Not linked</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Response Due Date" type="date" value={scar.responseDueDate?.slice(0, 10)} onSave={(v) => patch.mutate({ responseDueDate: v || null })} />
            <Field label="Contact Person" value={scar.contactPerson} onSave={(v) => patch.mutate({ contactPerson: v || null })} />
            <Field label="PO Number" value={scar.poNumber} onSave={(v) => patch.mutate({ poNumber: v || null })} />
            <Field label="Part Number / Description" value={scar.partNumberDescription} onSave={(v) => patch.mutate({ partNumberDescription: v || null })} />
            <Field label="Lot / Heat Number" value={scar.lotHeatNumber} onSave={(v) => patch.mutate({ lotHeatNumber: v || null })} />
          </div>
        </Section>

        <Section title="2. Non-Conformance Description">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity Inspected" value={scar.quantityInspected} onSave={(v) => patch.mutate({ quantityInspected: v || null })} />
            <Field label="Quantity Rejected" value={scar.quantityRejected} onSave={(v) => patch.mutate({ quantityRejected: v || null })} />
          </div>
          <TextAreaField label="Defect Description" hint="Detailed explanation of failure, standard requirement vs. actual measured condition" value={scar.defectDescription} onSave={(v) => patch.mutate({ defectDescription: v || null })} />
        </Section>

        <Section title="3. Immediate Containment Action (Within 24 Hours)">
          <div className="mb-4">
            <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">Quarantined Inventory</span>
            <div className="mt-1 flex flex-wrap gap-4">
              {(
                [
                  ["quarantineAtSupplier", "At Supplier"],
                  ["quarantineInTransit", "In Transit"],
                  ["quarantineAtCustomerSite", "At Customer Site"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={scar[key]} onChange={(e) => patch.mutate({ [key]: e.target.checked })} className="print:accent-black" />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <TextAreaField label="Containment Plan" hint="Action taken to prevent further non-conforming product from being processed or shipped" value={scar.containmentPlan} onSave={(v) => patch.mutate({ containmentPlan: v || null })} />
        </Section>

        <Section title="4. Root Cause Analysis (5-Why Method)">
          <div className="flex flex-col gap-3">
            {(["why1", "why2", "why3", "why4", "why5"] as const).map((key, i) => (
              <Field key={key} label={`Why ${i + 1}`} value={scar[key]} onSave={(v) => patch.mutate({ [key]: v || null })} />
            ))}
          </div>
        </Section>

        <Section title="5. Corrective & Preventive Action (CAPA) Plan">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="bg-foreground text-background print:bg-black print:text-white">
                  <th className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">Action Item</th>
                  <th className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">Owner</th>
                  <th className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">Target Date</th>
                </tr>
              </thead>
              <tbody>
                <CapaRow label="1. Permanent Corrective Action" owner={scar.correctiveActionOwner} date={scar.correctiveActionTargetDate} onOwner={(v) => patch.mutate({ correctiveActionOwner: v || null })} onDate={(v) => patch.mutate({ correctiveActionTargetDate: v || null })} />
                <CapaRow label="2. Preventive Action" owner={scar.preventiveActionOwner} date={scar.preventiveActionTargetDate} onOwner={(v) => patch.mutate({ preventiveActionOwner: v || null })} onDate={(v) => patch.mutate({ preventiveActionTargetDate: v || null })} />
                <CapaRow label="3. Process/SOP Update" owner={scar.processUpdateOwner} date={scar.processUpdateTargetDate} onOwner={(v) => patch.mutate({ processUpdateOwner: v || null })} onDate={(v) => patch.mutate({ processUpdateTargetDate: v || null })} />
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="6. Sign-Off & Verification" last>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="bg-foreground text-background print:bg-black print:text-white">
                  <th className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">Role</th>
                  <th className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">Signature</th>
                  <th className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">Date</th>
                </tr>
              </thead>
              <tbody>
                <SignRow label="Supplier Representative" signature={scar.supplierRepSignature} date={scar.supplierRepDate} certify="I certify that this supplier response is accurate." onSign={(pin) => sign.mutateAsync({ field: "supplierRep", pin })} requirement={{ value: choiceOf(scar, "supplierRepSignature"), onChange: (choice: SignatureChoice) => patch.mutate({ signatureRequired: withChoice(scar, "supplierRepSignature", choice) }) }} />
                <SignRow label="Quality Engineer" signature={scar.qualityEngineerSignature} date={scar.qualityEngineerDate} certify="I certify that this supplier corrective action has been reviewed." onSign={(pin) => sign.mutateAsync({ field: "qualityEngineer", pin })} requirement={{ value: choiceOf(scar, "qualityEngineerSignature"), onChange: (choice: SignatureChoice) => patch.mutate({ signatureRequired: withChoice(scar, "qualityEngineerSignature", choice) }) }} />
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <div className="flex flex-col gap-4 print:hidden">
        <AttachmentsPanel entityType="scar_forms" entityId={scarId} />
        <WorkflowHistoryPanel moduleName="scar_forms" recordId={scarId} />
      </div>
    </div>
    </PictureRecordProvider>
  );
}

function Section({ title, children, last = false }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={last ? "mt-6" : "mt-6"}>
      <h2 className="mb-2 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, value, onSave, type = "text" }: { label: string; value: string | null | undefined; onSave: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">{label}</span>
      <input
        type={type}
        defaultValue={value ?? ""}
        onBlur={(e) => e.target.value !== (value ?? "") && onSave(e.target.value)}
        className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary print:border-black print:bg-white print:text-black"
      />
    </label>
  );
}

function TextAreaField({ label, hint, value, onSave }: { label: string; hint?: string; value: string | null | undefined; onSave: (v: string) => void }) {
  const record = usePictureRecord();
  const text = value ?? "";
  return (
    <label className="mt-3 flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">{label}</span>
      {hint && <span className="text-xs italic text-muted-foreground print:text-black">{hint}</span>}
      {record ? (
        <PictureText
          value={text}
          entityType={record.entityType}
          entityId={record.entityId}
          rows={2}
          className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary print:border-black print:bg-white print:text-black"
          onChange={(next) => next !== text && onSave(next)}
        />
      ) : (
        <textarea
          defaultValue={text}
          rows={2}
          onBlur={(e) => e.target.value !== text && onSave(e.target.value)}
          className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary print:border-black print:bg-white print:text-black"
        />
      )}
    </label>
  );
}

function CapaRow({ label, owner, date, onOwner, onDate }: { label: string; owner: string | null; date: string | null; onOwner: (v: string) => void; onDate: (v: string) => void }) {
  return (
    <tr>
      <td className="border border-border px-2 py-1.5 print:border-black">{label}</td>
      <td className="border border-border p-0 print:border-black">
        <input defaultValue={owner ?? ""} onBlur={(e) => e.target.value !== (owner ?? "") && onOwner(e.target.value)} className="w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary print:text-black" />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input type="date" defaultValue={date?.slice(0, 10) ?? ""} onBlur={(e) => e.target.value !== (date?.slice(0, 10) ?? "") && onDate(e.target.value)} className="w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary print:text-black" />
      </td>
    </tr>
  );
}

function SignRow({ label, signature, date, certify, onSign, requirement }: { label: string; signature: string | null; date: string | null; certify: string; onSign: (pin: string) => Promise<unknown>; requirement?: { value: SignatureChoice; disabled?: boolean; onChange: (next: SignatureChoice) => void } }) {
  const shown = date ? new Date(date).toLocaleString() : "—";
  return (
    <tr>
      <td className="border border-border px-2 py-1.5 print:border-black">{label}</td>
      <td className="border border-border p-1 print:border-black">
        <SignatureStamp value={signature} certify={certify} variant="sheet" requirement={requirement} onSign={onSign} />
      </td>
      <td className="border border-border px-2 py-1.5 text-xs print:border-black">{shown}</td>
    </tr>
  );
}
