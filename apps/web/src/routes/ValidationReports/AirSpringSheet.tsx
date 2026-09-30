import { useMemo } from "react";
import { AIR_SPRING_CERTIFY, evaluate } from "../../lib/airSpringReport";
import { AIR_SPRING_ROWS, buildAirSpringRows } from "../../lib/airSpringSheet";
import type { CellValue } from "../../lib/validationReport";
import { DenseAirSheet } from "./AirStrutSheet";

interface AirSpringSheetProps {
  cells: Record<string, CellValue>;
  readOnly?: boolean;
  onChange: (addr: string, value: CellValue) => void;
  documentNumber?: string;
  revision?: string;
  signature?: string;
  onSign?: (pin: string) => Promise<unknown>;
}

export function AirSpringSheet(props: AirSpringSheetProps) {
  const rows = useMemo(() => buildAirSpringRows(), []);
  return (
    <DenseAirSheet
      {...props}
      rows={rows}
      rowCount={AIR_SPRING_ROWS}
      evaluateCells={evaluate}
      certify={AIR_SPRING_CERTIFY}
      testId="air-spring-sheet"
      label="AIR STRUT VALIDATION DOCUMENT"
      resultAddrs={["G7", "B48"]}
    />
  );
}
