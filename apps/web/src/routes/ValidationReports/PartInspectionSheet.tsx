import { useMemo } from "react";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import {
  BRAKE_WEAR_CERTIFY,
  BRAKE_WEAR_FURTHER_CERTIFY,
  FUEL_INJECTOR_CERTIFY,
  FUEL_INJECTOR_FURTHER_CERTIFY,
  evaluateBrake,
  evaluateInjector,
  inspectionFill,
  showInspection,
  type CellValue,
} from "../../lib/partInspection";
import "./validationReport.css";

interface PartInspectionSheetProps {
  variant: "fuel_injector" | "brake_wear";
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

function parseNumber(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

export function PartInspectionSheet(props: PartInspectionSheetProps) {
  const calculated = useMemo(
    () => (props.variant === "fuel_injector" ? evaluateInjector(props.cells) : evaluateBrake(props.cells)),
    [props.cells, props.variant],
  );
  const title = props.variant === "fuel_injector" ? "FUEL INJECTOR VALIDATION DOCUMENT" : "BRAKE WEAR SENSOR VALIDATION DOCUMENT";
  const purpose =
    props.variant === "fuel_injector"
      ? "Purpose: To validate incoming First Article or production Fuel Injectors against the approved DMA engineering drawing."
      : "Purpose: To validate incoming First Article or production Brake Wear Sensors against the approved DMA engineering drawing.";
  const date = props.variant === "fuel_injector" ? "06/25/2026" : "07/14/2026";
  const doc = props.documentNumber?.trim() ? `Doc ID: ${props.documentNumber.trim()}` : "Doc ID:";
  const banner = showInspection(calculated.J2);
  const fill = inspectionFill(banner);

  return (
    <div className="fp-wrap">
      <table className="insp" data-testid={`${props.variant}-sheet`} aria-label={title}>
        <tbody>
          <tr>
            <td className="title" colSpan={8}>
              {title}
            </td>
            <td colSpan={2} style={fill ? { background: fill } : undefined}>
              Sample Pass/Fail
              <div>{banner}</div>
            </td>
          </tr>
          <tr>
            <td>{doc}</td>
            <td colSpan={3}>{`Rev: ${props.revision || "A"}`}</td>
            <td>Effective Date:</td>
            <td>{date}</td>
            <td>Approved By:</td>
            <td>
              <input aria-label="H2" value={text(props.cells.H2)} disabled={props.readOnly} onChange={(event) => props.onChange("H2", event.target.value)} />
            </td>
            <td colSpan={2} />
          </tr>
          <tr>
            <td className="note" colSpan={8}>
              {purpose}
            </td>
            <td colSpan={2} />
          </tr>
          <tr>
            <td className="section" colSpan={10}>
              1.0 PART & INSPECTION INFORMATION
            </td>
          </tr>
          <Info label="Selling Part Number:" addr="B6" pair="Drawing Part Number:" pairAddr="G6" {...props} />
          <Info label="Supplier / Factory:" addr="B7" pair="Batch Number:" pairAddr="G7" {...props} />
          <Info label="Inspected By:" addr="B8" pair="Inspection Date:" pairAddr="G8" date {...props} />
          <tr>
            <td className="section" colSpan={10}>
              2.0 DIMENSIONAL PARAMETERS
            </td>
          </tr>
          <tr>
            {["Parameter [mm]", "Nominal", "", "Tolerance", "Min", "Max", "Sample", "RESULT", "", ""].map((heading, index) => (
              <th key={heading + index}>{heading}</th>
            ))}
          </tr>
          {(props.variant === "fuel_injector"
            ? ["Extended Length", "Inlet Diameter", "Outlet Diameter", "Body Diameter", "Quantity of O-Rings", "Quantity of Spray Holes"]
            : ["Extended Length", "Wear Head Length", "Wear Head Width", "Wear Head Height", "Electrical Sensor Length", "Electrical Sensor Width", "Electrical Sensor Height"]
          ).map((name, index) => (
            <DimRow key={name} row={12 + index} name={name} cells={props.cells} calculated={calculated} readOnly={props.readOnly} onChange={props.onChange} />
          ))}
          {props.variant === "fuel_injector" ? <InjectorRest {...props} calculated={calculated} /> : <BrakeRest {...props} calculated={calculated} />}
        </tbody>
      </table>
    </div>
  );
}

function text(value: CellValue | undefined): string {
  return value === undefined || value === null || typeof value === "boolean" ? "" : String(value);
}

function Info({
  label,
  addr,
  pair,
  pairAddr,
  date,
  cells,
  readOnly,
  onChange,
}: {
  label: string;
  addr: string;
  pair: string;
  pairAddr: string;
  date?: boolean;
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
}) {
  return (
    <tr>
      <td>{label}</td>
      <td colSpan={3}>
        <input aria-label={addr} value={text(cells[addr])} disabled={readOnly} onChange={(event) => onChange(addr, event.target.value)} />
      </td>
      <td colSpan={2}>{pair}</td>
      <td colSpan={2}>
        <input aria-label={pairAddr} type={date ? "date" : "text"} value={text(cells[pairAddr])} disabled={readOnly} onChange={(event) => onChange(pairAddr, event.target.value)} />
      </td>
      <td colSpan={2} />
    </tr>
  );
}

function DimRow({
  row,
  name,
  cells,
  calculated,
  readOnly,
  onChange,
}: {
  row: number;
  name: string;
  cells: Record<string, CellValue>;
  calculated: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
}) {
  const result = showInspection(calculated[`H${row}`]);
  const fill = inspectionFill(result);
  return (
    <tr>
      <td>{name}</td>
      <td colSpan={2}>
        <input aria-label={`B${row}`} value={text(cells[`B${row}`])} disabled={readOnly} onChange={(event) => onChange(`B${row}`, parseNumber(event.target.value))} />
      </td>
      <td>
        <input aria-label={`D${row}`} value={text(cells[`D${row}`])} disabled={readOnly} onChange={(event) => onChange(`D${row}`, parseNumber(event.target.value))} />
      </td>
      <td>{showInspection(calculated[`E${row}`])}</td>
      <td>{showInspection(calculated[`F${row}`])}</td>
      <td>
        <input aria-label={`G${row}`} value={text(cells[`G${row}`])} disabled={readOnly} onChange={(event) => onChange(`G${row}`, parseNumber(event.target.value))} />
      </td>
      <td style={fill ? { background: fill } : undefined}>{result}</td>
      <td colSpan={2} />
    </tr>
  );
}

function YnRow({
  row,
  name,
  nominal,
  cells,
  calculated,
  readOnly,
  onChange,
}: {
  row: number;
  name: string;
  nominal?: string;
  cells: Record<string, CellValue>;
  calculated: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
}) {
  const result = showInspection(calculated[`H${row}`]);
  const fill = inspectionFill(result);
  return (
    <tr>
      <td>{name}</td>
      <td colSpan={5}>
        {nominal ?? (
          <input aria-label={`B${row}`} value={text(cells[`B${row}`])} disabled={readOnly} onChange={(event) => onChange(`B${row}`, event.target.value)} />
        )}
      </td>
      <td>
        <input aria-label={`G${row}`} placeholder="Y/N" value={text(cells[`G${row}`])} disabled={readOnly} onChange={(event) => onChange(`G${row}`, event.target.value)} />
      </td>
      <td style={fill ? { background: fill } : undefined}>{result}</td>
      <td colSpan={2} />
    </tr>
  );
}

function ResultLine({ addr, calculated }: { addr: string; calculated: Record<string, CellValue> }) {
  const result = showInspection(calculated[addr]);
  const fill = inspectionFill(result);
  return (
    <tr>
      <td>Pass/Fail</td>
      <td colSpan={9} style={fill ? { background: fill, fontWeight: 700 } : { fontWeight: 700 }} data-result={result}>
        {result}
      </td>
    </tr>
  );
}

function Disposition({
  approved,
  rejected,
  deviation,
  cells,
  readOnly,
  onChange,
}: {
  approved: string;
  rejected: string;
  deviation: string;
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
}) {
  const box = (addr: string, label: string) => (
    <label>
      <input type="checkbox" aria-label={addr} checked={cells[addr] === true} disabled={readOnly} onChange={(event) => onChange(addr, event.target.checked)} /> {label}
    </label>
  );
  return (
    <tr>
      <td>FINAL DISPOSITION:</td>
      <td colSpan={9}>
        {box(approved, "APPROVED")} {box(rejected, "REJECTED")} {box(deviation, "APPROVED WITH DEVIATION")}
      </td>
    </tr>
  );
}

function SignRow({
  label,
  value,
  certify,
  disabled,
  onSign,
}: {
  label: string;
  value: string;
  certify: string;
  disabled?: boolean;
  onSign?: (pin: string) => Promise<unknown>;
}) {
  return (
    <tr>
      <td>{label}</td>
      <td colSpan={9}>
        <SignatureStamp value={value} certify={certify} disabled={disabled || !onSign} variant="sheet" onSign={async (pin) => onSign?.(pin)} />
      </td>
    </tr>
  );
}

function Notes({ addr, label, cells, readOnly, onChange }: { addr: string; label: string; cells: Record<string, CellValue>; readOnly?: boolean; onChange: (addr: string, value: CellValue) => void }) {
  return (
    <tr>
      <td>{label}</td>
      <td colSpan={9}>
        <textarea aria-label={addr} value={text(cells[addr])} disabled={readOnly} onChange={(event) => onChange(addr, event.target.value)} />
      </td>
    </tr>
  );
}

function BrakeRest({ cells, calculated, readOnly, onChange, signature, furtherSignature, onSign, onFurtherSign }: PartInspectionSheetProps & { calculated: Record<string, CellValue> }) {
  return (
    <>
      <tr>
        <td className="section" colSpan={10}>
          3.0 VISUAL AND FUNCTIONAL CHECKS
        </td>
      </tr>
      <tr>
        <th>Parameter [mm]</th>
        <th colSpan={5}>Nominal</th>
        <th>Sample (Y/N)</th>
        <th>RESULT</th>
        <th colSpan={2} />
      </tr>
      <YnRow row={22} name="Pinout Matches Drawing" nominal="Must Match Drawing (Y)" cells={cells} calculated={calculated} readOnly={readOnly} onChange={onChange} />
      <YnRow row={23} name="Continuity" nominal="Must Have (Y)" cells={cells} calculated={calculated} readOnly={readOnly} onChange={onChange} />
      <YnRow row={24} name="Overall Visual Match" nominal="Must Match Drawing (Y)" cells={cells} calculated={calculated} readOnly={readOnly} onChange={onChange} />
      <tr>
        <td className="section" colSpan={10}>
          4.0 Evaluation
        </td>
      </tr>
      <ResultLine addr="B27" calculated={calculated} />
      <Disposition approved="C28" rejected="E28" deviation="H28" cells={cells} readOnly={readOnly} onChange={onChange} />
      <SignRow label="Authorized By (Signature):" value={signature ?? ""} certify={BRAKE_WEAR_CERTIFY} disabled={readOnly} onSign={onSign} />
      <Notes addr="B30" label="Deviation/Rejection Notes:" cells={cells} readOnly={readOnly} onChange={onChange} />
      <tr>
        <td className="section" colSpan={10}>
          5.0 Furthur Review
        </td>
      </tr>
      <tr>
        <td className="note" colSpan={10}>
          ***This section is only used if a sample fails intital inspection, but is passed later after follow up from the factory (test method improvements, drawing update/correction, etc)***
        </td>
      </tr>
      <tr>
        <td>Pass/Fail</td>
        <td colSpan={9}>
          <input aria-label="B34" value={text(cells.B34)} disabled={readOnly} onChange={(event) => onChange("B34", event.target.value)} />
        </td>
      </tr>
      <Disposition approved="C35" rejected="E35" deviation="H35" cells={cells} readOnly={readOnly} onChange={onChange} />
      <SignRow label="Authorized By (Signature):" value={furtherSignature ?? ""} certify={BRAKE_WEAR_FURTHER_CERTIFY} disabled={readOnly} onSign={onFurtherSign} />
      <Notes addr="B37" label="Approval Notes:" cells={cells} readOnly={readOnly} onChange={onChange} />
    </>
  );
}

function InjectorRest({ cells, calculated, readOnly, onChange, signature, furtherSignature, onSign, onFurtherSign }: PartInspectionSheetProps & { calculated: Record<string, CellValue> }) {
  const side = cells.H34 === true;
  const pack = (row: number, name: string) => {
    const result = showInspection(calculated[`H${row}`]);
    const fill = inspectionFill(result);
    return (
      <tr key={name}>
        <td>{name}</td>
        <td colSpan={2}>
          <input aria-label={`B${row}`} value={text(cells[`B${row}`])} disabled={readOnly} onChange={(event) => onChange(`B${row}`, parseNumber(event.target.value))} />
        </td>
        <td>{showInspection(calculated[`D${row}`])}</td>
        <td>{showInspection(calculated[`E${row}`])}</td>
        <td>{showInspection(calculated[`F${row}`])}</td>
        <td>
          <input aria-label={`G${row}`} value={text(cells[`G${row}`])} disabled={readOnly} onChange={(event) => onChange(`G${row}`, parseNumber(event.target.value))} />
        </td>
        <td style={fill ? { background: fill } : undefined}>{result}</td>
        <td colSpan={2} />
      </tr>
    );
  };
  return (
    <>
      <tr>
        <td className="section" colSpan={10}>
          3.0 VISUAL AND FUNCTIONAL CHECKS
        </td>
      </tr>
      <YnRow row={21} name="Body Color" cells={cells} calculated={calculated} readOnly={readOnly} onChange={onChange} />
      <YnRow row={22} name="Color of O-Rings" cells={cells} calculated={calculated} readOnly={readOnly} onChange={onChange} />
      <YnRow row={23} name="Pinout Matches Drawing" nominal="Must Match Drawing (Y)" cells={cells} calculated={calculated} readOnly={readOnly} onChange={onChange} />
      <YnRow row={24} name="Overall Visual Match" nominal="Must Match Drawing (Y)" cells={cells} calculated={calculated} readOnly={readOnly} onChange={onChange} />
      <tr>
        <td className="section" colSpan={10}>
          4.0 PACKAGING
        </td>
      </tr>
      <tr>
        <td className="note" colSpan={10}>
          ***Tolerence is precalculated to be 10% and will update when the nominal value is input. Do not manually adjust the tolerance values in this section***
        </td>
      </tr>
      {pack(29, "Length")}
      {pack(30, "Width")}
      {pack(31, "Height")}
      <tr>
        <td className="section" colSpan={10}>
          5.0 DYNAMIC PARAMETERS
        </td>
      </tr>
      <tr>
        <td>Part Type</td>
        <td colSpan={9}>
          <label>
            <input type="checkbox" aria-label="D34" checked={cells.D34 === true} disabled={readOnly} onChange={(event) => onChange("D34", event.target.checked)} /> Top Feed
          </label>{" "}
          <label>
            <input type="checkbox" aria-label="H34" checked={cells.H34 === true} disabled={readOnly} onChange={(event) => onChange("H34", event.target.checked)} /> Side Feed/Spider
          </label>
        </td>
      </tr>
      <tr>
        <td className="note" colSpan={10}>
          ***The testing fluid used is n-heptane. Adjustments are automatically calculated to allow for the differences in the kinematic viscosity and density between TYH-4 (factory testing fluid) and n-heptane (DMA testing fluid)***
        </td>
      </tr>
      <tr>
        <td className="note" colSpan={10}>
          ***Side Feed and Spider injectors cannot be tested on this fixture. If this SKU passes visual and dimensional inspection, it must be passed as "Approved with Deviation", with the note "No testing capability for Side Feed and Spider injectors"***
        </td>
      </tr>
      <tr className={side ? "muted" : undefined}>
        <td>Coil Resistance (Ohms)</td>
        <td>
          <input aria-label="B38" value={text(cells.B38)} disabled={readOnly} onChange={(event) => onChange("B38", parseNumber(event.target.value))} />
        </td>
        <td>
          <input aria-label="D38" value={text(cells.D38)} disabled={readOnly} onChange={(event) => onChange("D38", parseNumber(event.target.value))} />
        </td>
        <td>{showInspection(calculated.E38)}</td>
        <td>{showInspection(calculated.F38)}</td>
        <td>
          <input aria-label="G38" value={text(cells.G38)} disabled={readOnly} onChange={(event) => onChange("G38", parseNumber(event.target.value))} />
        </td>
        <td colSpan={2} style={inspectionFill(showInspection(calculated.H38)) ? { background: inspectionFill(showInspection(calculated.H38)) ?? undefined } : undefined}>
          {showInspection(calculated.H38)}
        </td>
        <td colSpan={2} />
      </tr>
      <tr className={side ? "muted" : undefined}>
        <td>Test Pressure (kPa)</td>
        <td colSpan={9}>
          <input aria-label="B39" value={text(cells.B39)} disabled={readOnly} onChange={(event) => onChange("B39", event.target.value)} />
        </td>
      </tr>
      <tr className={side ? "muted" : undefined}>
        <td>Test Voltage (V)</td>
        <td colSpan={9}>
          <input aria-label="B40" value={text(cells.B40)} disabled={readOnly} onChange={(event) => onChange("B40", parseNumber(event.target.value))} />
        </td>
      </tr>
      {[
        ["Volume (ml) in 1min at High Speed Setting 3ms PW", 41],
        ["Volume (ml) in 1min at High Speed Setting 4ms PW", 42],
        ["Volume (ml) in 30sec at Medium Speed Setting 5ms PW", 43],
        ["Volume (ml) in 30sec at Medium Speed Setting 6ms PW", 44],
        ["Volume (ml) in 30sec at Medium Speed Setting 7ms PW", 45],
      ].map(([name, row]) => (
        <tr key={row} className={side ? "muted" : undefined}>
          <td>{name}</td>
          <td>
            <input aria-label={`B${row}`} value={text(cells[`B${row}`])} disabled={readOnly} onChange={(event) => onChange(`B${row}`, parseNumber(event.target.value))} />
          </td>
          <td>PW</td>
          <td>
            <input aria-label={`I${row}`} value={text(cells[`I${row}`])} disabled={readOnly} onChange={(event) => onChange(`I${row}`, parseNumber(event.target.value))} />
          </td>
          <td>{showInspection(calculated[`E${row}`])}</td>
          <td colSpan={3}>TREND {showInspection(calculated[`G${row}`])}</td>
          <td colSpan={2} />
        </tr>
      ))}
      <tr className={side ? "muted" : undefined}>
        <td>Raw Static Flow Rate (ml) in 30 seconds</td>
        <td>
          <input aria-label="B47" value={text(cells.B47)} disabled={readOnly} onChange={(event) => onChange("B47", parseNumber(event.target.value))} />
        </td>
        <td>
          <input aria-label="C47" value={text(cells.C47)} disabled={readOnly} onChange={(event) => onChange("C47", parseNumber(event.target.value))} />
        </td>
        <td>{showInspection(calculated.D47)}</td>
        <td>{showInspection(calculated.E47)}</td>
        <td>
          <input aria-label="F47" value={text(cells.F47)} disabled={readOnly} onChange={(event) => onChange("F47", parseNumber(event.target.value))} />
        </td>
        <td>{showInspection(calculated.G47)}</td>
        <td style={inspectionFill(showInspection(calculated.H47)) ? { background: inspectionFill(showInspection(calculated.H47)) ?? undefined } : undefined}>{showInspection(calculated.H47)}</td>
        <td colSpan={2} />
      </tr>
      <tr className={side ? "muted" : undefined}>
        <td>Converted Static Flow Rate in 60 seconds (cc/min)</td>
        <td colSpan={9}>{showInspection(calculated.B48)}</td>
      </tr>
      <tr className={side ? "muted" : undefined}>
        <td>Linear Deviation at 3ms PW</td>
        <td colSpan={6}>{showInspection(calculated.B49)}</td>
        <td style={inspectionFill(showInspection(calculated.H49)) ? { background: inspectionFill(showInspection(calculated.H49)) ?? undefined } : undefined}>{showInspection(calculated.H49)}</td>
        <td colSpan={2} />
      </tr>
      <tr className={side ? "muted" : undefined}>
        <td>Slope</td>
        <td colSpan={9}>{showInspection(calculated.B50)}</td>
      </tr>
      <tr className={side ? "muted" : undefined}>
        <td>Dynamic Flow Rate (ml)</td>
        <td colSpan={9}>{showInspection(calculated.B51)}</td>
      </tr>
      <tr className={side ? "muted" : undefined}>
        <td>Leakage Test Pressure (kPa)</td>
        <td colSpan={9}>
          <input aria-label="B52" value={text(cells.B52)} disabled={readOnly} onChange={(event) => onChange("B52", event.target.value)} />
        </td>
      </tr>
      <tr className={side ? "muted" : undefined}>
        <td>Seat Leakage Test (Drops / Min, cc/min)</td>
        <td>
          <input aria-label="B53" value={text(cells.B53)} disabled={readOnly} onChange={(event) => onChange("B53", parseNumber(event.target.value))} />
        </td>
        <td>{text(cells.D53) || "less than "}</td>
        <td>{showInspection(cells.E53 ?? calculated.E53)}</td>
        <td>{showInspection(calculated.F53)}</td>
        <td>
          <input aria-label="G53" value={text(cells.G53)} disabled={readOnly} onChange={(event) => onChange("G53", parseNumber(event.target.value))} />
        </td>
        <td style={inspectionFill(showInspection(calculated.H53)) ? { background: inspectionFill(showInspection(calculated.H53)) ?? undefined } : undefined}>{showInspection(calculated.H53)}</td>
        <td colSpan={3} />
      </tr>
      <tr>
        <td className="section" colSpan={10}>
          6.0 Evaluation
        </td>
      </tr>
      <ResultLine addr="B56" calculated={calculated} />
      <Disposition approved="C57" rejected="E57" deviation="H57" cells={cells} readOnly={readOnly} onChange={onChange} />
      <SignRow label="Authorized By (Signature):" value={signature ?? ""} certify={FUEL_INJECTOR_CERTIFY} disabled={readOnly} onSign={onSign} />
      <Notes addr="B59" label="Deviation/Rejection Notes:" cells={cells} readOnly={readOnly} onChange={onChange} />
      <tr>
        <td className="section" colSpan={10}>
          7.0 Furthur Review
        </td>
      </tr>
      <tr>
        <td className="note" colSpan={10}>
          ***This section is only used if a sample fails intital inspection, but is passed later after follow up from the factory (test method improvements, drawing update/correction, etc)***
        </td>
      </tr>
      <tr>
        <td>Pass/Fail</td>
        <td colSpan={9}>
          <input aria-label="B63" value={text(cells.B63)} disabled={readOnly} onChange={(event) => onChange("B63", event.target.value)} />
        </td>
      </tr>
      <Disposition approved="C64" rejected="E64" deviation="H64" cells={cells} readOnly={readOnly} onChange={onChange} />
      <SignRow label="Authorized By (Signature):" value={furtherSignature ?? ""} certify={FUEL_INJECTOR_FURTHER_CERTIFY} disabled={readOnly} onSign={onFurtherSign} />
      <Notes addr="B66" label="Approval Notes:" cells={cells} readOnly={readOnly} onChange={onChange} />
    </>
  );
}
