import type { ReactNode } from "react";

/** Locks the fields inside a saved form. Disabled controls stay readable in light and dark mode. */
export function SavedFormFields({ locked, children }: { locked: boolean; children: ReactNode }) {
  return (
    <fieldset
      disabled={locked}
      data-testid={locked ? "form-locked" : "form-editing"}
      className="min-w-0 border-0 p-0 disabled:opacity-100 [&_input:disabled]:bg-muted [&_input:disabled]:text-foreground [&_textarea:disabled]:bg-muted [&_textarea:disabled]:text-foreground [&_select:disabled]:bg-muted [&_select:disabled]:text-foreground"
    >
      {children}
    </fieldset>
  );
}
