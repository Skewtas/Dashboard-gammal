/**
 * Cron-driven processor for scheduled newsletters and open-reminders.
 *
 * Invoked by Vercel Cron (configured in vercel.json) every 15 min. Idempotent —
 * picks up rows whose scheduled time has passed and isn't already sent.
 *
 * Two phases per invocation:
 *  1. Send scheduled (status='scheduled', scheduledFor <= now)
 *  2. Send reminders (reminderEnabled, reminderSentAt IS NULL,
 *     reminderScheduledFor <= now, parent status in {sent, partial})
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';
import {
  sendScheduledNewsletter,
  sendNewsletterReminder,
} from '../_lib/newsletterSender.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow GET (Vercel Cron uses GET) and POST (manual trigger).
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // If CRON_SECRET is set, require it (Vercel sets Authorization: Bearer <secret>).
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
  const now = new Date();

  const due = await prisma.newsletter.findMany({
    where: {
      status: 'scheduled',
      scheduledFor: { lte: now },
    },
    select: { id: true },
    take: 20, // cap per invocation to keep below Vercel's max duration
  });

  const sentResults: any[] = [];
  for (const n of due) {
    try {
      const r = await sendScheduledNewsletter(n.id, baseUrl);
      sentResults.push({ id: n.id, sent: r.sent, failed: r.failed });
    } catch (err: any) {
      console.error(`Scheduled send failed for ${n.id}:`, err.message);
      await prisma.newsletter.update({
        where: { id: n.id },
        data: { status: 'failed' },
      }).catch(() => {});
      sentResults.push({ id: n.id, error: err.message });
    }
  }

  // Reminders: parent must be at least 'sent' or 'partial' (or 'scheduled' that we just sent above)
  const dueReminders = await prisma.newsletter.findMany({
    where: {
      reminderEnabled: true,
      reminderSentAt: null,
      reminderScheduledFor: { lte: now },
      status: { in: ['sent', 'partial'] },
      parentNewsletterId: null, // only originals, never reminders-of-reminders
    },
    select: { id: true },
    take: 20,
  });

  const reminderResults: any[] = [];
  for (const n of dueReminders) {
    try {
      const r = await sendNewsletterReminder(n.id, baseUrl);
      reminderResults.push(
        r === null
          ? { parentId: n.id, skipped: 'all recipients opened' }
          : { parentId: n.id, childId: r.childId, sent: r.result.sent, failed: r.result.failed }
      );
    } catch (err: any) {
      console.error(`Reminder send failed for ${n.id}:`, err.message);
      reminderResults.push({ parentId: n.id, error: err.message });
    }
  }

  res.json({
    ok: true,
    timestamp: now.toISOString(),
    scheduledProcessed: sentResults.length,
    sentResults,
    remindersProcessed: reminderResults.length,
    reminderResults,
  });
}
