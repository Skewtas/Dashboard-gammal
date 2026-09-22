-- Besök på stodona.se, räknade av sajten själv utan cookies (2026-09-23).
-- Idempotent: kan köras flera gånger utan att något förstörs.

CREATE TABLE IF NOT EXISTS "site_traffic_daily" (
  "id"         SERIAL PRIMARY KEY,
  "date"       DATE NOT NULL,
  "besok"      INTEGER NOT NULL DEFAULT 0,
  "sidor"      JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "site_traffic_daily_date_key" ON "site_traffic_daily" ("date");
CREATE INDEX IF NOT EXISTS "site_traffic_daily_date_idx" ON "site_traffic_daily" ("date" DESC);
