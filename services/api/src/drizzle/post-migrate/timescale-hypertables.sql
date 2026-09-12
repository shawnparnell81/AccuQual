-- Optional: run this after the base migrations if TimescaleDB is available.
-- Converts iot_data into a TimescaleDB hypertable partitioned on `timestamp`,
-- which is the recommended storage for AccuQual's IoT/digital-twin time-series data.
--
-- Usage: psql "$DATABASE_URL" -f src/drizzle/post-migrate/timescale-hypertables.sql

CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable('iot_data', 'timestamp', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS iot_data_device_id_timestamp_idx
  ON iot_data (device_id, timestamp DESC);
