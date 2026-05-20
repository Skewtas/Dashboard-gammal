/**
 * Single Vercel serverless function for the HeadOf 2.0 API surface.
 *
 * Vercel rewrites map /api/clients/*, /api/ops/*, etc. → /api/hf-handler so we
 * don't rely on catch-all file routing (which kept shadowing other API files
 * in unpredictable ways across deploys).
 *
 * The original URL (with the /api/<entity>/... prefix intact) is what Express
 * sees in req.url, so the existing routers mounted at /api/clients, /api/ops,
 * /api/employees, … match exactly like in local dev.
 */
export { default } from './_lib/headofHandler.js';
