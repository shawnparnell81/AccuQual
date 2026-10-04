import { useMemo } from "react";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { choiceOf, type SignatureChoice } from "../../components/forms/signatureRequired";
import {
  BATCH4_SHEET_TITLE,
  batch4Fill,
  evaluateBatch4,
  showBatch4,
  type Batch4Kind,
} from "../../lib/batch4Reports";
import type { CellValue } from "../../lib/isoFormLogic";
import "../ValidationReports/validationReport.css";

interface Batch4SheetProps {
  variant: Batch4Kind;
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber?: string;
  revision?: string;
  testedSignature?: string;
  approvedSignature?: string;
  onSign?: (field: string, pin: string) => Promise<unknown>;
  signatureRequired?: Record<string, SignatureChoice>;
  onSignatureRequired?: (path: string, choice: SignatureChoice) => void;
}

function text(value: CellValue | undefined): string {
  return value === undefined || value === null || typeof value === "boolean" ? "" : String(value);
}

function parseNumber(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

function Result({ value }: { value: CellValue | undefined }) {
  const label = showBatch4(value);
  const fill = batch4Fill(label);
  return <td style={fill ? { background: fill, color: "#111", fontWeight: 700 } : undefined}>{label}</td>;
}

export function Batch4Sheet(props: Batch4SheetProps) {
  const calculated = useMemo(() => evaluateBatch4(props.variant, props.cells), [props.cells, props.variant]);
  const title = BATCH4_SHEET_TITLE[props.variant];
  const doc = props.documentNumber?.trim() ? `Doc ID: ${props.documentNumber.trim()}` : "Doc ID:";
  const shared = { ...props, calculated, title, doc };
  if (props.variant === "salt_spray") return <SaltSheet {...shared} />;
  if (props.variant === "volume_water" || props.variant === "volume_heptane") return <VolumeSheet {...shared} />;
  if (props.variant === "prototype_strut") return <PrototypeSheet {...shared} />;
  if (props.variant === "scar_request") return <ScarSheet {...shared} />;
  return <DevSheet {...shared} />;
}

type SheetProps = Batch4SheetProps & { calculated: Record<string, CellValue>; title: string; doc: string };

function Field(props: SheetProps & { addr: string; kind?: "text" | "number" | "date" | "area" | "yesno" | "pf" }) {
  const value = text(props.cells[props.addr]);
  if (props.kind === "area") {
    return <textarea aria-label={props.addr} value={value} disabled={props.readOnly} onChange={(event) => props.onChange(props.addr, event.target.value)} />;
  }
  if (props.kind === "yesno" || props.kind === "pf") {
    const options = props.kind === "yesno" ? ["", "YES", "NO"] : ["", "P", "F"];
    return (
      <select aria-label={props.addr} value={value} disabled={props.readOnly} onChange={(event) => props.onChange(props.addr, event.target.value)}>
        {options.map((option) => (
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
      disabled={props.readOnly}
      onChange={(event) => props.onChange(props.addr, props.kind === "number" ? parseNumber(event.target.value) : event.target.value)}
    />
  );
}

function Check(props: SheetProps & { addr: string; label: string }) {
  return (
    <label>
      <input type="checkbox" aria-label={props.addr} checked={props.cells[props.addr] === true} disabled={props.readOnly} onChange={(event) => props.onChange(props.addr, event.target.checked)} /> {props.label}
    </label>
  );
}

function Sign(props: { label: string; value: string; certify: string; field: string; disabled?: boolean; onSign?: (field: string, pin: string) => Promise<unknown>; span: number; requirement?: { value: SignatureChoice; onChange: (next: SignatureChoice) => void; disabled?: boolean } }) {
  return (
    <tr>
      <td>{props.label}</td>
      <td colSpan={props.span}>
        <SignatureStamp value={props.value} certify={props.certify} disabled={props.disabled || !props.onSign} variant="sheet" requirement={props.requirement} onSign={async (pin) => props.onSign?.(props.field, pin)} />
      </td>
    </tr>
  );
}

function SaltSheet(props: SheetProps) {
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid="salt-spray-sheet" aria-label={props.title}>
        <tbody>
          <tr>
            <td className="title" colSpan={7}>
              {props.title}
            </td>
          </tr>
          <tr>
            <td>{props.doc}</td>
            <td>{`Rev: ${props.revision || "A"}`}</td>
            <td colSpan={3}>Approved By:</td>
            <td colSpan={2}>
              <Field {...props} addr="E2" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={7}>
              SECTION 1: SPECIMEN DETAILS (ASTM B117:15.2 & 15.1.4 & 15.1.6)
            </td>
          </tr>
          <tr>
            <td>Test Request #:</td>
            <td>
              <Field {...props} addr="B5" />
            </td>
            <td>Project / Job:</td>
            <td colSpan={4}>
              <Field {...props} addr="D5" />
            </td>
          </tr>
          <tr>
            <td>Part Number:</td>
            <td>
              <Field {...props} addr="B6" />
            </td>
            <td>Part Description:</td>
            <td colSpan={4}>
              <Field {...props} addr="D6" />
            </td>
          </tr>
          <tr>
            <td>Material / Coating:</td>
            <td>
              <Field {...props} addr="B7" />
            </td>
            <td>Coating Thickness (microns):</td>
            <td colSpan={4}>
              <Field {...props} addr="D7" kind="number" />
            </td>
          </tr>
          <tr>
            <td>Number of Specimens:</td>
            <td>
              <Field {...props} addr="B8" kind="number" />
            </td>
            <td>Date Received:</td>
            <td colSpan={4}>
              <Field {...props} addr="D8" kind="date" />
            </td>
          </tr>
          <tr>
            <td>Method of Cleaning (Pre-Test):</td>
            <td colSpan={6}>
              <Field {...props} addr="B9" />
            </td>
          </tr>
          <tr>
            <td>Method of Support/Suspension:</td>
            <td colSpan={6}>
              <Field {...props} addr="B10" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={7}>
              SECTION 2: TEST PARAMETERS (ASTM B117:15.1)
            </td>
          </tr>
          <tr>
            <td>Salt Used:</td>
            <td colSpan={3}>
              <Check {...props} addr="B13" label="Sodium Chloride (ACS Reagent Grade)" />
            </td>
            <td colSpan={3}>
              <Check {...props} addr="C13" label="Other" /> <Field {...props} addr="D13" />
            </td>
          </tr>
          <tr>
            <td>Water Used:</td>
            <td colSpan={2}>
              <Check {...props} addr="B14" label="Distilled / Deionized (Type IV)" />
            </td>
            <td>Conductivity (&lt; 5 uS/cm):</td>
            <td colSpan={3}>
              <Field {...props} addr="D14" />
            </td>
          </tr>
          <tr>
            <td>Solution Concentration:</td>
            <td>5 +/- 1 % by mass</td>
            <td>pH of Solution:</td>
            <td colSpan={4}>
              <Field {...props} addr="D15" />
            </td>
          </tr>
          <tr>
            <td>Chamber Temperature:</td>
            <td>35 + 1.1 / - 1.7 °C</td>
            <td>Air Pressure (psi):</td>
            <td colSpan={4}>
              <Field {...props} addr="D16" />
            </td>
          </tr>
          <tr>
            <td>Exposure Period (hr):</td>
            <td>
              <Field {...props} addr="B17" kind="number" />
            </td>
            <td>Interruptions:</td>
            <td colSpan={4}>
              <Field {...props} addr="D17" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={7}>
              SECTION 3: DAILY CHAMBER LOG (Mandatory per ASTM B117:15.1.3)
            </td>
          </tr>
          <tr>
            <td className="note" colSpan={7}>
              Requirement: Temperature must be recorded. Fog collection must be 1.0-2.0 mL/hr.
            </td>
          </tr>
          <tr>
            {["Date", "Time", "Chamber Temp (°C)", "Collection Rate (mL/hr/80cm^2)", "Specific Gravity (1.025-1.040)", "pH of Collected Sol.", "Technician Initials"].map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
          {[22, 23, 24, 25, 26].map((row) => (
            <tr key={row}>
              {["A", "B", "C", "D", "E", "F", "G"].map((col) => (
                <td key={col}>
                  <Field {...props} addr={`${col}${row}`} kind={col === "A" ? "date" : col === "G" ? "text" : "number"} />
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={7}>
              SECTION 4: INSPECTION RESULTS (ASTM B117:15.1.10)
            </td>
          </tr>
          <tr>
            {["Interval", "Observation / Appearance of Corrosion", "Pictures of Test Sample", "Blistering?", "Red Rust %", "Pass/Fail", ""].map((heading) => (
              <th key={heading || "pad"}>{heading}</th>
            ))}
          </tr>
          {(
            [
              [30, "0 Hours"],
              [31, "24 Hours"],
              [32, "48 Hours"],
              [33, "72 Hours"],
              [34, "96 Hours"],
              [35, "120 Hours"],
              [36, "FINAL"],
            ] as const
          ).map(([row, label]) => (
            <tr key={row}>
              <td>{label}</td>
              <td>
                <Field {...props} addr={`B${row}`} />
              </td>
              <td>
                <Field {...props} addr={`C${row}`} />
              </td>
              <td>
                <Field {...props} addr={`D${row}`} kind="yesno" />
              </td>
              <td>
                <Field {...props} addr={`E${row}`} kind="number" />
              </td>
              <td>
                <Field {...props} addr={`F${row}`} kind="pf" />
              </td>
              <td />
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={7}>
              SECTION 5: POST-TEST TREATMENT & APPROVAL
            </td>
          </tr>
          <tr>
            <td>Method of Cleaning (Post-Test):</td>
            <td colSpan={3}>
              <Check {...props} addr="B39" label="Gently washed in warm water (<38°C) to remove salt deposits" />
            </td>
            <td colSpan={3}>
              <Check {...props} addr="D39" label="Other" /> <Field {...props} addr="E39" />
            </td>
          </tr>
          <tr>
            <td>Overall Conclusion:</td>
            <td colSpan={6}>
              <Check {...props} addr="B40" label="PASS - Meets Specifications" /> <Check {...props} addr="C40" label="FAIL - Significant Corrosion" /> <Check {...props} addr="D40" label="ABORTED" />
            </td>
          </tr>
          <tr>
            <td>Tested By:</td>
            <td>
              <Field {...props} addr="B41" />
            </td>
            <td>Date:</td>
            <td colSpan={4}>
              <Field {...props} addr="F41" kind="date" />
            </td>
          </tr>
          <Sign label="Signature:" value={props.testedSignature ?? ""} certify="I certify that I performed this salt spray test and the record is accurate." field="testedSignature" disabled={props.readOnly} onSign={props.onSign} span={6} requirement={props.signatureRequired ? { value: choiceOf({ signatureRequired: props.signatureRequired }, "testedSignature"), disabled: props.readOnly || !props.onSignatureRequired, onChange: (next) => props.onSignatureRequired?.("testedSignature", next) } : undefined} />
          <tr>
            <td>Approved By:</td>
            <td>
              <Field {...props} addr="B42" />
            </td>
            <td>Date:</td>
            <td colSpan={4}>
              <Field {...props} addr="F42" kind="date" />
            </td>
          </tr>
          <Sign label="Signature:" value={props.approvedSignature ?? ""} certify="I certify that I approve this salt spray test report." field="approvedSignature" disabled={props.readOnly} onSign={props.onSign} span={6} requirement={props.signatureRequired ? { value: choiceOf({ signatureRequired: props.signatureRequired }, "approvedSignature"), disabled: props.readOnly || !props.onSignatureRequired, onChange: (next) => props.onSignatureRequired?.("approvedSignature", next) } : undefined} />
        </tbody>
      </table>
    </div>
  );
}

const REFERENCE = [
  ["Borosilicate glass (Type I, Class A)", "0.000010"],
  ["Borosilicate glass (Type I, Class B)", "0.000015"],
  ["Soda-lime glass", "0.000025"],
  ["Fused silica (quartz)", "0.0000016"],
  ["Stainless steel", "0.0000477"],
  ["Aluminum", "0.0000690"],
];

function VolumeSheet(props: SheetProps) {
  const heptane = props.variant === "volume_heptane";
  const fluid = heptane ? "n-Heptane" : "Water";
  const lines = ["First Fill Line", "Second Fill Line", "Third Fill Line"];
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid={heptane ? "volume-heptane-sheet" : "volume-water-sheet"} aria-label={`${props.title} ${fluid}`}>
        <tbody>
          <tr>
            <td className="title" colSpan={3}>
              {props.title}
            </td>
          </tr>
          <tr>
            <td>{props.doc}</td>
            <td colSpan={2}>{heptane ? "Fluid: n-Heptane" : "Fluid: Water"}</td>
          </tr>
          <tr>
            <td className="section" colSpan={3}>
              1. USER INPUTS
            </td>
          </tr>
          {(
            [
              ["B4", heptane ? "Apparent Mass (IL - IE)" : "Apparent Mass (IL - IE)", "g"],
              ["B5", heptane ? "n-Heptane Temperature (t)" : "Water Temperature (t)", "°C"],
              ["B6", "Barometric Pressure (P)", "mmHg"],
              ["B7", "Relative Humidity (U)", "%"],
              ["B8", "Calibrated Mass of Standard (Ms)", "g"],
              ["B9", "Balance Indication of Standard (IM)", "g"],
              ["B10", "Density of Mass Standards (ρs)", "g/cm³"],
              ["B11", "Coefficient of Expansion (γ)", "cm³/°C"],
            ] as const
          ).map(([addr, label, unit]) => (
            <tr key={addr}>
              <td>{label}</td>
              <td>
                <Field {...props} addr={addr} kind="number" />
              </td>
              <td>{unit}</td>
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={3}>
              2. INTERMEDIATE CALCULATIONS (ASTM E542 Equations)
            </td>
          </tr>
          {(
            [
              ["B14", "Vapor Pressure Factor (es)"],
              ["B15", "Air Density (ρa)"],
              ["B16", heptane ? "Air-Free n-Heptane Density" : "Air-Free Water Density"],
              ["B17", "Air-Saturation Correction"],
              ["B18", heptane ? "Saturated n-Heptane Density (ρh)" : "Saturated Water Density (ρw)"],
              ["B19", "Balance Correction Factor (Ms/IM)"],
              ["B20", "Buoyancy Multiplier (Z-factor)"],
            ] as const
          ).map(([addr, label]) => (
            <tr key={addr}>
              <td>{label}</td>
              <td>{showBatch4(props.calculated[addr])}</td>
              <td>Auto-calculated</td>
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={3}>
              3. FINAL VOLUMES
            </td>
          </tr>
          <tr>
            <td>Actual Volume at Temperature t</td>
            <td>{showBatch4(props.calculated.B23)}</td>
            <td>mL</td>
          </tr>
          <tr>
            <td>Standardized Volume (V20) at 20°C</td>
            <td>{showBatch4(props.calculated.B24)}</td>
            <td>mL</td>
          </tr>
          <tr>
            <td className="section" colSpan={3}>
              Reference Data — Coefficient of Cubical Expansion (γ)
            </td>
          </tr>
          {REFERENCE.map(([material, gamma]) => (
            <tr key={material}>
              <td colSpan={2}>{material}</td>
              <td>{gamma}</td>
            </tr>
          ))}
          {lines.map((name, index) => (
            <FillLine key={name} {...props} line={index + 1} name={name} heptane={heptane} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FillLine(props: SheetProps & { line: number; name: string; heptane: boolean }) {
  const prefix = String(props.line);
  const input = (suffix: string, label: string) => (
    <tr>
      <td>{label}</td>
      <td>
        <Field {...props} addr={`${prefix}${suffix}`} kind="number" />
      </td>
      <td />
    </tr>
  );
  return (
    <>
      <tr>
        <td className="section" colSpan={3}>
          {props.name}
        </td>
      </tr>
      {input("B2", props.heptane ? "second filled Instrument Weight (I_L2) (g)" : "Empty Instrument Weight (I_E) (g)")}
      {input("B3", props.heptane ? "first Filled Instrument Weight (I_L1) (g)" : "Filled Instrument Weight (I_L) (g)")}
      {input("B4", "Filled to Line (mL)")}
      <tr>
        <td>Apparent Mass (I_L - I_E) (g)</td>
        <td>{showBatch4(props.calculated[`${prefix}B5`])}</td>
        <td />
      </tr>
      {input("B6", props.heptane ? "n-heptane Temperature (t) (C)" : "Water Temperature (t) (C)")}
      {input("B7", "Barometric Pressure (P) (mmHg)")}
      {input("B8", "Relative Humidity (U) (%)")}
      {input("B9", "Calibrated Mass of Standard (M_s) (g)")}
      {input("B10", "Balance Indication of Standard (I_M) (g)")}
      <tr>
        <td>Actual Volume at Temperature t (mL)</td>
        <td>{showBatch4(props.calculated[`${prefix}B12`])}</td>
        <td />
      </tr>
      <tr>
        <td>Standardized Volume (V20) at 20C (mL)</td>
        <td>{showBatch4(props.calculated[`${prefix}B13`])}</td>
        <td />
      </tr>
      <tr>
        <td>Pass / Fail</td>
        <Result value={props.calculated[`${prefix}B14`]} />
        <td />
      </tr>
    </>
  );
}

function PrototypeSheet(props: SheetProps) {
  const visual = [
    [12, "Packaging", "No damage during transit"],
    [13, "Paint / Finish", "No scratches; Uniform coating"],
    [14, "Welds (Brackets)", "Clean penetration; No porosity"],
    [15, "Labels / Marking", "Part number legible; Correct location"],
  ] as const;
  const ride = [
    [20, "Wire Diameter (mm)"],
    [21, "Free Height (mm)"],
    [22, "Spring Rate (N/mm)"],
    [23, "Installed Height (mm)"],
    [24, "Isolator / Seat Check"],
  ] as const;
  const damp = [
    [29, "1.00 m/s (Low Speed)"],
    [30, "0.60 m/s (Low Speed)"],
    [31, "0.30 m/s (Mid Speed)"],
    [32, "0.10 m/s (Mid Speed)"],
    [33, "0.05 m/s (High Speed)"],
    [34, "0.05 m/s (High Speed)"],
    [35, "0.10 m/s (Mid Speed)"],
    [36, "0.30 m/s (Mid Speed)"],
    [37, "0.60 m/s (Low Speed)"],
    [38, "1.00 m/s (Low Speed)"],
    [39, "Gas Pressure Check"],
  ] as const;
  const bump = [
    [43, "Bump Stop Material"],
    [44, "Bump Stop Length (mm)"],
    [45, "Bump Stop OD (mm)"],
    [46, "Piston Rod Size"],
    [47, "Dust Cover Fitment"],
  ] as const;
  const fit = [
    [51, "Top Mount Stud Spacing"],
    [52, "Lower Clevis Width"],
    [53, "Sway Bar Link Position"],
  ] as const;
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid="prototype-strut-sheet" aria-label={props.title}>
        <tbody>
          <tr>
            <td className="title" colSpan={5}>
              {props.title}
            </td>
          </tr>
          <tr>
            <td>{props.doc}</td>
            <td>{`Rev: ${props.revision || "A"}`}</td>
            <td>Approved By:</td>
            <td colSpan={2}>
              <Field {...props} addr="E2" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={5}>
              SECTION 1: SUBMISSION TYPE (Critical)
            </td>
          </tr>
          <tr>
            <td>What are we evaluating?</td>
            <td colSpan={2}>
              <Check {...props} addr="B5" label="PHYSICAL PROTOTYPES (Received from Factory)" />
            </td>
            <td colSpan={2}>
              <Check {...props} addr="D5" label="DIGITAL DATA (CAE/CAD Analysis Only)" />
            </td>
          </tr>
          <tr>
            <td>Date Received:</td>
            <td>
              <Field {...props} addr="B6" kind="date" />
            </td>
            <td>Sample Quantity:</td>
            <td colSpan={2}>
              <Field {...props} addr="D6" kind="number" />
            </td>
          </tr>
          <tr>
            <td>Supplier / Factory:</td>
            <td>
              <Field {...props} addr="B7" />
            </td>
            <td>Submission Level:</td>
            <td colSpan={2}>
              <Field {...props} addr="D7" />
            </td>
          </tr>
          <tr>
            <td>Part Number:</td>
            <td>
              <Field {...props} addr="B8" />
            </td>
            <td>Project Code:</td>
            <td colSpan={2}>
              <Field {...props} addr="D8" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={5}>
              SECTION 2: GENERAL INSPECTION (Visual)
            </td>
          </tr>
          <tr>
            {["Inspection Item", "Requirement", "Observation / Notes", "Pass/Fail", ""].map((heading) => (
              <th key={heading || "x"}>{heading}</th>
            ))}
          </tr>
          {visual.map(([row, item, requirement]) => (
            <tr key={row}>
              <td>{item}</td>
              <td>{requirement}</td>
              <td>
                <Field {...props} addr={`C${row}`} />
              </td>
              <td>
                <Field {...props} addr={`D${row}`} kind="pf" />
              </td>
              <td />
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={5}>
              SECTION 3: RIDE HEIGHT & COIL SPRING
            </td>
          </tr>
          <tr>
            <td>Equipment Used:</td>
            <td>
              <Field {...props} addr="B18" />
            </td>
            <td>Calibration Due:</td>
            <td colSpan={2}>
              <Field {...props} addr="D18" kind="date" />
            </td>
          </tr>
          <tr>
            {["Parameter", "Specification (Nominal +/- Tol)", "Actual Measurement (Left)", "Actual Measurement (Right)", "Status"].map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
          {ride.map(([row, label]) => (
            <tr key={row}>
              <td>{label}</td>
              <td>
                <Field {...props} addr={`B${row}`} />
              </td>
              <td>
                <Field {...props} addr={`C${row}`} />
              </td>
              <td>
                <Field {...props} addr={`D${row}`} />
              </td>
              <td>
                <Field {...props} addr={`E${row}`} kind="pf" />
              </td>
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={5}>
              SECTION 4: DAMPING (Shock Absorber Performance)
            </td>
          </tr>
          <tr>
            <td>Equipment Used:</td>
            <td>
              <Field {...props} addr="B27" />
            </td>
            <td>Calibration Due:</td>
            <td colSpan={2}>
              <Field {...props} addr="D27" kind="date" />
            </td>
          </tr>
          <tr>
            {["Test Velocity (m/s) (Compression, Rebound)", "Spec Force (N)", "Actual (Unit 1)", "Actual (Unit 2)", "Status"].map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
          {damp.map(([row, label]) => (
            <tr key={row}>
              <td>{label}</td>
              <td>
                <Field {...props} addr={`B${row}`} />
              </td>
              <td>
                <Field {...props} addr={`C${row}`} />
              </td>
              <td>
                <Field {...props} addr={`D${row}`} />
              </td>
              <td>
                <Field {...props} addr={`E${row}`} kind="pf" />
              </td>
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={5}>
              SECTION 5: BUMP STOP & DUST COVER
            </td>
          </tr>
          {bump.map(([row, label]) => (
            <tr key={row}>
              <td>{label}</td>
              <td>
                <Field {...props} addr={`B${row}`} />
              </td>
              <td>
                <Field {...props} addr={`C${row}`} />
              </td>
              <td>
                <Field {...props} addr={`D${row}`} kind="pf" />
              </td>
              <td>
                <Field {...props} addr={`E${row}`} />
              </td>
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={5}>
              SECTION 6: FITMENT CHECK (Interface Dimensions)
            </td>
          </tr>
          {fit.map(([row, label]) => (
            <tr key={row}>
              <td>{label}</td>
              <td>
                <Field {...props} addr={`B${row}`} />
              </td>
              <td>
                <Field {...props} addr={`C${row}`} />
              </td>
              <td>
                <Field {...props} addr={`D${row}`} kind="pf" />
              </td>
              <td>
                <Field {...props} addr={`E${row}`} />
              </td>
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={5}>
              SECTION 7: CONCLUSION & APPROVAL
            </td>
          </tr>
          <tr>
            <td>Overall Disposition:</td>
            <td colSpan={4}>
              <Check {...props} addr="B56" label="PASS - APPROVED FOR USE" /> <Check {...props} addr="D56" label="FAIL - REJECT / REWORK" /> <Check {...props} addr="E56" label="CONDITIONAL APPROVAL (See Notes)" />
            </td>
          </tr>
          <tr>
            <td>Engineering Comments / Deviations:</td>
            <td colSpan={4}>
              <Field {...props} addr="B57" kind="area" />
            </td>
          </tr>
          <tr>
            <td>Tested By:</td>
            <td>
              <Field {...props} addr="B58" />
            </td>
            <td>Date:</td>
            <td colSpan={2}>
              <Field {...props} addr="D58" kind="date" />
            </td>
          </tr>
          <tr>
            <td>Date:</td>
            <td colSpan={4}>
              <Field {...props} addr="D59" kind="date" />
            </td>
          </tr>
          <Sign label="Engineering/Quality Manager:" value={props.approvedSignature ?? ""} certify="I certify that I approve this prototype evaluation." field="engineeringSignoffSignature" disabled={props.readOnly} onSign={props.onSign} span={4} />
        </tbody>
      </table>
    </div>
  );
}

function ScarSheet(props: SheetProps) {
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid="scar-request-sheet" aria-label={props.title}>
        <tbody>
          <tr>
            <td className="title" colSpan={4}>
              {props.title}
            </td>
          </tr>
          <tr>
            <td>{props.doc}</td>
            <td>{`Rev: ${props.revision || "A"}`}</td>
            <td>Authorized By:</td>
            <td>
              <Field {...props} addr="E2" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={4}>
              SECTION 1: REQUEST DETAILS (Filled by Engineering/Quality Manager)
            </td>
          </tr>
          <tr>
            <td>SCAR Number:</td>
            <td>
              <Field {...props} addr="B5" />
            </td>
            <td>Issue Date:</td>
            <td>
              <Field {...props} addr="D5" kind="date" />
            </td>
          </tr>
          <tr>
            <td>To Supplier:</td>
            <td>
              <Field {...props} addr="B6" />
            </td>
            <td>Response Due Date:</td>
            <td>
              <Field {...props} addr="D6" kind="date" />
            </td>
          </tr>
          <tr>
            <td>From:</td>
            <td>
              <Field {...props} addr="B7" />
            </td>
            <td>Related NCR Number:</td>
            <td>
              <Field {...props} addr="D7" />
            </td>
          </tr>
          <tr>
            <td>Part Number:</td>
            <td>
              <Field {...props} addr="B8" />
            </td>
            <td>Part Name:</td>
            <td>
              <Field {...props} addr="D8" />
            </td>
          </tr>
          <tr>
            <td>Problem Description:</td>
            <td colSpan={3}>
              <Field {...props} addr="B9" kind="area" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={4}>
              SECTION 2: ROOT CAUSE ANALYSIS (Filled by Supplier)
            </td>
          </tr>
          <tr>
            <td className="note" colSpan={4}>
              WE REQUIRE A TRUE ROOT CAUSE. &apos;OPERATOR ERROR&apos; IS NOT ACCEPTABLE.
            </td>
          </tr>
          {(
            [
              [14, "1. Why did the defect happen?"],
              [15, "2. Why did that happen?"],
              [16, "3. Why did that happen?"],
              [17, "4. Why did that happen?"],
              [18, "5. Why did that happen? (Root Cause)"],
            ] as const
          ).map(([row, label]) => (
            <tr key={row}>
              <td>{label}</td>
              <td colSpan={3}>
                <Field {...props} addr={`B${row}`} />
              </td>
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={4}>
              SECTION 3: CORRECTIVE ACTION PLAN (Filled by Supplier)
            </td>
          </tr>
          <tr>
            <td>Immediate Containment:</td>
            <td colSpan={3}>
              <Field {...props} addr="B21" kind="area" />
            </td>
          </tr>
          <tr>
            <td>Permanent Corrective Action:</td>
            <td colSpan={3}>
              <Field {...props} addr="B22" kind="area" />
            </td>
          </tr>
          <tr>
            <td>Implementation Date:</td>
            <td>
              <Field {...props} addr="B23" kind="date" />
            </td>
            <td>Responsible Person:</td>
            <td>
              <Field {...props} addr="D23" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={4}>
              SECTION 4: VERIFICATION (Filled by Engineering/Quality Manager)
            </td>
          </tr>
          <tr>
            <td>Did the supplier&apos;s fix work?</td>
            <td>
              <Field {...props} addr="B26" kind="yesno" />
            </td>
            <td>Date Verified:</td>
            <td>
              <Field {...props} addr="D26" kind="date" />
            </td>
          </tr>
          <tr>
            <td>Verification Method:</td>
            <td colSpan={3}>
              <Field {...props} addr="B27" />
            </td>
          </tr>
          <tr>
            <td>SCAR Status:</td>
            <td>
              <select aria-label="B28" value={text(props.cells.B28)} disabled={props.readOnly} onChange={(event) => props.onChange("B28", event.target.value)}>
                {["", "OPEN", "CLOSED"].map((option) => (
                  <option key={option || "blank"} value={option}>
                    {option || "—"}
                  </option>
                ))}
              </select>
            </td>
            <td colSpan={2} />
          </tr>
          <Sign label="Manager Signature:" value={props.approvedSignature ?? ""} certify="I certify that I verified this supplier corrective action request." field="managerSignature" disabled={props.readOnly} onSign={props.onSign} span={3} />
        </tbody>
      </table>
    </div>
  );
}

function DevSheet(props: SheetProps) {
  const kind = props.variant;
  const calc = props.calculated;
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid={`${kind}-sheet`} aria-label={props.title}>
        <tbody>
          <tr>
            <td className="title" colSpan={kind === "dev_csa" ? 6 : 4}>
              {props.title}
            </td>
          </tr>
          <tr>
            <td>{props.doc}</td>
            <td>{`Rev: ${props.revision || (kind === "dev_gas_lift" ? "B" : "A")}`}</td>
            <td>Approved By:</td>
            <td colSpan={kind === "dev_csa" ? 3 : 1}>
              <Field {...props} addr={kind === "dev_csa" ? "E2" : kind === "dev_gas_lift" ? "B3" : "D2"} />
            </td>
          </tr>
          <tr>
            <td className="note" colSpan={kind === "dev_csa" ? 6 : 4}>
              {kind === "dev_csa"
                ? "Purpose: To record baseline benchmarking data on used OE and competitor CSAs prior to factory prototype development."
                : kind === "dev_fuel_pump"
                  ? "Purpose: To record baseline benchmarking data on OE and competitor Fuel Pumps prior to prototype development."
                  : kind === "dev_gas_lift"
                    ? "Purpose: To record baseline benchmarking data on OE and competitor Gas Lift Supports prior to prototype development."
                    : kind === "dev_coil"
                      ? "Purpose: To record baseline data on OE and competitor Coil Springs prior to prototype development."
                      : "Purpose: To record baseline benchmarking data on OE and competitor Air Springs prior to prototype development."}
            </td>
          </tr>
          {kind === "dev_csa" && <CsaBody {...props} calc={calc} />}
          {kind === "dev_fuel_pump" && <FuelBody {...props} calc={calc} />}
          {kind === "dev_gas_lift" && <GasBody {...props} calc={calc} />}
          {kind === "dev_coil" && <CoilBody {...props} calc={calc} />}
          {kind === "dev_air_spring" && <AirBody {...props} calc={calc} />}
        </tbody>
      </table>
    </div>
  );
}

function CsaBody(props: SheetProps & { calc: Record<string, CellValue> }) {
  return (
    <>
      <tr>
        <td className="section" colSpan={6}>
          1.0 PROJECT & VEHICLE INFORMATION
        </td>
      </tr>
      <Pair {...props} left="Part Number:" leftAddr="B6" right="Application:" rightAddr="D6" />
      <Pair {...props} left="Brand Tested (OE/Competitor):" leftAddr="B7" right="Condition (New/Used):" rightAddr="D7" />
      <Pair {...props} left="Curb Weight (lb):" leftAddr="B8" right="Weight Distribution (%):" rightAddr="D8" numeric />
      <tr>
        <td>Motion Ratio:</td>
        <td colSpan={5}>
          <Field {...props} addr="B9" kind="number" />
        </td>
      </tr>
      <Pair {...props} left="Tested By:" leftAddr="B10" right="Date:" rightAddr="D10" date />
      <tr>
        <td className="section" colSpan={6}>
          2.0 UPPER MOUNT, BEARING & BUSHING
        </td>
      </tr>
      {["Bearing Turning Test Under Pressure:", "Does spring wind up with bearing?:", "Strut Mount Orientation:", "Bushing Travel Length (mm):", "Bushing Hardness Value (Shore A):"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${14 + index}`} />
          </td>
          <td colSpan={4}>
            <Field {...props} addr={`C${14 + index}`} />
          </td>
        </tr>
      ))}
      <tr>
        <td className="section" colSpan={6}>
          3.0 SPRING SPECIFICATIONS & RIDE HEIGHT
        </td>
      </tr>
      {(
        [
          [22, "Total CSA Length Unloaded (mm):"],
          [23, "Total Spring Length (mm):"],
          [24, "Wire Diameter (mm):"],
          [25, "Number of Coils:"],
          [26, "Top Inner Diameter (mm):"],
          [27, "Outer Diameter (mm):"],
          [28, "Bottom Inner Diameter (mm):"],
          [33, "Spring Rate - Complete CSA (N/mm):"],
          [34, "Overall Height at Ride Force (mm):"],
        ] as const
      ).map(([row, label]) => (
        <tr key={row}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${row}`} kind="number" />
          </td>
          <td colSpan={4}>
            <Field {...props} addr={`C${row}`} />
          </td>
        </tr>
      ))}
      <tr>
        <td>Description of Spring:</td>
        <td colSpan={5}>
          <Field {...props} addr="B29" />
        </td>
      </tr>
      <Calc label="Target Force (N):" value={props.calc.B30} span={5} />
      <Calc label="Natural Frequency (Hz):" value={props.calc.B31} span={5} />
      <Calc label="Stress (Mpa):" value={props.calc.B32} span={5} />
      <tr>
        <td className="section" colSpan={6}>
          4.0 DAMPER & STROKE SPECIFICATIONS
        </td>
      </tr>
      <tr>
        <td>Stroke Length (mm):</td>
        <td>
          <Field {...props} addr="B38" kind="number" />
        </td>
        <td colSpan={4}>
          <Field {...props} addr="C38" />
        </td>
      </tr>
      <Calc label="Percent Displaced (%):" value={props.calc.B39} span={5} />
      <tr>
        <td>Bump Stop Length (mm):</td>
        <td>
          <Field {...props} addr="B40" kind="number" />
        </td>
        <td colSpan={4}>
          <Field {...props} addr="C40" />
        </td>
      </tr>
      <Calc label="Bump Stop Percent of Stroke (%):" value={props.calc.B41} span={5} />
      <tr>
        <td className="section" colSpan={6}>
          5.0 DAMPING FORCE TEST (DYNAMOMETER)
        </td>
      </tr>
      <tr>
        <td>Velocity (m/s)</td>
        {["0.05", "0.1", "0.3", "0.6", "1"].map((speed) => (
          <td key={speed}>{speed}</td>
        ))}
      </tr>
      <tr>
        <td>Compression Force (N)</td>
        {["B", "C", "D", "E", "F"].map((col) => (
          <td key={col}>
            <Field {...props} addr={`${col}45`} kind="number" />
          </td>
        ))}
      </tr>
      <tr>
        <td>Rebound Force (N)</td>
        {["B", "C", "D", "E", "F"].map((col) => (
          <td key={col}>
            <Field {...props} addr={`${col}46`} kind="number" />
          </td>
        ))}
      </tr>
      <Calc label="Percent Damped (%) at 1 m/s:" value={props.calc.B47} span={5} />
      <tr>
        <td className="section" colSpan={6}>
          6.0 FASTENERS & THREADS
        </td>
      </tr>
      <tr>
        {["Location", "Thread Size", "Nut Style", "Description of Location", "", ""].map((heading, index) => (
          <th key={heading + index}>{heading}</th>
        ))}
      </tr>
      {[51, 52, 53].map((row) => (
        <tr key={row}>
          <td>{`Location ${row - 50}:`}</td>
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
      <tr>
        <td className="section" colSpan={6}>
          7.0 COMPONENT WEIGHTS
        </td>
      </tr>
      {["Strut Mount:", "Bearing:", "Body of Strut:", "Coil Spring:", "Complete CSA:"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${57 + index}`} kind="number" />
          </td>
          <td colSpan={4}>
            <Field {...props} addr={`C${57 + index}`} />
          </td>
        </tr>
      ))}
      <tr>
        <td className="section" colSpan={6}>
          8.0 ENGINEERING RESEARCH & CONSOLIDATION
        </td>
      </tr>
      <tr>
        <td>Research Application:</td>
        <td colSpan={5}>Are there more than one style available for this application? If yes, can they be consolidated?</td>
      </tr>
      <tr>
        <td colSpan={6}>
          <Field {...props} addr="B65" kind="area" />
        </td>
      </tr>
      <tr>
        <td>Common Issues:</td>
        <td colSpan={5}>Are there common issues with SENSEN or the OE that can be solved easily on this strut? List all improvements.</td>
      </tr>
      <tr>
        <td colSpan={6}>
          <Field {...props} addr="B67" kind="area" />
        </td>
      </tr>
      <tr>
        <td>Notes:</td>
        <td colSpan={5}>
          <Field {...props} addr="B68" kind="area" />
        </td>
      </tr>
      <tr>
        <td>DMA Improvements:</td>
        <td colSpan={5}>
          <Field {...props} addr="B69" kind="area" />
        </td>
      </tr>
    </>
  );
}

function Pair(props: SheetProps & { left: string; leftAddr: string; right: string; rightAddr: string; numeric?: boolean; date?: boolean }) {
  return (
    <tr>
      <td>{props.left}</td>
      <td>
        <Field {...props} addr={props.leftAddr} kind={props.numeric ? "number" : "text"} />
      </td>
      <td>{props.right}</td>
      <td colSpan={props.variant === "dev_csa" ? 3 : 1}>
        <Field {...props} addr={props.rightAddr} kind={props.date ? "date" : props.numeric ? "number" : "text"} />
      </td>
    </tr>
  );
}

function Calc({ label, value, span }: { label: string; value: CellValue | undefined; span: number }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{showBatch4(value)}</td>
      <td colSpan={span} />
    </tr>
  );
}

function FuelBody(props: SheetProps & { calc: Record<string, CellValue> }) {
  return (
    <>
      <tr>
        <td className="section" colSpan={4}>
          1.0 PROJECT & VEHICLE INFORMATION
        </td>
      </tr>
      <Pair {...props} left="Sample Part Number:" leftAddr="B6" right="Vehicle Application:" rightAddr="D6" />
      <Pair {...props} left="Brand Tested (OE/Competitor):" leftAddr="B7" right="Condition (New/Used):" rightAddr="D7" />
      <Pair {...props} left="Tested By:" leftAddr="B8" right="Date:" rightAddr="D8" date />
      <tr>
        <td className="section" colSpan={4}>
          2.0 PHYSICAL SPECIFICATIONS
        </td>
      </tr>
      {["Weight (lbs):", "Box Size (L x W x H) (mm):", "Overall Length of Fuel Pump Assembly (mm):", "Accessories Description:"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${12 + index}`} />
          </td>
          <td colSpan={2}>
            <Field {...props} addr={`C${12 + index}`} />
          </td>
        </tr>
      ))}
      <tr>
        <td className="section" colSpan={4}>
          3.0 ELECTRICAL & FUEL LEVEL SENSOR
        </td>
      </tr>
      <tr>
        {["Sensor State", "Height relative to bottom (mm)", "Resistance (Ohms)", "Notes"].map((heading) => (
          <th key={heading}>{heading}</th>
        ))}
      </tr>
      {["Empty Position:", "Full Position:"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${19 + index}`} kind="number" />
          </td>
          <td>
            <Field {...props} addr={`C${19 + index}`} kind="number" />
          </td>
          <td>
            <Field {...props} addr={`D${19 + index}`} />
          </td>
        </tr>
      ))}
      <tr>
        <td>Pinout Diagram:</td>
        <td colSpan={3}>
          <Field {...props} addr="B21" />
        </td>
      </tr>
      <tr>
        <td className="section" colSpan={4}>
          4.0 FLOW & PRESSURE PERFORMANCE
        </td>
      </tr>
      <tr>
        <td>DC Voltage for Test</td>
        <td colSpan={3}>
          <Field {...props} addr="B24" />
        </td>
      </tr>
      <tr>
        <td>Flow at 0 kPa (Hz):</td>
        <td>
          <Field {...props} addr="B26" kind="number" />
        </td>
        <td>Flow (L/H): {showBatch4(props.calc.C26)}</td>
        <td>
          <Field {...props} addr="D26" />
        </td>
      </tr>
      <tr>
        <td>Test Pressure (kPa):</td>
        <td colSpan={3}>
          <Field {...props} addr="B27" kind="number" />
        </td>
      </tr>
      <tr>
        <td>Flow at Test Pressure (Hz):</td>
        <td>
          <Field {...props} addr="B28" kind="number" />
        </td>
        <td>Flow (L/H): {showBatch4(props.calc.C28)}</td>
        <td>
          <Field {...props} addr="D28" />
        </td>
      </tr>
      <tr>
        <td>Current at Test Pressure (Amps):</td>
        <td colSpan={3}>
          <Field {...props} addr="B29" kind="number" />
        </td>
      </tr>
      <tr>
        <td>Shutoff Pressure (kPa):</td>
        <td colSpan={3}>
          <Field {...props} addr="B30" kind="number" />
        </td>
      </tr>
      <tr>
        <td className="section" colSpan={4}>
          5.0 VISUAL & ENGINEERING RESEARCH
        </td>
      </tr>
      {["Visual Difference to OE:", "Notes:", "Major Issues with OE:", "DMA Solutions:"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td colSpan={3}>
            <Field {...props} addr={`B${33 + index}`} kind="area" />
          </td>
        </tr>
      ))}
      <tr>
        <td>Application Research:</td>
        <td colSpan={3}>Are there more than one style for this application? If yes, can they be consolidated?</td>
      </tr>
      <tr>
        <td>Notes:</td>
        <td colSpan={3}>
          <Field {...props} addr="B39" kind="area" />
        </td>
      </tr>
    </>
  );
}

function GasBody(props: SheetProps & { calc: Record<string, CellValue> }) {
  return (
    <>
      <tr>
        <td className="section" colSpan={4}>
          1.0 PROJECT & VEHICLE INFORMATION
        </td>
      </tr>
      <Pair {...props} left="Sample Part Number:" leftAddr="B7" right="Application:" rightAddr="D7" />
      <Pair {...props} left="Part Type (Lift Support/Damper):" leftAddr="B8" right="Position:" rightAddr="D8" />
      <Pair {...props} left="Tested By:" leftAddr="B9" right="Date:" rightAddr="D9" date />
      <tr>
        <td className="section" colSpan={4}>
          2.0 PHYSICAL DIMENSIONS & CONNECTORS
        </td>
      </tr>
      {["Extended Length (mm):", "Extended Length Picture (mm):", "Exposed Rod Stroke (mm):", "Rod Size (mm):", "Tube Diameter (mm):", "Shaft Connector Style:", "Body Connector Style:"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${13 + index}`} />
          </td>
          <td colSpan={2}>
            <Field {...props} addr={`C${13 + index}`} />
          </td>
        </tr>
      ))}
      <tr>
        <td className="section" colSpan={4}>
          3.0 FEATURES & HARDWARE
        </td>
      </tr>
      {["Weight (lbs):", "Groove Tube (Y/N):", "Hardware Included (Y/N):"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${23 + index}`} />
          </td>
          <td colSpan={2}>
            <Field {...props} addr={`C${23 + index}`} />
          </td>
        </tr>
      ))}
      <tr>
        <td className="section" colSpan={4}>
          4.0 PERFORMANCE & FORCE TESTING
        </td>
      </tr>
      <tr>
        <td className="note" colSpan={4}>
          *** F1-F4 must be measured statically***
        </td>
      </tr>
      <tr>
        <td>OEM Force (N):</td>
        <td>
          <Field {...props} addr="B30" kind="number" />
        </td>
        <td colSpan={2}>
          <Field {...props} addr="C30" />
        </td>
      </tr>
      {(
        [
          [31, "F3"],
          [32, "F4"],
          [33, "F2"],
          [34, "F1"],
        ] as const
      ).map(([row, label]) => (
        <tr key={row}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${row}`} kind="number" />
          </td>
          <td colSpan={2}>
            <Field {...props} addr={`C${row}`} />
          </td>
        </tr>
      ))}
      <Calc label="Fa Force (N):" value={props.calc.B35} span={2} />
      <Calc label="Fb Force (N):" value={props.calc.B36} span={2} />
      <tr>
        <td>Force Diagram:</td>
        <td className="note" colSpan={3}>
          The Graphs sheet has an empty scatter chart and no plotted points.
        </td>
      </tr>
      <tr>
        <td className="section" colSpan={4}>
          5.0 ENGINEERING NOTES
        </td>
      </tr>
      <tr>
        <td>Notes:</td>
        <td colSpan={3}>
          <Field {...props} addr="B40" kind="area" />
        </td>
      </tr>
    </>
  );
}

function CoilBody(props: SheetProps & { calc: Record<string, CellValue> }) {
  return (
    <>
      <tr>
        <td className="section" colSpan={4}>
          1.0 PROJECT & VEHICLE INFORMATION
        </td>
      </tr>
      <Pair {...props} left="Sample Part Number:" leftAddr="B6" right="Application:" rightAddr="D6" />
      <Pair {...props} left="Brand Tested (OE/Competitor):" leftAddr="B7" right="Condition (New/Used):" rightAddr="D7" />
      <Pair {...props} left="Car Weight (lbs):" leftAddr="B8" right="Weight Distribution (%):" rightAddr="D8" numeric />
      <tr>
        <td>Motion Ratio:</td>
        <td colSpan={3}>
          <Field {...props} addr="B9" kind="number" />
        </td>
      </tr>
      <Pair {...props} left="Tested By:" leftAddr="B10" right="Date:" rightAddr="D10" date />
      <tr>
        <td className="section" colSpan={4}>
          2.0 PHYSICAL DIMENSIONS & CONSTRUCTION
        </td>
      </tr>
      {["Top Construction Style:", "Top Inside Diameter (mm)", "Bottom Construction Style:", "Bottom Inside Diameter (mm)", "Number of Coils:", "Wire Size of Spring (mm):", "OD of Spring (mm):", "Overall Free Length (mm):"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${14 + index}`} />
          </td>
          <td colSpan={2}>
            <Field {...props} addr={`C${14 + index}`} />
          </td>
        </tr>
      ))}
      <tr>
        <td className="section" colSpan={4}>
          3.0 PERFORMANCE & ENGINEERING SPECIFICATIONS
        </td>
      </tr>
      <tr>
        <td>Jigs Used for Testing:</td>
        <td colSpan={3}>
          <Field {...props} addr="B25" />
        </td>
      </tr>
      <tr>
        <td>Spring Rate 1 (N/mm):</td>
        <td>
          <Field {...props} addr="B26" kind="number" />
        </td>
        <td colSpan={2}>
          <Field {...props} addr="C26" />
        </td>
      </tr>
      <tr>
        <td>Spring Rate 2 (N/mm):</td>
        <td>
          <Field {...props} addr="B27" kind="number" />
        </td>
        <td colSpan={2}>If progressive spring</td>
      </tr>
      <tr>
        <td>Ride Height Total Length (mm):</td>
        <td>
          <Field {...props} addr="B28" kind="number" />
        </td>
        <td colSpan={2}>
          <Field {...props} addr="C28" />
        </td>
      </tr>
      <Calc label="Ride Height Force (N):" value={props.calc.B29} span={2} />
      <Calc label="Natural Frequency (Hz):" value={props.calc.B30} span={2} />
      <Calc label="Spring Stress (MPa):" value={props.calc.B31} span={2} />
      <tr>
        <td className="section" colSpan={4}>
          4.0 HARDWARE & FASTENERS
        </td>
      </tr>
      <tr>
        <td>Hardware Kit Contents:</td>
        <td colSpan={3}>
          <Field {...props} addr="B34" />
        </td>
      </tr>
      {[36, 37, 38].map((row) => (
        <tr key={row}>
          <td>{`Location ${row - 35}:`}</td>
          <td>
            <Field {...props} addr={`B${row}`} />
          </td>
          <td>
            <Field {...props} addr={`C${row}`} />
          </td>
          <td>
            <Field {...props} addr={`D${row}`} />
          </td>
        </tr>
      ))}
      <tr>
        <td className="section" colSpan={4}>
          5.0 WEIGHTS & PACKAGING
        </td>
      </tr>
      {["Coil Spring Weight:", "Hardware Weight:", "Total Package Weight:", "Box Size (H x W x L) (mm):", "Foam Construction Details:"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${42 + index}`} />
          </td>
          <td colSpan={2}>
            <Field {...props} addr={`C${42 + index}`} />
          </td>
        </tr>
      ))}
      <Research {...props} start={49} question="B53" notes="B55" />
    </>
  );
}

function AirBody(props: SheetProps & { calc: Record<string, CellValue> }) {
  return (
    <>
      <tr>
        <td className="section" colSpan={4}>
          1.0 PROJECT & VEHICLE INFORMATION
        </td>
      </tr>
      <Pair {...props} left="Sample Part Number:" leftAddr="B6" right="Application:" rightAddr="D6" />
      <Pair {...props} left="Brand Tested (OE/Competitor):" leftAddr="B7" right="Condition (New/Used):" rightAddr="D7" />
      <Pair {...props} left="Curb Weight (lbs):" leftAddr="B8" right="Weight Distribution (%):" rightAddr="D8" numeric />
      <tr>
        <td>Motion Ratio:</td>
        <td colSpan={3}>
          <Field {...props} addr="B9" kind="number" />
        </td>
      </tr>
      <Pair {...props} left="Tested By:" leftAddr="B10" right="Date:" rightAddr="D10" date />
      <tr>
        <td className="section" colSpan={4}>
          2.0 PHYSICAL DIMENSIONS & CONSTRUCTION
        </td>
      </tr>
      {["Top Construction Style:", "Bottom Construction Style:", "Overall Length of Air Spring (mm):", "Top Diameter (mm):", "Bottom Diameter (mm):", "Labeling / Molding on Bag:"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${14 + index}`} />
          </td>
          <td colSpan={2}>
            <Field {...props} addr={`C${14 + index}`} />
          </td>
        </tr>
      ))}
      <tr>
        <td className="section" colSpan={4}>
          3.0 PERFORMANCE & ENGINEERING SPECIFICATIONS
        </td>
      </tr>
      <tr>
        {["Criteria", "Force (N)", "Spring Rate (N/mm)", "Notes"].map((heading) => (
          <th key={heading}>{heading}</th>
        ))}
      </tr>
      {["At 20 PSI:", "At 40 PSI:"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${23 + index}`} kind="number" />
          </td>
          <td>
            <Field {...props} addr={`C${23 + index}`} kind="number" />
          </td>
          <td>
            <Field {...props} addr={`D${23 + index}`} />
          </td>
        </tr>
      ))}
      <Calc label="Ride Height Target Force (N):" value={props.calc.B25} span={2} />
      <Calc label="Calculated Ride Height PSI:" value={props.calc.B26} span={2} />
      <Calc label="Calculated Ride Height PSI Spring Rate (N/mm):" value={props.calc.B27} span={2} />
      <tr>
        <td className="section" colSpan={4}>
          4.0 HARDWARE & FASTENERS
        </td>
      </tr>
      <tr>
        <td>Hardware Kit Contents:</td>
        <td colSpan={3}>
          <Field {...props} addr="B30" />
        </td>
      </tr>
      {[32, 33, 34].map((row) => (
        <tr key={row}>
          <td>{`Location ${row - 31}:`}</td>
          <td>
            <Field {...props} addr={`B${row}`} />
          </td>
          <td>
            <Field {...props} addr={`C${row}`} />
          </td>
          <td>
            <Field {...props} addr={`D${row}`} />
          </td>
        </tr>
      ))}
      <tr>
        <td className="section" colSpan={4}>
          5.0 WEIGHTS & PACKAGING
        </td>
      </tr>
      {["Airbag Weight (lbs):", "Hardware Weight (OZ):", "Total Package Weight (lbs):", "Box Size (H x W x L) (mm):", "Foam Construction Details:"].map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${38 + index}`} />
          </td>
          <td colSpan={2}>
            <Field {...props} addr={`C${38 + index}`} />
          </td>
        </tr>
      ))}
      <Research {...props} start={45} question="B49" notes="B51" />
    </>
  );
}

function Research(props: SheetProps & { start: number; question: string; notes: string }) {
  const labels = ["Differences to OE:", "Notes:", "Major Issues with OEM:", "DMA Solutions:"];
  return (
    <>
      <tr>
        <td className="section" colSpan={4}>
          6.0 VISUAL & ENGINEERING RESEARCH
        </td>
      </tr>
      {labels.map((label, index) => (
        <tr key={label}>
          <td>{label}</td>
          <td colSpan={3}>
            <Field {...props} addr={`B${props.start + index}`} kind="area" />
          </td>
        </tr>
      ))}
      <tr>
        <td>Application Research:</td>
        <td colSpan={3}>Are there more than one style for this application? If yes, can they be consolidated?</td>
      </tr>
      <tr>
        <td />
        <td colSpan={3}>
          <Field {...props} addr={props.question} kind="area" />
        </td>
      </tr>
      <tr>
        <td>Notes:</td>
        <td colSpan={3}>
          <Field {...props} addr={props.notes} kind="area" />
        </td>
      </tr>
    </>
  );
}
