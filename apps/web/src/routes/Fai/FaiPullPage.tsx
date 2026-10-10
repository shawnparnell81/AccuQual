import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useFaiLookups, useFaiPulls, useFaiRecords, useInvalidateFai } from "../../api/fai";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCurrentUser } from "../../hooks/useAuth";
import { canApproveFai, formalDate } from "../../lib/faiLogic";
import { peopleForAssignment, personLabel } from "../../lib/opsLanguage";

export function FaiPullPage() {
  const pulls = useFaiPulls();
  const lookups = useFaiLookups();
  const records = useFaiRecords();
  const invalidate = useInvalidateFai();
  const user = useCurrentUser();
  const quality = canApproveFai({ roleName: user?.roleName, department: user?.department });
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<Record<string, string>>({});
  const [faiId, setFaiId] = useState<Record<string, string>>({});

  const assign = useMutation({
    mutationFn: async (input: { partNumber: string; userId: number }) => apiClient.post("/fai/pulls/assign", input),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (err) => setError(extractErrorMessage(err, "The pull could not be assigned.")),
  });
  const complete = useMutation({
    mutationFn: async (partNumber: string) =>
      apiClient.post("/fai/pulls/complete", {
        partNumber,
        faiId: faiId[partNumber] ? Number(faiId[partNumber]) : null,
      }),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (err) => setError(extractErrorMessage(err, "The pull could not be recorded.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/fai" className="text-xs text-primary hover:underline">First Article</Link>
        <h1 className="text-2xl font-semibold">Yearly pull</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Parts on an inspection plan or source list with no completed pull in the last 12 months. Recording the pull does not move material, open a transfer, or choose a sample quantity.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {pulls.isLoading && <p className="text-sm text-muted-foreground">Loading the pull list…</p>}
      {pulls.isError && <p className="text-sm text-destructive">The pull list could not be loaded.</p>}
      {!pulls.isLoading && pulls.data?.due.length === 0 && <p className="text-sm text-muted-foreground">Every in-scope part has a pull recorded in the last 12 months.</p>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Part</th>
              <th className="px-3 py-2 font-medium">Last pull</th>
              <th className="px-3 py-2 font-medium">Assigned</th>
              <th className="px-3 py-2 font-medium">First article</th>
              <th className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {pulls.data?.due.map((row) => {
              const chosen = assignee[row.partNumber] ?? (row.assignedTo ? String(row.assignedTo) : "");
              const mayRecord = quality || user?.id === row.assignedTo;
              return (
              <tr key={row.partNumber} className="border-t border-border">
                <td className="px-3 py-2">{row.partNumber}{row.partName ? ` — ${row.partName}` : ""}</td>
                <td className="px-3 py-2">{row.lastCompletedOn ? formalDate(row.lastCompletedOn) : "None"}</td>
                <td className="px-3 py-2">
                  {quality ? (
                    <select className="rounded-md border border-border bg-background px-2 py-1" aria-label={`Assign ${row.partNumber}`} value={chosen} onChange={(event) => setAssignee((current) => ({ ...current, [row.partNumber]: event.target.value }))}>
                      <option value="">Select</option>
                      {peopleForAssignment(lookups.data?.people ?? [], row.assignedTo).map((person) => (
                        <option key={person.id} value={person.id}>{person.name?.trim() || person.email}</option>
                      ))}
                    </select>
                  ) : (
                    personLabel(lookups.data?.people, row.assignedTo)
                  )}
                </td>
                <td className="px-3 py-2">
                  <select className="rounded-md border border-border bg-background px-2 py-1" aria-label={`Link first article ${row.partNumber}`} value={faiId[row.partNumber] ?? ""} onChange={(event) => setFaiId((current) => ({ ...current, [row.partNumber]: event.target.value }))}>
                    <option value="">None</option>
                    {records.data?.filter((item) => item.partNumber === row.partNumber).map((item) => (
                      <option key={item.id} value={item.id}>{item.number}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {quality && (
                      <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" disabled={!chosen || assign.isPending} onClick={() => assign.mutate({ partNumber: row.partNumber, userId: Number(chosen) })}>
                        Assign
                      </button>
                    )}
                    {mayRecord && (
                      <button type="button" className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-60" disabled={complete.isPending} onClick={() => complete.mutate(row.partNumber)}>
                        Record pull
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
