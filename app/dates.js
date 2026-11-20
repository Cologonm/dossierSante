// Calculs de dates. Toutes les dates sont des chaînes "AAAA-MM-JJ" (jour local, sans heure),
// converties en minuit UTC pour éviter les décalages d'heure d'été.

export const CYCLE_DAYS = 28;
export const ANNUAL_REMINDER_DAYS = 45;
const DAY = 86400000;

export const toTime = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const toISO = (t) => new Date(t).toISOString().slice(0, 10);

export function todayISO(now = new Date()) {
  return toISO(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
export const addDays = (iso, n) => toISO(toTime(iso) + n * DAY);
export function addYears(iso, n) {
  const d = new Date(toTime(iso));
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return toISO(d.getTime());
}
export const daysBetween = (from, to) => Math.round((toTime(to) - toTime(from)) / DAY);

/** Prochaine délivrance : dernière délivrance + 28 jours. */
export function nextDelivery(lastISO, today) {
  const next = addDays(lastISO, CYCLE_DAYS);
  return { next, days: daysBetween(today, next), dayOfCycle: daysBetween(lastISO, today) };
}

/** Ordonnance annuelle : valable un an à partir de sa date d'émission. */
export function annualValidity(issuedISO, today) {
  const end = addYears(issuedISO, 1);
  return { end, days: daysBetween(today, end), total: daysBetween(issuedISO, end), elapsed: daysBetween(issuedISO, today) };
}

const fmt = (opts) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...opts });
const fLong = fmt({ day: 'numeric', month: 'long', year: 'numeric' });
const fWeekday = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const fDayMonth = fmt({ day: 'numeric', month: 'long' });

export const formatLong = (iso) => fLong.format(toTime(iso));            // 6 novembre 2026
export const formatWeekday = (iso) => fWeekday.format(toTime(iso));      // vendredi 4 décembre
export const formatDayMonth = (iso) => fDayMonth.format(toTime(iso));    // 6 novembre
export const plural = (n, one, many) => `${n} ${Math.abs(n) > 1 ? many : one}`;
