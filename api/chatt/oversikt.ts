/**
 * Data till fliken CHATT – vad kunderna frågar Camilla om på stodona.se.
 *
 * GET /api/chatt/oversikt?dagar=7|30|90
 *
 * Kräver inloggning (Clerk-session), eftersom svaret innehåller kundernas
 * frågor. De är anonymiserade, men anonymiseringen är ett skyddsnät och ingen
 * garanti – så de visas bara för inloggad personal.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '@clerk/backend';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 30 };

async function inloggadAnvandare(req: VercelRequest): Promise<string | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;
  const franCookie = (req.headers.cookie || '').match(/__session=([^;]+)/)?.[1];
  const franHeader = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
  const token = franCookie || franHeader;
  if (!token) return null;
  try {
    const payload = await verifyToken(token, { secretKey });
    return (payload as any)?.sub ?? null;
  } catch {
    return null;
  }
}

function summera(rader: Array<Record<string, number>>) {
  const totalt: Record<string, number> = {};
  for (const r of rader) for (const [k, v] of Object.entries(r ?? {})) totalt[k] = (totalt[k] ?? 0) + Number(v);
  return Object.entries(totalt)
    .map(([namn, antal]) => ({ namn, antal }))
    .sort((a, b) => b.antal - a.antal);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await inloggadAnvandare(req))) return res.status(401).json({ error: 'Unauthorized' });

  const dagar = [7, 30, 90].includes(Number(req.query.dagar)) ? Number(req.query.dagar) : 30;
  const fran = new Date(`${new Date(Date.now() - (dagar - 1) * 24 * 3600 * 1000).toISOString().slice(0, 10)}T00:00:00.000Z`);

  try {
    const [rader, fragor, trafik] = await Promise.all([
      prisma.chatDagStatistik.findMany({ where: { date: { gte: fran } }, orderBy: { date: 'asc' } }),
      prisma.chatFraga.findMany({ where: { date: { gte: fran } }, orderBy: { tid: 'desc' }, take: 1000 }),
      // Besök på sajten, räknade utan cookies – se api/trafik-statistik på stodona.se.
      // Saknas tabellen ännu (migrationen inte körd) ska fliken fungera ändå.
      prisma.trafikDagStatistik
        .findMany({ where: { date: { gte: fran } }, orderBy: { date: 'asc' } })
        .catch((e: any) => {
          console.error('[chatt/oversikt] trafik:', e?.message);
          return [] as Array<{ date: Date; besok: number; sidor: unknown }>;
        }),
    ]);

    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      dagar: rader.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        antalSamtal: r.antalSamtal,
        antalFragor: r.antalFragor,
      })),
      amnen: summera(rader.map((r) => r.amnen as Record<string, number>)),
      utfall: summera(rader.map((r) => r.utfall as Record<string, number>)),
      totalt: {
        samtal: rader.reduce((n, r) => n + r.antalSamtal, 0),
        fragor: rader.reduce((n, r) => n + r.antalFragor, 0),
      },
      fragor: fragor.map((f) => ({ tid: f.tid.toISOString(), text: f.text, amnen: f.amnen, utfall: f.utfall })),
      trafik: {
        dagar: trafik.map((t) => ({ date: t.date.toISOString().slice(0, 10), besok: t.besok })),
        totalt: trafik.reduce((n, t) => n + t.besok, 0),
        sidor: Object.entries((trafik[trafik.length - 1]?.sidor ?? {}) as Record<string, number>)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([sida, besok]) => ({ sida, besok })),
      },
      senastUppdaterad: rader.reduce<Date | null>((s, r) => (!s || r.updatedAt > s ? r.updatedAt : s), null)?.toISOString() ?? null,
    });
  } catch (e: any) {
    console.error('[chatt/oversikt]', e?.message);
    return res.status(500).json({ error: 'Kunde inte hämta chattstatistiken' });
  }
}
