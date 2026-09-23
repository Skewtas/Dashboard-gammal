/**
 * One-off migration för chat_dialogs-tabellen.
 * Idempotent — kör bara CREATE IF NOT EXISTS.
 *
 * Kör: GET /api/admin-migrate-chat-dialogs?secret=<CRON_SECRET>
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './_lib/prisma.js';

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const provided = String(req.query.secret || '');
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Idempotenta CREATE IF NOT EXISTS så att endpointen alltid är säker
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "chat_dialogs" (
        "id"                SERIAL       PRIMARY KEY,
        "samtals_id"        TEXT         NOT NULL,
        "date"              DATE         NOT NULL,
        "meddelanden"       JSONB        NOT NULL,
        "antal_meddelanden" INTEGER      NOT NULL DEFAULT 0,
        "sok_text"          TEXT         NOT NULL,
        "imported_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'chat_dialogs_samtals_id_key') THEN
          ALTER TABLE "chat_dialogs" ADD CONSTRAINT "chat_dialogs_samtals_id_key" UNIQUE ("samtals_id");
        END IF;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "chat_dialogs_date_idx" ON "chat_dialogs" ("date" DESC)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "chat_dialogs_samtals_id_idx" ON "chat_dialogs" ("samtals_id")`);

    const rows: Array<{ tablename: string }> = await prisma.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'chat_dialogs'`
    );

    return res.json({
      ok: true,
      tabellenFinns: rows.length > 0,
      message: rows.length > 0 ? 'chat_dialogs klar att användas' : 'Något gick fel — tabellen skapades inte',
    });
  } catch (err: any) {
    console.error('[admin-migrate-chat-dialogs]', err?.message);
    return res.status(500).json({ error: err?.message || 'Migration misslyckades' });
  }
}
