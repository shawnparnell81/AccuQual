/**
 * Builders for the formulas the forms add on top of their workbook. Each returns Excel formula text (no leading =), so a
 * reviewer reads them the same way as the workbook's own. A blank input gives a blank result, never a guess.
 */

export interface Words {
  pass: string;
  fail: string;
}

/** "within spec ± tolerance": blank until the measurement, spec and tolerance are all filled in. */
export function withinTolerance(measured: string, nominal: string, tolerance: string, words: Words): string {
  return `IF(OR(${measured}="",${nominal}="",${tolerance}=""),"",IF(AND(${measured}>=${nominal}-${tolerance},${measured}<=${nominal}+${tolerance}),"${words.pass}","${words.fail}"))`;
}

/** The workbook's own "within spec ± tolerance" with no blank guard, for rows the workbook already had. */
export function withinToleranceAsWritten(measured: string, nominal: string, tolerance: string, words: Words): string {
  return `IF(AND(${measured}>=${nominal}-${tolerance}, ${measured}<=${nominal}+${tolerance}), "${words.pass}", "${words.fail}")`;
}

/** Blank until every listed cell has something in it. */
export function allFilled(cells: string[]): string {
  return `AND(${cells.map((cell) => `${cell}<>""`).join(",")})`;
}

/**
 * Overall result over a set of result cells: blank until every required row is answered, then Fail if any result is the
 * failing word, otherwise Pass.
 */
export function overallOf(required: string[], results: string[], words: Words): string {
  const failed = results.map((cell) => `${cell}="${words.fail}"`).join(",");
  return `IF(${allFilled(required)},IF(OR(${failed}),"${words.fail}","${words.pass}"),"")`;
}
