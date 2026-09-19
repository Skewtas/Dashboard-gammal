-- Full chat-dialoger från stodona.se, sparade 7 dagar för sökbarhet.
-- Radering görs av cron chatt/purge-old — vi litar inte på ON DELETE.

CREATE TABLE "chat_dialogs" (
  "id"                SERIAL       PRIMARY KEY,
  "samtals_id"        TEXT         NOT NULL,
  "date"              DATE         NOT NULL,
  "meddelanden"       JSONB        NOT NULL,
  "antal_meddelanden" INTEGER      NOT NULL DEFAULT 0,
  "sok_text"          TEXT         NOT NULL,
  "imported_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_dialogs_samtals_id_key" UNIQUE ("samtals_id")
);

CREATE INDEX "chat_dialogs_date_idx" ON "chat_dialogs" ("date" DESC);
CREATE INDEX "chat_dialogs_samtals_id_idx" ON "chat_dialogs" ("samtals_id");
