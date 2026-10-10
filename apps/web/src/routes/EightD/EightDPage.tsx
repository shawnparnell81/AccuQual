import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { Modal } from "../../components/modals/Modal";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useToast } from "../../components/shared/ToastProvider";
import { useVisibleNcrs } from "../../hooks/useVisibleNcrs";
import { NcrSearchField } from "../../components/forms/NcrSearchField";
import type { Capa } from "../../api/types";
import { RecordNumberField, duplicateNumberError } from "../../components/forms/RecordNumberField";
import { recordHeading, showRecordNumber } from "../../lib/userRecordNumber";

interface EightDReport {
  id: number;
  ncrId: number | null;
  currentStep: number;
  recordNumber?: string | null;
  /** Sent on create only. Stored on the report so the chosen CAPA is the one that shows. */
  attachedCapaId?: number | null;
}

const eightDHooks = createResourceHooks<EightDReport>("8d");

export function EightDPage() {
  const navigate = useNavigate();
  const canEdit = useCanEditWorkflow("8d");
  const toast = useToast();
  const createReport = eightDHooks.useCreate();
  const [createOpen, setCreateOpen] = useState(false);
  const { rows: ncrs, isLoading: ncrsLoading } = useVisibleNcrs();
  const [ncrId, setNcrId] = useState<number | null>(null);
  const [capaChoice, setCapaChoice] = useState<number | "none" | "pending">("pending");
  const [recordNumber, setRecordNumber] = useState("");
  const [numberError, setNumberError] = useState<string | null>(null);
  const selectedNcr = ncrs.find((ncr) => ncr.id === ncrId) ?? null;
  const capaQuery = useQuery({
    queryKey: ["capa", "for-8d", ncrId, selectedNcr?.siteId ?? null],
    enabled: ncrId != null,
    queryFn: async () =>
      (
        await apiClient.get<Capa[]>("/capa", {
          params: { ncrId },
          headers: selectedNcr?.siteId ? { "X-AccuQual-Site": String(selectedNcr.siteId) } : undefined,
        })
      ).data,
  });
  const capas = capaQuery.data ?? [];
  const resolvedCapaId = ((): number | null => {
    if (capaChoice === "none") return null;
    if (typeof capaChoice === "number" && capas.some((capa) => capa.id === capaChoice)) return capaChoice;
    return capas[0]?.id ?? null;
  })();
  const attached = capas.find((capa) => capa.id === resolvedCapaId) ?? null;

  useEffect(() => {
    setCapaChoice("pending");
  }, [ncrId]);

  function openCreate() {
    setNcrId(null);
    setCapaChoice("pending");
    setRecordNumber("");
    setNumberError(null);
    setCreateOpen(true);
  }

  function create() {
    createReport.mutate({ ...(ncrId ? { ncrId } : {}), recordNumber: recordNumber.trim() || null, attachedCapaId: ncrId ? resolvedCapaId : null }, {
      onSuccess: (created) => {
        setCreateOpen(false);
        navigate(`/8d/${created.id}`);
      },
      onError: (err) => {
        const message = extractErrorMessage(err, "Couldn't create this 8D report.");
        const duplicate = duplicateNumberError(message);
        if (duplicate) setNumberError(duplicate);
        else toast.error(message);
      },
    });
  }

  return (
    <>
      <ResourceListPage<EightDReport>
        title="8D reports"
        resource="8d"
        canCreate={false}
        onRowClick={(row) => navigate(`/8d/${row.id}`)}
        columns={[
          { header: "8D No.", accessor: (row) => showRecordNumber(row.recordNumber) },
          { header: "Linked NCR", accessor: (row) => (row.ncrId ? "Linked" : "—") },
          { header: "Current step", accessor: (row) => (row.currentStep >= 9 ? "Closed" : `D${row.currentStep}`) },
        ]}
        headerActions={
          canEdit ? (
            <button type="button" onClick={openCreate} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              + New
            </button>
          ) : null
        }
      />
      <Modal title="Create 8D report" isOpen={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="flex flex-col gap-4">
          <RecordNumberField label="8D No." value={recordNumber} error={numberError} onChange={(value) => { setNumberError(null); setRecordNumber(value); }} />
          <NcrSearchField ncrs={ncrs} loading={ncrsLoading} value={ncrId} onChange={setNcrId} label="Linked NCR (optional)" />
          {ncrId != null && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-xs text-foreground">
                {capaQuery.isLoading
                  ? "Looking up CAPAs for this NCR…"
                  : attached
                    ? `Will attach ${recordHeading("CAPA", attached.recordNumber)}`
                    : "No CAPA will be attached."}
              </p>
              {capas.length > 0 && (
                <select
                  aria-label="CAPA to attach"
                  value={capaChoice === "none" ? "" : String(resolvedCapaId ?? "")}
                  onChange={(event) => setCapaChoice(event.target.value ? Number(event.target.value) : "none")}
                  className="rounded-md border border-border bg-background px-3 py-2"
                >
                  <option value="">Don't attach a CAPA</option>
                  {capas.map((capa) => (
                    <option key={capa.id} value={capa.id}>
                      {recordHeading("CAPA", capa.recordNumber)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          <button type="button" onClick={create} disabled={createReport.isPending || (ncrId != null && capaQuery.isLoading)} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {createReport.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </Modal>
    </>
  );
}
