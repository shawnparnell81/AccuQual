import type { WindowInstance } from "../types/window";
import { WindowFrame } from "./WindowFrame";
import { FormWindowContent } from "../components/forms/FormWindowContent";
import { AuditDetailPage } from "../routes/Audits/AuditDetailPage";
import { DocumentDetailPage } from "../routes/Documents/DocumentDetailPage";
import { AiInsightsPage } from "../routes/AI/AiInsightsPage";
import { DigitalTwinPage } from "../routes/DigitalTwin/DigitalTwinPage";

/**
 * Renders one window's content by type. Full-System Audit finding M9
 * (closed): all 5 window types now have real content — "document" and
 * "audit" reuse their normal detail pages via an optional entityId prop
 * (falls back to useParams when opened as a normal route); "ai" and
 * "digitalTwin" are standalone dashboards with no entity, so they render
 * unmodified.
 */
export function WindowManager({ win }: { win: WindowInstance }) {
  return (
    <WindowFrame win={win}>
      {win.type === "form" && win.formType ? (
        <FormWindowContent formType={win.formType} entityId={win.entityId} windowId={win.id} />
      ) : win.type === "document" && win.entityId !== undefined ? (
        <DocumentDetailPage entityId={win.entityId} />
      ) : win.type === "audit" && win.entityId !== undefined ? (
        <AuditDetailPage entityId={win.entityId} />
      ) : win.type === "ai" ? (
        <AiInsightsPage />
      ) : win.type === "digitalTwin" ? (
        <DigitalTwinPage />
      ) : (
        <p className="text-sm text-destructive">This window has no linked record — nothing to load.</p>
      )}
    </WindowFrame>
  );
}
