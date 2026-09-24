/**
 * Debug-endpoint: visa exakt vilka missioner + priser som ligger bakom
 * en kunds summa i topClients-listan.
 *
 * Kör: /api/dashboard/client-revenue-debug?q=matlådor&secret=<CRON_SECRET>
 *   eller: ?clientId=123
 *
 * Visar per mission:
 *   - datum + status + arbetsordernr
 *   - varje service med qty, price, discount → beräknat radbelopp
 *   - kommentar om timmar (om tider saknas kan mission vara avbokad)
 *
 * Så vi snabbt kan svara på "varför är summan så här" utan att jaga i
 * Timewave-webben.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';

export const config = { maxDuration: 60 };

const SUPERADMIN_EMAILS = (
  process.env.CONTRACT_SUPERADMIN_EMAILS ||
  'mikaela.wigert@stodona.se,info@stodona.se'
).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

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
  const cronSecret = process.env.CRON_SECRET;
  const provided = String(req.query.secret || '');
  const isSecretOk = !!cronSecret && provided === cronSecret;
  if (!isSecretOk) return res.status(403).json({ error: 'secret krävs' });

  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : null;
  if (!q && !clientId) return res.status(400).json({ error: 'Ange ?q=<namn> eller ?clientId=<id>' });

  // Period: standard = innevarande månad
  const now = new Date();
  const todayStr = ymdSthlm(now);
  const monthStart = `${todayStr.slice(0, 7)}-01`;
  const startDate = (typeof req.query.startDate === 'string' && req.query.startDate) || monthStart;
  const endDate = (typeof req.query.endDate === 'string' && req.query.endDate) || todayStr;

  try {
    const token = await getTimewaveToken();
    const base = 'https://api.timewave.se/v3';

    // Hämta missioner för perioden
    const url = `${base}/missions?filter[startdate]=${startDate}&filter[enddate]=${endDate}&page[size]=1000`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`Timewave svarade ${r.status}: ${(await r.text()).substring(0, 200)}`);
    const j = await r.json() as any;
    const missioner: any[] = j?.data || [];

    // Filtrera på klient
    const matchande = missioner.filter((m) => {
      const client = m.client;
      if (!client?.id) return false;
      if (clientId && String(client.id) === clientId) return true;
      if (!q) return false;
      const namn = (
        client.companyname ||
        `${client.first_name || ''} ${client.last_name || ''}`
      ).toLowerCase();
      return namn.includes(q);
    });

    if (matchande.length === 0) {
      return res.json({
        query: q || `id=${clientId}`,
        period: `${startDate} → ${endDate}`,
        matchande: 0,
        message: 'Ingen matchande kund hittades för perioden.',
      });
    }

    // Bygg per-mission-detalj
    const nonBillableServiceIds = new Set([3, 7, 401]); // sjuk, ledig, etc

    let totalRevenue = 0;
    const detaljer = matchande.map((m) => {
      const services = m.services || [];
      let missionRevenue = 0;
      const serviceDetail = services.map((svc: any) => {
        const qty = Number(svc.quantity || 0);
        const price = Number(svc.price || 0);
        const discount = Number(svc.discount || 0);
        const nonBillable = nonBillableServiceIds.has(svc.id);
        const belopp = nonBillable ? 0 : qty * price * (1 - discount / 100);
        if (!nonBillable) missionRevenue += belopp;
        return {
          serviceId: svc.id,
          serviceNamn: svc.name || svc.title || `#${svc.id}`,
          qty, price, discount,
          nonBillable,
          radbelopp: Math.round(belopp),
        };
      });
      totalRevenue += missionRevenue;

      // Har missionen några UTFÖRDA employee-tider? Om alla är cancelled eller
      // saknar tid → mission är troligen avbokad men ligger kvar med pris.
      const employees = m.employees || [];
      const utforda = employees.filter((e: any) => e.starttime && e.endtime && !e.cancelled).length;
      const totalt = employees.length;
      let statusFlagg: string | null = null;
      if (utforda === 0 && missionRevenue > 0) {
        statusFlagg = totalt === 0
          ? '⚠️ Ingen anställd bokad — men pris räknas med'
          : '⚠️ Alla anställda är cancelled/utan tid — troligen avbokad, men pris räknas med';
      }

      return {
        missionId: m.id,
        typ: m.type || 'single',
        datum: m.startdate || m.date || null,
        arbetsorder: m.workorder?.id || null,
        antalTilldelade: totalt,
        antalUtforda: utforda,
        missionRevenue: Math.round(missionRevenue),
        services: serviceDetail,
        statusFlagg,
        kundNamn: m.client?.companyname || `${m.client?.first_name || ''} ${m.client?.last_name || ''}`.trim(),
        kundId: m.client?.id,
      };
    });

    // Räkna hur mycket "avbokade men prisas" är
    const avbokadPrisad = detaljer
      .filter((d) => d.statusFlagg)
      .reduce((sum, d) => sum + d.missionRevenue, 0);

    res.json({
      query: q || `id=${clientId}`,
      period: `${startDate} → ${endDate}`,
      matchande: detaljer.length,
      summa: {
        totalt: Math.round(totalRevenue),
        avbokadeMenPrisade: Math.round(avbokadPrisad),
        faktisktUtford: Math.round(totalRevenue - avbokadPrisad),
      },
      hint: avbokadPrisad > 0
        ? `⚠️ ${Math.round(avbokadPrisad)} kr av totalen kommer från missioner som ser ut att vara avbokade men fortfarande har pris i Timewave.`
        : null,
      detaljer,
    });
  } catch (err: any) {
    console.error('[client-revenue-debug]', err?.message);
    res.status(500).json({ error: err?.message || 'debug failed' });
  }
}
