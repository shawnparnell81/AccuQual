import { CROSS_CRITERIA, crossTrainingScores, showCell, type CellValue } from "../../lib/isoFormLogic";
import "./isoForm.css";

const SCORES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

interface CrossTrainingSheetProps {
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
}

function field(addr: string, label: string, cells: Record<string, CellValue>, readOnly: boolean, onChange: (addr: string, value: CellValue) => void, type: "text" | "date" = "text") {
  const value = cells[addr];
  const inputValue = value == null || typeof value === "boolean" ? "" : String(value);
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      <input className="rounded-md border border-border bg-transparent px-2 py-1" type={type} aria-label={addr} value={inputValue} disabled={readOnly} onChange={(event) => onChange(addr, event.target.value)} />
    </label>
  );
}

export function CrossTrainingSheet({ cells, readOnly = false, onChange }: CrossTrainingSheetProps) {
  const scores = crossTrainingScores(cells);
  const sections = [
    { id: "A", title: "SECTION A: TECHNICAL CONTENT & PRODUCT KNOWLEDGE (50% of Total)", note: "Evaluates the depth, accuracy, and completeness of the engineering data presented.", addrs: ["S1", "S2", "S3"], max: 50 },
    { id: "B", title: "SECTION B: QMS & STANDARDS INTEGRATION (20% of Total)", note: "Evaluates how well the engineer connects their product knowledge to official company documents.", addrs: ["S4"], max: 20 },
    { id: "C", title: "SECTION C: Q&A AND TECHNICAL DEFENSE (20% of Total)", note: "Evaluates the engineer's ability to think on their feet and handle scrutiny.", addrs: ["S5"], max: 20 },
    { id: "D", title: "SECTION D: PRESENTATION SKILLS (10% of Total)", note: "Evaluates delivery, visual aids, and audience engagement.", addrs: ["S6"], max: 10 },
  ];

  return (
    <div className="rubric" data-testid="cross-training-sheet">
      <h2>GRADING RUBRIC: CROSS-TRAINING EVALUATION</h2>
      <p className="text-center text-sm text-muted-foreground">Doc ID: FRM-TRN-002 · Rev A · 3/19/2026 · Authorized by Maxwell Tollefson</p>

      <section>
        <h3>1.0 PURPOSE</h3>
        <p className="text-sm">The purpose of this form is to provide a standardized, quantifiable metric for evaluating internal cross-training presentations delivered by Engineering staff. It serves as objective evidence of an employee's technical competency and communication capability for their permanent personnel training file.</p>
      </section>
      <section>
        <h3>2.0 SCOPE</h3>
        <p className="text-sm">This rubric applies to all formal cross-training sessions where an engineer instructs cross-functional team members (other engineers, lab technicians, and QC inspectors) on their specific product line.</p>
      </section>
      <section>
        <h3>3.0 RESPONSIBILITIES</h3>
        <p className="text-sm"><strong>Quality/Engineering Manager:</strong> Responsible for evaluating the presenter, calculating the final score, and filing the completed document in the employee's personnel folder.</p>
        <p className="text-sm"><strong>Presenting Engineer:</strong> Responsible for developing and delivering comprehensive technical content that bridges engineering theory with practical lab/shop floor applications.</p>
      </section>

      <h3>4.0 PROCEDURE (EVALUATION RUBRIC)</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("PN", "Presenter Name", cells, readOnly, onChange)}
        {field("PT", "Product Line / Topic", cells, readOnly, onChange)}
        {field("PD", "Date of Presentation", cells, readOnly, onChange, "date")}
        {field("EN", "Evaluator Name", cells, readOnly, onChange)}
      </div>

      <div className="scale rounded-md border border-border p-3">
        <p className="font-semibold">SCORING SCALE (1 - 10)</p>
        <p>Rate each criterion on a scale of 1 to 10. The base score is multiplied by the weight to calculate the section score.</p>
        <p>1 - 2: Unacceptable / Missing Information</p>
        <p>3 - 4: Needs Improvement / Superficial Understanding</p>
        <p>5 - 6: Satisfactory / Meets Basic Requirements</p>
        <p>7 - 8: Very Good / Strong Technical Grasp</p>
        <p>9 - 10: Exceptional / Master-Level Understanding</p>
      </div>

      {sections.map((section) => (
        <section key={section.id} className="flex flex-col gap-2">
          <h3 className="rounded-md px-2 py-1" style={{ background: "var(--form-bar)", color: "var(--form-bar-foreground)" }}>{section.title}</h3>
          <p className="text-sm">{section.note}</p>
          <div className="overflow-x-auto">
            <table className="iso" aria-label={section.title}>
              <thead>
                <tr>
                  <th className="header">Criterion</th>
                  <th className="header">Base Score (1-10)</th>
                  <th className="header">Multiplier</th>
                  <th className="header">Section Score</th>
                </tr>
              </thead>
              <tbody>
                {section.addrs.map((addr) => {
                  const item = CROSS_CRITERIA.find((row) => row.addr === addr)!;
                  const value = cells[addr];
                  const inputValue = value == null || typeof value === "boolean" ? "" : String(value);
                  return (
                    <tr key={addr}>
                      <td className="left">{item.text}</td>
                      <td>
                        <select className="iso-in" aria-label={addr} value={inputValue} disabled={readOnly} onChange={(event) => onChange(addr, event.target.value === "" ? "" : Number(event.target.value))}>
                          <option value="" />
                          {SCORES.map((score) => (
                            <option key={score} value={score}>{score}</option>
                          ))}
                        </select>
                      </td>
                      <td className="center">x {item.weight}</td>
                      <td className="center" data-result={addr}>{showCell(scores.lines[addr])} / {item.max}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="left font-semibold">SECTION {section.id} TOTAL:</td>
                  <td />
                  <td />
                  <td className="center font-semibold" data-result={`section-${section.id}`}>{showCell(scores.sections[section.id])} / {section.max}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <p className="text-base font-semibold" data-testid="cross-training-total">
        Total Combined Score (A + B + C + D): {showCell(scores.total)} / 100 Points
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">Evaluator Comments / Areas for Improvement</span>
        <textarea className="min-h-24 rounded-md border border-border bg-transparent px-2 py-1" aria-label="CM" value={typeof cells.CM === "string" ? cells.CM : ""} disabled={readOnly} onChange={(event) => onChange("CM", event.target.value)} />
      </label>

      <h3>Signatures</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("EV", "Evaluator Signature", cells, readOnly, onChange)}
        {field("EVD", "Evaluator Date", cells, readOnly, onChange, "date")}
        {field("PR", "Presenter Signature", cells, readOnly, onChange)}
        {field("PRD", "Presenter Date", cells, readOnly, onChange, "date")}
      </div>

      <section className="text-sm">
        <h3>5.0 RELATED DOCUMENTS</h3>
        <p>PRO-GEN-001: Preparation and Control of Documents</p>
        <p>ISO/IEC 17025:2017: Personnel Training and Competence Records</p>
        <p>Employee Personnel Folder</p>
      </section>
      <section className="text-sm">
        <h3>6.0 REVISION HISTORY</h3>
        <p>Rev A · 3/19/2026 · Initial Release · Maxwell Tollefson</p>
      </section>
    </div>
  );
}
