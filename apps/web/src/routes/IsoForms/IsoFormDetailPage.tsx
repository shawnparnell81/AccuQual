import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { PictureText } from "../../components/forms/PictureText";
import { RecordCrumbs } from "../../components/records/RecordStatus";
import { SaveStatus } from "../../components/shared/SaveStatus";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { formByType, type IsoFormType } from "../../lib/isoFormCatalog";
import { EXCLUSIVE_CHECKS } from "../../lib/isoFormLayouts";
import { quarantineTotal, type CellValue } from "../../lib/isoFormLogic";
import { CrossTrainingSheet } from "./CrossTrainingSheet";
import { IsoFormSheet } from "./IsoFormSheet";

interface IsoQualityForm {
  id: number;
  formType: IsoFormType;
  data: { cells?: Record<string, CellValue>; photos?: string };
  createdAt?: string | null;
  updatedAt?: string | null;
}

const hooks = createResourceHooks<IsoQualityForm>("iso-quality-forms");

export function IsoFormDetailPage() {
  const { id } = useParams();
  const recordId = Number(id);
  const user = useCurrentUser();
  const { effective } = useEffectivePermissions();
  const canEdit = user?.roleName === "admin" || user?.roleName === "owner" || effective?.documents === "edit";
  const { data: record, isLoading, isError } = hooks.useOne(recordId);
  const updateRecord = hooks.useUpdate();
  const [cells, setCells] = useState<Record<string, CellValue> | null>(null);
  const [photos, setPhotos] = useState("");
  const [sheet, setSheet] = useState<"form" | "photos">("form");
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  useEffect(() => {
    if (!record || loadedFor === record.id) return;
    setCells({ ...(record.data?.cells ?? {}) });
    setPhotos(record.data?.photos ?? "");
    setLoadedFor(record.id);
  }, [loadedFor, record]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this form. Refresh the page and try again.</p>;
  if (isLoading || !record || !cells) return <LoadingPlaceholder />;

  const meta = formByType(record.formType);
  if (!meta) return <p className="text-sm text-destructive">This form type isn't recognized.</p>;

  const savedCells = record.data?.cells ?? {};
  const savedPhotos = record.data?.photos ?? "";
  const dirty = JSON.stringify(cells) !== JSON.stringify(savedCells) || photos !== savedPhotos;
  const formType = record.formType;
  const calculated: Record<string, CellValue> = {};
  if (formType === "quarantine_notice") {
    const total = quarantineTotal(cells);
    if (total != null) calculated.B22 = total;
  }

  function changeCell(addr: string, value: CellValue) {
    setCells((current) => {
      if (!current) return current;
      const next = { ...current, [addr]: value };
      const groups = EXCLUSIVE_CHECKS[formType] ?? [];
      if (value === true) {
        for (const group of groups) {
          if (!group.includes(addr)) continue;
          for (const other of group) {
            if (other !== addr) next[other] = false;
          }
        }
      }
      return next;
    });
  }

  function saveRecord() {
    updateRecord.mutate({ id: recordId, data: { cells: cells ?? {}, photos } });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-4">
        <RecordCrumbs items={[{ label: meta.title, to: `/iso-forms/${meta.formKey}` }, { label: meta.formId ? `${meta.formId} #${record.id}` : `Record ${record.id}` }]} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{meta.title}</h1>
            <p className="text-sm text-muted-foreground">
              {meta.formId ? `${meta.formId} Rev ${meta.rev}` : `Rev ${meta.rev}`}
              {" · "}
              <Link to={`/iso-forms/${meta.formKey}`} className="text-primary hover:underline">
                Filled records
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SaveStatus saving={updateRecord.isPending} unsaved={dirty && !updateRecord.isPending} />
            {canEdit && (
              <button type="button" onClick={saveRecord} disabled={updateRecord.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
                {updateRecord.isPending ? "Saving…" : "Save"}
              </button>
            )}
            <button type="button" onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Print
            </button>
          </div>
        </div>
        {meta.photos && (
          <div className="iso-tabs">
            <button type="button" onClick={() => setSheet("form")} className={`rounded-md border px-3 py-1.5 text-sm ${sheet === "form" ? "border-primary bg-primary/10" : "border-border"}`}>
              Quarantine Notice
            </button>
            <button type="button" onClick={() => setSheet("photos")} className={`rounded-md border px-3 py-1.5 text-sm ${sheet === "photos" ? "border-primary bg-primary/10" : "border-border"}`}>
              Photos
            </button>
          </div>
        )}
      </div>

      <div className="aq-print-sheet rounded-lg border border-border bg-card p-4">
        {meta.formType === "cross_training" ? (
          <CrossTrainingSheet cells={cells} readOnly={!canEdit} onChange={changeCell} />
        ) : (
          <>
            {meta.layout && (
              <div className={sheet === "photos" ? "iso-offscreen" : undefined}>
                <IsoFormSheet layout={meta.layout} cells={cells} calculated={calculated} readOnly={!canEdit} onChange={changeCell} label={meta.title} />
              </div>
            )}
            {meta.photos && (
              <div className={sheet === "form" ? "iso-offscreen" : "mt-4 flex flex-col gap-2"} data-testid="quarantine-photos">
                <h2 className="text-lg font-semibold">Photos</h2>
                <p className="text-sm text-muted-foreground no-print">Paste, drop, or insert pictures. They stay on this quarantine notice.</p>
                <PictureText value={photos} onChange={setPhotos} readOnly={!canEdit} entityType="iso_quality_form" entityId={record.id} ariaLabel="Quarantine photos" rows={8} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
