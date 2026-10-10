import { useSites, useSwitchPlant } from "../../hooks/useSites";
import { useSiteStore } from "../../store/siteStore";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

/** Current plant, in the shared shell. One plant shows the name. More than one switches without a new login. */
export function SiteSwitcher() {
  const { data, currentSiteId, isLoading } = useSites();
  const siteScope = useSiteStore((s) => s.siteScope);
  const switchPlant = useSwitchPlant();
  const toast = useToast();
  if (isLoading || !data || data.sites.length === 0) return null;

  const showingAll = data.canViewAllSites === true && siteScope === "all";
  const current = data.sites.find((site) => site.id === currentSiteId) ?? data.sites.find((site) => site.status === "active") ?? data.sites[0];
  const choices = data.sites.filter((site) => site.status === "active" || site.id === current?.id);
  if (!current) return null;

  if (!data.canViewAllSites && choices.length < 2) {
    return <p className="aq-hide-sm max-w-[10rem] truncate text-xs text-muted-foreground" title={current.name}>{current.name}</p>;
  }

  return (
    <label className="aq-sel">
      <span className="sr-only">Plant</span>
      <select
        aria-label="Plant"
        className="aq-select"
        value={showingAll ? "all" : String(current.id)}
        disabled={switchPlant.isPending}
        onChange={(e) => {
          const raw = e.target.value;
          const target = raw === "all" ? "all" : Number(raw);
          switchPlant.mutate(target, {
            onError: (err) => toast.error(extractErrorMessage(err, "Couldn't switch plants.")),
          });
        }}
      >
        {data.canViewAllSites && <option value="all">All sites</option>}
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
