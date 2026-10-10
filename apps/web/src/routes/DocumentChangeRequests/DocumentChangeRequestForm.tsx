import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { DocumentChangeRequest } from "../../api/types";
import { PictureBoundText } from "../../components/forms/PictureText";
import { CompanyLogo } from "../../components/brand/DmaLogo";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { choiceOf, withChoice, type SignatureChoice } from "../../components/forms/signatureRequired";
import { formatDate } from "../../lib/dates";

/** Printed identity of paper form DCR-F-001. These are not record answers. */
const DOCUMENT_ID = "DCR-F-001";
const REV_LEVEL = "0";
const RELEASED_DATE = "10/9/2024";
const REV_DATE = "N/A";

const CHANGE_HELPER = "Attach a copy of the document with the requested changes highlighted.";
const FOOTER = "This document is the property of DMA Industries, LLC. Unauthorized use, reproduction, or distribution is prohibited.";

const REQUESTER_CERTIFY = "I certify that I request this document change and the information above is accurate.";
const VP_CERTIFY = "I certify that I approve this document change as VP of Engineering and Quality Assurance.";

const cell = "border border-border px-1.5 py-1 align-middle print:border-black";
const labelCell = `${cell} bg-muted/50 text-[11px] font-medium text-muted-foreground print:bg-transparent print:text-black`;
const inputClass = "w-full min-w-0 bg-transparent px-1 py-0.5 text-xs outline-none focus:bg-background focus:ring-1 focus:ring-primary print:text-black";

/**
 * Fillable DCR-F-001. One requester block and a fixed approval block.
 * SIGN cells use the shared PIN certification control. The previous
 * multi-row change table and free-form review rows are not on this sheet.
 */
export function DocumentChangeRequestForm({ dcr, onSaving }: { dcr: DocumentChangeRequest; onSaving?: (saving: boolean) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["document-change-requests", dcr.id] });

  const patchHeader = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiClient.patch(`/document-change-requests/${dcr.id}`, body)).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update.")),
  });

  const sign = useMutation({
    mutationFn: async ({ field, pin }: { field: "requester" | "vpEngineering"; pin: string }) =>
      (await apiClient.post(`/document-change-requests/${dcr.id}/sign`, { field, pin, certified: true })).data,
    onSuccess: invalidate,
  });

  const save = (body: Record<string, unknown>) => patchHeader.mutate(body);
  useEffect(() => {
    onSaving?.(patchHeader.isPending);
  }, [onSaving, patchHeader.isPending]);

  return (
    <div key={dcr.id} className="overflow-x-auto rounded-md border border-border bg-card print:border-black print:bg-white print:text-black" data-testid="dcr-f001-form">
      <table className="w-full min-w-[760px] border-collapse text-xs">
        <tbody>
          <tr>
            <td colSpan={6} className={`${cell} p-2`}>
              <div className="dma-form-header">
                <CompanyLogo height={36} />
                <h1 className="dma-form-title dma-form-title-plain">Document Change Request Form</h1>
                <dl className="dma-form-meta grid grid-cols-[auto_auto] gap-x-2 gap-y-0.5 text-[11px] leading-tight">
                  <dt>Document:</dt>
                  <dd className="font-medium">{DOCUMENT_ID}</dd>
                  <dt>Rev. Level:</dt>
                  <dd className="font-medium">{REV_LEVEL}</dd>
                  <dt>Released Date:</dt>
                  <dd className="font-medium">{RELEASED_DATE}</dd>
                  <dt>Rev. Date:</dt>
                  <dd className="font-medium">{REV_DATE}</dd>
                </dl>
              </div>
            </td>
          </tr>

          <tr>
            <th colSpan={6} scope="colgroup" className={`${cell} bg-muted px-2 py-1 text-left text-[11px] font-bold print:bg-transparent`}>
              To Be Filled by Requester
            </th>
          </tr>

          <tr>
            <th scope="row" className={labelCell}>DCR No.</th>
            <td className={cell} colSpan={5}>
              <TextCell ariaLabel="DCR No." value={dcr.formNo} onSave={(value) => save({ formNo: value || null })} />
            </td>
          </tr>

          <tr>
            <th scope="row" className={labelCell}>Requester Name</th>
            <td className={cell} colSpan={2}>
              <TextCell ariaLabel="Requester Name" value={dcr.requesterName} onSave={(value) => save({ requesterName: value || null })} />
            </td>
            <th scope="row" className={labelCell}>Title</th>
            <td className={cell} colSpan={2}>
              <TextCell ariaLabel="Title" value={dcr.requesterTitle} onSave={(value) => save({ requesterTitle: value || null })} />
            </td>
          </tr>

          <tr>
            <th scope="row" className={labelCell}>Request Action</th>
            <td className={cell} colSpan={5}>
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 py-0.5">
                <Check label="New" checked={dcr.actionNew} onChange={(checked) => save({ actionNew: checked })} />
                <Check label="Revision" checked={dcr.actionRevision} onChange={(checked) => save({ actionRevision: checked })} />
                <Check label="Cancellation/Obsolete" checked={dcr.actionCancellation} onChange={(checked) => save({ actionCancellation: checked })} />
              </div>
            </td>
          </tr>

          <tr>
            <th scope="row" className={labelCell}>Document Type</th>
            <td className={cell} colSpan={5}>
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 py-0.5">
                <Check label="SOP" checked={dcr.docTypeSop} onChange={(checked) => save({ docTypeSop: checked })} />
                <Check label="Bulletin" checked={dcr.docTypeBulletin} onChange={(checked) => save({ docTypeBulletin: checked })} />
                <Check label="Template" checked={dcr.docTypeTemplate} onChange={(checked) => save({ docTypeTemplate: checked })} />
                <Check label="Form" checked={dcr.docTypeForm} onChange={(checked) => save({ docTypeForm: checked })} />
              </div>
            </td>
          </tr>

          <tr>
            <th scope="row" className={labelCell}>Document/Process Name</th>
            <td className={cell} colSpan={5}>
              <TextCell ariaLabel="Document/Process Name" value={dcr.documentProcessName} onSave={(value) => save({ documentProcessName: value || null })} />
            </td>
          </tr>

          <tr>
            <th scope="row" className={labelCell}>Current Doc#</th>
            <td className={cell}>
              <TextCell ariaLabel="Current Doc#" value={dcr.currentDocNumber} onSave={(value) => save({ currentDocNumber: value || null })} />
            </td>
            <th scope="row" className={labelCell}>Current Doc Rev#</th>
            <td className={cell}>
              <TextCell ariaLabel="Current Doc Rev#" value={dcr.currentDocRev} onSave={(value) => save({ currentDocRev: value || null })} />
            </td>
            <th scope="row" className={labelCell}>Current Doc Rev. Date</th>
            <td className={cell}>
              <TextCell ariaLabel="Current Doc Rev. Date" type="date" value={dcr.currentDocRevDate} onSave={(value) => save({ currentDocRevDate: value || null })} />
            </td>
          </tr>

          <tr>
            <td colSpan={6} className={`${cell} p-1.5`}>
              <div className="px-0.5 text-[11px] font-medium text-muted-foreground print:text-black">Description of the change requested with rationale</div>
              <p className="px-0.5 pb-1 text-[11px] italic text-muted-foreground print:text-black">{CHANGE_HELPER}</p>
              <PictureBoundText
                className="min-h-[7rem] w-full rounded-sm border border-border bg-background px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary print:border-black print:bg-white print:text-black"
                rows={6}
                allowInsert={false}
                saved={dcr.changeDescription ?? ""}
                entityType="document_change_requests"
                entityId={dcr.id}
                onSave={(value) => save({ changeDescription: value || null })}
              />
            </td>
          </tr>

          <tr>
            <th scope="row" className={labelCell}>New Doc #</th>
            <td className={cell}>
              <TextCell ariaLabel="New Doc #" value={dcr.newDocNumber} onSave={(value) => save({ newDocNumber: value || null })} />
            </td>
            <th scope="row" className={labelCell}>New Doc Rev#</th>
            <td className={cell}>
              <TextCell ariaLabel="New Doc Rev#" value={dcr.newDocRev} onSave={(value) => save({ newDocRev: value || null })} />
            </td>
            <th scope="row" className={labelCell}>New Rev. Date</th>
            <td className={cell}>
              <TextCell ariaLabel="New Rev. Date" type="date" value={dcr.newRevDate} onSave={(value) => save({ newRevDate: value || null })} />
            </td>
          </tr>

          <tr>
            <th colSpan={6} scope="colgroup" className={`${cell} bg-muted px-2 py-1 text-left text-[11px] font-bold print:bg-transparent`}>
              Official Approval
            </th>
          </tr>

          <SignRow
            label="Requester Review and Approval"
            signature={dcr.requesterApprovalSignature}
            date={dcr.requesterApprovalDate}
            certify={REQUESTER_CERTIFY}
            onSign={(pin) => sign.mutateAsync({ field: "requester", pin })}
            requirement={{ value: choiceOf(dcr, "requesterApprovalSignature"), onChange: (choice: SignatureChoice) => save({ signatureRequired: withChoice(dcr, "requesterApprovalSignature", choice) }) }}
          />
          <SignRow
            label="VP of Engineering and Quality Assurance Approval"
            signature={dcr.vpApprovalSignature}
            date={dcr.vpApprovalDate}
            certify={VP_CERTIFY}
            onSign={(pin) => sign.mutateAsync({ field: "vpEngineering", pin })}
            requirement={{ value: choiceOf(dcr, "vpApprovalSignature"), onChange: (choice: SignatureChoice) => save({ signatureRequired: withChoice(dcr, "vpApprovalSignature", choice) }) }}
          />

          <tr>
            <th scope="row" className={labelCell}>Request Executed by</th>
            <td className={cell}>
              <TextCell ariaLabel="Request Executed by" value={dcr.requestExecutedBy} onSave={(value) => save({ requestExecutedBy: value || null })} />
            </td>
            <th scope="row" className={labelCell}>Title</th>
            <td className={cell}>
              <TextCell ariaLabel="Request executed title" value={dcr.requestExecutedTitle} onSave={(value) => save({ requestExecutedTitle: value || null })} />
            </td>
            <th scope="row" className={labelCell}>Date</th>
            <td className={cell}>
              <TextCell ariaLabel="Request executed date" type="date" value={dcr.requestExecutedDate} onSave={(value) => save({ requestExecutedDate: value || null })} />
            </td>
          </tr>

          <tr>
            <td colSpan={6} className={`${cell} px-2 py-1.5 text-center text-[10px] leading-snug text-muted-foreground print:text-black`}>
              {FOOTER}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TextCell({
  value,
  onSave,
  type = "text",
  ariaLabel,
}: {
  value: string | null | undefined;
  onSave: (value: string) => void;
  type?: string;
  ariaLabel: string;
}) {
  const saved = type === "date" ? (value ? value.slice(0, 10) : "") : (value ?? "");
  return (
    <input
      type={type}
      aria-label={ariaLabel}
      defaultValue={saved}
      onBlur={(event) => {
        if (event.target.value !== saved) onSave(event.target.value);
      }}
      className={inputClass}
    />
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs normal-case tracking-normal text-foreground">
      <input type="checkbox" checked={!!checked} onChange={(event) => onChange(event.target.checked)} className="print:accent-black" />
      {label}
    </label>
  );
}

function SignRow({
  label,
  signature,
  date,
  certify,
  onSign,
  requirement,
}: {
  label: string;
  signature: string | null;
  date: string | null;
  certify: string;
  onSign: (pin: string) => Promise<unknown>;
  requirement?: { value: SignatureChoice; onChange: (next: SignatureChoice) => void };
}) {
  const shown = date ? formatDate(date) : "";
  return (
    <tr>
      <th scope="row" className={labelCell}>
        {label}
      </th>
      <td className={cell} colSpan={3}>
        <div className="flex items-start gap-2">
          <span className="pt-1 text-[10px] font-semibold text-muted-foreground print:text-black">SIGN</span>
          <div className="min-w-0 flex-1">
            <SignatureStamp value={signature} certify={certify} variant="sheet" requirement={requirement} onSign={onSign} />
          </div>
        </div>
      </td>
      <th scope="row" className={labelCell}>Date</th>
      <td className={`${cell} text-xs`}>{shown}</td>
    </tr>
  );
}
