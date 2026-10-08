# Security

## Reporting a vulnerability

Do not open a public issue for a security problem.

Report it through GitHub: this repository's Security tab, then Report a vulnerability. Include what you found, how to reproduce it, and the impact. You will get an acknowledgement, and we will keep you informed as it is investigated and fixed.

Do not test against other people's data, and do not run tests that degrade the service for others (denial of service, mass automated scanning).

## What runs automatically

Every change, and a weekly schedule, runs a dependency audit (production dependencies fail the build at high severity) and a secret scan of the full git history. CodeQL is not run. Code scanning is not enabled on this private repository, and a job that exited 0 without scanning was removed so CI does not report a scan that did not happen. A vulnerability scan of every container image runs weekly and on merges to main. Dependabot proposes dependency updates. See `DEPLOY.md`, section "Security scanning".

AccuQual is not certified by ISO, IATF, or any other standards body.
