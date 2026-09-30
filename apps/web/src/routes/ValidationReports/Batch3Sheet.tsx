import { useMemo } from "react";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import {
  BATCH3_SHEET_TITLE,
  COIL_CERTIFY,
  COMPRESSOR_CERTIFY,
  ELECTRIC_CERTIFY,
  GAS_CERTIFY,
  GAS_FURTHER_CERTIFY,
  batchFill,
  evaluateBatch,
  showBatch,
  type Batch3Kind,
  type CellValue,
} from "../../lib/batch3Reports";
import "./validationReport.css";

interface Batch3SheetProps {
  variant: Batch3Kind;
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber?: string;
  revision?: string;
  signature?: string;
  furtherSignature?: string;
  onSign?: (pin: string) => Promise<unknown>;
  onFurtherSign?: (pin: string) => Promise<unknown>;
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

function shown(calculated: Record<string, CellValue>, addr: string): string {
  return showBatch(calculated[addr]);
}

function Result({ value }: { value: CellValue | undefined }) {
  const label = showBatch(value);
  const fill = batchFill(label);
  return <td style={fill ? { background: fill, color: "#111", fontWeight: 700 } : { fontWeight: 700 }}>{label}</td>;
}

export function Batch3Sheet(props: Batch3SheetProps) {
  const calculated = useMemo(() => evaluateBatch(props.variant, props.cells), [props.cells, props.variant]);
  const title = BATCH3_SHEET_TITLE[props.variant];
  const doc = props.documentNumber?.trim() ? `Doc ID: ${props.documentNumber.trim()}` : "Doc ID:";
  if (props.variant === "shock") return <ShockSheet {...props} calculated={calculated} title={title} doc={doc} />;
  if (props.variant === "air_compressor") return <CompressorSheet {...props} calculated={calculated} title={title} doc={doc} />;
  if (props.variant === "electric_lift") return <ElectricSheet {...props} calculated={calculated} title={title} doc={doc} />;
  if (props.variant === "gas_lift") return <GasSheet {...props} calculated={calculated} title={title} doc={doc} />;
  return <CoilSheet {...props} calculated={calculated} title={title} doc={doc} />;
}

type SheetProps = Batch3SheetProps & { calculated: Record<string, CellValue>; title: string; doc: string };

function Field(props: SheetProps & { addr: string; kind?: "text" | "number" | "date" | "area" | "yn" | "yesno" }) {
  const value = text(props.cells[props.addr]);
  const common = { "aria-label": props.addr, value, disabled: props.readOnly };
  if (props.kind === "area") {
    return <textarea {...common} onChange={(event) => props.onChange(props.addr, event.target.value)} />;
  }
  if (props.kind === "yn" || props.kind === "yesno") {
    const options = props.kind === "yn" ? ["", "Y", "N"] : ["", "Yes", "No"];
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
      {...common}
      type={props.kind === "date" ? "date" : "text"}
      onChange={(event) => props.onChange(props.addr, props.kind === "number" ? parseNumber(event.target.value) : event.target.value)}
    />
  );
}

function Check(props: SheetProps & { addr: string; label: string }) {
  return (
    <label>
      <input
        type="checkbox"
        aria-label={props.addr}
        checked={props.cells[props.addr] === true}
        disabled={props.readOnly}
        onChange={(event) => props.onChange(props.addr, event.target.checked)}
      />{" "}
      {props.label}
    </label>
  );
}

function Sign(props: { label: string; value: string; certify: string; disabled?: boolean; onSign?: (pin: string) => Promise<unknown>; span: number }) {
  return (
    <tr>
      <td>{props.label}</td>
      <td colSpan={props.span}>
        <SignatureStamp value={props.value} certify={props.certify} disabled={props.disabled || !props.onSign} variant="sheet" onSign={async (pin) => props.onSign?.(pin)} />
      </td>
    </tr>
  );
}

function ShockSheet(props: SheetProps) {
  const band = (row: number, label: string, method: string, spec?: "calc") => (
    <tr key={row}>
      <td>{label}</td>
      <td>{method}</td>
      <td>{spec === "calc" ? shown(props.calculated, `C${row}`) : <Field {...props} addr={`C${row}`} kind="number" />}</td>
      <td>
        <Field {...props} addr={`D${row}`} kind="number" />
      </td>
      <td>
        <Field {...props} addr={`E${row}`} kind="number" />
      </td>
      <td>
        <Field {...props} addr={`F${row}`} kind="number" />
      </td>
      <Result value={props.calculated[`G${row}`]} />
      <Result value={props.calculated[`H${row}`]} />
      <td>
        <Field {...props} addr={`I${row}`} />
      </td>
    </tr>
  );
  const open = (row: number, label: string, method: string) => (
    <tr key={row}>
      <td>{label}</td>
      <td>{method}</td>
      <td>
        <Field {...props} addr={`C${row}`} kind="number" />
      </td>
      <td>
        <Field {...props} addr={`D${row}`} kind="number" />
      </td>
      <td>
        <Field {...props} addr={`E${row}`} kind="number" />
      </td>
      <td>
        <Field {...props} addr={`F${row}`} kind="number" />
      </td>
      <td />
      <td />
      <td>
        <Field {...props} addr={`I${row}`} />
      </td>
    </tr>
  );
  const banner = shown(props.calculated, "A3");
  const fill = batchFill(banner);
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid="shock-sheet" aria-label={props.title}>
        <tbody>
          <tr>
            <td className="title" colSpan={7}>
              {props.title}
            </td>
            <td colSpan={2} style={fill ? { background: fill, fontWeight: 700 } : { fontWeight: 700 }}>
              {banner}
            </td>
          </tr>
          <tr>
            <td>{props.doc}</td>
            <td>{`Rev: ${props.revision || "B"}`}</td>
            <td colSpan={3}>Effective Date: 02/13/2026</td>
            <td>Approved By:</td>
            <td colSpan={3}>
              <Field {...props} addr="H2" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={9}>
              PROJECT INFORMATION
            </td>
          </tr>
          <tr>
            <td>Part Number:</td>
            <td>
              <Field {...props} addr="B5" />
            </td>
            <td>Drawing Number:</td>
            <td>
              <Field {...props} addr="D5" />
            </td>
            <td>Tested By:</td>
            <td>
              <Field {...props} addr="F5" />
            </td>
            <td>Date:</td>
            <td colSpan={2}>
              <Field {...props} addr="H5" kind="date" />
            </td>
          </tr>
          <tr>
            <td>Supplier:</td>
            <td>
              <Field {...props} addr="B6" />
            </td>
            <td>Batch ID:</td>
            <td>
              <Field {...props} addr="D6" />
            </td>
            <td>Approved By:</td>
            <td colSpan={4}>
              <Field {...props} addr="F6" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={9}>
              1.0 CATALOGING & VISUAL
            </td>
          </tr>
          <tr>
            {["Criteria", "Standard", "Spec.", "Tolerance", "Sample 1", "Sample 2", "Pass/Fail", "Pass/Fail", "Notes/Diffs"].map((heading) => (
              <th key={heading + "a"}>{heading}</th>
            ))}
          </tr>
          <tr>
            <td>Fastener Hardware Style (Metric)</td>
            <td>Visual Inspection</td>
            <td colSpan={2} />
            <td>
              <Field {...props} addr="E10" />
            </td>
            <td>
              <Field {...props} addr="F10" />
            </td>
            <td />
            <td />
            <td>
              <Field {...props} addr="I10" />
            </td>
          </tr>
          <tr>
            <td>Fastener Hardware Grade (Metric)</td>
            <td>Markings/Spec</td>
            <td>10</td>
            <td />
            <td>
              <Field {...props} addr="E11" kind="number" />
            </td>
            <td>
              <Field {...props} addr="F11" kind="number" />
            </td>
            <Result value={props.calculated.G11} />
            <Result value={props.calculated.H11} />
            <td>
              <Field {...props} addr="I11" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={9}>
              2.0 STRUT PHYSICALS
            </td>
          </tr>
          {band(15, "Max Length (Extended)(mm)", "TST-DIM-001")}
          {band(16, "Min Length (Compressed)(mm)", "Calculated", "calc")}
          {band(17, "Stroke (mm)", "TST-DIM-001")}
          <tr>
            <td>Strut Paint Thickness (µm)</td>
            <td>ASTM D7091-22</td>
            <td>
              <Field {...props} addr="C18" kind="number" />
            </td>
            <td>≤</td>
            <td>
              <Field {...props} addr="E18" kind="number" />
            </td>
            <td>
              <Field {...props} addr="F18" kind="number" />
            </td>
            <Result value={props.calculated.G18} />
            <Result value={props.calculated.H18} />
            <td>
              <Field {...props} addr="I18" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={9}>
              3.0 DAMPER PERFORMANCE
            </td>
          </tr>
          {open(22, "Compression Force @ 1.0m/s (N)", "JASO C602:2001 8.1")}
          {open(23, "Compression Force @ 0.6m/s (N)", "JASO C602:2001 8.1")}
          {band(24, "Compression Force @ 0.3m/s (N)", "JASO C602:2001 8.1")}
          {open(25, "Compression Force @ 0.1m/s (N)", "JASO C602:2001 8.1")}
          {open(26, "Compression Force @ 0.05m/s (N)", "JASO C602:2001 8.1")}
          {open(27, "Rebound Force @ 0.05m/s (N)", "JASO C602:2001 8.1")}
          {open(28, "Rebound Force @ 0.1m/s (N)", "JASO C602:2001 8.1")}
          {band(29, "Rebound Force @ 0.3m/s (N)", "JASO C602:2001 8.1")}
          {open(30, "Rebound Force @ 0.6m/s (N)", "JASO C602:2001 8.1")}
          {open(31, "Rebound Force @ 1.0m/s (N)", "JASO C602:2001 8.1")}
          <tr>
            <td className="section" colSpan={9}>
              4.0 MOUNTS & BUMP STOPS
            </td>
          </tr>
          {band(35, "Top Mount Characteristics (mm)", "TST-DIM-001")}
          {band(36, "Top Mount Characteristics (mm)", "TST-DIM-001")}
          {band(37, "Bottom Mount Characteristics (mm)", "TST-DIM-001")}
          {band(38, "Bottom Mount Characteristics (mm)", "TST-DIM-001")}
          <tr>
            <td className="section" colSpan={9}>
              5.0 FINAL CONCLUSION
            </td>
          </tr>
          {[41, 42, 43].map((row) => (
            <tr key={row}>
              <td>{row === 41 ? "OVERALL DISPOSITION SAMPLE 1:" : row === 42 ? "OVERALL DISPOSITION SAMPLE 2:" : "OVERALL DISPOSITION:"}</td>
              <td colSpan={8}>
                <Check {...props} addr={`B${row}`} label="Pass" /> <Check {...props} addr={`D${row}`} label="Fail" /> <Check {...props} addr={`F${row}`} label="Conditional Pass" />
              </td>
            </tr>
          ))}
          <tr>
            <td>Notes:</td>
            <td colSpan={4}>
              <Field {...props} addr="B44" kind="area" />
            </td>
            <td>Engineer who Approved Conditional Pass:</td>
            <td colSpan={3}>
              <Field {...props} addr="H44" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const COMPRESSOR_BLOCKS: { section: string; header: boolean; rows: { row: number; label: string }[] }[] = [
  {
    section: "2.0 PHYSICAL DIMENSIONS & FITMENT",
    header: true,
    rows: [
      { row: 12, label: "Style of Pump" },
      { row: 13, label: "Overall Length (mm):" },
      { row: 14, label: "Overall Width (mm):" },
      { row: 15, label: "Overall Height (mm):" },
      { row: 16, label: "Mounting Hole Spacing (mm):" },
      { row: 17, label: "Mounting Bushing Hardness (Shore A):" },
      { row: 18, label: "Air Outlet Port Thread Size:" },
      { row: 19, label: "Air Inlet / Intake Port Size:" },
    ],
  },
  {
    section: "3.0 ELECTRICAL & SENSORS",
    header: true,
    rows: [
      { row: 23, label: "Motor DC Resistance (Ohms):" },
      { row: 24, label: "Motor Inductance (microH):" },
      { row: 25, label: "Motor Impedance (Ohms):" },
      { row: 26, label: "Thermal Sensor Resistance (Ohms):" },
      { row: 27, label: "Connector Match / Pinout Alignment:" },
    ],
  },
  {
    section: "4.0 PERFORMANCE & PNEUMATIC VALIDATION",
    header: true,
    rows: [
      { row: 32, label: "0 to 100 PSI Fill Time (Seconds):" },
      { row: 33, label: "Dynamic Flow Rate (CFM):" },
      { row: 34, label: "Peak Amperage (Amps):" },
      { row: 35, label: "Average Vibration (m/s^2)" },
      { row: 36, label: "Max Deadhead / Shutoff Pressure (PSI):" },
      { row: 37, label: "Leak Down Test (PSI drop over 5 mins):" },
      { row: 38, label: "Db Noise Level (Average dB):" },
    ],
  },
  {
    section: "5.0 AIR DRYER & WEIGHTS",
    header: true,
    rows: [
      { row: 42, label: "Desiccant Bead Weight (grams):" },
      { row: 43, label: "Air Compressor Total Weight (lbs):" },
    ],
  },
];

function CompressorSheet(props: SheetProps) {
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid="air-compressor-sheet" aria-label={props.title}>
        <tbody>
          <tr>
            <td className="title" colSpan={6}>
              {props.title}
            </td>
          </tr>
          <tr>
            <td>{props.doc}</td>
            <td>{`Rev: ${props.revision || "A"}`}</td>
            <td colSpan={2}>Effective Date: 03/06/2026</td>
            <td>Approved By:</td>
            <td>
              <Field {...props} addr="F2" />
            </td>
          </tr>
          <tr>
            <td className="note" colSpan={6}>
              Purpose: To validate incoming First Article or production Air Compressors against the approved DMA engineering drawing.
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={6}>
              1.0 PART & INSPECTION INFORMATION
            </td>
          </tr>
          <tr>
            <td>DMA Part Number:</td>
            <td colSpan={2}>
              <Field {...props} addr="B6" />
            </td>
            <td>Supplier / Factory:</td>
            <td colSpan={2}>
              <Field {...props} addr="E6" />
            </td>
          </tr>
          <tr>
            <td>Drawing Revision Number:</td>
            <td colSpan={2}>
              <Field {...props} addr="B7" />
            </td>
            <td>Lot / PO Number:</td>
            <td colSpan={2}>
              <Field {...props} addr="E7" />
            </td>
          </tr>
          <tr>
            <td>Inspected By:</td>
            <td colSpan={2}>
              <Field {...props} addr="B8" />
            </td>
            <td>Inspection Date:</td>
            <td colSpan={2}>
              <Field {...props} addr="E8" kind="date" />
            </td>
          </tr>
          {COMPRESSOR_BLOCKS.filter((block) => block.section.startsWith("2.") || block.section.startsWith("3.")).map((block) => (
            <CompressorBlock key={block.section} block={block} {...props} />
          ))}
          <tr>
            <td>Test Voltage (VDC):</td>
            <td colSpan={5}>
              <Field {...props} addr="B30" />
            </td>
          </tr>
          {COMPRESSOR_BLOCKS.filter((block) => block.section.startsWith("4.") || block.section.startsWith("5.")).map((block) => (
            <CompressorBlock key={block.section} block={block} {...props} />
          ))}
          <tr>
            <td className="section" colSpan={6}>
              6.0 VISUAL INSPECTION & FINAL DISPOSITION
            </td>
          </tr>
          <tr>
            {["Criteria", "Acceptance Standard", "", "Observation", "Pass/Fail", "Notes"].map((heading, index) => (
              <th key={heading + index}>{heading}</th>
            ))}
          </tr>
          {(
            [
              [47, "Surface Finish & Plating:", "Free of rust, sharp edges, and defects"],
              [48, "Labels & Markings:", "Matches DMA artwork/label requirements"],
              [49, "Packaging:", "Matches approved foam/box layout"],
            ] as const
          ).map(([row, label, standard]) => (
            <tr key={row}>
              <td>{label}</td>
              <td colSpan={2}>{standard}</td>
              <td>
                <Field {...props} addr={`D${row}`} />
              </td>
              <td>
                <Field {...props} addr={`E${row}`} />
              </td>
              <td>
                <Field {...props} addr={`F${row}`} />
              </td>
            </tr>
          ))}
          <tr>
            <td>FINAL DISPOSITION:</td>
            <td colSpan={5}>
              <Check {...props} addr="B51" label="APPROVED" /> <Check {...props} addr="D51" label="REJECTED" /> <Check {...props} addr="E51" label="APPROVED WITH DEVIATION" />
            </td>
          </tr>
          <Sign label="Authorized By (Signature):" value={props.signature ?? ""} certify={COMPRESSOR_CERTIFY} disabled={props.readOnly} onSign={props.onSign} span={5} />
          <tr>
            <td>Deviation/Rejection Notes:</td>
            <td colSpan={5}>
              <Field {...props} addr="B53" kind="area" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CompressorBlock({ block, ...props }: SheetProps & { block: (typeof COMPRESSOR_BLOCKS)[number] }) {
  return (
    <>
      <tr>
        <td className="section" colSpan={6}>
          {block.section}
        </td>
      </tr>
      <tr>
        {["Criteria", "Drawing Spec", "Tolerance", "Actual Measurement", "Pass/Fail", "Notes"].map((heading) => (
          <th key={block.section + heading}>{heading}</th>
        ))}
      </tr>
      {block.rows.map((row) => (
        <tr key={row.row}>
          <td>{row.label}</td>
          <td>
            {row.row === 12 ? (
              <select aria-label="B12" value={text(props.cells.B12)} disabled={props.readOnly} onChange={(event) => props.onChange("B12", event.target.value)}>
                {["", "AMK", "WABCO", "Continental AG", "Hitachi Astemo", "Thomas/Delphi"].map((option) => (
                  <option key={option || "blank"} value={option}>
                    {option || "—"}
                  </option>
                ))}
              </select>
            ) : (
              <Field {...props} addr={`B${row.row}`} kind="number" />
            )}
          </td>
          <td>
            <Field {...props} addr={`C${row.row}`} kind="number" />
          </td>
          <td>
            <Field {...props} addr={`D${row.row}`} kind="number" />
          </td>
          <Result value={props.calculated[`E${row.row}`]} />
          <td>
            <Field {...props} addr={`F${row.row}`} />
          </td>
        </tr>
      ))}
    </>
  );
}

const GROMMETS = ["", "One Piece Rubber", "Rubber Overmolded Plastic", "All Plastic"];

function ElectricSheet(props: SheetProps) {
  const measure = (row: number, label: string, result: CellValue | undefined, extra?: "grommet" | "yes" | "calc") => (
    <tr key={row}>
      <td>{label}</td>
      <td>{extra === "calc" && row === 19 ? shown(props.calculated, "B19") : <Field {...props} addr={`B${row}`} kind={extra === "grommet" || extra === "yes" ? "text" : "number"} />}</td>
      <td>
        {extra === "grommet" ? (
          <select aria-label={`C${row}`} value={text(props.cells[`C${row}`])} disabled={props.readOnly} onChange={(event) => props.onChange(`C${row}`, event.target.value)}>
            {GROMMETS.map((option) => (
              <option key={option || "blank"} value={option}>
                {option || "—"}
              </option>
            ))}
          </select>
        ) : extra === "yes" ? (
          <Field {...props} addr={`C${row}`} kind="yesno" />
        ) : extra === "calc" ? (
          shown(props.calculated, `C${row}`)
        ) : (
          <Field {...props} addr={`C${row}`} kind="number" />
        )}
      </td>
      <td>
        {extra === "grommet" ? (
          <select aria-label={`D${row}`} value={text(props.cells[`D${row}`])} disabled={props.readOnly} onChange={(event) => props.onChange(`D${row}`, event.target.value)}>
            {GROMMETS.map((option) => (
              <option key={option || "blank"} value={option}>
                {option || "—"}
              </option>
            ))}
          </select>
        ) : extra === "yes" ? (
          <Field {...props} addr={`D${row}`} kind="yesno" />
        ) : extra === "calc" ? (
          shown(props.calculated, `D${row}`)
        ) : (
          <Field {...props} addr={`D${row}`} kind="number" />
        )}
      </td>
      <Result value={result} />
      <td>
        <Field {...props} addr={`F${row}`} />
      </td>
    </tr>
  );
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid="electric-lift-sheet" aria-label={props.title}>
        <tbody>
          <tr>
            <td className="title" colSpan={6}>
              {props.title}
            </td>
          </tr>
          <tr>
            <td>{props.doc}</td>
            <td>{`Rev: ${props.revision || "B"}`}</td>
            <td>Effective Date:</td>
            <td>Approved By:</td>
            <td colSpan={2}>
              <Field {...props} addr="E2" />
            </td>
          </tr>
          <tr>
            <td className="note" colSpan={6}>
              Purpose: To validate incoming First Article or production Electric Lift Supports against the established OE baseline specifications.
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={6}>
              1.0 PART & INSPECTION INFORMATION
            </td>
          </tr>
          <tr>
            <td>DMA / Factory Part Number:</td>
            <td>
              <Field {...props} addr="B6" />
            </td>
            <td>OE Part Number:</td>
            <td colSpan={3}>
              <Field {...props} addr="D6" />
            </td>
          </tr>
          <tr>
            <td>Supplier / Factory:</td>
            <td>
              <Field {...props} addr="B7" />
            </td>
            <td>Lot / PO Number:</td>
            <td colSpan={3}>
              <Field {...props} addr="D7" />
            </td>
          </tr>
          <tr>
            <td>Inspected By:</td>
            <td>
              <Field {...props} addr="B8" />
            </td>
            <td>Inspection Date:</td>
            <td colSpan={3}>
              <Field {...props} addr="D8" kind="date" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={6}>
              2.0 PHYSICAL DIMENSIONS & HARDWARE
            </td>
          </tr>
          <tr>
            {["Criteria", "Drawing Dimensions", "OE Measurements", "Gaci Prototype Measurments", "Pass/Fail", "Notes"].map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
          {measure(12, "Weight (lbs):", props.calculated.E12)}
          {measure(13, "Grommet Style:", props.calculated.E13, "grommet")}
          {measure(14, "Shaft Connector Dimensions:", props.calculated.E14)}
          {measure(15, "Body Connector Dimensions:", props.calculated.E15)}
          {measure(16, "Tube Outer Diameter (mm):", props.calculated.E16)}
          {measure(17, "Wire Length (mm):", props.calculated.E17)}
          {measure(18, "Extended Length (mm):", props.calculated.E18)}
          {measure(19, "Compressed Length (mm):", props.calculated.E19, "calc")}
          {measure(20, "Stroke Length (mm):", props.calculated.E20)}
          <tr>
            <td className="section" colSpan={6}>
              3.0 ELECTRICAL & MOTOR SPECIFICATIONS
            </td>
          </tr>
          {measure(24, "Motor DC Resistance (Ohms):", undefined)}
          {measure(25, "Motor Inductance @ 1kHz (mH):", undefined)}
          {measure(26, "Motor Impedance @ 1kHz (Ohms):", undefined)}
          <tr>
            <td>Connector Pinout Match Yes or No:</td>
            <td>[Insert Picture of Pinout]</td>
            <td>
              <Field {...props} addr="C27" kind="yesno" />
            </td>
            <td>
              <Field {...props} addr="D27" kind="yesno" />
            </td>
            <Result value={props.calculated.E27} />
            <td>
              <Field {...props} addr="F27" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={6}>
              4.0 HALL SENSOR SPECIFICATIONS
            </td>
          </tr>
          {measure(31, "Hall 1 Sensor Frequency (Hz):", props.calculated.E31)}
          {measure(32, "Hall 2 Sensor Frequency (Hz):", props.calculated.E32)}
          <tr>
            <td className="section" colSpan={6}>
              5.0 MECHANICAL FORCE TESTING
            </td>
          </tr>
          {measure(36, "Motor Peak Amps (12.0 VDC):", undefined)}
          {measure(37, "Max Locked Rotor Force - PUSH (N):", props.calculated.E37)}
          {measure(38, "F1/F3/FA Force (N):", undefined)}
          {measure(39, "F2/F4/FB Force (N):", undefined)}
          {measure(40, "Fr Force (N):", undefined)}
          <tr>
            <td>Spring Rate (N/mm):</td>
            <td>{shown(props.calculated, "B41")}</td>
            <td>{shown(props.calculated, "C41")}</td>
            <td>{shown(props.calculated, "D41")}</td>
            <Result value={props.calculated.E41} />
            <td>
              <Field {...props} addr="F41" />
            </td>
          </tr>
          <tr>
            <td>Force Graph:</td>
            <td className="note" colSpan={5}>
              The Graphs sheet has an empty scatter chart and no plotted points.
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={6}>
              6.0 VISUAL INSPECTION & FINAL DISPOSITION
            </td>
          </tr>
          {(
            [
              [46, "Surface Finish & Painting:", "Free of scratches, rust, and defects"],
              [47, "Labels & Markings:", "Matches DMA artwork/label requirements"],
              [48, "Packaging:", "Matches approved box/bag layout"],
            ] as const
          ).map(([row, label, standard]) => (
            <tr key={row}>
              <td>{label}</td>
              <td>{standard}</td>
              <td>
                <Field {...props} addr={`C${row}`} kind="yesno" />
              </td>
              <td>
                <Field {...props} addr={`D${row}`} kind="yesno" />
              </td>
              <Result value={props.calculated[`E${row}`]} />
              <td>
                <Field {...props} addr={`F${row}`} />
              </td>
            </tr>
          ))}
          <tr>
            <td>FINAL DISPOSITION:</td>
            <td colSpan={5}>
              <Check {...props} addr="B50" label="APPROVED" /> <Check {...props} addr="C50" label="REJECTED" /> <Check {...props} addr="E50" label="APPROVED WITH DEVIATION" />
            </td>
          </tr>
          <Sign label="Authorized By (Signature):" value={props.signature ?? ""} certify={ELECTRIC_CERTIFY} disabled={props.readOnly} onSign={props.onSign} span={5} />
          <tr>
            <td>Deviation/Rejection Notes:</td>
            <td colSpan={5}>
              <Field {...props} addr="B52" kind="area" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const GAS_DIMS = [
  [13, "Extended Length (mm):"],
  [14, "Compressed Length (mm):"],
  [15, "Stroke Length (mm):"],
  [16, "Tube Outer Diameter (mm):"],
  [17, "Shaft Outer Diameter (mm):"],
  [18, "Shaft Connector Style:"],
  [19, "Body Connector Style:"],
] as const;

function GasSheet(props: SheetProps) {
  const banner = shown(props.calculated, "J2");
  const fill = batchFill(banner);
  const dim = (row: number, label: string) => (
    <tr key={row}>
      <td>{label || <Field {...props} addr={`A${row}`} />}</td>
      <td colSpan={2}>
        <Field {...props} addr={`B${row}`} kind="number" />
      </td>
      <td>
        <Field {...props} addr={`D${row}`} kind="number" />
      </td>
      <td>{shown(props.calculated, `E${row}`)}</td>
      <td>{shown(props.calculated, `F${row}`)}</td>
      <td>
        <Field {...props} addr={`G${row}`} kind="number" />
      </td>
      <Result value={props.calculated[`H${row}`]} />
    </tr>
  );
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid="gas-lift-sheet" aria-label={props.title}>
        <tbody>
          <tr>
            <td className="title" colSpan={6}>
              {props.title}
            </td>
            <td colSpan={2} style={fill ? { background: fill, fontWeight: 700 } : { fontWeight: 700 }}>
              Sample Pass/Fail
              <div>{banner}</div>
            </td>
          </tr>
          <tr>
            <td>{props.doc}</td>
            <td colSpan={2}>{`Rev: ${props.revision || "B"}`}</td>
            <td>Effective Date:</td>
            <td>2026-06-02</td>
            <td>Approved By:</td>
            <td colSpan={2}>
              <Field {...props} addr="H2" />
            </td>
          </tr>
          <tr>
            <td className="note" colSpan={8}>
              Purpose: To validate incoming First Article or production Gas Lift Supports against the approved DMA engineering drawing.
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={8}>
              1.0 PART & INSPECTION INFORMATION
            </td>
          </tr>
          <tr>
            <td>Selling Part Number:</td>
            <td colSpan={3}>
              <Field {...props} addr="B6" />
            </td>
            <td>Drawing Part Number:</td>
            <td colSpan={3}>
              <Field {...props} addr="F6" />
            </td>
          </tr>
          <tr>
            <td>Supplier / Factory:</td>
            <td colSpan={3}>
              <Field {...props} addr="B7" />
            </td>
            <td>Batch Number:</td>
            <td colSpan={3}>
              <Field {...props} addr="F7" />
            </td>
          </tr>
          <tr>
            <td>Inspected By:</td>
            <td colSpan={3}>
              <Field {...props} addr="B8" />
            </td>
            <td>Inspection Date:</td>
            <td colSpan={3}>
              <Field {...props} addr="F8" kind="date" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={8}>
              2.0 DIMENSIONAL PARAMETERS
            </td>
          </tr>
          <tr>
            <td className="note" colSpan={8}>
              ***Parameter names are general and may need to be adjusted for individual drawings. If all rows are not used label as NA. Extra blank rows are provided for additional dimensions as needed.***
            </td>
          </tr>
          <tr>
            {["Parameter [mm]", "Nominal", "", "Tolerance", "Min", "Max", "Sample", "RESULT"].map((heading, index) => (
              <th key={heading + index}>{heading}</th>
            ))}
          </tr>
          {GAS_DIMS.map(([row, label]) => dim(row, label))}
          {dim(20, "")}
          {dim(21, "")}
          <tr>
            <td className="section" colSpan={8}>
              3.0 MECHANICAL FORCE TESTING (CTW SPRING RATER)
            </td>
          </tr>
          {(
            [
              [25, "F1 Force (N) - Extension at 10mm:"],
              [26, "F3 Force (N) - Compression at 10mm:"],
              [27, "Fa Force (N) - Average"],
            ] as const
          ).map(([row, label]) => (
            <tr key={row}>
              <td>{label}</td>
              <td>
                <Field {...props} addr={`B${row}`} kind="number" />
              </td>
              <td>
                <Field {...props} addr={`C${row}`} kind="yn" />
              </td>
              <td>{shown(props.calculated, `D${row}`)}</td>
              <td>{shown(props.calculated, `E${row}`)}</td>
              <td>{shown(props.calculated, `F${row}`)}</td>
              <td>
                <Field {...props} addr={`G${row}`} kind="number" />
              </td>
              <Result value={props.calculated[`H${row}`]} />
            </tr>
          ))}
          {(
            [
              [28, "Groove Tube (Y/N):"],
              [29, "Hardware Included (Y/N):"],
            ] as const
          ).map(([row, label]) => (
            <tr key={row}>
              <td>{label}</td>
              <td colSpan={5} />
              <td>
                <Field {...props} addr={`G${row}`} kind="yn" />
              </td>
              <Result value={props.calculated[`H${row}`]} />
            </tr>
          ))}
          <tr>
            <td>Force Diagram:</td>
            <td className="note" colSpan={7}>
              The Graphs sheet has an empty scatter chart and no plotted points.
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={8}>
              4.0 VISUAL INSPECTION & FINAL DISPOSITION
            </td>
          </tr>
          {(
            [
              [34, "Surface Finish & Painting:", "Free of scratches, rust, and defects"],
              [35, "Shaft Finish:", "Smooth, no pitting, or chrome flaking"],
              [36, "Labels & Markings:", "Matches DMA artwork/label requirements"],
              [37, "Packaging:", "Matches approved box/bag layout"],
            ] as const
          ).map(([row, label, standard]) => (
            <tr key={row}>
              <td>{label}</td>
              <td colSpan={2}>{standard}</td>
              <td colSpan={3}>
                <Field {...props} addr={`D${row}`} />
              </td>
              <Result value={props.calculated[`G${row}`]} />
              <td />
            </tr>
          ))}
          <tr>
            <td className="section" colSpan={8}>
              6.0 Evaluation
            </td>
          </tr>
          <tr>
            <td>Pass/Fail</td>
            <Result value={props.calculated.B40} />
            <td colSpan={6} />
          </tr>
          <tr>
            <td>FINAL DISPOSITION:</td>
            <td colSpan={7}>
              <Check {...props} addr="C41" label="APPROVED" /> <Check {...props} addr="E41" label="REJECTED" /> <Check {...props} addr="H41" label="APPROVED WITH DEVIATION" />
            </td>
          </tr>
          <Sign label="Authorized By (Signature):" value={props.signature ?? ""} certify={GAS_CERTIFY} disabled={props.readOnly} onSign={props.onSign} span={7} />
          <tr>
            <td>Deviation/Rejection Notes:</td>
            <td colSpan={7}>
              <Field {...props} addr="B43" kind="area" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={8}>
              7.0 Furthur Review
            </td>
          </tr>
          <tr>
            <td className="note" colSpan={8}>
              ***This section is only used if a sample fails intital inspection, but is passed later after follow up from the factory (test method improvements, drawing update/correction, etc)***
            </td>
          </tr>
          <tr>
            <td>Pass/Fail</td>
            <td colSpan={7}>
              <Field {...props} addr="B47" />
            </td>
          </tr>
          <tr>
            <td>FINAL DISPOSITION:</td>
            <td colSpan={7}>
              <Check {...props} addr="C48" label="APPROVED" /> <Check {...props} addr="E48" label="REJECTED" /> <Check {...props} addr="H48" label="APPROVED WITH DEVIATION" />
            </td>
          </tr>
          <Sign label="Authorized By (Signature):" value={props.furtherSignature ?? ""} certify={GAS_FURTHER_CERTIFY} disabled={props.readOnly} onSign={props.onFurtherSign} span={7} />
          <tr>
            <td>Approval Notes:</td>
            <td colSpan={7}>
              <Field {...props} addr="B50" kind="area" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const COIL_TYPES = ["", "Pigtail", "Tangential", "Squared", "Ground Flat"];

function CoilSheet(props: SheetProps) {
  const numeric = (row: number, label: string) => (
    <tr key={label}>
      <td>{label}</td>
      <td>
        <Field {...props} addr={`B${row}`} kind="number" />
      </td>
      <td>{row === 23 ? shown(props.calculated, "C23") : <Field {...props} addr={`C${row}`} kind="number" />}</td>
      <td>{row === 23 ? shown(props.calculated, "D23") : <Field {...props} addr={`D${row}`} kind="number" />}</td>
      <td>
        <Field {...props} addr={`E${row}`} kind="number" />
      </td>
      <td>
        <Field {...props} addr={`F${row}`} kind="number" />
      </td>
      <td>
        <Field {...props} addr={`G${row}`} kind="number" />
      </td>
      <td>{shown(props.calculated, `H${row}`)}</td>
      <Result value={props.calculated[`I${row}`]} />
    </tr>
  );
  const typed = (row: number, label: string) => (
    <tr key={label}>
      <td>{label}</td>
      <td>
        <select aria-label={`B${row}`} value={text(props.cells[`B${row}`])} disabled={props.readOnly} onChange={(event) => props.onChange(`B${row}`, event.target.value)}>
          {COIL_TYPES.map((option) => (
            <option key={option || "blank"} value={option}>
              {option || "—"}
            </option>
          ))}
        </select>
      </td>
      <td>N/A</td>
      <td>N/A</td>
      {["E", "F", "G"].map((col) => (
        <td key={col}>
          <select aria-label={`${col}${row}`} value={text(props.cells[`${col}${row}`])} disabled={props.readOnly} onChange={(event) => props.onChange(`${col}${row}`, event.target.value)}>
            {COIL_TYPES.map((option) => (
              <option key={option || "blank"} value={option}>
                {option || "—"}
              </option>
            ))}
          </select>
        </td>
      ))}
      <td>N/A</td>
      <Result value={props.calculated[`I${row}`]} />
    </tr>
  );
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid="coil-spring-sheet" aria-label={props.title}>
        <tbody>
          <tr>
            <td className="title" colSpan={9}>
              {props.title}
            </td>
          </tr>
          <tr>
            <td>{props.doc}</td>
            <td colSpan={2}>{`Rev: ${props.revision || "A"}`}</td>
            <td>Effective Date:</td>
            <td>2026-03-26</td>
            <td>Approved By:</td>
            <td colSpan={3}>
              <Field {...props} addr="G2" />
            </td>
          </tr>
          <tr>
            <td className="note" colSpan={9}>
              Purpose: To validate incoming First Article or production Coil Springs against the approved DMA engineering drawing.
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={9}>
              1.0 PART & INSPECTION INFORMATION
            </td>
          </tr>
          <tr>
            <td>DMA Part Number:</td>
            <td colSpan={3}>
              <Field {...props} addr="B6" />
            </td>
            <td>OE Part Number:</td>
            <td colSpan={4}>
              <Field {...props} addr="E6" />
            </td>
          </tr>
          <tr>
            <td>Supplier / Factory:</td>
            <td colSpan={3}>
              <Field {...props} addr="B7" />
            </td>
            <td>Lot / PO Number:</td>
            <td colSpan={4}>
              <Field {...props} addr="E7" />
            </td>
          </tr>
          <tr>
            <td>Inspected By:</td>
            <td colSpan={3}>
              <Field {...props} addr="B8" />
            </td>
            <td>Inspection Date:</td>
            <td colSpan={4}>
              <Field {...props} addr="E8" kind="date" />
            </td>
          </tr>
          <tr>
            <td className="section" colSpan={9}>
              2.0 DIMENSIONAL PARAMETERS
            </td>
          </tr>
          <tr>
            {["Parameter", "Nominal", "Min", "Max", "Sample 1", "Sample 2", "Sample 3", "AVERAGE", "RESULT"].map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
          {numeric(12, "Wire Diameter (d) [mm]")}
          {numeric(13, "Outside Body Dia (OD) [mm]")}
          {typed(14, "Top Coil Type")}
          {typed(15, "Bottom Coil Type")}
          {numeric(16, "Top Coil Dia [mm]")}
          {numeric(17, "Bottom Coil Dia [mm]")}
          {numeric(18, "Free Height (L0) [mm]")}
          {numeric(19, "Total Coil Count")}
          <tr>
            <td className="section" colSpan={9}>
              3.0 DYNAMIC PARAMETERS
            </td>
          </tr>
          {numeric(23, "Spring Rate 1 (Initial) [kgf/mm]")}
          {numeric(24, "Spring Rate 2 (Final) [kgf/mm]")}
          <tr>
            <td>Installed Load (kgf)</td>
            <td colSpan={8}>
              <Field {...props} addr="B25" kind="number" />
            </td>
          </tr>
          {numeric(26, "Installed Height at Load (mm)")}
          <tr>
            <td className="section" colSpan={9}>
              4.0 MISCELLANEOUS
            </td>
          </tr>
          <tr>
            <td>Max Design Force (Fmax) [N]</td>
            <td colSpan={8}>{shown(props.calculated, "B30")}</td>
          </tr>
          <tr>
            <td>Wahl Max Shear Stress [MPa]</td>
            <td colSpan={5}>&lt;= 1200 MPa</td>
            <td colSpan={3}>{shown(props.calculated, "G31")}</td>
          </tr>
          <tr>
            <td>Stress Validation Status</td>
            <td>Must Pass</td>
            <td>Pass {shown(props.calculated, "C32")}</td>
            <td colSpan={2}>Fail {shown(props.calculated, "E32")}</td>
            <Result value={props.calculated.G32} />
            <td colSpan={3} />
          </tr>
          <tr>
            <td>Visual / Paint Inspection</td>
            <td>Tested to Specs</td>
            <td colSpan={7}>
              <Field {...props} addr="C33" />
            </td>
          </tr>
          <tr>
            <td>FINAL DISPOSITION:</td>
            <td colSpan={8}>
              <Check {...props} addr="B35" label="APPROVED" /> <Check {...props} addr="D35" label="REJECTED" /> <Check {...props} addr="F35" label="APPROVED WITH DEVIATION" />
            </td>
          </tr>
          <Sign label="Authorized By (Signature):" value={props.signature ?? ""} certify={COIL_CERTIFY} disabled={props.readOnly} onSign={props.onSign} span={8} />
          <tr>
            <td>Deviation/Rejection Notes:</td>
            <td colSpan={8}>
              <Field {...props} addr="B37" kind="area" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
