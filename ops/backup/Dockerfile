# The backup tool's runtime: pg_dump/pg_restore 17 (matching the database), Node for the script, openssl for encryption,
# the aws CLI for any S3-compatible bucket. Built and used by .github/workflows/backup.yml and ops/backup/restore-drill.sh,
# so the environment that is tested is the environment that runs.
FROM pgvector/pgvector:pg17
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs awscli openssl tar ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /ops
COPY ops/backup/backup.mjs ./backup.mjs
USER 65534:65534
ENV HOME=/tmp
ENTRYPOINT ["node", "/ops/backup.mjs"]
