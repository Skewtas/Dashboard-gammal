/**
 * Shared Vercel serverless handler that runs the HeadOf 2.0 Express app.
 * Used by api/clients/[[...path]].ts, api/agreements/[[...path]].ts, etc.
 *
 * One handler module instantiates the Express app once per cold start and
 * reuses it across invocations.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildHeadofApp } from './headofApp.js';

let cached: ReturnType<typeof buildHeadofApp> | null = null;

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!cached) cached = buildHeadofApp();
  return cached(req as any, res as any);
}
