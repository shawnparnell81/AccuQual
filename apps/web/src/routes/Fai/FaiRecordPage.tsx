import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useFaiLookups, useFaiRecord, useInvalidateFai, type FaiRecordDetail } from "../../api/fai";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCurrentUser } from "../../hooks/useAuth";
import { canApproveFai, judgeFrozen, type PassFailWord } from "../../lib/faiLogic";
import { faiFill } from "../../lib/qualitySheetLogic";
import { personLabel } from "../../lib/opsLanguage";
import { RecordFrame } from "../../components/records/RecordFrame";
import { rememberRecord } from "../../lib/recentRecords";
import { RecordReferences } from "../../components/records/WorkflowStepLinks";
import "../IsoForms/isoForm.css";

const CERTIFY = "I certify that I have reviewed this first article and that this decision is mine.";

interface DraftLine {
  id: number;
  actual: string;
  attributeResult: "Pass" | "Fail" | "";
}

export function FaiRecordPage() {
  const params = useParams();
  const id = Number(params.id);
  const record = useFaiRecord(id);
  const lookups = useFaiLookups();
  const invalidate = useInvalidateFai();
  const user = useCurrentUser();
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [comments, setComments] = useState("");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<number | null>(null);

  useEffect(() => {
    if (!record.data || loaded === record.data.id && lines.length === record.data.lines.length) return;
    if (!record.data) return;
    setLines(record.data.lines.map((line) => ({ id: line.id, actual: line.actual ?? "", attributeResult: line.attributeResult === "Pass" || line.attributeResult === "Fail" ? line.attributeResult : "" })));
    setComments(record.data.comments ?? "");
    setAssignee(record.data.assignedTo ? String(record.data.assignedTo) : "");
    setLoaded(record.data.id);
  }, [record.data, loaded, lines.length]);

  const data = record.data;
  useEffect(() => {
    if (!data) return;
    rememberRecord({ path: `/fai/records/${data.id}`, title: data.number, type: "FAI" }, user?.id);
  }, [data, user?.id]);
  const editable = data?.status === "open";
  const mayDecide = canApproveFai({ roleName: user?.roleName, department: user?.department }) && data?.status === "submitted";

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiClient.patch<FaiRecordDetail>(`/fai/records/${id}/lines`, {
          comments,
          lines: lines.map((line) => ({ id: line.id, actual: line.actual || null, attributeResult: line.attributeResult || null })),
        })
      ).data,
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (err) => setError(extractErrorMessage(err, "The results could not be saved.")),
  });
  const assign = useMutation({
    mutationFn: async () => (await apiClient.post(`/fai/records/${id}/assign`, { userId: Number(assignee) })).data,
    onSuccess: async () => invalidate(),
    onError: (err) => setError(extractErrorMessage(err, "The assignment could not be saved.")),
  });
  const submit = useMutation({
    mutationFn: async () => {
      await save.mutateAsync();
      return (await apiClient.post<FaiRecordDetail>(`/fai/records/${id}/submit`)).data;
    },
    onSuccess: async () => invalidate(),
    onError: (err) => setError(extractErrorMessage(err, "The first article could not be submitted.")),
  });

  async function downloadPdf() {
    const response = await apiClient.get(`/fai/records/${id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${data?.number ?? "first-article"}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (record.isLoading) return <p className="text-sm text-muted-foreground">Loading first article…</p>;
  if (record.isError || !data) return <p className="text-sm text-destructive">This first article could not be opened.</p>;

  return (
    <RecordFrame
      header={
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="/fai" className="text-xs text-primary hover:underline">First Article</Link>
          <h1 className="text-2xl font-semibold">{data.number}</h1>
        </div>
        {(data.status === "approved" || data.status === "rejected") && (
          <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => void downloadPdf()}>
            Download PDF
          </button>
        )}
      </div>
      }
      related={<RecordReferences modules={["fai", "csa_fai", "fuel_pump_fai"]} step={data.status} entityType="fai" entityId={data.id} />}
    >
      <div className="iso-wrap">
        <table className="iso" data-testid="fai-record-sheet" aria-label="First article record">
          <tbody>
            <tr>
              <td className="title" colSpan={6}>PRODUCTION PART APPROVAL — DIMENSIONAL TEST RESULTS</td>
            </tr>
            <tr>
              <td>{data.number}</td>
              <td colSpan={3}>First Article · {data.planName} · revision {data.planRevision}</td>
              <td>Status</td>
              <td>{data.status === "rejected" ? "Not approved" : data.status === "submitted" ? "Submitted for Quality review" : data.status === "approved" ? "Approved" : "Open"}</td>
            </tr>
            <tr>
              <td>Part number</td>
              <td>{data.partNumber}</td>
              <td>Part name</td>
              <td>{data.partName || "—"}</td>
              <td>Supplier</td>
              <td>{data.supplierName}</td>
            </tr>
            <tr>
              <td className="section" colSpan={6}>DIMENSIONAL TEST RESULTS</td>
            </tr>
            <tr>
              <td className="header">Balloon</td>
              <td className="header">Characteristic</td>
              <td className="header">Nominal</td>
              <td className="header">Limits</td>
              <td className="header">Actual</td>
              <td className="header">Pass / Fail</td>
            </tr>
            {data.lines.map((line, index) => {
              const draft = lines[index] ?? { id: line.id, actual: line.actual ?? "", attributeResult: "" };
              const result: PassFailWord = editable ? judgeFrozen(line, draft.actual, draft.attributeResult || null) : line.result === "Pass" || line.result === "Fail" ? line.result : "";
              return (
                <tr key={line.id}>
                  <td className="center">{line.balloon}</td>
                  <td>{line.name}</td>
                  <td className="center">{line.mode === "attribute" ? "—" : line.nominal}</td>
                  <td>{line.limits}</td>
                  <td>
                    {line.mode === "attribute" ? (
                      <select className="iso-in center" aria-label={`Actual ${index + 1}`} value={draft.attributeResult} disabled={!editable} onChange={(event) => setLines((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, attributeResult: event.target.value === "Fail" ? "Fail" : event.target.value === "Pass" ? "Pass" : "" } : row)))}>
                        <option value=""></option>
                        <option value="Pass">Pass</option>
                        <option value="Fail">Fail</option>
                      </select>
                    ) : (
                      <input className="iso-in center" aria-label={`Actual ${index + 1}`} value={draft.actual} disabled={!editable} onChange={(event) => setLines((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, actual: event.target.value } : row)))} />
                    )}
                  </td>
                  <td className={faiFill(result)} data-testid={`fai-record-result-${index}`}>{result}</td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={6} className="note">Blanket statements of conformance are unacceptable for any test results. Limits were copied when this first article was opened.</td>
            </tr>
            <tr>
              <td>Comments</td>
              <td colSpan={5}>
                <textarea className="iso-in" aria-label="Comments" value={comments} disabled={data.status === "approved" || data.status === "rejected"} onChange={(event) => setComments(event.target.value)} />
              </td>
            </tr>
            <tr>
              <td>Assigned</td>
              <td colSpan={3}>
                {editable ? (
                  <select className="iso-in" aria-label="Assigned to" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
                    <option value="">Unassigned</option>
                    {lookups.data?.people.map((person) => (
                      <option key={person.id} value={person.id}>{person.name?.trim() || person.email}</option>
                    ))}
                  </select>
                ) : (
                  personLabel(lookups.data?.people, data.assignedTo)
                )}
              </td>
              <td>Quality signature</td>
              <td>{data.qualitySignature || "—"}</td>
            </tr>
            {data.ncrId && (
              <tr>
                <td>Nonconformance</td>
                <td colSpan={5}><Link to={`/ncr/${data.ncrId}`} className="text-primary hover:underline">{data.ncrNumber}</Link></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="no-print flex flex-wrap gap-2">
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted" disabled={save.isPending} onClick={() => save.mutate()}>Save results</button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted" disabled={!assignee || assign.isPending} onClick={() => assign.mutate()}>Assign</button>
          <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60" disabled={submit.isPending} onClick={() => submit.mutate()}>Submit for Quality review</button>
        </div>
      )}
      {mayDecide && (
        <div className="no-print grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <p className="mb-1 text-xs font-semibold">Approve</p>
            <SignatureStamp value={null} certify={CERTIFY} variant="sheet" onSign={async (pin) => { await apiClient.post(`/fai/records/${id}/approve`, { pin, certified: true }); await invalidate(); }} />
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="mb-1 text-xs font-semibold">Do not approve</p>
            <SignatureStamp value={null} certify={CERTIFY} variant="sheet" onSign={async (pin) => { await apiClient.post(`/fai/records/${id}/reject`, { pin, certified: true }); await invalidate(); }} />
          </div>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {Number.isInteger(id) && <WorkflowHistoryPanel moduleName="fai" recordId={id} />}
    </RecordFrame>
  );
}
