/**
 * "Hur länge stannar våra kunder?" — fakturabaserad kundlojalitet.
 *
 * Snabb endpoint: läser cachad snapshot från DashboardSnapshot-tabellen.
 * Returnerar omedelbart (vanligtvis <300 ms). Är snapshoten äldre än 24 h
 * triggas en bakgrundsuppdatering — användaren får ändå svaret direkt.
 *
 * Manuell uppdatering: POST /api/dashboard/customer-tenure (eller GET med
 * ?refresh=1) tvingar en synkron refresh och returnerar färska siffror.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';
import { getTimewaveToken, forceRefreshTimewaveToken } from '../_lib/timewaveAuth.js';

const KEY = 'customer_tenure';
const STALE_HOURS = 24;
const DEFAULT_WINDOW_MONTHS = 36;

interface TenureResult {
  computedAt: string;
  windowMonths: number;
  source: 'invoices';
  activeCustomers: number;
  averageMonths: number;
  medianMonths: number;
  buckets: {
    'lt3mo': number;
    '3to6mo': number;
    '6to12mo': number;
    '1to2yr': number;
    '2plus': number;
  };
  oldestKnownMonths: number;
  invoicesScanned: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const force = req.query.refresh === '1' || req.query.refresh === 'true' || req.method === 'POST';

  if (force) {
    try {
      const data = await refreshAndStore();
      return res.json({ ...data, cached: false, stale: false });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'refresh failed' });
    }
  }

  const snapshot = await prisma.dashboardSnapshot.findUnique({ where: { key: KEY } });
  if (!snapshot) {
    // Inget cachat — gör en synkron beräkning första gången
    try {
      const data = await refreshAndStore();
      return res.json({ ...data, cached: false, stale: false });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'first compute failed' });
    }
  }

  const ageMs = Date.now() - snapshot.computedAt.getTime();
  const stale = ageMs > STALE_HOURS * 3600 * 1000;
  const data = snapshot.data as unknown as TenureResult;

  // Färska data finns — returnera dem direkt
  res.json({ ...data, cached: true, stale, ageHours: Math.round(ageMs / 3600000) });
}

async function refreshAndStore(): Promise<TenureResult> {
  await prisma.dashboardSnapshot.upsert({
    where: { key: KEY },
    create: { key: KEY, data: {} as any, refreshing: true },
    update: { refreshing: true },
  });
  try {
    const data = await computeTenureFromInvoices(DEFAULT_WINDOW_MONTHS);
    await prisma.dashboardSnapshot.upsert({
      where: { key: KEY },
      create: { key: KEY, data: data as any, refreshing: false, computedAt: new Date() },
      update: { data: data as any, refreshing: false, computedAt: new Date() },
    });
    return data;
  } catch (err) {
    await prisma.dashboardSnapshot.update({
      where: { key: KEY },
      data: { refreshing: false },
    }).catch(() => {});
    throw err;
  }
}

async function computeTenureFromInvoices(windowMonths: number): Promise<TenureResult> {
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth() - windowMonths, 1);
  const cutoffStr = formatDate(cutoff);

  let token = await getTimewaveToken();
  const baseUrl = 'https://api.timewave.se/v3';

  const fetchPage = async (page: number, retry = true): Promise<{ data: any[]; last_page: number }> => {
    let res = await fetch(`${baseUrl}/invoices?page[number]=${page}&page[size]=300`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 403 && retry) {
      token = await forceRefreshTimewaveToken();
      return fetchPage(page, false);
    }
    if (!res.ok) return { data: [], last_page: 1 };
    return res.json() as Promise<{ data: any[]; last_page: number }>;
  };

  const first = await fetchPage(1);
  const lastPage = first.last_page || 1;

  // Walk newest → oldest, 16 pages parallellt per omgång
  const byClient = new Map<number, { first: string; last: string; count: number }>();
  let invoicesScanned = 0;
  let stop = false;
  const BATCH = 16;
  for (let page = lastPage; page > 0 && !stop; page -= BATCH) {
    const pages: number[] = [];
    for (let i = 0; i < BATCH && page - i > 0; i++) pages.push(page - i);
    const results = await Promise.all(
      pages.map((p) => fetchPage(p).catch(() => ({ data: [], last_page: 1 })))
    );
    for (const r of results) {
      const invoices = r.data || [];
      let allBeforeCutoff = invoices.length > 0;
      for (const inv of invoices) {
        invoicesScanned++;
        if (inv.deleted || inv.credited) continue;
        const cid = inv.client_id ?? inv.client?.id;
        const date: string | undefined = inv.invoice_date;
        if (!cid || !date) continue;
        if (date >= cutoffStr) allBeforeCutoff = false;
        if (date < cutoffStr) continue;
        const ex = byClient.get(cid);
        if (!ex) byClient.set(cid, { first: date, last: date, count: 1 });
        else {
          if (date < ex.first) ex.first = date;
          if (date > ex.last) ex.last = date;
          ex.count++;
        }
      }
      if (allBeforeCutoff) stop = true;
    }
  }

  const activeCutoff = new Date(today.getTime() - 90 * 24 * 3600 * 1000);
  const activeCutoffStr = formatDate(activeCutoff);

  const tenures: number[] = [];
  let oldestMonths = 0;
  for (const [, info] of byClient) {
    if (info.last < activeCutoffStr) continue;
    const months = monthsBetween(new Date(info.first), today);
    tenures.push(months);
    if (months > oldestMonths) oldestMonths = months;
  }

  tenures.sort((a, b) => a - b);
  const totalActive = tenures.length;
  const avg = totalActive ? tenures.reduce((s, x) => s + x, 0) / totalActive : 0;
  const median = totalActive
    ? tenures.length % 2
      ? tenures[Math.floor(tenures.length / 2)]
      : (tenures[tenures.length / 2 - 1] + tenures[tenures.length / 2]) / 2
    : 0;

  return {
    computedAt: today.toISOString(),
    windowMonths,
    source: 'invoices',
    activeCustomers: totalActive,
    averageMonths: Math.round(avg * 10) / 10,
    medianMonths: Math.round(median * 10) / 10,
    buckets: {
      lt3mo: tenures.filter((t) => t < 3).length,
      '3to6mo': tenures.filter((t) => t >= 3 && t < 6).length,
      '6to12mo': tenures.filter((t) => t >= 6 && t < 12).length,
      '1to2yr': tenures.filter((t) => t >= 12 && t < 24).length,
      '2plus': tenures.filter((t) => t >= 24).length,
    },
    oldestKnownMonths: Math.round(oldestMonths * 10) / 10,
    invoicesScanned,
  };
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthsBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24 * 30.4375));
}
