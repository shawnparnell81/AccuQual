# Security

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it privately through GitHub: this repository's **Security** tab → **Report a vulnerability**. Include what you
found, how to reproduce it, and what you think the impact is. You'll get an acknowledgement, and we'll keep you
informed as it is investigated and fixed.

Please don't test against other people's data or organizations, and don't run tests that degrade the service for
others (denial of service, mass automated scanning).

## What is checked automatically

Every change and a weekly schedule run: dependency vulnerability audit (production dependencies fail the build at
high severity), CodeQL code scanning, secret scanning over the full git history, and — weekly and on merges — a vulnerability scan of every
container image. Dependabot proposes dependency updates. See `DEPLOY.md` → "Security scanning".

AccuQual is not certified by ISO, IATF, or any other standards body.
