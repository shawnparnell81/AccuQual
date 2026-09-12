import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { Modal } from "../modals/Modal";
import { TextField } from "../forms/Field";

interface Employee {
  id: number;
  name: string | null;
  email: string;
}

/** Assigns a course to one or more employees at once (POST /training/:id/assign) — creates a "pending" (schema's "assigned") record per employee, each with its own audit trail entry. */
export function TrainingAssignmentModal({ courseId, isOpen, onClose }: { courseId: number; isOpen: boolean; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dueAt, setDueAt] = useState("");
  const queryClient = useQueryClient();

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["training-employees"],
    queryFn: async () => (await apiClient.get("/training/employees")).data,
    enabled: isOpen,
  });

  const assign = useMutation({
    mutationFn: async () =>
      (await apiClient.post(`/training/${courseId}/assign`, { userIds: [...selected], dueAt: dueAt || undefined })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training-assignments", courseId] });
      setSelected(new Set());
      setDueAt("");
      onClose();
    },
  });

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal title="Assign Training" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          assign.mutate();
        }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium">Employees</label>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border">
            {employees.length === 0 && <p className="p-3 text-sm text-muted-foreground">No employees found.</p>}
            {employees.map((emp) => (
              <label key={emp.id} className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0 hover:bg-muted">
                <input type="checkbox" checked={selected.has(emp.id)} onChange={() => toggle(emp.id)} />
                <span>{emp.name ?? emp.email}</span>
                {emp.name && <span className="text-xs text-muted-foreground">{emp.email}</span>}
              </label>
            ))}
          </div>
        </div>
        <TextField label="Due Date (optional)" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        <button type="submit" disabled={assign.isPending || selected.size === 0} className="w-fit self-end rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
          {assign.isPending ? "Assigning…" : `Assign to ${selected.size || ""} Employee${selected.size === 1 ? "" : "s"}`}
        </button>
      </form>
    </Modal>
  );
}
