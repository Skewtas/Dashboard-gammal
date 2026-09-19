/**
 * Sökbara chatt-dialoger från stodona.se — de senaste 7 dagarna.
 *
 * GET /api/chatt/dialoger?q=<söktext>&dagar=1|3|7
 *   Utan q: senaste dialogerna, nyast först
 *   Med q:  ILIKE-sökning i hela dialogen (både kund och bot)
 *
 * GET /api/chatt/dialoger?id=<samtalsId>
 *   Full dialog för ett specifikt samtal (för expandering i UI)
 *
 * Kräver Clerk-session — GDPR-känsligt innehåll.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '@clerk/backend';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 30 };

async function inloggad(req: VercelRequest): Promise<string | null> {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await inloggad(req))) return res.status(401).json({ error: 'Unauthorized' });

  const enId = typeof req.query.id === 'string' ? req.query.id : null;

  // Enskild dialog för expandering
  if (enId) {
    const d = await prisma.chatDialog.findUnique({ where: { samtalsId: enId } });
    if (!d) return res.status(404).json({ error: 'Dialogen finns inte (kan ha rensats efter 7 dagar)' });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      samtalsId: d.samtalsId,
      date: d.date.toISOString().slice(0, 10),
      antalMeddelanden: d.antalMeddelanden,
      meddelanden: d.meddelanden,
    });
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const dagar = [1, 3, 7].includes(Number(req.query.dagar)) ? Number(req.query.dagar) : 7;
  const fran = new Date(`${new Date(Date.now() - (dagar - 1) * 24 * 3600 * 1000).toISOString().slice(0, 10)}T00:00:00.000Z`);

  try {
    const where: any = { date: { gte: fran } };
    if (q) {
      // ILIKE-sökning i hela dialogens sammanlagda text
      where.sokText = { contains: q, mode: 'insensitive' };
    }

    const dialoger = await prisma.chatDialog.findMany({
      where,
      orderBy: { importedAt: 'desc' },
      take: q ? 100 : 50,
      select: {
        samtalsId: true,
        date: true,
        antalMeddelanden: true,
        importedAt: true,
        // Vi returnerar första + sista användarmeddelande som förhandsvisning
        meddelanden: true,
      },
    });

    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      sokterm: q || null,
      antal: dialoger.length,
      dialoger: dialoger.map((d) => {
        const msgs = Array.isArray(d.meddelanden) ? (d.meddelanden as any[]) : [];
        const forsta = msgs.find((m) => m.role === 'user')?.content?.slice(0, 200) ?? '';
        const sista = [...msgs].reverse().find((m) => m.role === 'user')?.content?.slice(0, 200) ?? '';
        return {
          samtalsId: d.samtalsId,
          date: d.date.toISOString().slice(0, 10),
          importedAt: d.importedAt.toISOString(),
          antalMeddelanden: d.antalMeddelanden,
          forstaFraga: forsta,
          sistaFraga: forsta !== sista ? sista : null,
        };
      }),
    });
  } catch (e: any) {
    console.error('[chatt/dialoger]', e?.message);
    return res.status(500).json({ error: 'Kunde inte söka i dialogerna' });
  }
}
