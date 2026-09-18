// Full-System Audit finding M9: "document" | "audit" | "ai" | "digitalTwin"
// are real union members with no reachable UI path — grep confirms
// `openWindow({...})` is only ever called with `type: "form"`
// (OpenFormButton.tsx). WindowManager.tsx's placeholder branch is what
// would render if one were ever opened, but nothing opens one today.
// TODO: these 4 types stay unreachable until DocumentsPage/AuditDetailPage/
// AiInsightsPage/DigitalTwinPage are refactored to accept props instead of
// reading state from `useParams` (see WindowManager.tsx's own comment) —
// not a feature request, just documenting the known gap so it isn't
// mistaken for dead code to delete.
export type WindowType = "form" | "document" | "audit" | "ai" | "digitalTwin";

/** One open window in the multi-window workspace. Always tenant-scoped. */
export interface WindowInstance {
  id: string;
  tenantId: string;
  type: WindowType;
  entityId?: number;
  formType?: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  state?: Record<string, unknown>;
}
