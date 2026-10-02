import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { Modal } from "../../components/modals/Modal";
import { useMayEditEquipment } from "../../components/calibration/EquipmentPanels";
import { useCanEditSurface, useRecordEdit } from "../../components/shared/RecordEditBar";
import { RecordEditButton } from "../../components/shared/RecordEditButton";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { downloadXlsx, TONE_ARGB } from "../../lib/downloadTable";
import { daysForMonths, EQUIPMENT_LIST_ID, EQUIPMENT_STATUSES, equipmentListRow, type EquipmentListStatus, type EquipmentSource } from "../../lib/equipmentMasterList";
import { normalizePastedCell } from "../../lib/gridPaste";
import { recordSurface } from "../../lib/recordSurface";
import "../IsoForms/isoForm.css";

interface EquipmentRecord extends EquipmentSource {
  metadata: Record<string, unknown> | null;
}

interface Draft {
  id: number | null;
  assetId: string;
  name: string;
  manufacturer: string;
  serial: string;
  location: string;
  method: string;
  intervalMonths: string;
  lastCal: string;
  status: EquipmentListStatus;
  equipmentStatus: EquipmentSource["status"];
  metadata: Record<string, unknown>;
}

const emptyDraft = (): Draft => ({
  id: null,
  assetId: "",
  name: "",
  manufacturer: "",
  serial: "",
  location: "",
  method: "",
  intervalMonths: "12",
  lastCal: "",
  status: "Active",
  equipmentStatus: "active",
  metadata: {},
});

async function persistEquipment(next: Draft, previousLastCal: string) {
  const months = Math.max(1, Math.round(Number(next.intervalMonths) || 12));
  const metadata = {
    ...next.metadata,
    assetId: next.assetId.trim(),
    manufacturer: next.manufacturer.trim(),
    method: next.method.trim(),
    calIntervalMonths: months,
    listStatus: next.status,
  };
  const body = {
    name: next.name.trim(),
    serialNumber: next.serial.trim() || undefined,
    location: next.location.trim() || undefined,
    calibrationIntervalDays: daysForMonths(months),
    metadata,
  };
  const created = next.id == null
    ? (await apiClient.post<EquipmentRecord>("/equipment", { ...body, status: next.status === "Scrapped" ? "inactive" : "active" })).data
    : (await apiClient.patch<EquipmentRecord>(`/equipment/${next.id}`, body)).data;
  const id = created.id;
  const target = operationalTarget(next.status);
  const current = next.id == null ? (next.status === "Scrapped" ? "inactive" : "active") : next.equipmentStatus;
  if (target && target !== current) {
    await apiClient.post(`/equipment/${id}/status`, { status: target, reason: "Updated on the Master Equipment List" });
  }
  const lastCal = normalizePastedCell(next.lastCal, "date");
  if (/^\d{4}-\d{2}-\d{2}$/.test(lastCal) && lastCal !== previousLastCal) {
    await apiClient.post(`/equipment/${id}/calibration`, { performedAt: lastCal, result: "pass" });
  }
}

function operationalTarget(status: EquipmentListStatus): EquipmentSource["status"] | null {
  if (status === "Active") return "active";
  if (status === "Out of Service") return "out_of_service";
  if (status === "Scrapped") return "inactive";
  return null;
}

export function MasterEquipmentListPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { mayEdit } = useMayEditEquipment();
  const { editing, setEditing } = useRecordEdit();
  const canEditList = useCanEditSurface(recordSurface("/calibration/master-list"));
  const inline = mayEdit && canEditList && editing;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cellEdits, setCellEdits] = useState<Record<number, Record<string, string>>>({});
  const cellEditsRef = useRef(cellEdits);
  cellEditsRef.current = cellEdits;
  const equipmentRef = useRef<EquipmentRecord[]>([]);
  const cellTimers = useRef<Map<number, number>>(new Map());
  const [exporting, setExporting] = useState(false);
  const equipment = useQuery<EquipmentRecord[]>({
    queryKey: ["equipment"],
    queryFn: async () => (await apiClient.get<EquipmentRecord[]>("/equipment")).data,
  });

  const save = useMutation({
    mutationFn: async (next: Draft) => {
      const previous = next.id == null ? "" : equipment.data?.find((item) => item.id === next.id)?.lastCalibratedAt?.slice(0, 10) ?? "";
      await persistEquipment(next, previous);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      setDraft(null);
      toast.success("Equipment list updated.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save that equipment row.")),
  });

  equipmentRef.current = equipment.data ?? [];
  const rows = (equipment.data ?? []).map((item) => equipmentListRow(item));

  useEffect(() => {
    const pending = cellTimers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
    };
  }, []);

  function cellValue(id: number, key: string, fallback: string) {
    return cellEdits[id]?.[key] ?? fallback;
  }

  function queueRow(id: number) {
    const existing = cellTimers.current.get(id);
    if (existing) window.clearTimeout(existing);
    cellTimers.current.set(
      id,
      window.setTimeout(() => {
        const item = equipmentRef.current.find((entry) => entry.id === id);
        const patch = cellEditsRef.current[id];
        if (!item || !patch) return;
        const row = equipmentListRow(item);
        const next: Draft = {
          id: item.id,
          assetId: patch.assetId ?? (row.assetId === String(item.id) ? "" : row.assetId),
          name: patch.name ?? row.name,
          manufacturer: patch.manufacturer ?? row.manufacturer,
          serial: patch.serial ?? row.serial,
          location: patch.location ?? row.location,
          method: patch.method ?? row.method,
          intervalMonths: patch.intervalMonths ?? String(row.intervalMonths),
          lastCal: patch.lastCal ?? row.lastCal,
          status: (patch.status as EquipmentListStatus | undefined) ?? row.status,
          equipmentStatus: item.status,
          metadata: item.metadata ?? {},
        };
        if (!next.name.trim()) {
          toast.error("Equipment name is required.");
          return;
        }
        const previous = item.lastCalibratedAt?.slice(0, 10) ?? "";
        void persistEquipment(next, previous)
          .then(() => queryClient.invalidateQueries({ queryKey: ["equipment"] }))
          .catch((err) => toast.error(extractErrorMessage(err, "Couldn't save that equipment row.")));
      }, 400),
    );
  }

  function changeCell(id: number, key: string, value: string) {
    const next = { ...cellEditsRef.current, [id]: { ...cellEditsRef.current[id], [key]: value } };
    cellEditsRef.current = next;
    setCellEdits(next);
    queueRow(id);
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const fills = rows.flatMap((row, index) => (row.tone === "none" ? [] : [{ row: index + 2, col: 9, argb: TONE_ARGB[row.tone] }]));
      await downloadXlsx(
        "LST-EQP-001-master-equipment-list.xlsx",
        ["ID Number", "Equipment Name", "Manufacturer", "Serial Number", "Location", "Method", "Cal Interval (Mo)", "Last Cal Date", "Next Cal Due", "Status"],
        rows.map((row) => [row.assetId, row.name, row.manufacturer, row.serial, row.location, row.method, row.intervalMonths, row.lastCal, row.nextDue ?? "", row.status]),
        fills,
      );
    } catch {
      toast.error("Couldn't export this list.");
    } finally {
      setExporting(false);
    }
  }

  function openEdit(item: EquipmentRecord) {
    const row = equipmentListRow(item);
    setDraft({
      id: item.id,
      assetId: row.assetId === String(item.id) ? "" : row.assetId,
      name: row.name,
      manufacturer: row.manufacturer,
      serial: row.serial,
      location: row.location,
      method: row.method,
      intervalMonths: String(row.intervalMonths),
      lastCal: row.lastCal,
      status: row.status,
      equipmentStatus: item.status,
      metadata: item.metadata ?? {},
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Master Equipment List</h1>
          <p className="text-sm text-muted-foreground">
            Doc ID: {EQUIPMENT_LIST_ID} · Rev A. This list is the calibration register. Next Cal Due is Last Cal plus the interval in months.
          </p>
          <p className="text-sm text-muted-foreground">STATUS KEY: Active, Out of Service, Scrapped, Cal Not Required (CNR).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditList && <RecordEditButton editing={editing} onClick={() => setEditing(!editing)} />}
          <Link to="/calibration" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Calibration</Link>
          {mayEdit && (
            <button type="button" onClick={() => setDraft(emptyDraft())} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
              Add equipment
            </button>
          )}
          <button type="button" onClick={() => void exportExcel()} disabled={exporting} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
          <button type="button" onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
        </div>
      </div>

      <div className="aq-print-sheet rounded-lg border border-border bg-card p-4">
        <div className="iso-print-title mb-3">
          <h1 className="text-xl font-semibold">MASTER EQUIPMENT LIST</h1>
          <p className="text-sm">Doc ID: {EQUIPMENT_LIST_ID} · Rev A · STATUS KEY: Active, Out of Service, Scrapped, Cal Not Required (CNR)</p>
        </div>
        {equipment.isLoading && <p className="text-sm text-muted-foreground">Loading equipment…</p>}
        {equipment.isError && <p className="text-sm text-destructive">Couldn't load the equipment register.</p>}
        <div className="iso-wrap">
          <table className="iso" data-testid="master-equipment-list" data-paste-grid="" aria-label="Master Equipment List">
            <thead>
              <tr>
                {["ID Number", "Equipment Name", "Manufacturer", "Serial Number", "Location", "Method", "Cal Interval (Mo)", "Last Cal Date", "Next Cal Due", "Status", ""].map((heading) => (
                  <th key={heading || "actions"} className="header">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{inline ? <GridCell label={`ID Number for ${row.name}`} value={cellValue(row.id, "assetId", row.assetId)} onChange={(value) => changeCell(row.id, "assetId", value)} /> : row.assetId}</td>
                  <td className="left">
                    {inline ? <GridCell label={`Equipment Name for ${row.assetId}`} value={cellValue(row.id, "name", row.name)} onChange={(value) => changeCell(row.id, "name", value)} /> : null}
                    <Link to={`/calibration/${row.id}`} className="text-primary hover:underline">{inline ? "Open" : row.name}</Link>
                  </td>
                  <td>{inline ? <GridCell label={`Manufacturer for ${row.name}`} value={cellValue(row.id, "manufacturer", row.manufacturer)} onChange={(value) => changeCell(row.id, "manufacturer", value)} /> : row.manufacturer}</td>
                  <td>{inline ? <GridCell label={`Serial Number for ${row.name}`} value={cellValue(row.id, "serial", row.serial)} onChange={(value) => changeCell(row.id, "serial", value)} /> : row.serial}</td>
                  <td>{inline ? <GridCell label={`Location for ${row.name}`} value={cellValue(row.id, "location", row.location)} onChange={(value) => changeCell(row.id, "location", value)} /> : row.location}</td>
                  <td>{inline ? <GridCell label={`Method for ${row.name}`} value={cellValue(row.id, "method", row.method)} onChange={(value) => changeCell(row.id, "method", value)} /> : row.method}</td>
                  <td className="center">{inline ? <GridCell label={`Cal Interval for ${row.name}`} value={cellValue(row.id, "intervalMonths", String(row.intervalMonths))} onChange={(value) => changeCell(row.id, "intervalMonths", value)} /> : row.intervalMonths}</td>
                  <td>{inline ? <GridCell label={`Last Cal Date for ${row.name}`} value={cellValue(row.id, "lastCal", row.lastCal)} onChange={(value) => changeCell(row.id, "lastCal", value)} date /> : row.lastCal}</td>
                  <td className={row.tone === "none" ? undefined : `fill-${row.tone}`} data-tone={row.tone}>{row.nextDue ?? ""}</td>
                  <td>
                    {inline ? (
                      <select className="iso-in" aria-label={`Status for ${row.name}`} value={cellValue(row.id, "status", row.status)} onChange={(event) => changeCell(row.id, "status", event.target.value)}>
                        {EQUIPMENT_STATUSES.map((status) => (
                          <option key={status} value={status}>{status === "CNR" ? "CNR" : status}</option>
                        ))}
                      </select>
                    ) : row.status}
                  </td>
                  <td className="no-print">
                    {mayEdit && (
                      <button type="button" className="text-sm text-primary hover:underline" onClick={() => {
                        const item = equipment.data?.find((entry) => entry.id === row.id);
                        if (item) openEdit(item);
                      }}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !equipment.isLoading && (
                <tr>
                  <td colSpan={11} className="left">No equipment is on the register yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Next Cal Due is red when overdue, yellow when due within 60 days, and green when the gage is in calibration.</p>
      </div>

      <Modal title={draft?.id == null ? "Add equipment" : "Edit equipment"} isOpen={draft != null} onClose={() => setDraft(null)} wide>
        {draft && (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.name.trim()) {
                toast.error("Equipment name is required.");
                return;
              }
              save.mutate(draft);
            }}
          >
            <Field label="ID Number" value={draft.assetId} onChange={(value) => setDraft({ ...draft, assetId: value })} />
            <Field label="Equipment Name" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
            <Field label="Manufacturer" value={draft.manufacturer} onChange={(value) => setDraft({ ...draft, manufacturer: value })} />
            <Field label="Serial Number" value={draft.serial} onChange={(value) => setDraft({ ...draft, serial: value })} />
            <Field label="Location" value={draft.location} onChange={(value) => setDraft({ ...draft, location: value })} />
            <Field label="Method" value={draft.method} onChange={(value) => setDraft({ ...draft, method: value })} />
            <Field label="Cal Interval (Mo)" value={draft.intervalMonths} onChange={(value) => setDraft({ ...draft, intervalMonths: value })} />
            <Field label="Last Cal Date" value={draft.lastCal} onChange={(value) => setDraft({ ...draft, lastCal: value })} type="date" />
            <label className="flex flex-col gap-1 text-sm">
              <span>Status</span>
              <select className="rounded-md border border-border bg-transparent px-2 py-1" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as EquipmentListStatus })}>
                {EQUIPMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>{status === "CNR" ? "CNR" : status}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end justify-end gap-2 sm:col-span-2">
              <button type="button" onClick={() => setDraft(null)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
              <button type="submit" disabled={save.isPending} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60">
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function GridCell({ label, value, onChange, date = false }: { label: string; value: string; onChange: (value: string) => void; date?: boolean }) {
  return <input className="iso-in" aria-label={label} data-value-kind={date ? "date" : undefined} value={value} onChange={(event) => onChange(event.target.value)} />;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <input className="rounded-md border border-border bg-transparent px-2 py-1" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
