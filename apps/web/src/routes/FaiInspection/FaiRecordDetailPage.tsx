import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useOpenTab } from "../../hooks/useOpenTab";
import { faiInspectionApi } from "../../api/faiInspection";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

const TRIGGER_REASONS = ["New part", "New supplier", "Supplier factory change", "Receiving location change", "6-month repeat", "Annual random pull", "Engineering change", "Other"];
const LEVELS = ["I", "II", "III", "S-1", "S-2", "S-3", "S-4"];
const SEVERITIES = ["Normal", "Tightened", "Reduced"];
const AQLS = ["0.010", "0.015", "0.025", "0.040", "0.065", "0.10", "0.15", "0.25", "0.40", "0.65", "1.0", "1.5", "2.5", "4.0", "6.5", "10.0"];
// The generic result-lines table and free-text linked-id inputs are superseded by the real attached
// validation form (see ValidationFormCard below) — kept, not deleted, behind this flag.
const SHOW_GENERIC_FORM = false;

export function FaiRecordDetailPage() {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const openTab = useOpenTab();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [signOutcome, setSignOutcome] = useState<"passed" | "failed">("passed");

  const { data: rec, isLoading } = useQuery({
    queryKey: ["fai-inspection", "record", id],
    queryFn: () => faiInspectionApi.records.get(Number(id)),
    enabled: !isNew,
  });
  const { data: plans } = useQuery({
    queryKey: ["fai-inspection", "plans"],
    queryFn: () => faiInspectionApi.plans.list(),
  });

  const [form, setForm] = useState<any>(null);
  const current = form ?? rec ?? {
    faiNumber: "", planId: "", partNumber: "", supplierFactory: "", receivingLocation: "",
    triggerReason: "", poReference: "", lotSize: "", inspector: "",
    datePulled: "", dateLabReceived: "", dateInspected: "",
    inspectionLevel: "II", severity: "Normal", majorAql: "1.0", minorAql: "2.5",
    linkedCsaFaiId: "", linkedFuelPumpFaiId: "", comments: "", status: "draft",
  };
  const set = (k: string, v: any) => setForm({ ...current, [k]: v });
  const locked = rec && ["passed", "failed", "cancelled"].includes(rec.status);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["fai-inspection", "records"] });
    queryClient.invalidateQueries({ queryKey: ["fai-inspection", "record", id] });
    queryClient.invalidateQueries({ queryKey: ["fai-inspection", "dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["fai-inspection", "sources"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const body: any = { ...current };
      delete body.id; delete body.lines;
      for (const k of ["planId", "lotSize", "linkedCsaFaiId", "linkedFuelPumpFaiId"]) {
        if (body[k] === "") body[k] = null; else if (body[k] != null) body[k] = Number(body[k]);
      }
      return isNew ? faiInspectionApi.records.create(body) : faiInspectionApi.records.update(Number(id), body);
    },
    onSuccess: (created) => {
      invalidate(); setForm(null); setError(null);
      if (isNew) navigate(`/fai-inspection/records/${created.id}`);
    },
    onError: (err) => setError(extractErrorMessage(err, "Could not save the record.")),
  });

  const saveLines = useMutation({
    mutationFn: async (lines: any[]) => faiInspectionApi.records.saveLines(Number(id), lines),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (err) => setError(extractErrorMessage(err, "Could not save results.")),
  });

  const del = useMutation({
    mutationFn: () => faiInspectionApi.records.delete(Number(id)),
    onSuccess: () => { invalidate(); navigate("/fai-inspection/records"); },
    onError: (err) => setError(extractErrorMessage(err, "Could not delete the record.")),
  });

  const sign = useMutation({
    mutationFn: async ({ pin, certified }: { pin: string; certified: boolean }) =>
      faiInspectionApi.records.sign(Number(id), { pin, certified: true, outcome: signOutcome, description: `FAI sign-off as ${signOutcome}` }),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (err) => { throw err; },
  });

  const submitSignoff = useMutation({
    mutationFn: () => faiInspectionApi.records.submitForSignoff(Number(id)),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (err) => setError(extractErrorMessage(err, "Could not submit the record for sign-off.")),
  });

  const createNcr = useMutation({
    mutationFn: () => faiInspectionApi.records.createNcr(Number(id)),
    onSuccess: (result) => {
      invalidate();
      setError(null);
      openTab({ path: `/ncr/${result.id}`, title: "NCR (from FAI)", icon: "alert-triangle" });
    },
    onError: (err) => setError(extractErrorMessage(err, "Could not create the NCR.")),
  });

  if (isLoading) return <div className="p-6">Loading…</div>;

  const lines = rec?.lines ?? [];

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-semibold mb-4">{isNew ? "New FAI Record" : `FAI ${current.faiNumber}`}</h1>
      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</div>}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <label className="block">FAI number*
          <input value={current.faiNumber} onChange={(e) => set("faiNumber", e.target.value)} disabled={!isNew} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100" />
        </label>
        <label className="block">Inspection plan
          <select value={current.planId ?? ""} onChange={(e) => set("planId", e.target.value)} disabled={!isNew} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100">
            <option value="">— none —</option>
            {(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.partNumber} rev {p.revision}</option>)}
          </select>
        </label>
        <label className="block">Part number*
          <input value={current.partNumber} onChange={(e) => set("partNumber", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100" />
        </label>
        <label className="block">Trigger reason
          <select value={current.triggerReason ?? ""} onChange={(e) => set("triggerReason", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100">
            <option value="">—</option>{TRIGGER_REASONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">PO / receipt reference
          <input value={current.poReference ?? ""} onChange={(e) => set("poReference", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100" />
        </label>
        <label className="block">Lot size
          <input type="number" value={current.lotSize ?? ""} onChange={(e) => set("lotSize", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100" />
        </label>
        <label className="block">Inspector
          <input value={current.inspector ?? ""} onChange={(e) => set("inspector", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100" />
        </label>
        <label className="block">Date sample pulled
          <input value={current.datePulled ?? ""} onChange={(e) => set("datePulled", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100" />
        </label>
        <label className="block">Date lab received
          <input value={current.dateLabReceived ?? ""} onChange={(e) => set("dateLabReceived", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100" />
        </label>
        <label className="block">Date inspected
          <input value={current.dateInspected ?? ""} onChange={(e) => set("dateInspected", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100" />
        </label>
        <label className="block">Supplier factory
          <input value={current.supplierFactory ?? ""} onChange={(e) => set("supplierFactory", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100" />
        </label>
        <label className="block">Receiving location
          <input value={current.receivingLocation ?? ""} onChange={(e) => set("receivingLocation", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100" />
        </label>
      </div>

      <h2 className="text-lg font-semibold mb-2">AQL Sampling (ANSI/ASQ Z1.4)</h2>
      <div className="grid grid-cols-4 gap-4 mb-4">
        <label className="block">Inspection level
          <select value={current.inspectionLevel} onChange={(e) => set("inspectionLevel", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100">
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="block">Severity
          <select value={current.severity} onChange={(e) => set("severity", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100">
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">Major AQL
          <select value={current.majorAql} onChange={(e) => set("majorAql", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100">
            {AQLS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="block">Minor AQL
          <select value={current.minorAql} onChange={(e) => set("minorAql", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100">
            {AQLS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      {rec?.codeLetter && (
        <div className="bg-gray-50 rounded p-3 mb-6 text-sm">
          Code letter <strong>{rec.codeLetter}</strong> · Sample size <strong>{rec.aqlSampleSize}</strong> ·
          Major Ac {rec.acMajor} / Re {rec.reMajor} · Minor Ac {rec.acMinor} / Re {rec.reMinor} ·
          Critical always Ac 0 / Re 1
        </div>
      )}

      {!isNew && (
        <ValidationFormCard
          recordId={Number(id)}
          faiNumber={current.faiNumber}
          attachedForms={rec?.attachedForms ?? []}
          canEdit={!!rec?.canEdit}
          locked={!!locked}
        />
      )}

      {!isNew && SHOW_GENERIC_FORM && (
        <>
          <h2 className="text-lg font-semibold mb-2">Linked validation forms</h2>
          <div className="flex gap-3 mb-6">
            <label className="block">CSA FAI record ID
              <input value={current.linkedCsaFaiId ?? ""} onChange={(e) => set("linkedCsaFaiId", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-40 mt-1 disabled:bg-gray-100" />
            </label>
            <label className="block">Fuel Pump FAI record ID
              <input value={current.linkedFuelPumpFaiId ?? ""} onChange={(e) => set("linkedFuelPumpFaiId", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-40 mt-1 disabled:bg-gray-100" />
            </label>
          </div>

          <h2 className="text-lg font-semibold mb-2">Characteristic results</h2>
          <ResultLinesTable lines={lines} locked={!!locked} onSave={(l) => saveLines.mutate(l)} />
        </>
      )}

      {!isNew && (
        <label className="block mb-6">Comments
          <textarea value={current.comments ?? ""} onChange={(e) => set("comments", e.target.value)} disabled={locked} className="border rounded px-3 py-2 w-full mt-1 disabled:bg-gray-100" rows={3} />
        </label>
      )}

      <div className="flex gap-3 mb-8">
        {!locked && (
          <>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="rounded bg-primary text-primary-foreground px-4 py-2 hover:opacity-90 disabled:opacity-50">Save</button>
            <button onClick={() => setForm(null)} className="rounded border px-4 py-2">Cancel</button>
          </>
        )}
        {!isNew && rec && ["draft", "in_inspection"].includes(rec.status) && rec.canEdit && (
          <button onClick={() => submitSignoff.mutate()} disabled={submitSignoff.isPending} className="rounded border px-4 py-2 disabled:opacity-50">Submit for sign-off</button>
        )}
        {!isNew && !locked && (
          <button onClick={() => setShowDelete(true)} className="rounded border border-red-300 text-red-700 px-4 py-2">Delete…</button>
        )}
        {!isNew && (
          <a href={faiInspectionApi.records.pdfUrl(Number(id))} target="_blank" rel="noreferrer" className="rounded border px-4 py-2">Download FAI Report PDF</a>
        )}
      </div>

      {!isNew && !locked && (
        <div className="border-t pt-6 mb-8">
          <h2 className="text-lg font-semibold mb-3">Sign-off</h2>
          <div className="flex gap-4 mb-4">
            <label className="flex items-center gap-2">
              <input type="radio" checked={signOutcome === "passed"} onChange={() => setSignOutcome("passed")} /> Pass
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={signOutcome === "failed"} onChange={() => setSignOutcome("failed")} /> Fail
            </label>
          </div>
          <SignatureStamp
            value={rec?.signature ?? ""}
            certify="I certify this FAI sign-off"
            onSign={async (pin, _certified) => { await sign.mutateAsync({ pin, certified: _certified }); }}
          />
        </div>
      )}

      {!isNew && rec?.status === "failed" && (
        <div className="border-t pt-6">
          <button
            onClick={() => createNcr.mutate()}
            disabled={createNcr.isPending}
            className="rounded bg-primary text-primary-foreground px-4 py-2 hover:opacity-90 disabled:opacity-50"
          >
            {rec.ncrId ? "Open NCR" : "Create NCR"}
          </button>
          <p className="text-xs text-gray-500 mt-2">Creates a new NCR pre-filled with the part, supplier, lot/PO and this FAI record, then opens it. Needs permission to create NCRs.</p>
        </div>
      )}

      {showDelete && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-96">
            <h2 className="text-lg font-semibold mb-3">Delete FAI record?</h2>
            <p className="text-sm mb-4">This removes {rec?.faiNumber} from lists, counts and folders. This is audit-logged and cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => del.mutate()} className="rounded bg-destructive text-destructive-foreground px-4 py-2">Delete</button>
              <button onClick={() => setShowDelete(false)} className="rounded border px-4 py-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultLinesTable({ lines, locked, onSave }: { lines: any[]; locked: boolean; onSave: (lines: any[]) => void }) {
  const [edits, setEdits] = useState<Record<number, any>>({});
  const setLine = (id: number, k: string, v: any) => setEdits({ ...edits, [id]: { ...edits[id], [k]: v } });

  const dirty = Object.keys(edits).length > 0;
  const payload = lines.map((l) => ({
    id: l.id,
    measuredValue: edits[l.id]?.measuredValue ?? l.measuredValue ?? null,
    attributeResult: edits[l.id]?.attributeResult ?? l.attributeResult ?? null,
    defects: edits[l.id]?.defects ?? l.defects ?? 0,
  }));

  return (
    <>
      <table className="w-full border-collapse mb-4">
        <thead>
          <tr className="border-b text-left text-sm">
            <th className="p-2">Characteristic</th><th className="p-2">Class</th><th className="p-2">Limits</th>
            <th className="p-2">Measured</th><th className="p-2">Attr</th><th className="p-2">Defects</th><th className="p-2">Result</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="p-2">{l.characteristicName}</td>
              <td className="p-2">{l.charType}</td>
              <td className="p-2 text-sm">{l.limitType === "attribute" ? "Pass/Fail" : `${l.limitLow ?? ""} – ${l.limitHigh ?? ""} ${l.unit ?? ""}`}</td>
              <td className="p-2">
                {l.limitType === "attribute" ? "—" : (
                  <input value={edits[l.id]?.measuredValue ?? l.measuredValue ?? ""} disabled={locked}
                    onChange={(e) => setLine(l.id, "measuredValue", e.target.value)} className="border rounded px-2 py-1 w-28 disabled:bg-gray-100" />
                )}
              </td>
              <td className="p-2">
                {l.limitType === "attribute" ? (
                  <select value={edits[l.id]?.attributeResult ?? l.attributeResult ?? ""} disabled={locked}
                    onChange={(e) => setLine(l.id, "attributeResult", e.target.value)} className="border rounded px-2 py-1 disabled:bg-gray-100">
                    <option value="">—</option><option value="pass">Pass</option><option value="fail">Fail</option>
                  </select>
                ) : "—"}
              </td>
              <td className="p-2">
                <input type="number" min={0} value={edits[l.id]?.defects ?? l.defects ?? 0} disabled={locked}
                  onChange={(e) => setLine(l.id, "defects", Number(e.target.value))} className="border rounded px-2 py-1 w-20 disabled:bg-gray-100" />
              </td>
              <td className="p-2 font-medium">{(l.result ?? "").toUpperCase()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!locked && dirty && (
        <button onClick={() => { onSave(payload); setEdits({}); }} className="rounded bg-primary text-primary-foreground px-4 py-2 mb-6">Save results</button>
      )}
    </>
  );
}

const ATTACHABLE: { formType: "csa" | "fuel_pump"; label: string }[] = [
  { formType: "csa", label: "Attach CSA Validation Report" },
  { formType: "fuel_pump", label: "Attach Fuel Pump Validation" },
];

/** The record's real validation form (CSA or Fuel Pump) — replaces the generic result-lines form (see SHOW_GENERIC_FORM). */
function ValidationFormCard({ recordId, faiNumber, attachedForms, canEdit, locked }: {
  recordId: number; faiNumber: string; attachedForms: { formType: "csa" | "fuel_pump"; title: string; openPath: string }[]; canEdit: boolean; locked: boolean;
}) {
  const openTab = useOpenTab();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [detaching, setDetaching] = useState<"csa" | "fuel_pump" | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["fai-inspection", "record", String(recordId)] });
    queryClient.invalidateQueries({ queryKey: ["fai-inspection", "records"] });
  };

  const attach = useMutation({
    mutationFn: (formType: "csa" | "fuel_pump") => faiInspectionApi.records.attachForm(recordId, formType),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (err) => setError(extractErrorMessage(err, "Could not attach that form.")),
  });
  const detach = useMutation({
    mutationFn: (formType: "csa" | "fuel_pump") => faiInspectionApi.records.detachForm(recordId, formType),
    onSuccess: () => { invalidate(); setError(null); setDetaching(null); },
    onError: (err) => setError(extractErrorMessage(err, "Could not detach that form.")),
  });

  const attachedTypes = new Set(attachedForms.map((f) => f.formType));

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2">Validation form</h2>
      {error && <div className="bg-red-50 text-red-700 p-2 rounded mb-3 text-sm">{error}</div>}
      <div className="flex flex-col gap-2">
        {attachedForms.map((f) => (
          <div key={f.formType} className="flex items-center gap-3">
            <button
              onClick={() => openTab({ path: f.openPath, title: f.title, icon: "file-text" })}
              className="rounded border px-4 py-2 hover:bg-gray-50 w-fit"
            >
              Open {f.title}
            </button>
            {canEdit && !locked && (
              <button onClick={() => setDetaching(f.formType)} className="text-red-600 hover:underline text-sm">Detach</button>
            )}
          </div>
        ))}
        {canEdit && !locked && ATTACHABLE.filter((a) => !attachedTypes.has(a.formType)).map((a) => (
          <button
            key={a.formType}
            onClick={() => attach.mutate(a.formType)}
            disabled={attach.isPending}
            className="rounded bg-primary text-primary-foreground px-4 py-2 w-fit disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
        {attachedForms.length === 0 && !canEdit && <p className="text-sm text-gray-500">No validation form attached.</p>}
      </div>

      {detaching && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-96">
            <h2 className="text-lg font-semibold mb-3">Detach this validation form?</h2>
            <p className="text-sm mb-4">This unlinks it from FAI {faiNumber}. The validation report itself is not deleted.</p>
            <div className="flex gap-3">
              <button onClick={() => detach.mutate(detaching)} disabled={detach.isPending} className="rounded bg-destructive text-destructive-foreground px-4 py-2">Detach</button>
              <button onClick={() => setDetaching(null)} className="rounded border px-4 py-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
