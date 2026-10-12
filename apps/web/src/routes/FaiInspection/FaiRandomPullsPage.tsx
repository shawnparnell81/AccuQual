import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { faiInspectionApi, type FaiRandomPullItem } from "../../api/faiInspection";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

const ITEM_STATUS_LABEL: Record<FaiRandomPullItem["status"], string> = {
  pending: "Pending",
  linked: "FAI record linked",
  completed_pass: "Completed — passed",
  completed_fail: "Completed — failed",
};
const ITEM_STATUS_BADGE: Record<FaiRandomPullItem["status"], string> = {
  pending: "bg-gray-100 text-gray-700",
  linked: "bg-blue-100 text-blue-800",
  completed_pass: "bg-green-100 text-green-800",
  completed_fail: "bg-red-100 text-red-800",
};

function CreateRecordForm({ item, onDone }: { item: FaiRandomPullItem; onDone: () => void }) {
  const [faiNumber, setFaiNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const rec = await faiInspectionApi.records.create({
        faiNumber, partNumber: item.partNumber, supplierFactory: item.supplierFactory,
        receivingLocation: item.receivingLocation, triggerReason: "Annual random pull",
      });
      await faiInspectionApi.randomPulls.linkItem(item.id, rec.id);
      onDone();
    } catch (err) {
      setError(extractErrorMessage(err, "Could not create the FAI record."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={faiNumber}
        onChange={(e) => setFaiNumber(e.target.value)}
        placeholder="FAI number"
        className="border rounded px-2 py-1 text-sm w-32"
      />
      <button onClick={submit} disabled={!faiNumber.trim() || busy} className="rounded bg-primary text-primary-foreground px-3 py-1 text-sm disabled:opacity-50">
        Create FAI record
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

function RulesPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["fai-random-pulls", "rules"], queryFn: () => faiInspectionApi.randomPulls.getRules() });
  const [draft, setDraft] = useState<{ pickMode: "percent" | "count"; pickPercent: string; pickCount: string; productFamily: string; riskClass: string; excludeMonths: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rules = draft ?? (data ? {
    pickMode: data.pickMode, pickPercent: data.pickPercent != null ? String(data.pickPercent) : "",
    pickCount: data.pickCount != null ? String(data.pickCount) : "", productFamily: data.productFamily ?? "",
    riskClass: data.riskClass ?? "", excludeMonths: String(data.excludeMonths),
  } : null);

  const save = useMutation({
    mutationFn: () => faiInspectionApi.randomPulls.updateRules({
      pickMode: rules!.pickMode,
      pickPercent: rules!.pickMode === "percent" ? Number(rules!.pickPercent) || null : null,
      pickCount: rules!.pickMode === "count" ? Number(rules!.pickCount) || null : null,
      productFamily: rules!.productFamily.trim() || null,
      riskClass: rules!.riskClass.trim() || null,
      excludeMonths: Number(rules!.excludeMonths) || 6,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["fai-random-pulls", "rules"] }); setDraft(null); setError(null); },
    onError: (err) => setError(extractErrorMessage(err, "Could not save the rules.")),
  });

  if (isLoading || !rules) return <div className="text-sm text-gray-500">Loading rules…</div>;

  return (
    <div className="rounded-lg border p-4 mb-6">
      <h2 className="font-semibold mb-3">Random-pull rules</h2>
      {error && <div className="bg-red-50 text-red-700 p-2 rounded mb-3 text-sm">{error}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <label className="text-sm">Pick by
          <select value={rules.pickMode} onChange={(e) => setDraft({ ...rules, pickMode: e.target.value as "percent" | "count" })} className="border rounded px-2 py-1 w-full mt-1">
            <option value="percent">Percent of eligible sources</option>
            <option value="count">Fixed number of sources</option>
          </select>
        </label>
        {rules.pickMode === "percent" ? (
          <label className="text-sm">Percent
            <input type="number" min={1} max={100} value={rules.pickPercent} onChange={(e) => setDraft({ ...rules, pickPercent: e.target.value })} className="border rounded px-2 py-1 w-full mt-1" />
          </label>
        ) : (
          <label className="text-sm">Count
            <input type="number" min={1} value={rules.pickCount} onChange={(e) => setDraft({ ...rules, pickCount: e.target.value })} className="border rounded px-2 py-1 w-full mt-1" />
          </label>
        )}
        <label className="text-sm">Product family (optional)
          <input value={rules.productFamily} onChange={(e) => setDraft({ ...rules, productFamily: e.target.value })} className="border rounded px-2 py-1 w-full mt-1" />
        </label>
        <label className="text-sm">Risk class (optional)
          <select value={rules.riskClass} onChange={(e) => setDraft({ ...rules, riskClass: e.target.value })} className="border rounded px-2 py-1 w-full mt-1">
            <option value="">Any</option>
            <option value="Critical">Critical</option>
            <option value="Major">Major</option>
            <option value="Minor">Minor</option>
          </select>
        </label>
        <label className="text-sm">Exclude if FAI'd within (months)
          <input type="number" min={1} value={rules.excludeMonths} onChange={(e) => setDraft({ ...rules, excludeMonths: e.target.value })} className="border rounded px-2 py-1 w-full mt-1" />
        </label>
      </div>
      <button onClick={() => save.mutate()} disabled={save.isPending} className="rounded bg-primary text-primary-foreground px-4 py-1.5 text-sm disabled:opacity-50">
        Save rules
      </button>
    </div>
  );
}

function ApproveDialog({ batchId, onClose, onApproved }: { batchId: number; onClose: () => void; onApproved: () => void }) {
  const [pin, setPin] = useState("");
  const [certified, setCertified] = useState(false);
  const [description, setDescription] = useState("Approved the annual random-pull list.");
  const [error, setError] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: () => faiInspectionApi.randomPulls.approve(batchId, { pin, certified: true, description }),
    onSuccess: () => onApproved(),
    onError: (err) => setError(extractErrorMessage(err, "Could not approve the pick list.")),
  });
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 w-96">
        <h2 className="text-lg font-semibold mb-4">Approve pick list (signed)</h2>
        {error && <div className="bg-red-50 text-red-700 p-2 rounded mb-3 text-sm">{error}</div>}
        <label className="block mb-3 text-sm">Description*
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="border rounded px-3 py-2 w-full mt-1" />
        </label>
        <label className="block mb-4 text-sm">PIN*
          <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} className="border rounded px-3 py-2 w-full mt-1" />
        </label>
        <label className="flex items-center gap-2 mb-4 text-sm">
          <input type="checkbox" checked={certified} onChange={(e) => setCertified(e.target.checked)} /> I certify this pick list for approval
        </label>
        <div className="flex gap-3">
          <button onClick={() => approve.mutate()} disabled={!certified || pin.length !== 4 || !description.trim() || approve.isPending} className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50">
            Sign &amp; approve
          </button>
          <button onClick={onClose} className="rounded border px-4 py-2">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function FaiRandomPullsPage() {
  const queryClient = useQueryClient();
  const year = new Date().getFullYear();
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [approving, setApproving] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const { data: batches, isLoading: batchesLoading } = useQuery({ queryKey: ["fai-random-pulls", "batches"], queryFn: () => faiInspectionApi.randomPulls.listBatches() });
  const effectiveBatchId = selectedBatchId ?? batches?.[0]?.id ?? null;
  const { data: batch } = useQuery({
    queryKey: ["fai-random-pulls", "batch", effectiveBatchId],
    queryFn: () => faiInspectionApi.randomPulls.getBatch(effectiveBatchId!),
    enabled: effectiveBatchId != null,
  });
  const { data: compliance } = useQuery({ queryKey: ["fai-random-pulls", "compliance", year], queryFn: () => faiInspectionApi.randomPulls.compliance(year) });

  const generate = useMutation({
    mutationFn: () => faiInspectionApi.randomPulls.generate(year),
    onSuccess: (created) => {
      setGenerateError(null);
      setSelectedBatchId(created.id);
      queryClient.invalidateQueries({ queryKey: ["fai-random-pulls"] });
    },
    onError: (err) => setGenerateError(extractErrorMessage(err, "Could not generate a pick list.")),
  });

  function refreshAfterItemChange() {
    queryClient.invalidateQueries({ queryKey: ["fai-random-pulls"] });
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Annual Random Pulls</h1>

      <RulesPanel />

      <div className="rounded-lg border p-4 mb-6">
        <h2 className="font-semibold mb-3">{year} compliance</h2>
        {compliance ? (
          <div className="flex gap-6 text-sm">
            <div><span className="font-bold text-lg">{compliance.picked}</span> picked</div>
            <div><span className="font-bold text-lg">{compliance.completed}</span> completed</div>
            <div><span className="font-bold text-lg">{compliance.overdue}</span> overdue</div>
          </div>
        ) : <div className="text-sm text-gray-500">Loading…</div>}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => generate.mutate()} disabled={generate.isPending} className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50">
          Generate pick list for {year}
        </button>
        {generateError && <span className="text-sm text-red-600">{generateError}</span>}
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1">
          <h2 className="font-semibold mb-2">Pick lists</h2>
          {batchesLoading ? <div className="text-sm text-gray-500">Loading…</div> : (
            <ul className="space-y-1">
              {(batches ?? []).map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setSelectedBatchId(b.id)}
                    className={`w-full text-left rounded px-3 py-2 text-sm border ${effectiveBatchId === b.id ? "border-blue-500 bg-blue-50" : "hover:bg-gray-50"}`}
                  >
                    {b.year} — {b.status === "approved" ? "Approved" : "Pending approval"} ({b.items.length} source{b.items.length === 1 ? "" : "s"})
                  </button>
                </li>
              ))}
              {(batches ?? []).length === 0 && <li className="text-sm text-gray-500">No pick lists yet.</li>}
            </ul>
          )}
        </div>

        <div className="col-span-2">
          {batch ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">{batch.year} pick list — {batch.status === "approved" ? "Approved" : "Pending approval"}</h2>
                {batch.status === "pending_approval" && (
                  <button onClick={() => setApproving(true)} className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm">
                    Approve…
                  </button>
                )}
              </div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-2">Part</th><th className="p-2">Supplier factory</th><th className="p-2">Status</th><th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {batch.items.map((item) => (
                    <tr key={item.id} className="border-b">
                      <td className="p-2">{item.partNumber}</td>
                      <td className="p-2">{item.supplierFactory ?? "—"}</td>
                      <td className="p-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${ITEM_STATUS_BADGE[item.status]}`}>{ITEM_STATUS_LABEL[item.status]}</span>
                        {item.linkedFaiNumber && <span className="ml-2 text-gray-500">{item.linkedFaiNumber}</span>}
                      </td>
                      <td className="p-2">
                        {item.status === "pending" && batch.status === "approved" && (
                          <CreateRecordForm item={item} onDone={refreshAfterItemChange} />
                        )}
                      </td>
                    </tr>
                  ))}
                  {batch.items.length === 0 && (
                    <tr><td colSpan={4} className="p-2 text-gray-500">No sources were picked for this list.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          ) : <div className="text-sm text-gray-500">Select a pick list.</div>}
        </div>
      </div>

      {approving && effectiveBatchId != null && (
        <ApproveDialog
          batchId={effectiveBatchId}
          onClose={() => setApproving(false)}
          onApproved={() => { setApproving(false); refreshAfterItemChange(); }}
        />
      )}
    </div>
  );
}
