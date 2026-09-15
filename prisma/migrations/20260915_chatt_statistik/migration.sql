-- Chattstatistik från Camilla på stodona.se (Stodona, 2026-09-15).
--
-- chat_daily_stats: siffror per dag, sparas långsiktigt. Inga personuppgifter.
-- chat_questions:   anonymiserade frågor. Raderas efter 90 dagar av
--                   api/chatt/import-daily.
--
-- Idempotent: kan köras flera gånger utan att något förstörs.

CREATE TABLE IF NOT EXISTS "chat_daily_stats" (
  "id"           SERIAL PRIMARY KEY,
  "date"         DATE NOT NULL,
  "antal_samtal" INTEGER NOT NULL DEFAULT 0,
  "antal_fragor" INTEGER NOT NULL DEFAULT 0,
  "amnen"        JSONB NOT NULL DEFAULT '{}',
  "utfall"       JSONB NOT NULL DEFAULT '{}',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "chat_daily_stats_date_key" ON "chat_daily_stats" ("date");
CREATE INDEX IF NOT EXISTS "chat_daily_stats_date_idx" ON "chat_daily_stats" ("date" DESC);

CREATE TABLE IF NOT EXISTS "chat_questions" (
  "id"         SERIAL PRIMARY KEY,
  "date"       DATE NOT NULL,
  "samtals_id" TEXT NOT NULL,
  "tid"        TIMESTAMP(3) NOT NULL,
  "text"       TEXT NOT NULL,
  "amnen"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "utfall"     TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "chat_questions_date_idx" ON "chat_questions" ("date" DESC);
