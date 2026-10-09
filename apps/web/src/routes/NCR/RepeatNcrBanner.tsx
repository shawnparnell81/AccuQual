import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import type { Capa } from "../../api/types";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { recordHeading } from "../../lib/userRecordNumber";

interface RepeatMatch {
  id: number;
  recordNumber?: string | null;
  title: string;
  part: string | null;
  defectCode: string | null;
  createdAt: string;
}

interface RepeatReport {
  isRepeat: boolean;
  threshold: number;
  windowDays: number;
  openCapaId: number | null;
  matches: RepeatMatch[];
}

/** Sits above the NCR form. It does not add or move any form field. */
export function RepeatNcrBanner({ ncrId, canEdit }: { ncrId: number; canEdit: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data } = useQuery<RepeatReport>({
    queryKey: ["ncr-repeats", ncrId],
    queryFn: async () => (await apiClient.get(`/ncr/${ncrId}/repeats`)).data,
  });
  const openCapa = useMutation({
    mutationFn: async () => (await apiClient.post<Capa>("/capa/from-repeat", { ncrId })).data,
    onSuccess: (capa) => {
      void queryClient.invalidateQueries({ queryKey: ["ncr-repeats", ncrId] });
      void queryClient.invalidateQueries({ queryKey: ["capa"] });
      navigate(`/capa/${capa.id}`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't open a CAPA for this repeat.")),
  });

  if (!data?.isRepeat) return null;
  const others = data.matches.filter((match) => match.id !== ncrId);

  return (
    <section className="no-print rounded-lg border border-amber-500/40 bg-amber-500/10 p-4" aria-label="Repeat issue">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Repeat issue — consider a CAPA</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.matches.length} similar NCRs in the last {data.windowDays} days (the threshold is {data.threshold}). A CAPA can cover the group.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => openCapa.mutate()} disabled={openCapa.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            Open CAPA
          </button>
        )}
        {!canEdit && data.openCapaId && (
          <Link to={`/capa/${data.openCapaId}`} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Open CAPA
          </Link>
        )}
      </div>
      {others.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {others.map((match) => (
            <li key={match.id}>
              <Link to={`/ncr/${match.id}`} className="text-primary hover:underline">
                {recordHeading("NCR", match.recordNumber)}
              </Link>
              <span className="text-muted-foreground">
                {" "}
                — {match.title}
                {match.part ? ` · ${match.part}` : ""}
                {match.defectCode ? ` · ${match.defectCode}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
