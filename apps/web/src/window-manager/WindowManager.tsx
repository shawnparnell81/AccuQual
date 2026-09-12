import type { WindowInstance } from "../types/window";
import { WindowFrame } from "./WindowFrame";
import { FormWindowContent } from "../components/forms/FormWindowContent";

/**
 * Renders one window's content by type. Only "form" windows are fully wired
 * up in this pass (that's the Forms & PDF Engine Spec's primary use case —
 * NCR/CAPA/etc. "Open Form" buttons). document/audit/ai/digitalTwin windows
 * render a placeholder: the existing Documents/Audits/AI/DigitalTwin pages
 * read their state from route params via `useParams`, so reusing them inside
 * a window (no route) needs those pages refactored to take props instead —
 * tracked as a follow-up, not done here.
 */
export function WindowManager({ win }: { win: WindowInstance }) {
  return (
    <WindowFrame win={win}>
      {win.type === "form" && win.formType ? (
        <FormWindowContent formType={win.formType} entityId={win.entityId} windowId={win.id} />
      ) : (
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{win.title}</p>
          <p className="mt-2">
            This window type ("{win.type}") doesn't have dedicated window content yet — see the note in
            WindowManager.tsx.
          </p>
        </div>
      )}
    </WindowFrame>
  );
}
