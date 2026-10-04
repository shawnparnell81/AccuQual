import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { DEPARTMENTS } from "../../components/layout/navConfig";
import type { DepartmentPermissionCell, ModuleAccessLevel, PermissionModuleInfo } from "../../api/types";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

const LEVEL_LABEL: Record<ModuleAccessLevel, string> = { none: "None", read: "Read", edit: "Edit" };

/**
 * The direct replacement for PERMISSION_MATRIX — every (department, module)
 * cell, auto-saving on change (same "toggle, no Save button" convention as
 * Settings > Navigation's own hide/show grid). A dimmed cell with no reset
 * button is running on the shipped default; a full-contrast cell with a
 * reset (↺) button is an explicit company override.
 */
export function PermissionsDepartmentAccessTab() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: modules = [] } = useQuery<PermissionModuleInfo[]>({
    queryKey: ["permissions", "modules"],
    queryFn: async () => (await apiClient.get("/permissions/modules")).data,
  });
  const { data: grid = [], isLoading } = useQuery<DepartmentPermissionCell[]>({
    queryKey: ["permissions", "department-permissions"],
    queryFn: async () => (await apiClient.get("/permissions/department-permissions")).data,
  });

  const cellByKey = useMemo(() => new Map(grid.map((c) => [`${c.departmentName}:${c.moduleName}`, c])), [grid]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["permissions", "department-permissions"] });
    queryClient.invalidateQueries({ queryKey: ["permissions", "effective"] });
  };

  const setLevel = useMutation({
    mutationFn: async ({ departmentName, moduleName, accessLevel }: { departmentName: string; moduleName: string; accessLevel: ModuleAccessLevel }) =>
      (await apiClient.patch("/permissions/department-permissions", { departmentName, moduleName, accessLevel })).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update that permission.")),
  });

  const resetToDefault = useMutation({
    mutationFn: async ({ departmentName, moduleName }: { departmentName: string; moduleName: string }) =>
      apiClient.delete("/permissions/department-permissions", { data: { departmentName, moduleName } }),
    onSuccess: () => {
      invalidate();
      toast.success("Reverted to the default.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't reset that permission.")),
  });

  if (isLoading) return <LoadingPlaceholder />;

  return (
    <div className="max-w-full rounded-lg border border-border">
      <table className="aq-fit-table text-sm">
        <colgroup>
          <col style={{ width: "22%" }} />
          {DEPARTMENTS.map((d) => (
            <col key={d.key} />
          ))}
        </colgroup>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-1.5 py-2">Module</th>
            {DEPARTMENTS.map((d) => (
              <th key={d.key} className="px-1 py-2">
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => (
            <tr key={m.key} className="border-t border-border">
              <td className="bg-card px-1.5 py-1.5 font-medium">{m.label}</td>
              {DEPARTMENTS.map((d) => {
                const cell = cellByKey.get(`${d.key}:${m.key}`);
                const level = cell?.accessLevel ?? "none";
                const isOverride = cell?.isOverride ?? false;
                return (
                  <td key={d.key} className="px-1 py-1.5">
                    <div className="flex min-w-0 flex-col items-stretch gap-0.5">
                      <select
                        aria-label={`${m.label} for ${d.label}`}
                        value={level}
                        onChange={(e) => setLevel.mutate({ departmentName: d.key, moduleName: m.key, accessLevel: e.target.value as ModuleAccessLevel })}
                        className={`w-full min-w-0 max-w-full rounded-md border px-1 py-1 text-xs ${
                          isOverride ? "border-primary/40 bg-primary/5 font-medium text-foreground" : "border-border bg-transparent text-muted-foreground"
                        }`}
                      >
                        {(Object.keys(LEVEL_LABEL) as ModuleAccessLevel[]).map((lvl) => (
                          <option key={lvl} value={lvl}>
                            {LEVEL_LABEL[lvl]}
                          </option>
                        ))}
                      </select>
                      {isOverride && (
                        <button
                          onClick={() => resetToDefault.mutate({ departmentName: d.key, moduleName: m.key })}
                          title="Reset to default"
                          className="self-start rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
