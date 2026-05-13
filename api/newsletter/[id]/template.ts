/**
 * Return a newsletter's editable content so the user can load it back into the
 * editor as a template ("Använd som mall").
 *
 * Returns blocks if we saved them; otherwise falls back to a synthetic block
 * list built from the legacy fields (so old newsletters from before the
 * `blocks` column existed are still copyable, just less granularly editable).
 */
import { prisma } from '../../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const n = await prisma.newsletter.findUnique({ where: { id } });
  if (!n) return res.status(404).json({ error: 'Not found' });

  let blocks: any[] = [];
  if (Array.isArray(n.blocks)) {
    blocks = n.blocks as any[];
  } else if (n.htmlContent) {
    blocks = [
      {
        id: `imported-${id}`,
        type: 'text',
        content:
          'Detta nyhetsbrev importerades från en äldre version utan block-data.\n' +
          'Den fullständiga HTML-koden finns kvar i ditt utskick — men för att redigera ' +
          'innehållet enklare, börja med att bygga om sektionerna här.',
      },
    ];
  } else {
    if (n.introText) {
      blocks.push({ id: `intro-${id}`, type: 'text', content: n.introText });
    }
    if (n.imageData) {
      blocks.push({ id: `img-${id}`, type: 'image', content: '', imageData: n.imageData });
    }
  }

  res.json({
    id: n.id,
    subject: n.subject,
    category: n.category,
    blocks,
    introText: n.introText ?? '',
    imageData: n.imageData ?? null,
    embedUrl: n.embedUrl ?? null,
  });
}
