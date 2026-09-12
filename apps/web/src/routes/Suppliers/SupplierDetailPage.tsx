import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Supplier } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";

const supplierHooks = createResourceHooks<Supplier>("suppliers");

/** Supplier detail: the roster record plus its fillable supplier record and Approved Vendor List entry. */
export function SupplierDetailPage() {
  const { id } = useParams();
  const supplierId = Number(id);
  const { data: supplier, isLoading } = supplierHooks.useOne(supplierId);

  if (isLoading || !supplier) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{supplier.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={supplier.status} />
            <StatusBadge value={supplier.riskLevel} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenFormButton formType="supplier" entityId={supplier.id} title={`Supplier #${supplier.id} Record`} label="Supplier Record" />
          <OpenFormButton
            formType="approved_vendor_list"
            entityId={supplier.id}
            title={`Supplier #${supplier.id} — Approved Vendor List`}
            label="Approved Vendor List"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Contact: {supplier.contactEmail ?? "—"}
      </div>
    </div>
  );
}
