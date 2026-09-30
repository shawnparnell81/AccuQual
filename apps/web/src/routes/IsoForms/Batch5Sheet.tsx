import { Fragment, useMemo } from "react";
import {
  BATCH5_EFFECTIVE,
  BATCH5_PURPOSE,
  BATCH5_REV,
  BATCH5_SHEET_TITLE,
  evaluateBatch5,
  injectorDeviationFill,
  showBatch5,
  type Batch5Kind,
} from "../../lib/batch5Reports";
import type { CellValue } from "../../lib/isoFormLogic";
import "../ValidationReports/validationReport.css";

interface Batch5SheetProps {
  variant: Batch5Kind;
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber?: string;
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

type SheetProps = Batch5SheetProps & { calculated: Record<string, CellValue>; cols: number };

function Field(props: SheetProps & { addr: string; kind?: "text" | "number" | "date" | "area" }) {
  const value = text(props.cells[props.addr]);
  if (props.kind === "area") {
    return <textarea aria-label={props.addr} value={value} disabled={props.readOnly} onChange={(event) => props.onChange(props.addr, event.target.value)} />;
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

function Calc(props: { value: CellValue | undefined; fill?: string | null }) {
  return (
    <td style={props.fill ? { background: props.fill, color: "#111", fontWeight: 700 } : undefined}>
      {showBatch5(props.value)}
    </td>
  );
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

function Pair(props: SheetProps & { left: string; leftAddr: string; right: string; rightAddr: string; numeric?: boolean; date?: boolean }) {
  return (
    <tr>
      <td>{props.left}</td>
      <td>
        <Field {...props} addr={props.leftAddr} kind={props.numeric ? "number" : undefined} />
      </td>
      <td>{props.right}</td>
      <td colSpan={props.cols - 3}>
        <Field {...props} addr={props.rightAddr} kind={props.date ? "date" : undefined} />
      </td>
    </tr>
  );
}

function Line(props: SheetProps & { label: string; addr: string; note?: string; numeric?: boolean; area?: boolean }) {
  return (
    <tr>
      <td>{props.label}</td>
      <td>
        <Field {...props} addr={props.addr} kind={props.area ? "area" : props.numeric ? "number" : "text"} />
      </td>
      <td colSpan={props.cols - 2}>{props.note ?? ""}</td>
    </tr>
  );
}

function Research(props: SheetProps & { heading: string; start: number; application: number; notes: number; extra?: Array<[string, number]> }) {
  return (
    <>
      <Section cols={props.cols}>{props.heading}</Section>
      <tr>
        <td>Differences to OE:</td>
        <td colSpan={props.cols - 1}>
          <Field {...props} addr={`B${props.start}`} kind="area" />
        </td>
      </tr>
      {(props.extra ?? []).map(([label, row]) => (
        <tr key={label}>
          <td>{label}</td>
          <td colSpan={props.cols - 1}>
            <Field {...props} addr={`B${row}`} kind="area" />
          </td>
        </tr>
      ))}
      <tr>
        <td>Application Research:</td>
        <td colSpan={props.cols - 1}>
          <Field {...props} addr={`B${props.application}`} kind="area" />
        </td>
      </tr>
      <tr>
        <td className="section" colSpan={props.cols}>
          Notes
        </td>
      </tr>
      <tr>
        <td colSpan={props.cols}>
          <Field {...props} addr={`A${props.notes}`} kind="area" />
        </td>
      </tr>
    </>
  );
}

function Dyno(props: SheetProps) {
  const states = [32, 34, 36, 38];
  return (
    <>
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
          <tr key={`r${row}`}>
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
    </>
  );
}

function Hardware(props: SheetProps & { rows: number[] }) {
  return (
    <>
      <tr>
        <td>Location</td>
        <td>Thread Size</td>
        <td>Nut Style</td>
        <td colSpan={props.cols - 3}>Description of Location</td>
      </tr>
      {props.rows.map((row, index) => (
        <tr key={row}>
          <td>
            Location {index + 1}: <Field {...props} addr={`A${row}`} />
          </td>
          <td>
            <Field {...props} addr={`B${row}`} />
          </td>
          <td>
            <Field {...props} addr={`C${row}`} />
          </td>
          <td colSpan={props.cols - 3}>
            <Field {...props} addr={`D${row}`} />
          </td>
        </tr>
      ))}
    </>
  );
}

export function Batch5Sheet(props: Batch5SheetProps) {
  const calculated = useMemo(() => evaluateBatch5(props.variant, props.cells), [props.cells, props.variant]);
  const cols = props.variant === "dev_air_strut" || props.variant === "dev_electronic_shock" ? 7 : props.variant === "dev_fuel_injector" ? 5 : 4;
  const doc = props.documentNumber?.trim() ? `Doc ID: ${props.documentNumber.trim()}` : "Doc ID:";
  const shared = { ...props, calculated, cols };
  return (
    <div className="fp-wrap">
      <table className="insp" data-testid={`${props.variant}-sheet`} aria-label={BATCH5_SHEET_TITLE[props.variant]}>
        <tbody>
          <tr>
            <td className="title" colSpan={cols}>
              {BATCH5_SHEET_TITLE[props.variant]}
            </td>
          </tr>
          <tr>
            <td>{doc}</td>
            <td>{`Rev: ${BATCH5_REV[props.variant]}`}</td>
            <td>{`Effective Date: ${BATCH5_EFFECTIVE[props.variant]}`}</td>
            {props.variant === "dev_brake_wear" ? (
              <td />
            ) : (
              <td colSpan={cols - 3}>
                Approved By: <Field {...shared} addr={props.variant === "dev_air_strut" ? "F2" : props.variant === "dev_electronic_shock" ? "E2" : "D2"} />
              </td>
            )}
          </tr>
          <tr>
            <td className="note" colSpan={cols}>
              {BATCH5_PURPOSE[props.variant]}
            </td>
          </tr>
          {props.variant === "dev_air_compressor" && <Compressor {...shared} />}
          {props.variant === "dev_fuel_injector" && <Injector {...shared} />}
          {props.variant === "dev_electric_lift" && <Lift {...shared} />}
          {props.variant === "dev_air_strut" && <AirStrut {...shared} />}
          {props.variant === "dev_brake_wear" && <Brake {...shared} />}
          {props.variant === "dev_electronic_shock" && <Shock {...shared} />}
        </tbody>
      </table>
    </div>
  );
}

function Project(props: SheetProps & { vehicle?: boolean; tested: string; dateAddr: string }) {
  return (
    <>
      <Section cols={props.cols}>1.0 PROJECT & VEHICLE INFORMATION</Section>
      <Pair {...props} left="Sample Part Number:" leftAddr="B6" right="Application:" rightAddr="C6" />
      <Pair {...props} left="Brand Tested (OE/Competitor):" leftAddr="B7" right="Condition (New/Used):" rightAddr="C7" />
      {props.vehicle && (
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
          <td colSpan={props.cols - 5}>
            <Field {...props} addr="F8" kind="number" />
          </td>
        </tr>
      )}
      <Pair {...props} left="Tested By:" leftAddr={props.tested} right="Date:" rightAddr={props.dateAddr} date />
    </>
  );
}

function Compressor(props: SheetProps) {
  return (
    <>
      <Project {...props} tested="B8" dateAddr="C8" />
      <Section cols={props.cols}>2.0 PHYSICAL DIMENSIONS & FITMENT</Section>
      <tr>
        <td>Criteria</td>
        <td>Value</td>
        <td colSpan={2}>Notes</td>
      </tr>
      <Line {...props} label="Overall Dimensions (L x W x H) (mm):" addr="B12" />
      <Line {...props} label="Mounting Hole Spacing (mm):" addr="B13" note="Measure Center-to-Center" numeric />
      <Line {...props} label="Mounting Bushing Hardness (Shore A):" addr="B14" note="Use Durometer [DMA-048]" numeric />
      <Line {...props} label="Air Outlet Port Thread Size:" addr="B15" />
      <Line {...props} label="Air Inlet / Intake Port Size:" addr="B16" />
      <Section cols={props.cols}>3.0 ELECTRICAL & SENSORS</Section>
      <Line {...props} label="Motor DC Resistance (Ohms):" addr="B20" numeric />
      <Line {...props} label="Thermal Sensor Resistance (Ohms):" addr="B21" note="If equipped" numeric />
      <Line {...props} label="Pinout Diagram:" addr="B22" />
      <Section cols={props.cols}>4.0 PERFORMANCE & PNEUMATIC TESTING</Section>
      <Line {...props} label="Test Voltage (VDC):" addr="B26" note="Measured at the pump terminals" />
      <Line {...props} label="1st Test - 0 to 100 PSI Fill Time (Seconds):" addr="B27" note="Using 0.5-Gal Tank" numeric />
      <Line {...props} label="2nd Test - 0 to 100 PSI Fill Time (Seconds):" addr="B28" note="Using 0.5-Gal Tank" numeric />
      <Line {...props} label="3rd Test - 0 to 100 PSI Fill Time (Seconds):" addr="B29" note="Using 0.5-Gal Tank" numeric />
      <tr>
        <td>Average - 0 to 100 PSI Fill Time (Seconds):</td>
        <Calc value={props.calculated.B30} />
        <td colSpan={2}>Using 0.5-Gal Tank</td>
      </tr>
      <tr>
        <td>Dynamic Flow Rate (CFM):</td>
        <Calc value={props.calculated.B31} />
        <td colSpan={2}>(P / 14.7) * (R / 7.48) / t * 60</td>
      </tr>
      <Line {...props} label="Peak Amperage (Amps):" addr="B32" note="During 0-100 PSI sweep" numeric />
      <Line {...props} label="Max Deadhead / Shutoff Pressure (PSI):" addr="B33" note="Industry Std: Max pump output" numeric />
      <Line {...props} label="Leak Down Test (PSI drop):" addr="B34" note="Pressure drop over 5 mins @ 100 PSI" numeric />
      <Line {...props} label="Db Noise Level (Average dB):" addr="B35" note="Measured at 3ft isolated on foam" numeric />
      <Section cols={props.cols}>5.0 AIR DRYER & DESICCANT (IF EQUIPPED)</Section>
      <Line {...props} label="Desiccant Bead Weight (grams):" addr="B39" numeric />
      <Line {...props} label="Desiccant Bead Type/Color:" addr="B40" />
      <Line {...props} label="Spring Free Length inside Dryer (mm):" addr="B41" numeric />
      <Section cols={props.cols}>6.0 WEIGHTS & PACKAGING</Section>
      <Line {...props} label="Air Compressor Weight (lbs):" addr="B45" numeric />
      <Line {...props} label="Hardware / Isolator Weight (oz):" addr="B46" numeric />
      <Line {...props} label="Total Package Weight (lbs):" addr="B47" numeric />
      <Line {...props} label="Box Size (H x W x L) (mm):" addr="B48" />
      <Line {...props} label="Foam Insert Construction:" addr="B49" />
      <Research {...props} heading="7.0 VISUAL & ENGINEERING RESEARCH" start={52} application={55} notes={57} extra={[["Major Issues with OEM (e.g., burnt motor, saturated dryer):", 53], ["DMA Solutions:", 54]]} />
    </>
  );
}

function Injector(props: SheetProps) {
  const pulses = [
    ["Volume (ml) in 1min at High Speed Setting 3ms PW", 30, 6000],
    ["Volume (ml) in 1min at High Speed Setting 4ms PW", 31, 6000],
    ["Volume (ml) in 30sec at Medium Speed Setting 5ms PW", 32, 3000],
    ["Volume (ml) in 30sec at Medium Speed Setting 6ms PW", 33, 3000],
    ["Volume (ml) in 30sec at Medium Speed Setting 7ms PW", 34, 3000],
  ] as const;
  return (
    <>
      <Project {...props} tested="B8" dateAddr="C8" />
      <Section cols={props.cols}>2.0 PHYSICAL DIMENSIONS & VISUAL INSPECTION</Section>
      <Line {...props} label="Feed Type (Top Feed / Bottom Feed) (SAE J1832 Appendix A.1, A.2):" addr="B12" />
      <Line {...props} label="Overall Length (mm):" addr="B13" note="Use Calipers [DMA-009]" numeric />
      <Line {...props} label="Quantity of O-Rings" addr="B14" numeric />
      <Line {...props} label="O-Ring Color(s)" addr="B15" />
      <Line {...props} label="O-Ring to O-Ring Length (mm):" addr="B16" note="Use Calipers [DMA-009]" numeric />
      <Line {...props} label="Number of Spray Holes (SAE J1832 Appendix A.1):" addr="B17" numeric />
      <Line {...props} label="Connector Type / Keyway Position (SAE J1832 Section 5.8.1):" addr="B18" />
      <Section cols={props.cols}>3.0 ELECTRICAL SPECIFICATIONS</Section>
      <Line {...props} label="Coil Resistance (Ohms) (SAE J1832 Section 4.1.18):" addr="B22" note="Measured via LCR [DMA-027] at 21°C" numeric />
      <Line {...props} label="Coil Inductance @ 1kHz (mH) (SAE J1832 Section 4.1.19):" addr="B23" note="Measured via LCR [DMA-027] at 21°C" numeric />
      <Section cols={props.cols}>4.0 FLOW & PERFORMANCE TESTING (BASIC BENCH + ADVANCED DRIVER)</Section>
      <Line {...props} label="Test Fluid Used (e.g. Diesel) (SAE J1832 Section 3.1, Appendix A.4):" addr="B26" />
      <Line {...props} label="Test Pressure (kPa):" addr="B27" numeric />
      <Line {...props} label="Test Voltage (VDC) (SAE J1832 Section 3.7):" addr="B28" />
      <Line {...props} label="Driver Type Used (SAE J1832 Section 5.1.1 & 5.1.2):" addr="B29" />
      <tr>
        <td>Pulse width</td>
        <td>Volume (ml)</td>
        <td>Converted</td>
        <td>TREND</td>
        <td>ms</td>
      </tr>
      {pulses.map(([label, row, divisor]) => (
        <tr key={row}>
          <td>{label}</td>
          <td>
            <Field {...props} addr={`B${row}`} kind="number" />
          </td>
          <Calc value={props.calculated[`C${row}`]} />
          <Calc value={props.calculated[`D${row}`]} />
          <td>{`÷ ${divisor}`}</td>
        </tr>
      ))}
      <Line {...props} label="Raw Static Flow Rate in 30 seconds - Qs (ml) (SAE J1832 Section 4.1.3):" addr="B36" note="Injector held 100% open" numeric />
      <tr>
        <td>Converted Static Flow Rate in 60 seconds - Qs (cc/min):</td>
        <Calc value={props.calculated.B37} />
        <td colSpan={3}>Injector held 100% open</td>
      </tr>
      <tr>
        <td>Linear Deviation at 3ms PW</td>
        <Calc value={props.calculated.B38} fill={injectorDeviationFill(props.calculated.B38)} />
        <td colSpan={3}>Per SAE needs to be less than 5%</td>
      </tr>
      <tr>
        <td>Slope</td>
        <Calc value={props.calculated.B39} />
        <td colSpan={3}>SLOPE of converted volume vs pulse width</td>
      </tr>
      <tr>
        <td>Estimated Static Flow Rate based on Dynamic</td>
        <Calc value={props.calculated.B40} />
        <td colSpan={3}>Slope × 1000 × 60</td>
      </tr>
      <Line {...props} label="Seat Leakage Test (Drops / Min) (SAE J1832 Section 4.1.22.a & 4.1.22.2):" addr="B41" note="Tested at 400 kPa with valve closed" numeric />
      <Section cols={props.cols}>5.0 SPRAY PATTERN (VISUAL ASSESSMENT)</Section>
      <Line {...props} label="Spray Type Description (SAE J1832 Section 4.1.21):" addr="B45" note="Single Pencil, Solid Cone, Hollow Cone, Dual Stream" />
      <Line {...props} label="Spray Angle / Targeting Notes:" addr="B46" />
      <Line {...props} label="Spray Atomization Quality (SAE J1832 Section 4.1.21):" addr="B47" />
      <Research {...props} heading="6.0 VISUAL & ENGINEERING RESEARCH" start={50} application={53} notes={55} extra={[["Research / OEM Flaws:", 51], ["DMA Solutions:", 52]]} />
    </>
  );
}

function Lift(props: SheetProps) {
  return (
    <>
      <Project {...props} tested="B8" dateAddr="C8" />
      <Section cols={props.cols}>2.0 PHYSICAL DIMENSIONS & HARDWARE</Section>
      <Line {...props} label="Extended Length (mm):" addr="B12" note="Measured from middle of both end connectors" numeric />
      <Line {...props} label="Compressed Length (mm):" addr="B13" note="Measured from middle of both end connectors" numeric />
      <Line {...props} label="Stroke Length (mm):" addr="B14" note="Calculate from Extended and Compressed Lengths" numeric />
      <Line {...props} label="Tube Outer Diameter (mm):" addr="B15" numeric />
      <Line {...props} label="Shaft Connector Style:" addr="B16" />
      <Line {...props} label="Body Connector Style:" addr="B17" />
      <Line {...props} label="Wire Length (mm):" addr="B18" numeric />
      <Line {...props} label="Grommet Style:" addr="B19" />
      <Line {...props} label="Weight (lbs):" addr="B20" numeric />
      <Section cols={props.cols}>3.0 ELECTRICAL & MOTOR SPECIFICATIONS (LOCKED ROTOR)</Section>
      <Line {...props} label="Motor DC Resistance (Ohms):" addr="B24" note="Measured via DCR Mode [DMA-027]" numeric />
      <Line {...props} label="Motor Inductance @ 1kHz (mH):" addr="B25" note="Measured via Ls Mode [DMA-027]" numeric />
      <Line {...props} label="Motor Impedance @ 1kHz (Ohms):" addr="B26" note="Measured via Z Mode [DMA-027]" numeric />
      <Line {...props} label="Motor Test - Volts (VDC):" addr="B27" />
      <Line {...props} label="Motor Test - Amps (A):" addr="B28" note="Peak amps during push force test" numeric />
      <Line {...props} label="Peak Locked Rotor Push Force (N):" addr="B29" numeric />
      <Line {...props} label="Pinout / Wiring Diagram:" addr="B30" />
      <Section cols={props.cols}>4.0 HALL SENSOR SPECIFICATIONS</Section>
      <Line {...props} label="Hall Sensor 1 Test Voltage (VDC):" addr="B34" />
      <Line {...props} label="Hall Sensor 1 Pulse Reading (hz):" addr="B35" note="Measured in Hertz on Spring Rater Compression" numeric />
      <Line {...props} label="Hall Sensor 2 Test Voltage (VDC):" addr="B36" />
      <Line {...props} label="Hall Sensor 2 Pulse Reading (hz):" addr="B37" note="Measured in Hertz on Spring Rater Compression" numeric />
      <Section cols={props.cols}>5.0 MECHANICAL FORCE</Section>
      <Line {...props} label="F3 Force (N):" addr="B41" note="Force at 10mm compressed on compression stroke" numeric />
      <Line {...props} label="F4 Force (N):" addr="B42" note="Force at 10mm from fully compressed on compression stroke" numeric />
      <Line {...props} label="Fr Force (N):" addr="B43" note="Calculated from the middle of the stroke compression - rebound" numeric />
      <tr>
        <td>Spring Rate (N/mm):</td>
        <Calc value={props.calculated.B44} />
        <td colSpan={2}>(F4 − F3) / (Stroke − 20)</td>
      </tr>
      <Line {...props} label="Force Graph:" addr="B45" />
      <Research {...props} heading="6.0 VISUAL & ENGINEERING RESEARCH" start={48} application={51} notes={53} extra={[["Research / OEM Flaws:", 49], ["DMA Solutions:", 50]]} />
    </>
  );
}

function AirStrut(props: SheetProps) {
  return (
    <>
      <Project {...props} vehicle tested="B9" dateAddr="C9" />
      <Section cols={props.cols}>2.0 PHYSICAL DIMENSIONS & CONSTRUCTION</Section>
      <Line {...props} label="Overall Length of Air Strut (mm):" addr="B13" numeric />
      <Line {...props} label="Stroke Length (mm):" addr="B14" numeric />
      <Line {...props} label="Bump Stop Length (mm):" addr="B15" numeric />
      <Line {...props} label="Top Mounting Type:" addr="B16" />
      <Line {...props} label="Bottom Mounting Type:" addr="B17" />
      <Line {...props} label="Top Air Bag Construction:" addr="B18" />
      <Line {...props} label="Bottom Air Bag Construction:" addr="B19" />
      <Line {...props} label="Paint Thickness (microns):" addr="B20" numeric />
      <Section cols={props.cols}>3.0 PNEUMATIC SPRING RATE & FORCE</Section>
      <tr>
        <td>Criteria</td>
        <td>Force (N)</td>
        <td>Spring Rate (N/mm)</td>
        <td colSpan={4}>Notes</td>
      </tr>
      <tr>
        <td>At 20 PSI:</td>
        <td>
          <Field {...props} addr="B24" kind="number" />
        </td>
        <td>
          <Field {...props} addr="C24" kind="number" />
        </td>
        <td colSpan={4} />
      </tr>
      <tr>
        <td>At 40 PSI:</td>
        <td>
          <Field {...props} addr="B25" kind="number" />
        </td>
        <td>
          <Field {...props} addr="C25" kind="number" />
        </td>
        <td colSpan={4} />
      </tr>
      <tr>
        <td>Ride Height Target Force (N):</td>
        <Calc value={props.calculated.B26} />
        <td colSpan={5}>Vehicle Weight × Weight Distribution / 2 / Motion Ratio × 4.45 / 100</td>
      </tr>
      <tr>
        <td>Calculated Ride Height PSI:</td>
        <Calc value={props.calculated.B27} />
        <td colSpan={5}>(Target − Force@20) / ((Force@40 − Force@20) / 20) + 20</td>
      </tr>
      <tr>
        <td>Calculated Ride Height PSI Spring Rate (N/mm):</td>
        <Calc value={props.calculated.B28} />
        <td colSpan={5}>((PSI − 20) × ((Rate@40 − Rate@20) / 20)) + Rate@20</td>
      </tr>
      <Section cols={props.cols}>4.0 DAMPING FORCE TEST (CTW DYNO / JASO C602)</Section>
      <Dyno {...props} />
      <Section cols={props.cols}>5.0 ELECTRONICS & HARDWARE</Section>
      <Line {...props} label="Resistance of Electronics (Ohms):" addr="B42" note="If equipped" numeric />
      <Line {...props} label="Inductance of Electronics @ 1kHz (mH):" addr="B43" note="If equipped" numeric />
      <Line {...props} label="Impedance of Electronics @ 1kHz (Ohms):" addr="B44" note="If equipped" numeric />
      <Line {...props} label="Hardware Kit Contents:" addr="B45" />
      <Hardware {...props} rows={[47, 48, 49]} />
      <Section cols={props.cols}>6.0 WEIGHTS & PACKAGING</Section>
      <Line {...props} label="Airbag Weight (lbs):" addr="B53" numeric />
      <Line {...props} label="Strut Body Weight (lbs):" addr="B54" numeric />
      <Line {...props} label="Hardware Weight (oz):" addr="B55" numeric />
      <Line {...props} label="Total Package Weight (lbs):" addr="B56" numeric />
      <Line {...props} label="Box Size (H x W x L) (mm):" addr="B57" />
      <Line {...props} label="Foam Insert Construction:" addr="B58" />
      <Research {...props} heading="7.0 VISUAL & ENGINEERING RESEARCH" start={61} application={64} notes={66} extra={[["Major Issues with OEM:", 62], ["DMA Solutions:", 63]]} />
    </>
  );
}

function Brake(props: SheetProps) {
  return (
    <>
      <Project {...props} tested="B8" dateAddr="C8" />
      <Section cols={props.cols}>2.0 PHYSICAL DIMENSIONS</Section>
      <Line {...props} label="Extended Length (mm):" addr="B12" numeric />
      <Line {...props} label="Connector Picture/Diagram:" addr="B13" />
      <Line {...props} label="Picture / Diagram:" addr="B14" />
      <Section cols={props.cols}>3.0 ELECTRICAL & CONNECTOR SPECIFICATIONS</Section>
      <Line {...props} label="Resistance / Continuity (Ohms):" addr="B18" numeric />
      <Line {...props} label="Connector Style / Pin Count:" addr="B19" />
      <Line {...props} label="Wire Sheathing / Insulation Type:" addr="B20" />
      <Section cols={props.cols}>4.0 VISUAL & ENGINEERING RESEARCH</Section>
      <tr>
        <td>Differences to OE:</td>
        <td colSpan={3}>
          <Field {...props} addr="B23" kind="area" />
        </td>
      </tr>
      <tr>
        <td>Notes:</td>
        <td colSpan={3}>
          <Field {...props} addr="B24" kind="area" />
        </td>
      </tr>
      <tr>
        <td>Major Issues with OEM:</td>
        <td colSpan={3}>
          <Field {...props} addr="B25" kind="area" />
        </td>
      </tr>
      <tr>
        <td>DMA Solutions:</td>
        <td colSpan={3}>
          <Field {...props} addr="B26" kind="area" />
        </td>
      </tr>
      <tr>
        <td>Application Research:</td>
        <td colSpan={3}>
          <Field {...props} addr="B27" kind="area" />
        </td>
      </tr>
      <tr>
        <td colSpan={4}>
          <Field {...props} addr="A29" kind="area" />
        </td>
      </tr>
    </>
  );
}

function Shock(props: SheetProps) {
  return (
    <>
      <Project {...props} vehicle tested="B9" dateAddr="C9" />
      <Section cols={props.cols}>2.0 PHYSICAL DIMENSIONS & CONSTRUCTION</Section>
      <Line {...props} label="Extended Length (mm):" addr="B13" numeric />
      <Line {...props} label="Compressed Length (mm):" addr="B14" numeric />
      <Line {...props} label="Stroke Length (mm):" addr="B15" numeric />
      <Line {...props} label="Bump Stop Length (mm):" addr="B16" numeric />
      <Line {...props} label="Top Mounting Type:" addr="B17" />
      <Line {...props} label="Bottom Mounting Type:" addr="B18" />
      <Line {...props} label="Dust Boot Included (Y/N):" addr="B19" />
      <Line {...props} label="Paint Thickness (microns):" addr="B20" numeric />
      <Section cols={props.cols}>3.0 ELECTRONICS & SOLENOID SPECIFICATIONS</Section>
      <Line {...props} label="Coil DC Resistance (Ohms):" addr="B24" note="Measured via DCR mode" numeric />
      <Line {...props} label="Coil Inductance @ 1kHz (mH):" addr="B25" note="Measured via Ls mode" numeric />
      <Line {...props} label="Coil Impedance @ 1kHz (Ohms):" addr="B26" note="Measured via Z mode" numeric />
      <Line {...props} label="Connector Style / Pin Count:" addr="B27" />
      <Line {...props} label="Wire Routing / Bracket Notes:" addr="B28" />
      <Section cols={props.cols}>4.0 ACTIVE DAMPING FORCE TEST (CTW DYNO / JASO C602)</Section>
      <Dyno {...props} />
      <Section cols={props.cols}>5.0 HARDWARE & FASTENERS</Section>
      <Line {...props} label="Hardware Kit Contents:" addr="B42" />
      <Hardware {...props} rows={[44, 45, 46]} />
      <Section cols={props.cols}>6.0 WEIGHTS & PACKAGING</Section>
      <Line {...props} label="Shock Absorber Weight (lbs):" addr="B50" numeric />
      <Line {...props} label="Hardware Weight (oz):" addr="B51" numeric />
      <Line {...props} label="Total Package Weight (lbs):" addr="B52" numeric />
      <Line {...props} label="Box Size (H x W x L) (mm):" addr="B53" />
      <Line {...props} label="Foam Insert Construction:" addr="B54" />
      <Research {...props} heading="7.0 VISUAL & ENGINEERING RESEARCH" start={57} application={60} notes={62} extra={[["Major Issues with OEM:", 58], ["DMA Solutions:", 59]]} />
    </>
  );
}
