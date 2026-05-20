/**
 * Root catch-all for HeadOf 2.0 API routes (clients, employees, teams, services,
 * agreements, missions, time, invoices, payroll, tickets, notes, jobs, import,
 * ops).
 *
 * Vercel routes the more-specific files first (api/timewave/[...path].ts,
 * api/newsletter/*.ts, api/mail/*.ts, etc.), so this catch-all only handles
 * paths not claimed elsewhere — exactly the HeadOf 2.0 surface.
 *
 * Using single-bracket [...path].ts on purpose: optional catch-alls
 * ([[...path]].ts) inconsistently bind on Vercel API routes, and that caused
 * the recent FUNCTION_INVOCATION_FAILED / 404 mix on /api/clients etc.
 */
export { default } from './_lib/headofHandler.js';
