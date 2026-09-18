import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_CONFIG,
  instantFromZoned,
  isSameSession,
  sessionDateFor,
  sessionEndInstant,
  sessionLengthMs,
  sessionStartInstant,
  zonedParts,
  zoneOffsetMs,
} from '@/domain/risk/session';

const config = DEFAULT_SESSION_CONFIG.value;
const HOUR = 3_600_000;

describe('timezone primitives', () => {
  it('reads wall-clock parts in the configured zone', () => {
    const parts = zonedParts(new Date('2026-01-15T22:30:00Z'), 'America/New_York');
    expect(parts).toMatchObject({ year: 2026, month: 1, day: 15, hour: 17, minute: 30 });
  });

  it('reports the correct offset either side of the DST change', () => {
    // 2026: US DST starts 8 March, ends 1 November.
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-5 * HOUR);
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-4 * HOUR);
  });

  it('round-trips a wall-clock time to an instant', () => {
    const instant = instantFromZoned(2026, 1, 15, 17, 0, 'America/New_York');
    expect(instant.toISOString()).toBe('2026-01-15T22:00:00.000Z');
    const summer = instantFromZoned(2026, 7, 15, 17, 0, 'America/New_York');
    expect(summer.toISOString()).toBe('2026-07-15T21:00:00.000Z');
  });

  it('resolves the spring-forward gap forward instead of returning a wrong time', () => {
    // 02:30 on 8 March 2026 does not exist in America/New_York.
    const instant = instantFromZoned(2026, 3, 8, 2, 30, 'America/New_York');
    const rendered = zonedParts(instant, 'America/New_York');
    expect(rendered.hour).toBe(3);
    expect(rendered.minute).toBe(30);
  });

  it('resolves the fall-back overlap to the first occurrence', () => {
    // 01:30 on 1 November 2026 occurs twice; the first is still on EDT (-4).
    const instant = instantFromZoned(2026, 11, 1, 1, 30, 'America/New_York');
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
});

describe('session attribution', () => {
  it('labels a session by its closing date', () => {
    // 16:59 ET on 15 Jan is still the session closing 15 Jan.
    expect(sessionDateFor(new Date('2026-01-15T21:59:00Z'), config)).toBe('2026-01-15');
    // 17:00 ET on 15 Jan opens the session closing 16 Jan.
    expect(sessionDateFor(new Date('2026-01-15T22:00:00Z'), config)).toBe('2026-01-16');
  });

  it('rolls at 17:00 local time on both sides of the DST change', () => {
    // Winter: boundary is 22:00Z. Summer: boundary is 21:00Z.
    expect(sessionDateFor(new Date('2026-01-20T21:59:00Z'), config)).toBe('2026-01-20');
    expect(sessionDateFor(new Date('2026-01-20T22:00:00Z'), config)).toBe('2026-01-21');
    expect(sessionDateFor(new Date('2026-07-20T20:59:00Z'), config)).toBe('2026-07-20');
    expect(sessionDateFor(new Date('2026-07-20T21:00:00Z'), config)).toBe('2026-07-21');
  });

  it('does not reset a second time on the spring-forward day', () => {
    // US DST begins 08 March 2026 at 02:00 local, inside the session that
    // opened 17:00 on 07 March and closes 17:00 on 08 March.
    const open = sessionStartInstant('2026-03-08', config);
    const close = sessionEndInstant('2026-03-08', config);
    expect(open.toISOString()).toBe('2026-03-07T22:00:00.000Z');
    expect(close.toISOString()).toBe('2026-03-08T21:00:00.000Z');
    // 23 hours, not 24: the clock jumped forward inside this session.
    expect(sessionLengthMs('2026-03-08', config)).toBe(23 * HOUR);

    // Every instant strictly inside the session maps to the same session date,
    // so the daily loss allowance resets exactly once across the transition.
    for (let t = open.getTime(); t < close.getTime(); t += HOUR) {
      expect(sessionDateFor(new Date(t), config)).toBe('2026-03-08');
    }
  });

  it('does not skip a reset on the fall-back day', () => {
    // US DST ends 01 November 2026 at 02:00 local, inside the session that
    // opened 17:00 on 31 October and closes 17:00 on 01 November.
    const open = sessionStartInstant('2026-11-01', config);
    const close = sessionEndInstant('2026-11-01', config);
    expect(open.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(close.toISOString()).toBe('2026-11-01T22:00:00.000Z');
    // 25 hours: the clock fell back inside this session.
    expect(sessionLengthMs('2026-11-01', config)).toBe(25 * HOUR);

    for (let t = open.getTime(); t < close.getTime(); t += HOUR) {
      expect(sessionDateFor(new Date(t), config)).toBe('2026-11-01');
    }
  });

  it('treats the boundary instant as the start of the next session, never both', () => {
    const close = sessionEndInstant('2026-03-08', config);
    expect(sessionDateFor(new Date(close.getTime() - 1), config)).toBe('2026-03-08');
    expect(sessionDateFor(close, config)).toBe('2026-03-09');
  });

  it('compares two instants for same-session membership', () => {
    expect(
      isSameSession(new Date('2026-01-15T14:00:00Z'), new Date('2026-01-15T21:00:00Z'), config),
    ).toBe(true);
    expect(
      isSameSession(new Date('2026-01-15T21:00:00Z'), new Date('2026-01-15T23:00:00Z'), config),
    ).toBe(false);
  });

  it('is marked PROPOSED until the exchange calendar is approved', () => {
    expect(DEFAULT_SESSION_CONFIG.status).toBe('PROPOSED');
  });
});
