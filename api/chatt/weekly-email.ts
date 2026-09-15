/**
 * Veckorapport om chatten på stodona.se – vad kunderna frågar Camilla om.
 *
 * Körs av Vercel cron måndagar 06:00 och sammanfattar de senaste sju dagarna ur
 * chat_daily_stats och chat_questions (som fylls av api/chatt/import-daily).
 *
 * Mottagare: CHAT_REPORT_EMAILS (kommaseparerad), standard info@stodona.se.
 * Auth: Bearer <CRON_SECRET> eller ?secret=<CRON_SECRET>.
 * Frågorna i mejlet är redan anonymiserade, men escapas ändå som HTML.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function isoVecka(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dag);
  const arStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - arStart.getTime()) / 86400000 + 1) / 7);
}

function summera(rader: Array<Record<string, number>>): Array<[string, number]> {
  const totalt: Record<string, number> = {};
  for (const r of rader) for (const [k, v] of Object.entries(r ?? {})) totalt[k] = (totalt[k] ?? 0) + Number(v);
  return Object.entries(totalt).sort((a, b) => b[1] - a[1]);
}

const UTFALL_TEXT: Record<string, string> = {
  bokningsutkast: 'Fick bokningen förberedd',
  'överlämnat': 'Lämnades över till kundservice',
  lead: 'Ville bli kontaktade',
  tider: 'Tittade på lediga tider',
  pris: 'Fick ett pris',
  'bara frågor': 'Ställde bara frågor',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const authHdr = req.headers.authorization || '';
  if (!secret || (authHdr !== `Bearer ${secret}` && req.query.secret !== secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // De sju hela dagarna före idag – körs mejlet på måndag blir det mån–sön.
  const nu = new Date();
  const idag = new Date(`${nu.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const fran = new Date(idag.getTime() - 7 * 24 * 3600 * 1000);
  const period = { gte: fran, lt: idag };

  const [dagar, fragor] = await Promise.all([
    prisma.chatDagStatistik.findMany({ where: { date: period }, orderBy: { date: 'asc' } }),
    prisma.chatFraga.findMany({ where: { date: period }, orderBy: { tid: 'desc' }, take: 400 }),
  ]);

  const antalSamtal = dagar.reduce((n, d) => n + d.antalSamtal, 0);
  const antalFragor = dagar.reduce((n, d) => n + d.antalFragor, 0);
  const amnen = summera(dagar.map((d) => d.amnen as Record<string, number>));
  const utfall = summera(dagar.map((d) => d.utfall as Record<string, number>));
  const ovrigt = fragor.filter((f) => f.amnen.length === 1 && f.amnen[0] === 'övrigt').slice(0, 15);
  const senaste = fragor.slice(0, 15);

  const vecka = isoVecka(fran);
  const subject = `HeadOf — Chatten vecka ${vecka}: ${antalSamtal} samtal`;
  const appUrl = process.env.APP_URL || `https://${req.headers.host}`;

  const lista = (rader: Array<[string, number]>, text?: Record<string, string>) =>
    rader.length
      ? rader.map(([k, v]) => `<tr><td style="padding:6px 0;color:#1a1a2e;">${esc(text?.[k] ?? k)}</td><td style="padding:6px 0;text-align:right;font-weight:600;">${v}</td></tr>`).join('')
      : '<tr><td style="padding:6px 0;color:#8b8578;">Inga samtal den här veckan.</td></tr>';

  const fragelista = (rader: typeof fragor) =>
    rader.length
      ? rader.map((f) => `<li style="margin:0 0 8px;color:#1a1a2e;">${esc(f.text)} <span style="color:#8b8578;font-size:12px;">· ${esc(f.amnen.join(', '))}</span></li>`).join('')
      : '<li style="color:#8b8578;">Inga.</li>';

  const html = `
<div style="font-family:Inter,'Helvetica Neue',Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e;">
  <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;margin:0 0 4px;">Chatten – vecka ${vecka}</h1>
  <p style="color:#8b8578;margin:0 0 24px;">Vad kunderna frågade Camilla på stodona.se de senaste sju dagarna.</p>

  <table style="width:100%;border-collapse:collapse;margin:0 0 24px;"><tr>
    <td style="padding:16px;background:#f4f1eb;border-radius:12px;width:50%;"><div style="font-size:28px;font-weight:700;">${antalSamtal}</div><div style="color:#8b8578;font-size:13px;">samtal</div></td>
    <td style="width:12px;"></td>
    <td style="padding:16px;background:#f4f1eb;border-radius:12px;width:50%;"><div style="font-size:28px;font-weight:700;">${antalFragor}</div><div style="color:#8b8578;font-size:13px;">frågor</div></td>
  </tr></table>

  <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:18px;margin:0 0 8px;">Vad samtalen gällde</h2>
  <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">${lista(amnen)}</table>

  <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:18px;margin:0 0 8px;">Hur samtalen slutade</h2>
  <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">${lista(utfall, UTFALL_TEXT)}</table>

  <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:18px;margin:0 0 8px;">Frågor utan tydligt ämne</h2>
  <p style="color:#8b8578;font-size:13px;margin:0 0 8px;">Här syns ofta det Camilla inte är byggd för ännu.</p>
  <ul style="padding-left:18px;margin:0 0 24px;">${fragelista(ovrigt)}</ul>

  <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:18px;margin:0 0 8px;">Senaste frågorna</h2>
  <ul style="padding-left:18px;margin:0 0 24px;">${fragelista(senaste)}</ul>

  <p style="color:#8b8578;font-size:12px;margin:24px 0 0;">Frågorna är anonymiserade och raderas efter 90 dagar. Mer i fliken CHATT i <a href="${esc(appUrl)}" style="color:#1a1a2e;">Head of</a>.</p>
</div>`;

  const recipients = (process.env.CHAT_REPORT_EMAILS || 'info@stodona.se').split(',').map((s) => s.trim()).filter(Boolean);
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'info@stodona.se';

  if (!process.env.RESEND_API_KEY) {
    return res.json({ ok: true, dryRun: true, message: 'RESEND_API_KEY saknas — inga mejl skickades.', recipients, subject });
  }

  const skickade: string[] = [];
  const misslyckade: { email: string; error: string }[] = [];
  for (const to of recipients) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `"Stodona HeadOf" <${fromAddress}>`, to, subject, html }),
      });
      if (r.ok) skickade.push(to);
      else misslyckade.push({ email: to, error: `${r.status} ${await r.text()}` });
    } catch (e: any) {
      misslyckade.push({ email: to, error: e?.message ?? 'okänt fel' });
    }
  }

  return res.json({ ok: misslyckade.length === 0, vecka, antalSamtal, antalFragor, skickade, misslyckade, genererad: nu.toISOString() });
}
