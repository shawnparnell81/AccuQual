import { useSites, useSwitchPlant } from "../../hooks/useSites";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

/** Current plant, in the shared shell. One plant shows the name. More than one switches without a new login. */
export function SiteSwitcher() {
  const { data, currentSiteId, isLoading } = useSites();
  const switchPlant = useSwitchPlant();
  const toast = useToast();
  if (isLoading || !data || data.sites.length === 0) return null;

  const current = data.sites.find((site) => site.id === currentSiteId) ?? data.sites.find((site) => site.status === "active") ?? data.sites[0];
  const choices = data.sites.filter((site) => site.status === "active" || site.id === current?.id);
  if (!current) return null;

  if (choices.length < 2) {
    return <p className="aq-hide-sm max-w-[10rem] truncate text-xs text-muted-foreground">{current.name}</p>;
  }

  return (
    <label className="aq-sel">
      <span className="sr-only">Plant</span>
      <select
        aria-label="Plant"
        className="aq-select"
        value={current.id}
        disabled={switchPlant.isPending}
        onChange={(e) => {
          const siteId = Number(e.target.value);
          switchPlant.mutate(siteId, {
            onError: (err) => toast.error(extractErrorMessage(err, "Couldn't switch plants.")),
          });
        }}
      >
        {choices.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
            {site.isDefault ? " (main)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
