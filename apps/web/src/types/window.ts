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
