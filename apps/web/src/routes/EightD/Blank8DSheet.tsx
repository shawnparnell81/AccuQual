import { BLANK_8D_LABELS, BLANK_8D_TITLE, type Blank8DValues } from "../../lib/blank8d";
import { percentTotalHint } from "../../lib/eightDProgress";
import { PictureText } from "../../components/forms/PictureText";
import { FormHeader } from "../../components/brand/DmaLogo";
import "./blank8d.css";

interface Blank8DSheetProps {
  recordId: number;
  eightDNo: string;
  values: Blank8DValues;
  readOnly?: boolean;
  onChange: (patch: Partial<Blank8DValues>) => void;
}

function TextBox({
  value,
  readOnly,
  align = "center",
  onChange,
  label,
}: {
  value: string;
  readOnly?: boolean;
  align?: "left" | "center";
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <input
      className={`b8-input ${align}`}
      aria-label={label}
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Area({
  value,
  readOnly,
  onChange,
  label,
  recordId,
}: {
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  label: string;
  recordId: number;
}) {
  return (
    <PictureText
      className="b8-area"
      frameClassName="h-full w-full"
      ariaLabel={label}
      value={value}
      readOnly={readOnly}
      rows={3}
      entityType="eight_d"
      entityId={recordId}
      onChange={onChange}
    />
  );
}

function Check({
  checked,
  label,
  readOnly,
  onChange,
}: {
  checked: boolean;
  label: string;
  readOnly?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label>
      <input type="checkbox" checked={checked} disabled={readOnly} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Blank8DSheet({ recordId, eightDNo, values, readOnly, onChange }: Blank8DSheetProps) {
  const L = BLANK_8D_LABELS;
  const set = (key: keyof Blank8DValues) => (value: string) => onChange({ [key]: value } as Partial<Blank8DValues>);
  const setBool = (key: keyof Blank8DValues) => (checked: boolean) => onChange({ [key]: checked } as Partial<Blank8DValues>);

  return (
    <section className="b8" data-testid="blank-8d-sheet" aria-label={BLANK_8D_TITLE}>
      <FormHeader title={BLANK_8D_TITLE} />

      <div className="b8-cols b8-header">
        <div className="b8-lab left" style={{ gridColumn: "1 / 4" }}>{L.whoImpacted}</div>
        <div className="b8-lab" style={{ gridColumn: "4" }}>{L.dateOpen}</div>
        <div className="b8-val" style={{ gridColumn: "5 / 7" }}>
          <TextBox label={L.dateOpen} value={values.dateOpen} readOnly={readOnly} onChange={set("dateOpen")} />
        </div>
        <div className="b8-lab" style={{ gridColumn: "7" }}>{L.eightDNo}</div>
        <div className="b8-val" style={{ gridColumn: "8 / 10" }}>
          <TextBox label={L.eightDNo} value={eightDNo} readOnly align="left" onChange={() => undefined} />
        </div>

        <div className="b8-lab" style={{ gridColumn: "1" }}>{L.customer}</div>
        <div className="b8-val" style={{ gridColumn: "2 / 4" }}>
          <TextBox label={L.customer} value={values.customer} readOnly={readOnly} onChange={set("customer")} />
        </div>
        <div className="b8-lab" style={{ gridColumn: "4" }}>{L.initialResponse}</div>
        <div className="b8-val" style={{ gridColumn: "5 / 7" }}>
          <TextBox label={L.initialResponse} value={values.initialResponse} readOnly={readOnly} onChange={set("initialResponse")} />
        </div>
        <div className="b8-lab tiny" style={{ gridColumn: "7" }}>{L.customerComplaintNo}</div>
        <div className="b8-val" style={{ gridColumn: "8 / 10" }}>
          <TextBox label={L.customerComplaintNo} value={values.customerComplaintNo} readOnly={readOnly} onChange={set("customerComplaintNo")} />
        </div>

        <div className="b8-lab" style={{ gridColumn: "1" }}>{L.address}</div>
        <div className="b8-val" style={{ gridColumn: "2 / 4" }}>
          <TextBox label={L.address} value={values.address} readOnly={readOnly} onChange={set("address")} />
        </div>
        <div className="b8-lab" style={{ gridColumn: "4" }}>{L.targetCloseDate}</div>
        <div className="b8-val" style={{ gridColumn: "5 / 10" }}>
          <TextBox label={L.targetCloseDate} value={values.targetCloseDate} readOnly={readOnly} onChange={set("targetCloseDate")} />
        </div>

        <div className="b8-lab" style={{ gridColumn: "1" }}>{L.location}</div>
        <div className="b8-val" style={{ gridColumn: "2 / 4" }}>
          <TextBox label={L.location} value={values.location} readOnly={readOnly} onChange={set("location")} />
        </div>
        <div className="b8-lab" style={{ gridColumn: "4" }}>{L.revisionDates}</div>
        <div className="b8-val" style={{ gridColumn: "5 / 10" }}>
          <TextBox label={L.revisionDates} value={values.revisionDates} readOnly={readOnly} onChange={set("revisionDates")} />
        </div>

        <div className="b8-lab" style={{ gridColumn: "1" }}>{L.partNo}</div>
        <div className="b8-val" style={{ gridColumn: "2 / 4" }}>
          <TextBox label={L.partNo} value={values.partNo} readOnly={readOnly} onChange={set("partNo")} />
        </div>
        <div className="b8-lab" style={{ gridColumn: "4" }}>{L.initiator}</div>
        <div className="b8-val" style={{ gridColumn: "5 / 10" }}>
          <TextBox label={L.initiator} value={values.initiator} readOnly={readOnly} onChange={set("initiator")} />
        </div>

        <div className="b8-lab" style={{ gridColumn: "1" }}>{L.productName}</div>
        <div className="b8-val" style={{ gridColumn: "2 / 4" }}>
          <TextBox label={L.productName} value={values.productName} readOnly={readOnly} onChange={set("productName")} />
        </div>
        <div className="b8-lab" style={{ gridColumn: "4" }}>{L.initiatorSupervisor}</div>
        <div className="b8-val" style={{ gridColumn: "5 / 10" }}>
          <TextBox label={L.initiatorSupervisor} value={values.initiatorSupervisor} readOnly={readOnly} onChange={set("initiatorSupervisor")} />
        </div>

        <div className="b8-lab b8-impact" style={{ gridColumn: "1 / 4" }}>
          <Check label={L.impactedInternal} checked={values.impactedInternal} readOnly={readOnly} onChange={setBool("impactedInternal")} />
          <span className="b8-or">{L.impactedOr}</span>
          <Check label={L.impactedExternal} checked={values.impactedExternal} readOnly={readOnly} onChange={setBool("impactedExternal")} />
        </div>
        <div className="b8-lab" style={{ gridColumn: "4" }}>{L.actualCloseDate}</div>
        <div className="b8-val" style={{ gridColumn: "5 / 10" }}>
          <TextBox label={L.actualCloseDate} value={values.actualCloseDate} readOnly={readOnly} onChange={set("actualCloseDate")} />
        </div>
      </div>

      <section className="b8-cols b8-block d1d2" aria-label="D1 Team Members">
        <h2 className="b8-head" style={{ gridColumn: "1 / 4" }}>{L.d1}</h2>
        <h2 className="b8-head" style={{ gridColumn: "4 / 10" }}>{L.d2}</h2>
        <div className="b8-lab left" style={{ gridColumn: "1" }}>{L.champion}</div>
        <div className="b8-val" style={{ gridColumn: "2 / 4" }}>
          <TextBox label={L.champion} align="left" value={values.champion} readOnly={readOnly} onChange={set("champion")} />
        </div>
        <div className="b8-box problem">
          <Area recordId={recordId} label="D2 Problem statement" value={values.problemStatement} readOnly={readOnly} onChange={set("problemStatement")} />
        </div>
        <div className="b8-lab left" style={{ gridColumn: "1" }}>{L.teamLeader}</div>
        <div className="b8-val" style={{ gridColumn: "2 / 4" }}>
          <TextBox label={L.teamLeader} align="left" value={values.teamLeader} readOnly={readOnly} onChange={set("teamLeader")} />
        </div>
        <div className="b8-lab left" style={{ gridColumn: "1", alignItems: "flex-start" }}>{L.teamMembers}</div>
        <div className="b8-val" style={{ gridColumn: "2 / 4" }}>
          <Area recordId={recordId} label="D1 Team Members" value={values.teamMembers} readOnly={readOnly} onChange={set("teamMembers")} />
        </div>
      </section>

      <section className="b8-cols b8-block" aria-label="D3 Interim containment">
        <h2 className="b8-head" style={{ gridColumn: "1 / 7" }}>{L.d3}</h2>
        <div className="b8-head center" style={{ gridColumn: "7" }}>{L.percentEffective}</div>
        <div className="b8-head center" style={{ gridColumn: "8" }}>{L.targetDate}</div>
        <div className="b8-head center" style={{ gridColumn: "9" }}>{L.actualDate}</div>
        <div className="b8-box" style={{ gridColumn: "1 / 7" }}>
          <Area recordId={recordId} label="D3 Interim containment" value={values.ica} readOnly={readOnly} onChange={set("ica")} />
        </div>
        <div className="b8-val" style={{ gridColumn: "7" }}>
          <TextBox label="D3 percent effective" value={values.icaPercentEffective} readOnly={readOnly} onChange={set("icaPercentEffective")} />
          {percentTotalHint(values.icaPercentEffective) && <span className="b8-hint">{percentTotalHint(values.icaPercentEffective)}</span>}
        </div>
        <div className="b8-val" style={{ gridColumn: "8" }}>
          <TextBox label={L.targetDate} align="left" value={values.icaTargetDate} readOnly={readOnly} onChange={set("icaTargetDate")} />
        </div>
        <div className="b8-val" style={{ gridColumn: "9" }}>
          <TextBox label="D3 actual date" align="left" value={values.icaActualDate} readOnly={readOnly} onChange={set("icaActualDate")} />
        </div>
      </section>

      <section className="b8-cols b8-block" aria-label="D4 Root cause">
        <h2 className="b8-head" style={{ gridColumn: "1 / 8" }}>{L.d4}</h2>
        <div className="b8-head center" style={{ gridColumn: "8 / 10" }}>{L.percentContribution}</div>
        <div className="b8-box" style={{ gridColumn: "1 / 8" }}>
          <Area recordId={recordId} label="D4 Root cause" value={values.rootCauses} readOnly={readOnly} onChange={set("rootCauses")} />
        </div>
        <div className="b8-val" style={{ gridColumn: "8 / 10" }}>
          <TextBox label="D4 percent contribution" value={values.rootCausePercentContribution} readOnly={readOnly} onChange={set("rootCausePercentContribution")} />
          {percentTotalHint(values.rootCausePercentContribution) && <span className="b8-hint">{percentTotalHint(values.rootCausePercentContribution)}</span>}
        </div>
      </section>

      <section className="b8-cols b8-block" aria-label="D5 Permanent corrective action">
        <h2 className="b8-head" style={{ gridColumn: "1 / 8" }}>{L.d5}</h2>
        <div className="b8-head center" style={{ gridColumn: "8 / 10" }}>{L.percentEffective}</div>
        <div className="b8-box" style={{ gridColumn: "1 / 8" }}>
          <Area recordId={recordId} label="D5 Permanent corrective action" value={values.pca} readOnly={readOnly} onChange={set("pca")} />
        </div>
        <div className="b8-val" style={{ gridColumn: "8 / 10" }}>
          <TextBox label="D5 percent effective" value={values.pcaPercentEffective} readOnly={readOnly} onChange={set("pcaPercentEffective")} />
          {percentTotalHint(values.pcaPercentEffective) && <span className="b8-hint">{percentTotalHint(values.pcaPercentEffective)}</span>}
        </div>
      </section>

      <section className="b8-cols b8-block" aria-label="D6 Implementation">
        <h2 className="b8-head" style={{ gridColumn: "1 / 8" }}>{L.d6}</h2>
        <div className="b8-head center" style={{ gridColumn: "8" }}>{L.targetDate}</div>
        <div className="b8-head center" style={{ gridColumn: "9" }}>{L.actualDate}</div>
        <div className="b8-box" style={{ gridColumn: "1 / 8" }}>
          <Area recordId={recordId} label="D6 Implementation" value={values.implementation} readOnly={readOnly} onChange={set("implementation")} />
        </div>
        <div className="b8-val" style={{ gridColumn: "8" }}>
          <TextBox label="D6 target date" align="left" value={values.implementationTargetDate} readOnly={readOnly} onChange={set("implementationTargetDate")} />
        </div>
        <div className="b8-val" style={{ gridColumn: "9" }}>
          <TextBox label="D6 actual date" align="left" value={values.implementationActualDate} readOnly={readOnly} onChange={set("implementationActualDate")} />
        </div>
      </section>

      <section className="b8-cols b8-block d7-body" aria-label="D7 Prevention">
        <h2 className="b8-head d7-split" style={{ gridColumn: "1 / 8" }}>
          <span>{L.d7}</span>
          <span>{L.mistakeProofing}</span>
        </h2>
        <div className="b8-head center" style={{ gridColumn: "8" }}>{L.targetDate}</div>
        <div className="b8-head center" style={{ gridColumn: "9" }}>{L.actualDate}</div>
        <div className="b8-box" style={{ gridColumn: "1 / 8" }}>
          <Area recordId={recordId} label="D7 Prevention" value={values.prevention} readOnly={readOnly} onChange={set("prevention")} />
        </div>
        <div className="b8-val" style={{ gridColumn: "8" }}>
          <TextBox label={`${L.d7} ${L.targetDate}`} align="left" value={values.preventionTargetDate} readOnly={readOnly} onChange={set("preventionTargetDate")} />
        </div>
        <div className="b8-val" style={{ gridColumn: "9" }}>
          <TextBox label="D7 actual date" align="left" value={values.preventionActualDate} readOnly={readOnly} onChange={set("preventionActualDate")} />
        </div>
      </section>

      <div className="b8-block">
        <div className="b8-head center" style={{ justifyContent: "center" }}>{L.documentsReviewed}</div>
        <div className="b8-doc-checks">
          <span className="apply">{L.checkBoxes}</span>
          <Check label={L.controlPlan} checked={values.reviewedControlPlan} readOnly={readOnly} onChange={setBool("reviewedControlPlan")} />
          <Check label={L.fmea} checked={values.reviewedFmea} readOnly={readOnly} onChange={setBool("reviewedFmea")} />
          <Check label={L.flowchart} checked={values.reviewedFlowchart} readOnly={readOnly} onChange={setBool("reviewedFlowchart")} />
          <Check label={L.procWorkInstr} checked={values.reviewedProcWorkInstr} readOnly={readOnly} onChange={setBool("reviewedProcWorkInstr")} />
          <Check label={L.internalAudit} checked={values.reviewedInternalAudit} readOnly={readOnly} onChange={setBool("reviewedInternalAudit")} />
        </div>
      </div>

      <section className="b8-block d8-body" aria-label="D8 Recognition">
        <h2 className="b8-head">{L.d8}</h2>
        <div className="b8-box">
          <Area recordId={recordId} label="D8 Recognition" value={values.recognition} readOnly={readOnly} onChange={set("recognition")} />
        </div>
      </section>
    </section>
  );
}
