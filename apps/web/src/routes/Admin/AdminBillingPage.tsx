import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Check } from "lucide-react";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { formatDate } from "../../lib/dates";

interface BillingPlan {
  id: string;
  name: string;
  summary: string;
  features: string[];
}
interface BillingInfo {
  billingEnabled: boolean;
  subscription: { plan: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; trialEndsAt: string | null; hasStripeCustomer: boolean } | null;
  availablePlans: string[];
  plans: BillingPlan[];
}

const STATUS_TEXT: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "text-emerald-500" },
  trialing: { label: "Trial", tone: "text-sky-500" },
  past_due: { label: "Payment overdue", tone: "text-amber-500" },
  canceled: { label: "Canceled", tone: "text-destructive" },
  incomplete: { label: "Not finished", tone: "text-muted-foreground" },
  complimentary: { label: "Complimentary", tone: "text-emerald-500" },
};

/**
 * Admin Console → Billing. A company's plan and status, starting a subscription, and reaching Stripe's own page for cards,
 * invoices and cancelling. Card details are only ever entered on Stripe's pages, never here.
 */
export function AdminBillingPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = useQuery<BillingInfo>({ queryKey: ["billing"], queryFn: async () => (await apiClient.get("/billing")).data });

  const goTo = useMutation({
    mutationFn: async (target: { kind: "checkout"; plan: string } | { kind: "portal" }) =>
      (await (target.kind === "checkout" ? apiClient.post<{ url: string }>("/billing/checkout", { plan: target.plan }) : apiClient.post<{ url: string }>("/billing/portal"))).data.url,
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't open billing.")),
  });

  // Coming back from Stripe: the webhook may land a few seconds after the redirect, so re-read a couple of times.
  const checkout = params.get("checkout");
  useEffect(() => {
    if (checkout !== "success") return;
    const timers = [2000, 6000, 12000].map((ms) => setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["billing"] }), ms));
    return () => timers.forEach(clearTimeout);
  }, [checkout, queryClient]);

  const sub = data?.subscription ?? null;
  const status = sub ? (STATUS_TEXT[sub.status] ?? { label: sub.status, tone: "text-muted-foreground" }) : null;
  const canManage = !!sub?.hasStripeCustomer;
  const live = !!sub && ["active", "trialing", "past_due"].includes(sub.status) && sub.plan !== "complimentary";

  return (
    <AdminOnlyGuard>
      <div className="flex max-w-4xl flex-col gap-5">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Billing</h1>
          <p className="text-sm text-muted-foreground">Your plan and payment. Card details are entered on Stripe&apos;s secure pages, never in AccuQual.</p>
        </div>

        {checkout === "success" && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm" role="status">
            <span>Thanks. Your payment went through. Your plan updates as soon as Stripe confirms it, which can take a few seconds.</span>
            <button type="button" className="text-xs underline" onClick={() => setParams({}, { replace: true })}>Dismiss</button>
          </div>
        )}
        {checkout === "canceled" && (
          <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground" role="status">Checkout was canceled. You haven&apos;t been charged.</div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {data && !data.billingEnabled && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Billing isn&apos;t switched on for this system yet. Your AccuQual administrator needs to connect Stripe first.
          </div>
        )}

        {data && (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Current plan</h2>
            {sub && status ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Plan</div>
                  <div className="text-lg font-semibold capitalize text-foreground">{sub.plan}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
                  <div className={`font-medium ${status.tone}`}>{status.label}</div>
                </div>
                {sub.currentPeriodEnd && live && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{sub.cancelAtPeriodEnd ? "Ends on" : "Renews on"}</div>
                    <div className="text-foreground">{formatDate(sub.currentPeriodEnd)}</div>
                  </div>
                )}
                {sub.trialEndsAt && sub.status === "trialing" && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Trial ends</div>
                    <div className="text-foreground">{formatDate(sub.trialEndsAt)}</div>
                  </div>
                )}
                {canManage && (
                  <button type="button" className="ml-auto rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60" disabled={goTo.isPending} onClick={() => goTo.mutate({ kind: "portal" })}>
                    Manage billing
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No plan yet. Choose one below to get started.</p>
            )}
            {sub?.status === "past_due" && <p className="mt-3 text-sm text-amber-500">Your last payment didn&apos;t go through. Use Manage billing to update your card.</p>}
            {sub?.cancelAtPeriodEnd && live && <p className="mt-3 text-sm text-muted-foreground">Your subscription is set to end at the close of this period.</p>}
          </section>
        )}

        {data && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Plans</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {data.plans.map((plan) => {
                const current = sub?.plan === plan.id && live;
                const buyable = data.billingEnabled && data.availablePlans.includes(plan.id) && !live && sub?.status !== "complimentary";
                return (
                  <div key={plan.id} className={`flex flex-col rounded-lg border bg-card p-4 ${current ? "border-primary" : "border-border"}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
                      {current && <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Your plan</span>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{plan.summary}</p>
                    <ul className="mt-3 flex flex-1 flex-col gap-1.5 text-sm text-foreground">
                      {plan.features.map((f) => (
                        <li key={f} className="flex gap-2">
                          <Check size={14} className="mt-1 shrink-0 text-emerald-500" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    {!current && (
                      <button
                        type="button"
                        className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!buyable || goTo.isPending}
                        onClick={() => goTo.mutate({ kind: "checkout", plan: plan.id })}
                        title={buyable ? undefined : live ? "Use Manage billing to change plans" : "This plan isn't available to buy yet"}
                      >
                        {buyable ? `Choose ${plan.name}` : live ? "Change in Manage billing" : "Not available yet"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </AdminOnlyGuard>
  );
}
