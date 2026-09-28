/**
 * Extra 8D workbook sheets. Cell keys are Excel addresses.
 * Formulas were read from the owner's workbook (openpyxl). The worksheet
 * XML has no conditional-formatting rules, so nothing here invents a color rule.
 * Calculated cells are derived while typing and are not stored.
 */

export interface WorksheetValues {
  problemDescriptionD2: Record<string, string>;
  problemSolvingWorksheetD4: Record<string, string>;
  testingPossibleCausesD4: Record<string, string>;
  decisionMaking: Record<string, string>;
  riskAnalysis: Record<string, string>;
  planProblemPrevention: Record<string, string>;
}

export const WORKSHEET_KEYS = [
  "problemDescriptionD2",
  "problemSolvingWorksheetD4",
  "testingPossibleCausesD4",
  "decisionMaking",
  "riskAnalysis",
  "planProblemPrevention",
] as const;

export type WorksheetKey = (typeof WORKSHEET_KEYS)[number];

/** Problem Solving Worksheet starts with theory numbers 1–7 in column L, matching the workbook. */
const WORKSHEET_DEFAULTS: Record<string, string> = {
  L10: "1",
  L11: "2",
  L13: "3",
  L14: "4",
  L16: "5",
  L17: "6",
  L18: "7",
};

/** Decision Making starts with choice titles A–D, matching the workbook. */
const DECISION_DEFAULTS: Record<string, string> = {
  G9: "A",
  J9: "B",
  M9: "C",
  P9: "D",
};

const D2_INPUT_ROWS = [9, 10, 12, 13, 15, 16, 17, 19, 20, 21];
const D2_IS_ROWS: Record<number, number> = {
  10: 9,
  11: 10,
  13: 12,
  14: 13,
  16: 15,
  17: 16,
  18: 17,
  20: 19,
  21: 20,
  22: 21,
};
const TEST_THEORY_CELLS = ["L10", "L11", "L13", "L14", "L16", "L17", "L18"] as const;
const WANT_ROWS = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

export function emptyWorksheets(): WorksheetValues {
  return {
    problemDescriptionD2: {},
    problemSolvingWorksheetD4: { ...WORKSHEET_DEFAULTS },
    testingPossibleCausesD4: {},
    decisionMaking: { ...DECISION_DEFAULTS },
    riskAnalysis: {},
    planProblemPrevention: {},
  };
}

function asCellMap(value: unknown, defaults: Record<string, string>): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaults };
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length === 0) return { ...defaults };
  const next: Record<string, string> = {};
  for (const [key, cell] of Object.entries(source)) {
    if (typeof cell === "string") next[key] = cell;
    else if (typeof cell === "number" && Number.isFinite(cell)) next[key] = String(cell);
  }
  return next;
}

export function worksheetsFromReport(report: Partial<WorksheetValues> | null | undefined): WorksheetValues {
  const source = report ?? {};
  return {
    problemDescriptionD2: asCellMap(source.problemDescriptionD2, {}),
    problemSolvingWorksheetD4: asCellMap(source.problemSolvingWorksheetD4, WORKSHEET_DEFAULTS),
    testingPossibleCausesD4: asCellMap(source.testingPossibleCausesD4, {}),
    decisionMaking: asCellMap(source.decisionMaking, DECISION_DEFAULTS),
    riskAnalysis: asCellMap(source.riskAnalysis, {}),
    planProblemPrevention: asCellMap(source.planProblemPrevention, {}),
  };
}

/** Blank or whitespace counts as 0, the same as an empty Excel cell in arithmetic. Non-numeric text is an error. */
function num(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return 0;
  const parsed = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function formatGeneral(value: number): string {
  if (Object.is(value, -0)) return "0";
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded);
}

/** Workbook number format #,##0 on Decision Making E35. */
export function formatThousands(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function product(left: string | undefined, right: string | undefined): string {
  const a = num(left);
  const b = num(right);
  if (a == null || b == null) return "#VALUE!";
  return formatGeneral(a * b);
}

function sumStored(cells: Record<string, string>, addresses: string[]): string {
  let total = 0;
  for (const address of addresses) {
    const value = num(cells[address]);
    if (value == null) return "#VALUE!";
    total += value;
  }
  return formatGeneral(total);
}

export interface WorksheetContext {
  eightDNo: string;
  problemStatement: string;
}

export interface ComputedSheets {
  problemDescriptionD2: Record<string, string>;
  problemSolvingWorksheetD4: Record<string, string>;
  testingPossibleCausesD4: Record<string, string>;
  decisionMaking: Record<string, string>;
  riskAnalysis: Record<string, string>;
  planProblemPrevention: Record<string, string>;
}

/**
 * Live formulas from the workbook:
 * - 8D number cells are Blank 8D!J5 (array formula J5:K5 spilled into C3:D3, or C5 / C9).
 * - Problem statement cells are Blank 8D!F21.
 * - Problem Solving IS / IS NOT columns copy Problem Description D2.
 * - Testing Possible Causes copies the seven Change-How theories.
 * - Decision Making scores are SUM(howGood * importance), then column totals, then E35 = E34*1000.
 */
export function computeWorksheets(values: WorksheetValues, context: WorksheetContext): ComputedSheets {
  const d2: Record<string, string> = {
    C3: context.eightDNo,
    E5: context.problemStatement,
  };

  const worksheet: Record<string, string> = {
    C3: context.eightDNo,
    F5: context.problemStatement,
  };
  for (const [row, sourceRow] of Object.entries(D2_IS_ROWS)) {
    worksheet[`E${row}`] = values.problemDescriptionD2[`E${sourceRow}`] ?? "";
    worksheet[`F${row}`] = values.problemDescriptionD2[`F${sourceRow}`] ?? "";
  }

  const testing: Record<string, string> = {
    C9: context.eightDNo,
  };
  const theoryColumns = ["E", "F", "G", "H", "I", "J", "K"];
  TEST_THEORY_CELLS.forEach((source, index) => {
    const column = theoryColumns[index];
    if (column) testing[`${column}11`] = values.problemSolvingWorksheetD4[source] ?? "";
  });

  const decision: Record<string, string> = {
    C3: context.eightDNo,
  };
  const choiceScore: Array<{ howGood: string; score: string }> = [
    { howGood: "H", score: "I" },
    { howGood: "K", score: "L" },
    { howGood: "N", score: "O" },
    { howGood: "Q", score: "R" },
  ];
  for (const row of WANT_ROWS) {
    const importance = values.decisionMaking[`E${row}`];
    for (const choice of choiceScore) {
      decision[`${choice.score}${row}`] = product(values.decisionMaking[`${choice.howGood}${row}`], importance);
    }
  }
  const importanceAddresses = WANT_ROWS.map((row) => `E${row}`);
  decision.E34 = sumStored(values.decisionMaking, importanceAddresses);
  const merit = num(decision.E34);
  decision.E35 = merit == null ? "#VALUE!" : formatThousands(merit * 1000);
  decision.H34 = sumStored(decision, WANT_ROWS.map((row) => `I${row}`));
  decision.K34 = sumStored(decision, WANT_ROWS.map((row) => `L${row}`));
  decision.N34 = sumStored(decision, WANT_ROWS.map((row) => `O${row}`));
  decision.Q34 = sumStored(decision, WANT_ROWS.map((row) => `R${row}`));

  return {
    problemDescriptionD2: d2,
    problemSolvingWorksheetD4: worksheet,
    testingPossibleCausesD4: testing,
    decisionMaking: decision,
    riskAnalysis: { C3: context.eightDNo },
    planProblemPrevention: { C5: context.eightDNo },
  };
}

export function cellValue(stored: Record<string, string>, computed: Record<string, string>, address: string): string {
  if (Object.prototype.hasOwnProperty.call(computed, address)) return computed[address] ?? "";
  return stored[address] ?? "";
}

export function isCalculated(computed: Record<string, string>, address: string): boolean {
  return Object.prototype.hasOwnProperty.call(computed, address);
}

/** Problem Description rows the user fills in (IS, IS NOT, GET INFO ON). */
export const PROBLEM_DESCRIPTION_ROWS: { row: number; label: string }[] = [
  { row: 9, label: "WHAT              Object" },
  { row: 10, label: "Defect" },
  { row: 12, label: "WHERE       Seen on object" },
  { row: 13, label: "Seen geographically" },
  { row: 15, label: "WHEN            First seen" },
  { row: 16, label: "When else seen" },
  { row: 17, label: "When seen in process (life cycle)" },
  { row: 19, label: "HOW BIG            How many objects have the defect? " },
  { row: 20, label: "How many defects per object?" },
  { row: 21, label: "What is the trend?" },
];

export const D2_INPUT_ROW_SET = new Set(D2_INPUT_ROWS);

export const WORKSHEET_FACT_ROWS: { row: number; label: string; letter: string }[] = [
  { row: 10, label: "WHAT              Object", letter: "A" },
  { row: 11, label: "Defect", letter: "B" },
  { row: 13, label: "WHERE       Seen on object", letter: "C" },
  { row: 14, label: "Seen geographically", letter: "D" },
  { row: 16, label: "WHEN            First seen", letter: "E" },
  { row: 17, label: "When else seen", letter: "F" },
  { row: 18, label: "When seen in process (life cycle)", letter: "G" },
  { row: 20, label: "HOW BIG            How many objects have the defect? ", letter: "" },
  { row: 21, label: "How many defects per object?", letter: "" },
  { row: 22, label: "What is the trend?", letter: "" },
];

export const TESTING_IS_ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
export const TESTING_COLUMNS = [
  { column: "E", letter: "A" },
  { column: "F", letter: "B" },
  { column: "G", letter: "C" },
  { column: "H", letter: "D" },
  { column: "I", letter: "E" },
  { column: "J", letter: "F" },
  { column: "K", letter: "G" },
] as const;

export const GIVEN_ROWS = [13, 14, 15, 16, 17, 18, 19];
export const WANT_ROW_LIST = WANT_ROWS;

export const RISK_GIVEN_ROWS = [8, 9, 10, 11];
export const RISK_WANT_ROWS = [13, 14, 15, 16, 17];
export const RISK_UNIVERSAL_ROWS: { row: number; label: string }[] = [
  { row: 22, label: "People" },
  { row: 23, label: "Organization" },
  { row: 24, label: "External Influences" },
  { row: 25, label: "Facilities" },
  { row: 26, label: "Equipment" },
  { row: 27, label: "Ideas" },
  { row: 28, label: "Policies" },
  { row: 29, label: "Processes" },
  { row: 30, label: "Materials" },
  { row: 31, label: "Money - Economics" },
  { row: 32, label: "Capacity" },
  { row: 33, label: "Quality" },
  { row: 34, label: "Timing" },
  { row: 35, label: "Personal Influence" },
];

export const PLAN_ROWS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

/** Cell comments from the workbook (the red-triangle notes). */
export const SHEET_COMMENTS: Record<string, string> = {
  "d4ws:L21": "How can you make the problem come and go?  Remove the cause from the process and then put it back into the process again.  Record it here.",
  "decision:C5": "Make a brief statement that describes the desired end result.  It defines the scope of the decision to be made, and provides a focus for the team.",
  "decision:E5": 'The End Result is what you are trying to achieve.  It should contain an action verb and a statement.  Example: Determine the best interim corrective action.',
  "decision:C7": "Using the End Result statement as a focus, list all the criteria that needs to be satisfied throughout this decision.",
  "decision:G7": "Brainstorm what the possible choices or options might be to satisfy the End Result. List the titles of those options across this section in place of A, B, C and D.",
  "decision:C11": "GIVENS are the minimum criteria that a possible choice must satisfy. If a possible choice does not meet the requirements of the GIVENS, it cannot be chosen as a final choice. GIVENS are mandatory and must be measurable.",
  "decision:G11": 'Record information about each option. Record a Y (Yes) if the option satisfies the criteria. Record a N (No) if the option does not satisfy the criteria. Complete the GIVENS first.',
  "decision:C21": "WANTS are those criteria that are desirable but not mandatory, and have some flexibility in the degree to which they are satisfied.",
  "decision:E21": "Decide on the relative importance of the WANT criteria. The most important WANT is 10. Compare the others to it.",
  "decision:H21": "Assign a 10 in HOW GOOD to the choice that best meets that WANT. Score the other choices from 0 to 10.",
  "decision:I21": "This should be automatically calculated. Multiply the value assigned to each WANT by its corresponding HOW GOOD value.",
  "decision:E34": "This is the total of the How Important numbers.",
  "decision:H34": "This is the total points for each option.",
  "decision:E35": "This is the total of the How Important numbers x 10. The option that comes closest to this number is your number one choice.",
  "risk:H6": "Estimate the probability of an event happening. 1 = little likelihood. 10 = a strong likelihood.",
  "risk:I6": "Estimate the seriousness if the event occurs. 1 = little impact. 10 = very serious.",
  "risk:C8": "List any risks that exist with a particular choice.",
  "risk:E8": "Could the possible choice perform poorly against the mandatory GIVENS?",
  "risk:E13": "Could the possible choice perform poorly against WANTS that have a high Relative Importance Value?",
  "risk:O37": "By considering the benefits (Relative Merit) and the Risks, make the final balanced choice.",
  "plan:C7": "Your objective should be measurable (quantifiable) and have a due date.",
  "plan:C9": "Develop the steps that must be taken in order to achieve the plan's objective.",
  "plan:G9": "P = Probability. S = Seriousness. 1 = little likelihood or little impact. 10 = strong likelihood or very serious.",
  "plan:G10": "Probability",
  "plan:H10": "Severity",
  "plan:M3": "After completing Problem Prevention, update the final plan.",
};
