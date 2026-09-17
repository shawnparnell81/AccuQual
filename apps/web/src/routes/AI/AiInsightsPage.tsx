import { useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TrendingUp, ShieldQuestion, FileText, Mail } from "lucide-react";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";
import { SelectField, TextAreaField, TextField } from "../../components/forms/Field";
import type { Supplier, SupplierQualityFactors } from "../../api/types";

interface AiReportSummary {
  summary: string;
  watchItems: string[];
  trend: "improving" | "worsening" | "stable" | "insufficient_data";
}
interface AiRiskScoreOutput {
  score: number;
  riskFactors: string[];
  recommendedMitigations: string[];
}
/** Matches documentSummaryOutputSchema in ai.guardrails.ts exactly — a list of summary points, not a single paragraph. */
interface AiDocumentSummary {
  summary: string[];
}

const REPORT_TYPE_OPTIONS = [
  { value: "ncr_summary", label: "NCR Summary" },
  { value: "capa_summary", label: "CAPA Summary" },
  { value: "supplier_scorecard", label: "Supplier Scorecard" },
  { value: "warranty_summary", label: "Warranty / RMA Summary" },
  { value: "receiving_summary", label: "Receiving Inspection Summary" },
];

function Card({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-primary">{icon}</div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * AI Insights — rebuilt per the Buyer Evaluation audit's Finding W-5 and its
 * own explicit recommendation ("Turn AI Insights into a dashboard, not a
 * console: replace the pipeline-picker + raw-JSON-textarea with cards: a
 * plain-language defect trend narrative, a one-click 'why is this supplier
 * at risk,' and a weekly digest emailed to the Quality Manager").
 *
 * Every card below reuses real, already-built infrastructure rather than
 * inventing a new one — this page is a curated front door onto capabilities
 * that mostly already existed with no UI:
 *   - Defect Trend Narrative: /reporting/summary's "quality_trends" kind
 *     (Phase 6), which already loads real NCR metrics server-side — no
 *     hand-typed JSON needed, unlike the old /ai/analysis "predictive_quality"
 *     entry this page used to expose.
 *   - Supplier risk "why": /ai/risk-score fed with this supplier's own real
 *     GET /suppliers/:id/kpis data — a free-text AI opinion, deliberately
 *     distinct from the deterministic Quality Risk Score on that supplier's
 *     own Scorecard tab (see SupplierScorecard.tsx's own comment).
 *   - Document Summarizer: the one pipeline here with no other real UI
 *     entry point anywhere (audit_prep is superseded by AuditDetailPage's
 *     own per-audit "AI Prep Summary" button) — kept as an honest paste-text
 *     utility, not a JSON console.
 *   - Weekly Digest: a quick-subscribe front end onto the already-real,
 *     already-working /reporting/schedules engine (Phase 6) — admin-only,
 *     same gate ReportingHubPage.tsx's own Scheduled Reports section
 *     already enforces, so this never shows an action a viewer can't take.
 *
 * Every result is rendered through AiStructuredSuggestion, the same Phase
 * 5-standardized component every other AI touchpoint in this app uses — it
 * already refuses to show a stub/malformed payload as if it were real
 * content, which is exactly the guardrail the audit's Finding W-1 asked
 * for ("a stub or error payload must never be persisted as user-facing
 * record content").
 */
export function AiInsightsPage() {
  const toast = useToast();
  const currentUser = useCurrentUser();
  const isAdmin = currentUser?.roleName === "admin" || currentUser?.roleName === "platform_admin";

  const [supplierId, setSupplierId] = useState<number | "">("");
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["suppliers"], queryFn: async () => (await apiClient.get("/suppliers")).data });
  const { data: supplierKpis } = useQuery<SupplierQualityFactors>({
    queryKey: ["suppliers/kpis", supplierId],
    queryFn: async () => (await apiClient.get(`/suppliers/${supplierId}/kpis`)).data,
    enabled: supplierId !== "",
  });

  const [documentText, setDocumentText] = useState("");

  const [digestEmail, setDigestEmail] = useState(currentUser?.email ?? "");
  const [digestReportType, setDigestReportType] = useState("ncr_summary");
  const subscribeDigest = useMutation({
    mutationFn: async () => (await apiClient.post("/reporting/schedules", { reportType: digestReportType, frequency: "weekly", recipients: [digestEmail] })).data,
    onSuccess: () => toast.success(`Weekly ${REPORT_TYPE_OPTIONS.find((o) => o.value === digestReportType)?.label} digest scheduled for ${digestEmail}.`),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't schedule this digest.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">AI Insights</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every result below is a non-authoritative AI opinion, logged for review under Admin → AI Usage — never written back onto a real record automatically.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={<TrendingUp size={18} />} title="Defect Trend Narrative" description="A plain-language read on real, already-aggregated NCR metrics — what's notable, what's improving or worsening, and concrete watch-items.">
          <AiStructuredSuggestion<AiReportSummary>
            endpoint="/reporting/summary"
            title="Defect Trend Narrative"
            triggerLabel="Generate Narrative"
            acceptLabel="Acknowledge"
            buildPayload={() => ({ kind: "quality_trends" })}
            renderPreview={(output) => (
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  Trend: <strong className="capitalize">{output.trend.replace(/_/g, " ")}</strong>
                </p>
                <p className="text-muted-foreground">{output.summary}</p>
                {output.watchItems.length > 0 && (
                  <ul className="list-inside list-disc text-muted-foreground">
                    {output.watchItems.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          />
        </Card>

        <Card icon={<ShieldQuestion size={18} />} title="Why Is This Supplier At Risk?" description="A one-click AI explanation over this supplier's own real NCR/CAPA/RMA/warranty/delivery data — distinct from the deterministic Quality Risk Score on its Scorecard tab.">
          <SelectField label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Select a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          {supplierId === "" ? (
            <p className="text-xs text-muted-foreground">Pick a supplier above to explain its risk.</p>
          ) : !supplierKpis ? (
            <p className="text-xs text-muted-foreground">Loading this supplier's data…</p>
          ) : (
            <AiStructuredSuggestion<AiRiskScoreOutput>
              endpoint="/ai/risk-score"
              title="Why Is This Supplier At Risk?"
              triggerLabel="Explain Risk"
              acceptLabel="Acknowledge"
              buildPayload={() => ({ entityType: "supplier", entityId: supplierId, input: supplierKpis })}
              renderPreview={(output) => (
                <div className="flex flex-col gap-2 text-sm">
                  <p>
                    AI risk opinion: <strong className="tabular-nums">{output.score}</strong> / 100
                  </p>
                  {output.riskFactors.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Why</p>
                      <ul className="list-inside list-disc text-muted-foreground">
                        {output.riskFactors.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {output.recommendedMitigations.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Recommended mitigations</p>
                      <ul className="list-inside list-disc text-muted-foreground">
                        {output.recommendedMitigations.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            />
          )}
        </Card>

        <Card icon={<FileText size={18} />} title="Document Summarizer" description="Paste any text — a policy excerpt, an email thread, a long report — for a short AI summary and key points.">
          <TextAreaField label="Text to summarize" value={documentText} onChange={(e) => setDocumentText(e.target.value)} rows={4} />
          <AiStructuredSuggestion<AiDocumentSummary>
            endpoint="/ai/analysis"
            title="Document Summary"
            triggerLabel="Summarize"
            acceptLabel="Acknowledge"
            buildPayload={() => ({ kind: "document_summary", input: documentText })}
            renderPreview={(output) => (
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {output.summary.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          />
        </Card>

        {isAdmin && (
          <Card icon={<Mail size={18} />} title="Weekly Digest" description="Subscribe an inbox to a weekly emailed report — the same scheduled-reports engine as Reports → Scheduled Reports, one click from here.">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                subscribeDigest.mutate();
              }}
            >
              <SelectField label="Report" value={digestReportType} onChange={(e) => setDigestReportType(e.target.value)}>
                {REPORT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectField>
              <TextField label="Send to" type="email" value={digestEmail} onChange={(e) => setDigestEmail(e.target.value)} required />
              <button
                type="submit"
                disabled={subscribeDigest.isPending || !digestEmail}
                className="self-start rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {subscribeDigest.isPending ? "Scheduling…" : "Subscribe Weekly"}
              </button>
              <p className="text-xs text-muted-foreground">
                Manage every schedule — including this one — under{" "}
                <a href="/reporting" className="text-primary hover:underline">
                  Reports → Scheduled Reports
                </a>
                .
              </p>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
