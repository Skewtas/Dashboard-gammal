/**
 * Vercel serverless entry-point for HeadOf 2.0 API routes.
 *
 * Lazy-loads buildHeadofApp() inside the handler so the heavy module graph
 * (Express, Clerk middleware, 13 routers, Prisma adapters) is initialised
 * AFTER Node's ESM loader has resolved this file. Eager top-level imports
 * caused ERR_INTERNAL_ASSERTION ("module imported again after being
 * required") on Vercel because the ESM/CJS interop tripped over Prisma's
 * internals when the function bundle was assembled.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

let cached: any = null;
let initError: Error | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (initError) {
    res.status(500).json({ error: 'Init failed', details: initError.message });
    return;
  }
  if (!cached) {
    try {
      const { buildHeadofApp } = await import('./headofApp.js');
      cached = buildHeadofApp();
    } catch (err) {
      initError = err as Error;
      console.error('[headof] init error', initError);
      res.status(500).json({ error: 'Init failed', details: initError.message });
      return;
    }
  }
  return cached(req as any, res as any);
}
