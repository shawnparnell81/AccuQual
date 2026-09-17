-- Optional: run this after the base migrations if TimescaleDB is available.
-- Converts iot_data into a TimescaleDB hypertable partitioned on `timestamp`,
-- which is the recommended storage for AccuQual's IoT/digital-twin time-series data.
--
-- NOT applicable to this app's real, documented production deployment
-- (Supabase — see DEPLOY.md): Supabase's managed Postgres doesn't offer the
-- timescaledb extension at all. Only run this against a self-hosted Postgres
-- or a managed Timescale Cloud instance.
--
-- Usage: npm run db:apply-timescale --workspace services/api
-- (runs this same SQL via a real pg connection — see db/applyTimescaleHypertables.ts;
-- a raw `psql "$DATABASE_URL" -f ...` still works too if you prefer it.)

CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable('iot_data', 'timestamp', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS iot_data_device_id_timestamp_idx
  ON iot_data (device_id, timestamp DESC);
