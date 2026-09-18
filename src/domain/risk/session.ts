/**
 * Trading session boundaries in an IANA timezone, with daylight-saving handling.
 *
 * The daily loss limit resets on a SESSION boundary, not at UTC midnight and
 * not at a fixed UTC offset. Getting this wrong twice a year would either give
 * a trader a second daily loss allowance or cut one short, so the conversion
 * between wall-clock time in a named zone and an absolute instant is done here,
 * once, and tested across both DST transitions.
 *
 * Session date convention (CME-style): a session is labelled with the calendar
 * date on which it CLOSES. The boundary is the close time; an event at or after
 * the boundary belongs to the next session date.
 *
 * The concrete session times and the exchange/instrument calendar below are
 * PROPOSED and require approval before production use.
 */

import { proposed, type Governed } from '../config/requirement-status';

export interface SessionConfig {
  /** IANA timezone name, e.g. "America/New_York". Never a fixed offset. */
  readonly timeZone: string;
  /** Local hour (0-23) at which one session ends and the next begins. */
  readonly boundaryHour: number;
  readonly boundaryMinute: number;
}

export const DEFAULT_SESSION_CONFIG: Governed<SessionConfig> = proposed(
  { timeZone: 'America/New_York', boundaryHour: 17, boundaryMinute: 0 },
  'Sessions roll at 17:00 America/New_York. Exact session times, holiday calendar ' +
    'and per-instrument schedules must be approved against the exchange calendar ' +
    'before production use.',
  'Build prompt §6 — "Define session boundary in an IANA timezone ... and an approved exchange/instrument calendar"',
);

/**
 * Globex reopen, in the session timezone.
 *
 * This is when a daily-loss lockout lifts. It is deliberately NOT the session
 * boundary: the session rolls at 17:00 and refreshes the daily allowance, the
 * market reopens an hour later at 18:00, and only then can the trader place an
 * order. Two clocks for two different jobs, an hour apart, matching the CME
 * maintenance window between the close and the reopen.
 */
export const GLOBEX_REOPEN_HOUR = 18;
export const GLOBEX_REOPEN_MINUTE = 0;

export interface ZonedParts {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  /** 1-31. */
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock parts of `instant` as observed in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Missing ${type} while formatting for ${timeZone}`);
    return Number(found.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (east positive). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Zero out sub-second noise so the difference is a clean offset.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Absolute instant for a wall-clock time in `timeZone`.
 *
 * DST edge cases, resolved explicitly rather than left to chance:
 *  - Spring-forward gap (the wall time does not exist): returns the instant at
 *    which the clock jumps past it, so a session never silently vanishes.
 *  - Fall-back overlap (the wall time occurs twice): returns the FIRST
 *    occurrence, i.e. the one still on the pre-transition offset.
 */
export function instantFromZoned(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  // Two-pass fixed point: guess with the offset at the naive instant, then
  // correct using the offset actually in force at the candidate instant.
  const firstOffset = zoneOffsetMs(new Date(wallAsUtc), timeZone);
  let candidate = new Date(wallAsUtc - firstOffset);
  const secondOffset = zoneOffsetMs(candidate, timeZone);
  if (secondOffset !== firstOffset) {
    candidate = new Date(wallAsUtc - secondOffset);
  }

  // Verify the round trip. If the wall time does not exist (spring-forward gap)
  // the candidate will render as a different time; advance to the post-jump
  // instant instead of returning something that silently misrepresents itself.
  const rendered = zonedParts(candidate, timeZone);
  if (rendered.hour !== hour || rendered.minute !== minute) {
    return new Date(wallAsUtc - firstOffset);
  }
  return candidate;
}

function pad(value: number, width = 2): string {
  return value.toString().padStart(width, '0');
}

function addDays(year: number, month: number, day: number, delta: number): ZonedParts {
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

/** Session identifier, "YYYY-MM-DD", labelled by the session's close date. */
export type SessionDate = string;

export function sessionDateFor(instant: Date, config: SessionConfig): SessionDate {
  const local = zonedParts(instant, config.timeZone);
  const minutesNow = local.hour * 60 + local.minute;
  const boundaryMinutes = config.boundaryHour * 60 + config.boundaryMinute;

  if (minutesNow >= boundaryMinutes) {
    const next = addDays(local.year, local.month, local.day, 1);
    return `${next.year}-${pad(next.month)}-${pad(next.day)}`;
  }
  return `${local.year}-${pad(local.month)}-${pad(local.day)}`;
}

/** The instant at which the given session opened. */
export function sessionStartInstant(sessionDate: SessionDate, config: SessionConfig): Date {
  const [year, month, day] = sessionDate.split('-').map(Number) as [number, number, number];
  const previous = addDays(year, month, day, -1);
  return instantFromZoned(
    previous.year,
    previous.month,
    previous.day,
    config.boundaryHour,
    config.boundaryMinute,
    config.timeZone,
  );
}

/** The instant at which the given session closes (exclusive upper bound). */
export function sessionEndInstant(sessionDate: SessionDate, config: SessionConfig): Date {
  const [year, month, day] = sessionDate.split('-').map(Number) as [number, number, number];
  return instantFromZoned(
    year,
    month,
    day,
    config.boundaryHour,
    config.boundaryMinute,
    config.timeZone,
  );
}

/** True when both instants fall in the same trading session. */
export function isSameSession(a: Date, b: Date, config: SessionConfig): boolean {
  return sessionDateFor(a, config) === sessionDateFor(b, config);
}

/** Length of a session in milliseconds. Differs by an hour across DST changes. */
export function sessionLengthMs(sessionDate: SessionDate, config: SessionConfig): number {
  return sessionEndInstant(sessionDate, config).getTime() - sessionStartInstant(sessionDate, config).getTime();
}

/**
 * The next Globex reopen strictly after `instant`.
 *
 * Used for daily-loss lockouts: breach at 11:00 and the account is locked until
 * 18:00 the same evening; breach at 20:00 and it lifts at 18:00 the next day,
 * because that is genuinely the next reopen.
 *
 * Weekends are not skipped here. Whether a Friday breach should lift on
 * Saturday evening or hold to Sunday's actual reopen depends on the approved
 * exchange calendar, which has not been supplied — see docs/DECISIONS.md.
 * Inventing a weekend rule would invent a penalty the owner has not specified.
 */
export function nextMarketOpen(instant: Date, config: SessionConfig): Date {
  const local = zonedParts(instant, config.timeZone);
  const minutesNow = local.hour * 60 + local.minute;
  const openMinutes = GLOBEX_REOPEN_HOUR * 60 + GLOBEX_REOPEN_MINUTE;

  const target =
    minutesNow < openMinutes
      ? { year: local.year, month: local.month, day: local.day }
      : addDays(local.year, local.month, local.day, 1);

  return instantFromZoned(
    target.year,
    target.month,
    target.day,
    GLOBEX_REOPEN_HOUR,
    GLOBEX_REOPEN_MINUTE,
    config.timeZone,
  );
}

/** True when a lockout set at `lockedUntil` has expired. */
export function lockoutHasLifted(lockedUntil: Date | null, now: Date = new Date()): boolean {
  if (!lockedUntil) return true;
  return now.getTime() >= lockedUntil.getTime();
}
