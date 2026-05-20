// `rrule` is a CommonJS package — its named exports aren't reachable through
// pure ESM `import { RRule } from 'rrule'` when bundled on Vercel. Default-
// import the namespace and pull off the names we need.
import rrulePkg from 'rrule';
const { RRule, rrulestr } = rrulePkg as unknown as {
  RRule: any;
  rrulestr: (s: string) => any;
};

/**
 * Expand an RRULE string into concrete dates between [from, to].
 * Handles both raw "FREQ=...;..." and full "DTSTART:..." strings.
 */
export function expandRrule(rrule: string, from: Date, to: Date, dtstart: Date): Date[] {
  let rule: any;
  try {
    if (rrule.includes('DTSTART')) {
      rule = rrulestr(rrule);
    } else {
      rule = RRule.fromString(`DTSTART:${toIcal(dtstart)}\nRRULE:${rrule}`);
    }
  } catch {
    // Fallback: try as plain options-ish string
    rule = new RRule({
      freq: RRule.WEEKLY,
      dtstart,
    });
  }
  return rule.between(from, to, true);
}

function toIcal(d: Date): string {
  // yyyyMMddTHHmmssZ
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Combine a date and "HH:MM" time into a Date (local interpretation).
 */
export function combineDateTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const out = new Date(date);
  out.setHours(h || 0, m || 0, 0, 0);
  return out;
}
