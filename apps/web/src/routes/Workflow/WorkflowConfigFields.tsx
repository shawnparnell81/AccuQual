import { useState } from "react";
import { TextField, SelectField } from "../../components/forms/Field";
import type { WfNode } from "./canvas/graph";

// Field editors for a node's configuration, shared by the canvas inspector. (Moved here from the old list-based
// builder unchanged — same fields, same config keys the engine reads.)

type WorkflowNode = WfNode;

export const TRIGGER_KINDS = [
  "closed",
  "close",
  "verify",
  "step_completed",
  "approved",
  "rejected",
  "quarantined",
  "accepted",
  "auto_created_from_receiving",
  "escalated_from_receiving",
  "reorder-sent",
];
export const CONDITION_OPERATORS = ["equals", "notEquals", "in", "greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual", "contains"] as const;
type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
export const DEPARTMENT_OPTIONS = ["quality", "engineering", "production", "customer_service", "purchasing", "material_management", "sales_and_marketing"];

/** A condition node's config, rendered/edited as (field, operator, value) rather than a raw JSON blob. */
export function ConditionFields({ node, onChange }: { node: WorkflowNode; onChange: (config: Record<string, unknown>) => void }) {
  const config = node.config as { field?: string; equals?: unknown; notEquals?: unknown; in?: unknown[]; greaterThan?: number; greaterOrEqual?: number; lessThan?: number; lessOrEqual?: number; contains?: string };
  const [operator, setOperator] = useState<ConditionOperator>(
    (Object.keys(config).find((k) => CONDITION_OPERATORS.includes(k as ConditionOperator)) as ConditionOperator) ?? "equals"
  );
  const rawValue = config[operator as keyof typeof config];
  const [valueText, setValueText] = useState(Array.isArray(rawValue) ? rawValue.join(", ") : rawValue !== undefined ? String(rawValue) : "");

  function commit(nextOperator: ConditionOperator, nextValueText: string) {
    const isNumeric = nextOperator === "greaterThan" || nextOperator === "greaterOrEqual" || nextOperator === "lessThan" || nextOperator === "lessOrEqual";
    const value: unknown = nextOperator === "in" ? nextValueText.split(",").map((v) => v.trim()).filter(Boolean) : isNumeric ? Number(nextValueText) : nextValueText;
    onChange({ field: config.field, [nextOperator]: value });
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      <TextField label="Field (from event context)" placeholder="e.g. severity, supplierId, defectCategory" value={config.field ?? ""} onChange={(e) => onChange({ ...config, field: e.target.value })} />
      <SelectField
        label="Operator"
        value={operator}
        onChange={(e) => {
          const next = e.target.value as ConditionOperator;
          setOperator(next);
          commit(next, valueText);
        }}
      >
        {CONDITION_OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </SelectField>
      <TextField
        label={operator === "in" ? "Value (comma-separated)" : "Value"}
        value={valueText}
        onChange={(e) => {
          setValueText(e.target.value);
          commit(operator, e.target.value);
        }}
      />
    </div>
  );
}

/** An action node's config — fields shown depend on the real, registered action kind (see workflowActions.ts for what each one actually reads). */
export function ActionFields({ node, onChange }: { node: WorkflowNode; onChange: (config: Record<string, unknown>) => void }) {
  const config = node.config as Record<string, string | undefined>;
  const set = (key: string, value: string) => onChange({ ...config, [key]: value });

  switch (node.kind) {
    case "send_email":
      return (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="To (literal email, optional)" value={config.to ?? ""} onChange={(e) => set("to", e.target.value)} />
          <TextField label="To field (context key, optional)" placeholder="e.g. contactEmail" value={config.toField ?? ""} onChange={(e) => set("toField", e.target.value)} />
          <TextField label="Subject" value={config.subject ?? ""} onChange={(e) => set("subject", e.target.value)} />
          <TextField label="Body" value={config.body ?? ""} onChange={(e) => set("body", e.target.value)} />
        </div>
      );
    case "notify_department":
      return (
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Department" value={config.department ?? ""} onChange={(e) => set("department", e.target.value)}>
            <option value="">Select…</option>
            {DEPARTMENT_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d.replace(/_/g, " ")}
              </option>
            ))}
          </SelectField>
          <TextField label="Subject" value={config.subject ?? ""} onChange={(e) => set("subject", e.target.value)} />
          <TextField label="Body" value={config.body ?? ""} onChange={(e) => set("body", e.target.value)} />
        </div>
      );
    case "notify_supplier":
      return (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Subject" value={config.subject ?? ""} onChange={(e) => set("subject", e.target.value)} />
          <TextField label="Body" value={config.body ?? ""} onChange={(e) => set("body", e.target.value)} />
        </div>
      );
    case "create_ncr":
      return (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Title (supports {{field}})" value={config.title ?? ""} onChange={(e) => set("title", e.target.value)} />
          <TextField label="Description" value={config.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          <SelectField label="Severity" value={config.severity ?? ""} onChange={(e) => set("severity", e.target.value)}>
            <option value="">Unset</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </SelectField>
        </div>
      );
    case "escalate_capa":
      return <TextField label="Root cause (supports {{field}})" value={config.rootCause ?? ""} onChange={(e) => set("rootCause", e.target.value)} />;
    case "assign_user":
      return (
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Module" value={config.module ?? ""} onChange={(e) => set("module", e.target.value)}>
            <option value="">Select…</option>
            <option value="ncr">NCR</option>
            <option value="capa">CAPA</option>
          </SelectField>
          <TextField label="User ID" type="number" value={config.userId ?? ""} onChange={(e) => set("userId", e.target.value)} />
        </div>
      );
    case "ai_suggestion":
      return <p className="text-xs text-muted-foreground">No configuration needed — calls the workflow AI-note pipeline with this run's full event context.</p>;
    default:
      return <p className="text-xs text-muted-foreground">Unrecognized action kind — check Health for details.</p>;
  }
}

