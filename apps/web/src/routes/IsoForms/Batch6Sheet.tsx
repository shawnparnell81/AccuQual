import { Fragment, useMemo } from "react";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { BATCH6_PURPOSE, BATCH6_SHEET_TITLE, evaluateBatch6, showBatch6, type Batch6Kind } from "../../lib/batch6Reports";
import type { CellValue } from "../../lib/isoFormLogic";
import "../ValidationReports/validationReport.css";

interface Batch6SheetProps {
  variant: Batch6Kind;
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber?: string;
  managerSignature?: string;
  supplierSignature?: string;
  onSign?: (field: string, pin: string) => Promise<unknown>;
  labels?: Record<string, string>;
  revision?: string;
  workflowStatus?: string;
  cellLocked?: (addr: string) => boolean;
  managerLocked?: boolean;
  supplierLocked?: boolean;
}

function text(value: CellValue | undefined): string {
  return value === undefined || value === null || typeof value === "boolean" ? "" : String(value);
}

function locked(props: SheetProps, addr: string): boolean {
  if (props.cellLocked) return props.cellLocked(addr);
  return props.readOnly === true;
}

function labelOf(props: SheetProps, key: string, fallback: string): string {
  const value = props.labels?.[key];
  return value && value.trim() ? value : fallback;
}

function parseNumber(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

type SheetProps = Batch6SheetProps & { calculated: Record<string, CellValue>; cols: number };

function Field(props: SheetProps & { addr: string; kind?: "text" | "number" | "date" | "area" | "yesno" }) {
  const value = text(props.cells[props.addr]);
  const disabled = locked(props, props.addr);
  if (props.kind === "area") {
    return <textarea aria-label={props.addr} value={value} disabled={disabled} onChange={(event) => props.onChange(props.addr, event.target.value)} />;
  }
  if (props.kind === "yesno") {
    return (
      <select aria-label={props.addr} value={value} disabled={disabled} onChange={(event) => props.onChange(props.addr, event.target.value)}>
        {["", "YES", "NO"].map((option) => (
          <option key={option || "blank"} value={option}>
            {option || "—"}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={props.addr}
      type={props.kind === "date" ? "date" : "text"}
      value={value}
      disabled={disabled}
      onChange={(event) => props.onChange(props.addr, props.kind === "number" ? parseNumber(event.target.value) : event.target.value)}
    />
  );
}

function Check(props: SheetProps & { addr: string; label: string }) {
  return (
    <label>
      <input
        aria-label={props.addr}
        type="checkbox"
        checked={props.cells[props.addr] === true}
        disabled={locked(props, props.addr)}
        onChange={(event) => props.onChange(props.addr, event.target.checked)}
      />
      {props.label}
    </label>
  );
}

function Calc(props: { value: CellValue | undefined }) {
  return <td>{showBatch6(props.value)}</td>;
}

function Section(props: { cols: number; children: string }) {
  return (
    <tr>
      <td className="section" colSpan={props.cols}>
        {props.children}
      </td>
    </tr>
  );
}

function Line(props: SheetProps & { label: string; addr: string; note?: string; numeric?: boolean; kind?: "text" | "number" | "yesno" | "area" }) {
  return (
    <tr>
      <td>{props.label}</td>
      <td>
        <Field {...props} addr={props.addr} kind={props.kind ?? (props.numeric ? "number" : "text")} />
      </td>
      <td colSpan={props.cols - 2}>{props.note ?? ""}</td>
    </tr>
  );
}

export function Batch6Sheet(props: Batch6SheetProps) {
  const calculated = useMemo(() => evaluateBatch6(props.variant, props.cells), [props.cells, props.variant]);
  const cols = props.variant === "dev_electronic_csa" ? 7 : 6;
  const doc = props.documentNumber?.trim() ? `Doc ID: ${props.documentNumber.trim()}` : "Doc ID:";
  const shared = { ...props, calculated, cols };
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid={`${props.variant}-sheet`} aria-label={BATCH6_SHEET_TITLE[props.variant]}>
        <tbody>
          <tr>
            <td className="title" colSpan={cols}>
              {BATCH6_SHEET_TITLE[props.variant]}
            </td>
          </tr>
          {props.variant === "engineering_change" ? (
            <tr>
              <td>{doc}</td>
              <td>{`Rev: ${props.revision?.trim() || "B"}`}</td>
              <td colSpan={2}>Location: ISO Compliance Documents / Blank Form Templates</td>
              <td colSpan={2}>
                Approved By: <Field {...shared} addr="F2" />
              </td>
            </tr>
          ) : (
            <>
              <tr>
                <td>{doc}</td>
                <td>Rev: A</td>
                <td>{props.variant === "dev_electronic_csa" ? "Effective Date: 3/25/2026" : "Effective Date: 05/19/2026"}</td>
                <td colSpan={cols - 3}>
                  Approved By: <Field {...shared} addr="E2" />
                </td>
              </tr>
              <tr>
                <td className="note" colSpan={cols}>
                  {BATCH6_PURPOSE[props.variant]}
                </td>
              </tr>
            </>
          )}
          {props.variant === "dev_electronic_csa" && <ElectronicCsa {...shared} />}
          {props.variant === "dev_shock" && <ShockDev {...shared} />}
          {props.variant === "engineering_change" && <ChangeRequest {...shared} />}
        </tbody>
      </table>
    </div>
  );
}

function ElectronicCsa(props: SheetProps) {
  const states = [45, 47, 49, 51];
  return (
    <>
      <Section cols={props.cols}>1.0 PROJECT & VEHICLE INFORMATION</Section>
      <tr>
        <td>Part Number:</td>
        <td>
          <Field {...props} addr="B6" />
        </td>
        <td>Application:</td>
        <td colSpan={4}>
          <Field {...props} addr="D6" />
        </td>
      </tr>
      <tr>
        <td>Brand Tested (OE/Competitor):</td>
        <td>
          <Field {...props} addr="B7" />
        </td>
        <td>Condition (New/Used):</td>
        <td colSpan={4}>
          <Field {...props} addr="D7" />
        </td>
      </tr>
      <tr>
        <td>Curb Weight (lb):</td>
        <td>
          <Field {...props} addr="B8" kind="number" />
        </td>
        <td>Weight Distribution (%):</td>
        <td colSpan={4}>
          <Field {...props} addr="D8" kind="number" />
        </td>
      </tr>
      <tr>
        <td>Motion Ratio:</td>
        <td colSpan={6}>
          <Field {...props} addr="B9" kind="number" />
        </td>
      </tr>
      <tr>
        <td>Tested By:</td>
        <td>
          <Field {...props} addr="B10" />
        </td>
        <td>Date:</td>
        <td colSpan={4}>
          <Field {...props} addr="D10" kind="date" />
        </td>
      </tr>
      <Section cols={props.cols}>2.0 UPPER MOUNT, BEARING & BUSHING</Section>
      <Line {...props} label="Bearing Turning Test Under Pressure:" addr="B14" kind="text" note="Pass/Fail" />
      <Line {...props} label="Does spring wind up with bearing?:" addr="B15" note="Yes/No" />
      <Line {...props} label="Strut Mount Orientation:" addr="B16" note="Diagram from OE" />
      <Line {...props} label="Bushing Travel Length (mm):" addr="B17" numeric />
      <Line {...props} label="Bushing Hardness Value (Shore A):" addr="B18" numeric />
      <Section cols={props.cols}>3.0 SPRING SPECIFICATIONS & RIDE HEIGHT</Section>
      <Line {...props} label="Total CSA Length Unloaded (mm):" addr="B22" numeric />
      <Line {...props} label="Total Spring Length (mm):" addr="B23" numeric />
      <Line {...props} label="Wire Diameter (mm):" addr="B24" numeric />
      <Line {...props} label="Number of Coils:" addr="B25" numeric />
      <Line {...props} label="Top Inner Diameter (mm):" addr="B26" numeric />
      <Line {...props} label="Outer Diameter (mm):" addr="B27" numeric />
      <Line {...props} label="Bottom Inner Diameter (mm):" addr="B28" numeric />
      <Line {...props} label="Description of Spring:" addr="B29" note="straight wound, offset wound" />
      <tr>
        <td>Target Force (N):</td>
        <Calc value={props.calculated.B30} />
        <td colSpan={5}>Curb Weight × Weight Distribution / 2 / Motion Ratio × 4.45 / 100</td>
      </tr>
      <tr>
        <td>Natural Frequency (Hz):</td>
        <Calc value={props.calculated.B31} />
        <td colSpan={5}>From spring rate, target force, and motion ratio</td>
      </tr>
      <tr>
        <td>Stress (Mpa):</td>
        <Calc value={props.calculated.B32} />
        <td colSpan={5}>Wahl stress from outer diameter, wire diameter, and target force</td>
      </tr>
      <Line {...props} label="Spring Rate - Complete CSA (N/mm):" addr="B33" numeric />
      <Line {...props} label="Overall Height at Ride Force (mm):" addr="B34" numeric />
      <Section cols={props.cols}>4.0 DAMPER & STROKE SPECIFICATIONS</Section>
      <Line {...props} label="Stroke Length (mm):" addr="B38" numeric />
      <tr>
        <td>Percent Displaced (%):</td>
        <Calc value={props.calculated.B39} />
        <td colSpan={5}>(Unloaded length − ride height) / stroke</td>
      </tr>
      <Line {...props} label="Bump Stop Length (mm):" addr="B40" numeric />
      <tr>
        <td>Bump Stop Percent of Stroke (%):</td>
        <Calc value={props.calculated.B41} />
        <td colSpan={5}>Bump stop length / stroke</td>
      </tr>
      <Section cols={props.cols}>5.0 DAMPING FORCE TEST (CTW DYNO / JASO C602)</Section>
      <tr>
        <td>Current State</td>
        <td>Velocity (m/s)</td>
        <td>0.05</td>
        <td>0.1</td>
        <td>0.3</td>
        <td>0.6</td>
        <td>1</td>
      </tr>
      {states.map((row, index) => (
        <Fragment key={row}>
          <tr>
            <td>
              State {index + 1}: <Field {...props} addr={`A${row}`} /> Amps
            </td>
            <td>Compression Force (N)</td>
            {["C", "D", "E", "F", "G"].map((col) => (
              <td key={col}>
                <Field {...props} addr={`${col}${row}`} kind="number" />
              </td>
            ))}
          </tr>
          <tr>
            <td />
            <td>Rebound Force (N)</td>
            {["C", "D", "E", "F", "G"].map((col) => (
              <td key={col}>
                <Field {...props} addr={`${col}${row + 1}`} kind="number" />
              </td>
            ))}
          </tr>
        </Fragment>
      ))}
      <Section cols={props.cols}>6.0 ELECTRONICS & HARDWARE</Section>
      <Line {...props} label="DC Resistance of Electronics (Ohms)" addr="B55" numeric />
      <Line {...props} label="Inductance of Electronics @ 1kHz (microH)" addr="B56" numeric />
      <Line {...props} label="Impedance of Electronics @ 1kHz (Ohms)" addr="B57" numeric />
      <Line {...props} label="Notes" addr="B58" kind="area" />
      <Section cols={props.cols}>7.0 FASTENERS & THREADS</Section>
      <tr>
        <td>Location</td>
        <td>Thread Size</td>
        <td>Nut Style</td>
        <td colSpan={4}>Description of Location</td>
      </tr>
      {[62, 63, 64].map((row, index) => (
        <tr key={row}>
          <td>Location {index + 1}:</td>
          <td>
            <Field {...props} addr={`B${row}`} />
          </td>
          <td>
            <Field {...props} addr={`C${row}`} />
          </td>
          <td colSpan={4}>
            <Field {...props} addr={`D${row}`} />
          </td>
        </tr>
      ))}
      <Section cols={props.cols}>8.0 COMPONENT WEIGHTS</Section>
      <Line {...props} label="Strut Mount:" addr="B68" numeric />
      <Line {...props} label="Bearing:" addr="B69" numeric />
      <Line {...props} label="Body of Strut:" addr="B70" numeric />
      <Line {...props} label="Coil Spring:" addr="B71" numeric />
      <Line {...props} label="Complete CSA:" addr="B72" numeric />
      <Section cols={props.cols}>9.0 ENGINEERING RESEARCH & CONSOLIDATION</Section>
      <tr>
        <td>Research Application:</td>
        <td colSpan={6}>Are there more than one style available for this application? If yes, can they be consolidated?</td>
      </tr>
      <tr>
        <td colSpan={7}>
          <Field {...props} addr="B76" kind="area" />
        </td>
      </tr>
      <tr>
        <td>Common Issues:</td>
        <td colSpan={6}>Are there common issues with SENSEN or the OE that can be solved easily on this strut? List all improvements.</td>
      </tr>
      <tr>
        <td colSpan={7}>
          <Field {...props} addr="B78" kind="area" />
        </td>
      </tr>
      <tr>
        <td>Notes:</td>
        <td colSpan={6}>
          <Field {...props} addr="B79" kind="area" />
        </td>
      </tr>
      <tr>
        <td>DMA Improvements:</td>
        <td colSpan={6}>
          <Field {...props} addr="B80" kind="area" />
        </td>
      </tr>
    </>
  );
}

function ShockDev(props: SheetProps) {
  return (
    <>
      <Section cols={props.cols}>1.0 PROJECT & VEHICLE INFORMATION</Section>
      <tr>
        <td>Sample Part Number:</td>
        <td>
          <Field {...props} addr="B6" />
        </td>
        <td>Application:</td>
        <td colSpan={3}>
          <Field {...props} addr="D6" />
        </td>
      </tr>
      <tr>
        <td>Brand Tested (OE/Competitor):</td>
        <td>
          <Field {...props} addr="B7" />
        </td>
        <td>Condition (New/Used):</td>
        <td colSpan={3}>
          <Field {...props} addr="D7" />
        </td>
      </tr>
      <tr>
        <td>Vehicle Weight (lbs):</td>
        <td>
          <Field {...props} addr="B8" kind="number" />
        </td>
        <td>Weight Distribution (%):</td>
        <td>
          <Field {...props} addr="D8" kind="number" />
        </td>
        <td>Motion Ratio:</td>
        <td>
          <Field {...props} addr="F8" kind="number" />
        </td>
      </tr>
      <tr>
        <td>Tested By:</td>
        <td>
          <Field {...props} addr="B9" />
        </td>
        <td>Date:</td>
        <td colSpan={3}>
          <Field {...props} addr="D9" kind="date" />
        </td>
      </tr>
      <Section cols={props.cols}>2.0 PHYSICAL DIMENSIONS & CONSTRUCTION</Section>
      <Line {...props} label="Extended Length (mm):" addr="B13" numeric />
      <Line {...props} label="Compressed Length (mm):" addr="B14" numeric />
      <Line {...props} label="Stroke Length (mm):" addr="B15" numeric />
      <Line {...props} label="Bump Stop Length (mm):" addr="B16" numeric />
      <Line {...props} label="Top Mounting Type:" addr="B17" />
      <Line {...props} label="Bottom Mounting Type:" addr="B18" />
      <Line {...props} label="Dust Boot Included (Y/N):" addr="B19" />
      <Line {...props} label="Paint Thickness (microns):" addr="B20" numeric />
      <Section cols={props.cols}>3.0 DAMPING FORCE TEST (CTW DYNO / JASO C602)</Section>
      <tr>
        <td>Velocity (m/s)</td>
        <td>0.05</td>
        <td>0.1</td>
        <td>0.3</td>
        <td>0.6</td>
        <td>1</td>
      </tr>
      <tr>
        <td>Compression Force (N)</td>
        {["B", "C", "D", "E", "F"].map((col) => (
          <td key={col}>
            <Field {...props} addr={`${col}24`} kind="number" />
          </td>
        ))}
      </tr>
      <tr>
        <td>Rebound Force (N)</td>
        {["B", "C", "D", "E", "F"].map((col) => (
          <td key={col}>
            <Field {...props} addr={`${col}25`} kind="number" />
          </td>
        ))}
      </tr>
      <Section cols={props.cols}>4.0 HARDWARE & FASTENERS</Section>
      <Line {...props} label="Hardware Kit Contents:" addr="B28" />
      <tr>
        <td>Location</td>
        <td>Thread Size</td>
        <td>Nut Style</td>
        <td colSpan={3}>Description of Location</td>
      </tr>
      {[30, 31, 32].map((row, index) => (
        <tr key={row}>
          <td>Location {index + 1}:</td>
          <td>
            <Field {...props} addr={`B${row}`} />
          </td>
          <td>
            <Field {...props} addr={`C${row}`} />
          </td>
          <td colSpan={3}>
            <Field {...props} addr={`D${row}`} />
          </td>
        </tr>
      ))}
      <Section cols={props.cols}>5.0 WEIGHTS & PACKAGING</Section>
      <Line {...props} label="Shock Absorber Weight (lbs):" addr="B36" numeric />
      <Line {...props} label="Hardware Weight (oz):" addr="B37" numeric />
      <Line {...props} label="Total Package Weight (lbs):" addr="B38" numeric />
      <Line {...props} label="Box Size (H x W x L) (mm):" addr="B39" />
      <Line {...props} label="Foam Insert Construction:" addr="B40" />
      <Section cols={props.cols}>6.0 VISUAL & ENGINEERING RESEARCH</Section>
      <Line {...props} label="Differences to OE:" addr="B43" kind="area" />
      <Line {...props} label="Major Issues with OEM:" addr="B44" kind="area" />
      <Line {...props} label="DMA Solutions:" addr="B45" kind="area" />
      <Line {...props} label="Application Research:" addr="B46" kind="area" note="Are there more than one style for this application? If yes, can they be consolidated?" />
      <tr>
        <td className="section" colSpan={6}>
          Notes
        </td>
      </tr>
      <tr>
        <td colSpan={6}>
          <Field {...props} addr="A48" kind="area" />
        </td>
      </tr>
    </>
  );
}

function ChangeRequest(props: SheetProps) {
  const line = (key: string, fallback: string) => labelOf(props, key, fallback);
  return (
    <>
      {props.workflowStatus ? (
        <tr>
          <td>{line("workflowStatus", "Workflow Status:")}</td>
          <td colSpan={5}>{props.workflowStatus}</td>
        </tr>
      ) : null}
      <Section cols={props.cols}>{line("section1", "SECTION 1: IDENTIFICATION")}</Section>
      <tr>
        <td>{line("dateOfRequest", "Date of Request:")}</td>
        <td>
          <Field {...props} addr="B5" kind="date" />
        </td>
        <td>{line("requestedBy", "Requested By:")}</td>
        <td colSpan={3}>
          <Field {...props} addr="D5" />
        </td>
      </tr>
      <tr>
        <td>{line("partNumbers", "Part Number(s) Affected:")}</td>
        <td>
          <Field {...props} addr="B6" />
        </td>
        <td>{line("currentRevision", "Current Revision:")}</td>
        <td colSpan={3}>
          <Field {...props} addr="D6" />
        </td>
      </tr>
      <tr>
        <td>{line("job", "Job / Project:")}</td>
        <td>
          <Field {...props} addr="B7" />
        </td>
        <td>{line("newRevision", "New Revision (Proposed):")}</td>
        <td colSpan={3}>
          <Field {...props} addr="D7" />
        </td>
      </tr>
      <Section cols={props.cols}>{line("section2", "SECTION 2: CHANGE DETAILS")}</Section>
      <tr>
        <td>{line("changeType", "Type of Change:")}</td>
        <td>
          <Check {...props} addr="B10" label={line("changeSupplier", "Supplier Request")} />
        </td>
        <td>
          <Check {...props} addr="C10" label={line("changeCost", "Cost Reduction")} />
        </td>
        <td>
          <Check {...props} addr="D10" label={line("changeQuality", "Quality Improvement")} />
        </td>
        <td colSpan={2}>
          <Check {...props} addr="E10" label={line("changeDimensional", "Dimensional Correction")} />
        </td>
      </tr>
      <tr>
        <td>{line("description", "Description of Change (Current vs. Proposed):")}</td>
        <td colSpan={5}>
          <Field {...props} addr="B11" kind="area" />
        </td>
      </tr>
      <tr>
        <td>{line("reason", "Reason / Explanation:")}</td>
        <td colSpan={5}>
          <Field {...props} addr="B12" kind="area" />
        </td>
      </tr>
      <tr>
        <td>{line("drawingUpdate", "Drawing Update Required?")}</td>
        <td>
          <Field {...props} addr="B13" kind="yesno" />
        </td>
        <td colSpan={4}>{line("drawingNote", "If YES attach draft drawing.")}</td>
      </tr>
      <Section cols={props.cols}>{line("section3", "SECTION 3: ENGINEERING REVIEW & RISK")}</Section>
      <tr>
        <td>{line("fitFormFunction", "Does this affect Fit Form or Function?")}</td>
        <td colSpan={5}>
          <Field {...props} addr="B16" kind="yesno" />
        </td>
      </tr>
      <tr>
        <td>{line("validationRequired", "Is Validation Testing required?")}</td>
        <td>
          <Field {...props} addr="B17" kind="yesno" />
        </td>
        <td colSpan={4}>
          {line("testPlan", "If YES describe test plan:")} <Field {...props} addr="C17" />
        </td>
      </tr>
      <tr>
        <td>{line("qcProcedure", "QC Procedure to Prevent Mixing Parts:")}</td>
        <td colSpan={5}>
          <Field {...props} addr="B18" kind="area" />
        </td>
      </tr>
      <tr>
        <td>{line("implementationPlan", "Planned Implementation Batch/Date:")}</td>
        <td colSpan={5}>
          <Field {...props} addr="B19" />
        </td>
      </tr>
      <Section cols={props.cols}>{line("section4", "SECTION 4: STOCK DISPOSITION (What about old parts?)")}</Section>
      <tr>
        <td />
        <td>{line("useAsIs", "Use As-Is")}</td>
        <td>{line("scrap", "Scrap")}</td>
        <td>{line("rework", "Rework")}</td>
        <td colSpan={2}>{line("notes", "Notes")}</td>
      </tr>
      {(
        [
          ["rawMaterial", "Raw Material:", 22],
          ["wip", "WIP (In Process):", 23],
          ["finishedGoods", "Finished Goods:", 24],
        ] as const
      ).map(([key, fallback, row]) => (
        <tr key={row}>
          <td>{line(key, fallback)}</td>
          <td>
            <Check {...props} addr={`B${row}`} label="" />
          </td>
          <td>
            <Check {...props} addr={`C${row}`} label="" />
          </td>
          <td>
            <Check {...props} addr={`D${row}`} label="" />
          </td>
          <td colSpan={2}>
            <Field {...props} addr={`E${row}`} />
          </td>
        </tr>
      ))}
      <Section cols={props.cols}>{line("section7", "SECTION 7: LINKS, TRAINING, AND IMPACT")}</Section>
      <tr>
        <td>{line("affectedDrawing", "Affected Drawing:")}</td>
        <td colSpan={5}>
          <Field {...props} addr="B33" />
        </td>
      </tr>
      <tr>
        <td>{line("affectedDocument", "Affected Document:")}</td>
        <td colSpan={5}>
          <Field {...props} addr="B34" />
        </td>
      </tr>
      <tr>
        <td>{line("affectedProcess", "Affected Process:")}</td>
        <td colSpan={5}>
          <Field {...props} addr="B35" />
        </td>
      </tr>
      <tr>
        <td>{line("trainingRequired", "Training Required?")}</td>
        <td>
          <Field {...props} addr="B36" kind="yesno" />
        </td>
        <td>{line("trainingReference", "Training Reference:")}</td>
        <td colSpan={3}>
          <Field {...props} addr="D36" />
        </td>
      </tr>
      <tr>
        <td>{line("customerNotice", "Customer Notification Required?")}</td>
        <td>
          <Field {...props} addr="B37" kind="yesno" />
        </td>
        <td>{line("ppapImpact", "PPAP or Validation Impact?")}</td>
        <td colSpan={3}>
          <Field {...props} addr="D37" kind="yesno" />
        </td>
      </tr>
      <Section cols={props.cols}>{line("section5", "SECTION 5: AUTHORIZATION")}</Section>
      <tr>
        <td>{line("managerSign", "DMA Engineering/Quality Manager:")}</td>
        <td colSpan={3}>
          <SignatureStamp
            value={props.managerSignature ?? ""}
            certify="I certify that I approve this engineering change request."
            disabled={(props.managerLocked ?? props.readOnly) || !props.onSign}
            variant="sheet"
            onSign={async (pin) => props.onSign?.("managerSignature", pin)}
          />
        </td>
        <td>{line("signDate", "Date:")}</td>
        <td>
          <Field {...props} addr="E27" kind="date" />
        </td>
      </tr>
      <tr>
        <td>{line("supplierSign", "Supplier Representative (If Applicable):")}</td>
        <td colSpan={3}>
          <SignatureStamp
            value={props.supplierSignature ?? ""}
            certify="I certify that I represent the supplier on this engineering change request."
            disabled={(props.supplierLocked ?? props.readOnly) || !props.onSign}
            variant="sheet"
            onSign={async (pin) => props.onSign?.("supplierRepSignature", pin)}
          />
        </td>
        <td>{line("signDate", "Date:")}</td>
        <td>
          <Field {...props} addr="E28" kind="date" />
        </td>
      </tr>
      <Section cols={props.cols}>{line("section6", "SECTION 6: VERIFICATION OF IMPLEMENTATION")}</Section>
      <tr>
        <td>{line("implemented", "Did the change occur successfully on the planned batch?")}</td>
        <td>
          <Field {...props} addr="B31" kind="yesno" />
        </td>
        <td>{line("verifiedBy", "Verified By:")}</td>
        <td>
          <Field {...props} addr="D31" />
        </td>
        <td>{line("signDate", "Date:")}</td>
        <td>
          <Field {...props} addr="F31" kind="date" />
        </td>
      </tr>
    </>
  );
}
