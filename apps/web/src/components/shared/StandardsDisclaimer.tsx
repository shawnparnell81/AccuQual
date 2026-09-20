import clsx from "clsx";

/**
 * AccuQual's modules are structured around ISO 9001 / IATF 16949 practices, but
 * AccuQual itself is NOT certified or endorsed by ISO, IATF, or any standards
 * body — this note says so wherever the app is shown, so nothing else in the
 * UI is ever read as a certification claim. Do not reword this into a
 * "compliant" / "certified" statement.
 */
export const STANDARDS_DISCLAIMER = "Designed around ISO 9001 and IATF 16949 practices. AccuQual is not certified by ISO, IATF, or any other standards body.";

export function StandardsDisclaimer({ className }: { className?: string }) {
  return <p className={clsx("text-[10px] leading-tight text-muted-foreground print:hidden", className)}>{STANDARDS_DISCLAIMER}</p>;
}
