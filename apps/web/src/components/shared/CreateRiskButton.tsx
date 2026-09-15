import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { RiskAssessment } from "../../api/types";
import { Modal } from "../modals/Modal";
import { TextField, TextAreaField, SelectField } from "../forms/Field";
import { RISK_CATEGORIES } from "./riskConstants";

const riskHooks = createResourceHooks<RiskAssessment>("risk");

interface CreateRiskButtonProps {
  /** One of the module's real integration points — see risk.validation.ts's RISK_SOURCE_TYPES. */
  sourceType: "NCR" | "Supplier" | "Receiving" | "WorkOrder" | "Customer";
  sourceId: number;
  /** Pre-fills the risk title so the user isn't typing the source record's own name again. */
  defaultTitle: string;
  /** Pre-fills department (e.g. "purchasing" from a Receiving document, "production" from a Work Order). */
  defaultDepartment?: string;
  defaultCategory?: (typeof RISK_CATEGORIES)[number];
  label?: string;
}

/**
 * The one "Create Risk from this record" button/modal, reused on NCR,
 * Supplier, Receiving (a PO's receiving documents), and Work Order detail
 * pages — see the Risk Management module's Integration Points requirement.
 * A single shared component so all four stay in sync instead of four
 * near-duplicate bespoke forms.
 */
export function CreateRiskButton({ sourceType, sourceId, defaultTitle, defaultDepartment, defaultCategory, label = "Create Risk" }: CreateRiskButtonProps) {
  const navigate = useNavigate();
  const createRisk = riskHooks.useCreate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(defaultCategory ?? "process");
  const [department, setDepartment] = useState(defaultDepartment ?? "");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
        {label}
      </button>
      <Modal title={`Create Risk from this ${sourceType}`} isOpen={open} onClose={() => setOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createRisk.mutate(
              { title, description: description || undefined, category: category as never, department: department || undefined, sourceType, sourceId } as never,
              { onSuccess: (created) => navigate(`/risk/${created.id}`) }
            );
          }}
        >
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextAreaField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {RISK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
          <TextField label="Owning department (optional)" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="quality, engineering, production…" />
          <p className="text-xs text-muted-foreground">Linked to this {sourceType} (#{sourceId}) automatically. Severity, probability, and a mitigation plan can be added — or AI-suggested — from the new risk's own page.</p>
          <button type="submit" disabled={createRisk.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {createRisk.isPending ? "Creating…" : "Create Risk"}
          </button>
        </form>
      </Modal>
    </>
  );
}
