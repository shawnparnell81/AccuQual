import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useFormTemplates } from "../../api/formTemplatesQuery";
import { createResourceHooks } from "../../api/resourceHooks";
import { PictureText } from "../../components/forms/PictureText";
import { RecordCrumbs } from "../../components/records/RecordStatus";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { SaveStatus } from "../../components/shared/SaveStatus";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { fileChosenFolder, RecordFolderField, SaveResult, useFormFiling, type SaveResultState } from "../../components/forms/FormDocumentControls";
import { canEditFormStructure } from "../../lib/formStructureAccess";
import { changeRequestByFormType } from "../../lib/changeRequestKinds";
import { ecrCellLocked, ecrStatusLabel, type EcrWorkflowView } from "../../lib/ecrWorkflow";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { FORM_KEY_BY_TYPE, instanceRevision, revisionLabel } from "../../lib/formDocument";
import { auditScore, auditSignatures } from "../../lib/auditSummary";
import { isBatch4, summaryBatch4 } from "../../lib/batch4Reports";
import { isBatch5, summaryBatch5 } from "../../lib/batch5Reports";
import { isBatch6, summaryBatch6 } from "../../lib/batch6Reports";
import { formByType, type IsoFormType } from "../../lib/isoFormCatalog";
import { EXCLUSIVE_CHECKS } from "../../lib/isoFormLayouts";
import { showCell, quarantineTotal, type CellValue } from "../../lib/isoFormLogic";
import { QUALITY_EXCLUSIVE_CHECKS } from "../../lib/qualitySheetLayouts";
import { faiResult } from "../../lib/passFail";
import { plusDays, type FailureRow, type FaiLine, type ScorecardRow } from "../../lib/qualitySheetLogic";
import { Batch4Sheet } from "./Batch4Sheet";
import { Batch5Sheet } from "./Batch5Sheet";
import { Batch6Sheet } from "./Batch6Sheet";
import { EcrWorkflowPanel } from "./EcrWorkflowPanel";
import { MonthlyEngineeringSheet } from "./MonthlyEngineeringSheet";
import { VisitorLogSheet } from "./VisitorLogSheet";
import { CrossTrainingSheet } from "./CrossTrainingSheet";
import { FailureChartSheet } from "./FailureChartSheet";
import { FaiSheet } from "./FaiSheet";
import { IsoFormSheet } from "./IsoFormSheet";
import { ScorecardSheet } from "./ScorecardSheet";
import { FormHeader } from "../../components/brand/DmaLogo";

interface IsoFormData {
  cells?: Record<string, CellValue>;
  photos?: string;
  lines?: FaiLine[];
  customers?: ScorecardRow[];
  problems?: FailureRow[];
  months?: string[];
}

interface IsoQualityForm {
  id: number;
  formType: IsoFormType;
  data: IsoFormData;
  createdAt?: string | null;
  updatedAt?: string | null;
}

const hooks = createResourceHooks<IsoQualityForm>("iso-quality-forms");

const WIDE = new Set<IsoFormType>(["customer_scorecard", "failure_effectiveness", "first_article"]);

export function IsoFormDetailPage() {
  const { id } = useParams();
  const recordId = Number(id);
  const user = useCurrentUser();
  const { effective } = useEffectivePermissions();
  const canEdit = user?.roleName === "admin" || user?.roleName === "owner" || effective?.documents === "edit";
  const { data: record, isLoading, isError } = hooks.useOne(recordId);
  const updateRecord = hooks.useUpdate();
  const signForm = hooks.useAction("sign");
  const queryClient = useQueryClient();
  const requestKind = changeRequestByFormType(record?.formType);
  const ecrView = useQuery({
    queryKey: ["change-request-workflow", recordId],
    enabled: requestKind != null,
    queryFn: async () => (await apiClient.get<EcrWorkflowView>(`/iso-quality-forms/${recordId}/workflow`)).data,
  });
  const ecrTransition = useMutation({
    mutationFn: async (input: { action: string; note?: string }) => (await apiClient.post(`/iso-quality-forms/${recordId}/transition`, input)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["iso-quality-forms"] });
      await queryClient.invalidateQueries({ queryKey: ["change-request-workflow", recordId] });
      await queryClient.invalidateQueries({ queryKey: ["workflow-history", "iso_forms", recordId] });
    },
  });
  const [cells, setCells] = useState<Record<string, CellValue> | null>(null);
  const [photos, setPhotos] = useState("");
  const [lines, setLines] = useState<FaiLine[]>([]);
  const [customers, setCustomers] = useState<ScorecardRow[]>([]);
  const [problems, setProblems] = useState<FailureRow[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [sheet, setSheet] = useState<"form" | "photos">("form");
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  useEffect(() => {
    if (!record || loadedFor === record.id) return;
    setCells({ ...(record.data?.cells ?? {}) });
    setPhotos(record.data?.photos ?? "");
    setLines(record.data?.lines ?? []);
    setCustomers(record.data?.customers ?? []);
    setProblems(record.data?.problems ?? []);
    setMonths(record.data?.months ?? []);
    setLoadedFor(record.id);
  }, [loadedFor, record]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this form. Refresh the page and try again.</p>;
  if (isLoading || !record || !cells) return <LoadingPlaceholder />;

  const meta = formByType(record.formType);
  if (!meta) return <p className="text-sm text-destructive">This form type isn't recognized.</p>;

  const saved = record.data ?? {};
  const formType = record.formType;
  const scoredLines = (rows: FaiLine[]) => rows.map((line) => ({ ...line, result: faiResult(line.nominal, line.tolerance, line.actual) }));
  const currentLines = formType === "first_article" ? scoredLines(lines) : lines;
  const savedLines = formType === "first_article" ? scoredLines(saved.lines ?? []) : (saved.lines ?? []);
  const dirty =
    JSON.stringify(cells) !== JSON.stringify(saved.cells ?? {}) ||
    photos !== (saved.photos ?? "") ||
    JSON.stringify(currentLines) !== JSON.stringify(savedLines) ||
    JSON.stringify(customers) !== JSON.stringify(saved.customers ?? []) ||
    JSON.stringify(problems) !== JSON.stringify(saved.problems ?? []) ||
    JSON.stringify(months) !== JSON.stringify(saved.months ?? []);

  const calculated: Record<string, CellValue> = {};
  if (formType === "quarantine_notice") {
    const total = quarantineTotal(cells);
    if (total != null) calculated.B22 = total;
  }
  if (formType === "quality_alert") {
    const closing = plusDays(showCell(cells.B3), 30);
    if (closing) calculated.D3 = closing;
  }
  if (formType === "audit_summary") {
    const score = auditScore(cells);
    if (score) calculated.B13 = score;
  }

  function changeCell(addr: string, value: CellValue) {
    setCells((current) => {
      if (!current) return current;
      const next = { ...current, [addr]: value };
      const groups = [...(EXCLUSIVE_CHECKS[formType] ?? []), ...(QUALITY_EXCLUSIVE_CHECKS[formType] ?? [])];
      if (value === true) {
        for (const group of groups) {
          if (!group.includes(addr)) continue;
          for (const other of group) {
            if (other !== addr) next[other] = false;
          }
        }
      }
      if (formType === "ncr_report" && next.B22 !== true) {
        next.E22 = false;
        next.F22 = false;
      }
      return next;
    });
  }

  function payload(): IsoFormData {
    const data: IsoFormData = { cells: cells ?? {} };
    if (meta?.photos) data.photos = photos;
    if (formType === "first_article") data.lines = currentLines;
    if (formType === "customer_scorecard") data.customers = customers;
    if (formType === "failure_effectiveness") {
      data.problems = problems;
      data.months = months;
    }
    return data;
  }

  async function saveRecord() {
    await updateRecord.mutateAsync({ id: recordId, data: payload() });
  }

  const summary = isBatch4(formType) ? summaryBatch4(formType, cells) : isBatch5(formType) ? summaryBatch5(formType, cells) : isBatch6(formType) ? summaryBatch6(formType, cells) : showCell(cells.D5) || showCell(cells.B6) || showCell(cells.B3) || showCell(cells.B5) || showCell(cells.D2) || showCell(cells.F3) || showCell(cells.D4);
  const formKey = FORM_KEY_BY_TYPE[formType] ?? null;
  const signatures = formType === "audit_summary" ? auditSignatures(record.data) : {};

  async function signField(field: string, pin: string) {
    await signForm.mutateAsync({ id: recordId, field, pin, certified: true });
    if (changeRequestByFormType(formType)) {
      await queryClient.invalidateQueries({ queryKey: ["change-request-workflow", recordId] });
      await queryClient.invalidateQueries({ queryKey: ["workflow-history", "iso_forms", recordId] });
    }
  }

  return (
    <IsoFormDetailBody
      meta={meta}
      record={record}
      formKey={formKey}
      summary={summary}
      canEdit={canEdit}
      dirty={dirty}
      saving={updateRecord.isPending}
      onSave={saveRecord}
      sheet={sheet}
      setSheet={setSheet}
      cells={cells}
      photos={photos}
      setPhotos={setPhotos}
      lines={lines}
      customers={customers}
      problems={problems}
      months={months}
      calculated={calculated}
      changeCell={changeCell}
      setLines={setLines}
      setCustomers={setCustomers}
      setProblems={setProblems}
      setMonths={setMonths}
      recordId={recordId}
      signatures={signatures}
      onSign={formType === "audit_summary" || isBatch4(formType) || changeRequestByFormType(formType) ? signField : undefined}
      ecrView={changeRequestByFormType(formType) ? ecrView.data : undefined}
      ecrBusy={ecrTransition.isPending}
      canEditStructure={canEditFormStructure(user)}
      onEcrTransition={async (action, note) => {
        if (dirty) await saveRecord();
        await ecrTransition.mutateAsync({ action, note });
      }}
    />
  );
}

function signatureText(data: unknown, field: string): string {
  if (!data || typeof data !== "object") return "";
  const value = (data as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function IsoFormDetailBody({
  meta,
  record,
  formKey,
  summary,
  canEdit,
  dirty,
  saving,
  onSave,
  sheet,
  setSheet,
  cells,
  photos,
  setPhotos,
  lines,
  customers,
  problems,
  months,
  calculated,
  changeCell,
  setLines,
  setCustomers,
  setProblems,
  setMonths,
  recordId,
  signatures,
  onSign,
  ecrView,
  ecrBusy,
  canEditStructure,
  onEcrTransition,
}: {
  meta: NonNullable<ReturnType<typeof formByType>>;
  record: IsoQualityForm;
  formKey: string | null;
  summary: string;
  canEdit: boolean;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  sheet: "form" | "photos";
  setSheet: (sheet: "form" | "photos") => void;
  cells: Record<string, CellValue>;
  photos: string;
  setPhotos: (value: string) => void;
  lines: FaiLine[];
  customers: ScorecardRow[];
  problems: FailureRow[];
  months: string[];
  calculated: Record<string, CellValue>;
  changeCell: (addr: string, value: CellValue) => void;
  setLines: (lines: FaiLine[]) => void;
  setCustomers: (rows: ScorecardRow[]) => void;
  setProblems: (rows: FailureRow[]) => void;
  setMonths: (months: string[]) => void;
  recordId: number;
  signatures: Record<string, string>;
  onSign?: (field: string, pin: string) => Promise<unknown>;
  ecrView?: EcrWorkflowView;
  ecrBusy?: boolean;
  canEditStructure?: boolean;
  onEcrTransition?: (action: string, note?: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [saveNote, setSaveNote] = useState<SaveResultState>(null);
  const [pending, setPending] = useState(false);
  const filing = useFormFiling(formKey, record.id);
  const templates = useFormTemplates({ enabled: !!formKey });
  const formType = record.formType;
  const requestKind = changeRequestByFormType(formType);
  const liveFormId = templates.data?.find((item) => item.formKey === formKey)?.formId ?? "";
  const documentNumber = filing.data?.snapshotted ? filing.data.formNumber : liveFormId;
  const revision = ecrView?.revision || instanceRevision(record.data, meta.rev);

  async function save() {
    setPending(true);
    setSaveNote(null);
    try {
      await onSave();
      if (formType === "quarantine_notice") {
        void queryClient.invalidateQueries({ queryKey: ["quarantine"] });
      }
      if (!formKey) {
        setSaveNote("saved");
        return;
      }
      try {
        const filed = await fileChosenFolder(queryClient, formKey, recordId);
        setSaveNote(filed ?? "unfiled");
      } catch {
        setSaveNote("file-error");
      }
    } catch (err) {
      setSaveNote("error");
      toast.error(extractErrorMessage(err, "Couldn't save this form."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={`flex flex-col gap-4 ${WIDE.has(formType) ? "aq-print-wide" : ""}`}>
      <div className="no-print flex flex-col gap-4">
        <RecordCrumbs items={[{ label: meta.title, to: `/iso-forms/${meta.formKey}` }, { label: documentNumber ? `${documentNumber} #${record.id}` : `Record ${record.id}` }]} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold">{meta.title}</h1>
            <p className="text-sm text-muted-foreground">
              {revisionLabel(documentNumber, revision)}
              {" · "}
              <Link to={`/iso-forms/${meta.formKey}`} className="text-primary hover:underline">
                Filled records
              </Link>
            </p>
            {formKey && <RecordFolderField formKey={formKey} recordId={recordId} prepare={onSave} />}
          </div>
          <div className="flex items-center gap-2">
            <DeleteRecordButton resource="iso-quality-forms" id={recordId} kind={meta.title} title={summary || null} navigateTo={`/iso-forms/${meta.formKey}`} />
            <SaveStatus saving={saving} unsaved={dirty && !saving} />
            {canEdit && (
              <button type="button" onClick={() => void save()} disabled={saving || pending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
                {saving || pending ? "Saving…" : "Save"}
              </button>
            )}
            <SaveResult result={saveNote} />
            <button type="button" onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Print
            </button>
          </div>
        </div>
        {meta.photos && (
          <div className="iso-tabs">
            <button type="button" onClick={() => setSheet("form")} className={`rounded-md border px-3 py-1.5 text-sm ${sheet === "form" ? "border-primary bg-primary/10" : "border-border"}`}>
              QUARANTINE NOTICE
            </button>
            <button type="button" onClick={() => setSheet("photos")} className={`rounded-md border px-3 py-1.5 text-sm ${sheet === "photos" ? "border-primary bg-primary/10" : "border-border"}`}>
              Photos
            </button>
          </div>
        )}
        {requestKind && ecrView && onEcrTransition && (
          <EcrWorkflowPanel
            recordId={recordId}
            view={ecrView}
            canEditStructure={canEditStructure === true}
            busy={ecrBusy === true}
            onTransition={onEcrTransition}
            structureSlug={requestKind.slug}
            structureCertify={requestKind.structureCertify}
            labelDefaults={requestKind.labels}
            noun={requestKind.noun}
          />
        )}
      </div>

      <div className="aq-form-copy aq-print-sheet min-w-0 rounded-lg border border-border bg-card p-4">
        <FormHeader />
        {formType === "cross_training" ? (
          <CrossTrainingSheet cells={cells} readOnly={!canEdit} onChange={changeCell} documentNumber={documentNumber} />
        ) : formType === "visitor_log" ? (
          <VisitorLogSheet cells={cells} readOnly={!canEdit} onChange={changeCell} documentNumber={documentNumber} revision={revision} />
        ) : formType === "monthly_engineering" ? (
          <MonthlyEngineeringSheet cells={cells} readOnly={!canEdit} onChange={changeCell} revision={revision} />
        ) : isBatch4(formType) ? (
          <Batch4Sheet
            variant={formType}
            cells={cells}
            readOnly={!canEdit}
            onChange={changeCell}
            documentNumber={documentNumber}
            revision={revision}
            testedSignature={signatureText(record.data, "testedSignature")}
            approvedSignature={signatureText(record.data, formType === "prototype_strut" ? "engineeringSignoffSignature" : formType === "scar_request" ? "managerSignature" : "approvedSignature")}
            onSign={onSign}
          />
        ) : isBatch5(formType) ? (
          <Batch5Sheet variant={formType} cells={cells} readOnly={!canEdit} onChange={changeCell} documentNumber={documentNumber} />
        ) : isBatch6(formType) ? (
          <Batch6Sheet
            variant={formType}
            cells={cells}
            readOnly={!canEdit}
            onChange={changeCell}
            documentNumber={documentNumber}
            managerSignature={signatureText(record.data, "managerSignature")}
            supplierSignature={signatureText(record.data, "supplierRepSignature")}
            onSign={onSign}
            labels={requestKind ? ecrView?.labels : undefined}
            revision={requestKind ? revision : undefined}
            workflowStatus={requestKind ? ecrStatusLabel(ecrView?.workflow.status ?? "request") : undefined}
            cellLocked={requestKind && ecrView ? (addr) => ecrCellLocked(ecrView.editing, canEdit, addr) : undefined}
            managerLocked={requestKind ? !canEdit || (ecrView != null && ecrView.workflow.status !== "request" && ecrView.workflow.status !== "review") : undefined}
            supplierLocked={requestKind ? !canEdit || ecrView?.workflow.status === "closed" : undefined}
            managerCertify={requestKind?.managerCertify}
            supplierCertify={requestKind?.supplierCertify}
          />
        ) : formType === "first_article" ? (
          <FaiSheet cells={cells} lines={lines} readOnly={!canEdit} onCell={changeCell} onLines={setLines} documentNumber={documentNumber} revision={revision} />
        ) : formType === "customer_scorecard" ? (
          <ScorecardSheet cells={cells} customers={customers} readOnly={!canEdit} onCell={changeCell} onCustomers={setCustomers} documentNumber={documentNumber} revision={revision} />
        ) : formType === "failure_effectiveness" ? (
          <FailureChartSheet months={months} problems={problems} readOnly={!canEdit} onMonths={setMonths} onProblems={setProblems} documentNumber={documentNumber} revision={revision} />
        ) : (
          <>
            {meta.layout && (
              <div className={sheet === "photos" ? "iso-offscreen" : undefined}>
                <IsoFormSheet layout={meta.layout} cells={cells} calculated={calculated} readOnly={!canEdit} onChange={changeCell} label={meta.title} documentNumber={formKey ? documentNumber : ""} revision={revision} signatures={signatures} onSign={onSign} />
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

      <div className="no-print">
        <WorkflowHistoryPanel moduleName="iso_forms" recordId={recordId} />
      </div>
    </div>
  );
}
