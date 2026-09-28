import { useMemo, useState } from "react";
import { Blank8DSheet } from "./Blank8DSheet";
import type { Blank8DValues } from "../../lib/blank8d";
import {
  GIVEN_ROWS,
  PLAN_ROWS,
  PROBLEM_DESCRIPTION_ROWS,
  RISK_GIVEN_ROWS,
  RISK_UNIVERSAL_ROWS,
  RISK_WANT_ROWS,
  SHEET_COMMENTS,
  TESTING_COLUMNS,
  TESTING_IS_ROWS,
  WANT_ROW_LIST,
  WORKSHEET_FACT_ROWS,
  cellValue,
  computeWorksheets,
  isCalculated,
  type WorksheetKey,
  type WorksheetValues,
} from "../../lib/eightDWorksheets";
import "./eightDSheets.css";

const TABS = [
  { id: "report", label: "8D Report" },
  { id: "d2", label: "Problem Description D2" },
  { id: "d4ws", label: "Problem Solving Worksheet D4" },
  { id: "d4test", label: "Testing Possible Causes D4" },
  { id: "decision", label: "Decision Making (D3 & D5)" },
  { id: "risk", label: "Risk Analysis" },
  { id: "plan", label: "Plan & Problem Prevention" },
  { id: "help", label: "Intructions" },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface EightDWorkbookProps {
  eightDNo: number;
  blank: Blank8DValues;
  sheets: WorksheetValues;
  readOnly?: boolean;
  onBlankChange: (patch: Partial<Blank8DValues>) => void;
  onSheetChange: (key: WorksheetKey, address: string, value: string) => void;
}

function Tip({ id, children }: { id: string; children: string }) {
  const note = SHEET_COMMENTS[id];
  return (
    <span className={note ? "e8-tip" : undefined} title={note}>
      {children}
    </span>
  );
}

function Cell({
  stored,
  computed,
  address,
  label,
  readOnly,
  onChange,
  rows,
}: {
  stored: Record<string, string>;
  computed: Record<string, string>;
  address: string;
  label: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  rows?: number;
}) {
  const calculated = isCalculated(computed, address);
  const value = cellValue(stored, computed, address);
  const className = calculated ? "calc" : undefined;
  if (rows) {
    return (
      <textarea
        className={className}
        aria-label={label}
        rows={rows}
        value={value}
        readOnly={readOnly || calculated}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <input
      className={className}
      aria-label={label}
      value={value}
      readOnly={readOnly || calculated}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function EightDWorkbook({ eightDNo, blank, sheets, readOnly, onBlankChange, onSheetChange }: EightDWorkbookProps) {
  const [tab, setTab] = useState<TabId>("report");
  const computed = useMemo(
    () => computeWorksheets(sheets, { eightDNo: String(eightDNo), problemStatement: blank.problemStatement }),
    [blank.problemStatement, eightDNo, sheets]
  );

  const set = (key: WorksheetKey) => (address: string) => (value: string) => onSheetChange(key, address, value);

  return (
    <div data-testid="eight-d-workbook">
      <div className="e8-tabs no-print" role="tablist" aria-label="8D workbook sheets">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className={tab === "report" ? "e8-panel first active" : "e8-panel first"} role="tabpanel">
        <Blank8DSheet eightDNo={eightDNo} values={blank} readOnly={readOnly} onChange={onBlankChange} />
      </div>

      <div className={tab === "d2" ? "e8-panel active" : "e8-panel"} role="tabpanel">
        <ProblemDescription
          stored={sheets.problemDescriptionD2}
          computed={computed.problemDescriptionD2}
          readOnly={readOnly}
          onChange={set("problemDescriptionD2")}
        />
      </div>
      <div className={tab === "d4ws" ? "e8-panel active" : "e8-panel"} role="tabpanel">
        <ProblemSolving
          stored={sheets.problemSolvingWorksheetD4}
          computed={computed.problemSolvingWorksheetD4}
          readOnly={readOnly}
          onChange={set("problemSolvingWorksheetD4")}
        />
      </div>
      <div className={tab === "d4test" ? "e8-panel active" : "e8-panel"} role="tabpanel">
        <TestingCauses
          stored={sheets.testingPossibleCausesD4}
          computed={computed.testingPossibleCausesD4}
          readOnly={readOnly}
          onChange={set("testingPossibleCausesD4")}
        />
      </div>
      <div className={tab === "decision" ? "e8-panel active" : "e8-panel"} role="tabpanel">
        <DecisionMaking
          stored={sheets.decisionMaking}
          computed={computed.decisionMaking}
          readOnly={readOnly}
          onChange={set("decisionMaking")}
        />
      </div>
      <div className={tab === "risk" ? "e8-panel active" : "e8-panel"} role="tabpanel">
        <RiskAnalysis stored={sheets.riskAnalysis} computed={computed.riskAnalysis} readOnly={readOnly} onChange={set("riskAnalysis")} />
      </div>
      <div className={tab === "plan" ? "e8-panel active" : "e8-panel"} role="tabpanel">
        <PlanPrevention
          stored={sheets.planProblemPrevention}
          computed={computed.planProblemPrevention}
          readOnly={readOnly}
          onChange={set("planProblemPrevention")}
        />
      </div>
      <div className={tab === "help" ? "e8-panel active" : "e8-panel"} role="tabpanel">
        <InstructionsTab />
      </div>
    </div>
  );
}

function ProblemDescription({
  stored,
  computed,
  readOnly,
  onChange,
}: {
  stored: Record<string, string>;
  computed: Record<string, string>;
  readOnly?: boolean;
  onChange: (address: string) => (value: string) => void;
}) {
  return (
    <section className="e8-sheet" aria-label="Problem Description D2">
      <h2 className="e8-title">Problem Description (D2)</h2>
      <div className="e8-scroll">
        <table className="e8-grid">
          <tbody>
            <tr>
              <th className="e8-lab">8D No.</th>
              <td>
                <Cell stored={stored} computed={computed} address="C3" label="8D No." readOnly={readOnly} onChange={onChange("C3")} />
              </td>
              <th className="e8-h" colSpan={2}>
                PROBLEM DESCRIPTION (D2)
              </th>
            </tr>
            <tr>
              <th className="e8-lab">1. Operational Definition What's wrong with what? Why?</th>
              <td colSpan={4}>
                <Cell stored={stored} computed={computed} address="E5" label="Operational definition" readOnly={readOnly} onChange={onChange("E5")} rows={3} />
              </td>
            </tr>
            <tr>
              <th className="e8-h">2. Description of Problem</th>
              <th className="e8-h center">IS</th>
              <th className="e8-h center">IS NOT</th>
              <th className="e8-h center">GET INFO ON</th>
            </tr>
            {PROBLEM_DESCRIPTION_ROWS.map((row) => (
              <tr key={row.row}>
                <th className="e8-lab">{row.label}</th>
                {(["E", "F", "G"] as const).map((column) => {
                  const address = `${column}${row.row}`;
                  return (
                    <td key={address}>
                      <Cell
                        stored={stored}
                        computed={computed}
                        address={address}
                        label={`${row.label} ${column === "E" ? "IS" : column === "F" ? "IS NOT" : "GET INFO ON"}`}
                        readOnly={readOnly}
                        onChange={onChange(address)}
                        rows={2}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProblemSolving({
  stored,
  computed,
  readOnly,
  onChange,
}: {
  stored: Record<string, string>;
  computed: Record<string, string>;
  readOnly?: boolean;
  onChange: (address: string) => (value: string) => void;
}) {
  return (
    <section className="e8-sheet" aria-label="Problem Solving Worksheet D4">
      <h2 className="e8-title">Problem Solving Worksheet (D4)</h2>
      <div className="e8-scroll">
        <table className="e8-grid">
          <tbody>
            <tr>
              <th className="e8-lab">8D No.</th>
              <td>
                <Cell stored={stored} computed={computed} address="C3" label="8D No." readOnly={readOnly} onChange={onChange("C3")} />
              </td>
              <th className="e8-h" colSpan={5}>
                PROBLEM SOLVING WORKSHEET (D4)
              </th>
            </tr>
            <tr>
              <th className="e8-lab">1. Operational Definition What's wrong with what? Why?</th>
              <td colSpan={6}>
                <Cell stored={stored} computed={computed} address="F5" label="Operational definition" readOnly={readOnly} onChange={onChange("F5")} rows={2} />
              </td>
            </tr>
            <tr>
              <th className="e8-h" rowSpan={2}>
                2. Description of Problem
              </th>
              <th className="e8-h center" rowSpan={2}>
                IS
              </th>
              <th className="e8-h center" rowSpan={2}>
                IS NOT
              </th>
              <th className="e8-h center" colSpan={3}>
                3. Deductions About Facts and Other Information
              </th>
              <th className="e8-h center" rowSpan={2}>
                <Tip id="d4ws:L21">4. Possible Causes</Tip>
              </th>
            </tr>
            <tr>
              <th className="e8-h center">3a. Differences</th>
              <th className="e8-h center">3b. Changes</th>
              <th className="e8-h center">Date</th>
            </tr>
            {WORKSHEET_FACT_ROWS.map((row) => (
              <tr key={row.row}>
                <th className="e8-lab">
                  {row.letter ? `${row.letter}. ` : ""}
                  {row.label}
                </th>
                <td>
                  <Cell stored={stored} computed={computed} address={`E${row.row}`} label={`${row.label} IS`} readOnly={readOnly} onChange={onChange(`E${row.row}`)} rows={2} />
                </td>
                <td>
                  <Cell stored={stored} computed={computed} address={`F${row.row}`} label={`${row.label} IS NOT`} readOnly={readOnly} onChange={onChange(`F${row.row}`)} rows={2} />
                </td>
                {(["G", "H", "I"] as const).map((column) => {
                  const address = `${column}${row.row}`;
                  const name = column === "G" ? "Differences" : column === "H" ? "Changes" : "Date";
                  return (
                    <td key={address}>
                      <Cell stored={stored} computed={computed} address={address} label={`${row.label} ${name}`} readOnly={readOnly} onChange={onChange(address)} rows={2} />
                    </td>
                  );
                })}
                <td>
                  {row.letter ? (
                    <Cell
                      stored={stored}
                      computed={computed}
                      address={`L${row.row}`}
                      label={`Possible cause ${row.letter}`}
                      readOnly={readOnly}
                      onChange={onChange(`L${row.row}`)}
                      rows={2}
                    />
                  ) : row.row === 20 ? (
                    <div className="e8-note">5. Test causes for probability (+, -, ?) Page 2 Does it explain Is/Is Not fact?</div>
                  ) : row.row === 21 ? (
                    <div className="e8-note">
                      <Tip id="d4ws:L21">6. Steps to verify Root Cause? (make the problem come and go)</Tip>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TestingCauses({
  stored,
  computed,
  readOnly,
  onChange,
}: {
  stored: Record<string, string>;
  computed: Record<string, string>;
  readOnly?: boolean;
  onChange: (address: string) => (value: string) => void;
}) {
  return (
    <section className="e8-sheet" aria-label="Testing Possible Causes D4">
      <h2 className="e8-title">Testing Possible Causes (D4 Continued)</h2>
      <div className="e8-scroll">
        <table className="e8-grid">
          <tbody>
            <tr>
              <th className="e8-lab">8D No.</th>
              <td colSpan={7}>
                <Cell stored={stored} computed={computed} address="C9" label="8D No." readOnly={readOnly} onChange={onChange("C9")} />
              </td>
            </tr>
            <tr>
              <th className="e8-h">Instructions</th>
              <td className="e8-note" colSpan={7}>
                The theories should transfer over from the previous page. If they don't, retype the theories in.
              </td>
            </tr>
            <tr>
              <td className="e8-note" colSpan={8}>
                For each theory (potential root cause), ask "If the ______theory is the cause of my problem, does it explain, in and of itself, why the "IS" is affected, but never the "IS NOT"?
              </td>
            </tr>
            <tr>
              <td className="e8-note" colSpan={8}>
                Record: "+" (plus) for Yes: Both "IS" and "IS NOT" are explained
              </td>
            </tr>
            <tr>
              <td className="e8-note" colSpan={8}>
                Record: "-" (minus) for No: Does not explain "IS" and/or "IS NOT"
              </td>
            </tr>
            <tr>
              <td className="e8-note" colSpan={8}>
                Record: "?" (question mark) for need additional information to draw conclusion
              </td>
            </tr>
            <tr>
              <th className="e8-h">Change-How Theories</th>
              {TESTING_COLUMNS.map((column) => (
                <td key={column.column}>
                  <Cell
                    stored={stored}
                    computed={computed}
                    address={`${column.column}11`}
                    label={`Theory ${column.letter}`}
                    readOnly={readOnly}
                    onChange={onChange(`${column.column}11`)}
                    rows={2}
                  />
                </td>
              ))}
            </tr>
            <tr>
              <th className="e8-h">"IS's"</th>
              {TESTING_COLUMNS.map((column) => (
                <th key={column.letter} className="e8-h center">
                  {column.letter}
                </th>
              ))}
            </tr>
            {TESTING_IS_ROWS.map((item, index) => {
              const excelRow = 15 + index;
              return (
                <tr key={item}>
                  <th className="e8-lab">{item}</th>
                  {TESTING_COLUMNS.map((column) => {
                    const address = `${column.column}${excelRow}`;
                    return (
                      <td key={address}>
                        <Cell
                          stored={stored}
                          computed={computed}
                          address={address}
                          label={`IS ${item} theory ${column.letter}`}
                          readOnly={readOnly}
                          onChange={onChange(address)}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr>
              <th className="e8-lab">Comments/ Follow-Up Items</th>
              <td colSpan={7}>
                <Cell stored={stored} computed={computed} address="E33" label="Comments" readOnly={readOnly} onChange={onChange("E33")} rows={3} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

const CHOICES = [
  { title: "G9", infoGiven: "G", yn: "I", infoWant: "G", howGood: "H", score: "I", name: "A" },
  { title: "J9", infoGiven: "J", yn: "L", infoWant: "J", howGood: "K", score: "L", name: "B" },
  { title: "M9", infoGiven: "M", yn: "O", infoWant: "M", howGood: "N", score: "O", name: "C" },
  { title: "P9", infoGiven: "P", yn: "R", infoWant: "P", howGood: "Q", score: "R", name: "D" },
] as const;

function DecisionMaking({
  stored,
  computed,
  readOnly,
  onChange,
}: {
  stored: Record<string, string>;
  computed: Record<string, string>;
  readOnly?: boolean;
  onChange: (address: string) => (value: string) => void;
}) {
  return (
    <section className="e8-sheet" aria-label="Decision Making (D3 & D5)">
      <h2 className="e8-title">Decision Making Worksheet (D3 & D5)</h2>
      <div className="e8-scroll">
        <table className="e8-grid">
          <tbody>
            <tr>
              <th className="e8-lab">8D No.</th>
              <td colSpan={13}>
                <Cell stored={stored} computed={computed} address="C3" label="8D No." readOnly={readOnly} onChange={onChange("C3")} />
              </td>
            </tr>
            <tr>
              <th className="e8-lab">
                <Tip id="decision:C5">(1) END RESULT:</Tip>
              </th>
              <td colSpan={13}>
                <Cell stored={stored} computed={computed} address="E5" label="End result" readOnly={readOnly} onChange={onChange("E5")} rows={2} />
              </td>
            </tr>
            <tr>
              <th className="e8-h" colSpan={2}>
                <Tip id="decision:C7">(2) CRITERIA:</Tip>
              </th>
              <th className="e8-h" colSpan={12}>
                <Tip id="decision:G7">(4) CHOICES AVAILABLE - (INNOVATE)</Tip>
              </th>
            </tr>
            <tr>
              <th className="e8-lab" colSpan={2} />
              {CHOICES.map((choice) => (
                <td key={choice.title} colSpan={3}>
                  <Cell stored={stored} computed={computed} address={choice.title} label={`Choice ${choice.name}`} readOnly={readOnly} onChange={onChange(choice.title)} />
                </td>
              ))}
            </tr>
            <tr>
              <th className="e8-h" colSpan={2}>
                <Tip id="decision:C11">GIVENS: (mandatory, measurable, realistic)</Tip>
              </th>
              {CHOICES.map((choice) => (
                <>
                  <th key={`${choice.name}-info`} className="e8-h" colSpan={2}>
                    <Tip id="decision:G11">(5) INFO</Tip>
                  </th>
                  <th key={`${choice.name}-yn`} className="e8-h center">
                    Y/N
                  </th>
                </>
              ))}
            </tr>
            {GIVEN_ROWS.map((row) => (
              <tr key={row}>
                <td colSpan={2}>
                  <Cell stored={stored} computed={computed} address={`C${row}`} label={`Given ${row - 12}`} readOnly={readOnly} onChange={onChange(`C${row}`)} rows={2} />
                </td>
                {CHOICES.map((choice) => {
                  const info = `${choice.infoGiven}${row}`;
                  const yn = `${choice.yn}${row}`;
                  return (
                    <>
                      <td key={info} colSpan={2}>
                        <Cell stored={stored} computed={computed} address={info} label={`Given ${row - 12} ${choice.name} info`} readOnly={readOnly} onChange={onChange(info)} />
                      </td>
                      <td key={yn}>
                        <Cell stored={stored} computed={computed} address={yn} label={`Given ${row - 12} ${choice.name} Y/N`} readOnly={readOnly} onChange={onChange(yn)} />
                      </td>
                    </>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th className="e8-h">
                <Tip id="decision:C21">WANTS: flexible limits, subjective, realistic</Tip>
              </th>
              <th className="e8-h center">
                <Tip id="decision:E21">(3) How Important (1-10)</Tip>
              </th>
              {CHOICES.map((choice) => (
                <>
                  <th key={`${choice.name}-winfo`} className="e8-h">
                    INFO
                  </th>
                  <th key={`${choice.name}-good`} className="e8-h center">
                    <Tip id="decision:H21">(5) How Good (0-10)</Tip>
                  </th>
                  <th key={`${choice.name}-score`} className="e8-h center">
                    <Tip id="decision:I21">Score</Tip>
                  </th>
                </>
              ))}
            </tr>
            {WANT_ROW_LIST.map((row, index) => (
              <tr key={row}>
                <td>
                  <Cell stored={stored} computed={computed} address={`C${row}`} label={`Want ${index + 1}`} readOnly={readOnly} onChange={onChange(`C${row}`)} />
                </td>
                <td>
                  <Cell stored={stored} computed={computed} address={`E${row}`} label={`Want ${index + 1} importance`} readOnly={readOnly} onChange={onChange(`E${row}`)} />
                </td>
                {CHOICES.map((choice) => {
                  const info = `${choice.infoWant}${row}`;
                  const good = `${choice.howGood}${row}`;
                  const score = `${choice.score}${row}`;
                  return (
                    <>
                      <td key={info}>
                        <Cell stored={stored} computed={computed} address={info} label={`Want ${index + 1} ${choice.name} info`} readOnly={readOnly} onChange={onChange(info)} />
                      </td>
                      <td key={good}>
                        <Cell stored={stored} computed={computed} address={good} label={`Want ${index + 1} ${choice.name} how good`} readOnly={readOnly} onChange={onChange(good)} />
                      </td>
                      <td key={score}>
                        <Cell stored={stored} computed={computed} address={score} label={`Want ${index + 1} ${choice.name} score`} readOnly={readOnly} onChange={onChange(score)} />
                      </td>
                    </>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th className="e8-lab" colSpan={1}>
                Relative MERIT (total score)
              </th>
              <td>
                <Cell stored={stored} computed={computed} address="E34" label="Total importance" readOnly={readOnly} onChange={onChange("E34")} />
              </td>
              {CHOICES.map((choice) => {
                const total = choice.name === "A" ? "H34" : choice.name === "B" ? "K34" : choice.name === "C" ? "N34" : "Q34";
                return (
                  <td key={total} colSpan={3}>
                    <Cell stored={stored} computed={computed} address={total} label={`Choice ${choice.name} total score`} readOnly={readOnly} onChange={onChange(total)} />
                  </td>
                );
              })}
            </tr>
            <tr>
              <th className="e8-lab">
                <Tip id="decision:E35">Importance × 1000</Tip>
              </th>
              <td>
                <Cell stored={stored} computed={computed} address="E35" label="Importance times 1000" readOnly={readOnly} onChange={onChange("E35")} />
              </td>
              <td colSpan={12} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

const RISK_CHOICES = [
  { label: "1st Choice", text: "G", p: "H", s: "I" },
  { label: "2nd Choice", text: "K", p: "L", s: "M" },
  { label: "3rd Choice", text: "O", p: "P", s: "Q" },
] as const;

function RiskLines({
  rows,
  label,
  stored,
  computed,
  readOnly,
  onChange,
}: {
  rows: number[];
  label: string;
  stored: Record<string, string>;
  computed: Record<string, string>;
  readOnly?: boolean;
  onChange: (address: string) => (value: string) => void;
}) {
  return (
    <>
      {rows.map((row, index) => (
        <tr key={row}>
          {index === 0 ? (
            <th className="e8-lab" rowSpan={rows.length}>
              <Tip id={label.startsWith("1") ? "risk:C8" : "risk:E13"}>{label}</Tip>
            </th>
          ) : null}
          {RISK_CHOICES.map((choice) => {
            const text = `${choice.text}${row}`;
            const p = `${choice.p}${row}`;
            const s = `${choice.s}${row}`;
            return (
              <>
                <td key={text}>
                  <Cell stored={stored} computed={computed} address={text} label={`${label} ${choice.label}`} readOnly={readOnly} onChange={onChange(text)} />
                </td>
                <td key={p}>
                  <Cell stored={stored} computed={computed} address={p} label={`${label} ${choice.label} probability`} readOnly={readOnly} onChange={onChange(p)} />
                </td>
                <td key={s}>
                  <Cell stored={stored} computed={computed} address={s} label={`${label} ${choice.label} severity`} readOnly={readOnly} onChange={onChange(s)} />
                </td>
              </>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function RiskAnalysis({
  stored,
  computed,
  readOnly,
  onChange,
}: {
  stored: Record<string, string>;
  computed: Record<string, string>;
  readOnly?: boolean;
  onChange: (address: string) => (value: string) => void;
}) {
  return (
    <section className="e8-sheet" aria-label="Risk Analysis">
      <h2 className="e8-title">Decision Making Worksheet - Risk Analysis (D3 & D5)</h2>
      <div className="e8-scroll">
        <table className="e8-grid">
          <tbody>
            <tr>
              <th className="e8-lab">8D No.</th>
              <td colSpan={9}>
                <Cell stored={stored} computed={computed} address="C3" label="8D No." readOnly={readOnly} onChange={onChange("C3")} />
              </td>
            </tr>
            <tr>
              <th className="e8-h" colSpan={10}>
                (6) RISK ANALYSIS: State your risks in "IF…THEN" terms. "If we do this, what might happen, contrary to our interest?"
              </th>
            </tr>
            <tr>
              <th className="e8-lab">Investigate one choice at a time</th>
              {RISK_CHOICES.map((choice) => (
                <>
                  <th key={choice.label} className="e8-h">
                    {choice.label}
                  </th>
                  <th key={`${choice.label}-p`} className="e8-h center">
                    <Tip id="risk:H6">P</Tip>
                  </th>
                  <th key={`${choice.label}-s`} className="e8-h center">
                    <Tip id="risk:I6">S</Tip>
                  </th>
                </>
              ))}
            </tr>
            <RiskLines rows={RISK_GIVEN_ROWS} label="1. RISK — What characteristics of this choice may fail to satisfy the GIVENS?" stored={stored} computed={computed} readOnly={readOnly} onChange={onChange} />
            <RiskLines rows={RISK_WANT_ROWS} label="2. RISK — What features of this choice compromise or threaten an important WANT?" stored={stored} computed={computed} readOnly={readOnly} onChange={onChange} />
            <tr>
              <th className="e8-h" colSpan={10}>
                3. UNIVERSAL — Use the checklist to stimulate ideas. Basic Sources of Trouble:
              </th>
            </tr>
            {RISK_UNIVERSAL_ROWS.map((row) => (
              <tr key={row.row}>
                <th className="e8-lab">{row.label}</th>
                {RISK_CHOICES.map((choice) => {
                  const text = `${choice.text}${row.row}`;
                  const p = `${choice.p}${row.row}`;
                  const s = `${choice.s}${row.row}`;
                  return (
                    <>
                      <td key={text}>
                        <Cell stored={stored} computed={computed} address={text} label={`${row.label} ${choice.label}`} readOnly={readOnly} onChange={onChange(text)} />
                      </td>
                      <td key={p}>
                        <Cell stored={stored} computed={computed} address={p} label={`${row.label} ${choice.label} probability`} readOnly={readOnly} onChange={onChange(p)} />
                      </td>
                      <td key={s}>
                        <Cell stored={stored} computed={computed} address={s} label={`${row.label} ${choice.label} severity`} readOnly={readOnly} onChange={onChange(s)} />
                      </td>
                    </>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className="e8-note" colSpan={4}>
                "SERIOUSNESS" No. 10 means rejection if "PROBABILITY" is certain (10 x 10).
              </td>
              <td className="e8-note" colSpan={3}>
                P = Probability (1-10) S = Severity (1-10)
              </td>
              <th className="e8-h" colSpan={3}>
                <Tip id="risk:O37">7. Make the Final Balanced Choice</Tip>
              </th>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlanPrevention({
  stored,
  computed,
  readOnly,
  onChange,
}: {
  stored: Record<string, string>;
  computed: Record<string, string>;
  readOnly?: boolean;
  onChange: (address: string) => (value: string) => void;
}) {
  return (
    <section className="e8-sheet" aria-label="Plan & Problem Prevention">
      <h2 className="e8-title">Planning and Problem Prevention Worksheet (D6)</h2>
      <p className="e8-note">
        Use your experience to identify parts of your plan that are complex, have tight deadlines, are high impact, or are new. Cells with a red corner have more information.
      </p>
      <div className="e8-scroll">
        <table className="e8-grid">
          <tbody>
            <tr>
              <th className="e8-lab">8D No.</th>
              <td colSpan={8}>
                <Cell stored={stored} computed={computed} address="C5" label="8D No." readOnly={readOnly} onChange={onChange("C5")} />
              </td>
            </tr>
            <tr>
              <th className="e8-h">
                <Tip id="plan:C7">1. OBJECTIVE OF THE PLAN (Goal with timing):</Tip>
              </th>
              <td colSpan={8}>
                <Cell stored={stored} computed={computed} address="G7" label="Objective" readOnly={readOnly} onChange={onChange("G7")} rows={2} />
              </td>
            </tr>
            <tr>
              <th className="e8-h">
                <Tip id="plan:C9">2. KEY STEPS</Tip>
              </th>
              <th className="e8-h">3. POTENTIAL PROBLEMS</th>
              <th className="e8-h center">
                <Tip id="plan:G10">P</Tip>
              </th>
              <th className="e8-h center">
                <Tip id="plan:H10">S</Tip>
              </th>
              <th className="e8-h">5. POSSIBLE CAUSES</th>
              <th className="e8-h">6. PREVENTION ACTIONS</th>
              <th className="e8-h">7. PROTECTION ACTIONS</th>
              <th className="e8-h">8. CUES (DATE OR EVENT)</th>
              <th className="e8-h">9. WHO</th>
            </tr>
            {PLAN_ROWS.map((row, index) => (
              <tr key={row}>
                {(
                  [
                    ["C", "Key step"],
                    ["E", "Potential problem"],
                    ["G", "Probability"],
                    ["H", "Severity"],
                    ["I", "Possible cause"],
                    ["J", "Prevention"],
                    ["K", "Protection"],
                    ["L", "Cue"],
                    ["M", "Who"],
                  ] as const
                ).map(([column, name]) => {
                  const address = `${column}${row}`;
                  return (
                    <td key={address}>
                      <Cell
                        stored={stored}
                        computed={computed}
                        address={address}
                        label={`Step ${index + 1} ${name}`}
                        readOnly={readOnly}
                        onChange={onChange(address)}
                        rows={column === "G" || column === "H" ? undefined : 2}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th className="e8-h" colSpan={9}>
                <Tip id="plan:M3">10. Review, revise, and communicate the final plan.</Tip>
              </th>
            </tr>
            <tr>
              <td colSpan={9}>
                <Cell stored={stored} computed={computed} address="M3" label="Final plan review" readOnly={readOnly} onChange={onChange("M3")} rows={3} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InstructionsTab() {
  return (
    <section className="e8-sheet e8-help" aria-label="Intructions">
      <h2 className="e8-title">8D Problem Solving</h2>
      <h3>D2 Problem Statement/Description (quantify) (one defect per 8D)</h3>
      <p>What are the symptoms that the customer is seeing? Specify the internal/external customer problems by identifying in quantifiable terms who, what, when, where, why, how, how many (5W2H) of the problem.</p>
      <h3>D3 Choose and Verify Interim Containment Action(s) (ICA)</h3>
      <p>Define and implement containment actions to isolate the problem from any internal/external customer until permanent corrective action is available. Verify the effectiveness of the action. The ICA is a type of 'Band-Aid' used to protect the customer until the root cause is determined and the permanent correction can be implemented.</p>
      <p>How effective is your ICA so the customer does not see the problem?</p>
      <h3>D4 Define and Verify Root Cause(s)</h3>
      <p>Identify all potential causes (due to a change) which could explain why the problem occurred. Isolate and verify the Root Cause by testing each potential cause against the problem description and test data (does it explain the IS,IS/NOT'S in D2?). Identify alternative corrective actions to eliminate root cause.</p>
      <p>What % of the problem is caused by the root cause(s) (must have 100% total)</p>
      <h3>D5 Choose and Verify Permenant Corrective Action(s) (PCA)</h3>
      <p>Through pre-production test programs, quantitatively confirm that the selected corrective actions will resolve the problems for the customer and will not cause undesirable side effects. Define contingency action, if necessary based on the risk assessments. This step describes WHAT you will do.</p>
      <p>How effective is your PCA so the problem is cured not masked? (must have 100% total)</p>
      <h3>D6 Implement and Validate Permentant Corrective Action(s) (PCA)</h3>
      <p>Define and implement the best permanent corrective actions. Include the removal of the ICA. Choose on-going controls to ensure the root cause is eliminated. Once in production, monitor and evaluate the long-term effects and implement contingency actions, if necessary. This step describes HOW you will do it.</p>
      <h3>D7 System Prevention Actions to Prevent Reoccurence</h3>
      <p>Mistake Proofing: How are you going to ensure it can't happen again?</p>
      <p>Modify the management systems, operating systems, practices and procedures to prevent recurrence of this and all similar problems. (What is the "Escape Root Cause"? What in your system allowed this problem or any problem from leaving your plant and not getting detected?). Choose on-going controls, including mistake proofing methodology, such as the use of process or design features to prevent manufacture of nonconforming product/service. Review control plans, FMEA's, flowcharts, etc. for revisions.</p>
      <h3>Have Corrective Action/Implementation Been Reviewed Against Documents:?</h3>
      <p>Check boxes that apply: Control Plan, FMEA, Flowchart, Proc./Work Instr., Add to Internal Audit.</p>
      <h3>D8 TEAM AND INDIVIDUAL RECOGNITION</h3>
      <p>Recognize the collective efforts of the team.</p>
    </section>
  );
}
