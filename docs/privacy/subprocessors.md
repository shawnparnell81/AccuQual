# AccuQual — subprocessors and service providers

_The outside services that may handle customer data on AccuQual's behalf. Kept in the repository so it changes with
the code; update it in the same change that adds or removes a service. Items marked **[confirm]** need a value from the
account before this list is shared with a customer._

## Services that process customer data

| Provider | Purpose | Customer data involved | Location | Always used? |
|---|---|---|---|---|
| **Supabase** (PostgreSQL) | Hosts the database: all records, accounts and audit history | All stored customer data | **[confirm region]** | Yes |
| **Render** | Hosts the API, web app and background workers, and the Redis event queue | Data in transit through the application; queue messages (record ids and event types); application file storage if hosted there | **[confirm region]** | Yes (production) |
| **Zoho ZeptoMail** | Sends the system's emails (password resets, notices, supplier messages) | Recipient address, subject and body of each email | **[confirm data centre]** | Yes, when email is configured |
| **Anthropic** | Powers AI suggestions and the assistant | The text of the record being analysed and the prompt; results | United States **[confirm]** | Only when an AI feature is used. An organization may supply its own provider key; without one, AccuQual's key is used |
| **OpenAI** | Optional alternative AI provider | Same as above | United States **[confirm]** | Only if configured (not currently) |
| **Sentry** | Error tracking | Error details, numeric user ids, request reference; no request bodies, cookies, headers, emails or IP addresses | **[confirm region]** | Only if `SENTRY_DSN` is set |

## Services that do not receive customer data

| Provider | Purpose | Notes |
|---|---|---|
| Healthchecks.io (or similar) | Notices when the API stops running | Receives only "still alive" pings, no data |
| UptimeRobot (or similar) | Checks the public health URL | Receives only the health status page |
| Slack / Discord | Operational alerts to the team | Alert text contains counts and service names, not customer records |
| GitHub | Source code and automated tests | No customer data. Tests use generated data |

## Changes

- Adding or replacing a subprocessor that handles customer data: update this file and notify customers in advance,
  as the customer agreement requires. **[decide the notice period, e.g. 30 days]**
- A customer that uses its own AI provider key sends AI requests directly under its own agreement with that provider.

## Last reviewed

**[date]**
