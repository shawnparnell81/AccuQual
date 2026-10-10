import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useFormTemplates } from "../../api/formTemplatesQuery";
import { createResourceHooks } from "../../api/resourceHooks";
import { FormNumberEditor, RecordFolderField, SaveResult, type SaveResultState } from "../../components/forms/FormDocumentControls";
import { SavedFormLockBar } from "../../components/forms/SavedFormLockBar";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { validationReportsCrumb } from "../../lib/folderBrowse";
import { RecordCrumbs } from "../../components/records/RecordStatus";
import { RecordFrame } from "../../components/records/RecordFrame";
import { RecordReferences } from "../../components/records/WorkflowStepLinks";
import { SaveStatus } from "../../components/shared/SaveStatus";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { RecordAccessMessage } from "../../components/shared/RecordAccessMessage";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { instanceRevision } from "../../lib/formDocument";
import { revisionToken } from "../../lib/printDocument";
import { cellsFromBatch, isBatch3 } from "../../lib/batch3Reports";
import { cellsFromData as springCellsFromData } from "../../lib/airSpringReport";
import { authorizedSignatureOf, cellsFromData as airCellsFromData } from "../../lib/airStrutReport";
import { cellsFromData as fuelCellsFromData } from "../../lib/fuelPumpReport";
import { blankBrakeCells, blankInjectorCells, cellsFromData as inspectionCells, furtherSignatureOf } from "../../lib/partInspection";
import { cellsFromData as csaCellsFromData, formTypeOf, VALIDATION_FORMS, type CellValue, type ValidationFormType } from "../../lib/validationReport";
import { AirSpringSheet } from "./AirSpringSheet";
import { AirStrutSheet } from "./AirStrutSheet";
import { FuelPumpSheet } from "./FuelPumpSheet";
import { Batch3Sheet } from "./Batch3Sheet";
import { PartInspectionSheet } from "./PartInspectionSheet";
import { ValidationReportSheet } from "./ValidationReportSheet";
import { FormHeader } from "../../components/brand/DmaLogo";
import { withChoice, type SignatureChoice } from "../../components/forms/signatureRequired";
import { RecordNumberEditor, RecordNumberField } from "../../components/forms/RecordNumberField";
import { RecordSiteField } from "../../components/records/RecordSiteField";
import { recordHeading } from "../../lib/userRecordNumber";
import { rememberRecord } from "../../lib/recentRecords";
import { savedFieldsEditable } from "../../lib/savedFormLock";
import { sheetIsDirty, sheetSnap } from "../../lib/sheetDirty";
import { useReportTabDirty } from "../../hooks/useReportTabDirty";
import { useSavedFormMode } from "../../hooks/useSavedFormMode";
import { useToast } from "../../components/shared/ToastProvider";
import { BEGIN_EDIT_ERROR, postBeginEdit } from "../../lib/beginEdit";
import { readBlankDraft } from "../../lib/blankDraft";
import { headerStatusFor } from "../../lib/headerStatus";
import { useFormFiling } from "../../components/forms/FormDocumentControls";
import { filedToast, saveShouldLock } from "../../lib/saveFiling";
import { failedValidationRows } from "../../lib/validationFailures";

interface ValidationReport {
  id: number;
  recordNumber?: string | null;
  data: { formType?: ValidationFormType; cells?: Record<string, CellValue>; _signatureRequired?: Record<string, SignatureChoice> };
  createdAt?: string | null;
  updatedAt?: string | null;
}

const hooks = createResourceHooks<ValidationReport>("validation-reports");

function loadCells(formType: ValidationFormType, data: unknown): Record<string, CellValue> {
  if (formType === "fuel_pump") return fuelCellsFromData(data);
  if (formType === "air_strut") return airCellsFromData(data);
  if (formType === "air_spring") return springCellsFromData(data);
  if (formType === "fuel_injector") return inspectionCells(data, blankInjectorCells);
  if (formType === "brake_wear") return inspectionCells(data, blankBrakeCells);
  if (isBatch3(formType)) return cellsFromBatch(formType, data);
  return csaCellsFromData(data);
}

export function ValidationReportDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const blank = useMemo(() => (id === "new" ? readBlankDraft(location.state, "/validation-reports") : null), [id, location.state]);
  const reportId = Number(id);
  const user = useCurrentUser();
  const { effective } = useEffectivePermissions();
  const canEdit = effective?.documents === "edit";
  const queryClient = useQueryClient();
  const loaded = hooks.useOne(blank ? undefined : reportId);
  const draftReport = useMemo(() => {
    if (!blank) return null;
    const data = blank.body.data && typeof blank.body.data === "object" ? (blank.body.data as ValidationReport["data"]) : { formType: "csa" as const, cells: {} };
    return { id: 0, data, recordNumber: null } satisfies ValidationReport;
  }, [blank]);
  const report = loaded.data ?? draftReport;
  const isLoading = blank ? false : loaded.isLoading;
  const isError = blank ? false : loaded.isError;
  const error = loaded.error;
  const updateReport = hooks.useUpdate();
  const signReport = hooks.useAction("sign");
  const formLock = useSavedFormMode(reportId, Boolean(canEdit));
  const mode = formLock.mode;
  const [cells, setCells] = useState<Record<string, CellValue> | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [savedSnap, setSavedSnap] = useState<{ id: number; snap: string } | null>(null);
  const [saveNote, setSaveNote] = useState<SaveResultState>(null);
  const [pending, setPending] = useState(false);
  const openingRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const draftNumber = useRef("");
  const [draftNumberText, setDraftNumberText] = useState("");
  const filing = useFormFiling(report ? VALIDATION_FORMS[formTypeOf(report.data)].formKey : null, reportId);

  const formType: ValidationFormType = formTypeOf(report?.data);
  const meta = VALIDATION_FORMS[formType];
  const formKey = meta.formKey;
  const templates = useFormTemplates();
  const documentNumber = templates.data?.find((item) => item.formKey === formKey)?.formId ?? "";

  useEffect(() => {
    if (!report || report.id === 0) return;
    const formTitle = VALIDATION_FORMS[formTypeOf(report.data)].title;
    rememberRecord({ path: `/validation-reports/${report.id}`, title: recordHeading(formTitle, report.recordNumber), type: "Validation" }, user?.id);
  }, [report, user?.id]);

  useEffect(() => {
    if (!report || loadedFor === report.id) return;
    const next = loadCells(formTypeOf(report.data), report.data);
    setCells(next);
    setSavedSnap({ id: report.id, snap: sheetSnap(next) });
    setLoadedFor(report.id);
  }, [loadedFor, report]);

  const liveSnap = cells == null ? "" : sheetSnap(cells);
  const dirty = report == null || cells == null ? false : sheetIsDirty(report.id, liveSnap, savedSnap);
  useReportTabDirty(dirty);

  if (id === "new" && !blank) return <p className="text-sm text-muted-foreground">Open this form from Blank Forms. Nothing is saved until you press Save.</p>;
  if (isError) return <RecordAccessMessage error={error} fallback="Couldn't load this validation report. Refresh the page and try again." noun="this validation form" />;
  if (isLoading || !report || !cells) return <LoadingPlaceholder />;

  const fieldsEditable = savedFieldsEditable(mode, canEdit);
  const filled = cells;
  const result = headerStatusFor(formType, filled);
  const passed = result === "Pass";
  const failed = result === "Fail";
  const badge = passed ? meta.pass : failed ? "#FF0000" : "transparent";
  const failures = failedValidationRows(formType, filled);
  const filed = (filing.data?.parentId ?? null) != null;
  const rev = instanceRevision(report.data, meta.revision);
  const doc = documentNumber.trim() ? `${documentNumber.trim()} Rev ${rev}` : `Rev ${rev}`;
  const title = recordHeading(meta.title, report.recordNumber);

  const multiSignature = formType === "fuel_injector" || formType === "brake_wear" || formType === "gas_lift";
  const savedReport = report;
  async function setSignatureRequired(path: string, choice: SignatureChoice) {
    await updateReport.mutateAsync({ id: reportId, data: { formType, cells: filled, _signatureRequired: withChoice(savedReport.data, path, choice) } });
    setSavedSnap({ id: reportId, snap: sheetSnap(filled) });
  }

  /** Write the sheet. Filing and locking stay with the caller. */
  async function persistRecord() {
    const data = { formType, cells: filled };
    if (savedReport.id === 0) {
      const created = (await apiClient.post<ValidationReport>("/validation-reports", { data, recordNumber: draftNumber.current.trim() || null })).data;
      navigate(`/validation-reports/${created.id}`, { replace: true, state: { freshForm: true } });
      return;
    }
    const saved = (await apiClient.patch<ValidationReport>(`/validation-reports/${reportId}`, { data })).data;
    queryClient.setQueryData(["validation-reports", reportId], saved);
    setSavedSnap({ id: reportId, snap: sheetSnap(filled) });
    void queryClient.invalidateQueries({ queryKey: ["validation-reports"] });
    void queryClient.invalidateQueries({ queryKey: ["workflow-history", "validation_reports", reportId] });
  }

  async function saveRecord(lock: boolean) {
    setPending(true);
    setSaveNote(null);
    try {
      await persistRecord();
      if (savedReport.id !== 0 && (lock || saveShouldLock(filed))) formLock.lock();
      if (savedReport.id !== 0) setSaveNote(filed ? "saved" : "unfiled");
    } catch {
      setSaveNote("error");
    } finally {
      setPending(false);
    }
  }

  async function createNcr(rows = failures) {
    if (savedReport.id === 0 || rows.length === 0) return;
    try {
      const created = (await apiClient.post<{ id: number }>(`/validation-reports/${savedReport.id}/ncr`, { rows })).data;
      toast.success("NCR created. Type the NCR number on that record.");
      void queryClient.invalidateQueries({ queryKey: ["validation-reports", savedReport.id] });
      navigate(`/ncr/${created.id}`);
    } catch {
      toast.error("Couldn't create the NCR.");
    }
  }

  async function startEdit() {
    if (!canEdit || openingRef.current || mode === "editing" || savedReport.id === 0) return;
    openingRef.current = true;
    setOpening(true);
    setEditError(null);
    try {
      await postBeginEdit(`/validation-reports/${reportId}/begin-edit`);
      formLock.unlock();
      void queryClient.invalidateQueries({ queryKey: ["workflow-history", "validation_reports", reportId] });
    } catch {
      setEditError(BEGIN_EDIT_ERROR);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }

  function cancelEdit() {
    const next = loadCells(formType, savedReport.data);
    setCells(next);
    setSavedSnap({ id: savedReport.id, snap: sheetSnap(next) });
    formLock.lock();
  }

  return (
    <RecordFrame
      className="validation-report-print min-w-0"
      relatedPlacement="below"
      header={
      <div className="no-print flex flex-col gap-4">
        <RecordCrumbs
          items={[
            validationReportsCrumb(),
            { label: title },
          ]}
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            {report.id === 0 ? (
              <RecordNumberField
                label="Report No."
                value={draftNumberText}
                disabled={!fieldsEditable}
                onChange={(next) => {
                  draftNumber.current = next;
                  setDraftNumberText(next);
                }}
              />
            ) : (
              <RecordNumberEditor label="Report No." value={report.recordNumber} canEdit={fieldsEditable} onSave={(next) => updateReport.mutateAsync({ id: reportId, recordNumber: next.trim() || null })} />
            )}
            {report.id > 0 && <RecordSiteField entity="validation_report" id={reportId} canEdit={fieldsEditable} />}
            <FormNumberEditor formKey={formKey} compact />
            <p className="text-sm text-muted-foreground">
              {doc}
              {cells.B6 ? ` · ${cells.B6}` : ""}
              {" · "}
              <Link to={validationReportsCrumb().to} className="text-primary hover:underline">
                {validationReportsCrumb().label}
              </Link>
            </p>
            {report.id > 0 && (
              <RecordFolderField
                formKey={formKey}
                recordId={reportId}
                prepare={() => persistRecord()}
                onFiled={(folder) => {
                  formLock.lock();
                  toast.success(filedToast(folder));
                }}
              />
            )}
            {Array.isArray((report.data as { linkedNcrs?: { id: number }[] }).linkedNcrs) &&
              (report.data as { linkedNcrs: { id: number }[] }).linkedNcrs.map((link) => (
                <Link key={link.id} to={`/ncr/${link.id}`} className="text-xs text-primary hover:underline">
                  NCR {link.id}
                </Link>
              ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DeleteRecordButton
              resource="validation-reports"
              id={reportId}
              kind={meta.title}
              title={cells.B6 == null ? null : String(cells.B6)}
              number={report.recordNumber}
              navigateTo={validationReportsCrumb().to}
              allowed={canEdit}
              assignedOnly
            />
            <span className="rounded-md px-2 py-1 text-sm font-semibold" style={{ background: badge, color: passed || failed ? "#111" : undefined }} data-testid="validation-overall">
              {result}
            </span>
            {failures.length > 0 && report.id > 0 && (
              <button type="button" className="rounded-md border border-border px-2 py-1 text-sm" data-testid="create-ncr" onClick={() => void createNcr()}>
                Create NCR
              </button>
            )}
            <SaveStatus saving={updateReport.isPending || pending} unsaved={dirty && !updateReport.isPending && !pending} />
            <SavedFormLockBar
              mode={mode}
              canEdit={canEdit}
              pending={updateReport.isPending || pending}
              opening={opening}
              onEdit={() => startEdit()}
              onSave={() => void saveRecord(false)}
              onCancel={cancelEdit}
              onDone={() => {
                if (dirty) void saveRecord(true);
                else formLock.lock();
              }}
            />
            <SaveResult result={saveNote} />
            {editError && (
              <p className="text-xs text-destructive" data-testid="edit-error">
                {editError}
              </p>
            )}
          </div>
        </div>
      </div>
      }
      related={<RecordReferences modules={["documents", "validation"]} step={meta.title} entityType="validation_report" entityId={reportId} />}
    >
      <div
        className="aq-print-sheet min-w-0 rounded-lg border border-border bg-card p-4"
        data-print-title={title}
        data-print-number={report.recordNumber ?? ""}
        data-doc-id={documentNumber.trim() || undefined}
        data-doc-rev={revisionToken(rev) || undefined}
      >
        <FormHeader />
        {formType === "fuel_pump" ? (
          <FuelPumpSheet
            cells={cells}
            readOnly={!fieldsEditable}
            failedAddrs={failures.map((row) => row.addr)}
            onCreateNcr={(addr) => void createNcr(failures.filter((row) => row.addr === addr))}
            documentNumber={documentNumber}
            revision={rev}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        ) : formType === "air_strut" ? (
          <AirStrutSheet
            cells={cells}
            readOnly={!fieldsEditable}
            documentNumber={documentNumber}
            revision={rev}
            signature={authorizedSignatureOf(report.data)}
            onSign={async (pin) => {
              await signReport.mutateAsync({ id: reportId, pin, certified: true });
            }}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        ) : formType === "air_spring" ? (
          <AirSpringSheet
            cells={cells}
            readOnly={!fieldsEditable}
            documentNumber={documentNumber}
            revision={rev}
            signature={authorizedSignatureOf(report.data)}
            onSign={async (pin) => {
              await signReport.mutateAsync({ id: reportId, pin, certified: true });
            }}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        ) : formType === "fuel_injector" || formType === "brake_wear" ? (
          <PartInspectionSheet
            variant={formType}
            cells={cells}
            readOnly={!fieldsEditable}
            documentNumber={documentNumber}
            revision={rev}
            signature={authorizedSignatureOf(report.data)}
            furtherSignature={furtherSignatureOf(report.data)}
            onSign={async (pin) => {
              await signReport.mutateAsync({ id: reportId, pin, certified: true });
            }}
            onFurtherSign={async (pin) => {
              await signReport.mutateAsync({ id: reportId, field: "furtherSignature", pin, certified: true });
            }}
            signatureRequired={multiSignature ? (report.data._signatureRequired ?? {}) : undefined}
            onSignatureRequired={fieldsEditable ? setSignatureRequired : undefined}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        ) : isBatch3(formType) ? (
          <Batch3Sheet
            variant={formType}
            cells={cells}
            readOnly={!fieldsEditable}
            documentNumber={documentNumber}
            revision={rev}
            signature={authorizedSignatureOf(report.data)}
            furtherSignature={furtherSignatureOf(report.data)}
            onSign={
              formType === "shock"
                ? undefined
                : async (pin) => {
                    await signReport.mutateAsync({ id: reportId, pin, certified: true });
                  }
            }
            onFurtherSign={
              formType === "gas_lift"
                ? async (pin) => {
                    await signReport.mutateAsync({ id: reportId, field: "furtherSignature", pin, certified: true });
                  }
                : undefined
            }
            signatureRequired={formType === "gas_lift" ? (report.data._signatureRequired ?? {}) : undefined}
            onSignatureRequired={formType === "gas_lift" && fieldsEditable ? setSignatureRequired : undefined}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        ) : (
          <ValidationReportSheet
            cells={cells}
            readOnly={!fieldsEditable}
            failedAddrs={failures.map((row) => row.addr)}
            onCreateNcr={(addr) => void createNcr(failures.filter((row) => row.addr === addr))}
            documentNumber={documentNumber}
            revision={rev}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        )}
      </div>
      <div className="no-print">
        <WorkflowHistoryPanel moduleName="validation_reports" recordId={reportId} />
      </div>
    </RecordFrame>
  );
}
