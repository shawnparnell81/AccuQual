# Billing setup (Stripe)

AccuQual bills companies through Stripe. Card details are only ever entered on Stripe's own pages; AccuQual stores a plan, a status and Stripe's ids, nothing else.

## What you set up in Stripe (once)

1. Create a Stripe account and stay in **test mode** until everything below works.
2. Create one **Product** per plan (Foundation, Operations, Enterprise), each with a **recurring price**. Set the prices there: they are not in the code.
3. Turn on the **Customer portal** (Settings > Billing > Customer portal): allow updating the card, viewing invoices and canceling.
4. Add a **webhook endpoint** pointing at `https://<your-api-address>/billing/webhook` for these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.

## What you set in AccuQual (env, and in Render for the api service)

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...` while testing) |
| `STRIPE_WEBHOOK_SECRET` | The webhook endpoint's signing secret (`whsec_...`) |
| `STRIPE_PRICE_FOUNDATION` / `_OPERATIONS` / `_ENTERPRISE` | The price id (`price_...`) for each plan. A plan with no price id shows "Not available yet" and can't be bought. |

Then apply migration `0072` (`billing_events`, `tenant_subscriptions`) to the database, and restart the api.

## How it works

- **Admin Console > Billing** shows the company's plan and status. Choosing a plan sends the admin to Stripe Checkout; **Manage billing** opens Stripe's customer portal.
- The plan and status shown in AccuQual are only ever changed by Stripe's webhook, never by the browser. The webhook verifies Stripe's signature, ignores a repeated event, and writes an audit-trail entry when the plan or status changes.
- A company can be given a **complimentary** plan by hand (`plan` and `status` both `complimentary` in `tenant_subscriptions`). Stripe never overwrites it and it can't start a checkout.
- A company that has never subscribed simply has no row: "No plan yet".

## Not done yet

- **Plans don't limit anything.** The three plans describe tiers, but no module is switched off by plan. Turning that on is a separate decision once prices are final.
- **No self-signup.** Companies are still created by an administrator; billing attaches to an existing company.
- **Trials, coupons and tax** are configured in Stripe (on the price or the Checkout settings), not in AccuQual.

## Testing locally

Use test mode and the Stripe CLI: `stripe listen --forward-to localhost:3000/billing/webhook` prints a `whsec_...` to use as `STRIPE_WEBHOOK_SECRET`. The test card is `4242 4242 4242 4242`.
