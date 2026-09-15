/**
 * Hämtar chattstatistiken från stodona.se och sparar den i Head of.
 *
 * Körs av Vercel cron varje natt. Hämtar både gårdagen (som då är komplett)
 * och idag (samtal hittills), så att fliken CHATT också visar dagens läge när
 * jobbet triggas manuellt. En enskild dag kan hämtas med ?dag=ÅÅÅÅ-MM-DD.
 *
 * Sparar:
 *  - chat_daily_stats: siffror per dag, sparas långsiktigt.
 *  - chat_questions:   anonymiserade frågor. Dagens frågor ersätts helt vid
 *    varje körning, eftersom ett samtal kan ha fått fler frågor sedan sist.
 * Rensar samtidigt frågor äldre än 90 dagar – Stodonas beslut 2026-09-15.
 *
 * Auth: Bearer <CRON_SECRET> (Vercel cron) eller ?secret=<CRON_SECRET>.
 * Miljö: CHAT_STATS_SECRET – samma värde som på stodona.se.
 *        STODONA_SITE_URL – valfri, standard https://stodona.se.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

const LAGRINGSDAGAR_FRAGOR = 90;

type Samtal = {
  id: string;
  dag: string;
  fragor: { tid: string; text: string; amnen: string[] }[];
  utfall: string;
};

type DagSvar = {
  dag: string;
  sammanstallning: {
    antalSamtal: number;
    antalFragor: number;
    amnen: Record<string, number>;
    utfall: Record<string, number>;
  };
  samtal: Samtal[];
};

function ymdSthlm(d: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${day}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const authHdr = req.headers.authorization || '';
  const isCron = secret && authHdr === `Bearer ${secret}`;
  const isQuerySecret = secret && req.query.secret === secret;
  // Till skillnad från vissa äldre jobb är det här stängt även om CRON_SECRET
  // saknas – det skriver till databasen och ska aldrig vara öppet.
  if (!secret || (!isCron && !isQuerySecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const statsSecret = process.env.CHAT_STATS_SECRET;
  if (!statsSecret) {
    return res.status(503).json({ error: 'CHAT_STATS_SECRET saknas i miljön' });
  }
  const bas = (process.env.STODONA_SITE_URL || 'https://stodona.se').replace(/\/$/, '');

  const enDag = typeof req.query.dag === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dag) ? req.query.dag : null;
  const dagar = enDag ? [enDag] : [ymdSthlm(new Date(Date.now() - 24 * 3600 * 1000)), ymdSthlm(new Date())];

  const resultat: Array<Record<string, unknown>> = [];

  for (const dag of dagar) {
    try {
      const r = await fetch(`${bas}/api/chat-statistik?dag=${dag}`, {
        headers: { Authorization: `Bearer ${statsSecret}` },
      });
      if (!r.ok) {
        resultat.push({ dag, fel: `stodona.se svarade ${r.status}` });
        continue;
      }
      const d = (await r.json()) as DagSvar;
      const datum = new Date(`${dag}T00:00:00.000Z`);
      const siffror = {
        antalSamtal: Number(d.sammanstallning?.antalSamtal ?? 0),
        antalFragor: Number(d.sammanstallning?.antalFragor ?? 0),
        amnen: (d.sammanstallning?.amnen ?? {}) as any,
        utfall: (d.sammanstallning?.utfall ?? {}) as any,
      };

      await prisma.chatDagStatistik.upsert({
        where: { date: datum },
        create: { date: datum, ...siffror },
        update: { ...siffror, updatedAt: new Date() },
      });

      const fragor = (d.samtal ?? []).flatMap((s) =>
        (s.fragor ?? []).map((f) => ({
          date: datum,
          samtalsId: String(s.id).slice(0, 64),
          tid: new Date(f.tid),
          text: String(f.text).slice(0, 500),
          amnen: Array.isArray(f.amnen) ? f.amnen.map(String).slice(0, 10) : [],
          utfall: String(s.utfall).slice(0, 40),
        }))
      );
      await prisma.$transaction([
        prisma.chatFraga.deleteMany({ where: { date: datum } }),
        prisma.chatFraga.createMany({ data: fragor }),
      ]);

      resultat.push({ dag, samtal: siffror.antalSamtal, fragor: fragor.length });
    } catch (e: any) {
      console.error(`[chatt/import-daily] ${dag}:`, e?.message);
      resultat.push({ dag, fel: e?.message ?? 'okänt fel' });
    }
  }

  const grans = new Date(Date.now() - LAGRINGSDAGAR_FRAGOR * 24 * 3600 * 1000);
  const rensade = await prisma.chatFraga.deleteMany({ where: { date: { lt: grans } } });

  return res.json({ ok: true, resultat, rensadeFragor: rensade.count });
}
