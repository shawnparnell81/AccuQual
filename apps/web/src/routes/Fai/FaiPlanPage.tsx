import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useFaiLookups, useFaiPlan, useInvalidateFai, type FaiPlanDetail } from "../../api/fai";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { CharacteristicInput, CharacteristicMode } from "../../lib/faiLogic";
import "../IsoForms/isoForm.css";

const MODES: { value: CharacteristicMode; label: string }[] = [
  { value: "percent_nominal", label: "Percent from nominal" },
  { value: "plus_minus", label: "Plus / minus" },
  { value: "min_max", label: "Min / max" },
  { value: "attribute", label: "Attribute" },
];

function blankRow(): CharacteristicInput {
  return { balloon: "", name: "", mode: "plus_minus", nominal: "", percent: "", plusTolerance: "", minusTolerance: "", specMin: "", specMax: "" };
}

export function FaiPlanPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const isNew = params.id == null || params.id === "new";
  const planId = isNew ? null : Number(params.id);
  const revision = search.get("revision") ? Number(search.get("revision")) : undefined;
  const existing = useFaiPlan(planId, revision);
  const lookups = useFaiLookups();
  const invalidate = useInvalidateFai();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"part" | "family">("part");
  const [partNumber, setPartNumber] = useState("");
  const [partName, setPartName] = useState("");
  const [productFamily, setProductFamily] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [cadenceMonths, setCadenceMonths] = useState("6");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<CharacteristicInput[]>([blankRow()]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);

  useEffect(() => {
    const plan = existing.data;
    if (!plan) return;
    const key = `${plan.id}:${plan.viewingRevision}`;
    if (loaded === key) return;
    setName(plan.name);
    setScope(plan.scope === "family" ? "family" : "part");
    setPartNumber(plan.partNumber ?? "");
    setPartName(plan.partName ?? "");
    setProductFamily(plan.productFamily ?? "");
    setSupplierId(plan.supplierId ? String(plan.supplierId) : "");
    setCadenceMonths(String(plan.cadenceMonths));
    setNotes(plan.notes ?? "");
    setRows(plan.characteristics.length > 0 ? plan.characteristics.map((row) => ({ ...blankRow(), ...row })) : [blankRow()]);
    setLoaded(key);
  }, [existing.data, loaded]);

  const readOnly = existing.data?.readOnly === true;
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        scope,
        partNumber: scope === "part" ? partNumber : null,
        partName: partName || null,
        productFamily: scope === "family" ? productFamily : null,
        supplierId: supplierId ? Number(supplierId) : null,
        cadenceMonths: Number(cadenceMonths),
        notes: notes || null,
        characteristics: rows.map((row) => ({
          balloon: row.balloon || null,
          name: row.name,
          mode: row.mode,
          nominal: row.nominal || null,
          percent: row.percent || null,
          plusTolerance: row.plusTolerance || null,
          minusTolerance: row.minusTolerance || null,
          specMin: row.specMin || null,
          specMax: row.specMax || null,
        })),
      };
      const response = isNew
        ? await apiClient.post<FaiPlanDetail>("/fai/plans", body)
        : await apiClient.put<FaiPlanDetail>(`/fai/plans/${planId}`, body);
      return response.data;
    },
    onSuccess: async (plan) => {
      await invalidate();
      navigate(`/fai/plans/${plan.id}`);
    },
    onError: (err) => setError(extractErrorMessage(err, "The plan could not be saved.")),
  });
  const retire = useMutation({
    mutationFn: async () => (await apiClient.post<FaiPlanDetail>(`/fai/plans/${planId}/retire`)).data,
    onSuccess: async () => invalidate(),
    onError: (err) => setError(extractErrorMessage(err, "The plan could not be retired.")),
  });

  function edit(index: number, patch: Partial<CharacteristicInput>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="/fai" className="text-xs text-primary hover:underline">First Article</Link>
          <h1 className="text-2xl font-semibold">{isNew ? "New inspection plan" : name || "Inspection plan"}</h1>
          <p className="text-sm text-muted-foreground">Changing characteristics, limits, the part or family, the supplier limit, or the cadence saves a new revision. Filling a first article does not.</p>
        </div>
        {!isNew && existing.data && !existing.data.retired && (
          <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => retire.mutate()} disabled={retire.isPending}>
            Retire plan
          </button>
        )}
      </div>
      {existing.data && existing.data.revisions.length > 1 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {existing.data.revisions.map((row) => (
            <Link key={row.revision} to={`/fai/plans/${existing.data?.id}?revision=${row.revision}`} className={row.revision === existing.data?.viewingRevision ? "font-semibold text-foreground" : "text-primary hover:underline"}>
              Revision {row.revision}
            </Link>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <div className="iso-wrap">
          <table className="iso" aria-label="Inspection plan">
            <tbody>
              <tr>
                <td className="title" colSpan={8}>INSPECTION PLAN</td>
              </tr>
              <tr>
                <td>Plan name</td>
                <td colSpan={3}><input className="iso-in" aria-label="Plan name" value={name} disabled={readOnly} onChange={(event) => setName(event.target.value)} required /></td>
                <td>Revision</td>
                <td>{existing.data?.viewingRevision ?? 1}</td>
                <td>Cadence (months)</td>
                <td><input className="iso-in center" aria-label="Cadence in months" inputMode="numeric" value={cadenceMonths} disabled={readOnly} onChange={(event) => setCadenceMonths(event.target.value)} /></td>
              </tr>
              <tr>
                <td>Scope</td>
                <td>
                  <select className="iso-in" aria-label="Scope" value={scope} disabled={readOnly} onChange={(event) => setScope(event.target.value === "family" ? "family" : "part")}>
                    <option value="part">Part</option>
                    <option value="family">Product family</option>
                  </select>
                </td>
                <td>{scope === "part" ? "Part number" : "Product family"}</td>
                <td>
                  {scope === "part" ? (
                    <input className="iso-in" aria-label="Part number" value={partNumber} disabled={readOnly} onChange={(event) => setPartNumber(event.target.value)} required />
                  ) : (
                    <input className="iso-in" aria-label="Product family" value={productFamily} disabled={readOnly} onChange={(event) => setProductFamily(event.target.value)} required />
                  )}
                </td>
                <td>Part name</td>
                <td><input className="iso-in" aria-label="Part name" value={partName} disabled={readOnly} onChange={(event) => setPartName(event.target.value)} /></td>
                <td>Supplier limit</td>
                <td>
                  <select className="iso-in" aria-label="Supplier limit" value={supplierId} disabled={readOnly} onChange={(event) => setSupplierId(event.target.value)}>
                    <option value="">Any supplier</option>
                    {lookups.data?.suppliers.map((row) => (
                      <option key={row.id} value={row.id}>{row.name}</option>
                    ))}
                  </select>
                </td>
              </tr>
              <tr>
                <td className="section" colSpan={8}>CHARACTERISTICS</td>
              </tr>
              <tr>
                <td className="header">Balloon</td>
                <td className="header">Characteristic</td>
                <td className="header">Mode</td>
                <td className="header">Nominal</td>
                <td className="header">Percent</td>
                <td className="header">Plus</td>
                <td className="header">Minus</td>
                <td className="header">Min / Max</td>
              </tr>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td><input className="iso-in center" aria-label={`Balloon ${index + 1}`} value={row.balloon ?? ""} disabled={readOnly} onChange={(event) => edit(index, { balloon: event.target.value })} /></td>
                  <td><input className="iso-in" aria-label={`Characteristic ${index + 1}`} value={row.name} disabled={readOnly} onChange={(event) => edit(index, { name: event.target.value })} required /></td>
                  <td>
                    <select className="iso-in" aria-label={`Mode ${index + 1}`} value={row.mode} disabled={readOnly} onChange={(event) => edit(index, { mode: event.target.value as CharacteristicMode })}>
                      {MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                    </select>
                  </td>
                  <td><input className="iso-in center" aria-label={`Nominal ${index + 1}`} value={row.nominal ?? ""} disabled={readOnly || row.mode === "attribute"} onChange={(event) => edit(index, { nominal: event.target.value })} /></td>
                  <td><input className="iso-in center" aria-label={`Percent ${index + 1}`} value={row.percent ?? ""} disabled={readOnly || row.mode !== "percent_nominal"} onChange={(event) => edit(index, { percent: event.target.value })} /></td>
                  <td><input className="iso-in center" aria-label={`Plus ${index + 1}`} value={row.plusTolerance ?? ""} disabled={readOnly || row.mode !== "plus_minus"} onChange={(event) => edit(index, { plusTolerance: event.target.value })} /></td>
                  <td><input className="iso-in center" aria-label={`Minus ${index + 1}`} value={row.minusTolerance ?? ""} disabled={readOnly || row.mode !== "plus_minus"} onChange={(event) => edit(index, { minusTolerance: event.target.value })} /></td>
                  <td>
                    <span className="check">
                      <input className="iso-in center" aria-label={`Minimum ${index + 1}`} placeholder="Min" value={row.specMin ?? ""} disabled={readOnly || row.mode !== "min_max"} onChange={(event) => edit(index, { specMin: event.target.value })} />
                      <input className="iso-in center" aria-label={`Maximum ${index + 1}`} placeholder="Max" value={row.specMax ?? ""} disabled={readOnly || row.mode !== "min_max"} onChange={(event) => edit(index, { specMax: event.target.value })} />
                    </span>
                  </td>
                </tr>
              ))}
              <tr>
                <td>Notes</td>
                <td colSpan={7}><input className="iso-in" aria-label="Notes" value={notes} disabled={readOnly} onChange={(event) => setNotes(event.target.value)} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <div className="no-print mt-2 flex flex-wrap gap-2">
            <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => setRows((current) => [...current, { ...blankRow(), balloon: String(current.length + 1) }])}>Add characteristic</button>
            {rows.length > 1 && (
              <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => setRows((current) => current.slice(0, -1))}>Remove last row</button>
            )}
            <button type="submit" disabled={save.isPending} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-60">
              {save.isPending ? "Saving…" : "Save plan"}
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </form>
    </div>
  );
}
