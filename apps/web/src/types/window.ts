// Full-System Audit finding M9 (closed): "document" | "audit" | "ai" |
// "digitalTwin" now all render real content in WindowManager.tsx, and are
// reachable — "Quick view" buttons on AuditsPage/DocumentsPage list rows for
// the two entity-scoped types, and launcher buttons in TopNav for the two
// standalone dashboards (ai, digitalTwin).
export type WindowType = "form" | "document" | "audit" | "ai" | "digitalTwin";

/** One open window in the multi-window workspace. Always company-scoped. */
export interface WindowInstance {
  id: string;
  ownerId: string;
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
