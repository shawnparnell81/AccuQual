import { Fragment } from "react";
import { DETAIL_SECTIONS, KPI_CATEGORIES, MONTHLY_TITLE, kpiScore } from "../../lib/monthlyEngineeringReport";
import type { CellValue } from "../../lib/isoFormLogic";
import "./isoForm.css";

interface MonthlyEngineeringSheetProps {
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  revision?: string;
}

function text(value: CellValue | undefined): string {
  return value === undefined || value === null || typeof value === "boolean" ? "" : String(value);
}

function Field({
  addr,
  label,
  cells,
  readOnly,
  onChange,
  area,
  kind,
}: {
  addr: string;
  label: string;
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  area?: boolean;
  kind?: "text" | "number" | "select";
}) {
  return (
    <tr>
      <td>{label}</td>
      <td colSpan={5}>
        {kind === "select" ? (
          <select aria-label={addr} value={text(cells[addr])} disabled={readOnly} onChange={(event) => onChange(addr, event.target.value)}>
            <option value="" />
            <option value="GREEN">GREEN</option>
            <option value="YELLOW">YELLOW</option>
            <option value="RED">RED</option>
          </select>
        ) : area ? (
          <textarea aria-label={addr} value={text(cells[addr])} disabled={readOnly} onChange={(event) => onChange(addr, event.target.value)} />
        ) : (
          <input aria-label={addr} value={text(cells[addr])} disabled={readOnly} onChange={(event) => onChange(addr, kind === "number" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value)} />
        )}
      </td>
    </tr>
  );
}

export function MonthlyEngineeringSheet({ cells, readOnly = false, onChange, revision = "A" }: MonthlyEngineeringSheetProps) {
  return (
    <table className="dense-log" data-testid="monthly-engineering-sheet" aria-label={MONTHLY_TITLE}>
      <tbody>
        <tr>
          <td className="title" colSpan={6}>
            {MONTHLY_TITLE}
          </td>
        </tr>
        <tr>
          <td colSpan={6}>{`Rev: ${revision}`}</td>
        </tr>
        <tr>
          <td className="section" colSpan={6}>
            1.0 ADMINISTRATIVE INFORMATION
          </td>
        </tr>
        <Field addr="period" label="Reporting Period" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="dept" label="Department" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="prep" label="Prepared By" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="review" label="Reviewed By" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="approve" label="Approved By" cells={cells} readOnly={readOnly} onChange={onChange} />
        <tr>
          <td className="section" colSpan={6}>
            2.0 SCOPE & DEFINITIONS
          </td>
        </tr>
        <tr>
          <td colSpan={6}>Full Development: Physical sample received, testing conducted on-site (or outsourced), and drawing approved.</td>
        </tr>
        <tr>
          <td colSpan={6}>Drawing Approval: Review of existing supplier technical drawings; no physical testing done.</td>
        </tr>
        <tr>
          <td colSpan={6}>Optimization: Re-engineering of a part for cost and performance.</td>
        </tr>
        <tr>
          <td colSpan={6}>Consolidation: Merging multiple part numbers into a single SKU.</td>
        </tr>
        <tr>
          <td className="section" colSpan={6}>
            3.0 EXECUTIVE SUMMARY (Management Review)
          </td>
        </tr>
        <Field addr="status" label="Overall Status" kind="select" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="achieve" label="Primary Achievement" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="risk" label="Critical Risk/Blocker" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <tr>
          <td className="section" colSpan={6}>
            4.0 KPI SUMMARY: DEVELOPMENT TARGETS
          </td>
        </tr>
        <tr>
          {["Product Category", "Yearly Target", "Full Dev Approved", "Drawings Approved", "Total Yearly Approved", "% of Goal"].map((heading) => (
            <th key={heading}>{heading}</th>
          ))}
        </tr>
        {KPI_CATEGORIES.map((name, index) => {
          const score = kpiScore(cells, index);
          return (
            <tr key={name}>
              <td>{name}</td>
              <td>
                <input aria-label={`k${index}t`} inputMode="decimal" value={text(cells[`k${index}t`])} disabled={readOnly} onChange={(event) => onChange(`k${index}t`, event.target.value === "" ? "" : Number(event.target.value))} />
              </td>
              <td>
                <input aria-label={`k${index}f`} inputMode="decimal" value={text(cells[`k${index}f`])} disabled={readOnly} onChange={(event) => onChange(`k${index}f`, event.target.value === "" ? "" : Number(event.target.value))} />
              </td>
              <td>
                <input aria-label={`k${index}d`} inputMode="decimal" value={text(cells[`k${index}d`])} disabled={readOnly} onChange={(event) => onChange(`k${index}d`, event.target.value === "" ? "" : Number(event.target.value))} />
              </td>
              <td>{score.total}</td>
              <td>{score.percent}</td>
            </tr>
          );
        })}
        <tr>
          <td className="section" colSpan={6}>
            4.1 DEVELOPMENT CHARTS
          </td>
        </tr>
        <tr>
          <td colSpan={6}>Charts of year-to-date development are attached with the saved record when a chart file is filed in the same folder.</td>
        </tr>
        <tr>
          <td className="section" colSpan={6}>
            5.0 DETAILED TECHNICAL REPORT
          </td>
        </tr>
        {DETAIL_SECTIONS.map((section) => (
          <Fragment key={section.title}>
            <tr>
              <td className="section" colSpan={6}>
                {section.title}
              </td>
            </tr>
            {section.fields.map((field) => (
              <Field key={field.key} addr={field.key} label={field.label} cells={cells} readOnly={readOnly} onChange={onChange} />
            ))}
          </Fragment>
        ))}
        <tr>
          <td className="section" colSpan={6}>
            6.0 QUALITY PERFORMANCE
          </td>
        </tr>
        <Field addr="qstat" label="Status of Department" kind="select" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qach" label="Primary Achievement" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qrisk" label="Critical Risk/Blocker" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qlabor" label="Total Labor Claims" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qalert" label="Total Product Alerts" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qreq" label="Total Amount Requested" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qparts" label="Parts Amount Requested" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qlabamt" label="Labor Amount Requested" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qclaims" label="Claim Numbers by Date" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qratio" label="Labor-to-Parts Ratio" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qmttf" label="Mean Time to Failure (MTTF)" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qmed" label="Median Time to Failure" cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qwarr" label="Warranty Performance" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qtop" label="Top 5 High-Volume Returning Part Numbers" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qrca" label="Vehicle-Specific Failure Mode" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qearly" label="Early Life Failure" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="qrec" label="Recommendation" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <tr>
          <td className="section" colSpan={6}>
            7.0 RESOURCE & RISK MANAGEMENT
          </td>
        </tr>
        <tr>
          <th>Issue Type</th>
          <th colSpan={2}>Description of Issue</th>
          <th>Impact</th>
          <th colSpan={2}>Mitigation Strategy</th>
        </tr>
        {[
          ["r1", "Supplier"],
          ["r2", "Equipment"],
          ["r3", "Process"],
        ].map(([key, label]) => (
          <tr key={key}>
            <td>{label}</td>
            <td colSpan={2}>
              <input aria-label={`${key}d`} value={text(cells[`${key}d`])} disabled={readOnly} onChange={(event) => onChange(`${key}d`, event.target.value)} />
            </td>
            <td>
              <input aria-label={`${key}i`} value={text(cells[`${key}i`])} disabled={readOnly} onChange={(event) => onChange(`${key}i`, event.target.value)} />
            </td>
            <td colSpan={2}>
              <input aria-label={`${key}m`} value={text(cells[`${key}m`])} disabled={readOnly} onChange={(event) => onChange(`${key}m`, event.target.value)} />
            </td>
          </tr>
        ))}
        <tr>
          <td className="section" colSpan={6}>
            8.0 FORWARD PLANNING
          </td>
        </tr>
        <Field addr="forecast" label="Next Month's Validated Forecast" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <Field addr="needs" label="Resource Needs" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <tr>
          <td className="section" colSpan={6}>
            9.0 HR & TEAM DEVELOPMENT
          </td>
        </tr>
        <Field addr="team" label="Team Highlights" area cells={cells} readOnly={readOnly} onChange={onChange} />
        <tr>
          <td className="section" colSpan={6}>
            10.0 SUPPLIER ENGINEERING ACTIVITY
          </td>
        </tr>
        {["Joinhands", "SENSEN / SDI", "Linyi", "XJ/XDI", "Jinbo", "GACI", "Taizan", "Aborn", "Zoren"].map((name, index) => (
          <Field key={name} addr={`s${index}`} label={name} area cells={cells} readOnly={readOnly} onChange={onChange} />
        ))}
      </tbody>
    </table>
  );
}
