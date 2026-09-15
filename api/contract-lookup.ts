/**
 * Diagnostisk lookup för anställningsavtal.
 * GET /api/contract-lookup?q=<sökterm>&secret=<CRON_SECRET>
 *
 * Söker efter person (firstName ILIKE + lastName ILIKE + email ILIKE),
 * hämtar deras kontrakt + signer-status + berättar om suppression skulle
 * blockera mailet.
 *
 * Så vi snabbt kan svara på frågor som "varför fick X inte sitt avtal?".
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './_lib/prisma.js';
import { isBlockedEmail } from './_lib/suppressionList.js';

export const config = { maxDuration: 30 };

const SUPERADMIN_EMAILS = (
  process.env.CONTRACT_SUPERADMIN_EMAILS || 'mikaela.wigert@stodona.se'
).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth: superadmin-cookie ELLER CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = String(req.query.secret || req.headers['x-cron-secret'] || '');
  const isSecretOk = !!cronSecret && providedSecret === cronSecret;
  if (!isSecretOk) {
    // Vi kräver secret här — enkelt att köra från browser
    return res.status(403).json({
      error: 'Behöver ?secret=<CRON_SECRET>',
    });
  }

  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.status(400).json({ error: 'Ange ?q=<namn eller email>' });

  const persons = await prisma.contractPerson.findMany({
    where: {
      OR: [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 20,
  });

  const results: any[] = [];
  for (const p of persons) {
    const contracts = await prisma.contract.findMany({
      where: { personId: p.id },
      include: {
        signers: { orderBy: { signingOrder: 'asc' } },
        ownCompany: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    const blocked = await isBlockedEmail(p.email);
    results.push({
      person: {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        phone: p.phone,
        emailWouldBeBlocked: blocked,
      },
      contracts: contracts.map((c: any) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        company: c.ownCompany?.name,
        updatedAt: c.updatedAt,
        signers: c.signers.map((s: any) => ({
          id: s.id,
          name: s.name,
          email: s.email,
          signingOrder: s.signingOrder,
          status: s.status,
          signedAt: s.signedAt,
          emailWouldBeBlocked: undefined as any, // filled below
        })),
      })),
    });
    // Fill signer email-blocked
    for (const c of results[results.length - 1].contracts) {
      for (const s of c.signers) {
        s.emailWouldBeBlocked = await isBlockedEmail(s.email);
      }
    }
  }

  res.json({
    query: q,
    matchCount: persons.length,
    results,
  });
}
