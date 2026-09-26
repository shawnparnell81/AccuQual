import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { labelForRequiredDocument, useControlledDocuments } from "../../api/documents";
import { useAuthStore } from "../../store/authStore";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { FEASIBILITY_AREAS, FEASIBILITY_AREA_LABELS } from "../../api/types";
import type { FeasibilityReview, FeasibleValue, FeasibilityRiskLevel, FeasibilityDetermination, FeasibilitySettings } from "../../api/types";

const ASSESSMENT_QUESTIONS: Record<(typeof FEASIBILITY_AREAS)[number], string> = {
  design: "Are engineering drawings, GD&T, and material specifications clear, complete, and within process capabilities (Cpk ≥ 1.33)?",
  equipment: "Are necessary machinery, custom tooling, fixtures, and secondary processing equipment available and qualified?",
  supplyChain: "Are raw materials, components, and outsourced treatments (e.g., heat treat, plating) available from approved suppliers within required lead times?",
  quality: "Are necessary gaging, CMM, inspection fixtures, and testing equipment available and calibrated to verify all critical features?",
  capacity: "Does plant capacity support the required production rates, cycle times, and customer delivery schedule without jeopardizing current commitments?",
  regulatory: "Does the product comply with applicable safety, environmental (RoHS/REACH), export controls, and Customer-Specific Requirements (CSRs)?",
  financial: "Do projected piece costs, setup costs, tooling expenditure, and payment terms meet organizational margin and ROI requirements?",
};

const DETERMINATIONS: { value: FeasibilityDetermination; label: string; description: string }[] = [
  { value: "feasible_as_quoted", label: "FEASIBLE AS QUOTED", description: "The product or project can be manufactured as specified without modifications. Technical, quality, capacity, and cost criteria are fully satisfied." },
  { value: "feasible_with_conditions", label: "FEASIBLE WITH CONDITIONS", description: "Feasible provided that specific customer concessions, drawing changes, lead time adjustments, or tooling capital approvals are accepted in writing." },
  { value: "not_feasible", label: "NOT FEASIBLE", description: "Cannot be produced due to unresolvable design constraints, lack of equipment capability, prohibitive costs, or regulatory compliance risks." },
];

/** One sign-off row's own department ownership — mirrors feasibility.controller.ts's SIGNOFF_OWNER exactly. */
const SIGNOFF_ROWS: { prefix: string; label: string; department: string }[] = [
  { prefix: "engineering", label: "Engineering", department: "engineering" },
  { prefix: "quality", label: "Quality Assurance", department: "quality" },
  { prefix: "manufacturing", label: "Manufacturing / Operations", department: "production" },
  { prefix: "purchasing", label: "Supply Chain / Purchasing", department: "purchasing" },
  { prefix: "sales", label: "Sales / Commercial", department: "sales_and_marketing" },
];

function useFeasibilitySettings() {
  return useQuery<FeasibilitySettings>({ queryKey: ["settings/feasibility"], queryFn: async () => (await apiClient.get("/settings/feasibility")).data });
}

/**
 * The "Contract & Project Feasibility Review Form" (QMS-FR-001) — a real
 * document supplied by the user, mirrored field-for-field (not the app's
 * earlier weighted-dimension-scoring UI — see feasibility.ts's own schema
 * comment). Styled with the app's own theme tokens (bg-card/border-border/
 * border-l-4 border-primary section headers), same convention as Document
 * Change Request/QMS Forms/SCAR — not the mockup's own styling, which the
 * user explicitly said didn't need to be matched.
 */
export function FeasibilityReviewForm({ review }: { review: FeasibilityReview }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const logoUrl = useAuthStore((s) => s.company?.branding?.logoUrl);
  const user = useCurrentUser();
  const { data: settings } = useFeasibilitySettings();
  const requiredDocuments = settings?.requiredDocuments ?? [];
  const { data: catalog = [] } = useControlledDocuments(requiredDocuments.length > 0);

  const isAdmin = user?.roleName === "admin";
  const canEditRecord = isAdmin || user?.department === "engineering";
  const isFinal = review.status === "final";

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["feasibility", review.id] });

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiClient.put(`/feasibility/${review.id}`, body)).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save.")),
  });
  const patchSignoff = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiClient.patch(`/feasibility/${review.id}/signoff`, body)).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save that sign-off.")),
  });

  function field(key: keyof FeasibilityReview) {
    return {
      defaultValue: (review[key] as string) ?? "",
      onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.target.value !== ((review[key] as string) ?? "") && patch.mutate({ [key]: e.target.value || null }),
      disabled: !canEditRecord || isFinal,
    };
  }

  const inputClass = "w-full rounded-md border border-form-field bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary disabled:opacity-70 print:border-black print:bg-white print:text-black";
  const sectionHeaderClass = "mb-2 mt-6 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black";

  const canEditSignoffRow = (department: string) => isAdmin || user?.department === "engineering" || user?.department === department;

  return (
    <div className="rounded-lg border border-border bg-card p-6 print:border-black print:bg-white print:text-black">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 print:border-black">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="h-12 w-12 rounded-md border border-border object-cover print:border-black" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-muted text-xs font-semibold text-muted-foreground print:border-black">LOGO</div>
          )}
          <div>
            <h1 className="text-xl font-semibold uppercase tracking-wide">Contract &amp; Project Feasibility Review</h1>
            <p className="text-xs text-muted-foreground print:text-black">Quality Management System Form</p>
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground print:text-black">
          <div>REVIEW NO.</div>
          <div className="text-lg font-semibold text-foreground print:text-black">#{review.id}</div>
        </div>
      </div>

      <h2 className={sectionHeaderClass}>Document Control</h2>
      <div className="grid gap-4 sm:grid-cols-4">
        <LabeledInput label="Document ID" {...field("documentId")} />
        <LabeledInput label="Revision" {...field("revision")} />
        <LabeledInput label="Effective Date" type="date" {...field("effectiveDate")} value={review.effectiveDate ? review.effectiveDate.slice(0, 10) : undefined} />
        <LabeledInput label="Process Owner" {...field("processOwner")} />
      </div>

      <h2 className={sectionHeaderClass}>Project &amp; Customer Identification</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <LabeledInput label="Customer Name" {...field("customerName")} />
        <LabeledInput label="RFQ / Quote Number" {...field("rfqQuoteNumber")} />
        <LabeledInput label="Part / Project Name" {...field("partProjectName")} />
        <LabeledInput label="Part Number / Rev" {...field("partNumberRev")} />
        <LabeledInput label="Target Delivery Date" type="date" {...field("targetDeliveryDate")} value={review.targetDeliveryDate ? review.targetDeliveryDate.slice(0, 10) : undefined} />
        <LabeledInput label="Annual Estimated Volume" {...field("annualEstimatedVolume")} />
      </div>

      <h2 className={sectionHeaderClass}>Multi-Disciplinary Feasibility Assessment</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-foreground text-background print:bg-black print:text-white">
              {["Evaluation Area", "Assessment Criteria & Questions", "Feasible?", "Risk Level", "Corrective Action / Mitigation"].map((h) => (
                <th key={h} className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEASIBILITY_AREAS.map((area) => (
              <tr key={area}>
                <td className="border border-border px-2 py-1.5 text-xs font-medium align-top print:border-black">{FEASIBILITY_AREA_LABELS[area]}</td>
                <td className="border border-border px-2 py-1.5 text-xs text-muted-foreground align-top print:border-black print:text-black">{ASSESSMENT_QUESTIONS[area]}</td>
                <td className="border border-border p-0 align-top print:border-black">
                  <select
                    className={inputClass}
                    defaultValue={(review[`${area}Feasible` as keyof FeasibilityReview] as FeasibleValue) ?? ""}
                    onChange={(e) => patch.mutate({ [`${area}Feasible`]: e.target.value || null })}
                    disabled={!canEditRecord || isFinal}
                  >
                    <option value="">—</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="partial">Partial</option>
                  </select>
                </td>
                <td className="border border-border p-0 align-top print:border-black">
                  <select
                    className={inputClass}
                    defaultValue={(review[`${area}RiskLevel` as keyof FeasibilityReview] as FeasibilityRiskLevel) ?? ""}
                    onChange={(e) => patch.mutate({ [`${area}RiskLevel`]: e.target.value || null })}
                    disabled={!canEditRecord || isFinal}
                  >
                    <option value="">—</option>
                    <option value="low">Low</option>
                    <option value="medium">Med</option>
                    <option value="high">High</option>
                  </select>
                </td>
                <td className="border border-border p-0 align-top print:border-black">
                  <textarea
                    className={inputClass}
                    rows={2}
                    {...field(`${area}Mitigation` as keyof FeasibilityReview)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className={sectionHeaderClass}>Resource &amp; Tooling Requirements</h2>
      <div className="flex flex-col gap-3">
        <LabeledTextarea label="New Tooling / Equipment Required" {...field("newToolingEquipment")} placeholder="Specify tooling, tooling budget, and lead time, or write 'None'" />
        <LabeledTextarea label="Inspection / Gaging Needs" {...field("inspectionGagingNeeds")} placeholder="Specify specialized gages, custom fixtures, or third-party lab testing" />
        <LabeledTextarea label="Special Customer Requirements / Documentation" {...field("specialCustomerRequirements")} placeholder="PPAP Level, FMEA, Control Plan, Certificate of Conformance, Cleanroom Packaging, etc." />
      </div>

      <h2 className={sectionHeaderClass}>Feasibility Determination &amp; Conclusion</h2>
      <div className="flex flex-col gap-2">
        {DETERMINATIONS.map((d) => (
          <label key={d.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="determination"
              checked={review.determination === d.value}
              onChange={() => patch.mutate({ determination: d.value })}
              disabled={!canEditRecord || isFinal}
              className="mt-1 print:accent-black"
            />
            <span>
              <span className="font-semibold">{d.label}:</span> <span className="text-muted-foreground print:text-black">{d.description}</span>
            </span>
          </label>
        ))}
        <LabeledTextarea label="Notes / Conditional Requirements Summary" {...field("determinationNotes")} placeholder="Insert notes, assumptions, or specific conditions to include in the formal quote to customer" />
      </div>

      {requiredDocuments.length > 0 && (
        <>
          <h2 className={sectionHeaderClass}>Required Documents</h2>
          <div className="flex flex-wrap gap-4 print:hidden">
            {requiredDocuments.map((doc) => {
              const providedIds = (review.providedDocuments ?? []).map(String);
              const label = labelForRequiredDocument(doc, catalog);
              return (
                <label key={doc} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={providedIds.includes(doc)}
                    disabled={!canEditRecord || isFinal}
                    onChange={(e) => {
                      const next = e.target.checked ? [...providedIds, doc] : providedIds.filter((d) => d !== doc);
                      patch.mutate({ providedDocuments: next });
                    }}
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </>
      )}

      <h2 className={sectionHeaderClass}>Sign-off &amp; Authorizations</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-foreground text-background print:bg-black print:text-white">
              {["Department / Function", "Printed Name & Title", "Signature", "Date"].map((h) => (
                <th key={h} className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SIGNOFF_ROWS.map((row) => {
              const editable = canEditSignoffRow(row.department) && !isFinal;
              const nameKey = `${row.prefix}SignoffName`;
              const sigKey = `${row.prefix}SignoffSignature`;
              const dateKey = `${row.prefix}SignoffDate`;
              const dateValue = review[dateKey as keyof FeasibilityReview] as string | null;
              return (
                <tr key={row.prefix}>
                  <td className="border border-border px-2 py-1.5 text-xs font-medium print:border-black">{row.label}</td>
                  <td className="border border-border p-0 print:border-black">
                    <input
                      className={inputClass}
                      defaultValue={(review[nameKey as keyof FeasibilityReview] as string) ?? ""}
                      onBlur={(e) => e.target.value !== ((review[nameKey as keyof FeasibilityReview] as string) ?? "") && patchSignoff.mutate({ [nameKey]: e.target.value || null })}
                      disabled={!editable}
                    />
                  </td>
                  <td className="border border-border p-0 print:border-black">
                    <input
                      className={inputClass}
                      defaultValue={(review[sigKey as keyof FeasibilityReview] as string) ?? ""}
                      onBlur={(e) => e.target.value !== ((review[sigKey as keyof FeasibilityReview] as string) ?? "") && patchSignoff.mutate({ [sigKey]: e.target.value || null })}
                      disabled={!editable}
                      placeholder="Type name to sign"
                    />
                  </td>
                  <td className="border border-border px-2 py-1.5 text-xs text-muted-foreground print:border-black print:text-black">{dateValue ? new Date(dateValue).toLocaleDateString() : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  ...props
}: { label: string; value?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">{label}</span>
      <input
        {...props}
        defaultValue={value ?? props.defaultValue}
        className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary disabled:opacity-70 print:border-black print:bg-white print:text-black"
      />
    </label>
  );
}

function LabeledTextarea({
  label,
  ...props
}: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">{label}</span>
      <textarea
        rows={2}
        {...props}
        className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary disabled:opacity-70 print:border-black print:bg-white print:text-black"
      />
    </label>
  );
}
