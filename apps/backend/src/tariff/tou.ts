import { DateTime } from 'luxon';
import type { TariffRulesV1 } from './rules.schema.js';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/** First matching window in declared order wins; windows cannot cross midnight. */
export function windowFor(
  bucketStartUtc: Date,
  rules: TariffRulesV1,
  holidays: ReadonlySet<string>,
): string {
  const local = DateTime.fromJSDate(bucketStartUtc, { zone: 'utc' }).setZone(
    rules.timezone,
  );
  const day = WEEKDAYS[local.weekday - 1];
  const clock = local.toFormat('HH:mm');
  const date = local.toISODate();
  for (const window of rules.touWindows) {
    if (
      day &&
      window.days.includes(day) &&
      clock >= window.start &&
      clock < window.end &&
      !(window.excludeHolidays && date !== null && holidays.has(date))
    )
      return window.code;
  }
  return rules.defaultWindow;
}
